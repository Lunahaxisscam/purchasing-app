// ============================================================
// LOGIC TEST — purchaseLogic.js + lib/purchaseNote.js + purchaseSave.js
// (verbatim hasil SWC). Bagian A (logika murni), A7 (kontrak catatan),
// A8 (acuan harga historis), B (simpan dengan mock DB perekam).
// Tanpa DB / jaringan.
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const L = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/purchaseLogic.mjs')).href)
const N = await import(pathToFileURL(path.join(SB, 'dist/lib/purchaseNote.mjs')).href)
const S = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/purchaseSave.mjs')).href)
const ACUAN = await import(pathToFileURL(path.join(SB, 'dist/modules/materials/acuan.mjs')).href)
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------------- Fixtures ----------------
const PROJECTS = [
  { id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }
]
const VENDORS = [
  { id: 'v1', name: 'TB Sumber Jaya' },
  { id: 'v2', name: 'Toko Mitra Fitting' }
]
const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
  { id: 'm2', kode: 'HWF-0001', name: 'Sekrup 3cm', category: 'Hardware & Fitting', satuan: 'Box', harga_acuan: null }
]
const REQUESTS = [
  { id: 'pr1', pr_number: 'PR-001', title: 'Material dinding', project_id: 'p1', status: 'APPROVED' },
  { id: 'pr2', pr_number: 'PR-002', title: 'Fitting kabinet', project_id: 'p2', status: 'APPROVED' }
]
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1', sort_order: 0 },
  { id: 'pi2', pr_id: 'pr1', material_id: 'm2', item_name: 'Sekrup 3cm', kode: 'HWF-0001', unit: 'Box', quantity: 2, estimated_price: 35000, status: 'APPROVED', vendor_id: 'v1', sort_order: 1 },
  { id: 'pi3', pr_id: 'pr2', material_id: 'm2', item_name: 'Sekrup 3cm', kode: 'HWF-0001', unit: 'Box', quantity: 5, estimated_price: 34000, status: 'APPROVED', vendor_id: 'v2', sort_order: 0 },
  // status belum disetujui -> TIDAK boleh muncul di Siap Dibeli
  { id: 'pi4', pr_id: 'pr2', material_id: 'm1', item_name: 'Triplek 12mm', kode: 'PLY-0009', unit: 'Lembar', quantity: 3, estimated_price: 200000, status: 'PENDING_APPROVAL', vendor_id: null, sort_order: 1 },
  // sudah dibeli (ada nota DIBELI) -> tidak muncul
  { id: 'pi5', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm (sudah beli)', kode: 'PLY-0001', unit: 'Lembar', quantity: 2, estimated_price: 118000, status: 'APPROVED', vendor_id: 'v1', sort_order: 2 },
  // qty>0 di nota lama -> tidak muncul (sudah pernah diproses)
  { id: 'pi6', pr_id: 'pr1', material_id: 'm2', item_name: 'Sekrup (data lama)', kode: 'HWF-0001', unit: 'Box', quantity: 1, estimated_price: 30000, status: 'ORDERED', vendor_id: 'v1', sort_order: 3 }
]
const RECEIVINGS = [
  // nota DIBELI (alur baru) untuk pi5
  { id: 'rcNew', vendor_id: 'v1', invoice_no: 'TB-001', status: 'DIBELI', received_date: '2026-10-16', note: '[Nominal: Rp 236.000] [Tahap: DIBELI]', project_id: 'p1', purchase_request_id: 'pr1' },
  // nota lama (LEGACY) — punya no. nota, bukan DIBELI
  { id: 'rcOld', vendor_id: 'v2', invoice_no: 'INV-LAMA-1', status: 'NORMAL', received_date: '2026-10-10', note: '[Nominal: Rp 865.000] Nota lama TB Makmur', project_id: 'p2', purchase_request_id: 'pr2' },
  // cangkang otomatis dari Approval (belum dibeli, tanpa no. nota)
  { id: 'rcShell', vendor_id: null, invoice_no: null, status: 'NORMAL', received_date: null, note: 'Dibuat otomatis dari PR (barang disetujui).', project_id: 'p1', purchase_request_id: 'pr1' }
]
const RECEIVING_ITEMS = [
  { id: 'ri5', receiving_id: 'rcNew', pr_item_id: 'pi5', item_name: 'Triplek 9mm (sudah beli)', unit: 'Lembar', quantity_received: 2, note: '[Harga: 118000]' },
  { id: 'ri6', receiving_id: 'rcOld', pr_item_id: 'pi6', item_name: 'Sekrup (data lama)', unit: 'Box', quantity_received: 1, note: null }
]

