// ============================================================
// probe_run237_delete.mjs — jalur HAPUS pada PostgreSQL NYATA (run 237)
// ============================================================
// LENSA YANG BELUM PERNAH DIPAKAI (run 101..236):
//   Semua run sebelumnya menguji SIMPAN (form → RPC), TAMPIL (rincian terbaca),
//   dan KESIAPAN (capability 6 keadaan + kesegaran snapshot). Tidak satu pun
//   menguji apa yang terjadi bila admin menekan tombol 🗑️ Hapus — padahal
//   tombol itu ADA di layar yang sama, di setiap baris, TANPA syarat.
//
// Yang diuji di sini (READY: handover sudah punya baris `handover_items`):
//
//   D1  `delete from handovers where id=...` (persis yang dilakukan
//       pages/index.js deleteItem) MENGHAPUS baris rincian lewat
//       `on delete cascade` → bukti fisik serah terima HILANG PERMANEN.
//   D2  `receiving_items.qty_handed_over` (kolom turunan) TIDAK ikut
//       dikoreksi → angka "sudah diserahkan" jadi lebih besar dari rincian
//       yang tersisa (data saling bertentangan).
//   D3  `v_receipt_progress.belum_diserahkan` kembali ke alokasi penuh →
//       barang yang SUDAH diterima tukang tampil "belum diserahkan".
//   D4  kuota tukang TERBUKA LAGI: dokumen baru bisa menyerahkan barang yang
//       sama untuk kedua kalinya (dobel penyerahan fisik).
//   D5  `check_receipt_qty_consistency()` mendeteksi mismatch itu — jadi
//       database sendiri menganggapnya rusak.
//   D6  Hapus NOTA (receivings) yang punya handover terkonfirmasi: cascade
//       events → ditolak FK `handover_items.receiving_event_id on delete
//       restrict`. UI hanya menampilkan pesan mentah Postgres; tidak ada
//       jalan keluar yang ditawarkan.
//
// Fixture sintetis, PG16 terisolasi (bukan data produksi).
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const SB = process.env.SB || '/tmp/rev237-db'
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${typeof params[k] === 'object' && params[k] !== null ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (typeof params[k] === 'object' && params[k] !== null) ? JSON.stringify(params[k]) : params[k])
  return (await client.query(`select ${fn}(${args}) as out`, vals)).rows[0].out
}
async function sqlSafe(sql, p = []) {
  try { return { rows: (await client.query(sql, p)).rows } } catch (e) { return { error: e.message, code: e.code } }
}

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// ---------------------------------------------------------------- fixture
async function fixture(tag) {
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,$2,'APPROVED',$3) returning id`, [`PR-${tag}`, `uji hapus ${tag}`, prj]))[0].id
  const mk = async (name, qty) => (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,$2,$3,'Pcs','APPROVED',$4) returning id`, [pr, name, qty, vend]))[0].id
  const defs = [['Semen', 5], ['Pasir', 4]]
  const items = []
  for (const [name, qty] of defs) items.push({ name, qty, pi: await mk(name, qty) })
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,purchase_request_id,project_id,note)
    values ($1,$2,current_date,'NORMAL',$3,$4,'[Tahap: DIBELI]') returning id`, [vend, `INV-${tag}`, pr, prj]))[0].id
  for (const it of items) {
    it.ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
      values ($1,$2,$3,'Pcs',$4,'[Harga: 10000]') returning id`, [rec, it.pi, it.name, it.qty]))[0].id
  }
  const payload = items.map(it => ({
    client_event_id: `${tag}:${rec}:${it.ri}:0->${it.qty}`, receiving_item_id: it.ri, pr_item_id: it.pi,
    item_name: it.name, unit: 'Pcs', qty_datang: it.qty, qty_rusak: 0,
    tujuan_ws: 0, tujuan_tukang: it.qty, penerima_tukang: 'Pak Joko',
    retur_status: 'NONE', retur_qty: 0, discard_confirmed: false, foto_ref: null
  }))
  const applied = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: payload, p_meta: {} })
  if (applied?.ok !== true) throw new Error(`fixture ${tag} gagal: ${JSON.stringify(applied)}`)
  const events = await q(`select id, receiving_item_id, item_name, tujuan_tukang
      from receiving_events where receiving_id=$1`, [rec])
  const evId = (name) => events.find(e => e.item_name === name).id
  const riId = (name) => items.find(i => i.name === name).ri
  const mkHo = async () => (await q(`insert into handovers (receiving_id,project_id,received_by,handover_date,status)
    values ($1,$2,'Pak Joko',current_date,'DRAFT') returning id`, [rec, prj]))[0].id
  return { tag, pr, rec, items, events, evId, riId, mkHo }
}

const progressOf = async (recId) => q(
  `select receiving_item_id, qty_arrived, qty_handed_over, belum_diserahkan, tujuan_tukang
     from v_receipt_progress where receiving_id=$1 order by item_name`, [recId])
const handedCol = async (riId) => Number((await q(
  `select coalesce(qty_handed_over,0) as n from receiving_items where id=$1`, [riId]))[0].n)
const consistency = async () => q(`select check_name, violations from check_receipt_qty_consistency()`)

