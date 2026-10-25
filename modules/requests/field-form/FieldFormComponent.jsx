// ============================================================
// modules/requests/field-form/FieldFormComponent.jsx
// ============================================================
// Komponen Web Form Interaktif Pengadaan Lapangan
// Mengimplementasikan seluruh 4 kelompok besar dari template PDF
// ============================================================

import React, { useState, useMemo } from 'react'
import { FIELD_FORM_SECTIONS, FIELD_FORM_ROWS_BY_ID } from './templateData'
import { matchMaterialForRow, checkUnitCompatibility, normalizeUnitAlias } from './matcher'
import { convertFieldFormToPrSeed } from './adapter'
import styles from './field-form.module.css'

export default function FieldFormComponent({
  allProjects = [],
  allMaterials = [],
  initialHeader = {},
  initialRowsState = {},
  onCancel,
  onReviewPr,
  onSwitchStandard,
  estimator = null
}) {
  const [header, setHeader] = useState(() => ({
    project_id: initialHeader.project_id || '',
    title: initialHeader.title || '',
    priority: initialHeader.priority || 'NORMAL',
    date: initialHeader.date || new Date().toISOString().slice(0, 10),
    produced_by: initialHeader.produced_by || '',
    notes: initialHeader.notes || ''
  }))

  const [rowsState, setRowsState] = useState(() => ({ ...initialRowsState }))
  const [openSections, setOpenSections] = useState({
    KEBUTUHAN_DASAR: true,
    KEBUTUHAN_FINISHING: true,
    KEBUTUHAN_AKSESORIS: true,
    KEBUTUHAN_PRODUKSI: true
  })
  const [customRows, setCustomRows] = useState({})
  const [errors, setErrors] = useState([])

  const updateRow = (rowId, key, val) => {
    setRowsState(prev => {
      const current = prev[rowId] || {}
      return {
        ...prev,
        [rowId]: {
          ...current,
          [key]: val
        }
      }
    })
  }

  const toggleSection = (secId) => {
    setOpenSections(prev => ({
      ...prev,
      [secId]: !prev[secId]
    }))
  }

  const addCustomRowToTable = (tableId, defaultUnit = 'Pcs') => {
    const customId = `custom_${tableId}_${Date.now()}`
    setCustomRows(prev => ({
      ...prev,
      [tableId]: [
        ...(prev[tableId] || []),
        { id: customId, tableId, label: '', type: '', unit: defaultUnit, isCustom: true }
      ]
    }))
  }

  // Hitung jumlah baris terisi per section dan total
  const stats = useMemo(() => {
    let totalFilled = 0
    const perSection = {}

    for (const sec of FIELD_FORM_SECTIONS) {
      let count = 0
      for (const tbl of sec.tables) {
        const allTblRows = [...tbl.rows, ...(customRows[tbl.id] || [])]
        for (const r of allTblRows) {
          const st = rowsState[r.id]
          if (st && st.qty !== undefined && st.qty !== null && String(st.qty).trim() !== '') {
            count++
            totalFilled++
          }
        }
      }
      perSection[sec.id] = count
    }

    return { totalFilled, perSection }
  }, [rowsState, customRows])

  const handleReviewClick = (e) => {
    if (e) e.preventDefault()
    setErrors([])

    const result = convertFieldFormToPrSeed({
      header,
      rowsState,
      allMaterials,
      allProjects,
      estimator
    })

    if (!result.success) {
      setErrors(result.errors || ['Terjadi kesalahan validasi form.'])
      return
    }

    if (onReviewPr) {
      onReviewPr({
        form: result.form,
        prItemsList: result.prItemsList,
        rowsState,
        header
      })
    }
  }

  return (
    <div className={`field-form-container ${styles.container}`}>
      {/* Top Banner / Switcher */}
      <div className={styles.topBanner}>
        <div>
          📋 <b>Form Pengadaan Lapangan</b> — Diadaptasi dari template cetak 2 halaman A4.
          Isi baris yang dibutuhkan, baris kosong diabaikan otomatis.
        </div>
        <div className={styles.modeToggleBar}>
          {onSwitchStandard && (
            <button
              type="button"
              className="outline btn-switch-mode"
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={onSwitchStandard}
            >
              📝 Beralih ke Form Standard
            </button>
          )}
        </div>
      </div>

      {/* Header Fields */}
      <div className={styles.headerCard}>
        <div className={styles.headerGrid}>
          <label className={styles.fieldLabel}>
            Project *
            <select
              name="project_id"
              value={header.project_id}
              onChange={e => setHeader({ ...header, project_id: e.target.value })}
              required
            >
              <option value="">-- Pilih Project --</option>
              {allProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.kode ? `[${p.kode}] ` : ''}{p.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.fieldLabel}>
            Judul Kebutuhan *
            <input
              type="text"
              name="title"
              placeholder="Contoh: Pengadaan Meja & Partisi"
              value={header.title}
              onChange={e => setHeader({ ...header, title: e.target.value })}
              required
            />
          </label>

          <label className={styles.fieldLabel}>
            Prioritas
            <select
              name="priority"
              value={header.priority}
              onChange={e => setHeader({ ...header, priority: e.target.value })}
            >
              <option value="NORMAL">Standard</option>
              <option value="URGENT">Prioritas</option>
            </select>
          </label>
        </div>

        <div className={styles.headerGrid}>
          <label className={styles.fieldLabel}>
            Tanggal Form Lapangan
            <input
              type="date"
              name="date"
              value={header.date}
              onChange={e => setHeader({ ...header, date: e.target.value })}
            />
          </label>

          <label className={styles.fieldLabel}>
            Diproduksi (Workshop / Tim)
            <input
              type="text"
              name="produced_by"
              placeholder="Contoh: Workshop Tangerang"
              value={header.produced_by}
              onChange={e => setHeader({ ...header, produced_by: e.target.value })}
            />
          </label>

          <label className={styles.fieldLabel}>
            Catatan Tambahan (Opsional)
            <input
              type="text"
              name="notes"
              placeholder="Catatan umum pengadaan..."
              value={header.notes}
              onChange={e => setHeader({ ...header, notes: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* Errors Box */}
      {errors.length > 0 && (
        <div className={styles.errorsCard}>
          <b>⚠️ Terdapat {errors.length} masalah yang perlu diperbaiki:</b>
          <ul>
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 4 Kelompok Besar Accordions */}
      {FIELD_FORM_SECTIONS.map(sec => {
        const isOpen = !!openSections[sec.id]
        const filledCount = stats.perSection[sec.id] || 0

        return (
          <div key={sec.id} className={styles.sectionBox}>
            <button
              type="button"
              className={`field-section-header ${styles.sectionHeader}`}
              onClick={() => toggleSection(sec.id)}
            >
              <div className={styles.sectionHeaderLeft}>
                <span>{sec.icon}</span>
                <span>{sec.title}</span>
                {filledCount > 0 && (
                  <span className={styles.badgeFilled}>
                    ✓ {filledCount} item
                  </span>
                )}
              </div>
              <div className={styles.sectionHeaderRight}>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Halaman {sec.page}
                </span>
                <span>{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {isOpen && (
              <div className={styles.sectionContent}>
                {sec.tables.map(tbl => {
                  const combinedRows = [...tbl.rows, ...(customRows[tbl.id] || [])]

                  return (
                    <div key={tbl.id} className={styles.tableBlock}>
                      <div className={styles.tableTitle}>
                        <span>{tbl.name} ({tbl.unit})</span>
                        <button
                          type="button"
                          className={styles.btnAddRow}
                          onClick={() => addCustomRowToTable(tbl.id, tbl.unit)}
                        >
                          + Tambah Baris {tbl.name}
                        </button>
                      </div>

                      <div className={styles.tableWrapper}>
                        <table className={styles.fieldTable}>
                          <thead>
                            <tr>
                              <th style={{ width: '32%' }}>Material & Spesifikasi</th>
                              <th style={{ width: '22%' }}>Kode / Type</th>
                              <th style={{ width: '16%' }}>Qty ({tbl.unit})</th>
                              <th style={{ width: '30%' }}>Remarks & Master</th>
                            </tr>
                          </thead>
                          <tbody>
                            {combinedRows.map(r => {
                              const st = rowsState[r.id] || {}
                              const hasQty = st.qty !== undefined && st.qty !== null && String(st.qty).trim() !== ''
                              const isTouched = hasQty || !!st.selectedMaterialId || !!st.code || !!st.type || !!st.remarks

                              // Cek matching material
                              let matchInfo = { status: 'UNMATCHED', material: null, candidates: [] }
                              let resolvedMat = null

                              if (st.selectedMaterialId) {
                                resolvedMat = allMaterials.find(m => String(m.id) === String(st.selectedMaterialId))
                                matchInfo = { status: 'MATCHED', material: resolvedMat, candidates: [resolvedMat] }
                              } else {
                                matchInfo = matchMaterialForRow({
                                  rowDef: r,
                                  userCode: st.code,
                                  userType: st.type,
                                  userLabel: st.label,
                                  allMaterials
                                })
                                resolvedMat = matchInfo.material
                              }

                              // Cek unit mismatch
                              let unitMismatch = false
                              let canonicalUnit = tbl.unit
                              if (resolvedMat) {
                                canonicalUnit = normalizeUnitAlias(resolvedMat.satuan || resolvedMat.unit || tbl.unit)
                                const printedUnit = r.isCustom ? canonicalUnit : (r.unit || tbl.unit)
                                const comp = checkUnitCompatibility(printedUnit, canonicalUnit)
                                if (!comp.compatible && !st.unitResolved) {
                                  unitMismatch = true
                                }
                              }

                              return (
                                <tr
                                  key={r.id}
                                  className={`field-item-row ${styles.rowItem} ${isTouched ? styles.rowTouched : ''}`}
                                >
                                  {/* Kolom 1: Label / Name */}
                                  <td>
                                    <div className={styles.rowLabelCell}>
                                      {r.isCustom ? (
                                        <input
                                          type="text"
                                          placeholder="Nama material baru..."
                                          value={st.label || ''}
                                          onChange={e => updateRow(r.id, 'label', e.target.value)}
                                          className={styles.remarksInput}
                                        />
                                      ) : (
                                        <>
                                          <span className={styles.rowMainName}>
                                            {r.brand ? `[${r.brand}] ` : ''}{r.label}
                                          </span>
                                          {(r.spec || r.type) && (
                                            <span className={styles.rowSpecType}>
                                              {r.spec ? `${r.spec} ` : ''}{r.type || ''}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>

                                  {/* Kolom 2: Type / Kode */}
                                  <td>
                                    {r.isHpl || tbl.id === 'kf_tacosheet' ? (
                                      <input
                                        type="text"
                                        placeholder="Ketik Kode HPL..."
                                        value={st.code || ''}
                                        onChange={e => updateRow(r.id, 'code', e.target.value)}
                                        className={styles.codeInput}
                                      />
                                    ) : r.isCustom ? (
                                      <input
                                        type="text"
                                        placeholder="Type / Spesifikasi..."
                                        value={st.type || ''}
                                        onChange={e => updateRow(r.id, 'type', e.target.value)}
                                        className={styles.codeInput}
                                      />
                                    ) : (
                                      <span style={{ fontSize: '11px', color: '#475569' }}>
                                        {r.type || '—'}
                                      </span>
                                    )}
                                  </td>

                                  {/* Kolom 3: Qty */}
                                  <td>
                                    <div className={styles.qtyInputBox}>
                                      <input
                                        type="text"
                                        placeholder="0"
                                        value={st.qty !== undefined ? st.qty : ''}
                                        onChange={e => updateRow(r.id, 'qty', e.target.value)}
                                        className={styles.qtyInput}
                                      />
                                      <span className={styles.unitText}>{tbl.unit}</span>
                                    </div>
                                  </td>

                                  {/* Kolom 4: Remarks & Master Match */}
                                  <td>
                                    <div className={styles.materialSelectBox}>
                                      <input
                                        type="text"
                                        placeholder="Catatan / remarks..."
                                        value={st.remarks || ''}
                                        onChange={e => updateRow(r.id, 'remarks', e.target.value)}
                                        className={styles.remarksInput}
                                      />

                                      {/* Match status & selector bila disentuh atau ambigu */}
                                      {isTouched && (
                                        <>
                                          {matchInfo.status === 'MATCHED' && !st.selectedMaterialId ? (
                                            <div className={`${styles.matchBadge} ${styles.matchOk}`} title={resolvedMat.name}>
                                              ✓ Match: [{resolvedMat.kode || '—'}] {resolvedMat.name}
                                            </div>
                                          ) : matchInfo.status === 'AMBIGUOUS' && !st.selectedMaterialId ? (
                                            <div className={`${styles.matchBadge} ${styles.matchAmbiguous}`}>
                                              ⚠️ Ambigu ({matchInfo.candidates.length} opsi) — Pilih master:
                                            </div>
                                          ) : !resolvedMat ? (
                                            <div className={`${styles.matchBadge} ${styles.matchUnmatched}`}>
                                              ❌ Belum cocok master — Pilih:
                                            </div>
                                          ) : null}

                                          {/* Dropdown pemilih master bila ambigu / unmatched / custom / ingin ganti */}
                                          {(!resolvedMat || matchInfo.status === 'AMBIGUOUS' || st.selectedMaterialId || r.isCustom) && (
                                            <select
                                              value={st.selectedMaterialId || ''}
                                              onChange={e => updateRow(r.id, 'selectedMaterialId', e.target.value)}
                                              className={styles.matSelect}
                                            >
                                              <option value="">-- Pilih dari Master ({tbl.categoryHint || 'Semua'}) --</option>
                                              {allMaterials
                                                .filter(m => !tbl.categoryHint || String(m.category || '').toLowerCase().includes(tbl.categoryHint.toLowerCase()))
                                                .slice(0, 80)
                                                .map(m => (
                                                  <option key={m.id} value={m.id}>
                                                    [{m.kode || '—'}] {m.name} ({m.satuan || m.unit})
                                                  </option>
                                                ))}
                                            </select>
                                          )}

                                          {/* Unit Mismatch Alert & Resolver */}
                                          {unitMismatch && (
                                            <div className={styles.unitMismatchBox}>
                                              <span>⚠️ Satuan master "{canonicalUnit}" vs template "{tbl.unit}"</span>
                                              <button
                                                type="button"
                                                className={styles.btnResolveUnit}
                                                onClick={() => updateRow(r.id, 'unitResolved', true)}
                                              >
                                                Gunakan "{canonicalUnit}"
                                              </button>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Action Bar */}
      <div className={styles.actionBar}>
        <div className={styles.actionStats}>
          Total Terisi: <b>{stats.totalFilled} item</b>
        </div>
        <div className={styles.actionButtons}>
          <button type="button" className="outline" onClick={onCancel}>
            Batal
          </button>
          <button
            type="button"
            className="btn-review-pr"
            style={{ background: '#1e6648', color: '#fff', border: 'none' }}
            onClick={handleReviewClick}
          >
            Tinjau sebagai PR →
          </button>
        </div>
      </div>
    </div>
  )
}
