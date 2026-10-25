// ============================================================
// crossflow_test.mjs — ALUR PENUH PR -> Approval -> Purchase -> Handover
// Bagian A dari harness t_796f8498. Tanpa DB: mock DB perekam +
// modul ASLI hasil transform SWC.
// ============================================================
import { __state, __reset, __rows, __inserts, __updates, supabase } from './lib/supabaseClient.mjs'
import { savePurchase } from './modules/receivings/purchaseSave.mjs'
import { buildReadyRows, buildFormDraft, validatePurchaseForm } from './modules/receivings/purchaseLogic.mjs'
import { markHandoverDelivered } from './modules/handovers/confirm.mjs'
import { summarizeDistribution, actionPlan, buildDistributionQueue } from './modules/handovers/logic.mjs'
import { isPurchasedNota } from './lib/purchaseNote.mjs'

let pass = 0, fail = 0
const fails = []
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}
function eq(name, got, want) { ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }

// ---------- FIXTURES LINTAS FLOW ----------
// Satu PR dengan 2 item. Approval membuat cangkang nota + baris item qty 0.
const FIX = () => {
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
      materials: [
        { id: 'mat1', category: 'Sekrup', harga_acuan: 160000 },
        { id: 'mat2', category: 'Engsel', harga_acuan: 26000 }
      ]
    }
  })
}
// state lengkap untuk buildReadyRows (butuh requests/projects/vendors/materials)
const state = () => ({
  prItems: __rows('pr_items'),
  requests: __rows('requests'),
  projects: __rows('projects'),
  vendors: __rows('vendors'),
  materials: __rows('materials'),
  receivings: __rows('receivings'),
  receivingItems: __rows('receiving_items')
})

const form = () => ({
  vendorId: 'v1',
  invoiceNo: 'TB-88912',
  tanggal: '2026-10-18',
  biayaLain: '5000',
  diskon: '',
  notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: 'beli toko',
  items: [
    { prItemId: 'pi1', itemName: 'Sekrup', unit: 'Box', qty: '10', harga: '150000', prId: 'pr1', projectId: 'proj1' },
    { prItemId: 'pi2', itemName: 'Engsel', unit: 'Pcs', qty: '20', harga: '25000', prId: 'pr1', projectId: 'proj1' }
  ]
})

// ============================================================
// A. ALUR PENUH
// ============================================================
console.log('\nA. ALUR PENUH PR -> Approval -> Purchase -> Handover')

// ---- A1 antrean belanja dari cangkang Approval ----
FIX()
{
  const rows = buildReadyRows(state())
  eq('A1 item APPROVED masuk antrean (2)', rows.length, 2)
  const pi1 = rows.find(r => r.prItemId === 'pi1')
  eq('A1 cangkang approval = qty PR penuh (bukan 0)', pi1.qtyPr, 10)
  eq('A1 estimasi ditampilkan sebagai pembanding', pi1.estimasi, 150000)
  const v = validatePurchaseForm(form(), { vendors: __rows('vendors') })
  ok('A1 form valid sebelum simpan', v.valid, JSON.stringify(v.errors))
  // material 10x150000 + 20x25000 = 2.000.000, + biaya lain 5.000
  eq('A1 total nota = material + biaya lain', v.totals.total, 2005000)
}

