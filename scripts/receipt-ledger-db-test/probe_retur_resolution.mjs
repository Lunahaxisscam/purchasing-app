// ============================================================
// PROBE (review run 195) — AKSI RETUR yang DITAWARKAN modal harus SELALU
// diterima RPC, dan tidak boleh mengubah arti "sudah dibuang".
// ============================================================
// Ditemukan: modal retur menampilkan 4 tindakan (RETURN/REPLACE/REFUND/DISCARD)
// untuk SEMUA baris, tanpa melihat `retur_status` / `discard_confirmed` event.
//   - event PENDING  + tindakan DISCARD → PASTI ditolak (`discard_not_confirmed`)
//   - event DISCARDED + tindakan RETURN → diterima, status berubah jadi PENDING
//     (barang yang sudah dibuang "kembali" menunggu dikembalikan)
//
// Perbaikan: `returPlan()` mengembalikan `allowed_resolutions` per baris dan
// `commonResolutions()` mengirisnya untuk baris terpilih. Skrip ini mengunci
// kontrak itu terhadap RPC SUNGGUHAN: untuk setiap kombinasi status × tindakan,
// hasilnya harus konsisten dengan yang ditawarkan aplikasi.
//
//   PGURL=postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc \
//   SB=/tmp/receipt-ledger-app-t7bc \
//   node scripts/receipt-ledger-db-test/probe_retur_resolution.mjs
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

const SB = process.env.SB || '/tmp/receipt-ledger-app-t7bc'
const logic = await import(pathToFileURL(path.join(SB, 'dist', 'modules', 'receivings', 'receiptEventLogic.mjs')).href)
const rlogic = await import(pathToFileURL(path.join(SB, 'dist', 'modules', 'receivings', 'receiptLogic.mjs')).href)

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${(params[k] !== null && typeof params[k] === 'object') ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (params[k] !== null && typeof params[k] === 'object') ? JSON.stringify(params[k]) : params[k])
  const { rows } = await client.query(`select ${fn}(${args}) as out`, vals)
  return rows[0]?.out
}

let pass = 0
const fails = []
function cek(nama, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ✓ ${nama}${detail ? ' — ' + detail : ''}`) }
  else { fails.push(`${nama}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${nama}${detail ? ' — ' + detail : ''}`) }
}

const prj = (await q(`select id from projects limit 1`))[0].id
const vend = (await q(`select id from vendors limit 1`))[0].id
const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
                     values ('PR-T7BC-RES','Uji resolusi retur','APPROVED',$1) returning id`, [prj]))[0].id

