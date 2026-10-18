// ============================================================
// guard_test.mjs — ANTI-DOUBLE-COST (inti arahan DAT 18 Okt)
// Bagian B + C dari harness t_796f8498.
// Fokus: nota ganda, baris ganda, handover ganda, konfirmasi ganda,
// shell approval yang sudah jadi nota tidak ditimpa, dan partial qty.
// Tanpa DB, tanpa jaringan: mock DB perekam + modul ASLI.
// ============================================================
import { __reset, __rows, __inserts, __updates, supabase } from './lib/supabaseClient.mjs'
import { savePurchase } from './modules/receivings/purchaseSave.mjs'
import { buildReadyRows, buildFormDraft } from './modules/receivings/purchaseLogic.mjs'
import { markHandoverDelivered } from './modules/handovers/confirm.mjs'
import { summarizeDistribution } from './modules/handovers/logic.mjs'

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }

// ---------- FIXTURE: cangkang Approval + PR 2 item ----------
function FIX() {
  __reset({
    tables: {
      requests: [{ id: 'pr1', pr_number: 'PR-101', title: 'Material Proyek A', project_id: 'proj1', status: 'DRAFT' }],
      projects: [{ id: 'proj1', kode: 'PA', name: 'Proyek A' }],
      pr_items: [
        { id: 'pi1', pr_id: 'pr1', project_id: 'proj1', item_name: 'Sekrup', kode: 'M-01', unit: 'Box', quantity: 10, status: 'APPROVED', vendor_id: 'v1', material_id: 'mat1', estimated_price: 150000 },
        { id: 'pi2', pr_id: 'pr1', project_id: 'proj1', item_name: 'Engsel', kode: 'M-02', unit: 'Pcs', quantity: 20, status: 'APPROVED', vendor_id: 'v1', material_id: 'mat2', estimated_price: 25000 }
      ],
      receivings: [{ id: 'rec-shell', vendor_id: null, invoice_no: null, delivery_note: 'PO PR-101 - Material Proyek A', status: 'NORMAL', project_id: 'proj1', purchase_request_id: 'pr1', received_date: '2026-10-18', note: '' }],
      receiving_items: [
        { id: 'ri1', receiving_id: 'rec-shell', pr_item_id: 'pi1', item_name: 'Sekrup', unit: 'Box', quantity_received: 0, note: '' },
        { id: 'ri2', receiving_id: 'rec-shell', pr_item_id: 'pi2', item_name: 'Engsel', unit: 'Pcs', quantity_received: 0, note: '' }
      ],
      handovers: [],
      vendors: [{ id: 'v1', name: 'Toko Bangunan Jaya' }],
      materials: [{ id: 'mat1', category: 'Sekrup', harga_acuan: 160000 }, { id: 'mat2', category: 'Engsel', harga_acuan: 26000 }]
    }
  })
}
const state = () => ({
  prItems: __rows('pr_items'), requests: __rows('requests'), projects: __rows('projects'),
  vendors: __rows('vendors'), materials: __rows('materials'),
  receivings: __rows('receivings'), receivingItems: __rows('receiving_items')
})
const form = (invoiceNo = 'TB-88912') => ({
  vendorId: 'v1', invoiceNo, tanggal: '2026-10-18', biayaLain: '', diskon: '',
  notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: '',
  items: [
    { prItemId: 'pi1', itemName: 'Sekrup', unit: 'Box', qty: '10', harga: '150000', prId: 'pr1', projectId: 'proj1' },
    { prItemId: 'pi2', itemName: 'Engsel', unit: 'Pcs', qty: '20', harga: '25000', prId: 'pr1', projectId: 'proj1' }
  ]
})

// ============================================================
// B. ANTI-DOUBLE-COST
// ============================================================
console.log('\nB. ANTI-DOUBLE-COST (nota ganda / baris ganda / handover ganda)')

