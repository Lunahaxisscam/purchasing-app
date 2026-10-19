// ============================================================
// modules/requests/field-form/matcher.js
// ============================================================
// Logika pencocokan baris template Form Lapangan dengan Master Material
// (allMaterials).
//
// Aturan bisnis (brief DAT):
// 1. Exact match / alias transparan diperbolehkan.
// 2. Ambigu (beberapa kandidat mirip) TIDAK boleh auto-pilih item pertama!
//    Tandai sebagai 'AMBIGUOUS' agar admin memilih material kanonik.
// 3. Material belum lengkap/tidak ada master ditandai 'UNMATCHED'.
// 4. Satuan: alias Lbr->Lembar, Mtr->Meter, Btg->Batang, Psg->Pasang diizinkan
//    tanpa mengubah qty. Blanket Pcs TIDAK boleh mengonversi diam-diam
//    material ber-satuan Batang, Kaleng, Box, Roll. Ditandai mismatch!
// ============================================================

export const UNIT_ALIASES = {
  lbr: 'Lembar',
  lembar: 'Lembar',
  mtr: 'Meter',
  meter: 'Meter',
  btg: 'Batang',
  batang: 'Batang',
  psg: 'Pasang',
  pasang: 'Pasang',
  pcs: 'Pcs',
  buah: 'Buah',
  bh: 'Buah',
  box: 'Box',
  dus: 'Box',
  kaleng: 'Kaleng',
  klg: 'Kaleng',
  roll: 'Roll',
  rol: 'Roll',
  sak: 'Sak',
  zak: 'Sak',
  btl: 'Botol',
  botol: 'Botol',
  tube: 'Tube',
  set: 'Set',
  pack: 'Pack'
}

export function normalizeUnitAlias(unit) {
  if (!unit) return ''
  const clean = String(unit).trim().toLowerCase()
  return UNIT_ALIASES[clean] || String(unit).trim()
}

export function checkUnitCompatibility(printedUnit, canonicalUnit) {
  if (!printedUnit || !canonicalUnit) return { compatible: true, isAlias: false }
  const pNorm = normalizeUnitAlias(printedUnit)
  const cNorm = normalizeUnitAlias(canonicalUnit)

  if (pNorm.toLowerCase() === cNorm.toLowerCase()) {
    return { compatible: true, isAlias: pNorm !== printedUnit, canonicalUnit: cNorm }
  }

  // Pcs vs Buah dianggap kompatibel
  if ((pNorm === 'Pcs' && cNorm === 'Buah') || (pNorm === 'Buah' && cNorm === 'Pcs')) {
    return { compatible: true, isAlias: true, canonicalUnit: cNorm }
  }

  // Mismatch satuan tanpa faktor konversi yang valid
  return {
    compatible: false,
    mismatch: true,
    printedUnit,
    canonicalUnit
  }
}

function cleanStr(s) {
  return String(s || '').trim().toLowerCase().replace(/[^\w\d]/g, '')
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\d\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function matchMaterialForRow({ rowDef = {}, userCode = '', userType = '', userLabel = '', allMaterials = [] }) {
  if (!allMaterials || !allMaterials.length) {
    return { status: 'UNMATCHED', material: null, candidates: [] }
  }

  const label = String(userLabel || rowDef.label || '').trim()
  const spec = String(rowDef.spec || '').trim()
  const type = String(userType || rowDef.type || '').trim()
  const brand = String(rowDef.brand || '').trim()
  const code = String(userCode || '').trim()
  const catHint = String(rowDef.categoryHint || '').trim().toLowerCase()

  // 1. Cek pencocokan langsung kode material bila userCode cocok persis kode master
  if (code) {
    const byCode = allMaterials.find(m => cleanStr(m.kode || m.code) === cleanStr(code))
    if (byCode) {
      return { status: 'MATCHED', material: byCode, candidates: [byCode] }
    }
  }

  // Susun string pencarian target
  // Misal: "Triplek Polos 18mm", "HPL Taco TH 123 AA", "Sekrup 3 cm"
  let searchParts = []
  if (label) searchParts.push(label)
  if (brand) searchParts.push(brand)
  if (spec && spec !== label) searchParts.push(spec)
  if (type) searchParts.push(type)
  if (code) searchParts.push(code)

  const targetFull = searchParts.join(' ').trim()
  const targetTokens = tokenize(targetFull)

  if (!targetTokens.length) {
    return { status: 'UNMATCHED', material: null, candidates: [] }
  }

  // 2. Cari exact match nama
  const cleanTarget = cleanStr(targetFull)
  const exactName = allMaterials.find(m => cleanStr(m.name) === cleanTarget)
  if (exactName) {
    return { status: 'MATCHED', material: exactName, candidates: [exactName] }
  }

  // Filter pool berdasarkan kategori jika ada hint
  let pool = allMaterials
  if (catHint) {
    const inCat = pool.filter(m => String(m.category || '').toLowerCase().includes(catHint))
    if (inCat.length > 0) {
      pool = inCat
    }
  }

  // 3. Pencarian berbasis token
  // Candidate harus memuat semua token penting (misal angka ukuran '18mm', '3cm', brand, dst)
  const scored = []
  for (const mat of pool) {
    const matTokens = tokenize(mat.name)
    const matKodeTokens = tokenize(mat.kode || mat.code || '')
    const combinedTokens = [...matTokens, ...matKodeTokens]

    let matchCount = 0
    let allEssentialMatch = true

    for (const t of targetTokens) {
      // Token berupa angka/ukuran (18, 18mm, 3cm, 2x15, dsb) wajib ada
      const isMeasurement = /\d/.test(t)
      const found = combinedTokens.some(ct => ct === t || ct.includes(t) || t.includes(ct))
      if (found) {
        matchCount++
      } else if (isMeasurement) {
        allEssentialMatch = false
        break
      }
    }

    if (allEssentialMatch && matchCount >= Math.min(2, targetTokens.length)) {
      scored.push({ mat, score: matchCount })
    }
  }

  if (scored.length === 0) {
    return { status: 'UNMATCHED', material: null, candidates: [] }
  }

  // Urutkan skor tertinggi
  scored.sort((a, b) => b.score - a.score)
  const topScore = scored[0].score
  const topCandidates = scored.filter(s => s.score === topScore).map(s => s.mat)

  // Jika tepat 1 kandidat teratas
  if (topCandidates.length === 1) {
    return { status: 'MATCHED', material: topCandidates[0], candidates: topCandidates }
  }

  // Jika ada lebih dari 1 kandidat dengan skor sama -> AMBIGU!
  // Aturan mandat: fuzzy ambiguous TIDAK boleh auto-pilih item pertama!
  return {
    status: 'AMBIGUOUS',
    material: null,
    candidates: topCandidates
  }
}
