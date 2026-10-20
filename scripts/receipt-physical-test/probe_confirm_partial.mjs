// ============================================================
// PROBE BATASAN (t_7bc6246b) — serah terima: baris boleh dilewati,
// tetapi SATU dokumen tetap satu waktu penyerahan
// ============================================================
// Sejak run 202, UI TIDAK lagi memaksa semua baris diserahkan sekaligus:
// qty kosong = baris DILEWATI (bukan error), dan sisanya dilaporkan.
//
// Batasan yang TETAP ada dan berasal dari RPC `handover_confirm` (CAS pada
// `diserahkan_at` per dokumen): satu dokumen = satu waktu penyerahan. Jadi
// setelah dokumen disimpan, baris yang dilewati TIDAK bisa ditambahkan ke
// dokumen itu — sisanya dicatat lewat dokumen Serah Terima BARU untuk
// penerimaan yang sama (kuota dihitung per event lintas dokumen; dibuktikan
// di PostgreSQL nyata oleh scripts/receipt-ledger-db-test/probe_handover_partial.mjs).
//
// Probe ini mengunci kedua hal itu supaya kalau nanti diubah (mis. dukungan
// penambahan baris ke dokumen yang sudah terkunci), perubahannya disengaja.
//
// Jalankan dari root sandbox receipt-physical-verify:
//   node probe_confirm_partial.mjs
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const EL = await importDist('modules/receivings/receiptEventLogic.mjs')

let pass = 0, fail = 0
const check = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.log(`  ✗ ${n}  ${extra}`) } }

const events = [
  { id: 'e1', receiving_id: 'rec1', receiving_item_id: 'ri1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 10, qty_rusak: 0, tujuan_tukang: 6, penerima_tukang: 'Pak Joko' },
  { id: 'e2', receiving_id: 'rec1', receiving_item_id: 'ri2', item_name: 'Cat Duco', unit: 'Kaleng', qty_datang: 4, qty_rusak: 0, tujuan_tukang: 2, penerima_tukang: 'Pak Joko' }
]
const prefill = EL.handoverLinesFromEvents(events, {})
console.log('A. Prefill mengisi SEMUA baris dengan qty penuh')
check('A1 dua baris prefill', prefill.length === 2, String(prefill.length))
check('A2 qty prefill = sisa alokasi tukang', prefill[0].qty_diserahkan === 6 && prefill[1].qty_diserahkan === 2,
  JSON.stringify(prefill.map(p => p.qty_diserahkan)))

console.log('\nB. Barang belum tiba → baris DILEWATI (bukan memblokir)')
const partial = [
  { receiving_event_id: 'e1', item_name: 'Triplek 9mm', satuan: 'Lembar', qty_diserahkan: 6, penerima: 'Pak Joko' },
  { receiving_event_id: 'e2', item_name: 'Cat Duco', satuan: 'Kaleng', qty_diserahkan: '', penerima: 'Pak Joko' }
]
const v = EL.validateHandoverLines(partial, prefill)
check('B1 baris kosong TIDAK memblokir submit', v.ok === true, JSON.stringify(v.errors))
check('B2 hanya baris yang benar-benar diterima yang dikirim', v.lines.length === 1, String(v.lines.length))
check('B3 baris yang dilewati DILAPORKAN dengan sisa qty', v.skipped.length === 1 && v.skipped[0].qty_sisa === 2, JSON.stringify(v.skipped))
check('B4 total sisa dilaporkan', v.remainder === 2, String(v.remainder))

console.log('\nC. Penjaga yang TETAP berlaku')
const allEmpty = EL.validateHandoverLines(partial.map(l => ({ ...l, qty_diserahkan: '' })), prefill)
check('C1 semua baris kosong ditolak (tidak ada yang diserahkan)', allEmpty.ok === false)
const over = EL.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 99, penerima: 'Pak Joko' }], prefill)
check('C2 melebihi sisa alokasi ditolak', over.ok === false && /melebihi sisa/i.test(over.errors[0] || ''), JSON.stringify(over.errors))
const noRecv = EL.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 1, penerima: '' }],
  prefill.map(p => ({ ...p, penerima: '' })))
check('C3 penerima wajib bila qty > 0 dan tidak ada penerima di penerimaan',
  noRecv.ok === false && /penerima/i.test(noRecv.errors[0] || ''), JSON.stringify(noRecv.errors))
const withPrefillRecv = EL.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 1, penerima: '' }], prefill)
check('C3b penerima terisi otomatis dari penerimaan bila ada (tidak wajib ketik ulang)',
  withPrefillRecv.ok === true && withPrefillRecv.lines[0].penerima === 'Pak Joko',
  JSON.stringify(withPrefillRecv.lines))
const badQty = EL.validateHandoverLines([{ receiving_event_id: 'e1', qty_diserahkan: 'abc', penerima: 'Pak Joko' }], prefill)
check('C4 qty bukan angka ditolak (tidak dianggap "lewat")', badQty.ok === false, JSON.stringify(badQty.errors))
check('C5 konfirmasi penuh (tanpa sisa) tidak melaporkan sisa', (() => {
  const all = prefill.map(p => ({ receiving_event_id: p.receiving_event_id, qty_diserahkan: p.qty_diserahkan, penerima: 'Pak Joko' }))
  const r = EL.validateHandoverLines(all, prefill)
  return r.ok === true && r.skipped.length === 0 && r.remainder === 0
})())

console.log('\nD. Batasan skema: satu dokumen = satu waktu penyerahan')
check('D1 hasil validasi melaporkan sisa yang harus dicatat di dokumen baru', v.remainder > 0)

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
console.log('Catatan: batas "satu dokumen satu waktu penyerahan" berasal dari RPC')
console.log('handover_confirm (CAS per dokumen), bukan dari UI. Sisa dicatat lewat')
console.log('dokumen Serah Terima baru untuk penerimaan yang sama.')
