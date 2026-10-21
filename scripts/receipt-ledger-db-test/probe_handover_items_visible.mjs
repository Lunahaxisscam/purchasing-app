// ============================================================
// probe_handover_items_visible.mjs — RINCIAN SERAH TERIMA BENAR-BENAR TERLIHAT
// ============================================================
// DEFECT run 206: RPC `handover_confirm` menulis `handover_items`, tetapi
// halaman TIDAK PERNAH membacanya (`pages/index.js` loadAll hanya memuat tabel
// `handovers`). Akibatnya `display.rincianInfo()` selalu jatuh ke label
// "Rincian barang belum tersedia" — fitur rincian mustahil terlihat walau
// migrasi dijalankan sukses dan datanya ADA.
//
// Probe ini membuktikan rantai lengkap pada PostgreSQL NYATA (migrasi 00..04
// milik t_03b41644):
//   1. tulis baris `handover_items` lewat RPC `handover_confirm` (bukan INSERT
//      langsung — kita menguji jalur produksi),
//   2. baca tabel `handover_items` PERSIS seperti query yang dipakai
//      `pages/index.js` (kolom & bentuk baris sama),
//   3. tempel hasilnya ke baris handover seperti `loadAll`, lalu jalankan
//      `display.rincianInfo` / `rincianCell` dari modul aplikasi VERBATIM.
//
// Tanpa langkah 2-3 yang benar, langkah 1 tidak ada artinya bagi pengguna.
//
// Jalankan: node scripts/receipt-ledger-db-test/probe_handover_items_visible.mjs
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

const D = await import(path.join(SB, 'dist/modules/handovers/display.mjs'))
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

// ---------- fixture: nota + 2 barang, satu dialokasikan ke tukang ----------
const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id
const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
  values ('PR-VIS-1','uji rincian terlihat','APPROVED',$1) returning id`, [prj]))[0].id
const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
  values ($1,'Triplek 9mm','10','Lembar','APPROVED',$2) returning id`, [pr, vend]))[0].id
const rec = (await q(`insert into receivings (vendor_id,invoice_no,delivery_note,received_date,status,purchase_request_id,project_id,note)
  values ($1,'INV-VIS-1','x',current_date,'NORMAL',$2,$3,'[Tahap: DIBELI]') returning id`, [vend, pr, prj]))[0].id
const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
  values ($1,$2,'Triplek 9mm','Lembar',10,'[Harga: 120000]') returning id`, [rec, pi]))[0].id

const ev = ELOGIC.buildEventDrafts(
  [{ id: ri, prItemId: pi, item_name: 'Triplek 9mm', unit: 'Lembar', prevCum: 0, bought: 10, boughtKnown: true, notBought: false, ordered: 10, basis: 10, sisa: 10 }],
  { [ri]: { datang: '6', rusak: '0', ws: '1', tukang: '5', penerima: 'Pak Joko', retur: 'NANTI', foto: null, konfirmasiBuang: false } },
  { receivingId: rec }
)
const r1 = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: ev, p_meta: {} })
check('P1 event penerimaan tersimpan lewat RPC nyata', r1?.ok === true && r1?.applied === 1, JSON.stringify(r1))

const ho = (await q(`insert into handovers (receiving_id,project_id,received_by,handover_date,status,note)
  values ($1,$2,'Pak Joko',current_date,'DRAFT',null) returning id`, [rec, prj]))[0].id
const evRow = (await q('select id, receiving_item_id, pr_item_id, item_name, unit from receiving_events where receiving_id=$1', [rec]))[0]

const prefill = ELOGIC.handoverLinesFromEvents(
  [{ id: evRow.id, receiving_item_id: evRow.receiving_item_id, pr_item_id: evRow.pr_item_id, item_name: evRow.item_name, unit: evRow.unit, tujuan_tukang: 5, penerima_tukang: 'Pak Joko' }],
  {}
)
const val = ELOGIC.validateHandoverLines(
  prefill.map(p => ({ receiving_event_id: p.receiving_event_id, qty_diserahkan: p.qty_diserahkan, penerima: 'Pak Joko' })),
  prefill
)
check('P2 prefill konfirmasi dari event (tanpa ketik ulang)', val.ok === true && val.lines.length === 1, JSON.stringify(val))

const r2 = await rpc('handover_confirm', { p_handover_id: ho, p_lines: val.lines })
check('P3 handover_confirm menulis rincian + mengunci dokumen', r2?.ok === true && r2?.inserted === 1 && !!r2?.diserahkan_at, JSON.stringify(r2))

// ---------- yang diuji: apakah halaman BISA melihat baris itu? ----------
// Query ini HARUS sama dengan yang dipakai pages/index.js loadAll.
const hiRows = await q(`select id, handover_id, receiving_event_id, receiving_item_id, item_name,
                               qty_diserahkan, satuan, penerima, catatan, created_at
                          from handover_items where handover_id = $1`, [ho])
check('P4 baris handover_items terbaca dengan kolom yang dipakai halaman', hiRows.length === 1, String(hiRows.length))

// Bentuk baris handover PERSIS seperti hasil loadAll: select('*') + items
// yang ditempel dari tabel di atas (fix run 206).
const handoverRow = (await q('select * from handovers where id=$1', [ho]))[0]
const withItems = hiRows.length ? { ...handoverRow, items: hiRows } : handoverRow

const rinc = D.rincianInfo(withItems)
check('P5 rincianInfo menyatakan rincian TERSEDIA (bukan label jujur "belum tersedia")',
  rinc.available === true, JSON.stringify({ available: rinc.available, label: rinc.label }))
check('P6 qty yang tampil = qty DISERAHKAN dari DB (5), bukan qty beli (10)',
  Number(rinc.rows?.[0]?.qty) === 5, JSON.stringify(rinc.rows))
check('P7 satuan & nama barang ikut tampil', /Triplek 9mm/.test(rinc.rows?.[0]?.name || '') && /Lembar/.test(rinc.rows?.[0]?.unit || ''), JSON.stringify(rinc.rows))
const cell = D.rincianCell(withItems)
check('P8 sel daftar menampilkan "1 item — Triplek 9mm"', cell.unavailable === false && cell.count === 1 && /Triplek/.test(cell.text), JSON.stringify(cell))

// ---------- kontrol negatif: tanpa baris tetap label jujur ----------
const noItems = { ...handoverRow }
const rincNone = D.rincianInfo(noItems)
check('P9 tanpa baris handover_items tetap label jujur (tidak menebak dari Purchase)',
  rincNone.available === false && /belum tersedia/i.test(rincNone.label), JSON.stringify(rincNone))
check('P10 baris handover hasil select(*) memang TIDAK punya properti items (bukti fix perlu)',
  noItems.items === undefined, JSON.stringify(Object.keys(noItems).filter(k => k === 'items')))

// ---------- qty_handed_over tersinkron (anti dobel hitung) ----------
const riAfter = (await q('select qty_arrived, qty_handed_over, quantity_received from receiving_items where id=$1', [ri]))[0]
check('P11 qty BELI tidak berubah (10), DATANG 6, DISERAHKAN 5 — tiga angka terpisah',
  Number(riAfter.quantity_received) === 10 && Number(riAfter.qty_arrived) === 6 && Number(riAfter.qty_handed_over) === 5,
  JSON.stringify(riAfter))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (fail) { console.log('TEMUAN: ' + failures.join(' | ')); await client.end(); process.exit(1) }
await client.end()
