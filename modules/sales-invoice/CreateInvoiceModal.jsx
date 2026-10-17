// ============================================================
// modules/sales-invoice/CreateInvoiceModal.jsx
// ============================================================
// Modal pembuatan Sales Invoice.
//
// PERUBAHAN KONTRAK (S4, temuan review Brooklyn):
//   * Form ini HANYA membuat DRAFT. Tidak ada lagi nomor invoice yang
//     dikarang di klien, tidak ada lagi "langsung TERKIRIM" — dulu invoice
//     lahir dengan status TERKIRIM padahal belum pernah dikirim ke siapa pun.
//   * Nomor proyek TIDAK lagi di-insert ke `projects` dari browser sebelum
//     invoice tersimpan. Urutan sekarang: simpan draf → terbitkan (server
//     mengalokasikan nomor invoice, lalu nomor proyek). Bila invoice gagal,
//     tidak ada nomor proyek yatim.
//   * Nomor proyek di form hanya SARAN (advisory); server selalu memeriksa
//     ulang keunikan & bisa menolak dengan kode 409 + saran nomor berikutnya.
//   * Semua panggilan lewat apiClient (membawa JWT + Idempotency-Key).
// ============================================================

import React, { useState, useEffect, useMemo } from 'react'
import { createDraftInvoice, issueInvoice, makeIdempotencyKey } from './apiClient'
import {
  LIMITS,
  isProjectCodeTaken,
  nextNumericProjectCode
} from './contract.js'

