// ============================================================
// modules/receivings/purchaseForm.jsx — DIALOG "PROSES PEMBELIAN"
// ============================================================
// Satu dialog = SATU NOTA = SATU TOKO (arahan DAT). Isi:
//   - Toko / Vendor (terisi otomatis dari barang yang dicentang, bisa diganti)
//   - Tanggal belanja (default hari ini)
//   - No. Invoice / No. Nota toko (WAJIB, mis. TB-88912)
//   - Tabel item: nama & satuan, Qty beli (default qty PR, boleh diubah),
//     Harga satuan RIIL NETTO (dari nota toko), Subtotal otomatis
//   - Biaya lain / ongkir dan diskon toko (dipisah — beban operasional WS)
//   - Total nota riil otomatis
//   - Lampiran opsional: foto nota/struk + bukti transfer
//   - Tombol "✓ Selesaikan Pembelian"
//
// TIDAK ADA input gudang / tukang / retur / refund di sini (pindah Handover).
// Input TIDAK menulis DB saat mengetik: semua tersimpan sekali saat tombol
// "Selesaikan Pembelian" ditekan (purchaseSave.js).
// ============================================================
import React, { useMemo, useRef, useState } from 'react'
import { rupiah } from '../../lib/constants'
import { buildFormDraft, computeTotals, validatePurchaseForm } from './purchaseLogic'
import { readAttachment, dataUrlByteSize, sizeLabel, ATTACHMENT_MAX_BYTES } from './attachments'
import { savePurchase } from './purchaseSave'

