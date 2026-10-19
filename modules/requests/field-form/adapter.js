// ============================================================
// modules/requests/field-form/adapter.js
// ============================================================
// Adapter konversi data Form Lapangan ke Seed Draft PR (CreateModal standard)
//
// Tanggung jawab:
// 1. Validasi baris touched vs untouched (abaikan untouched, error pada invalid).
// 2. Memastikan minimal 1 baris kebutuhan valid terisi.
// 3. Memvalidasi qty (angka positif, preserve desimal valid seperti 2.5).
// 4. Memastikan material kanonik ter-resolve (via ID pilihan atau auto-matcher).
// 5. Memeriksa kecocokan satuan (mencegah konversi implisit Pcs -> Batang/dsb).
// 6. Menyusun metadata notes: Tanggal Lapangan, Diproduksi, dan remarks per baris.
// 7. Mengintegrasikan estimator harga resmi: tanpa angka 0 palsu jika belum ada acuan.
// ============================================================

import { FIELD_FORM_ROWS_BY_ID } from './templateData'
import { matchMaterialForRow, normalizeUnitAlias, checkUnitCompatibility } from './matcher'
import { makePrEstimator } from '../estimator'
import { formatNominalInput } from '../../../lib/constants'

function isTouchedRow(rowState) {
  if (!rowState) return false
  const hasQty = rowState.qty !== undefined && rowState.qty !== null && String(rowState.qty).trim() !== ''
  const hasMat = !!rowState.selectedMaterialId
  const hasCode = !!String(rowState.code || '').trim()
  const hasType = !!String(rowState.type || '').trim()
  const hasRemarks = !!String(rowState.remarks || '').trim()
  const hasCustomLabel = !!String(rowState.label || '').trim()
  return hasQty || hasMat || hasCode || hasType || hasRemarks || hasCustomLabel
}

function parseQtyNumber(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return NaN
  const str = String(raw).trim().replace(',', '.')
  const num = Number(str)
  return (isFinite(num) && num > 0) ? num : NaN
}

export function validateFieldForm({ header = {}, rowsState = {}, allMaterials = [], allProjects = [] }) {
  const errors = []

  // Validasi Header
  const projectId = String(header.project_id || '').trim()
  if (!projectId) {
    errors.push('Project wajib dipilih.')
  } else if (allProjects.length > 0 && !allProjects.some(p => String(p.id) === projectId)) {
    errors.push('Project yang dipilih tidak valid.')
  }

  const title = String(header.title || '').trim()
  if (!title) {
    errors.push('Judul Kebutuhan wajib diisi.')
  }

  const touchedRowEntries = []

  // Periksa semua entri pada rowsState
  for (const [rowId, rState] of Object.entries(rowsState)) {
    if (!isTouchedRow(rState)) continue

    const rowDef = FIELD_FORM_ROWS_BY_ID[rowId] || {
      id: rowId,
      label: rState.label || 'Item Khusus',
      spec: '',
      type: rState.type || '',
      unit: rState.unit || 'Pcs',
      categoryHint: '',
      isCustom: true
    }

    const itemLabel = [rowDef.label, rowDef.spec, rowDef.type, rState.code].filter(Boolean).join(' ')

    // 1. Validasi Qty
    const qtyNum = parseQtyNumber(rState.qty)
    if (Number.isNaN(qtyNum)) {
      errors.push(`Qty untuk "${itemLabel}" harus angka lebih dari 0.`)
    }

    // 2. Resolve Material
    let resolvedMaterial = null
    if (rState.selectedMaterialId) {
      resolvedMaterial = allMaterials.find(m => String(m.id) === String(rState.selectedMaterialId))
      if (!resolvedMaterial) {
        errors.push(`Material pilihan untuk "${itemLabel}" tidak ditemukan di master.`)
      }
    } else {
      // Cek apakah HPL tanpa kode
      if (rowDef.isHpl && !String(rState.code || '').trim()) {
        errors.push(`Kode HPL "${itemLabel}" wajib diisi.`)
      }

      const matchRes = matchMaterialForRow({
        rowDef,
        userCode: rState.code,
        userType: rState.type,
        userLabel: rState.label,
        allMaterials
      })

      if (matchRes.status === 'MATCHED') {
        resolvedMaterial = matchRes.material
      } else if (matchRes.status === 'AMBIGUOUS') {
        errors.push(`Material "${itemLabel}" ambigu (${matchRes.candidates.length} pilihan serupa). Silakan pilih material spesifik di master.`)
      } else {
        errors.push(`Material "${itemLabel}" belum cocok dengan master material. Silakan pilih dari master.`)
      }
    }

    // 3. Validasi Satuan (Unit Compatibility)
    if (resolvedMaterial) {
      const canonicalUnit = resolvedMaterial.satuan || resolvedMaterial.unit || ''
      const printedUnit = rowDef.isCustom ? (rState.unit || canonicalUnit) : (rowDef.unit || 'Pcs')
      const unitComp = checkUnitCompatibility(printedUnit, canonicalUnit)

      if (!unitComp.compatible && !rState.unitResolved) {
        errors.push(
          `Satuan template "${printedUnit}" untuk "${itemLabel}" berbeda dengan satuan master "${canonicalUnit}". Silakan konfirmasi satuan master sebelum konversi.`
        )
      }
    }

    touchedRowEntries.push({
      rowId,
      rowDef,
      rState,
      itemLabel,
      qtyNum,
      resolvedMaterial
    })
  }

  if (touchedRowEntries.length === 0) {
    errors.push('Minimal 1 baris kebutuhan harus diisi.')
  }

  return {
    valid: errors.length === 0,
    errors,
    touchedRowEntries
  }
}

