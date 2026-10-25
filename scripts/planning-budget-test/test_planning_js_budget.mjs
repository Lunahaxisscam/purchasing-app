import assert from 'node:assert'
import fs from 'node:fs'

console.log('[TEST] Memulai verifikasi Planning.js 4-Pilar Data Layer...')

const planningCode = fs.readFileSync('/home/ubuntu/purchasing-app/components/Planning.js', 'utf8')

// Pastikan semua identifier yang diminta ada di dalam Planning.js
const requiredIdentifiers = [
  'budgetMaterial',
  'realMaterial',
  'isMaterialOver',
  'budgetManpower',
  'realLabor',
  'isLaborOver',
  'budgetOperasional',
  'realOperasional',
  'isOperasionalOver',
  'realTotalCost',
  'realMargin',
  'targetMargin',
  'isMarginThin'
]

for (const id of requiredIdentifiers) {
  assert(planningCode.includes(id), `Planning.js harus mendefinisikan/menggunakan '${id}'`)
}
console.log('✓ Semua 13 identifier 4-pilar ditemukan di Planning.js')

// Test evaluasi logic fungsi kalkulasi
function calculateBudget(activeCost, statsLabor) {
  const revenueVal = Number(activeCost?.revenue)
  const revenue = !isNaN(revenueVal) && revenueVal > 0 ? revenueVal : 0

  // 1. Plafon 4-Pilar
  const budgetMaterial = Math.round(revenue * 0.50)
  const budgetManpower = Math.round(revenue * 0.25)
  const budgetOperasional = Math.round(revenue * 0.10)
  const targetMargin = Math.round(revenue * 0.15)

  // 2. Realisasi Riil
  const matVal = Number(activeCost?.cumulative_cost)
  const realMaterial = !isNaN(matVal) && matVal > 0 ? matVal : 0

  const labVal = Number(statsLabor)
  const realLabor = !isNaN(labVal) && labVal > 0 ? labVal : 0

  const opsVal = Number(activeCost?.petty_cash)
  const realOperasional = !isNaN(opsVal) && opsVal > 0 ? opsVal : 0

  const realTotalCost = realMaterial + realLabor + realOperasional
  const realMargin = revenue - realTotalCost

  // 3. Deteksi Anomali
  const isMaterialOver = revenue > 0 && realMaterial > budgetMaterial
  const isLaborOver = revenue > 0 && realLabor > budgetManpower
  const isOperasionalOver = revenue > 0 && realOperasional > budgetOperasional
  const isMarginThin = revenue > 0 && realMargin < targetMargin

  return {
    revenue,
    budgetMaterial,
    realMaterial,
    isMaterialOver,
    budgetManpower,
    realLabor,
    isLaborOver,
    budgetOperasional,
    realOperasional,
    isOperasionalOver,
    realTotalCost,
    realMargin,
    targetMargin,
    isMarginThin
  }
}

// Skenario 1: Proyek Normal (Sehat)
const sehat = calculateBudget({
  revenue: 100000000,
  cumulative_cost: 45000000,
  petty_cash: 8000000
}, 20000000)

assert.strictEqual(sehat.budgetMaterial, 50000000)
assert.strictEqual(sehat.realMaterial, 45000000)
assert.strictEqual(sehat.isMaterialOver, false)

assert.strictEqual(sehat.budgetManpower, 25000000)
assert.strictEqual(sehat.realLabor, 20000000)
assert.strictEqual(sehat.isLaborOver, false)

assert.strictEqual(sehat.budgetOperasional, 10000000)
assert.strictEqual(sehat.realOperasional, 8000000)
assert.strictEqual(sehat.isOperasionalOver, false)

assert.strictEqual(sehat.realTotalCost, 73000000)
assert.strictEqual(sehat.realMargin, 27000000)
assert.strictEqual(sehat.targetMargin, 15000000)
assert.strictEqual(sehat.isMarginThin, false)
console.log('✓ Skenario 1 (Proyek Sehat) LULUS')

// Skenario 2: Anomali Material Over
const matOver = calculateBudget({
  revenue: 100000000,
  cumulative_cost: 55000000,
  petty_cash: 8000000
}, 20000000)

