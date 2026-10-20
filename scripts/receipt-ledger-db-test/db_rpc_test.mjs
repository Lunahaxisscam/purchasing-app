// ============================================================
// db_rpc_test.mjs — UJI RPC NYATA terhadap PostgreSQL (BUKAN mock)
// ============================================================
// Tujuan: menutup gap yang ditemukan review run 101 — jalur READY
// (receipt_apply_events / handover_confirm / return_create) sebelumnya HANYA
// diuji terhadap mock. Skrip ini memanggil RPC SUNGGUHAN lewat `pg` pada
// cluster PostgreSQL terisolasi yang sudah dimigrasikan paket t_03b41644,
// dengan payload yang dibentuk oleh modul aplikasi VERBATIM.
//
// Yang dibuktikan:
//   D1  receipt_apply_events: signature & nama parameter cocok dengan yang
//       dipanggil receiptEventSave.js (p_receiving_id, p_events, p_meta).
//   D2  idempotensi NYATA: submit dua kali dengan client_event_id sama →
//       applied=1, already_applied=1, qty tidak dobel (bukan klaim mock).
//   D3  qty_arrived = Σ qty_datang; quantity_received (BELI) TIDAK diubah.
//   D4  over-receipt ditolak server (bukan hanya validasi UI).
//   D5  handover_confirm: CAS diserahkan_at + handover_items + qty_handed_over,
//       dan konfirmasi kedua = already (tidak menggandakan baris).
//   D6  quota tukang ditegakkan server (melebihi alokasi → exception).
//   D7  return_create: retur pertama OK; retur kedua melebihi saldo DITOLAK.
//   D8  RLS: anon TIDAK boleh SELECT ledger (grant dicabut).
//
// Jalankan: node scripts/receipt-ledger-db-test/db_rpc_test.mjs
//   PGURL=postgresql://postgres@127.0.0.1:55434/migled
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))

const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/migled'

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const client = new Client({ connectionString: PGURL })

// ---- util: panggil RPC seperti supabase.rpc(nama, params) ----------------
// PostgREST memetakan { p_x: ... } ke parameter bernama; pg memakai
// `select * from fn(p_x => $1)`. Ini menguji NAMA PARAMETER sungguhan.
async function rpc(fnName, params) {
  const keys = Object.keys(params)
  // Parameter jsonb harus dikirim sebagai teks JSON + cast eksplisit: driver
  // `pg` mengubah objek JS menjadi "[object Object]". PostgREST (yang dipakai
  // aplikasi) mengirim body JSON, jadi mengirim JSON.stringify + ::jsonb
  // adalah padanan yang benar untuk menguji signature & isi payload.
  const args = keys.map((k, i) => {
    const v = params[k]
    const isJson = v !== null && typeof v === 'object'
    return `${k} => $${i + 1}${isJson ? '::jsonb' : ''}`
  }).join(', ')
  const vals = keys.map(k => {
    const v = params[k]
    return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v
  })
  const sql = `select ${fnName}(${args}) as out`
  const { rows } = await client.query(sql, vals)
  return rows[0]?.out
}

async function q(sql, params = []) {
  const { rows } = await client.query(sql, params)
  return rows
}

// Payload event dibentuk oleh logika aplikasi VERBATIM (dist hasil SWC),
// bukan dikarang di skrip ini.
async function loadAppLogic() {
  const SB = '/tmp/receipt-ledger-app'
  const dist = path.join(SB, 'dist', 'modules', 'receivings')
  const logic = await import(pathToFileURLSafe(path.join(dist, 'receiptEventLogic.mjs')))
  const rlogic = await import(pathToFileURLSafe(path.join(dist, 'receiptLogic.mjs')))
  return { logic, rlogic }
}
function pathToFileURLSafe(p) {
  const u = new URL('file:///')
  u.pathname = p.split(path.sep).join('/')
  return u.href
}

