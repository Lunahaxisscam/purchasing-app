// ============================================================
// modules/shared/renderGenericCell.jsx
// Cell tabel GENERIK lintas modul — diekstrak VERBATIM dari ModuleView.js.
// Shell memanggil ini HANYA bila modules/<modul>/view.jsx tidak menangani
// kolom tersebut (return null). Urutan prioritas sama dengan aslinya.
// ============================================================
import React from 'react'
import { format } from '../../lib/constants'

export function renderGenericCell(page, h, r, rawVal, ctx) {
  const { H } = ctx
  const { requestItemLines } = H

  if (['requests', 'approvals'].includes(page) && h === 'project_name') {
    return (
    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(rawVal || '')}>
      {format(rawVal)}
    </div>
    )
  }
  if (['requests', 'approvals'].includes(page) && (h === 'notes' || h === 'note')) {
    return (
    <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
      {format(rawVal)}
    </div>
    )
  }
  if (h === 'title') {
    return (
    <div
      style={{ maxWidth: ['requests', 'approvals'].includes(page) ? '100%' : '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      title={String(rawVal || '')}
    >
      {format(rawVal)}
    </div>
    )
  }
  if (h === 'materials_summary') {
    return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {requestItemLines(r).map((line, idx) => (
        <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, whiteSpace: 'normal', paddingLeft: '12px', textIndent: '-12px' }}>
          • {line}
        </span>
      ))}
    </div>
    )
  }
  return format(rawVal)
}
