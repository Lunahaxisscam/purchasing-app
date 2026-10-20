// ============================================================
// probe_retur_deadend.mjs — keputusan retur "Tentukan nanti" tidak bisa diubah
// ============================================================
// Modal retur dulu menyuruh admin: "Buka Terima Barang untuk barang yang sama
// dan pilih 'Kembalikan ke supplier' atau 'Dibuang' — setelah itu barisnya
// muncul di sini". Skrip ini menguji apakah instruksi itu BISA dijalankan
// pada PostgreSQL nyata (migrasi 00..04 milik t_03b41644) dengan modul
// aplikasi VERBATIM.
//
// Kenapa TIDAK bisa: `client_event_id` deterministik dari
// (penerimaan, item, kumulatif-sebelum, qty datang). Membuka form lagi setelah
// kedatangan tercatat membuat `prevCum` = qty yang sudah datang, sehingga:
//   (a) qty SAMA  → id 2->4 (bukan 0->2) = EVENT BARU, kedatangan bertambah
//       padahal barang tidak datang lagi; ATAU
//   (b) mengosongkan qty → tidak ada event sama sekali.
// Tidak ada jalur "ubah event yang sudah ada": RPC tidak punya operasi
// koreksi/reversal, dan `receiving_events.reversal_of` belum punya RPC.
//
// Yang diuji:
//   R1  "Tentukan nanti" tersimpan sebagai retur_status NONE / retur_qty 0
//       → TIDAK punya saldo retur (modal retur menolak menawarkannya).
//   R2  Membuka form lagi dan memilih "Kembalikan ke supplier" dengan qty
//       yang SAMA TIDAK mengoreksi event lama — ia membuat event KEDUA
//       (id berbeda) dan menambah DATANG.
//   R3  Aplikasi sendiri menyebut koreksi belum didukung
//       (CORRECTION_UNSUPPORTED) untuk payload dengan id yang sama.
//   R4  Tidak ada RPC koreksi/reversal di paket skema (dibuktikan dari
//       katalog fungsi), jadi "perbaiki di form Terima Barang" mustahil.
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const SB = process.env.SB || '/tmp/receipt-ledger-app-t7bc'
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const { buildRows, emptyEntry, RETUR_SUPPLIER } =
  await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptLogic.mjs')).href)
const { buildEventDrafts, returPlan } =
  await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptEventLogic.mjs')).href)

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${typeof params[k] === 'object' && params[k] !== null ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (typeof params[k] === 'object' && params[k] !== null) ? JSON.stringify(params[k]) : params[k])
  return (await client.query(`select ${fn}(${args}) as out`, vals)).rows[0].out
}

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// Nota beli langsung (tanpa PR) supaya yang diuji adalah perilaku EVENT,
// bukan batas qty pesanan PR.
const rec = (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,project_id,note)
  values ($1,'INV-DEAD-1',current_date,'NORMAL',$2,'[Tahap: DIBELI]') returning id`, [vend, prj]))[0].id
const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
  values ($1,null,'Keramik 60x60','Dus',10,'[Harga: 90000]') returning id`, [rec]))[0].id
const itemNow = async () => (await q(
  `select id, pr_item_id, item_name, unit, quantity_received, qty_arrived from receiving_items where id=$1`, [ri]))[0]

console.log('\n=== R1. Barang rusak dicatat dengan pilihan default "Tentukan nanti" ===')
{
  const row = buildRows([await itemNow()], () => null)[0]
  const entry = { ...emptyEntry(), datang: '2', rusak: '2' }   // retur dibiarkan NANTI
  const draft = buildEventDrafts([row], { [ri]: entry }, { receivingId: rec })[0]
  const res = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: [draft], p_meta: {} })
  check('R1a event tersimpan', res?.ok === true && res.applied === 1, JSON.stringify(res))
  const ev = (await q(`select id, client_event_id, qty_rusak, retur_status, retur_qty
      from receiving_events where receiving_item_id=$1`, [ri]))[0]
  check('R1b retur_status NONE / retur_qty 0 → tanpa saldo retur',
    ev.retur_status === 'NONE' && Number(ev.retur_qty) === 0, JSON.stringify(ev))
  check('R1c qty_rusak 2 tetap tercatat (fakta fisik tidak hilang)', Number(ev.qty_rusak) === 2, String(ev.qty_rusak))
  const plan = returPlan([{ ...ev, item_name: 'Keramik 60x60', unit: 'Dus' }], {})
  check('R1d modal retur TIDAK menawarkan baris ini (0 baris, dilaporkan blocked)',
    plan.lines.length === 0 && plan.blocked.length === 1, JSON.stringify(plan.blocked))
}

