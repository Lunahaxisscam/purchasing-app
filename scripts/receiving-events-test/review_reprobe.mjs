// ============================================================
// review_reprobe.mjs — bukti perbaikan temuan review run 101 (t_7bc6246b)
// ============================================================
// Dua bug fungsional ditemukan dengan menjalankan modul terkompilasi langsung
// (bukan lewat harness), lalu diperbaiki. Skrip ini menjaga agar keduanya
// TIDAK KEMBALI:
//
//   BUG-1 "Pecah per Vendor" melabeli nota dengan vendor yang salah ketika
//         masih ada barang tanpa vendor (barang yatim tertinggal, tapi UI
//         melaporkan sukses).
//   BUG-2 Retur yang sama bisa dicatat dua kali (qty rusak 2 → 4) karena modal
//         tidak membaca riwayat `return_lines`.
//
// Prasyarat: jalankan `python3 scripts/receiving-events-test/run.py` lebih dulu
// (membuat sandbox /tmp/receiving-events-verify dengan modul terkompilasi).
// Tanpa DB, tanpa jaringan, tanpa menyentuh .next aktif.
//
// Jalankan: node scripts/receiving-events-test/review_reprobe.mjs
// ============================================================
import * as mock from '/tmp/receiving-events-verify/lib/supabaseClient.mjs'

const SB = '/tmp/receiving-events-verify'
const SPLIT = await import(`${SB}/modules/receivings/receiptSplit.mjs`)
const LOGIC = await import(`${SB}/modules/receivings/receiptEventLogic.mjs`)
const SAVE = await import(`${SB}/modules/receivings/receiptEventSave.mjs`)
const CAP = await import(`${SB}/modules/receivings/receiptCapability.mjs`)

let pass = 0, fail = 0
const check = (n, c, x = '') => { c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, x)) }

const receiving = {
  id: 'rec-1', purchase_request_id: 'pr-1', pr_number: 'PR-009',
  delivery_note: 'PO PR-009', status: 'NORMAL', note: 'Dibuat otomatis dari PR',
  alokasi: 'LANGSUNG_LAPANGAN', masuk_gudang: false, tukang_at: null, vendor_id: null
}
const items = [
  { id: 'i1', pr_item_id: 'p1', item_name: 'HPL A', quantity_received: 0 },
  { id: 'i2', pr_item_id: 'p2', item_name: 'Sekrup B', quantity_received: 0 }
]
const vendors = [{ id: 'v-A', name: 'Toko A' }, { id: 'v-B', name: 'Toko B' }]

console.log('BUG-1 — split tidak boleh melabeli nota bila ada barang tanpa vendor')
{
  const prOrphan = [{ id: 'p1', vendor_id: 'v-A' }, { id: 'p2', vendor_id: null }]
  const plan = SPLIT.buildSplitPlan({ receiving, items, prItems: prOrphan, vendors })
  check('B1a pemecahan ditolak', plan.ok === false)
  check('B1b alasan spesifik "belum punya vendor"', /belum punya vendor/.test(plan.reason || ''), plan.reason)

  // walau dipaksa, tidak boleh ada tulisan apa pun
  mock.__reset({ tables: ['receivings', 'receiving_items'], receivingItems: items })
  mock.__state.rows.set('receivings:rec-1', { ...receiving })
  if (plan.ok) await SPLIT.applySplitPlan({ receiving, plan: plan.plan, existingReceivings: [receiving] })
  const writes = mock.__state.calls.filter(c => c.op === 'update' || c.op === 'insert')
  check('B1c nol tulisan ke receivings/receiving_items', writes.length === 0, JSON.stringify(writes))
  check('B1d vendor_id nota asal tidak berubah', !mock.__state.rows.get('receivings:rec-1').vendor_id)
}

