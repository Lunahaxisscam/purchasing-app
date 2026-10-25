// logic_test.mjs — Unit and Logic Tests for Form Lapangan Adapter & Matcher
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()

// Dynamic imports from dist/
const {
  FIELD_FORM_SECTIONS,
  FIELD_FORM_ROWS_BY_ID,
  getAllTemplateRows
} = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/field-form/templateData.mjs')).href)

const {
  matchMaterialForRow,
  normalizeUnitAlias,
  checkUnitCompatibility,
  UNIT_ALIASES
} = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/field-form/matcher.mjs')).href)

const {
  convertFieldFormToPrSeed,
  validateFieldForm
} = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/field-form/adapter.mjs')).href)

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`  ✓ ${message}`)
}

console.log('=== PENGUJIAN LOGIKA: TEMPLATE DATA, MATCHER, & ADAPTER FORM LAPANGAN ===\n')

// 1. Template Data Tests
console.log('1. Verifikasi Template Data:')
const allRows = getAllTemplateRows()
assert(Array.isArray(allRows) && allRows.length >= 95, `Template memuat minimal 95 baris terpetakan (aktual: ${allRows.length})`)

const duplicateMelamin = allRows.filter(r => r.table === 'Triplek' && (r.spec === 'Melamin SF' || r.label === 'Melamin SF') && r.type === '6 mm')
assert(duplicateMelamin.length === 2, 'Melamin SF 6 mm memiliki 2 baris terpisah di template Triplek')
assert(duplicateMelamin[0].id !== duplicateMelamin[1].id, 'Dua baris Melamin SF 6 mm memiliki ID unik berbeda')

const duplicateTaco = allRows.filter(r => r.table === 'HPL' && (r.brand === 'Taco' || r.label === 'Taco'))
assert(duplicateTaco.length >= 3, 'HPL Taco memiliki minimal 3 baris terpisah')
const tacoIds = new Set(duplicateTaco.map(r => r.id))
assert(tacoIds.size === duplicateTaco.length, 'Semua baris HPL Taco memiliki ID unik berbeda')

// Check sections
const sections = FIELD_FORM_SECTIONS
assert(sections.length === 4, 'Tepat ada 4 kelompok besar (Dasar, Finishing, Aksesoris, Produksi)')
assert(sections[0].id === 'KEBUTUHAN_DASAR', 'Kelompok 1: Kebutuhan Dasar')
assert(sections[1].id === 'KEBUTUHAN_FINISHING', 'Kelompok 2: Kebutuhan Finishing')
assert(sections[2].id === 'KEBUTUHAN_AKSESORIS', 'Kelompok 3: Kebutuhan Aksesoris')
assert(sections[3].id === 'KEBUTUHAN_PRODUKSI', 'Kelompok 4: Kebutuhan Produksi')

// 2. Unit Alias and Compatibility Tests
console.log('\n2. Verifikasi Unit Aliases & Kompatibilitas:')
assert(normalizeUnitAlias('Lbr') === 'Lembar', 'Lbr dinormalisasi menjadi Lembar')
assert(normalizeUnitAlias('Mtr') === 'Meter', 'Mtr dinormalisasi menjadi Meter')
assert(normalizeUnitAlias('Btg') === 'Batang', 'Btg dinormalisasi menjadi Batang')
assert(normalizeUnitAlias('Psg') === 'Pasang', 'Psg dinormalisasi menjadi Pasang')
assert(normalizeUnitAlias('Buah') === 'Buah', 'Buah dipertahankan')
assert(normalizeUnitAlias('Pcs') === 'Pcs', 'Pcs dipertahankan')

const compatLbr = checkUnitCompatibility('Lbr', 'Lembar')
assert(compatLbr.compatible === true && compatLbr.isAlias === true, 'Lbr kompatibel dengan Lembar sebagai alias')

const compatPcsBatang = checkUnitCompatibility('Pcs', 'Batang')
assert(compatPcsBatang.compatible === false, 'Pcs TIDAK kompatibel secara implisit dengan Batang')
assert(compatPcsBatang.mismatch === true, 'Pcs vs Batang ditandai sebagai unit mismatch')

