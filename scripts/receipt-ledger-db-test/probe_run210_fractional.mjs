// ============================================================
// probe_run210_fractional.mjs — QTY PECAHAN (m³ / kg / roll)
// ============================================================
// SEMUA run 184..208 menguji qty BULAT (10 / 6 / 2 / 5). Padahal keempat
// input form memakai `step="any" inputMode="decimal"`, jadi admin MEMANG
// boleh mengisi 3.5 m³ atau 12.75 kg. Tiga tempat berbeda memakai toleransi
// berbeda:
//
//   JS   receiptEventLogic: EPS = 1e-9            (float64)
//   DB   constraint + RPC : + 0.001              (numeric exact)
//   DB   checker          : > 0.001
//
// Toleransi 0.001 pada kolom `numeric` (eksak) berarti pembulatan seperseribu
// DITERIMA sebagai "tidak melebihi" — mis. baik 2.0005 diterima untuk
// kedatangan 2.000. Pada qty pecahan yang halus (0.25 m³) itu 0.4% dari
// barang. Probe ini mengukur apakah perbedaan toleransi itu bisa membuat
// aplikasi MENERIMA isian yang sebenarnya melebihi barang baik, atau
// MENOLAK isian yang sah.
//
// Jalankan: node scripts/receipt-ledger-db-test/probe_run210_fractional.mjs
//   PGURL=... SB=/tmp/<sandbox>
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))

const SB = process.env.SB || '/tmp/receipt-ledger-app-t7bc'
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const ELOGIC = await import(path.join(SB, 'dist/modules/receivings/receiptEventLogic.mjs'))

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows
async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${typeof params[k] === 'object' && params[k] !== null ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (typeof params[k] === 'object' && params[k] !== null) ? JSON.stringify(params[k]) : params[k])
  const { rows } = await client.query(`select ${fn}(${args}) as out`, vals)
  return rows[0]?.out
}

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id
let seq = 0
async function makeNota(bought) {
  seq++
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,'uji pecahan','APPROVED',$2) returning id`, [`PR-FRAC-${seq}`, prj]))[0].id
  const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,'Keramik 60x60','${bought}','m2','APPROVED',$2) returning id`, [pr, vend]))[0].id
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,delivery_note,received_date,status,purchase_request_id,project_id,note)
    values ($1,$2,'x',current_date,'NORMAL',$3,$4,'[Tahap: DIBELI]') returning id`,
    [vend, `INV-FRAC-${seq}`, pr, prj]))[0].id
  const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
    values ($1,$2,'Keramik 60x60','m2',${bought},'[Harga: 90000]') returning id`, [rec, pi]))[0].id
  return { pr, pi, rec, ri }
}

// ---------------------------------------------------------------
console.log('\n=== F1. Qty pecahan sah: 3.5 m2 dibagi 1.25 gudang + 2.25 tukang ===\n')
{
  const n = await makeNota('3.5')
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 3.5, boughtKnown: true, notBought: false, ordered: 3.5, basis: 3.5, sisa: 3.5 }],
    { [n.ri]: { datang: '3.5', rusak: '0', ws: '1.25', tukang: '2.25', penerima: 'Pak Joko', retur: 'NANTI', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  const v = ELOGIC.validateForm(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 3.5, boughtKnown: true, notBought: false, ordered: 3.5, basis: 3.5, sisa: 3.5 }],
    { [n.ri]: { datang: '3.5', rusak: '0', ws: '1.25', tukang: '2.25', penerima: 'Pak Joko', retur: 'NANTI', foto: null, konfirmasiBuang: false } }
  )
  check('F1a modul menerima isian pecahan (tidak ditolak di klien)', v.valid === true, JSON.stringify(v))
  const r = await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: ev, p_meta: {} })
  check('F1b RPC menerima qty pecahan yang sah', r?.ok === true && r?.applied === 1, JSON.stringify(r))
  const row = (await q('select qty_datang, qty_rusak, tujuan_ws, tujuan_tukang from receiving_events where receiving_id=$1', [n.rec]))[0]
  check('F1c pecahan tersimpan UTUH (tidak dibulatkan)', row
    && Number(row.qty_datang) === 3.5 && Number(row.tujuan_ws) === 1.25 && Number(row.tujuan_tukang) === 2.25,
    JSON.stringify(row))
}

// ---------------------------------------------------------------
console.log('\n=== F2. Batas kedatangan pecahan: 2.5 dari BELI 2.5 (pas) ===\n')
{
  const n = await makeNota('2.5')
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 2.5, boughtKnown: true, notBought: false, ordered: 2.5, basis: 2.5, sisa: 2.5 }],
    { [n.ri]: { datang: '2.5', rusak: '0', ws: '2.5', tukang: '', penerima: '', retur: 'NANTI', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  const r = await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: ev.events || ev, p_meta: {} })
  check('F2a kedatangan PAS dengan qty beli pecahan diterima', r?.ok === true, JSON.stringify(r))
}

