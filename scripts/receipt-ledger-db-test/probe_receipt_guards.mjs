// ============================================================
// probe_receipt_guards.mjs — PENJAGA KEDATANGAN (defect run 199)
// ============================================================
// Menutup tiga defect yang ditemukan dengan menguji RANTAI form → payload →
// RPC nyata (PG16 + migrasi 00..04 milik t_03b41644):
//
//   G1  rusak = 0 + pilihan retur (SUPPLIER/DIBUANG) → event dulu terkirim
//       `PENDING/DISCARDED` dengan `retur_qty 0` dan RPC MENOLAK
//       `retur_without_qty` (admin menekan Simpan lalu selalu gagal).
//   G2  baris cangkang Approval (`quantity_received = 0`) tampil di form dan
//       kedatangannya DITERIMA RPC → DATANG tanpa BELI.
//   G3  nota yang membeli 3 dari pesanan 5 menawarkan sisa 5 → DATANG > BELI.
//
// Yang diuji: apakah aplikasi MENOLAK SEBELUM RPC untuk ketiga keadaan itu,
// dan apakah jalur yang sah tetap bisa disimpan (kontrol positif, bukan
// sekadar "semua ditolak").
//
// Jalankan: node scripts/receipt-ledger-db-test/probe_receipt_guards.mjs
//   PGURL=... SB=/tmp/<sandbox>
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'

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

const { buildRows, emptyEntry, validateForm, buildSavePlan, RETUR_SUPPLIER, RETUR_DIBUANG } =
  await import(path.join(SB, 'dist/modules/receivings/receiptLogic.mjs'))
const { buildEventDrafts, validateEventDrafts } =
  await import(path.join(SB, 'dist/modules/receivings/receiptEventLogic.mjs'))

const client = new Client({ connectionString: PGURL })
await client.connect()

async function rpc(fn, params) {
  const keys = Object.keys(params)
  const args = keys.map((k, i) => `${k} => $${i + 1}${typeof params[k] === 'object' && params[k] !== null ? '::jsonb' : ''}`).join(', ')
  const vals = keys.map(k => (typeof params[k] === 'object' && params[k] !== null) ? JSON.stringify(params[k]) : params[k])
  const { rows } = await client.query(`select ${fn}(${args}) as out`, vals)
  return rows[0]?.out
}
const q = async (sql, p = []) => (await client.query(sql, p)).rows

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// Satu PR dengan dua baris: satu benar-benar dibeli (3 dari pesanan 5), satu
// masih cangkang Approval (BELI 0 dari pesanan 5).
const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ('PR-GUARD-1','uji penjaga kedatangan','APPROVED',$1) returning id`, [prj]))[0].id
const piBought = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,'Dibeli Sebagian','5','Pcs','APPROVED',$2) returning id`, [pr, vend]))[0].id
const piShell = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,'Belum Dibeli','5','Pcs','APPROVED',$2) returning id`, [pr, vend]))[0].id
const rec = (await q(`insert into receivings (vendor_id,invoice_no,delivery_note,received_date,status,purchase_request_id,project_id,note)
    values ($1,'INV-GUARD-1','x',current_date,'NORMAL',$2,$3,'[Tahap: DIBELI]') returning id`, [vend, pr, prj]))[0].id
const riBought = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
    values ($1,$2,'Dibeli Sebagian','Pcs',3,'[Harga: 1000]') returning id`, [rec, piBought]))[0].id