console.log('\nBUG-1b — nota yang sudah berlabel vendor tidak boleh diganti diam-diam')
{
  const prAB = [{ id: 'p1', vendor_id: 'v-A' }, { id: 'p2', vendor_id: 'v-B' }]
  const plan = SPLIT.buildSplitPlan({ receiving: { ...receiving, vendor_id: 'v-B' }, items, prItems: prAB, vendors })
  check('B2a nota asal memakai vendor yang sudah tertulis (v-B)', plan.ok && plan.plan[0].vendorId === 'v-B')
  check('B2b nota asal = nota lama', plan.plan[0].existingReceivingId === 'rec-1')
  check('B2c vendor lain jadi nota baru', plan.plan[1].vendorId === 'v-A' && plan.plan[1].existingReceivingId === null)
  const mismatch = SPLIT.buildSplitPlan({ receiving: { ...receiving, vendor_id: 'v-Z' }, items, prItems: prAB, vendors })
  check('B2d label vendor tak cocok dengan isi → ditolak', mismatch.ok === false && /tidak ada pada barang/.test(mismatch.reason))
}

console.log('\nBUG-2 — retur yang sama tidak boleh tercatat dua kali')
{
  mock.__reset({
    tables: ['receiving_events', 'return_cases', 'return_lines'],
    events: [{ id: 'e1', receiving_id: 'rc1', receiving_item_id: 'ri1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 5, qty_rusak: 2, retur_status: 'NONE', retur_qty: 0 }]
  })
  // putaran 1 — persis alur returnForm (baca riwayat dulu)
  let ret = await SAVE.loadReturnedByEvent({ eventIds: ['e1'] })
  let lines = LOGIC.returLinesFromEvents(mock.__state.events, { alreadyReturned: ret.returned })
  check('B3a putaran 1 menawarkan 1 baris qty 2', lines.length === 1 && lines[0].qty === 2)
  await SAVE.createReturnCase({ receiving: { id: 'rc1' }, lines, resolution: 'RETURN' })
  check('B3b return_lines tercatat 1', mock.__state.returnLines.length === 1)

  // putaran 2 — user membuka modal LAGI (alur yang dulu menggandakan)
  ret = await SAVE.loadReturnedByEvent({ eventIds: ['e1'] })
  lines = LOGIC.returLinesFromEvents(mock.__state.events, { alreadyReturned: ret.returned })
  check('B3c putaran 2 TIDAK menawarkan baris lagi', lines.length === 0, JSON.stringify(lines))
  if (lines.length) await SAVE.createReturnCase({ receiving: { id: 'rc1' }, lines, resolution: 'RETURN' })
  const totalQty = mock.__state.returnLines.reduce((s, l) => s + Number(l.qty || 0), 0)
  check('B3d total qty diretur tetap 2 (bukan 4)', totalQty === 2, String(totalQty))
  check('B3e hanya 1 return_case', mock.__state.returnCases.length === 1, String(mock.__state.returnCases.length))
}

console.log('\nBUG-2b — tanpa return_lines, retur diblokir (bukan mengarang riwayat)')
{
  mock.__reset({ tables: ['receiving_events'], events: [{ id: 'e1', receiving_id: 'rc1', receiving_item_id: 'ri1', qty_rusak: 2, retur_status: 'NONE' }] })
  const ret = await SAVE.loadReturnedByEvent({ eventIds: ['e1'] })
  check('B4a loadReturnedByEvent gagal jujur (ok=false)', ret.ok === false && !!ret.error)

  mock.__reset({ tables: ['receiving_events', 'handover_items', 'v_receipt_progress'] })
  CAP.resetReceiptCapability()
  const cap = await CAP.getReceiptCapability({ force: true })
  check('B4b ready=true (penerimaan tetap bisa)', cap.ready === true)
  check('B4c returnReady=false (tombol Retur disembunyikan)', cap.returnReady === false)
  check('B4d missing menyebut retur/return_lines', cap.missing.some(m => /retur|return_lines/.test(m)), JSON.stringify(cap.missing))
}

console.log(`\nREVIEW RE-PROBE: ${pass} lulus, ${fail} gagal`)
if (fail) process.exit(1)