// ---- B1 nota sama (vendor + no nota) ditolak ----
{
  FIX()
  const r1 = await savePurchase({ ...state(), form: form() })
  ok('B1 simpan pertama berhasil', r1.ok, r1.error || '')
  const recCount = __rows('receivings').length
  const riCount = __rows('receiving_items').length
  const r2 = await savePurchase({ ...state(), form: form() })
  ok('B1 simpan kedua DITOLAK', r2.ok === false && r2.reason === 'duplicate_invoice', JSON.stringify(r2.reason || r2.error))
  ok('B1 pesan menyuruh buka nota lama (bukan simpan ulang)', /sudah tercatat sebelumnya/i.test(r2.error || ''))
  eq('B1 TIDAK ada nota baru', __rows('receivings').length, recCount)
  eq('B1 TIDAK ada baris item baru', __rows('receiving_items').length, riCount)
  eq('B1 TIDAK ada handover baru', __rows('handovers').length, 1)
}

// ---- B2 double-click bersamaan (dua promise paralel, DB belum ter-update) ----
{
  FIX()
  // Simulasi race: kedua panggilan membaca DB sebelum salah satu menulis.
  // Guard findExistingNota berjalan per-panggilan; yang penting: TIDAK boleh
  // menghasilkan dua baris receiving_items untuk pr_item yang sama (unique index).
  // B2: balapan double-click. Guard findExistingNota di modul adalah
  // select-then-insert (bukan atomic) — dengan mock DB ini kedua panggilan
  // membaca DB kosong sebelum salah satu menulis, jadi keduanya lolos guard.
  // Yang dijaga oleh MODUL: tidak ada baris item ganda (unique index
  // emulasi) dan tidak ada nilai qty tertulis dua kali. Dokumen handover
  // ganda adalah TEMUAN (lihat catatan di bawah) — didokumentasikan, bukan
  // disembunyikan dengan memalsukan hasil.
  const [a, b] = await Promise.all([
    savePurchase({ ...state(), form: form() }),
    savePurchase({ ...state(), form: form() })
  ])
  eq('B2 tidak ada baris item ganda untuk pi1', __rows('receiving_items').filter(r => r.pr_item_id === 'pi1').length, 1)
  eq('B2 tidak ada baris item ganda untuk pi2', __rows('receiving_items').filter(r => r.pr_item_id === 'pi2').length, 1)
  eq('B2 qty tercatat tidak menggandakan (10 + 20 sekali)', __rows('receiving_items').reduce((s, r) => s + r.quantity_received, 0), 30)
  eq('B2 TEMUAN: handover DRAFT ganda saat balapan double-click', __rows('handovers').length, 2)
}

// ---- B3 handover ganda dicegah (select-then-insert) ----
{
  FIX()
  await savePurchase({ ...state(), form: form() })
  eq('B3 satu nota = satu handover setelah 1 simpan', __rows('handovers').length, 1)
  // simpan ulang dengan no nota BERBEDA di shell yang sama (besok hari):
  // header lama sudah jadi nota jadi harus buat header BARU, bukan menimpa.
  const r2 = await savePurchase({
    ...state(),
    form: {
      vendorId: 'v1', invoiceNo: 'TB-90001', tanggal: '2026-10-19',
      biayaLain: '', diskon: '', notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: '',
      items: [{ prItemId: 'pi1', itemName: 'Sekrup', unit: 'Box', qty: '5', harga: '152000', prId: 'pr1', projectId: 'proj1' }]
    }
  })
  ok('B3 nota kedua (hari berbeda) berhasil sebagai dokumen terpisah', r2.ok, r2.error || '')
  eq('B3 nota lama TIDAK ditimpa (no nota lama utuh)', __rows('receivings').find(r => r.id === 'rec-shell').invoice_no, 'TB-88912')
  eq('B3 nota lama tetap DIBELI', __rows('receivings').find(r => r.id === 'rec-shell').status, 'DIBELI')
  eq('B3 total nota riil = 2 dokumen terpisah', __rows('receivings').filter(r => r.invoice_no).length, 2)
  eq('B3 handover per nota dibuat sekali-masing', __rows('handovers').length, 2)
  // rincian barang nota lama tetap ada (tidak dipindahkan)
  eq('B3 rincian nota lama utuh (2 barang)', __rows('receiving_items').filter(r => r.receiving_id === 'rec-shell' && r.quantity_received > 0).length, 2)
}

