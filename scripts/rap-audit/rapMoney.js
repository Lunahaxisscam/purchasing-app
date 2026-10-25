// ============================================================
// Kalkulasi kontrol anggaran 4-pilar — EKSTRAKSI SAJI dari
// components/Planning.js (base main@18fb594). TIDAK ada
// nilainya yang diubah — sengaja di-verbatim (modulo tata
// letak & komentar) supaya audit menguji logika yang benar-
// benar jalan di produksi hari ini. Tiap bagian diberi tag §
// sesuai baris sumber di Planning.js.
// ============================================================

export const STANDARD_PERCENTAGES = { material: 50, manpower: 25, operasional: 10, margin: 15 } // §L35
export const PCT_FIELDS = [
  { key: 'material', label: 'Material' },
  { key: 'manpower', label: 'Upah' },
  { key: 'operasional', label: 'Operasional' },
  { key: 'margin', label: 'Target Margin' }
]

// §Planning.js L44-51
export function pctToDraft(p) {
  return {
    material: String(p.material),
    manpower: String(p.manpower),
    operasional: String(p.operasional),
    margin: String(p.margin)
  }
}

// §Planning.js L56-86 — verbatim (lengkap, termasuk "123,456" yang JS-parse
// jadi 123456 — inti temuan S3 #2 — dan pembulatan dua-desimal sennomel
// perbandingan dengan 100)
export function validatePercentDraft(draft) {
  const values = {}
  const errors = []
  let total = 0
  let fieldsOk = true
  for (const f of PCT_FIELDS) {
    const raw = draft ? draft[f.key] : ''
    const str = String(raw ?? '').trim()
    const num = str === '' ? NaN : Number(str)
    if (str === '' || !Number.isFinite(num) || num < 0 || num > 100) {
      fieldsOk = false
      errors.push(`${f.label} harus angka 0-100`)
      values[f.key] = null
    } else {
      values[f.key] = num
      total += num
    }
  }
  const totalRounded = Math.round(total * 100) / 100
  const totalOk = fieldsOk && totalRounded <= 100
  const valid = fieldsOk && totalOk
  return {
    valid,
    fieldsOk,
    totalOk,
    total: totalRounded,
    remaining: Math.max(0, Math.round((100 - totalRounded) * 100) / 100),
    errors,
    values
  }
}

// Implementasi semantik Number() ECMAScript untuk referensi faktual:
// "123,456" -> NaN; "123.456" -> 123.456 (dokumen/finder koma-desimal S3 #2).
export function esParse(s) { return Number(s) }
export function esTypeofNum() { return typeof Number('123,et') }

// §Planning.js L109-118 — normalisasi project_no ↔ kode (anti false-match)
export function normalizeProjectNo(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^0*(\d+)(?:[.,]0+)?$/)
  return m ? String(Number(m[1])) : s
}

export const digitsOnly = v => {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : 0
}