// ---------------------------------------------------------------------------
console.log('\n=== D0. Baseline READY: serah terima penuh tercatat ===')
const f = await fixture('DEL-1')
const ho1 = await f.mkHo()
const lines1 = [
  { receiving_event_id: f.evId('Semen'), qty_diserahkan: 5, penerima: 'Pak Joko' },
  { receiving_event_id: f.evId('Pasir'), qty_diserahkan: 4, penerima: 'Pak Joko' }
]
const c1 = await rpc('handover_confirm', { p_handover_id: ho1, p_lines: lines1 })
check('D0a dokumen terkonfirmasi dengan 2 baris rincian', c1?.ok === true && c1.inserted === 2, JSON.stringify(c1))
const hoItems0 = Number((await q(`select count(*) as n from handover_items where handover_id=$1`, [ho1]))[0].n)
check('D0b handover_items berisi 2 baris', hoItems0 === 2, String(hoItems0))
const col0 = await handedCol(f.riId('Semen'))
check('D0c receiving_items.qty_handed_over = 5 (kolom turunan tersinkron)', col0 === 5, String(col0))
const prog0 = await progressOf(f.rec)
const semen0 = prog0.find(r => r.receiving_item_id === f.riId('Semen'))
check('D0d view: belum_diserahkan Semen = 0 (sudah penuh)', Number(semen0.belum_diserahkan) === 0, JSON.stringify(semen0))

// ---------------------------------------------------------------------------
console.log('\n=== D1–D3. Admin menekan 🗑️ Hapus pada dokumen yang SUDAH diserahkan ===')
// Persis yang dilakukan pages/index.js deleteItem untuk page 'handovers':
//   supabase.from('handovers').delete().eq('id', item.id)
const del1 = await sqlSafe(`delete from handovers where id = $1`, [ho1])
check('D1a DELETE berhasil (tidak ada guard DB yang menolak)', Array.isArray(del1.rows), JSON.stringify(del1))
const hoItems1 = Number((await q(`select count(*) as n from handover_items where handover_id=$1`, [ho1]))[0].n)
check('D1b bukti fisik HILANG: handover_items 2 → 0 lewat ON DELETE CASCADE', hoItems1 === 0, String(hoItems1))
const hoRow = Number((await q(`select count(*) as n from handovers where id=$1`, [ho1]))[0].n)
check('D1c dokumen serah terima ikut hilang', hoRow === 0, String(hoRow))

const col1 = await handedCol(f.riId('Semen'))
check('D2a qty_handed_over MASIH 5 padahal rinciannya sudah 0 (data bertentangan)', col1 === 5, String(col1))
const prog1 = await progressOf(f.rec)
const semen1 = prog1.find(r => r.receiving_item_id === f.riId('Semen'))
check('D3a view: barang yang SUDAH diterima tampil belum_diserahkan = 5 (penuh)',
  Number(semen1.belum_diserahkan) === 5, JSON.stringify(semen1))

// ---------------------------------------------------------------------------
console.log('\n=== D4. Kuota tukang TERBUKA LAGI → penyerahan fisik kedua untuk barang yang sama ===')
const ho2 = await f.mkHo()
const c2 = await rpc('handover_confirm', {
  p_handover_id: ho2,
  p_lines: [{ receiving_event_id: f.evId('Semen'), qty_diserahkan: 5, penerima: 'Pak Joko' }]
})
check('D4a dokumen BARU diterima RPC untuk 5 unit yang sudah pernah diserahkan',
  c2?.ok === true && c2.inserted === 1, JSON.stringify(c2))
const totalSemen = Number((await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items
  where receiving_event_id=$1`, [f.evId('Semen')]))[0].n)
check('D4b total lintas dokumen tetap 5 → penyerahan ganda TIDAK terlihat di data',
  totalSemen === 5, String(totalSemen))

// ---------------------------------------------------------------------------
console.log('\n=== D5. Checker integritas database sendiri menandai kerusakannya ===')
const chk = await consistency()
const d2 = chk.find(r => r.check_name === 'qty_handed_over_mismatch')
check('D5a qty_handed_over_mismatch > 0 (DB menganggap data ini rusak)',
  Number(d2?.violations) > 0, JSON.stringify(chk))

// ---------------------------------------------------------------------------
console.log('\n=== D6. Hapus NOTA (Pembelian) yang punya serah terima terkonfirmasi ===')
const g = await fixture('DEL-2')
const hoG = await g.mkHo()
await rpc('handover_confirm', {
  p_handover_id: hoG,
  p_lines: [{ receiving_event_id: g.evId('Semen'), qty_diserahkan: 5, penerima: 'Pak Joko' }]
})
const delRec = await sqlSafe(`delete from receivings where id = $1`, [g.rec])
check('D6a DELETE nota DITOLAK (FK restrict handover_items → receiving_events)',
  !!delRec.error, JSON.stringify(delRec).slice(0, 300))
check('D6b pesan yang diterima admin = pesan mentah Postgres, bukan penjelasan',
  /foreign key constraint|violates/i.test(String(delRec.error || '')), String(delRec.error || '').slice(0, 200))
const recStill = Number((await q(`select count(*) as n from receivings where id=$1`, [g.rec]))[0].n)
check('D6c nota & seluruh datanya tetap utuh (tidak ada penghapusan separuh)', recStill === 1, String(recStill))

// ---------------------------------------------------------------------------
console.log('\n=== D7. Kontrol: hapus DRAFT (belum diserahkan) tetap wajar ===')
const h = await fixture('DEL-3')
const hoDraft = await h.mkHo()
const delDraft = await sqlSafe(`delete from handovers where id = $1`, [hoDraft])
check('D7a DRAFT tanpa rincian bisa dihapus (tidak ada yang hilang)', Array.isArray(delDraft.rows), JSON.stringify(delDraft))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
await client.end()
process.exit(fail ? 1 : 0)