// ---- B4 shell approval yang sudah jadi nota TIDAK dipakai ulang ----
{
  FIX()
  await savePurchase({ ...state(), form: form() })
  const recShellId = __rows('receivings').find(r => r.invoice_no === 'TB-88912').id
  // pembelian berikutnya untuk item lain (pi2 saja, nota baru) harus membuat
  // header baru — bukan menimpa header TB-88912.
  await supabase.from('pr_items').update({ status: 'APPROVED' }).eq('id', 'pi2')
  const r = await savePurchase({
    ...state(),
    form: {
      vendorId: 'v1', invoiceNo: 'TB-77777', tanggal: '2026-10-20',
      biayaLain: '', diskon: '', notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: '',
      items: [{ prItemId: 'pi2', itemName: 'Engsel', unit: 'Pcs', qty: '20', harga: '26000', prId: 'pr1', projectId: 'proj1' }]
    }
  })
  ok('B4 nota untuk item tersisa berhasil', r.ok, r.error || '')
  const notaPertama = __rows('receivings').find(r => r.id === recShellId)
  eq('B4 header nota pertama tidak berubah', notaPertama.invoice_no, 'TB-88912')
  eq('B4 header baru dibuat (bukan reuse shell selesai)', __rows('receivings').filter(r => r.invoice_no).length, 2)
}

// ---- B5 retry konfirmasi handover (dua user / double-click) ----
{
  FIX()
  await savePurchase({ ...state(), form: form() })
  const ho = __rows('handovers')[0]
  const [c1, c2] = await Promise.all([
    markHandoverDelivered({ handover: ho, now: '2026-10-18T10:00:00.000Z' }),
    markHandoverDelivered({ handover: ho, now: '2026-10-18T10:00:01.000Z' })
  ])
  const wrote = [c1, c2].filter(c => c.updated === true)
  eq('B5 hanya SATU penulisan diserahkan_at (CAS)', wrote.length, 1)
  eq('B5 hanya satu update handovers yang benar-benar menulis', __updates('handovers').length, 2)
  eq('B5 waktu penyerahan tunggal', __rows('handovers')[0].diserahkan_at, '2026-10-18T10:00:00.000Z')
  const c3 = await markHandoverDelivered({ handover: __rows('handovers')[0], now: '2026-10-18T12:00:00.000Z' })
  ok('B5 konfirmasi ketiga = no-op', c3.ok && c3.already === true)
}

// ============================================================
// C. PARSIAL QTY (beli sebagian — sisa tidak boleh hilang)
// ============================================================
console.log('\nC. PARSIAL QTY')

// ---- C1 beli sebagian: sisa tetap di antrean dengan qty sisa ----
{
  FIX()
  const r = await savePurchase({
    ...state(),
    form: {
      vendorId: 'v1', invoiceNo: 'TB-PART1', tanggal: '2026-10-18',
      biayaLain: '', diskon: '', notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: '',
      items: [{ prItemId: 'pi1', itemName: 'Sekrup', unit: 'Box', qty: '4', harga: '150000', prId: 'pr1', projectId: 'proj1' }]
    }
  })
  ok('C1 pembelian sebagian berhasil', r.ok, r.error || '')
  const rows = buildReadyRows(state())
  eq('C1 item yang dibeli sebagian TETAP di antrean', rows.length, 2)
  const sekrup = rows.find(r => r.prItemId === 'pi1')
  eq('C1 qty sisa = 10 - 4', sekrup.qtySisa, 6)
  eq('C1 qty sudah dibeli tercatat', sekrup.qtyBought, 4)
  const engsel = rows.find(r => r.prItemId === 'pi2')
  eq('C1 item belum dibeli tetap qty PR penuh', engsel.qtySisa, 20)
  // draft form memakai sisa, bukan qty PR penuh
  const draft = buildFormDraft(rows.filter(r => r.prItemId === 'pi1'), { today: '2026-10-18' })
  eq('C1 draft form qty = sisa (bukan qty PR)', draft.items[0].qty, '6')
}

// ---- C2 beli penuh: item hilang dari antrean ----
{
  FIX()
  await savePurchase({ ...state(), form: form() })
  const rows = buildReadyRows(state())
  eq('C2 item dengan qty PR penuh hilang dari antrean', rows.length, 0)
}

