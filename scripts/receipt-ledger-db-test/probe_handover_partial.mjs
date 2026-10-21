// ============================================================
// probe_handover_partial.mjs — serah terima sebagian & baris dilewati (run 202)
// ============================================================
// Pertanyaan yang diuji pada PostgreSQL NYATA (migrasi 00..04) + modul
// aplikasi VERBATIM:
//
//   H1  RPC mengunci SATU dokumen (`diserahkan_at`). Setelah dokumen
//       disimpan, baris yang belum diserahkan TIDAK bisa ditambahkan ke
//       dokumen itu (panggilan kedua → already=true, nol tulisan).
//   H2  APLIKASI (setelah perbaikan run 202) mengizinkan baris DIKOSONGKAN =
//       dilewati, bukan error. Bukti: satu baris kosong tidak memblokir
//       submit; hanya baris yang benar-benar diterima yang dikirim ke RPC.
//       Sebelum perbaikan, qty 0 = error untuk SELURUH form → barang yang
//       sudah diterima tidak bisa dicatat, dan admin terdorong mengisi angka
//       palsu supaya bisa menyimpan.
//   H3  Sisa yang dilewati BISA dicatat lewat dokumen Serah Terima KEDUA
//       untuk penerimaan yang sama (kuota dihitung per event lintas dokumen).
//       Inilah jalan keluar yang harus disebut UI — bukan dibiarkan buntu.
//
// Setiap bagian memakai PENERIMAAN SENDIRI supaya kuota tukang bersih dan
// hasil satu bagian tidak mengubah arti bagian lain.
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

const ELOGIC = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptEventLogic.mjs')).href)

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${typeof params[k] === 'object' && params[k] !== null ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (typeof params[k] === 'object' && params[k] !== null) ? JSON.stringify(params[k]) : params[k])
  return (await client.query(`select ${fn}(${args}) as out`, vals)).rows[0].out
}
// RPC yang RAISE (bukan return ok:false) harus ditangkap supaya probe tidak
// berhenti di tengah dan menyembunyikan sisa hasil.
async function rpcSafe(fn, params) {
  try { return await rpc(fn, params) } catch (e) { return { thrown: e.message, code: e.code } }
}

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

let seq = 0
// Fixture bersih: 1 PR + 1 nota + 3 barang dialokasikan ke tukang, event
// kedatangan dibuat lewat RPC (bukan INSERT langsung) supaya jalur nyata.
async function fixture() {
  seq += 1
  const tag = `HO-${seq}`
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,$2,'APPROVED',$3) returning id`, [`PR-${tag}`, `uji serah terima ${tag}`, prj]))[0].id
  const mk = async (name, qty) => (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,$2,$3,'Pcs','APPROVED',$4) returning id`, [pr, name, qty, vend]))[0].id
  const defs = [['Semen', 5], ['Pasir', 4], ['Besi', 3]]
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
  const events = await q(`select id, receiving_item_id, item_name, unit, tujuan_tukang
      from receiving_events where receiving_id=$1`, [rec])
  const evId = (name) => events.find(e => e.item_name === name).id
  const prefill = ELOGIC.handoverLinesFromEvents(events.map(e => ({ ...e, qty_rusak: 0, retur_qty: 0 })), {})
  const mkHo = async () => (await q(`insert into handovers (receiving_id,project_id,received_by,handover_date,status)
    values ($1,$2,'Pak Joko',current_date,'DRAFT') returning id`, [rec, prj]))[0].id
  return { tag, rec, items, events, evId, prefill, mkHo }
}

