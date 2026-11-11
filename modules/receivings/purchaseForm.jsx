import React, { useMemo, useRef, useState } from 'react'
import { rupiah } from '../../lib/constants'
import { buildFormDraft, computeItem, computeTotals, validatePurchaseForm } from './purchaseLogic'
import { readAttachment, dataUrlByteSize, sizeLabel, ATTACHMENT_MAX_BYTES } from './attachments'
import { savePurchase } from './purchaseSave'

export default function PurchaseForm({
  rows = [], vendorId, vendors = [], projects = [], materials = [],
  receivings = [], receivingItems = [], close, onDone, say
}) {
  const directMode = rows.length === 0 || rows.every(row => row.isDirect)
  const [form, setForm] = useState(() => {
    const draft = buildFormDraft(rows, { vendorId })
    // The legacy launcher supplies an empty direct placeholder, not a bought item.
    return { ...draft, items: draft.items.filter(item => !item.isDirect || String(item.itemName || '').trim()) }
  })
  const [projectId, setProjectId] = useState(() => rows[0]?.projectId || '')
  const [materialQuery, setMaterialQuery] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [touched, setTouched] = useState(false)
  const [fileBusy, setFileBusy] = useState('')
  const busyRef = useRef(false)
  const fileBusyRef = useRef(false)
  const nextLine = useRef(0)
  const qtyRefs = useRef({})
  const totals = useMemo(() => computeTotals(form), [form])
  const validation = useMemo(() => validatePurchaseForm(form, { vendors }), [form, vendors])
  const locked = saving || !!fileBusy
  const totalIncomplete = !form.items.length || form.items.some(item => computeItem(item).subtotal === null)
  const adaTambahan = !!(String(form.biayaLain || '').trim() || String(form.diskon || '').trim())
  const matchingMaterials = materials.filter(material => [material.kode, material.name, material.satuan]
    .some(value => String(value || '').toLocaleLowerCase('id').includes(materialQuery.trim().toLocaleLowerCase('id'))))
  const rowKey = (item, index) => item.prItemId || item.formKey || `i${index}`
  const projectLabel = id => {
    const project = projects.find(p => p.id === id)
    return project ? `${project.kode ? `[${project.kode}] ` : ''}${project.name}` : 'Proyek belum tersedia'
  }
  const projectIds = [...new Set(form.items.map(item => item.projectId || ''))]
  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const setItem = (key, field, value) => setForm(prev => ({
    ...prev, items: prev.items.map((item, index) => rowKey(item, index) === key ? { ...item, [field]: value } : item)
  }))

  function changeProject(id) {
    setProjectId(id)
    setForm(prev => ({ ...prev, items: prev.items.map(item => item.isDirect
      ? { ...item, projectId: id || null, projectName: id ? projectLabel(id) : 'Stok umum' } : item) }))
  }

  function addMaterial() {
    const material = materials.find(item => item.id === materialId)
    if (!material || locked) return
    const formKey = `direct-material-${++nextLine.current}`
    setForm(prev => ({ ...prev, items: [...prev.items, {
      formKey, materialId: material.id, kode: material.kode || '', itemName: material.name,
      unit: material.satuan || '', qty: '1', harga: '', isDirect: true,
      prItemId: null, prId: null, prNumber: '', projectId: projectId || null,
      projectName: projectId ? projectLabel(projectId) : 'Stok umum', estimasi: null, hargaAcuan: null
    }] }))
    setMaterialId('')
    setMaterialQuery('')
  }

  function removeItem(key) {
    if (locked) return
    setForm(prev => ({ ...prev, items: prev.items.filter((item, index) => rowKey(item, index) !== key) }))
  }

  async function pickFile(kind, file) {
    if (!file || fileBusyRef.current || busyRef.current) return
    fileBusyRef.current = true
    setFileBusy(kind)
    setErrorMsg('')
    try {
      const result = await readAttachment(file, { maxBytes: ATTACHMENT_MAX_BYTES })
      if (!result.ok) { setErrorMsg(result.error); return }
      setField(kind === 'nota' ? 'buktiNota' : 'buktiTransfer', result.dataUrl)
      say?.(`${kind === 'nota' ? 'Foto nota' : 'Bukti transfer'} siap dilampirkan (${sizeLabel(result.size)}).`)
    } catch {
      setErrorMsg('Lampiran gagal dibaca. Pilih ulang file gambar.')
    } finally {
      fileBusyRef.current = false
      setFileBusy('')
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (busyRef.current || saving || fileBusyRef.current) return
    setTouched(true)
    if (!validation.valid) {
      setErrorMsg(validation.errors[0] || Object.values(validation.itemErrors).flatMap(value => Object.values(value))[0] || 'Periksa kembali isian yang ditandai.')
      return
    }
    setErrorMsg('')
    busyRef.current = true
    setSaving(true)
    try {
      const result = await savePurchase({ form, receivings, receivingItems, vendors })
      if (!result.ok) {
        setErrorMsg(result.error || 'Gagal menyimpan nota pembelian.')
        if (result.partial) say?.(result.error)
        return
      }
      onDone?.(result)
    } catch (error) {
      setErrorMsg(`Terjadi kesalahan saat menyimpan: ${error.message}`)
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="modal">
      <form className="dialog dialog-purchase" onSubmit={submit} data-testid="purchase-form" role="dialog" aria-modal="true" aria-labelledby="purchase-form-title">
        <style jsx>{`
          :global(.dialog-purchase .purchase-items-scroll) { overflow-x: auto; max-width: 100%; }
          :global(.dialog-purchase .purchase-items-table) { min-width: 760px !important; width: 100%; table-layout: fixed; }
          :global(.dialog-purchase .purchase-items-table th),
          :global(.dialog-purchase .purchase-items-table td) { padding: 8px !important; white-space: normal !important; overflow-wrap: anywhere; }
          :global(.dialog-purchase .purchase-items-table input) { min-width: 0; width: 100%; }
          :global(.dialog-purchase .purchase-items-table th:nth-child(1)) { width: 32%; }
          :global(.dialog-purchase .purchase-items-table th:nth-child(2)) { width: 13%; }
          :global(.dialog-purchase .purchase-items-table th:nth-child(3)) { width: 21%; }
          :global(.dialog-purchase .purchase-items-table th:nth-child(4)) { width: 18%; }
          :global(.dialog-purchase .purchase-items-table th:nth-child(5)) { width: 16%; }
          .purchase-edit-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
          .purchase-project-header, .purchase-material-picker { display: grid; gap: 8px; margin-bottom: 16px; }
          .purchase-project-header { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .purchase-material-picker { grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto; align-items: end; }
          .purchase-line-actions { display: flex; gap: 8px; flex-wrap: wrap; }
          .purchase-table-hint { margin: 8px 0; }
          @media (max-width: 600px) {
            .purchase-project-header, .purchase-material-picker { grid-template-columns: 1fr; }
          }
        `}</style>
        <div className="dialoghead">
          <h2 id="purchase-form-title">Proses Pembelian</h2>
          <button type="button" className="icon" onClick={close} disabled={locked} aria-label="Tutup">×</button>
        </div>
        <fieldset className="purchase-edit-fields" disabled={locked}>
          <div className="purchase-project-header">
            <label>Kode / Nama Proyek
              {directMode ? (
                <select value={projectId} onChange={event => changeProject(event.target.value)} data-testid="form-project">
                  <option value="">Stok umum (tanpa proyek)</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{projectLabel(project.id)}</option>)}
                </select>
              ) : (
                <input readOnly value={projectIds.map(id => id ? projectLabel(id) : 'Proyek belum tersedia').join(' · ')} data-testid="form-project-identity" />
              )}
              {!directMode && <span className="purchase-field-hint">Proyek mengikuti barang PR; identitas PR tidak diubah.</span>}
            </label>
            <label>Sumber Pembelian
              <input readOnly value={directMode ? 'Belanja langsung tanpa PR' : [...new Set(form.items.map(item => item.prNumber).filter(Boolean))].join(', ') || 'Dari PR'} />
            </label>
          </div>
          <div className="purchase-form-grid">
            <label>Supplier / Toko
              <select value={form.vendorId} onChange={event => setField('vendorId', event.target.value)} data-testid="form-vendor">
                <option value="">-- Pilih toko --</option>
                {vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
              {touched && !form.vendorId && <span className="purchase-field-error">Toko wajib dipilih.</span>}
            </label>
            <label>Nomor Invoice / Nota Toko
              <input type="text" placeholder="Nomor pada nota toko" value={form.invoiceNo} onChange={event => setField('invoiceNo', event.target.value)} data-testid="form-invoice" />
              <span className="purchase-field-hint">Nota tanpa nomor boleh dikosongkan; sistem memakai referensi internal, bukan nomor toko.</span>
            </label>
            <label>Tanggal Belanja
              <input type="date" value={form.tanggal} onChange={event => setField('tanggal', event.target.value)} data-testid="form-date" />
            </label>
          </div>
          {directMode && (
            <div className="purchase-material-picker">
              <label>Cari Barang Master
                <input type="search" value={materialQuery} onChange={event => { setMaterialQuery(event.target.value); setMaterialId('') }} placeholder="Nama, kode, atau satuan" data-testid="form-material-search" />
              </label>
              <label>Barang Master
                <select value={materialId} onChange={event => setMaterialId(event.target.value)} data-testid="form-material-picker">
                  <option value="">{matchingMaterials.length ? '-- Pilih barang --' : 'Barang tidak ditemukan'}</option>
                  {matchingMaterials.map(material => <option key={material.id} value={material.id}>{material.kode ? `[${material.kode}] ` : ''}{material.name} ({material.satuan || '—'})</option>)}
                </select>
              </label>
              <button type="button" className="outline" onClick={addMaterial} disabled={!materialId || locked} data-testid="form-add-material">Tambah Barang</button>
              {!materials.length && <span className="purchase-field-hint">Master barang belum tersedia. Muat master barang sebelum menambah pembelian.</span>}
            </div>
          )}
          <div className="purchase-items-block">
            <div className="purchase-items-head"><b>Barang yang dibeli</b><span className="purchase-muted">{form.items.length} barang</span></div>
            <p className="purchase-field-hint purchase-table-hint" id="purchase-table-hint">Isi qty dan harga beli aktual dari nota. Estimasi tidak dipakai otomatis. Geser tabel untuk melihat semua kolom.</p>
            <div className="purchase-items-scroll" role="region" aria-label="Barang pembelian" aria-describedby="purchase-table-hint" tabIndex={0}>
              <table className="purchase-items-table">
                <thead><tr><th scope="col">Barang</th><th scope="col">Qty</th><th scope="col">Harga Beli Aktual</th><th scope="col">Total</th><th scope="col">Aksi</th></tr></thead>
                <tbody>
                  {!form.items.length && <tr><td colSpan={5}>Belum ada barang. {directMode ? 'Pilih barang master lalu klik Tambah Barang.' : 'Tutup form dan pilih barang PR yang akan dibeli.'}</td></tr>}
                  {form.items.map((item, index) => {
                    const key = rowKey(item, index)
                    const { subtotal, validQty, validHarga } = computeItem(item)
                    return (
                      <tr key={key} data-testid={`form-item-${key}`}>
                        <td className="cell-wrap"><b>{item.itemName}</b>
                          <div className="purchase-muted">{item.isDirect ? (item.projectId ? projectLabel(item.projectId) : 'Stok umum') : `${item.prNumber || 'PR'} · ${item.projectName || projectLabel(item.projectId)}`}</div>
                        </td>
                        <td>
                          <input ref={node => { qtyRefs.current[key] = node }} type="number" min="0" step="any" inputMode="decimal" value={item.qty} onChange={event => setItem(key, 'qty', event.target.value)} data-testid={`qty-${key}`} aria-label={`Qty beli ${item.itemName}`} aria-invalid={touched && !validQty} />
                          <span className="purchase-muted">{item.unit || '—'}</span>
                          {touched && !validQty && <span className="purchase-field-error">Qty beli harus lebih dari 0.</span>}
                        </td>
                        <td>
                          <input type="text" inputMode="numeric" placeholder="Isi dari nota" value={item.harga} onChange={event => setItem(key, 'harga', event.target.value.replace(/[^\d]/g, ''))} data-testid={`harga-${key}`} aria-label={`Harga beli aktual ${item.itemName}`} aria-invalid={touched && !validHarga} />
                          {item.harga ? <span className="purchase-price-preview">{rupiah(item.harga)}</span> : item.estimasi != null || item.hargaAcuan != null ? <span className="purchase-price-ref">Estimasi / acuan: {rupiah(item.estimasi ?? item.hargaAcuan)} (bukan harga beli)</span> : null}
                          {touched && !validHarga && <span className="purchase-field-error">Isi harga aktual lebih dari 0.</span>}
                        </td>
                        <td className="purchase-cell-num">{subtotal !== null ? rupiah(subtotal) : '—'}</td>
                        <td><div className="purchase-line-actions">
                          <button type="button" className="outline" onClick={() => qtyRefs.current[key]?.focus()} aria-label={`Edit ${item.itemName}`}>Edit</button>
                          <button type="button" className="outline" onClick={() => removeItem(key)} aria-label={`Hapus ${item.itemName}`} data-testid={`remove-${key}`}>Hapus</button>
                        </div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="purchase-totals" data-testid="purchase-totals">
            <div className="purchase-totals-row purchase-totals-grand"><span>{totalIncomplete ? 'Total sementara (barang belum lengkap)' : 'Total Nota Riil'}</span><b data-testid="purchase-grand-total">{rupiah(totals.total)}</b></div>
            <div className="purchase-totals-row"><span>Material</span><b>{rupiah(totals.material)}</b></div>
            {adaTambahan && <>
              <div className="purchase-totals-row"><span>Biaya Lain / Ongkir</span><b>{rupiah(totals.biayaLain)}</b></div>
              <div className="purchase-totals-row"><span>Diskon toko</span><b>− {rupiah(totals.diskon)}</b></div>
            </>}
            <details className="purchase-costs-fold" open={adaTambahan}>
              <summary>Tambahan &amp; potongan (opsional)</summary>
              <div className="purchase-cost-grid">
                <label>Biaya Lain / Ongkir (Rp)
                  <input type="text" inputMode="numeric" placeholder="0" value={form.biayaLain} onChange={event => setField('biayaLain', event.target.value.replace(/[^\d]/g, ''))} data-testid="form-extra-cost" />
                  <span className="purchase-field-hint">Masuk beban operasional WS, bukan harga material.</span>
                </label>
                <label>Diskon Toko (Rp)
                  <input type="text" inputMode="numeric" placeholder="0" value={form.diskon} onChange={event => setField('diskon', event.target.value.replace(/[^\d]/g, ''))} data-testid="form-discount" />
                  <span className="purchase-field-hint">Mengurangi total nota.</span>
                </label>
              </div>
            </details>
          </div>
          <div className="purchase-attach-grid">
            {[
              { kind: 'nota', label: 'Foto Nota / Struk', field: 'buktiNota' },
              { kind: 'transfer', label: 'Bukti Transfer', field: 'buktiTransfer' }
            ].map(({ kind, label, field }) => (
              <div className="purchase-attach-box" key={kind}>
                <div className="purchase-attach-title">{label} <span className="purchase-muted">(opsional)</span></div>
                {form[field] ? (
                  <div className="purchase-attach-filled">
                    <img src={form[field]} alt={label} />
                    <div className="purchase-attach-meta">
                      <span>{sizeLabel(dataUrlByteSize(form[field]))} · siap disimpan bersama nota</span>
                      <button type="button" className="purchase-link-btn" onClick={() => setField(field, '')}>Hapus</button>
                    </div>
                  </div>
                ) : (
                  <label className="purchase-attach-picker">
                    <input type="file" accept="image/*" aria-label={label} onChange={event => pickFile(kind, event.target.files?.[0])} data-testid={`file-${kind}`} />
                    <span>{fileBusy === kind ? 'Membaca file…' : 'Pilih foto (maks 1 MB)'}</span>
                  </label>
                )}
              </div>
            ))}
          </div>
          <label>Catatan Nota (opsional)
            <textarea rows={2} value={form.catatan} onChange={event => setField('catatan', event.target.value)} placeholder="Catatan untuk nota ini" data-testid="form-note" />
          </label>
        </fieldset>
        {errorMsg && <div className="purchase-form-error" role="alert" data-testid="purchase-error">{errorMsg}</div>}
        <div className="actions">
          <button type="button" className="outline" onClick={close} disabled={locked}>Batal</button>
          <button type="submit" className="btn-purchase-primary" disabled={locked} data-testid="purchase-submit">{saving ? 'Menyimpan…' : 'Selesaikan Pembelian'}</button>
        </div>
      </form>
    </div>
  )
}
