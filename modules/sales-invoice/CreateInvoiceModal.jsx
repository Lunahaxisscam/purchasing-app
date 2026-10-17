// ============================================================
// modules/sales-invoice/CreateInvoiceModal.jsx
// ============================================================
// Modal pembuatan Sales Invoice resmi dari penawaran RAB yang disetujui.
// Alur Bisnis: CRM (Customer) -> RAB Disetujui -> Invoice Penjualan ->
// Penerbitan Nomor Proyek Baru di Master Project (Mandat DAT).
// ============================================================

import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'

export function suggestNextProjectCode(projects = []) {
  if (!Array.isArray(projects) || projects.length === 0) return '106'
  let maxNum = 0
  for (const p of projects) {
    const raw = String(p.kode ?? p.code ?? '').trim()
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > maxNum) {
      maxNum = n
    }
  }
  return maxNum > 0 ? String(maxNum + 1) : '106'
}

export function generateInvoiceNumber(existingInvoices = []) {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const prefix = `INV/NL/${year}/${month}/`
  
  let maxSeq = 0
  for (const inv of existingInvoices) {
    const no = String(inv.invoice_no || '').trim()
    if (no.startsWith(prefix)) {
      const seqStr = no.slice(prefix.length)
      const seq = parseInt(seqStr, 10)
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq
      }
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

export default function CreateInvoiceModal({
  isOpen,
  onClose,
  onSaved,
  projects = [],
  existingInvoices = [],
  say
}) {
  const [sourceMode, setSourceMode] = useState('rab') // 'rab' | 'direct'
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [projectAddress, setProjectAddress] = useState('')
  const [rabReff, setRabReff] = useState('BOQ-001')
  const [projectName, setProjectName] = useState('')
  
  // Invoice Meta
  const [invoiceNo, setInvoiceNo] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [nominal, setNominal] = useState('')
  const [includeTax, setIncludeTax] = useState(false)
  const [taxRate, setTaxRate] = useState(11)
  const [notes, setNotes] = useState('Termin pembayaran pertama (DP) pekerjaan interior.')
  
  // Project Creation Option (Mandat Bisnis DAT)
  const [projectOption, setProjectOption] = useState('new') // 'new' | 'existing' | 'none'
  const [newProjectCode, setNewProjectCode] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Init defaults on open
  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().slice(0, 10)
      const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      setIssueDate(today)
      setDueDate(due)
      setInvoiceNo(generateInvoiceNumber(existingInvoices))
      setNewProjectCode(suggestNextProjectCode(projects))
      setError('')
      setSaving(false)
    }
  }, [isOpen, existingInvoices, projects])

  if (!isOpen) return null

  // Duplicate checks
  const cleanCode = String(newProjectCode || '').trim()
  const isDuplicateProjectCode = projectOption === 'new' && cleanCode
    ? projects.some(p => String(p.kode ?? p.code ?? '').trim().toLowerCase() === cleanCode.toLowerCase())
    : false

  const cleanInvoiceNo = String(invoiceNo || '').trim()
  const isDuplicateInvoiceNo = cleanInvoiceNo
    ? existingInvoices.some(inv => String(inv.invoice_no || '').trim().toLowerCase() === cleanInvoiceNo.toLowerCase())
    : false

  const rawNominal = parseFloat(nominal) || 0
  const taxAmount = includeTax ? Math.round(rawNominal * (taxRate / 100)) : 0
  const grandTotal = rawNominal + taxAmount

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return
    setError('')

    if (!cleanInvoiceNo) {
      setError('Nomor invoice wajib diisi.')
      return
    }
    if (isDuplicateInvoiceNo) {
      setError(`Nomor invoice "${cleanInvoiceNo}" sudah digunakan. Silakan gunakan nomor lain.`)
      return
    }
    if (!customerName.trim()) {
      setError('Nama customer (CRM) wajib diisi.')
      return
    }
    if (rawNominal <= 0) {
      setError('Nominal tagihan harus lebih besar dari 0.')
      return
    }

    if (projectOption === 'new') {
      if (!cleanCode) {
        setError('Nomor / kode proyek baru wajib diisi.')
        return
      }
      if (isDuplicateProjectCode) {
        setError(`Kode proyek "${cleanCode}" sudah digunakan di Master Project. Gunakan kode lain.`)
        return
      }
    }

    setSaving(true)

    try {
      let createdProjectId = null
      let assignedProjectCode = ''
      let finalProjectName = projectName.trim() || `${customerName.trim()} Project`

      // 1. Mandat DAT: Jika opsi 'new', terbitkan nomor proyek baru di tabel `projects` Supabase
      if (projectOption === 'new' && supabase) {
        const { data: projData, error: projErr } = await supabase
          .from('projects')
          .insert([{
            kode: cleanCode,
            code: cleanCode,
            name: finalProjectName,
            status: 'ON_GOING'
          }])
          .select()

        if (projErr) {
          throw new Error(`Gagal menerbitkan proyek baru ke Master Project: ${projErr.message}`)
        }
        if (projData && projData[0]) {
          createdProjectId = projData[0].id
          assignedProjectCode = cleanCode
        }
      } else if (projectOption === 'existing' && selectedProjectId) {
        createdProjectId = selectedProjectId
        const pObj = projects.find(p => p.id === selectedProjectId)
        if (pObj) {
          assignedProjectCode = String(pObj.kode ?? pObj.code ?? '')
          if (!projectName.trim()) {
            finalProjectName = pObj.name || ''
          }
        }
      }

      // 2. Simpan Sales Invoice ke backend
      const payload = {
        invoice_no: cleanInvoiceNo,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        project_address: projectAddress.trim(),
        rab_reff: rabReff.trim(),
        project_name: finalProjectName,
        project_code: assignedProjectCode,
        project_id: createdProjectId,
        nominal: rawNominal,
        tax_rate: includeTax ? taxRate : 0,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        notes: notes.trim(),
        payment_terms: 'DP / Termin',
        issue_date: issueDate,
        due_date: dueDate,
        status: 'TERKIRIM' // langsung berstatus TERKIRIM saat diterbitkan
      }

      const res = await fetch('/api/sales-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Gagal menyimpan sales invoice.')
      }

      if (say) {
        if (projectOption === 'new') {
          say(`✓ Invoice ${cleanInvoiceNo} berhasil dibuat & Proyek [${cleanCode}] ${finalProjectName} resmi diterbitkan di Master Project!`)
        } else {
          say(`✓ Invoice ${cleanInvoiceNo} berhasil diterbitkan!`)
        }
      }

      if (onSaved) {
        onSaved(json.invoice)
      }
      onClose()
    } catch (err) {
      console.error('Submit Sales Invoice error:', err)
      setError(err.message || 'Terjadi kesalahan saat memproses invoice.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="si-modal-overlay">
      <div className="si-modal-card">
        <div className="si-modal-head">
          <div>
            <h3>🧾 Buat Invoice Penjualan (Sales Invoice)</h3>
            <p>Alur Bisnis: Penawaran Disetujui ➔ Invoice Penjualan ➔ Penerbitan Nomor Master Project</p>
          </div>
          <button type="button" className="si-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="si-modal-body">
            {error && <div className="si-modal-err">⚠️ {error}</div>}

            {/* SEKSI 1: IDENTITAS CUSTOMER & SUMBER RAB */}
            <div className="si-form-section">
              <div className="si-sec-title">
                <span className="si-sec-num">1</span>
                <span>Customer CRM &amp; Referensi Penawaran RAB</span>
              </div>

              <div className="si-grid-2">
                <div className="si-field">
                  <label>Nama Customer / Klien (CRM) *</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Ibu Jessica / PT Maju Sentosa"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="si-field">
                  <label>No. Kontak / WhatsApp</label>
                  <input
                    type="text"
                    placeholder="0812-xxxx-xxxx"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="si-grid-2">
                <div className="si-field">
                  <label>Ref. Penawaran RAB / BOQ Disetujui</label>
                  <input
                    type="text"
                    placeholder="Contoh: BOQ-001 / RAB-Verdi-02"
                    value={rabReff}
                    onChange={e => setRabReff(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="si-field">
                  <label>Nama / Judul Pekerjaan</label>
                  <input
                    type="text"
                    placeholder="Contoh: Fit-Out Interior Master Bedroom"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="si-field">
                <label>Lokasi / Alamat Proyek</label>
                <input
                  type="text"
                  placeholder="Contoh: Cluster Verdi Barat No. 8, Gading Serpong"
                  value={projectAddress}
                  onChange={e => setProjectAddress(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            {/* SEKSI 2: PENERBITAN NOMOR MASTER PROJECT (MANDAT DAT) */}
            <div className="si-form-section si-sec-highlight">
              <div className="si-sec-title">
                <span className="si-sec-num">2</span>
                <span>Penerbitan Nomor Proyek Resmi (Master Project)</span>
              </div>
              <p className="si-sec-hint">
                💡 <i>Arahan Bisnis Noir Living:</i> Nomor proyek baru resmi diterbitkan saat Sales Invoice pertama dibuat dari deal penawaran yang disetujui.
              </p>

              <div className="si-proj-options">
                <label className="si-radio-opt">
                  <input
                    type="radio"
                    name="projectOption"
                    value="new"
                    checked={projectOption === 'new'}
                    onChange={() => setProjectOption('new')}
                    disabled={saving}
                  />
                  <span><b>✨ Terbitkan Nomor Proyek Baru</b> (Pendaftaran deal deal-maker ke Master Project)</span>
                </label>

                <label className="si-radio-opt">
                  <input
                    type="radio"
                    name="projectOption"
                    value="existing"
                    checked={projectOption === 'existing'}
                    onChange={() => setProjectOption('existing')}
                    disabled={saving}
                  />
                  <span><b>🔗 Tautkan ke Proyek Existing</b> (Invoice lanjutan / termin proyek yang sudah ada)</span>
                </label>

                <label className="si-radio-opt">
                  <input
                    type="radio"
                    name="projectOption"
                    value="none"
                    checked={projectOption === 'none'}
                    onChange={() => setProjectOption('none')}
                    disabled={saving}
                  />
                  <span><b>⚪ Tanpa Nomor Proyek</b> (Invoice umum / belum menerbitkan proyek)</span>
                </label>
              </div>

              {projectOption === 'new' && (
                <div className="si-new-proj-box">
                  <div className="si-field">
                    <label>Nomor / Kode Proyek Resmi yang Diterbitkan *</label>
                    <div className="si-code-input-wrap">
                      <input
                        type="text"
                        required
                        value={newProjectCode}
                        onChange={e => setNewProjectCode(e.target.value)}
                        placeholder="Contoh: 106"
                        className={isDuplicateProjectCode ? 'input-error' : ''}
                        disabled={saving}
                      />
                      <span className="si-code-status">
                        {isDuplicateProjectCode ? (
                          <span style={{ color: '#d32f2f' }}>❌ Kode sudah dipakai!</span>
                        ) : cleanCode ? (
                          <span style={{ color: '#2e7d32' }}>✓ Tersedia (Status: ON_GOING)</span>
                        ) : null}
                      </span>
                    </div>
                    <small>Sistem menyarankan nomor berikutnya secara berurutan. Anda dapat mengubahnya sesuai format nomor proyek.</small>
                  </div>
                </div>
              )}

              {projectOption === 'existing' && (
                <div className="si-new-proj-box">
                  <div className="si-field">
                    <label>Pilih Proyek Aktif dari Master Project</label>
                    <select
                      value={selectedProjectId}
                      onChange={e => setSelectedProjectId(e.target.value)}
                      disabled={saving}
                      required
                    >
                      <option value="">-- Pilih Proyek --</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>
                          [{p.kode ?? p.code ?? '-'}] {p.name} ({p.status})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* SEKSI 3: DETAIL TAGIHAN / INVOICE */}
            <div className="si-form-section">
              <div className="si-sec-title">
                <span className="si-sec-num">3</span>
                <span>Rincian Nilai Tagihan &amp; Pembayaran</span>
              </div>

              <div className="si-grid-3">
                <div className="si-field">
                  <label>Nomor Dokumen Invoice *</label>
                  <input
                    type="text"
                    required
                    value={invoiceNo}
                    onChange={e => setInvoiceNo(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="si-field">
                  <label>Tanggal Diterbitkan</label>
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={e => setIssueDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="si-field">
                  <label>Jatuh Tempo</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="si-grid-2">
                <div className="si-field">
                  <label>Nominal Tagihan (IDR) *</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    placeholder="Contoh: 85000000"
                    value={nominal}
                    onChange={e => setNominal(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="si-field">
                  <label>Pengaturan PPN</label>
                  <div className="si-tax-toggle">
                    <label>
                      <input
                        type="checkbox"
                        checked={includeTax}
                        onChange={e => setIncludeTax(e.target.checked)}
                        disabled={saving}
                      />
                      <span>Tambah PPN (11%)</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="si-calc-summary">
                <div className="si-calc-row">
                  <span>Subtotal Nilai:</span>
                  <b>Rp {rawNominal.toLocaleString('id-ID')}</b>
                </div>
                {includeTax && (
                  <div className="si-calc-row">
                    <span>PPN 11%:</span>
                    <b>Rp {taxAmount.toLocaleString('id-ID')}</b>
                  </div>
                )}
                <div className="si-calc-row si-calc-grand">
                  <span>TOTAL TAGIHAN KLIEN:</span>
                  <span className="si-grand-badge">Rp {grandTotal.toLocaleString('id-ID')}</span>
                </div>
              </div>

              <div className="si-field" style={{ marginTop: '12px' }}>
                <label>Catatan / Instruksi Pembayaran Klien</label>
                <textarea
                  rows="2"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Catatan rekening tujuan atau keterangan termin pembayaran..."
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="si-modal-foot">
            <button type="button" className="si-btn-cancel" onClick={onClose} disabled={saving}>
              Batal
            </button>
            <button type="submit" className="si-btn-submit" disabled={saving || isDuplicateInvoiceNo || isDuplicateProjectCode}>
              {saving ? '⏳ Memproses & Menerbitkan...' : '✓ Simpan & Terbitkan Invoice'}
            </button>
          </div>
        </form>
      </div>

      <style>{`
        .si-modal-overlay {
          position: fixed; inset: 0; background: rgba(20, 24, 20, 0.65);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 16px; backdrop-filter: blur(4px);
        }
        .si-modal-card {
          background: #ffffff; width: 100%; max-width: 760px;
          max-height: 92vh; border-radius: 14px; display: flex; flex-direction: column;
          box-shadow: 0 12px 36px rgba(0,0,0,0.22); overflow: hidden;
          border: 1px solid #dcded8;
        }
        .si-modal-head {
          padding: 16px 20px; background: #f7f8f5; border-bottom: 1px solid #e2e4de;
          display: flex; align-items: center; justify-content: space-between;
        }
        .si-modal-head h3 { margin: 0; font-size: 16px; color: #232720; font-weight: 700; }
        .si-modal-head p { margin: 3px 0 0; font-size: 12px; color: #6b6f66; }
        .si-modal-close {
          background: none; border: none; font-size: 18px; color: #888;
          cursor: pointer; padding: 4px 8px; border-radius: 4px;
        }
        .si-modal-close:hover { background: #eaece6; color: #222; }
        .si-modal-body {
          padding: 18px 22px; overflow-y: auto; flex: 1;
        }
        .si-modal-err {
          background: #fde8e8; color: #b71c1c; padding: 10px 14px;
          border-radius: 8px; font-size: 12.5px; margin-bottom: 16px;
          border: 1px solid #f5c6c6;
        }
        .si-form-section {
          background: #fafbf9; border: 1px solid #e5e7e0;
          border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
        }
        .si-sec-highlight {
          background: #fdfaf2; border-color: #eeddb2;
        }
        .si-sec-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13.5px; font-weight: 700; color: #3b4233; margin-bottom: 10px;
        }
        .si-sec-num {
          background: #4b523a; color: #fff; width: 20px; height: 20px;
          border-radius: 50%; display: grid; place-items: center; font-size: 11px;
        }
        .si-sec-hint {
          font-size: 11.5px; color: #6b6f66; margin: 0 0 12px; line-height: 1.5;
        }
        .si-grid-2 {
          display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
        }
        .si-grid-3 {
          display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 12px;
        }
        .si-field {
          margin-bottom: 10px;
        }
        .si-field label {
          display: block; font-size: 11.5px; font-weight: 600;
          color: #4b523a; margin-bottom: 5px;
        }
        .si-field input, .si-field select, .si-field textarea {
          width: 100%; border: 1px solid #cfd3c7; border-radius: 6px;
          padding: 7px 10px; font-size: 12.5px; color: #232720;
          background: #fff; font-family: inherit;
        }
        .si-field input:focus, .si-field select:focus, .si-field textarea:focus {
          border-color: #4b523a; outline: none; box-shadow: 0 0 0 2px rgba(75,82,58,0.15);
        }
        .si-field input.input-error {
          border-color: #d32f2f; background: #fff8f8;
        }
        .si-field small {
          display: block; font-size: 11px; color: #7a7e75; margin-top: 4px;
        }
        .si-proj-options {
          display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;
        }
        .si-radio-opt {
          display: flex; align-items: center; gap: 8px; font-size: 12.5px;
          color: #333; cursor: pointer; padding: 6px 10px; border-radius: 6px;
          background: #ffffff; border: 1px solid #e2e4dc;
        }
        .si-radio-opt:hover { background: #f5f6f0; }
        .si-new-proj-box {
          background: #ffffff; border: 1px dashed #d5d8cc;
          padding: 12px 14px; border-radius: 8px;
        }
        .si-code-input-wrap {
          display: flex; align-items: center; gap: 12px;
        }
        .si-code-input-wrap input {
          width: 140px; font-weight: bold; font-size: 14px;
        }
        .si-code-status {
          font-size: 12px; font-weight: 600;
        }
        .si-tax-toggle {
          padding-top: 8px;
        }
        .si-tax-toggle label {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          font-weight: normal; font-size: 12.5px;
        }
        .si-calc-summary {
          background: #f0f2eb; border: 1px solid #d8dccf;
          border-radius: 8px; padding: 10px 14px; margin-top: 6px;
        }
        .si-calc-row {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12px; color: #555; padding: 3px 0;
        }
        .si-calc-grand {
          margin-top: 6px; padding-top: 6px; border-top: 1px dashed #cfd4c5;
          font-weight: 700; color: #232720;
        }
        .si-grand-badge {
          font-size: 14px; color: #1b6348; font-weight: 800;
        }
        .si-modal-foot {
          padding: 14px 20px; background: #f7f8f5; border-top: 1px solid #e2e4de;
          display: flex; justify-content: flex-end; gap: 10px;
        }
        .si-btn-cancel {
          background: #ffffff; border: 1px solid #cfd3c7; color: #555;
          padding: 7px 14px; border-radius: 6px; font-size: 12.5px; cursor: pointer;
        }
        .si-btn-cancel:hover { background: #eaece5; color: #222; }
        .si-btn-submit {
          background: #4b523a; border: 1px solid #3d432e; color: #ffffff;
          padding: 7px 18px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .si-btn-submit:hover { background: #3d432e; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
        .si-btn-submit:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