// ---------------------------------------------------------------------------
console.log('\n=== H1. RPC mengunci SATU dokumen (batas skema, bukan bug UI) ===')
{
  const f = await fixture()
  check('H1a prefill = alokasi penuh (Semen 5, Pasir 4, Besi 3)',
    f.prefill.length === 3 && f.prefill.find(p => p.item_name === 'Semen')?.qty_diserahkan === 5,
    JSON.stringify(f.prefill.map(p => [p.item_name, p.qty_diserahkan])))

  const ho1 = await f.mkHo()
  const lines = [
    { receiving_event_id: f.evId('Semen'), item_name: 'Semen', satuan: 'Pcs', qty_alokasi: 5, qty_sudah_diserahkan: 0, qty_diserahkan: 2, penerima: 'Pak Joko' },
    { receiving_event_id: f.evId('Pasir'), item_name: 'Pasir', satuan: 'Pcs', qty_alokasi: 4, qty_sudah_diserahkan: 0, qty_diserahkan: 4, penerima: 'Pak Joko' },
    { receiving_event_id: f.evId('Besi'), item_name: 'Besi', satuan: 'Pcs', qty_alokasi: 3, qty_sudah_diserahkan: 0, qty_diserahkan: 3, penerima: 'Pak Joko' }
  ]
  const v = ELOGIC.validateHandoverLines(lines, f.prefill)
  check('H1b aplikasi menerima qty 2 < sisa 5 dan MELAPORKAN sisa 3',
    v.ok === true && v.skipped.length === 1 && v.remainder === 3,
    JSON.stringify({ errors: v.errors, skipped: v.skipped }))
  const s1 = await rpc('handover_confirm', { p_handover_id: ho1, p_lines: v.lines })
  check('H1c RPC menyimpan dan mengunci dokumen', s1?.ok === true && s1.already === false, JSON.stringify(s1))
  const st1 = (await q(`select h.status, h.diserahkan_at is not null as delivered,
      coalesce((select sum(hi.qty_diserahkan) from handover_items hi where hi.handover_id=h.id),0) as diserahkan
    from handovers h where h.id=$1`, [ho1]))[0]
  check('H1d dokumen CONFIRMED walau baru 9 dari 12 unit diserahkan',
    st1.status === 'CONFIRMED' && st1.delivered === true && Number(st1.diserahkan) === 9, JSON.stringify(st1))

  // Sisa Semen 3 → coba tambahkan ke dokumen yang SAMA.
  const prefill2 = ELOGIC.handoverLinesFromEvents(
    f.events.map(e => ({ ...e, qty_rusak: 0, retur_qty: 0 })), { [f.evId('Semen')]: 2 })
  const v2 = ELOGIC.validateHandoverLines(
    [{ receiving_event_id: f.evId('Semen'), item_name: 'Semen', satuan: 'Pcs', qty_alokasi: 5, qty_sudah_diserahkan: 2, qty_diserahkan: 3, penerima: 'Pak Joko' }],
    prefill2)
  check('H1e aplikasi masih menawarkan sisa 3 (prefill = 5 − 2)',
    v2.ok === true && v2.lines[0].qty_diserahkan === 3, JSON.stringify(v2.errors))
  const s2 = await rpc('handover_confirm', { p_handover_id: ho1, p_lines: v2.lines })
  check('H1f RPC menolak dengan already=true → sisa 3 TIDAK bisa masuk dokumen ini',
    s2?.already === true && s2.inserted === 0, JSON.stringify(s2))
  const st2 = (await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items
      where handover_id=$1 and receiving_event_id=$2`, [ho1, f.evId('Semen')]))[0]
  check('H1g baris Semen tetap 2 di dokumen ini', Number(st2.n) === 2, JSON.stringify(st2))
}

// ---------------------------------------------------------------------------
console.log('\n=== H2. APLIKASI: baris kosong = DILEWATI (perbaikan run 202) ===')
{
  const f = await fixture()
  // Admin hanya menerima Semen 2 dan Pasir 4 hari ini; Besi BELUM tiba.
  const lines = [
    { receiving_event_id: f.evId('Semen'), item_name: 'Semen', satuan: 'Pcs', qty_alokasi: 5, qty_sudah_diserahkan: 0, qty_diserahkan: '2', penerima: 'Pak Joko' },
    { receiving_event_id: f.evId('Pasir'), item_name: 'Pasir', satuan: 'Pcs', qty_alokasi: 4, qty_sudah_diserahkan: 0, qty_diserahkan: '4', penerima: 'Pak Joko' },
    { receiving_event_id: f.evId('Besi'), item_name: 'Besi', satuan: 'Pcs', qty_alokasi: 3, qty_sudah_diserahkan: 0, qty_diserahkan: '', penerima: 'Pak Joko' }
  ]
  const v = ELOGIC.validateHandoverLines(lines, f.prefill)
  check('H2a satu baris kosong TIDAK memblokir submit (dulu: error seluruh form)',
    v.ok === true, JSON.stringify(v.errors))
  check('H2b hanya 2 baris dikirim ke RPC (Besi tidak ikut)', v.lines.length === 2, String(v.lines.length))
  check('H2c Besi dilaporkan sisa 3 (dilewati) & Semen sisa 3 (sebagian)',
    v.skipped.length === 2 &&
    v.skipped.some(s => s.item_name === 'Besi' && s.qty_sisa === 3 && !s.partial) &&
    v.skipped.some(s => s.item_name === 'Semen' && s.qty_sisa === 3 && s.partial),
    JSON.stringify(v.skipped))
  check('H2d total sisa dilaporkan = 6 unit', v.remainder === 6, String(v.remainder))

  // Semua baris kosong → tetap ditolak (tidak ada yang diserahkan).
  const vEmpty = ELOGIC.validateHandoverLines(lines.map(l => ({ ...l, qty_diserahkan: '' })), f.prefill)
  check('H2e semua baris kosong tetap DITOLAK (tidak ada yang diserahkan)',
    vEmpty.ok === false && /minimal satu/i.test(vEmpty.errors[0] || ''), JSON.stringify(vEmpty.errors))

  // Angka yang tidak sah tetap ditolak (bukan diperlakukan sebagai "lewat").
  const vBad = ELOGIC.validateHandoverLines([{ ...lines[0], qty_diserahkan: 'abc' }], f.prefill)
  check('H2f qty bukan angka tetap DITOLAK (bukan dilewati diam-diam)',
    vBad.ok === false && /harus angka/i.test(vBad.errors[0] || ''), JSON.stringify(vBad.errors))

  // Melebihi sisa tetap ditolak.
  const vOver = ELOGIC.validateHandoverLines([{ ...lines[0], qty_diserahkan: '9' }], f.prefill)
  check('H2g melebihi sisa alokasi tetap DITOLAK',
    vOver.ok === false && /melebihi sisa/i.test(vOver.errors[0] || ''), JSON.stringify(vOver.errors))

  const ho = await f.mkHo()
  const s = await rpc('handover_confirm', { p_handover_id: ho, p_lines: v.lines })
  check('H2h RPC menerima 2 baris yang benar-benar diterima', s?.ok === true && s.inserted === 2, JSON.stringify(s))
  const st = (await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items where handover_id=$1`, [ho]))[0]
  check('H2i hanya 6 unit tercatat (2+4) — angka palsu tidak masuk', Number(st.n) === 6, JSON.stringify(st))

  // ---- H3 (fixture yang sama): sisa dicatat lewat dokumen KEDUA ----
  console.log('\n=== H3. Sisa dicatat lewat dokumen Serah Terima KEDUA (jalan keluar) ===')
  const ho2 = await f.mkHo()
  const s3 = await rpc('handover_confirm', {
    p_handover_id: ho2,
    p_lines: [
      { receiving_event_id: f.evId('Semen'), qty_diserahkan: 3, penerima: 'Pak Joko' },
      { receiving_event_id: f.evId('Besi'), qty_diserahkan: 3, penerima: 'Pak Joko' }
    ]
  })
  check('H3a dokumen kedua diterima RPC untuk sisa 3 + 3', s3?.ok === true && s3.inserted === 2, JSON.stringify(s3))
  const tot = await q(`select receiving_event_id, coalesce(sum(qty_diserahkan),0) as n
      from handover_items where receiving_event_id = any($1::uuid[]) group by receiving_event_id`,
    [[f.evId('Semen'), f.evId('Besi')]])
  const byId = Object.fromEntries(tot.map(r => [r.receiving_event_id, Number(r.n)]))
  check('H3b total lintas dokumen = 5 (Semen) & 3 (Besi) — kuota per event, bukan per dokumen',
    byId[f.evId('Semen')] === 5 && byId[f.evId('Besi')] === 3, JSON.stringify(byId))

  // Kuota habis → dokumen ketiga TIDAK bisa menambah lagi (server menegakkan).
  const ho3 = await f.mkHo()
  const over = await rpcSafe('handover_confirm', {
    p_handover_id: ho3,
    p_lines: [{ receiving_event_id: f.evId('Semen'), qty_diserahkan: 1, penerima: 'Pak Joko' }]
  })
  check('H3c dokumen ketiga DITOLAK server setelah kuota habis (bukan diterima diam-diam)',
    over?.ok === false || !!over?.thrown || /Melebihi alokasi/i.test(String(over?.error || '')),
    JSON.stringify(over))
  const after = (await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items where receiving_event_id=$1`,
    [f.evId('Semen')]))[0]
  check('H3d total Semen tetap 5 (tidak ada kelebihan tercatat)', Number(after.n) === 5, JSON.stringify(after))
}

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
await client.end()
process.exit(fail ? 1 : 0)