export function convertFieldFormToPrSeed({
  header = {},
  rowsState = {},
  allMaterials = [],
  allProjects = [],
  estimator = null,
  allPrItems = [],
  allReceivingItems = [],
  allReceivings = [],
  allVendors = []
}) {
  const validation = validateFieldForm({ header, rowsState, allMaterials, allProjects })
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors
    }
  }

  // Siapkan Estimator
  const Est = estimator || makePrEstimator({
    allPrItems,
    allReceivingItems,
    allReceivings,
    allVendors
  })

  const prItemsList = []
  const itemRemarksLines = []

  for (const entry of validation.touchedRowEntries) {
    const { rowDef, rState, qtyNum, resolvedMaterial } = entry
    const mat = resolvedMaterial

    // Tentukan satuan kanonik
    const canonicalUnit = normalizeUnitAlias(mat.satuan || mat.unit || rowDef.unit || 'Pcs')

    // Hitung acuan harga resmi
    const est = Est.estimateFor(mat, { vendorId: null })
    let priceText = ''
    if (est.status === 'OK' && est.price !== null && isFinite(est.price)) {
      priceText = formatNominalInput(String(Math.round(est.price)))
    }

    prItemsList.push({
      material_id: mat.id,
      kode: mat.kode || mat.code || '—',
      name: mat.name,
      category: mat.category || '—',
      satuan: canonicalUnit,
      qty: qtyNum,
      supplier_category: mat.category || '',
      vendor_id: '',
      estimated_price: priceText,
      est_source: est.status === 'OK' ? est.source : 'NONE',
      est_vendor: est.status === 'OK' ? est.vendor : null,
      est_date: est.status === 'OK' ? est.date : null,
      est_unit: canonicalUnit,
      est_price_per: est.status === 'OK' ? est.price : null,
      est_manual: false
    })

    // Kumpulkan baris remarks untuk dimasukkan ke form.notes
    const remarks = String(rState.remarks || '').trim()
    const code = String(rState.code || '').trim()
    let extra = ''
    if (code && !mat.name.toLowerCase().includes(code.toLowerCase())) {
      extra = ` [${code}]`
    }
    itemRemarksLines.push(`• ${mat.name}${extra} (${qtyNum} ${canonicalUnit})${remarks ? ` — Remarks: ${remarks}` : ''}`)
  }

  // Susun notes lengkap
  const noteParts = []
  const initialNotes = String(header.notes || '').trim()
  if (initialNotes) {
    noteParts.push(initialNotes)
  }

  const metaHeaders = []
  if (header.date) {
    metaHeaders.push(`Tanggal Lapangan: ${header.date}`)
  }
  if (header.produced_by) {
    metaHeaders.push(`Diproduksi: ${header.produced_by}`)
  }

  if (metaHeaders.length > 0 || itemRemarksLines.length > 0) {
    noteParts.push(`\n[Form Pengadaan Lapangan]`)
    if (metaHeaders.length > 0) {
      noteParts.push(metaHeaders.join(' | '))
    }
    if (itemRemarksLines.length > 0) {
      noteParts.push('Rincian Kebutuhan Lapangan:')
      noteParts.push(itemRemarksLines.join('\n'))
    }
  }

  const finalNotes = noteParts.join('\n').trim()

  const summary = prItemsList.length
    ? prItemsList.map(it => `${it.qty} ${it.satuan || ''} ${it.name}`).join(', ')
    : (header.title || '—')

  const form = {
    project_id: header.project_id,
    title: header.title,
    priority: header.priority || 'NORMAL',
    status: 'DRAFT',
    materials_summary: summary,
    notes: finalNotes
  }

  return {
    success: true,
    form,
    prItemsList
  }
}