export default function PurchaseForm({
  rows, vendorId, vendors = [], receivings = [], receivingItems = [], close, onDone, say
}) {
  const [form, setForm] = useState(() => buildFormDraft(rows, { vendorId }))
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [touched, setTouched] = useState(false)
  const [fileBusy, setFileBusy] = useState('')
  const busyRef = useRef(false)

  const totals = useMemo(() => computeTotals(form), [form])
  const v = useMemo(() => validatePurchaseForm(form, { vendors }), [form, vendors])
  const canSubmit = !saving && !fileBusy && v.valid

  const setField = (k, val) => setForm(prev => ({ ...prev, [k]: val }))
  const setItem = (prItemId, k, val) => setForm(prev => ({
    ...prev,
    items: prev.items.map(it => (it.prItemId === prItemId ? { ...it, [k]: val } : it))
  }))

  async function pickFile(kind, file) {
    if (!file || fileBusy) return
    setFileBusy(kind)
    setErrorMsg('')
    const res = await readAttachment(file, { maxBytes: ATTACHMENT_MAX_BYTES })
    setFileBusy('')
    if (!res.ok) { setErrorMsg(res.error); return }
    setField(kind === 'nota' ? 'buktiNota' : 'buktiTransfer', res.dataUrl)
    say?.(`${kind === 'nota' ? 'Foto nota' : 'Bukti transfer'} siap dilampirkan (${sizeLabel(res.size)}).`)
  }

  function clearFile(kind) {
    setField(kind === 'nota' ? 'buktiNota' : 'buktiTransfer', '')
  }

  async function submit(e) {
    e.preventDefault()
    if (busyRef.current || saving) return
    setTouched(true)
    if (!v.valid) {
      setErrorMsg(v.errors[0] || Object.values(v.itemErrors).flatMap(x => Object.values(x))[0] || 'Periksa kembali isian yang ditandai.')
      return
    }
    setErrorMsg('')
    busyRef.current = true
    setSaving(true)
    try {
      const res = await savePurchase({ form, receivings, receivingItems, vendors })
      if (!res.ok) {
        setErrorMsg(res.error || 'Gagal menyimpan nota pembelian.')
        if (res.partial) say?.(res.error)
        return
      }
      onDone?.(res)
    } catch (err) {
      setErrorMsg(`Terjadi kesalahan saat menyimpan: ${err.message}`)
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="modal">
      <form className="dialog dialog-purchase" onSubmit={submit} data-testid="purchase-form">
        <div className="dialoghead">
          <h2>🧾 Proses Pembelian</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        <div className="purchase-form-grid">
          <label>
            Toko / Vendor
            <select
              value={form.vendorId}
              onChange={e => setField('vendorId', e.target.value)}
              data-testid="form-vendor"
            >
              <option value="">-- Pilih toko --</option>
              {vendors.map(vv => (
                <option key={vv.id} value={vv.id}>{vv.name}</option>
              ))}
            </select>
            {touched && !form.vendorId && <span className="purchase-field-error">Toko wajib dipilih.</span>}
          </label>
          <label>
            Tanggal Belanja
            <input
              type="date"
              value={form.tanggal}
              onChange={e => setField('tanggal', e.target.value)}
              data-testid="form-date"
            />
          </label>
          <label>
            No. Invoice / No. Nota Toko
            <input
              type="text"
              placeholder="Contoh: TB-88912"
              value={form.invoiceNo}
              onChange={e => setField('invoiceNo', e.target.value)}
              data-testid="form-invoice"
            />
            {touched && !String(form.invoiceNo).trim() && <span className="purchase-field-error">No. nota wajib diisi.</span>}
          </label>
        </div>

        <div className="purchase-items-block">
          <div className="purchase-items-head">
            <b>Barang yang dibeli</b>
            <span className="purchase-muted">{form.items.length} barang</span>
          </div>
          <div className="purchase-items-scroll">
            <table className="purchase-items-table">
              <thead>
                <tr>
                  <th>Nama Barang</th>
                  <th style={{ width: '70px' }}>Satuan</th>
                  <th style={{ width: '96px' }}>Qty Beli</th>
                  <th style={{ width: '140px' }}>Harga Satuan Riil</th>
                  <th style={{ width: '132px', textAlign: 'right' }}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {form.items.map(it => {
                  const qty = Number(String(it.qty).replace(/[^\d.]/g, '')) || 0
                  const harga = Number(String(it.harga).replace(/[^\d]/g, '')) || 0
                  const subtotal = qty > 0 && harga > 0 ? Math.round(qty * harga) : null
                  const err = v.itemErrors[it.prItemId] || {}
                  return (
                    <tr key={it.prItemId} data-testid={`form-item-${it.prItemId}`}>
                      <td>
                        <b style={{ fontSize: '12.5px' }}>{it.itemName}</b>
                        <div className="purchase-muted" style={{ fontSize: '10.5px' }}>
                          {it.prNumber}{it.projectName ? ` · ${it.projectName}` : ''}
                          {it.qtyPr ? ` · PR: ${it.qtyPr} ${it.unit}` : ''}
                        </div>
                      </td>
                      <td>{it.unit || '—'}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={it.qty}
                          onChange={e => setItem(it.prItemId, 'qty', e.target.value)}
                          data-testid={`qty-${it.prItemId}`}
                          aria-label={`Qty beli ${it.itemName}`}
                        />
                        {touched && err.qty && <span className="purchase-field-error">{err.qty}</span>}
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={it.harga}
                          onChange={e => setItem(it.prItemId, 'harga', e.target.value.replace(/[^\d]/g, ''))}
                          data-testid={`harga-${it.prItemId}`}
                          aria-label={`Harga satuan ${it.itemName}`}
                        />
                        {it.harga ? (
                          <span className="purchase-price-preview">{rupiah(it.harga)}</span>
                        ) : (it.estimasi !== null || it.hargaAcuan !== null) ? (
                          <span className="purchase-price-ref">
                            Acuan: {rupiah(it.estimasi !== null ? it.estimasi : it.hargaAcuan)}
                          </span>
                        ) : null}
                        {touched && err.harga && <span className="purchase-field-error">{err.harga}</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {subtotal !== null ? rupiah(subtotal) : <span className="purchase-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="purchase-cost-grid">
          <label>
            Biaya Lain / Ongkir (Rp)
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={form.biayaLain}
              onChange={e => setField('biayaLain', e.target.value.replace(/[^\d]/g, ''))}
              data-testid="form-extra-cost"
            />
            <span className="purchase-field-hint">Masuk beban operasional WS, bukan harga material.</span>
          </label>
          <label>
            Diskon Toko (Rp)
            <input
              type="text"
              inputMode="numeric"
              placeholder="0"
              value={form.diskon}
              onChange={e => setField('diskon', e.target.value.replace(/[^\d]/g, ''))}
              data-testid="form-discount"
            />
            <span className="purchase-field-hint">Mengurangi total nota.</span>
          </label>
        </div>

        <div className="purchase-totals" data-testid="purchase-totals">
          <div className="purchase-totals-row">
            <span>Total Material</span>
            <b>{rupiah(totals.material)}</b>
          </div>
          <div className="purchase-totals-row">
            <span>Biaya Lain / Ongkir</span>
            <b>{totals.biayaLain ? rupiah(totals.biayaLain) : '—'}</b>
          </div>
          <div className="purchase-totals-row">
            <span>Diskon Toko</span>
            <b>{totals.diskon ? `− ${rupiah(totals.diskon)}` : '—'}</b>
          </div>
          <div className="purchase-totals-row purchase-totals-grand">
            <span>Total Nota Riil</span>
            <b data-testid="purchase-grand-total">{rupiah(totals.total)}</b>
          </div>
        </div>

        <div className="purchase-attach-grid">
          {[
            { kind: 'nota', label: 'Foto Nota / Struk Toko', field: 'buktiNota' },
            { kind: 'transfer', label: 'Bukti Transfer / Pembayaran', field: 'buktiTransfer' }
          ].map(({ kind, label, field }) => (
            <div className="purchase-attach-box" key={kind}>
              <div className="purchase-attach-title">{label} <span className="purchase-muted">(opsional)</span></div>
              {form[field] ? (
                <div className="purchase-attach-filled">
                  <img src={form[field]} alt={label} />
                  <div className="purchase-attach-meta">
                    <span>{sizeLabel(dataUrlByteSize(form[field]))} · siap disimpan bersama nota</span>
                    <button type="button" className="purchase-link-btn" onClick={() => clearFile(kind)}>Hapus</button>
                  </div>
                </div>
              ) : (
                <label className="purchase-attach-picker">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => pickFile(kind, e.target.files?.[0])}
                    data-testid={`file-${kind}`}
                  />
                  <span>{fileBusy === kind ? 'Membaca file…' : '📎 Pilih foto (maks 1 MB)'}</span>
                </label>
              )}
            </div>
          ))}
        </div>

        <label>
          Catatan Nota (opsional)
          <textarea
            rows={2}
            value={form.catatan}
            onChange={e => setField('catatan', e.target.value)}
            placeholder="Contoh: ongkir 25rb, barang diambil sendiri besok pagi"
            data-testid="form-note"
          />
        </label>

        {errorMsg && (
          <div className="purchase-form-error" data-testid="purchase-error">{errorMsg}</div>
        )}

        <div className="actions">
          <button type="button" className="outline" onClick={close} disabled={saving}>Batal</button>
          <button
            type="submit"
            className="btn-purchase-primary"
            disabled={!canSubmit}
            data-testid="purchase-submit"
          >
            {saving ? 'Menyimpan…' : '✓ Selesaikan Pembelian'}
          </button>
        </div>
      </form>
    </div>
  )
}