export default function CreateInvoiceModal({
  isOpen,
  onClose,
  onSaved,
  projects = [],
  existingInvoices = [],
  say,
  token
}) {
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [projectAddress, setProjectAddress] = useState('')
  const [rabReff, setRabReff] = useState('')
  const [projectName, setProjectName] = useState('')

  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [nominal, setNominal] = useState('')
  const [includeTax, setIncludeTax] = useState(false)
  // Tarif PPN TIDAK default 11%: kosong sampai admin mengisinya.
  const [taxRate, setTaxRate] = useState('')
  // Catatan & termin dikosongkan: server/UI TIDAK mengarang default termin
  // atau PPN. Admin mengisi sendiri bila memang ada kesepakatan.
  const [notes, setNotes] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')

  const [projectOption, setProjectOption] = useState('new') // 'new' | 'existing' | 'none'
  const [newProjectCode, setNewProjectCode] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Satu kunci idempotensi per pembukaan modal: retry manual memakai kunci
  // yang sama sehingga tidak pernah menghasilkan dua invoice.
  const [draftKey, setDraftKey] = useState('')

  useEffect(() => {
    if (!isOpen) return
    // Tanggal TIDAK diisi otomatis: dokumen yang menagih klien harus memakai
    // tanggal yang benar-benar dipilih admin (temuan review Brooklyn).
    setIssueDate('')
    setDueDate('')
    setNewProjectCode(nextNumericProjectCode(projects))
    setError('')
    setNotice('')
    setSaving(false)
    setDraftKey(makeIdempotencyKey('si-draft'))
  }, [isOpen, projects])

  const suggestion = useMemo(() => nextNumericProjectCode(projects), [projects])
  const cleanCode = String(newProjectCode || '').trim()
  const isDuplicateProjectCode = projectOption === 'new' && cleanCode
    ? isProjectCodeTaken(projects, cleanCode)
    : false

  const rawNominal = parseFloat(nominal) || 0
  const taxRateNum = parseFloat(taxRate) || 0
  const taxAmount = includeTax ? Math.round(rawNominal * (taxRateNum / 100)) : 0
  const grandTotal = rawNominal + taxAmount

  if (!isOpen) return null

  function buildPayload() {
    return {
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      project_address: projectAddress.trim(),
      project_name: projectName.trim(),
      rab_reff: rabReff.trim(),
      nominal: rawNominal,
      tax_rate: includeTax ? taxRateNum : 0,
      notes: notes.trim(),
      // Termin TIDAK diisi default oleh UI: hanya dari input admin.
      payment_terms: String(paymentTerms || '').trim(),
      issue_date: issueDate,
      due_date: dueDate,
      // status TIDAK dikirim: draf selalu DRAFT (server menolak status lain)
      project_intent: {
        mode: projectOption,
        code: projectOption === 'new' ? cleanCode : '',
        project_id: projectOption === 'existing' ? selectedProjectId : ''
      }
    }
  }

  function validate() {
    if (!customerName.trim()) return 'Nama customer (CRM) wajib diisi.'
    if (rawNominal <= 0) return 'Nominal tagihan harus lebih besar dari 0.'
    if (!issueDate) return 'Tanggal terbit wajib diisi.'
    if (projectOption === 'new') {
      if (!cleanCode) return 'Nomor / kode proyek baru wajib diisi.'
      if (isDuplicateProjectCode) {
        return `Kode proyek "${cleanCode}" sudah dipakai di Master Project. Nomor berikutnya yang tersedia: ${suggestion}.`
      }
    }
    if (projectOption === 'existing' && !selectedProjectId) return 'Pilih proyek existing yang akan ditautkan.'
    return ''
  }

  async function handleSaveDraft(e) {
    e.preventDefault()
    if (saving) return
    setError('')
    setNotice('')
    const invalid = validate()
    if (invalid) { setError(invalid); return }

    setSaving(true)
    try {
      const json = await createDraftInvoice(buildPayload(), { token, idempotencyKey: draftKey })
      const inv = json.invoice
      if (onSaved) onSaved(inv)
      if (say) say(`✓ Draf invoice ${inv.id} tersimpan${json.replayed ? ' (permintaan ulang, tidak ada duplikat)' : ''}.`)
      setNotice(
        `Draf tersimpan. Belum ada nomor invoice dan belum ada nomor proyek — keduanya dialokasikan saat Anda menekan "Terbitkan".` +
        (json.replayed ? ' Permintaan identik sebelumnya sudah tersimpan; tidak ada duplikat.' : '')
      )
      setDraftKey(makeIdempotencyKey('si-draft'))
    } catch (err) {
      setError(err.message || 'Gagal menyimpan draf invoice.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndIssue(e) {
    e.preventDefault()
    if (saving) return
    setError('')
    setNotice('')
    const invalid = validate()
    if (invalid) { setError(invalid); return }

    setSaving(true)
    try {
      // 1) Simpan draf (idempoten).
      const created = await createDraftInvoice(buildPayload(), { token, idempotencyKey: draftKey })
      const draft = created.invoice

      // 2) Terbitkan. Server mengalokasikan nomor invoice; nomor proyek baru
      //    diterbitkan SETELAH invoice tersimpan.
      const issued = await issueInvoice(draft.id, { token })
      const inv = issued.invoice
      if (onSaved) onSaved(inv)
      const warn = (issued.warnings || []).join(' ')
      if (say) {
        say(
          `✓ Invoice ${inv.invoice_no} diterbitkan` +
          (inv.project_issued && inv.project_code ? ` & proyek [${inv.project_code}] terdaftar.` : '.') +
          (warn ? ' ' + warn : '')
        )
      }
      setDraftKey(makeIdempotencyKey('si-draft'))
      onClose()
    } catch (err) {
      setError(
        (err.message || 'Gagal menerbitkan invoice.') +
        (err.extra && err.extra.suggested_code ? ` Nomor proyek berikutnya yang tersedia: ${err.extra.suggested_code}.` : '')
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="si-modal-overlay">
      <div className="si-modal-card">
        <div className="si-modal-head">
          <div>
            <h3>🧾 Buat Invoice Penjualan (draf)</h3>
            <p>Draf disimpan dulu. Nomor invoice &amp; nomor proyek diterbitkan saat Anda menekan Terbitkan.</p>
          </div>
          <button type="button" className="si-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>

        <form onSubmit={handleSaveAndIssue}>
          <div className="si-modal-body">
            {error && <div className="si-modal-err">⚠️ {error}</div>}
            {notice && <div className="si-modal-note">{notice}</div>}

            {/* SEKSI 1 */}
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
                    maxLength={LIMITS.customer_name}
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
                    maxLength={LIMITS.customer_phone}
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
                    maxLength={LIMITS.rab_reff}
                    placeholder="Contoh: BOQ-001 / RAB-Verdi-02"
                    value={rabReff}
                    onChange={e => setRabReff(e.target.value)}
                    disabled={saving}
                  />
                  <small>Kosongkan bila belum ada — jangan mengarang nomor referensi.</small>
                </div>
                <div className="si-field">
                  <label>Nama / Judul Pekerjaan</label>
                  <input
                    type="text"
                    maxLength={LIMITS.project_name}
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
                  maxLength={LIMITS.project_address}
                  placeholder="Contoh: Cluster Verdi Barat No. 8, Gading Serpong"
                  value={projectAddress}
                  onChange={e => setProjectAddress(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            {/* SEKSI 2 */}
            <div className="si-form-section si-sec-highlight">
              <div className="si-sec-title">
                <span className="si-sec-num">2</span>
                <span>Nomor Proyek (diterbitkan saat invoice terbit)</span>
              </div>
              <p className="si-sec-hint">
                💡 Nomor proyek baru baru didaftarkan ke Master Project <b>setelah</b> invoice berhasil
                tersimpan. Jadi tidak ada nomor proyek yang terpakai untuk invoice yang gagal.
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
                  <span><b>✨ Terbitkan nomor proyek baru</b> saat invoice terbit</span>
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
                  <span><b>🔗 Tautkan ke proyek existing</b> (termin lanjutan)</span>
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
                  <span><b>⚪ Tanpa nomor proyek</b> (invoice umum)</span>
                </label>
              </div>

              {projectOption === 'new' && (
                <div className="si-new-proj-box">
                  <div className="si-field">
                    <label>Usulan Nomor Proyek (bisa diubah) *</label>
                    <div className="si-code-input-wrap">
                      <input
                        type="text"
                        maxLength={LIMITS.project_code}
                        value={newProjectCode}
                        onChange={e => setNewProjectCode(e.target.value)}
                        placeholder={suggestion}
                        className={isDuplicateProjectCode ? 'input-error' : ''}
                        disabled={saving}
                      />
                      <span className="si-code-status">
                        {isDuplicateProjectCode ? (
                          <span style={{ color: '#d32f2f' }}>❌ sudah dipakai</span>
                        ) : cleanCode ? (
                          <span style={{ color: '#2e7d32' }}>✓ tampak tersedia</span>
                        ) : null}
                      </span>
                    </div>
                    <small>
                      Hanya usulan dari data proyek yang sedang dimuat. Server memeriksa ulang keunikan
                      dan dapat menolak (409) bila nomor ini ternyata sudah dipakai.
                    </small>
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

            {/* SEKSI 3 */}
            <div className="si-form-section">
              <div className="si-sec-title">
                <span className="si-sec-num">3</span>
                <span>Rincian Nilai Tagihan</span>
              </div>

              <div className="si-grid-3">
                <div className="si-field">
                  <label>Nomor Dokumen Invoice</label>
                  <input type="text" value="(otomatis saat terbit)" readOnly disabled />
                  <small>Dialokasikan server saat terbit, mengikuti format Buku (Obsidian): NL&lt;yymm&gt;&lt;urut 3 digit&gt;, urut reset tiap tahun.</small>
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
                      <span>Tambah PPN</span>
                    </label>
                    {includeTax && (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        style={{ width: 90, marginLeft: 8 }}
                        placeholder="tarif %"
                        value={taxRate}
                        onChange={e => setTaxRate(e.target.value)}
                        disabled={saving}
                      />
                    )}
                  </div>
                  <small>Tarif PPN tidak diasumsikan: isi sendiri bila memang dipungut.</small>
                </div>
              </div>

              <div className="si-calc-summary">
                <div className="si-calc-row">
                  <span>Subtotal Nilai:</span>
                  <b>Rp {rawNominal.toLocaleString('id-ID')}</b>
                </div>
                {includeTax && (
                  <div className="si-calc-row">
                    <span>PPN {taxRateNum}%:</span>
                    <b>Rp {taxAmount.toLocaleString('id-ID')}</b>
                  </div>
                )}
                <div className="si-calc-row si-calc-grand">
                  <span>TOTAL TAGIHAN KLIEN:</span>
                  <span className="si-grand-badge">Rp {grandTotal.toLocaleString('id-ID')}</span>
                </div>
                <div className="si-calc-row" style={{ fontSize: 11, color: '#6b6f66' }}>
                  Total dihitung ulang di server; angka kiriman klien tidak dipercaya.
                </div>
              </div>

              <div className="si-field" style={{ marginTop: '12px' }}>
                <label>Catatan / Instruksi Pembayaran Klien</label>
                <textarea
                  rows="2"
                  maxLength={LIMITS.notes}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Catatan termin pembayaran..."
                  disabled={saving}
                />
              </div>

              <div className="si-field">
                <label>Termin / Skema Pembayaran (opsional)</label>
                <input
                  type="text"
                  maxLength={LIMITS.payment_terms}
                  value={paymentTerms}
                  onChange={e => setPaymentTerms(e.target.value)}
                  placeholder="Kosongkan bila belum ada kesepakatan termin"
                  disabled={saving}
                />
                <small>Tidak diisi otomatis: termin hanya dicetak bila admin mengisinya.</small>
              </div>
            </div>
          </div>

          <div className="si-modal-foot">
            <button type="button" className="si-btn-cancel" onClick={onClose} disabled={saving}>
              Batal
            </button>
            <button type="button" className="si-btn-draft" onClick={handleSaveDraft} disabled={saving}>
              {saving ? '⏳ Memproses…' : '💾 Simpan Draf'}
            </button>
            <button type="submit" className="si-btn-submit" disabled={saving || isDuplicateProjectCode}>
              {saving ? '⏳ Memproses…' : '✓ Simpan & Terbitkan'}
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
        .si-modal-body { padding: 18px 22px; overflow-y: auto; flex: 1; }
        .si-modal-err {
          background: #fde8e8; color: #b71c1c; padding: 10px 14px;
          border-radius: 8px; font-size: 12.5px; margin-bottom: 16px;
          border: 1px solid #f5c6c6;
        }
        .si-modal-note {
          background: #eef4ea; color: #33502a; padding: 10px 14px;
          border-radius: 8px; font-size: 12px; margin-bottom: 16px;
          border: 1px solid #cfe0c4; line-height: 1.5;
        }
        .si-form-section {
          background: #fafbf9; border: 1px solid #e5e7e0;
          border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
        }
        .si-sec-highlight { background: #fdfaf2; border-color: #eeddb2; }
        .si-sec-title {
          display: flex; align-items: center; gap: 8px;
          font-size: 13.5px; font-weight: 700; color: #3b4233; margin-bottom: 10px;
        }
        .si-sec-num {
          background: #4b523a; color: #fff; width: 20px; height: 20px;
          border-radius: 50%; display: grid; place-items: center; font-size: 11px;
        }
        .si-sec-hint { font-size: 11.5px; color: #6b6f66; margin: 0 0 12px; line-height: 1.5; }
        .si-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .si-grid-3 { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 12px; }
        .si-field { margin-bottom: 10px; }
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
        .si-field input.input-error { border-color: #d32f2f; background: #fff8f8; }
        .si-field small { display: block; font-size: 11px; color: #7a7e75; margin-top: 4px; }
        .si-proj-options { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
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
        .si-code-input-wrap { display: flex; align-items: center; gap: 12px; }
        .si-code-input-wrap input { width: 140px; font-weight: bold; font-size: 14px; }
        .si-code-status { font-size: 12px; font-weight: 600; }
        .si-tax-toggle { padding-top: 8px; }
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
        .si-grand-badge { font-size: 14px; color: #1b6348; font-weight: 800; }
        .si-modal-foot {
          padding: 14px 20px; background: #f7f8f5; border-top: 1px solid #e2e4de;
          display: flex; justify-content: flex-end; gap: 10px;
        }
        .si-btn-cancel {
          background: #ffffff; border: 1px solid #cfd3c7; color: #555;
          padding: 7px 14px; border-radius: 6px; font-size: 12.5px; cursor: pointer;
        }
        .si-btn-cancel:hover { background: #eaece5; color: #222; }
        .si-btn-draft {
          background: #ffffff; border: 1px solid #4b523a; color: #3b4233;
          padding: 7px 14px; border-radius: 6px; font-size: 12.5px;
          font-weight: 600; cursor: pointer;
        }
        .si-btn-draft:hover { background: #f0f2ea; }
        .si-btn-submit {
          background: #4b523a; border: 1px solid #3d432e; color: #ffffff;
          padding: 7px 18px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .si-btn-submit:hover { background: #3d432e; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
        .si-btn-submit:disabled, .si-btn-draft:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
