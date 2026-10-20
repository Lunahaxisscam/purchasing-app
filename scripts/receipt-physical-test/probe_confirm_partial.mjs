// ============================================================
// PROBE BATASAN (t_7bc6246b) — konfirmasi serah terima TIDAK bisa sebagian
// ============================================================
// Ini BUKAN bug yang diperbaiki di card ini, melainkan BATASAN yang harus
// diketahui reviewer: `handover_confirm` melakukan CAS pada SATU dokumen
// (`diserahkan_at`), jadi satu dokumen = satu waktu penyerahan. Konsekuensinya
// di UI: `validateHandoverLines` menolak baris dengan qty <= 0, sehingga barang
// yang belum tiba TIDAK bisa dilewati — admin harus menyerahkan semua baris
// sekaligus, atau menunggu.
//
// Probe ini mengunci perilaku tersebut supaya kalau nanti diubah (mis. dukungan
// serah terima parsial per dokumen), perubahan itu disengaja & terlihat.
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

console.log('\nB. Batasan: satu barang belum tiba → tidak bisa dilewati')
const partial = [
  { receiving_event_id: 'e1', qty_diserahkan: 6, penerima: 'Pak Joko' },
  { receiving_event_id: 'e2', qty_diserahkan: 0, penerima: 'Pak Joko' }
]
const v = EL.validateHandoverLines(partial, prefill)
check('B1 qty 0 ditolak (tidak ada mekanisme "lewati")', v.ok === false)
check('B2 pesan meminta qty > 0, bukan opsi melewati barang', /harus > 0/.test((v.errors || []).join(' ')), JSON.stringify(v.errors))
check('B3 baris valid tetap dikembalikan, tetapi ok=false memblokir submit', (v.lines || []).length === 1 && v.ok === false, `${(v.lines || []).length} baris, ok=${v.ok}`)

console.log('\nC. Satu-satunya jalan: serahkan SEMUA baris sekaligus')
const all = prefill.map(p => ({ receiving_event_id: p.receiving_event_id, qty_diserahkan: p.qty_diserahkan, penerima: 'Pak Joko' }))
const vAll = EL.validateHandoverLines(all, prefill)
check('C1 konfirmasi penuh diterima', vAll.ok === true, JSON.stringify(vAll.errors))
check('C2 penerima boleh beda per baris', (() => {
  const mix = all.map((l, i) => ({ ...l, penerima: i === 0 ? 'Pak Joko' : 'Pak Budi' }))
  return EL.validateHandoverLines(mix, prefill).ok === true
})())

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
console.log('Catatan: batasan ini berasal dari RPC handover_confirm (CAS per dokumen),')
console.log('bukan dari UI. Mengubahnya butuh keputusan schema owner t_03b41644.')