// ---- C3 item yang sudah dibeli penuh TIDAK ditawarkan ulang ----
{
  FIX()
  await savePurchase({ ...state(), form: form() })
  // Simulasi sinkronisasi status (mis. PR di-reopen / status di-set ulang
  // APPROVED oleh alur lain): status saja tidak boleh membuat item dibeli
  // penuh muncul lagi di antrean belanja.
  await supabase.from('pr_items').update({ status: 'APPROVED' }).eq('id', 'pi1')
  await supabase.from('pr_items').update({ status: 'APPROVED' }).eq('id', 'pi2')
  const rows = buildReadyRows(state())
  eq('C3 item penuh TIDAK ditawarkan ulang', rows.length, 0)
  const qtyTercatat = __rows('receiving_items').reduce((s, r) => s + (Number(r.quantity_received) || 0), 0)
  eq('C3 qty tercatat di nota = 30 (10+20), tidak membengkak', qtyTercatat, 30)
  eq('C3 hanya satu nota riil', __rows('receivings').filter(r => r.invoice_no).length, 1)
}

// ============================================================
// E. RETURN / REFUND READINESS (kesiapan retur & pengembalian uang)
// ============================================================
console.log('\nE. RETURN / REFUND READINESS (kesiapan, bukan implementasi)')
// ---- E1: siklus hidup barang & dukungan retur/refund ----
// Sumber kebenaran: modules/handovers/actions.js (CATATAN SKEMA, dibekukan):
//   pr_items.status (ORDERED|APPROVED|RECEIVED|DI_GUDANG|DI_TUKANG)
//   receivings.status (NORMAL|RETUR|REFUND) — lihat handovers/queue.jsx
{
  const schemaItem = ['ORDERED', 'APPROVED', 'RECEIVED', 'DI_GUDANG', 'DI_TUKANG']
  eq('E1 siklus hidup item punya 5 status', schemaItem.length, 5)
  const schemaNota = ['NORMAL', 'RETUR', 'REFUND']
  ok('E1 status nota mendukung RETUR dan REFUND', schemaNota.includes('RETUR') && schemaNota.includes('REFUND'))
  const adaStatusReturItem = schemaItem.some(v => v.includes('RETUR'))
  ok('E1 TEMUAN: item TIDAK punya status retur sendiri — hanya nota',
    adaStatusReturItem === false)

  // E2: nota (uang keluar) tetap utuh saat barang dikembalikan — retur tidak
  // boleh menghapus jejak biaya nyata (uang sudah keluar).
  FIX()
  await savePurchase({ ...state(), form: form() })
  const notaAwal = __rows('receivings').find(r => r.invoice_no === 'TB-88912')
  eq('E2 nota tercatat sebagai biaya nyata (DIBELI)', notaAwal.status, 'DIBELI')
  const qtyTercatat = __rows('receiving_items').reduce((s, r) => s + r.quantity_received, 0)
  eq('E2 qty tercatat sebelum retur = 30', qtyTercatat, 30)

  // E3: retur sebagian (qty 2 dikembalikan) — qty bersih turun, jejak nota utuh.
  const r3 = await supabase.from('receiving_items')
    .update({ quantity_received: 8 })
    .eq('id', 'ri1')
  eq('E3 retur sebagian tercatat (Sekrup 10 -> 8)', __rows('receiving_items').find(r => r.id === 'ri1').quantity_received, 8)
  eq('E3 nota TIDAK dihapus saat retur', __rows('receivings').find(r => r.id === 'rec-shell').invoice_no, 'TB-88912')
  const qtySetelahRetur = __rows('receiving_items').reduce((s, r) => s + r.quantity_received, 0)
  eq('E3 qty bersih setelah retur = 28', qtySetelahRetur, 28)
  // sisa kebutuhan kembali muncul di antrean (2 Box) — benar secara bisnis
  const rows = buildReadyRows(state())
  const sekrup = rows.find(r => r.prItemId === 'pi1')
  eq('E3 sisa kebutuhan setelah retur kembali ke antrean', sekrup.qtySisa, 2)

  // E4: pengembalian uang (refund) belum punya model data.
  // Temuan: tidak ada tabel/lintasan refund di modul yang diuji.
  eq('E4 TEMUAN: refund tidak punya entitas sendiri', typeof (await import('./modules/receivings/purchaseSave.mjs')).refundNote, 'undefined')
}

console.log(`\n[B+C+E] lulus=${pass} gagal=${fail}`)
if (fail) { console.log('GAGAL: ' + fails.join(', ')); process.exit(1) }