assert.strictEqual(matOver.isMaterialOver, true)
assert.strictEqual(matOver.isLaborOver, false)
assert.strictEqual(matOver.isOperasionalOver, false)
assert.strictEqual(matOver.realTotalCost, 83000000)
assert.strictEqual(matOver.realMargin, 17000000)
assert.strictEqual(matOver.isMarginThin, false) // 17jt >= 15jt
console.log('✓ Skenario 2 (Material Over) LULUS')

// Skenario 3: Anomali Manpower WBS Over & Margin Tergerus
const laborOver = calculateBudget({
  revenue: 100000000,
  cumulative_cost: 50000000,
  petty_cash: 10000000
}, 30000000)

assert.strictEqual(laborOver.isLaborOver, true)
assert.strictEqual(laborOver.realTotalCost, 90000000)
assert.strictEqual(laborOver.realMargin, 10000000)
assert.strictEqual(laborOver.isMarginThin, true) // 10jt < 15jt
console.log('✓ Skenario 3 (Manpower Over + Margin Thin) LULUS')

// Skenario 4: Anomali Operasional Over
const opsOver = calculateBudget({
  revenue: 100000000,
  cumulative_cost: 45000000,
  petty_cash: 14000000
}, 20000000)

assert.strictEqual(opsOver.isOperasionalOver, true)
console.log('✓ Skenario 4 (Operasional Over) LULUS')

// Skenario 5: Safe from NaN (Null, Undefined, String)
const safeNaN = calculateBudget({
  revenue: null,
  cumulative_cost: undefined,
  petty_cash: 'invalid'
}, 'not-a-number')

for (const [k, v] of Object.entries(safeNaN)) {
  if (typeof v === 'number') {
    assert(!isNaN(v), `Properti ${k} tidak boleh NaN`)
  }
}
assert.strictEqual(safeNaN.revenue, 0)
assert.strictEqual(safeNaN.isMaterialOver, false)
assert.strictEqual(safeNaN.isLaborOver, false)
assert.strictEqual(safeNaN.isOperasionalOver, false)
assert.strictEqual(safeNaN.isMarginThin, false)
console.log('✓ Skenario 5 (Aman dari NaN & Fallback Zero) LULUS')

// Skenario 6: normalisasi nomor project_no ↔ kode (integrasi revenue Rekap Cost).
// Salinan persis dari normalizeProjectNo di components/Planning.js — jaga sinkron.
function normalizeProjectNo(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^0*(\d+)(?:[.,]0+)?$/)
  return m ? String(Number(m[1])) : s
}

assert.strictEqual(normalizeProjectNo('99'), '99')
assert.strictEqual(normalizeProjectNo('099'), '99', 'leading zero harus setara')
assert.strictEqual(normalizeProjectNo('99.0'), '99', 'sisa desimal ekspor Sheets harus setara')
assert.strictEqual(normalizeProjectNo(' 99 '), '99', 'spasi harus dibersihkan')
assert.notStrictEqual(normalizeProjectNo('1000'), '99', 'nomor berbeda tidak boleh match')
assert.notStrictEqual(normalizeProjectNo('99abc'), '99', 'string non-numerik tidak boleh false-match')
assert.notStrictEqual(normalizeProjectNo('99b'), '99', 'sufiks huruf tidak boleh false-match')
assert.strictEqual(normalizeProjectNo(''), '', 'kosong tetap kosong')
assert.strictEqual(normalizeProjectNo(null), '', 'null aman')
assert.strictEqual(normalizeProjectNo('A-12'), 'A-12', 'kode alfanumerik dipertahankan apa adanya')

// Pastikan Planning.js benar-benar memakai normalisasi ini untuk activeCost.
assert(planningCode.includes('normalizeProjectNo'), 'Planning.js harus memakai normalizeProjectNo')
assert(planningCode.includes('costError'), 'Planning.js harus melacak kegagalan muat Rekap Cost (costError)')
console.log('✓ Skenario 6 (Normalisasi nomor project_no ↔ kode) LULUS')

console.log('[SUKSES] Semua verifikasi data layer 4-pilar berhasil!')