// §Planning.js L251-450 (computeBudget) — verbatim, modulo tata letak & komentar.
// Parameter identik ke pemanggil memo produksi: (activeCost, stats.labor,
// budgetMode, appliedPercentages, customValidation, costError) — costError
// hanya kebutuhan memo jadi diabaikan di api funkcinya.
export function computeBudget(activeCost, statsLabor, budgetMode, appliedPercentages, customValidation, costError) {
  const revenueVal = Number(activeCost?.revenue)
  const revenue = !isNaN(revenueVal) && revenueVal > 0 ? revenueVal : 0

  const useCustom = budgetMode === 'custom'
  const applied = useCustom ? appliedPercentages : STANDARD_PERCENTAGES
  const pctMaterial = applied.material
  const pctManpower = applied.manpower
  const pctOperasional = applied.operasional
  const pctMargin = applied.margin

  const totalCustomPct = pctMaterial + pctManpower + pctOperasional + pctMargin
  const isExceedingLimit = useCustom && !customValidation.valid

  // 1. Plafon 4-Pilar (Patokan Historis DAT / Noir Living) atau Custom
  const budgetMaterial = Math.round(revenue * (pctMaterial / 100))
  const budgetManpower = Math.round(revenue * (pctManpower / 100))
  const budgetOperasional = Math.round(revenue * (pctOperasional / 100))
  const targetMargin = Math.round(revenue * (pctMargin / 100))

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

  // 4. Variansi & Sisa Kuota Budget (Aman dari NaN & Div by Zero)
  const isLaborOverBudget = isLaborOver
  const laborVariance = realLabor - budgetManpower
  const laborRemaining = budgetManpower - realLabor
  const laborPct = revenue > 0 ? (realLabor / revenue) * 100 : 0
  const laborUsageOfPlafon = budgetManpower > 0 ? (realLabor / budgetManpower) * 100 : 0

  const isMaterialOverBudget = isMaterialOver
  const materialVariance = realMaterial - budgetMaterial
  const materialRemaining = budgetMaterial - realMaterial
  const materialPct = revenue > 0 ? (realMaterial / revenue) * 100 : 0
  const materialUsageOfPlafon = budgetMaterial > 0 ? (realMaterial / budgetMaterial) * 100 : 0

  const isOperasionalOverBudget = isOperasionalOver
  const operasionalVariance = realOperasional - budgetOperasional
  const operasionalRemaining = budgetOperasional - realOperasional
  const operasionalPct = revenue > 0 ? (realOperasional / revenue) * 100 : 0
  const operasionalUsageOfPlafon = budgetOperasional > 0 ? (realOperasional / budgetOperasional) * 100 : 0

  const isMarginUnderTarget = isMarginThin
  const marginVariance = realMargin - targetMargin
  const marginDeficit = targetMargin - realMargin
  const marginPct = revenue > 0 ? (realMargin / revenue) * 100 : 0
  const marginAchievement = targetMargin > 0 ? (realMargin / targetMargin) * 100 : 0

  const hasAnomaly = isMaterialOver || isLaborOver || isOperasionalOver || isMarginThin

  return {
    revenue,
    budgetMaterial, budgetManpower, budgetOperasional, targetMargin,
    useCustom, totalCustomPct, isExceedingLimit,
    realMaterial, realLabor, realOperasional, realTotalCost, realMargin,
    isMaterialOver, isLaborOver, isOperasionalOver, isMarginThin, hasAnomaly,
    materialVariance, materialRemaining, materialPct, materialUsageOfPlafon,
    laborVariance, laborRemaining, laborPct, laborUsageOfPlafon,
    operasionalVariance, operasionalRemaining, operasionalPct, operasionalUsageOfPlafon,
    marginVariance, marginDeficit, marginPct, marginAchievement
  }
}

// §ProjectFinance.js L155-162 — verbatim dari sumber (memuat bug L1: pembulatan
// digabung ke pembagian, bukan pembulatan-terakhir).
export function pctTarget70ProjectFinance(revenue) {
  const target = Math.round(revenue * 70) / 100
  return target
}

// Ragam yang BENAR: kalikan-pembulatan setelah seluruh operasinya selesai.
export function pctTarget70Fixed(revenue) {
  return Math.round((revenue * 70) / 100)
}

// §Finance.js L477-481 — identik bug L1, dipakai tab Closing & pile P&L.
export function pctTarget70Finance(revenue) {
  return Math.round(revenue * 70) / 100
}

// Efek bug L1 pada pembandingan batas: kembalikan beda integer
// target- versus target (risiko perubahan status HEMAT/OVER).
export function fmtTargetDiff(revenue) {
  const buggy = pctTarget70Finance(revenue)
  const fixed = Math.round(revenue * 0.7)
  return { buggy, fixed, diff: Math.abs(buggy - fixed) }
}

// §Finance.js L31-37 / ProjectFinance.js L22-28 — parser kecil note nota
export function parseNominalFromNote(note) {
  const s = String(note || '')
  const m = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const digits = m[1].replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

// §Finance.js L578-586 estForPr — estimasi PR dari pr_items
export function estForPrWith(prItems, prId) {
  const items = (prItems || []).filter(it => it.pr_id === prId)
  return items.reduce((sum, it) => {
    const p = Number(it.estimated_price)
    const q = Number(it.quantity)
    if (!isFinite(p) || p <= 0) return sum
    return sum + p * (isFinite(q) && q > 0 ? q : 1)
  }, 0)
}
