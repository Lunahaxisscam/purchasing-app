// ============================================================
// PROBE (review run 190) — MATRIKS: apakah "Retur tanpa ketik ulang"
// bisa diselesaikan dari UI sampai RPC?
// ============================================================
// Yang diuji: untuk SETIAP pilihan penanganan barang rusak di form Terima
// Barang (NANTI / SUPPLIER / DIBUANG), apakah baris muncul di modal retur
// (logika aplikasi VERBATIM `returLinesFromEvents`) DAN apakah RPC
// `return_create` menerima qty yang ditawarkan itu?
//
// Ini rantai lengkap penyederhanaan #4 (retur dari item rusak tanpa ketik
// ulang) — bukan sekadar unit test satu fungsi.
//
//   PGURL=postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc \
//   node scripts/receipt-ledger-db-test/probe_retur_matrix.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

const logic = await import(pathToFileURL(path.join('/tmp/receipt-ledger-app', 'dist', 'modules', 'receivings', 'receiptEventLogic.mjs')).href)
const rlogic = await import(pathToFileURL(path.join('/tmp/receipt-ledger-app', 'dist', 'modules', 'receivings', 'receiptLogic.mjs')).href)

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => {
    const v = params[k]
    return `${k} => $${i + 1}${(v !== null && typeof v === 'object') ? '::jsonb' : ''}`
  }).join(', ')
  const vals = keys.map(k => (params[k] !== null && typeof params[k] === 'object') ? JSON.stringify(params[k]) : params[k])
  const { rows } = await client.query(`select ${fn}(${args}) as out`, vals)
  return rows[0]?.out
}

const prj = (await q(`select id from projects limit 1`))[0].id
const vend = (await q(`select id from vendors limit 1`))[0].id
const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
                     values ('PR-T7BC-MATRIX','Uji matriks retur','APPROVED',$1) returning id`, [prj]))[0].id

let seq = 0
// Satu "kasus" = 1 PR item + 1 nota + 1 baris + 1 event, supaya tidak
// bertabrakan dengan guard over-receipt lintas nota milik RPC.
async function kasus({ nama, entryPatch, sudahRetur = 0, returQtyOverride = null }) {
  seq += 1
  const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
                       values ($1,$2,5,'Lembar','APPROVED',$3) returning id`, [pr, `Item ${nama}`, vend]))[0].id
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,delivery_note,received_date,status,purchase_request_id,project_id,note)
                        values ($1,$2,$3,current_date,'NORMAL',$4,$5,'[Tahap: DIBELI]') returning id`,
    [vend, `INV-MX-${seq}`, `Nota MX ${seq}`, pr, prj]))[0].id
  const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
                       values ($1,$2,$3,'Lembar',5,'[Harga: 100000]') returning id`, [rec, pi, `Item ${nama}`]))[0].id

  const rows = rlogic.buildRows([{ id: ri, pr_item_id: pi, item_name: `Item ${nama}`, unit: 'Lembar', quantity_received: 5 }], () => 5)
  const entry = { ...rlogic.emptyEntry(), datang: '5', rusak: '2', ...entryPatch }
  const draft = logic.buildEventDrafts(rows, { [ri]: entry }, { receivingId: rec })[0]
  if (returQtyOverride !== null) draft.retur_qty = returQtyOverride
  const apply = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: [{ ...draft, _computed: undefined }], p_meta: {} })
  if (apply?.ok !== true) throw new Error(`apply gagal untuk ${nama}: ${JSON.stringify(apply)}`)

  const ev = (await q(`select id, qty_rusak, retur_status, retur_qty from receiving_events where receiving_id=$1`, [rec]))[0]

  // Riwayat retur (return_lines) — kalau ada, itulah yang dibaca modal.
  const alreadyReturned = {}
  if (sudahRetur > 0) {
    const rc = (await q(`insert into return_cases (receiving_id,vendor_id,status,resolution) values ($1,$2,'PENDING_SUPPLIER','RETURN') returning id`, [rec, vend]))[0].id
    await q(`insert into return_lines (return_case_id,receiving_event_id,receiving_item_id,pr_item_id,qty) values ($1,$2,$3,$4,$5)`,
      [rc, ev.id, ri, pi, sudahRetur])
    alreadyReturned[ev.id] = sudahRetur
  }

  const plan = logic.returPlan(
    [{ ...ev, receiving_item_id: ri, pr_item_id: pi, item_name: `Item ${nama}`, unit: 'Lembar', qty_datang: 5 }],
    { alreadyReturned }
  )
  const offered = plan.lines

  let rpcResult = null
  if (offered.length) {
    rpcResult = await rpc('return_create', {
      p_receiving_id: rec,
      p_lines: offered.map(o => ({ receiving_event_id: o.receiving_event_id, qty: Number(o.qty) })),
      p_resolution: 'RETURN', p_reason: 'uji matriks'
    })
  }
  return { ev, offered, blocked: plan.blocked, rpcResult }
}