const baseData = {
  prItems: PR_ITEMS, requests: REQUESTS, projects: PROJECTS, vendors: VENDORS,
  materials: MATERIALS, receivings: RECEIVINGS, receivingItems: RECEIVING_ITEMS
}

console.log('=== A. LOGIKA MODUL PURCHASE (purchaseLogic.js verbatim) ===\n')

// ---------- A1: tab Siap Dibeli ----------
console.log('A1. Tab "Siap Dibeli": hanya APPROVED/ORDERED yang belum dibeli')
{
  const rows = L.buildReadyRows(baseData)
  const ids = rows.map(r => r.prItemId)
  check('A1a pi1 (APPROVED, belum dibeli) tampil', ids.includes('pi1'))
  check('A1b pi2 (APPROVED) tampil', ids.includes('pi2'))
  check('A1c pi3 (APPROVED, vendor lain) tampil', ids.includes('pi3'))
  check('A1d pi4 (PENDING_APPROVAL) TIDAK tampil', !ids.includes('pi4'))
  check('A1e pi5 (sudah ada nota DIBELI) TIDAK tampil', !ids.includes('pi5'))
  check('A1f pi6 (qty>0 nota lama) TIDAK tampil', !ids.includes('pi6'))
  check('A1g total 3 barang siap dibeli', rows.length === 3, String(rows.length))
  const pi1 = rows.find(r => r.prItemId === 'pi1')
  check('A1h qty PR terbawa', pi1?.qtyPr === 4)
  check('A1i nama proyek berlabel kode', pi1?.projectName === '[99] Baroni', String(pi1?.projectName))
  check('A1j vendor dari PR terbawa', pi1?.vendorName === 'TB Sumber Jaya')
  check('A1k estimasi dibawa sebagai pembanding', pi1?.estimasi === 120000)
  check('A1l harga acuan master dibawa', pi1?.hargaAcuan === 120000)
  check('A1m kategori dari master material', pi1?.kategori === 'Plywood & Board')
  // urutan stabil: vendor dikenal lebih dulu
  check('A1n urutan: vendor tercatat di atas', rows[0].vendorName !== '' && rows[rows.length - 1].vendorName !== '')
}