async function main() {
  await client.connect()

  // ---- fixture: satu penerimaan dengan 2 item PR (qty 10 & 4) -----------
  const prj = (await q(`select id from projects limit 1`))[0].id
  const vend = (await q(`select id from vendors limit 1`))[0].id
  const pr = (await q(
    `insert into purchase_requests (pr_number, title, status, project_id)
     values ('PR-T7BC-1','Uji ledger t_7bc6246b','APPROVED',$1) returning id`, [prj]))[0].id
  const pi1 = (await q(
    `insert into pr_items (pr_id, item_name, quantity, unit, status, vendor_id)
     values ($1,'Triplek 9mm',10,'Lembar','APPROVED',$2) returning id`, [pr, vend]))[0].id
  const pi2 = (await q(
    `insert into pr_items (pr_id, item_name, quantity, unit, status, vendor_id)
     values ($1,'Cat Duco',4,'Kaleng','APPROVED',$2) returning id`, [pr, vend]))[0].id

  const rec = (await q(
    `insert into receivings (vendor_id, invoice_no, delivery_note, received_date, status, purchase_request_id, project_id, note)
     values ($1,'INV-T7BC-1','Nota INV-T7BC-1',current_date,'NORMAL',$2,$3,'[Tahap: DIBELI]') returning id`,
    [vend, pr, prj]))[0].id
  const ri1 = (await q(
    `insert into receiving_items (receiving_id, pr_item_id, item_name, unit, quantity_received, note)
     values ($1,$2,'Triplek 9mm','Lembar',10,'[Harga: 120000]') returning id`, [rec, pi1]))[0].id
  const ri2 = (await q(
    `insert into receiving_items (receiving_id, pr_item_id, item_name, unit, quantity_received, note)
     values ($1,$2,'Cat Duco','Kaleng',4,'[Harga: 95000]') returning id`, [rec, pi2]))[0].id

  const { logic, rlogic } = await loadAppLogic()

  // ================= D1/D3: RPC nyata dengan payload modul ===============
  console.log('\n=== D1. receipt_apply_events — payload dibentuk modul aplikasi ===\n')
  const rows = rlogic.buildRows(
    [
      { id: ri1, pr_item_id: pi1, item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
      { id: ri2, pr_item_id: pi2, item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
    ],
    (it) => (it.pr_item_id === pi1 ? 10 : 4)
  )
  const entries = {
    [ri1]: { ...rlogic.emptyEntry(), datang: '6', rusak: '2', ws: '3', tukang: '1', penerima: 'Pak Joko', retur: rlogic.RETUR_SUPPLIER },
    [ri2]: { ...rlogic.emptyEntry(), datang: '4', rusak: '0', ws: '0', tukang: '4', penerima: 'Pak Budi' }
  }
  const drafts = logic.buildEventDrafts(rows, entries, { receivingId: rec })
  check('D1a modul menghasilkan 2 event draft', drafts.length === 2, JSON.stringify(drafts.map(d => d.item_name)))

  const payload = drafts.map(({ _computed, ...rest }) => rest)
  const r1 = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: payload, p_meta: {} })
  check('D1b RPC menerima signature p_receiving_id/p_events/p_meta', !!r1 && r1.ok === true, JSON.stringify(r1))
  check('D1c applied = 2', Number(r1?.applied) === 2, String(r1?.applied))

  // ================= D3: qty_arrived vs quantity_received ================
  console.log('\n=== D3. qty DATANG vs qty BELI tidak tercampur ===\n')
  const after = await q(`select id, quantity_received, qty_arrived from receiving_items where receiving_id=$1 order by item_name`, [rec])
  const byId = new Map(after.map(r => [r.id, r]))
  check('D3a qty_arrived item1 = 6 (Σ qty_datang)', Number(byId.get(ri1).qty_arrived) === 6, String(byId.get(ri1).qty_arrived))
  check('D3b quantity_received item1 TETAP 10 (BELI, tidak ditimpa)', Number(byId.get(ri1).quantity_received) === 10, String(byId.get(ri1).quantity_received))
  check('D3c qty_arrived item2 = 4', Number(byId.get(ri2).qty_arrived) === 4, String(byId.get(ri2).qty_arrived))

  const evs = await q(`select id, item_name, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, retur_status, retur_qty from receiving_events where receiving_id=$1 order by item_name`, [rec])
  const evTri = evs.find(e => e.item_name === 'Triplek 9mm')
  const evCat = evs.find(e => e.item_name === 'Cat Duco')
  check('D3d event menyimpan rusak terpisah (2)', Number(evTri.qty_rusak) === 2)
  check('D3e event menyimpan tujuan ws=3 / tukang=1', Number(evTri.tujuan_ws) === 3 && Number(evTri.tujuan_tukang) === 1)
  check('D3f retur_status PENDING + retur_qty 2 (bukan hardcode NONE)', evTri.retur_status === 'PENDING' && Number(evTri.retur_qty) === 2, `${evTri.retur_status}/${evTri.retur_qty}`)
  check('D3g penerima tukang tersimpan', (await q(`select penerima_tukang from receiving_events where id=$1`, [evTri.id]))[0].penerima_tukang === 'Pak Joko')

  // ================= D2: idempotensi NYATA di server ====================
  console.log('\n=== D2. Idempotensi nyata (bukan mock) ===\n')
  const r2 = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: payload, p_meta: {} })
  check('D2a submit ulang ok', r2?.ok === true)
  check('D2b applied = 0 pada replay', Number(r2?.applied) === 0, String(r2?.applied))
  check('D2c already_applied = 2', Number(r2?.already_applied) === 2, String(r2?.already_applied))
  const cnt = (await q(`select count(*)::int n from receiving_events where receiving_id=$1`, [rec]))[0].n
  check('D2d jumlah event tetap 2 (tidak dobel)', cnt === 2, String(cnt))
  const arr = (await q(`select qty_arrived from receiving_items where id=$1`, [ri1]))[0].qty_arrived
  check('D2e qty_arrived tetap 6 (tidak dobel)', Number(arr) === 6, String(arr))

  // ================= D4: over-receipt ditolak SERVER ====================
  console.log('\n=== D4. Over-receipt ditolak server (bukan hanya UI) ===\n')
  const overDraft = {
    client_event_id: `rcpt:${rec}:${ri2}:4->8`,
    receiving_item_id: ri2,
    pr_item_id: pi2,
    item_name: 'Cat Duco',
    unit: 'Kaleng',
    qty_datang: 4,
    qty_rusak: 0,
    tujuan_ws: 0,
    tujuan_tukang: 0,
    penerima_tukang: null,
    retur_status: 'NONE',
    retur_qty: 0,
    discard_confirmed: false,
    foto_ref: null
  }
  const rOver = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: [overDraft], p_meta: {} })
  check('D4a over-receipt ditolak (ok=false)', rOver?.ok === false, JSON.stringify(rOver))
  check('D4b reason over_receipt', rOver?.reason === 'over_receipt', String(rOver?.reason))
  check('D4c NOL tulisan saat ditolak', (await q(`select count(*)::int n from receiving_events where receiving_id=$1`, [rec]))[0].n === 2)

  // ================= D5/D6: handover_confirm ==========================
  console.log('\n=== D5. handover_confirm — CAS + rincian + qty_handed_over ===\n')
  const ho = (await q(
    `insert into handovers (receiving_id, project_id, received_by, status, handover_date)
     values ($1,$2,'Belum ditentukan','DRAFT',current_date) returning id`, [rec, prj]))[0].id
  const lines = [
    { receiving_event_id: evTri.id, qty_diserahkan: 1, penerima: 'Pak Joko', satuan: 'Lembar' },
    { receiving_event_id: evCat.id, qty_diserahkan: 4, penerima: 'Pak Budi', satuan: 'Kaleng' }
  ]
  const rh = await rpc('handover_confirm', { p_handover_id: ho, p_lines: lines })
  check('D5a handover_confirm ok', rh?.ok === true, JSON.stringify(rh))
  check('D5b inserted = 2', Number(rh?.inserted) === 2, String(rh?.inserted))
  const hoRow = (await q(`select status, diserahkan_at from handovers where id=$1`, [ho]))[0]
  check('D5c diserahkan_at terisi', !!hoRow.diserahkan_at)
  check('D5d status CONFIRMED', hoRow.status === 'CONFIRMED')
  const hiCnt = (await q(`select count(*)::int n from handover_items where handover_id=$1`, [ho]))[0].n
  check('D5e 2 baris handover_items', hiCnt === 2, String(hiCnt))
  const qho = (await q(`select qty_handed_over from receiving_items where id=$1`, [ri1]))[0].qty_handed_over
  check('D5f qty_handed_over item1 = 1', Number(qho) === 1, String(qho))

  const rh2 = await rpc('handover_confirm', { p_handover_id: ho, p_lines: lines })
  check('D5g konfirmasi kedua = already (tidak dobel)', rh2?.already === true, JSON.stringify(rh2))
  check('D5h handover_items tetap 2', (await q(`select count(*)::int n from handover_items where handover_id=$1`, [ho]))[0].n === 2)

  console.log('\n=== D6. Quota tukang ditegakkan SERVER ===\n')
  const ho2 = (await q(
    `insert into handovers (receiving_id, project_id, received_by, status, handover_date)
     values ($1,$2,'Uji Quota','DRAFT',current_date) returning id`, [rec, prj]))[0].id
  let quotaErr = ''
  try {
    // evTri.tujuan_tukang = 1, sudah diserahkan 1 → sisa 0. Kirim 1 lagi harus GAGAL.
    await rpc('handover_confirm', { p_handover_id: ho2, p_lines: [{ receiving_event_id: evTri.id, qty_diserahkan: 1, penerima: 'Pak X' }] })
  } catch (e) { quotaErr = e.message }
  check('D6a melebihi alokasi tukang ditolak server', /Melebihi alokasi tukang/i.test(quotaErr), quotaErr || '(tidak error — BUG)')
  const ho2Row = (await q(`select diserahkan_at from handovers where id=$1`, [ho2]))[0]
  check('D6b CAS dibatalkan saat validasi gagal (diserahkan_at tetap NULL)', ho2Row.diserahkan_at === null, String(ho2Row.diserahkan_at))
  check('D6c tidak ada handover_items yatim', (await q(`select count(*)::int n from handover_items where handover_id=$1`, [ho2]))[0].n === 0)

  // ================= D7: return_create ================================
  console.log('\n=== D7. return_create — retur tanpa ketik ulang, anti dobel ===\n')
  const rr = await rpc('return_create', {
    p_receiving_id: rec,
    p_lines: [{ receiving_event_id: evTri.id, qty: 2, note: 'penyok' }],
    p_resolution: 'RETURN',
    p_reason: 'rusak saat kirim'
  })
  check('D7a retur pertama ok', rr?.ok === true, JSON.stringify(rr))
  const rl = await q(`select qty from return_lines where receiving_event_id=$1`, [evTri.id])
  check('D7b return_lines tercatat qty 2', rl.length === 1 && Number(rl[0].qty) === 2)
  check('D7c quantity_received TIDAK berubah oleh retur', Number((await q(`select quantity_received from receiving_items where id=$1`, [ri1]))[0].quantity_received) === 10)
  check('D7d qty_arrived TIDAK berkurang oleh retur', Number((await q(`select qty_arrived from receiving_items where id=$1`, [ri1]))[0].qty_arrived) === 6)

  const rr2 = await rpc('return_create', {
    p_receiving_id: rec,
    p_lines: [{ receiving_event_id: evTri.id, qty: 2 }],
    p_resolution: 'RETURN',
    p_reason: 'dobel'
  })
  check('D7e retur kedua (melebihi saldo) DITOLAK', rr2?.ok === false && rr2?.reason === 'over_return', JSON.stringify(rr2))
  check('D7f return_lines tetap 1 baris', (await q(`select count(*)::int n from return_lines where receiving_event_id=$1`, [evTri.id]))[0].n === 1)

  // Modul aplikasi harus melaporkan sisa 0 untuk event ini (anti double-retur).
  const returnedMap = {}
  for (const row of await q(`select receiving_event_id, qty from return_lines where receiving_event_id=$1`, [evTri.id])) {
    returnedMap[row.receiving_event_id] = (returnedMap[row.receiving_event_id] || 0) + Number(row.qty)
  }
  const offered = logic.returLinesFromEvents(evs.map(e => ({ ...e, receiving_item_id: null, unit: 'Lembar' })), { alreadyReturned: returnedMap })
  check('D7g modul TIDAK menawarkan event yang sudah diretur penuh', offered.filter(o => o.receiving_event_id === evTri.id).length === 0, JSON.stringify(offered))

  // ================= D8: RLS / grant =================================
  console.log('\n=== D8. Grant & RLS ledger ===\n')
  const grants = await q(`
    select table_name, grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema='public'
       and table_name in ('receiving_events','handover_items','return_cases','return_lines')
       and grantee in ('anon','authenticated','public')
     order by 1,2,3`)
  const anonAny = grants.filter(g => g.grantee === 'anon')
  check('D8a anon TIDAK punya grant apa pun di tabel ledger', anonAny.length === 0, JSON.stringify(anonAny))
  const authSelect = grants.filter(g => g.grantee === 'authenticated' && g.privilege_type === 'SELECT')
  check('D8b authenticated punya SELECT di 4 tabel', authSelect.length === 4, JSON.stringify(authSelect.map(g => g.table_name)))
  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('receiving_events','handover_items','return_cases','return_lines') order by 1`)
  check('D8c RLS aktif di 4 tabel', rls.every(r => r.relrowsecurity === true), JSON.stringify(rls))
  const writePolicies = await q(`
    select tablename, policyname, cmd from pg_policies
     where schemaname='public' and tablename in ('receiving_events','handover_items','return_cases','return_lines')
       and cmd <> 'SELECT'`)
  check('D8d TIDAK ada policy tulis (tulis hanya via RPC)', writePolicies.length === 0, JSON.stringify(writePolicies))

  // ================= D9: view kontrak ================================
  console.log('\n=== D9. v_receipt_progress — nama kolom kontrak ===\n')
  const viewCols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name='v_receipt_progress'`)).map(r => r.column_name)
  for (const c of ['qty_datang', 'qty_rusak', 'qty_baik', 'belum_diserahkan', 'qty_bought', 'qty_handed_over']) {
    check(`D9 ${c} ada di view`, viewCols.includes(c), viewCols.join(','))
  }
  const prog = (await q(`select * from v_receipt_progress where receiving_item_id=$1`, [ri1]))[0]
  check('D9g view: qty_bought 10 / qty_datang 6 / qty_rusak 2 / qty_baik 4', Number(prog.qty_bought) === 10 && Number(prog.qty_datang) === 6 && Number(prog.qty_rusak) === 2 && Number(prog.qty_baik) === 4, JSON.stringify(prog))

  await client.end()

  console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
  if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
}

main().catch(async (e) => {
  console.error('FATAL', e)
  try { await client.end() } catch {}
  process.exit(1)
})