console.log('\n=== MATRIKS RETUR: pilihan di form Terima Barang → modal → RPC ===\n')
const hasil = []

// 1. Default "Tentukan nanti" — TIDAK ditawarkan (jujur), tapi dilaporkan.
{
  const r = await kasus({ nama: 'NANTI', entryPatch: {} })
  hasil.push({ label: 'NANTI (default)', event: `retur_qty=${r.ev.retur_qty}`, offered: r.offered.map(o => o.qty), blocked: r.blocked.length, rpc: r.rpcResult?.ok ? 'OK' : (r.offered.length ? r.rpcResult?.reason : 'tidak ditawarkan') })
}
// 2. Kembalikan ke supplier
{
  const r = await kasus({ nama: 'SUPPLIER', entryPatch: { retur: rlogic.RETUR_SUPPLIER } })
  hasil.push({ label: 'SUPPLIER', event: `retur_qty=${r.ev.retur_qty}`, offered: r.offered.map(o => o.qty), blocked: r.blocked.length, rpc: r.rpcResult?.ok ? 'OK' : (r.offered.length ? r.rpcResult?.reason : 'tidak ditawarkan') })
}
// 3. Dibuang
{
  const r = await kasus({ nama: 'DIBUANG', entryPatch: { retur: rlogic.RETUR_DIBUANG, konfirmasiBuang: true } })
  hasil.push({ label: 'DIBUANG', event: `retur_qty=${r.ev.retur_qty}`, offered: r.offered.map(o => o.qty), blocked: r.blocked.length, rpc: r.rpcResult?.ok ? 'OK' : (r.offered.length ? r.rpcResult?.reason : 'tidak ditawarkan') })
}
// 4. SUPPLIER + sudah diretur sebagian (1 dari 2)
{
  const r = await kasus({ nama: 'SUPPLIER-SEBAGIAN', entryPatch: { retur: rlogic.RETUR_SUPPLIER }, sudahRetur: 1 })
  hasil.push({ label: 'SUPPLIER + sudah retur 1', event: `retur_qty=${r.ev.retur_qty}`, offered: r.offered.map(o => o.qty), blocked: r.blocked.length, rpc: r.rpcResult?.ok ? 'OK' : (r.offered.length ? r.rpcResult?.reason : 'tidak ditawarkan') })
}
// 5. retur_qty < qty_rusak (kontrak mengizinkan; RPC memakai retur_qty)
{
  const r = await kasus({ nama: 'SALDO-KECIL', entryPatch: { retur: rlogic.RETUR_SUPPLIER }, returQtyOverride: 1 })
  hasil.push({ label: 'retur_qty=1 < rusak=2', event: `retur_qty=${r.ev.retur_qty}`, offered: r.offered.map(o => o.qty), blocked: r.blocked.length, rpc: r.rpcResult?.ok ? 'OK' : (r.offered.length ? r.rpcResult?.reason : 'tidak ditawarkan') })
}

console.log('  ' + 'Pilihan'.padEnd(24) + 'Event'.padEnd(16) + 'Ditawarkan'.padEnd(14) + 'Blocked'.padEnd(9) + 'RPC')
for (const h of hasil) {
  console.log('  ' + String(h.label).padEnd(24) + String(h.event).padEnd(16) + String(JSON.stringify(h.offered)).padEnd(14) + String(h.blocked).padEnd(9) + String(h.rpc))
}

console.log('\n=== KESIMPULAN ===')
// Aturan yang harus berlaku: setiap baris yang DITAWARKAN harus DITERIMA RPC.
const ditawarkan = hasil.filter(h => h.offered.length > 0)
const ditolak = ditawarkan.filter(h => h.rpc !== 'OK')
console.log(`  baris ditawarkan → diterima RPC: ${ditawarkan.length - ditolak.length}/${ditawarkan.length}`)
for (const h of ditolak) console.log(`  ✗ ${h.label}: ditawarkan=${JSON.stringify(h.offered)} → RPC ${h.rpc}`)
const nanti = hasil.find(h => h.label.startsWith('NANTI'))
console.log(`  "Tentukan nanti" dilaporkan sebagai belum bisa diretur: ${nanti?.blocked === 1 ? 'YA' : 'TIDAK'}`)

await client.end()
process.exit(ditolak.length === 0 && nanti?.blocked === 1 ? 0 : 1)