// ---------- A1b: pembelian sebagian ----------
console.log('\nA1b. Beli sebagian: sisa kebutuhan tetap di Siap Dibeli (tidak hilang)')
{
  const prItem = { id: 'piP', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity: 10, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1' }
  const recs = [{ id: 'rcP', vendor_id: 'v1', invoice_no: 'TB-P', status: 'DIBELI', received_date: '2026-10-16', note: '[Nominal: Rp 472.000] [Tahap: DIBELI]' }]
  const items = [{ id: 'riP', receiving_id: 'rcP', pr_item_id: 'piP', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 118000]' }]
  const rows = L.buildReadyRows({ prItems: [prItem], requests: REQUESTS, projects: PROJECTS, vendors: VENDORS, materials: MATERIALS, receivings: recs, receivingItems: items })
  check('A1b1 item masih tampil (beli 4 dari 10)', rows.length === 1, String(rows.length))
  check('A1b2 qty PR tetap 10', rows[0]?.qtyPr === 10, String(rows[0]?.qtyPr))
  check('A1b3 qty sudah dibeli = 4', rows[0]?.qtyBought === 4, String(rows[0]?.qtyBought))
  check('A1b4 sisa = 6', rows[0]?.qtySisa === 6, String(rows[0]?.qtySisa))
  const d = L.buildFormDraft(rows, { vendorId: 'v1' })
  check('A1b5 qty default form = sisa (6), bukan 10', d.items[0]?.qty === '6', d.items[0]?.qty)

  // beli PENUH -> hilang dari daftar
  const itemsFull = [{ ...items[0], quantity_received: 10 }]
  const rowsFull = L.buildReadyRows({ prItems: [prItem], requests: REQUESTS, projects: PROJECTS, vendors: VENDORS, materials: MATERIALS, receivings: recs, receivingItems: itemsFull })
  check('A1b6 beli penuh -> item hilang dari Siap Dibeli', rowsFull.length === 0, String(rowsFull.length))

  // beli LEBIH (over) -> juga hilang, tidak muncul sisa negatif
  const itemsOver = [{ ...items[0], quantity_received: 12 }]
  const rowsOver = L.buildReadyRows({ prItems: [prItem], requests: REQUESTS, projects: PROJECTS, vendors: VENDORS, materials: MATERIALS, receivings: recs, receivingItems: itemsOver })
  check('A1b7 beli lebih -> item hilang (tanpa sisa negatif)', rowsOver.length === 0, String(rowsOver.length))
}

// ---------- A2: filter ----------
console.log('\nA2. Filter per toko & per proyek (opsi dari data nyata)')
{
  const rows = L.buildReadyRows(baseData)
  const opt = L.readyFilterOptions(rows)
  check('A2a opsi vendor = 2 (v1, v2)', opt.vendors.length === 2, JSON.stringify(opt.vendors.map(v => v.name)))
  check('A2b opsi proyek = 2', opt.projects.length === 2)
  check('A2c tanpa vendor dihitung terpisah', opt.tanpaVendor === 0, String(opt.tanpaVendor))
  const byV1 = L.filterReadyRows(rows, { vendorId: 'v1' })
  check('A2d filter v1 -> 2 barang', byV1.length === 2, String(byV1.length))
  check('A2e filter v1 hanya barang v1', byV1.every(r => r.vendorId === 'v1'))
  const byP2 = L.filterReadyRows(rows, { projectId: 'p2' })
  check('A2f filter proyek p2 -> 1 barang', byP2.length === 1 && byP2[0].prItemId === 'pi3')
  const byQ = L.filterReadyRows(rows, { q: 'sekrup' })
  check('A2g pencarian teks case-insensitive', byQ.length === 2, String(byQ.length))
  check('A2h filter kosong -> semua', L.filterReadyRows(rows, {}).length === rows.length)
}

// ---------- A3: draft form ----------
console.log('\nA3. Draft form: qty default PR, harga riil KOSONG (bukan estimasi)')
{
  const rows = L.buildReadyRows(baseData).filter(r => r.vendorId === 'v1')
  const d = L.buildFormDraft(rows, { vendorId: 'v1', today: '2026-10-17' })
  const it1 = d.items.find(x => x.prItemId === 'pi1')
  const it2 = d.items.find(x => x.prItemId === 'pi2')
  check('A3a vendor terisi', d.vendorId === 'v1')
  check('A3b tanggal default hari ini', d.tanggal === '2026-10-17')
  check('A3c no. nota kosong (harus diisi admin)', d.invoiceNo === '')
  check('A3d 2 baris item', d.items.length === 2)
  check('A3e qty default = qty PR', it1?.qty === '4' && it2?.qty === '2', `${it1?.qty}/${it2?.qty}`)
  check('A3f harga riil KOSONG (tidak memakai estimasi)', it1?.harga === '' && it2?.harga === '')
  check('A3g estimasi tetap tersedia sebagai pembanding', it1?.estimasi === 120000, String(it1?.estimasi))
  check('A3h biaya lain & diskon kosong', d.biayaLain === '' && d.diskon === '')
}

// ---------- A4: hitungan ----------
console.log('\nA4. Subtotal & total nota (dibulatkan, biaya lain dipisah)')
{
  const c = L.computeItem({ qty: '3', harga: '118500' })
  check('A4a subtotal = qty × harga', c.subtotal === 355500, String(c.subtotal))
  const c2 = L.computeItem({ qty: '2.5', harga: '33333' })
  check('A4b desimal dibulatkan (Math.round)', c2.subtotal === 83333, String(c2.subtotal))
  check('A4c qty 0 -> subtotal null (bukan 0)', L.computeItem({ qty: '0', harga: '1000' }).subtotal === null)
  check('A4d harga kosong -> subtotal null', L.computeItem({ qty: '1', harga: '' }).subtotal === null)
  const t = L.computeTotals({
    items: [{ qty: '4', harga: '118000' }, { qty: '2', harga: '35000' }],
    biayaLain: '25000', diskon: '10000'
  })
  check('A4e material = 472.000 + 70.000', t.material === 542000, String(t.material))
  check('A4f biaya lain tercatat terpisah', t.biayaLain === 25000)
  check('A4g diskon tercatat terpisah', t.diskon === 10000)
  check('A4h total nota = material + biaya - diskon', t.total === 557000, String(t.total))
  check('A4i jumlah item terisi', t.terisi === 2)
  const tNeg = L.computeTotals({ items: [{ qty: '1', harga: '5000' }], diskon: '9000' })
  check('A4j total tidak negatif (diskon > material -> 0)', tNeg.total === 0, String(tNeg.total))
}

// ---------- A5: validasi ----------
console.log('\nA5. Validasi form (nol tulisan bila tidak valid)')
{
  const good = {
    vendorId: 'v1', invoiceNo: 'TB-88912', tanggal: '2026-10-17',
    items: [{ prItemId: 'pi1', qty: '4', harga: '118000' }]
  }
  const ok = L.validatePurchaseForm(good, { vendors: VENDORS })
  check('A5a form lengkap -> valid', ok.valid === true, JSON.stringify(ok.errors))
  check('A5b total dihitung', ok.totals.total === 472000, String(ok.totals.total))

  const noVendor = L.validatePurchaseForm({ ...good, vendorId: '' }, { vendors: VENDORS })
  check('A5c tanpa vendor -> invalid + pesan', !noVendor.valid && /Toko \/ Vendor wajib/.test(noVendor.errors[0]), JSON.stringify(noVendor.errors))

  const noInvoice = L.validatePurchaseForm({ ...good, invoiceNo: '   ' }, { vendors: VENDORS })
  check('A5d tanpa no. nota -> invalid', !noInvoice.valid && noInvoice.errors.some(e => /No\. Invoice/.test(e)))

  const noDate = L.validatePurchaseForm({ ...good, tanggal: '' }, { vendors: VENDORS })
  check('A5e tanpa tanggal -> invalid', !noDate.valid && noDate.errors.some(e => /Tanggal/.test(e)))

  const badItem = L.validatePurchaseForm({
    ...good, items: [{ prItemId: 'pi1', qty: '0', harga: '0' }]
  }, { vendors: VENDORS })
  check('A5f qty 0 & harga 0 -> invalid per item', !badItem.valid && !!badItem.itemErrors.pi1?.qty && !!badItem.itemErrors.pi1?.harga)

  const unknownVendor = L.validatePurchaseForm({ ...good, vendorId: 'vX' }, { vendors: VENDORS })
  check('A5g vendor tak dikenal -> invalid', !unknownVendor.valid)

  const noItems = L.validatePurchaseForm({ ...good, items: [] }, { vendors: VENDORS })
  check('A5h tanpa item -> invalid', !noItems.valid)

  // buildSavePlan hanya mengikutkan item yang lengkap
  const plan = L.buildSavePlan({
    ...good,
    items: [
      { prItemId: 'pi1', itemName: 'Triplek 9mm', unit: 'Lembar', qty: '4', harga: '118000' },
      { prItemId: 'pi2', itemName: 'Sekrup 3cm', unit: 'Box', qty: '2', harga: '' }
    ]
  })
  check('A5i plan hanya item dengan harga', plan.items.length === 1, String(plan.items.length))
  check('A5j penanda harga item ditulis', plan.items[0].itemNote === '[Harga: 118000]', String(plan.items[0].itemNote))
  check('A5k header material & total benar', plan.header.material === 472000 && plan.header.total === 472000)
}

// ---------- A6: riwayat ----------
console.log('\nA6. Tab Riwayat: nota DIBELI + nota lama, cangkang tidak tampil')
{
  const rows = L.buildHistoryRows(baseData)
  const ids = rows.map(r => r.id)
  check('A6a nota DIBELI tampil', ids.includes('rcNew'))
  check('A6b nota lama (LEGACY) tampil', ids.includes('rcOld'))
  check('A6c cangkang otomatis TIDAK tampil', !ids.includes('rcShell'))
  const newRow = rows.find(r => r.id === 'rcNew')
  check('A6d kind DIBELI benar', newRow.kind === 'PURCHASED')
  check('A6e total nota terbaca', newRow.total === 236000, String(newRow.total))
  check('A6f jumlah item benar', newRow.itemCount === 1)
  check('A6g vendor terbaca', newRow.vendorName === 'TB Sumber Jaya')
  check('A6h nama proyek berlabel', newRow.projectName === '[99] Baroni')
  const legacy = rows.find(r => r.id === 'rcOld')
  check('A6i nota lama ditandai LEGACY', legacy.kind === 'LEGACY')
  check('A6j nota lama tetap punya total', legacy.total === 865000)
  check('A6k nota lama tanpa harga satuan item (jujur, bukan 0)', legacy.items[0].note === null)
  // urutan: terbaru dulu
  check('A6l urutan tanggal terbaru dulu', rows[0].date >= rows[1].date, `${rows[0].date} vs ${rows[1].date}`)
  const ring = L.historySummary(newRow)
  check('A6m ringkasan item menyebut nama barang', /Triplek/.test(ring.text), ring.text)
  check('A6n ringkasan nota tanpa item jujur', L.historySummary({ itemCount: 0, items: [] }).text === 'Rincian barang tidak tercatat')
}

// ---------- A7: kontrak catatan nota ----------
console.log('\nA7. Kontrak catatan nota (lib/purchaseNote.js)')
{
  const built = N.buildPurchaseNote({
    material: 542000, biayaLain: 25000, diskon: 10000,
    notaUrl: 'https://drive.google.com/x', buktiNota: 'data:image/jpeg;base64,AAA',
    buktiTransfer: 'data:image/jpeg;base64,BBB', catatan: 'ongkir 25rb', tahap: 'DIBELI'
  })
  const p = N.parsePurchaseNote(built)
  check('A7a nominal material terbaca', p.material === 542000, String(p.material))
  check('A7b biaya lain terbaca terpisah', p.biayaLain === 25000)
  check('A7c diskon terbaca terpisah', p.diskon === 10000)
  check('A7d total = material + biaya - diskon', p.total === 557000, String(p.total))
  check('A7e referensi nota terbaca', p.notaUrl === 'https://drive.google.com/x')
  check('A7f bukti nota terbaca', p.buktiNota === 'data:image/jpeg;base64,AAA')
  check('A7g bukti transfer terbaca', p.buktiTransfer === 'data:image/jpeg;base64,BBB')
  check('A7h penanda tahap terbaca', p.tahap === 'DIBELI')
  check('A7i catatan bebas bersih dari penanda', p.catatan === 'ongkir 25rb', p.catatan)

  // data lama tanpa penanda: teks utuh, angka null
  const old = N.parsePurchaseNote('Nota lama TB Makmur, bayar cash')
  check('A7j data lama: material null', old.material === null)
  check('A7k data lama: total null (tidak mengarang)', old.total === null)
  check('A7l data lama: teks masuk catatan', old.catatan === 'Nota lama TB Makmur, bayar cash')

  // [Nominal] tetap kompatibel dengan parser Finance (format lama)
  check('A7m [Nominal] tetap format lama yang dibaca Finance', /\[Nominal: Rp [\d.]+]/.test(built), built)
  // nilai 0 tidak ditulis
  const zero = N.buildPurchaseNote({ material: 100000, biayaLain: 0, diskon: 0 })
  check('A7n nilai 0 tidak menulis penanda', !/BiayaLain/.test(zero) && !/Diskon/.test(zero), zero)

  // isPurchasedNota
  check('A7o status DIBELI -> purchased', N.isPurchasedNota({ status: 'DIBELI' }) === true)
  check('A7p penanda tahap -> purchased (fallback constraint)', N.isPurchasedNota({ status: 'NORMAL', note: '[Tahap: DIBELI]' }) === true)
  check('A7q nota biasa -> bukan purchased', N.isPurchasedNota({ status: 'NORMAL', note: '[Nominal: Rp 5.000]' }) === false)

  // harga item
  check('A7r penanda harga item ditulis', N.buildItemPriceNote(118000) === '[Harga: 118000]')
  check('A7s penanda harga item terbaca', N.parseItemPrice('[Harga: 118000]') === 118000)
  check('A7t tanpa penanda harga -> null', N.parseItemPrice('catatan lain') === null)
  check('A7u harga 0 -> tidak menulis penanda', N.buildItemPriceNote(0) === null)
}

// ---------- A8: acuan harga historis ----------
console.log('\nA8. Harga satuan riil nota dibaca resolver acuan Material (HISTORIS)')
{
  const mat = { id: 'mH', kode: 'HPL-9001', name: 'Material Nota Baru', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: null }
  const prItem = { id: 'piH', pr_id: 'pr1', material_id: 'mH', item_name: 'Material Nota Baru', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED' }
  const rec = { id: 'rcH', vendor_id: 'v1', status: 'DIBELI', received_date: '2026-10-17', note: '[Nominal: Rp 460.000] [Tahap: DIBELI]' }
  const ri = { id: 'riH', receiving_id: 'rcH', pr_item_id: 'piH', item_name: 'Material Nota Baru', unit: 'Lembar', quantity_received: 4, note: '[Harga: 115000]' }
  const A = ACUAN.makeAcuanHelpers({
    allPrItems: [prItem], allReceivingItems: [ri], allReceivings: [rec], allVendors: [{ id: 'v1', name: 'TB Sumber Jaya' }]
  })
  const entries = A.entriesFor(mat)
  check('A8a ada 1 entri acuan', entries.length === 1, JSON.stringify(entries))
  check('A8b sumber HISTORIS (harga beli riil dari nota)', entries[0]?.source === 'HISTORIS', String(entries[0]?.source))
  check('A8c harga = 115.000 (BUKAN estimasi 120.000)', entries[0]?.price === 115000, String(entries[0]?.price))
  check('A8d provenance actual', entries[0]?.provenance === 'actual')
  check('A8e vendor dari nota', entries[0]?.vendor === 'TB Sumber Jaya')
  check('A8f bestEntry memakai harga historis', A.bestEntry(mat)?.source === 'HISTORIS')

  // tanpa [Harga] -> tetap PR_ESTIMATE (tidak dipromosikan)
  const riNoPrice = { ...ri, note: null }
  const A2 = ACUAN.makeAcuanHelpers({ allPrItems: [prItem], allReceivingItems: [riNoPrice], allReceivings: [rec], allVendors: [] })
  const e2 = A2.entriesFor(mat)
  check('A8g tanpa harga nota -> PR_ESTIMATE (bukan HISTORIS)', e2[0]?.source === 'PR_ESTIMATE', String(e2[0]?.source))
  check('A8h harganya estimasi PR 120.000', e2[0]?.price === 120000)
  check('A8i [Nominal] total nota TIDAK dipakai sbg harga satuan', e2[0]?.price !== 460000)
}

console.log('\n=== B. SIMPAN NOTA (purchaseSave.js + mock DB) ===\n')

function formFixture(over = {}) {
  return {
    vendorId: 'v1',
    tanggal: '2026-10-17',
    invoiceNo: 'TB-88912',
    biayaLain: '25000',
    diskon: '0',
    notaUrl: '',
    buktiNota: '',
    buktiTransfer: '',
    catatan: 'diambil sendiri',
    items: [
      { prItemId: 'pi1', itemName: 'Triplek 9mm', unit: 'Lembar', qty: '4', harga: '118000' },
      { prItemId: 'pi2', itemName: 'Sekrup 3cm', unit: 'Box', qty: '2', harga: '35000' }
    ],
    ...over
  }
}

// ---------- B1: simpan normal ----------
console.log('B1. Simpan nota normal: header + baris barang + status DIBELI')
{
  mock.__reset({
    tables: {
      receivings: RECEIVINGS.map(r => ({ ...r })),
      receiving_items: RECEIVING_ITEMS.map(r => ({ ...r })),
      handovers: []
    }
  })
  const res = await S.savePurchase({
    form: formFixture(), receivings: RECEIVINGS, receivingItems: RECEIVING_ITEMS,
    prItems: PR_ITEMS, requests: REQUESTS, vendors: VENDORS
  })
  check('B1a simpan sukses', res.ok === true, res.error || '')
  const insertedHeader = mock.__callsOf('insert', 'receivings')[0]?.data
  check('B1b vendor tersimpan', insertedHeader?.vendor_id === 'v1')
  check('B1c no. nota tersimpan', insertedHeader?.invoice_no === 'TB-88912')
  check('B1d tanggal belanja tersimpan', insertedHeader?.received_date === '2026-10-17')
  check('B1e status DIBELI', insertedHeader?.status === 'DIBELI', String(insertedHeader?.status))
  check('B1f catatan memuat nominal material', /\[Nominal: Rp 542\.000]/.test(String(insertedHeader?.note)), String(insertedHeader?.note))
  check('B1g catatan memuat biaya lain', /\[BiayaLain: Rp 25\.000]/.test(String(insertedHeader?.note)))
  check('B1h catatan memuat penanda tahap', /\[Tahap: DIBELI]/.test(String(insertedHeader?.note)))
  const itemInserts = mock.__callsOf('insert', 'receiving_items').map(c => c.data)
  check('B1i 2 baris barang dibuat', itemInserts.length === 2, String(itemInserts.length))
  check('B1j qty beli tersimpan', itemInserts[0]?.quantity_received === 4)
  check('B1k harga satuan riil tersimpan di catatan item', itemInserts[0]?.note === '[Harga: 118000]', String(itemInserts[0]?.note))
  check('B1l pesan menyebut total nota', /567\.000/.test(res.message), res.message)
  check('B1m status tidak fallback', res.statusFallback === false)
}

// ---------- B2: anti dobel ----------
console.log('\nB2. Anti dobel: nota toko + nomor sama ditolak (nol tulisan)')
{
  mock.__reset({
    tables: {
      receivings: [
        { id: 'rcDup', vendor_id: 'v1', invoice_no: 'TB-88912', status: 'DIBELI', note: '[Tahap: DIBELI]', received_date: '2026-10-16' }
      ],
      receiving_items: [],
      handovers: []
    }
  })
  const res = await S.savePurchase({
    form: formFixture(), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B2a ditolak', res.ok === false && res.reason === 'duplicate_invoice', JSON.stringify(res))
  check('B2b pesan menyebut nomor nota', /TB-88912/.test(res.error), res.error)
  check('B2c NOL insert header', mock.__callsOf('insert', 'receivings').length === 0)
  check('B2d NOL insert item', mock.__callsOf('insert', 'receiving_items').length === 0)
}

// ---------- B3: cangkang dipakai ulang ----------
console.log('\nB3. Cangkang nota dari Approval DIPAKAI ULANG (tanpa duplikasi)')
{
  mock.__reset({
    tables: {
      receivings: [
        { id: 'rcShell2', vendor_id: null, invoice_no: null, status: 'NORMAL', note: 'Dibuat otomatis dari PR', project_id: 'p1', purchase_request_id: 'pr1' }
      ],
      receiving_items: [
        { id: 'riA', receiving_id: 'rcShell2', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 0, note: null },
        { id: 'riB', receiving_id: 'rcShell2', pr_item_id: 'pi2', item_name: 'Sekrup 3cm', unit: 'Box', quantity_received: 0, note: null }
      ],
      handovers: []
    }
  })
  const res = await S.savePurchase({
    form: formFixture({ biayaLain: '0', catatan: '' }),
    receivings: [{ id: 'rcShell2', purchase_request_id: 'pr1', project_id: 'p1' }],
    receivingItems: [
      { id: 'riA', receiving_id: 'rcShell2', pr_item_id: 'pi1' },
      { id: 'riB', receiving_id: 'rcShell2', pr_item_id: 'pi2' }
    ],
    vendors: VENDORS
  })
  check('B3a simpan sukses', res.ok === true, res.error || '')
  check('B3b TIDAK membuat header baru', mock.__callsOf('insert', 'receivings').length === 0)
  check('B3c header cangkang di-update', mock.__callsOf('update', 'receivings').length >= 1)
  const upd = mock.__callsOf('update', 'receivings')[0]?.data
  check('B3d vendor diisi pada cangkang', upd?.vendor_id === 'v1')
  check('B3e no. nota diisi pada cangkang', upd?.invoice_no === 'TB-88912')
  check('B3f status jadi DIBELI', upd?.status === 'DIBELI', String(upd?.status))
  check('B3g TIDAK ada baris item baru (dipakai ulang)', mock.__callsOf('insert', 'receiving_items').length === 0)
  const itemUpd = mock.__callsOf('update', 'receiving_items')
  check('B3h 2 baris item di-update', itemUpd.length === 2, String(itemUpd.length))
  check('B3i qty beli ditulis ke baris lama', itemUpd[0]?.data?.quantity_received === 4)
  check('B3j harga ditulis ke baris lama', itemUpd[0]?.data?.note === '[Harga: 118000]')
  check('B3k dilaporkan memakai ulang header', res.reusedHeader === true)
}

// ---------- B4: CHECK constraint menolak DIBELI ----------
console.log('\nB4. CHECK constraint menolak status DIBELI -> fallback penanda tahap')
{
  mock.__reset({
    tables: { receivings: [], receiving_items: [], handovers: [] },
    rejectDibeliStatus: true
  })
  const res = await S.savePurchase({
    form: formFixture(), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B4a nota TETAP tersimpan', res.ok === true, res.error || '')
  check('B4b fallback dilaporkan', res.statusFallback === true)
  check('B4c status ditulis NORMAL (nilai yang diizinkan)', res.status === 'NORMAL', String(res.status))
  const header = mock.__rows('receivings')[0]
  check('B4d penanda tahap ada di catatan', /\[Tahap: DIBELI]/.test(String(header?.note)), String(header?.note))
  check('B4e nota terbaca "sudah dibeli" lewat penanda', N.isPurchasedNota(header) === true)
  check('B4f pesan menjelaskan fallback', /Penanda tahap disimpan di catatan nota/.test(res.message), res.message)
}

// ---------- B5: antrean handover ----------
console.log('\nB5. Antrean Handover otomatis (dokumen DRAFT) + kegagalan jujur')
{
  mock.__reset({
    tables: { receivings: [], receiving_items: [], handovers: [] }
  })
  const res = await S.savePurchase({
    form: formFixture(), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B5a simpan sukses', res.ok === true)
  const ho = mock.__rows('handovers')
  check('B5b dokumen handover dibuat', ho.length === 1, String(ho.length))
  check('B5c status DRAFT (antrean belum diserahkan)', ho[0]?.status === 'DRAFT')
  check('B5d terhubung ke nota', ho[0]?.receiving_id === res.receivingId)
  check('B5e belum ada waktu penyerahan', !ho[0]?.diserahkan_at)
  check('B5f dilaporkan di pesan', /antrean Handover/.test(res.message), res.message)

  // idempoten: nota yang SUDAH punya handover tidak membuat dokumen kedua.
  // Mock memberi id header pertama "rec-1" (prefix tabel + urutan), jadi
  // handover dengan receiving_id "rec-1" mensimulasikan nota yang sudah punya
  // antrean sebelumnya.
  mock.__reset({
    tables: {
      receivings: [], receiving_items: [],
      handovers: [{ id: 'hoExist', receiving_id: 'rec-1', status: 'DRAFT' }]
    }
  })
  const res2 = await S.savePurchase({
    form: formFixture({ invoiceNo: 'TB-99999' }), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B5g nota yang sudah punya antrean tidak membuat dokumen kedua', res2.ok === true && res2.handoverQueued === true && mock.__rows('handovers').length === 1, `${mock.__rows('handovers').length}`)

  // nota lain (receiving_id berbeda) tetap mendapat antrean sendiri
  mock.__reset({
    tables: {
      receivings: [], receiving_items: [],
      handovers: [{ id: 'hoLain', receiving_id: 'nota-lain', status: 'DRAFT' }]
    }
  })
  const res2b = await S.savePurchase({
    form: formFixture({ invoiceNo: 'TB-88888' }), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B5h nota lain tetap mendapat antrean sendiri', res2b.ok === true && mock.__rows('handovers').length === 2, String(mock.__rows('handovers').length))

  // gagal insert handover -> nota tetap tersimpan + pesan jujur
  mock.__reset({
    tables: { receivings: [], receiving_items: [], handovers: [] },
    failInsertTable: 'handovers'
  })
  const res3 = await S.savePurchase({
    form: formFixture({ invoiceNo: 'TB-77777' }), receivings: [], receivingItems: [], vendors: VENDORS
  })
  check('B5i nota tetap tersimpan walau handover gagal', res3.ok === true, res3.error || '')
  check('B5j error handover dilaporkan', !!res3.handoverError && res3.handoverQueued === false)
  check('B5k pesan menyebut tindakan manual', /tambahkan dokumen serah terima manual/.test(res3.message), res3.message)
}

// ---------- B6: validasi awal ----------
console.log('\nB6. Validasi awal: nol tulisan bila data belum lengkap')
{
  mock.__reset({ tables: { receivings: [], receiving_items: [], handovers: [] } })
  const noVendor = await S.savePurchase({ form: formFixture({ vendorId: '' }), vendors: VENDORS })
  check('B6a tanpa vendor ditolak', noVendor.ok === false)
  const noInvoice = await S.savePurchase({ form: formFixture({ invoiceNo: '  ' }), vendors: VENDORS })
  check('B6b tanpa no. nota ditolak', noInvoice.ok === false)
  const noItems = await S.savePurchase({ form: formFixture({ items: [] }), vendors: VENDORS })
  check('B6c tanpa item ditolak', noItems.ok === false)
  check('B6d NOL tulisan sepanjang validasi', mock.__state.calls.filter(c => c.op === 'insert' || c.op === 'update').length === 0)
}

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`)
if (fail) {
  console.log('GAGAL:')
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