let seq = 0
async function kasus(nama, entryPatch) {
  seq += 1
  const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
                       values ($1,$2,5,'Lembar','APPROVED',$3) returning id`, [pr, `Item ${nama}`, vend]))[0].id
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,delivery_note,received_date,status,purchase_request_id,project_id,note)
                        values ($1,$2,$3,current_date,'NORMAL',$4,$5,'[Tahap: DIBELI]') returning id`,
    [vend, `INV-RS-${seq}`, `Nota RS ${seq}`, pr, prj]))[0].id
  const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
                       values ($1,$2,$3,'Lembar',5,'[Harga: 100000]') returning id`, [rec, pi, `Item ${nama}`]))[0].id
  const rows = rlogic.buildRows([{ id: ri, pr_item_id: pi, item_name: `Item ${nama}`, unit: 'Lembar', quantity_received: 5 }], () => 5)
  const entry = { ...rlogic.emptyEntry(), datang: '5', rusak: '2', ...entryPatch }
  const draft = logic.buildEventDrafts(rows, { [ri]: entry }, { receivingId: rec })[0]
  const apply = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: [{ ...draft, _computed: undefined }], p_meta: {} })
  if (apply?.ok !== true) throw new Error(`apply gagal ${nama}: ${JSON.stringify(apply)}`)
  const ev = (await q(`select * from receiving_events where receiving_id=$1`, [rec]))[0]
  const plan = logic.returPlan([{ ...ev, receiving_item_id: ri, pr_item_id: pi, item_name: `Item ${nama}`, unit: 'Lembar', qty_datang: 5 }], { alreadyReturned: {} })
  return { rec, ri, ev, line: plan.lines[0] }
}

async function coba(k, resolution) {
  return rpc('return_create', {
    p_receiving_id: k.rec,
    p_lines: [{ receiving_event_id: k.ev.id, qty: Number(k.line.qty) }],
    p_resolution: resolution,
    p_reason: 'uji resolusi'
  })
}

console.log('\n=== RESOLUSI RETUR: ditawarkan aplikasi vs diterima RPC (PG nyata) ===\n')

// ---------- A. Event PENDING (dipilih "Kembalikan ke supplier")
console.log('A. Event PENDING (menunggu dikembalikan)')
{
  const k = await kasus('PENDING', { retur: rlogic.RETUR_SUPPLIER })
  const allow = k.line.allowed_resolutions || []
  cek('A1 modal TIDAK menawarkan DISCARD', !allow.includes('DISCARD'), `allowed=[${allow.join(',')}]`)
  cek('A2 modal menawarkan RETURN', allow.includes('RETURN'))
  const rDiscard = await coba(k, 'DISCARD')
  cek('A3 bila DISCARD dipaksa, RPC menolak (alasan nyata, bukan crash)',
    rDiscard?.ok === false && rDiscard?.reason === 'discard_not_confirmed', `reason=${rDiscard?.reason}`)
  const rReturn = await coba(k, 'RETURN')
  cek('A4 tindakan yang DITAWARKAN (RETURN) diterima RPC', rReturn?.ok === true, rReturn?.ok ? 'ok' : rReturn?.reason)
}

// ---------- B. Event DISCARDED (dipilih "Dibuang")
console.log('\nB. Event DISCARDED (sudah dibuang)')
{
  const k = await kasus('DISCARDED', { retur: rlogic.RETUR_DIBUANG, konfirmasiBuang: true })
  const allow = k.line.allowed_resolutions || []
  cek('B1 modal HANYA menawarkan DISCARD', allow.length === 1 && allow[0] === 'DISCARD', `allowed=[${allow.join(',')}]`)
  cek('B2 modal TIDAK menawarkan RETURN', !allow.includes('RETURN'))
  const rDiscard = await coba(k, 'DISCARD')
  cek('B3 tindakan yang DITAWARKAN (DISCARD) diterima RPC', rDiscard?.ok === true, rDiscard?.ok ? 'ok' : rDiscard?.reason)
  const status = (await q(`select retur_status from receiving_events where id=$1`, [k.ev.id]))[0]?.retur_status
  cek('B4 status event tetap DISCARDED (tidak berubah jadi PENDING)', status === 'DISCARDED', `status=${status}`)
}

// ---------- C. Campuran: barang dibuang + barang menunggu dikembalikan
console.log('\nC. Campuran dua status dalam satu pilihan')
{
  const a = await kasus('CAMPUR-PENDING', { retur: rlogic.RETUR_SUPPLIER })
  const b = await kasus('CAMPUR-DISCARD', { retur: rlogic.RETUR_DIBUANG, konfirmasiBuang: true })
  const common = logic.commonResolutions([a.line, b.line])
  cek('C1 tidak ada tindakan sah untuk gabungan (UI harus memisahkan)', common.length === 0, `common=[${common.join(',')}]`)
  const sameOnly = logic.commonResolutions([a.line])
  cek('C2 satu kelompok saja tetap punya tindakan', sameOnly.includes('RETURN'), `common=[${sameOnly.join(',')}]`)
}

// ---------- D. Regresi: alur normal masih penuh
console.log('\nD. Regresi alur normal')
{
  const k = await kasus('NORMAL', { retur: rlogic.RETUR_SUPPLIER })
  const allow = k.line.allowed_resolutions || []
  cek('D1 event PENDING menawarkan 3 tindakan non-discard', allow.length === 3, `allowed=[${allow.join(',')}]`)
  const r = await coba(k, 'REFUND')
  cek('D2 REFUND diterima RPC', r?.ok === true, r?.ok ? 'ok' : r?.reason)
}

// ---------- E. Data tidak konsisten: DISCARDED tapi discard_confirmed=false
// (mungkin terjadi pada data hasil backfill / perubahan manual). RPC menolak
// DISCARD untuk event seperti ini, jadi UI tidak boleh menawarkan apa pun.
console.log('\nE. Data tidak konsisten (DISCARDED tanpa konfirmasi)')
{
  const ev = { id: 'x', qty_rusak: 2, retur_qty: 2, retur_status: 'DISCARDED', discard_confirmed: false, item_name: 'X' }
  const allow = logic.allowedResolutionsFor(ev)
  cek('E1 tidak ada tindakan yang sah (UI melaporkan, bukan menawarkan)', allow.length === 0, `allowed=[${allow.join(',')}]`)
  const evOk = { ...ev, discard_confirmed: true }
  cek('E2 setelah konfirmasi dicatat, DISCARD tersedia', logic.allowedResolutionsFor(evOk).join(',') === 'DISCARD')
}


console.log(`\n=== HASIL: ${pass} PASS / ${fails.length} FAIL ===`)
if (fails.length) { for (const f of fails) console.log(`  FAIL: ${f}`) }
await client.end()
process.exit(fails.length ? 1 : 0)