const riShell = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
    values ($1,$2,'Belum Dibeli','Pcs',0,null) returning id`, [rec, piShell]))[0].id

const ITEMS = [
  { id: riBought, pr_item_id: piBought, item_name: 'Dibeli Sebagian', unit: 'Pcs', quantity_received: 3, qty_arrived: 0 },
  { id: riShell, pr_item_id: piShell, item_name: 'Belum Dibeli', unit: 'Pcs', quantity_received: 0, qty_arrived: 0 }
]
const ORDERED = (it) => (it.pr_item_id === piBought ? 5 : 5)
const rows = buildRows(ITEMS, ORDERED)
const rowBought = rows.find(r => r.id === riBought)
const rowShell = rows.find(r => r.id === riShell)

console.log('\n=== G1. Pilihan retur saat rusak = 0 ===')
{
  const v1 = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '0', retur: RETUR_SUPPLIER } }, { ledgerReady: true })
  check('G1a form MENOLAK "Kembalikan ke supplier" saat rusak 0', v1.valid === false && !!v1.itemErrors[riBought]?.retur, JSON.stringify(v1.itemErrors))
  const v2 = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '0', retur: RETUR_DIBUANG, konfirmasiBuang: true } }, { ledgerReady: true })
  check('G1b form MENOLAK "Dibuang" saat rusak 0', v2.valid === false && !!v2.itemErrors[riBought]?.retur, JSON.stringify(v2.itemErrors))
  const v3 = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '0' } }, { ledgerReady: true })
  check('G1c "Tentukan nanti" tetap boleh (tidak memblokir alur normal)', v3.valid === true, JSON.stringify(v3.itemErrors))
  const d1 = buildEventDrafts([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '0', retur: RETUR_SUPPLIER } }, { receivingId: rec })
  check('G1d draft tidak pernah membawa retur_status non-NONE saat rusak 0', d1[0].retur_status === 'NONE' && Number(d1[0].retur_qty) === 0, JSON.stringify(d1[0]))
  check('G1e validateEventDrafts menolak retur tanpa qty (cermin aturan server)',
    validateEventDrafts([{ ...d1[0], retur_status: 'PENDING', retur_qty: 0 }]).ok === false)
  // Kontrol: rusak 1 dengan pilihan supplier HARUS tetap bisa disimpan.
  const vOk = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '1', retur: RETUR_SUPPLIER, ws: '1' } }, { ledgerReady: true })
  check('G1f kontrol positif: rusak 1 + retur supplier tetap valid', vOk.valid === true, JSON.stringify(vOk.itemErrors))
  const dOk = buildEventDrafts([rowBought], { [riBought]: { ...emptyEntry(), datang: '2', rusak: '1', retur: RETUR_SUPPLIER, ws: '1' } }, { receivingId: rec })
  const rOk = await rpc('receipt_apply_events', { p_receiving_id: rec, p_events: dOk, p_meta: {} })
  check('G1g kontrol positif: RPC MENERIMA payload yang lolos validasi', rOk?.ok === true, JSON.stringify(rOk))
  check('G1h event tersimpan PENDING dengan retur_qty 1', (await q(
    `select retur_status, retur_qty from receiving_events where client_event_id=$1`, [dOk[0].client_event_id]
  ))[0]?.retur_qty == 1)
}

console.log('\n=== G2. Barang BELUM DIBELI tidak boleh dicatat datang ===')
{
  check('G2a baris qty BELI 0 ditandai notBought', rowShell.notBought === true, JSON.stringify(rowShell))
  check('G2b sisa baris belum dibeli = 0 (tidak menawarkan qty pesanan)', rowShell.sisa === 0, String(rowShell.sisa))
  const v = validateForm([rowShell], { [riShell]: { ...emptyEntry(), datang: '5', ws: '5' } }, { ledgerReady: true })
  check('G2c form MENOLAK kedatangan barang belum dibeli', v.valid === false && /belum dibeli/i.test(v.itemErrors[riShell]?.datang || ''), JSON.stringify(v.itemErrors))
  const plan = buildSavePlan([rowShell], { [riShell]: { ...emptyEntry(), datang: '5', ws: '5' } })
  check('G2d pengaman kedua: tidak masuk rencana simpan', plan.length === 0, JSON.stringify(plan))
  check('G2e nol event tersimpan untuk baris itu', (await q(
    `select count(*)::int n from receiving_events where receiving_item_id=$1`, [riShell]))[0].n === 0)
}

console.log('\n=== G3. DATANG tidak boleh melebihi BELI pada nota ===')
{
  check('G3a sisa = qty BELI (3), bukan qty pesanan (5)', rowBought.sisa === 3, String(rowBought.sisa))
  const v = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '5', ws: '5' } }, { ledgerReady: true })
  check('G3b form MENOLAK datang 5 > beli 3', v.valid === false && /dibeli/i.test(v.itemErrors[riBought]?.datang || ''), JSON.stringify(v.itemErrors))
  const vOk = validateForm([rowBought], { [riBought]: { ...emptyEntry(), datang: '1', ws: '1' } }, { ledgerReady: true })
  check('G3c kontrol: datang 1 ≤ beli 3 tetap valid', vOk.valid === true, JSON.stringify(vOk.itemErrors))
  // Baris beli langsung tanpa PR: tanpa batas BELI, over-receipt tidak dicek.
  const direct = buildRows([{ id: 'riDirect', receiving_id: rec, pr_item_id: null, item_name: 'Beli Langsung', unit: 'Pcs', quantity_received: 2, qty_arrived: 0 }], () => null)
  check('G3d beli langsung tanpa PR tetap punya batas (2)', direct[0].sisa === 2, String(direct[0].sisa))
  const vDirect = validateForm(direct, { riDirect: { ...emptyEntry(), datang: '3' } }, { ledgerReady: true })
  check('G3e beli langsung: datang 3 > beli 2 ditolak', vDirect.valid === false, JSON.stringify(vDirect.itemErrors))
}

await client.end()
console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (fail) { console.log('GAGAL:', failures.join(' | ')); process.exit(1) }