// 3. Matcher Tests
console.log('\n3. Verifikasi Matcher Master Material:')
const mockMaterials = [
  { id: 'm_ply18', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm_ply15', kode: 'PLY-0002', name: 'Triplek Polos 15mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 210000 },
  { id: 'm_ply6_a', kode: 'PLY-0003', name: 'Triplek Melamin SF 6mm Grade A', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 90000 },
  { id: 'm_ply6_b', kode: 'PLY-0004', name: 'Triplek Melamin SF 6mm Grade B', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 80000 },
  { id: 'm_hpl_taco_th123', kode: 'HPL-0001', name: 'HPL Taco TH 123 AA', category: 'HPL & Edging', satuan: 'Lembar', harga_acuan: 165000 },
  { id: 'm_list_t', kode: 'ALM-0001', name: 'List T Aluminium 8mm', category: 'Aluminium & Profil', satuan: 'Batang', harga_acuan: 35000 },
  { id: 'm_sekrup_3', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: 200 }
]

// Single exact match
const matchPly18 = matchMaterialForRow({
  rowDef: FIELD_FORM_ROWS_BY_ID['kd_triplek_polos_18mm'],
  allMaterials: mockMaterials
})
assert(matchPly18.status === 'MATCHED' && matchPly18.material.id === 'm_ply18', 'Pencocokan tunggal Triplek Polos 18mm berhasil')

// Ambiguous match (2 candidate Melamin SF 6mm)
const matchAmbiguous = matchMaterialForRow({
  rowDef: FIELD_FORM_ROWS_BY_ID['kd_triplek_melamin_sf_6mm_1'],
  allMaterials: mockMaterials
})
assert(matchAmbiguous.status === 'AMBIGUOUS', 'Pencocokan ambigu (dua kandidat Grade A & B) ditandai AMBIGUOUS')
assert(matchAmbiguous.candidates.length === 2, 'Kandidat ambigu dikembalikan lengkap')
assert(!matchAmbiguous.material, 'TIDAK auto-pilih kandidat pertama pada kondisi ambigu')

// Unmatched
const matchUnmatched = matchMaterialForRow({
  rowDef: { label: 'Bahan Khusus Gaib', type: '999mm', categoryHint: 'Plywood & Board', unit: 'Lbr' },
  allMaterials: mockMaterials
})
assert(matchUnmatched.status === 'UNMATCHED', 'Material yang tidak ada di master ditandai UNMATCHED')

// HPL with user code
const matchHplWithCode = matchMaterialForRow({
  rowDef: FIELD_FORM_ROWS_BY_ID['kd_hpl_taco_1'],
  userCode: 'TH 123 AA',
  allMaterials: mockMaterials
})
assert(matchHplWithCode.status === 'MATCHED' && matchHplWithCode.material.id === 'm_hpl_taco_th123', 'HPL Taco dengan kode TH 123 AA cocok dengan master')

// 4. Adapter Validation & Conversion Tests
console.log('\n4. Verifikasi Adapter & Validasi Form Lapangan:')

const mockProjects = [
  { id: 'p1', kode: '99', name: 'Project Baroni', status: 'ON_GOING' }
]

// Test 4.1: Semua tabel kosong -> no PR
const resEmpty = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Pengadaan Meja Resepsionis' },
  rowsState: {},
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resEmpty.success === false, 'Semua tabel kosong menghasilkan success: false')
assert(resEmpty.errors.some(e => e.includes('Minimal 1 baris')), 'Pesan error menyatakan minimal 1 baris kebutuhan harus diisi')

