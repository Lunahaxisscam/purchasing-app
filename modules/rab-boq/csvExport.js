// ============================================================
// modules/rab-boq/csvExport.js — PORT EXPORT CSV dari source HTML
// ============================================================
// Struktur baris CSV disalin VERBATIM dari source line 1516-1542:
// header metadata, kolom tabel, breakdown detail "name: P × L × Qty ×
// UnitPrice = total" (hanya komponen dengan nilai > 0), baris total,
// baris Markup/Margin/Discount, PPN, QUOTATION TOTAL. Kolom terakhir
// TOTAL (IDR) = ribuan × 1000 dibulatkan. BOM \ufeff + pemisah ';'
// dipertahankan agar Excel Indonesia langsung membuka kolomnya.
// ============================================================
import { calcTotals, calcItem, calcCostPart, effectivePrice, thousand, csvCell } from './boqCalc'

export function buildBoqCsv(payload, items) {
  var totals = calcTotals({
    items: items,
    marginMode: payload.marginMode,
    marginRate: payload.marginRate,
    discountType: payload.discountType,
    adjustmentEnabled: payload.adjustmentEnabled,
    taxEnabled: payload.taxEnabled,
    taxRate: payload.taxRate
  })
  var rows = [
    ['BOQ REFF', payload.boqReff],
    ['PROJECT REFF NO', payload.projectReffNo],
    ['REVISION', payload.revisionNumber],
    ['PROJECT', payload.projectName],
    ['CLIENT', payload.clientName],
    ['LOCATION', payload.projectLocation],
    ['DATE', payload.estimateDate],
    [],
    ['NO', 'ITEM', 'AREA', 'GENERAL SPECS.', 'Vol', 'MEA', 'PRICE (000)', 'COST BREAKDOWN', 'TOTAL (000)', 'TOTAL (IDR)']
  ]
  items.forEach(function (item, index) {
    var detail = (item.breakdown || []).filter(function (part) { return calcCostPart(part) > 0 }).map(function (part) { return part.name + ': ' + thousand(part.length) + ' × ' + thousand(part.width) + ' × ' + thousand(part.qty) + ' × ' + thousand(part.unitPrice) + ' = ' + thousand(calcCostPart(part)) }).join(' | ')
    rows.push([index + 1, item.item, item.area, item.specs, item.qty, item.unit, effectivePrice(item), detail, calcItem(item), Math.round(calcItem(item) * 1000)])
  })
  rows.push([])
  rows.push(['', 'Work total', '', '', '', '', '', '', totals.base, Math.round(totals.base * 1000)])
  var csvMode = payload.marginMode
  var csvType = payload.discountType
  var csvAdjustmentLabel = csvMode === 'gross' ? 'Gross margin' : ((csvType === 'nominal' ? 'Nominal ' : 'Percentage ') + (csvMode === 'discount' ? 'discount' : 'markup'))
  rows.push(['', csvAdjustmentLabel, '', '', '', '', '', '', totals.margin, Math.round(totals.margin * 1000)])
  rows.push(['', 'PPN', '', '', '', '', '', '', totals.tax, Math.round(totals.tax * 1000)])
  rows.push(['', 'QUOTATION TOTAL', '', '', '', '', '', '', totals.grand, Math.round(totals.grand * 1000)])
  return '\ufeff' + rows.map(function (row) { return row.map(csvCell).join(';') }).join('\n')
}