console.log('\n=== R2. Mengikuti instruksi lama: buka Terima Barang lagi & pilih retur ===')
{
  // Form dibuka ulang: qty_arrived sekarang 2, jadi prevCum = 2.
  const row = buildRows([await itemNow()], () => null)[0]
  check('R2a form melihat "sudah datang 2" (prevCum = qty_arrived)', row.prevCum === 2, String(row.prevCum))
  // Admin mengetik qty datang yang SAMA (2) seperti instruksi, + pilihan retur.
  const entry = { ...emptyEntry(), datang: '2', rusak: '2', retur: RETUR_SUPPLIER }
  const draft = buildEventDrafts([row], { [ri]: entry }, { receivingId: rec })[0]
  const oldEv = (await q(`select client_event_id from receiving_events where receiving_item_id=$1`, [ri]))[0]
  check('R2b id BERBEDA dari event lama (bukan koreksi — jadi event baru)',
    draft.client_event_id !== oldEv.client_event_id,
    `${draft.client_event_id} vs ${oldEv.client_event_id}`)
  const res = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: [draft], p_meta: {} })
  check('R2c RPC MENERIMA sebagai kedatangan kedua (applied=1)', res?.ok === true && res.applied === 1, JSON.stringify(res))
  const after = await itemNow()
  check('R2d DATANG bertambah 2→4 padahal barang tidak datang lagi (angka tidak benar)',
    Number(after.qty_arrived) === 4, String(after.qty_arrived))
  const evs = await q(`select retur_status, retur_qty, qty_datang from receiving_events
      where receiving_item_id=$1 order by created_at`, [ri])
  check('R2e event LAMA tetap NONE (tidak terkoreksi)', evs[0].retur_status === 'NONE', JSON.stringify(evs[0]))
  check('R2f event BARU membawa PENDING (keputusan retur menempel di kedatangan palsu)',
    evs[1].retur_status === 'PENDING' && Number(evs[1].retur_qty) === 2, JSON.stringify(evs[1]))
}

console.log('\n=== R3. Kalau qty diisi sama dan id-nya sama, aplikasi MENOLAK (bukan koreksi) ===')
{
  // Bentuk payload yang benar-benar "koreksi": id lama, isi berbeda.
  const oldEv = (await q(`select id, client_event_id, qty_datang, qty_rusak from receiving_events
      where receiving_item_id=$1 order by created_at limit 1`, [ri]))[0]
  const res = await rpc('receipt_apply_events', {
    p_receiving_id: rec,
    p_events: [{
      client_event_id: oldEv.client_event_id, receiving_item_id: ri, pr_item_id: null,
      item_name: 'Keramik 60x60', unit: 'Dus', qty_datang: 2, qty_rusak: 2,
      tujuan_ws: 0, tujuan_tukang: 0, penerima_tukang: null,
      retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false, foto_ref: null
    }],
    p_meta: {}
  })
  check('R3a RPC menjawab already_applied (perubahan DIABAIKAN)', res?.ok === true && res.applied === 0 && res.already_applied === 1, JSON.stringify(res))
  const still = (await q(`select retur_status, retur_qty from receiving_events where id=$1`, [oldEv.id]))[0]
  check('R3b event lama TETAP NONE (koreksi tidak tersimpan)', still.retur_status === 'NONE', JSON.stringify(still))
}

console.log('\n=== R4. Tidak ada RPC koreksi/reversal di paket skema ===')
{
  const fns = (await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname ilike '%receipt%' or p.proname ilike '%reversal%'
        or p.proname ilike '%correct%' or p.proname ilike '%void%' or p.proname ilike '%retur%')
      order by 1`)).map(r => r.proname)
  check('R4a fungsi terkait penerimaan/retur yang ADA', fns.length > 0, JSON.stringify(fns))
  check('R4b TIDAK ada fungsi koreksi/reversal penerimaan',
    !fns.some(n => /reversal|correct|void|amend/i.test(n)), JSON.stringify(fns))
  const col = (await q(`select 1 from information_schema.columns
      where table_schema='public' and table_name='receiving_events' and column_name='reversal_of'`))
  check('R4c kolom reversal_of ADA tetapi tanpa RPC penulisnya (fitur belum ada)',
    col.length === 1 && !fns.some(n => /reversal/i.test(n)), `reversal_of=${col.length}`)
}

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
await client.end()
process.exit(fail ? 1 : 0)