// Test 4.2: Project atau Judul kosong
const resNoHeader = convertFieldFormToPrSeed({
  header: { project_id: '', title: '' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '5' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resNoHeader.success === false, 'Header kosong menghasilkan success: false')
assert(resNoHeader.errors.some(e => e.includes('Project')), 'Pesan error menyebutkan Project wajib dipilih')
assert(resNoHeader.errors.some(e => e.includes('Judul Kebutuhan')), 'Pesan error menyebutkan Judul Kebutuhan wajib diisi')

// Test 4.3: Baris touched tapi Qty kosong / 0 / negatif / non-numeric
const resInvalidQty = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Pengadaan Baroni' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '0', remarks: 'Harus ada' },
    kd_triplek_polos_15mm: { qty: '-2' },
    kd_hpl_taco_1: { qty: 'abc', code: 'TH 123' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resInvalidQty.success === false, 'Qty 0/negatif/non-numeric ditolak')
assert(resInvalidQty.errors.some(e => e.includes('Triplek Polos 18 mm') && e.includes('Qty')), 'Error spesifik qty untuk Triplek Polos 18mm')
assert(resInvalidQty.errors.some(e => e.includes('Triplek Polos 15 mm') && e.includes('Qty')), 'Error spesifik qty untuk Triplek Polos 15mm')
assert(resInvalidQty.errors.some(e => e.includes('HPL') && e.includes('Qty')), 'Error spesifik qty untuk HPL Taco')

// Test 4.4: Valid decimal Qty preserved
const resDecimal = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Kabel Baroni' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '2.5' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resDecimal.success === true, 'Desimal valid 2.5 berhasil dikonversi')
assert(resDecimal.prItemsList[0].qty === 2.5, 'Nilai desimal 2.5 dipertahankan pada item PR')

// Test 4.5: Hanya 1 dari 4 kelompok diisi -> hanya baris valid yang terkonversi
const resOneGroup = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Hanya Triplek' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '10' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resOneGroup.success === true, 'Konversi 1 kelompok sukses')
assert(resOneGroup.prItemsList.length === 1, 'Tepat 1 item dalam prItemsList')
assert(resOneGroup.prItemsList[0].material_id === 'm_ply18', 'Material ID sesuai master')
assert(resOneGroup.prItemsList[0].qty === 10, 'Qty sesuai input')
assert(resOneGroup.prItemsList[0].satuan === 'Lembar', 'Satuan kanonik Lembar digunakan')

// Test 4.6: Campuran empty + filled
const resMixed = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Campuran' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '4' },
    kd_triplek_polos_15mm: { qty: '' }, // untouched / blank
    prod_sekrup_3cm: { qty: '100' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resMixed.success === true, 'Campuran empty dan filled berhasil')
assert(resMixed.prItemsList.length === 2, 'Hanya 2 item terisi yang dikonversi')
const names = resMixed.prItemsList.map(it => it.name)
assert(names.includes('Triplek Polos 18mm') && names.includes('Sekrup 3 cm'), 'Kedua item valid masuk daftar')

// Test 4.7: Duplicate printed IDs tidak tertimpa
const resDuplicates = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Melamin Duplikat' },
  rowsState: {
    kd_triplek_melamin_sf_6mm_1: { qty: '3', selectedMaterialId: 'm_ply6_a', remarks: 'Batch 1' },
    kd_triplek_melamin_sf_6mm_2: { qty: '5', selectedMaterialId: 'm_ply6_b', remarks: 'Batch 2' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resDuplicates.success === true, 'Dua baris duplikat template berhasil dikonversi bersamaan')
assert(resDuplicates.prItemsList.length === 2, 'Dua item terpisah tercipta di prItemsList')
assert(resDuplicates.prItemsList[0].qty === 3 && resDuplicates.prItemsList[1].qty === 5, 'Kedua qty dipertahankan masing-masing')
assert(resDuplicates.prItemsList[0].material_id !== resDuplicates.prItemsList[1].material_id, 'Material ID kedua baris berbeda')

// Test 4.8: Header metadata & item remarks preserved in form.notes
const resNotes = convertFieldFormToPrSeed({
  header: {
    project_id: 'p1',
    title: 'Pengadaan Baroni Lengkap',
    date: '2026-10-20',
    produced_by: 'Workshop Tangerang',
    notes: 'Catatan umum admin pengadaan'
  },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '5', remarks: 'Rangka utama meja' },
    prod_sekrup_3cm: { qty: '200', remarks: 'Pemasangan engsel' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resNotes.success === true, 'Konversi berhasil dengan metadata')
assert(resNotes.form.notes.includes('Tanggal Lapangan: 2026-10-20'), 'form.notes mencatat Tanggal Lapangan')
assert(resNotes.form.notes.includes('Diproduksi: Workshop Tangerang'), 'form.notes mencatat Diproduksi')
assert(resNotes.form.notes.includes('Catatan umum admin pengadaan'), 'Catatan awal admin tidak hilang')
assert(resNotes.form.notes.includes('Triplek Polos 18mm (5 Lembar) — Remarks: Rangka utama meja'), 'Remarks item Triplek tercatat di notes')
assert(resNotes.form.notes.includes('Sekrup 3 cm (200 Pcs) — Remarks: Pemasangan engsel'), 'Remarks item Sekrup tercatat di notes')

// Test 4.9: Printed unit mismatch tanpa implicit conversion
const resMismatch = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'List T' },
  rowsState: {
    aks_hardware_list_t: { qty: '10' } // List T master is Batang, template is Pcs
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resMismatch.success === false, 'Unit mismatch Pcs vs Batang tanpa konfirmasi ditolak')
assert(resMismatch.errors.some(e => e.includes('Satuan template "Pcs"') && e.includes('satuan master "Batang"')), 'Pesan error menjelaskan perbedaan satuan')

// With explicit resolution: user confirms canonical unit Batang
const resMismatchResolved = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'List T Resolved' },
  rowsState: {
    aks_hardware_list_t: { qty: '10', unitResolved: true }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(resMismatchResolved.success === true, 'Unit mismatch yang sudah dikonfirmasi admin diterima')
assert(resMismatchResolved.prItemsList[0].satuan === 'Batang', 'Satuan kanonik master (Batang) digunakan')

// Test 4.10: Estimator price and unknown acuan not zero
const matNoPrice = { id: 'm_no_price', kode: 'MAT-9999', name: 'Kayu Unik', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: null }
const resEstimator = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Estimasi' },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '2' },
    custom_mat_no_price: { qty: '1', selectedMaterialId: 'm_no_price' }
  },
  allMaterials: [...mockMaterials, matNoPrice],
  allProjects: mockProjects
})
if (!resEstimator.success) {
  console.error('resEstimator errors:', resEstimator.errors)
}
assert(resEstimator.success === true, 'Konversi estimator sukses')
const itemWithPrice = resEstimator.prItemsList.find(it => it.material_id === 'm_ply18')
assert(itemWithPrice.estimated_price === '250.000', 'Item ber-acuan terisi harga terformat nominal')
assert(itemWithPrice.est_source === 'MASTER', 'Sumber acuan MASTER tercatat')

const itemWithoutPrice = resEstimator.prItemsList.find(it => it.material_id === 'm_no_price')
assert(itemWithoutPrice.estimated_price === '', 'Item tanpa acuan menghasilkan string kosong, BUKAN 0')
assert(itemWithoutPrice.est_source === 'NONE', 'Sumber acuan item tanpa harga adalah NONE')

// Test 4.11: Repeated convert doesn't duplicate
const seed1 = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Idempotensi' },
  rowsState: { kd_triplek_polos_18mm: { qty: '4' } },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
const seed2 = convertFieldFormToPrSeed({
  header: { project_id: 'p1', title: 'Idempotensi' },
  rowsState: { kd_triplek_polos_18mm: { qty: '4' } },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})
assert(seed1.prItemsList.length === 1 && seed2.prItemsList.length === 1, 'Konversi berulang menghasilkan jumlah item sama')
assert(JSON.stringify(seed1.prItemsList) === JSON.stringify(seed2.prItemsList), 'Isi seed dari dua konversi identik')

console.log('\n--- SEMUA PENGUJIAN LOGIKA & ADAPTER LULUS ---')