// ---------------------------------------------------------------
console.log('\n=== F3. Apakah toleransi 0.001 membocorkan kelebihan qty? ===\n')
{
  // BELI 2.000, datang 2.0005 → kelebihan 0.0005 (< 0.001). RPC memakai
  // `> v_pr_qty + 0.001` sehingga kelebihan ini LOLOS.
  const n = await makeNota('2.000')
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 2.000, boughtKnown: true, notBought: false, ordered: 2.000, basis: 2.000, sisa: 2.000 }],
    { [n.ri]: { datang: '2.0005', rusak: '0', ws: '2.0005', tukang: '', penerima: '', retur: 'NANTI', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  const clientBlocked = ev.ok !== true
  const r = clientBlocked ? null : await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: ev.events || ev, p_meta: {} })
  const stored = (await q('select coalesce(sum(qty_datang),0) as s from receiving_events where receiving_id=$1', [n.rec]))[0]
  // Yang penting: klien dan server SEPAKAT. Bila klien menerima tapi server
  // menolak (atau sebaliknya) admin melihat pesan yang membingungkan.
  const agree = clientBlocked ? (r === null || r?.ok === false) : (r?.ok === true)
  check('F3a klien & server SEPAKAT soal kelebihan 0.0005 (tidak ada jawaban bertentangan)',
    agree, `clientBlocked=${clientBlocked} server=${JSON.stringify(r)}`)
  console.log(`     (info: tersimpan ${stored?.s} untuk beli 2.000 — toleransi 0.001)`)
}

// ---------------------------------------------------------------
console.log('\n=== F4. Alokasi pecahan yang MELEBIHI barang baik harus ditolak ===\n')
{
  const n = await makeNota('5')
  // baik = 5 - 1.5 = 3.5 ; alokasi 2.25 + 1.5 = 3.75 → lebih 0.25
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 5, boughtKnown: true, notBought: false, ordered: 5, basis: 5, sisa: 5 }],
    { [n.ri]: { datang: '5', rusak: '1.5', ws: '2.25', tukang: '1.5', penerima: 'Pak Joko', retur: 'NANTI', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  const clientBlocked = ev.ok !== true
  const r = clientBlocked ? null : await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: ev.events || ev, p_meta: {} })
  const stored = (await q('select count(*)::int as c from receiving_events where receiving_id=$1', [n.rec]))[0]
  check('F4a alokasi pecahan melebihi barang baik DITOLAK (klien atau server, bukan keduanya lolos)',
    clientBlocked || r?.ok === false, `clientBlocked=${clientBlocked} server=${JSON.stringify(r)}`)
  check('F4b tidak ada baris tersimpan dari isian tidak sah', stored.c === 0, `rows=${stored.c}`)
}

// ---------------------------------------------------------------
console.log('\n=== F5. Retur pecahan terhadap qty rusak pecahan ===\n')
{
  const n = await makeNota('4')
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 4, boughtKnown: true, notBought: false, ordered: 4, basis: 4, sisa: 4 }],
    { [n.ri]: { datang: '4', rusak: '0.75', ws: '3.25', tukang: '', penerima: '', retur: 'SUPPLIER', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  const r = await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: ev.events || ev, p_meta: {} })
  check('F5a rusak pecahan 0.75 + retur 0.75 diterima', r?.ok === true, JSON.stringify(r))
  const e = (await q('select qty_rusak, retur_status, retur_qty from receiving_events where receiving_id=$1', [n.rec]))[0]
  check('F5b retur_qty pecahan tersimpan utuh', e && Number(e.qty_rusak) === 0.75 && Number(e.retur_qty) === 0.75,
    JSON.stringify(e))
}

// ---------------------------------------------------------------
console.log('\n=== F6. Retur MELEBIHI rusak (0.8 > 0.75) harus ditolak ===\n')
{
  const n = await makeNota('4')
  const ev = ELOGIC.buildEventDrafts(
    [{ id: n.ri, prItemId: n.pi, item_name: 'Keramik 60x60', unit: 'm2', prevCum: 0, bought: 4, boughtKnown: true, notBought: false, ordered: 4, basis: 4, sisa: 4 }],
    { [n.ri]: { datang: '4', rusak: '0.75', ws: '3.25', tukang: '', penerima: '', retur: 'SUPPLIER', foto: null, konfirmasiBuang: false } },
    { receivingId: n.rec }
  )
  // Paksa retur_qty melebihi rusak (form normal tidak akan, tapi RPC harus menjaga)
  const events = (ev.events || ev).map(x => ({ ...x, retur_qty: 0.8 }))
  const r = await rpc('receipt_apply_events', { p_receiving_id: n.rec, p_events: events, p_meta: {} })
  check('F6a server menolak retur_qty 0.8 > qty_rusak 0.75', r?.ok === false, JSON.stringify(r))
  const c = (await q('select count(*)::int as c from receiving_events where receiving_id=$1', [n.rec]))[0]
  check('F6b tidak ada baris tersimpan', c.c === 0, `rows=${c.c}`)
}

await client.end()
console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) { console.log('GAGAL:'); failures.forEach(f => console.log('  - ' + f)) }
process.exit(fail ? 1 : 0)