// ---- A2 simpan nota di atas cangkang: pakai ulang, tidak duplikasi ----
{
  FIX()
  const recBefore = __rows('receivings').length
  const riBefore = __rows('receiving_items').length
  const r = await savePurchase({ ...state(), form: form() })
  ok('A2 simpan nota berhasil', r.ok, r.error || '')
  eq('A2 header TIDAK diduplikasi (pakai ulang cangkang)', __rows('receivings').length, recBefore)
  eq('A2 baris item TIDAK diduplikasi', __rows('receiving_items').length, riBefore)
  const rec = __rows('receivings').find(x => x.id === 'rec-shell')
  eq('A2 nota jadi DIBELI', rec.status, 'DIBELI')
  eq('A2 no nota tercatat', rec.invoice_no, 'TB-88912')
  ok('A2 penanda tahap DIBELI di catatan', isPurchasedNota(rec))
  eq('A2 baris item 1 qty tercatat', __rows('receiving_items').find(x => x.id === 'ri1').quantity_received, 10)
  eq('A2 baris item 2 qty tercatat', __rows('receiving_items').find(x => x.id === 'ri2').quantity_received, 20)
  eq('A2 header nota menyimpan PR asal', rec.purchase_request_id, 'pr1')
  eq('A2 header nota menyimpan proyek', rec.project_id, 'proj1')
  eq('A2 insert handover DRAFT dibuat SEKALI', __inserts('handovers').length, 1)
  const ho = __rows('handovers')[0]
  eq('A2 handover terhubung ke nota', ho.receiving_id, 'rec-shell')
  eq('A2 handover status DRAFT (belum diklaim diserahkan)', ho.status, 'DRAFT')
  ok('A2 handover belum punya diserahkan_at', !ho.diserahkan_at)
}

// ---- A3 setelah dibeli, item hilang dari antrean belanja ----
{
  const rows = buildReadyRows(state())
  eq('A3 item yang sudah dibeli penuh hilang dari antrean', rows.length, 0)
}

// ---- A4 distribusi fisik + konfirmasi idempoten ----
{
  const ho = __rows('handovers')[0]
  const items = __rows('receiving_items')
  const summary = summarizeDistribution(ho, items, __rows('pr_items'))
  eq('A4 ringkasan total dari qty PR (10+20)', summary.total, 30)
  eq('A4 belum ada yang terdistribusi', summary.done, 0)
  const plan = actionPlan(ho, summary, null, __rows('receivings')[0])
  eq('A4 aksi gudang diizinkan', plan.find(a => a.testid === 'act-gudang').ok, true)
  eq('A4 aksi terima DITOLAK (belum ada barang bergerak)', plan.find(a => a.testid === 'act-terima').ok, false)
  eq('A4 alasan tolak terima jujur', plan.find(a => a.testid === 'act-terima').reason, 'Belum ada barang yang didistribusikan (gudang/tukang).')

  // aksi gudang: item -> DI_GUDANG
  for (const it of items) await supabase.from('pr_items').update({ status: 'DI_GUDANG' }).eq('id', it.pr_item_id)
  const s2 = summarizeDistribution(ho, items, __rows('pr_items'))
  eq('A4 setelah aksi gudang semua terdistribusi', s2.done, 30)
  ok('A4 allDone benar', s2.allDone === true)
  const plan2 = actionPlan(ho, s2, null, __rows('receivings')[0])
  eq('A4 aksi gudang kedua DITOLAK (idempoten)', plan2.find(a => a.testid === 'act-gudang').ok, false)
  eq('A4 aksi terima kini diizinkan', plan2.find(a => a.testid === 'act-terima').ok, true)

  // konfirmasi fisik
  const c1 = await markHandoverDelivered({ handover: ho, now: '2026-10-18T10:00:00.000Z' })
  ok('A4 konfirmasi pertama berhasil', c1.ok && c1.updated === true)
  eq('A4 diserahkan_at tercatat', __rows('handovers')[0].diserahkan_at, '2026-10-18T10:00:00.000Z')
  eq('A4 status CONFIRMED', __rows('handovers')[0].status, 'CONFIRMED')
  const c2 = await markHandoverDelivered({ handover: __rows('handovers')[0], now: '2026-10-18T11:00:00.000Z' })
  ok('A4 re-confirm = no-op (already)', c2.ok && c2.already === true)
  eq('A4 waktu penyerahan TIDAK ditimpa', __rows('handovers')[0].diserahkan_at, '2026-10-18T10:00:00.000Z')

  // antrean distribusi kosong setelah diserahkan
  eq('A4 handover selesai keluar dari antrean', buildDistributionQueue(__rows('handovers')).length, 0)
}

console.log(`\n[A] lulus=${pass} gagal=${fail}`)
if (fail) { console.log('GAGAL: ' + fails.join(', ')); process.exit(1) }
