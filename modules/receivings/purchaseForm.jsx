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
//
// ============================================================
// t_cde1b8ad (arahan DAT) — DIPADATKAN: toko · nota · tanggal · total · bukti
// ============================================================
// Urutan baca sekarang mengikuti urutan kerja admin di toko:
//   1) Toko · No. nota · Tanggal        (satu baris, 3 kolom)
//   2) Barang + qty + harga riil        (inti nota)
//   3) TOTAL NOTA RIIL                  (angka besar, langsung terlihat)
//   4) Bukti (foto nota / transfer)      (2 kotak sejajar)
//   5) Catatan                          (satu baris, opsional)
// Biaya lain/ongkir & diskon TIDAK dihapus — keduanya dilipat di bawah Total
// sebagai "Tambahan & potongan (opsional)" karena hanya dipakai bila nota
// memang punya ongkir/diskon. Rumus total TIDAK berubah:
//   total = material + biaya lain − diskon   (purchaseLogic.computeTotals)
// Semua data-testid dipertahankan supaya harness purchase-flow-test tetap
// menguji jalur yang sama.
// ============================================================
import React, { useMemo, useRef, useState } from 'react'
import { rupiah } from '../../lib/constants'
import { buildFormDraft, computeTotals, validatePurchaseForm } from './purchaseLogic'
import { newAllocationRow, splitSummary, normalizeAllocations, validateSplit, suggestSplit, isSplitRow } from './allocationLogic'
import { readAttachment, dataUrlByteSize, sizeLabel, ATTACHMENT_MAX_BYTES } from './attachments'
import { savePurchase } from './purchaseSave'
import { getPurchaseCapability, purchaseCapabilityMessage, PURCHASE_CAP } from './purchaseCapability'
import { dbErrorText } from '../handovers/dbErrorText'

// Kunci idempotensi per PERCOBAAN SIMPAN (bukan per klik).
//
// Kenapa harus di state dan bukan dibuat di dalam `savePurchaseWithClient`:
// retry (jaringan putus / admin klik lagi) HARUS memakai kunci yang sama,
// kalau tidak server melihatnya sebagai permintaan baru. Untuk nota tanpa
// nomor vendor akibatnya nyata: nota kedua + baris kedua + dokumen Handover
// kedua (defect R2 run 246). Kunci baru hanya dibuat setelah simpan BERHASIL
// atau form dibuka untuk nota lain.
function newClientRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch (e) { /* jatuh ke fallback */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function PurchaseForm({
  rows, vendorId, vendors = [], projects = [], materials = [], receivings = [], receivingItems = [], close, onDone, say
}) {
  const [form, setForm] = useState(() => buildFormDraft(rows, { vendorId }))
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [touched, setTouched] = useState(false)
  const [fileBusy, setFileBusy] = useState('')
  const [cap, setCap] = useState(null)
  const busyRef = useRef(false)
  // Kunci STABIL untuk seluruh umur form ini. Retry memakai nilai yang sama;
  // hanya diganti setelah simpan sukses (atau saat form dibuka ulang).
  const requestIdRef = useRef(newClientRequestId())

  // Probe kemampuan simpan (typed/alokasi/atomik). Read-only, sekali saat
  // form dibuka — dan diulang saat tab kembali fokus, karena migrasi bisa
  // dijalankan saat aplikasi sedang dipakai (pola yang sama dengan
  // receiptCapability/queue.jsx).
  React.useEffect(() => {
    let cancelled = false
    async function probe(force) {
      const res = await getPurchaseCapability({ force })
      if (!cancelled) setCap(res)
    }
    probe(true)
    const onFocus = () => probe(true)
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', onFocus)
    }
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', onFocus)
      }
    }
  }, [])

  const totals = useMemo(() => computeTotals(form), [form])
  const v = useMemo(() => validatePurchaseForm(form, { vendors }), [form, vendors])
  // PEMBAGIAN PROYEK hanya boleh disimpan bila DB benar-benar punya tempatnya.
  // Kalau skema alokasi belum aktif, membiarkan admin menekan Simpan berarti
  // pembagian itu HILANG tanpa jejak (fake persistence — defect acceptance-4
  // run 246). Jadi tombol dimatikan dengan sebab terbaca, bukan gagal senyap.
  const splitRows = useMemo(
    () => (form.items || []).filter(it => splitSummary(it.allocations).count > 0),
    [form]
  )
  const allocationReady = !!(cap && cap.state === PURCHASE_CAP.READY && cap.allocationPersisted)
  const splitBlocked = splitRows.length > 0 && !allocationReady
  // Material wajib untuk baris BELANJA LANGSUNG saat jalur atomik aktif:
  // kontrak v1 menolak baris tanpa `material_id` (`material_unresolved`).
  // Di jalur lama material tidak punya tempat, jadi tidak dipaksakan di sana
  // (jangan menuntut isian yang tidak akan tersimpan).
  const materialMissing = useMemo(
    () => (form.items || []).filter(it => it.isDirect && !it.materialId),
    [form]
  )
  const materialBlocked = allocationReady && materialMissing.length > 0
  const canSubmit = !saving && !fileBusy && v.valid && !splitBlocked && !materialBlocked
  const adaTambahan = !!(String(form.biayaLain || '').trim() || String(form.diskon || '').trim())

  const setField = (k, val) => setForm(prev => ({ ...prev, [k]: val }))
  const setItem = (key, k, val) => setForm(prev => ({
    ...prev,
    // key per baris: pr_item_id ATAU indeks formal (bahan tanpa request tidak
    // punya prItemKey dan TETAP bisa diedit — tidak dibuang).
    items: prev.items.map((it, i) => ((it.prItemId || it.formKey || `i${i}`) === key ? { ...it, [k]: val } : it))
  }))

  // ---- PEMBAGIAN SATU BARIS → BEBERAPA PROYEK (acceptance 4) --------------
  // Semua handler di bawah hanya mengubah STATE FORM. Tidak ada tulisan DB
  // sampai "Selesaikan Pembelian" ditekan (kontrak modul ini).
  const rowKeyOf = (it, i) => it.prItemId || it.formKey || `i${i}`

  function openSplit(rowKey) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => {
        if (rowKeyOf(it, i) !== rowKey) return it
        const rows = Array.isArray(it.allocations) && it.allocations.length
          ? it.allocations
          // Dua porsi kosong: admin mengisi proyek + qty. Porsi pertama
          // diisi proyek asal baris (bila ada) supaya tidak mengetik ulang.
          : [newAllocationRow({ projectId: it.projectId || '' }), newAllocationRow()]
        return { ...it, splitOpen: true, allocations: rows }
      })
    }))
  }

  function closeSplit(rowKey) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => (rowKeyOf(it, i) === rowKey
        // Kembali ke baris tunggal: alokasi dibuang, projectId asal dipakai.
        ? { ...it, splitOpen: false, allocations: null }
        : it))
    }))
  }

  function setAlloc(rowKey, idx, field, val) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => {
        if (rowKeyOf(it, i) !== rowKey) return it
        const rows = (it.allocations || []).map((a, j) => (j === idx ? { ...a, [field]: val } : a))
        return { ...it, allocations: rows }
      })
    }))
  }

  function addAlloc(rowKey) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => (rowKeyOf(it, i) === rowKey
        ? { ...it, allocations: [...(it.allocations || []), newAllocationRow()] }
        : it))
    }))
  }

  function removeAlloc(rowKey, idx) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => {
        if (rowKeyOf(it, i) !== rowKey) return it
        const rows = (it.allocations || []).filter((_, j) => j !== idx)
        return { ...it, allocations: rows.length ? rows : [newAllocationRow()] }
      })
    }))
  }

  // Usulan pembagian (BUKAN keputusan): qty dibagi rata antar proyek yang
  // sudah dipilih, sisa pembulatan di porsi terakhir supaya total PERSIS sama
  // dengan qty beli (kalau tidak, DB menolak `allocation_not_exact`).
  function suggestAlloc(rowKey) {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => {
        if (rowKeyOf(it, i) !== rowKey) return it
        const picked = (it.allocations || []).map(a => a.projectId).filter(Boolean)
        const rows = suggestSplit(it.qty, picked)
        if (rows.length < 2) return it
        return {
          ...it,
          allocations: rows.map((r, j) => ({ ...(it.allocations?.[j] || newAllocationRow()), projectId: r.projectId, qty: String(r.qty) }))
        }
      })
    }))
  }

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
    if (splitBlocked) {
      setErrorMsg('Pembagian proyek belum bisa disimpan: skema alokasi per baris belum aktif. Hapus pembagian (pakai satu proyek per baris) atau tunggu migrasi skema — pembagian tidak akan disimpan diam-diam.')
      return
    }
    if (materialBlocked) {
      setErrorMsg(`Pilih material untuk ${materialMissing.length} baris belanja langsung — tanpa identitas material, biaya tidak boleh disimpan.`)
      return
    }
    setErrorMsg('')
    busyRef.current = true
    setSaving(true)
    try {
      const res = await savePurchase({
        form,
        receivings,
        receivingItems,
        vendors,
        clientRequestId: requestIdRef.current,
        capability: cap
      })
      if (!res.ok) {
        // `already` = retry dari percobaan yang SAMA. Itu bukan kegagalan
        // yang perlu ditakuti admin — tapi juga bukan sukses baru. Jangan
        // menutup form seolah-olah ada data baru; beri tahu apa adanya.
        if (res.already) {
          setErrorMsg(res.error || 'Nota ini sudah tersimpan sebelumnya — tidak ada data yang ditulis ulang.')
          return
        }
        // D2 (review run 251): kode DB (`over_purchase_pr`, `bad_number`,
        // `allocation_not_exact`, `forbidden`) diterjemahkan ke kalimat.
        setErrorMsg(dbErrorText(res.error, { fallback: 'Gagal menyimpan nota pembelian.' }).text)
        if (res.partial) say?.(dbErrorText(res.error, { fallback: 'Gagal menyimpan nota pembelian.' }).text)
        return
      }
      // Simpan sukses: kunci ini sudah terpakai. Kunci baru untuk nota
      // berikutnya supaya nota lain tidak dianggap retry nota ini.
      requestIdRef.current = newClientRequestId()
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
        {/* ============================================================
            t_cde1b8ad — GAYA TER-SCOPE (styled-jsx, hanya untuk dialog ini)
            ============================================================
            styles/globals.css punya aturan MOBILE global yang memakai
            !important sehingga TIDAK bisa dilawan inline style:
              @media (max-width: 900px) {
                table { min-width: 820px }        ← tabel item jadi 820px
                th { padding: 12px 14px !important; white-space: nowrap !important }
                td { padding: 12px 14px !important }
              }
            Akibatnya dialog Proses Pembelian harus digeser ke samping di HP
            (820px di viewport 390px). File CSS bersama itu BUKAN milik card
            ini (lihat batas kepemilikan), jadi penawarnya ditaruh di sini
            sebagai style ter-scope milik komponen ini sendiri.
            Yang dinegasikan hanya untuk .purchase-items-table di dalam
            dialog ini — tidak ada modul lain yang terpengaruh.
            ============================================================ */}
        <style jsx>{`
          :global(.dialog-purchase .purchase-items-table) {
            min-width: 0 !important;
            width: 100% !important;
            table-layout: fixed !important;
          }
          :global(.dialog-purchase .purchase-items-table th),
          :global(.dialog-purchase .purchase-items-table td) {
            padding: 7px 6px !important;
            white-space: normal !important;
            overflow-wrap: anywhere;
            font-size: 11.5px !important;
          }
          :global(.dialog-purchase .purchase-items-table td.purchase-cell-num) {
            white-space: nowrap !important;
            text-align: right;
          }
          :global(.dialog-purchase .purchase-items-table input) {
            min-width: 0 !important;
            width: 100% !important;
          }
        `}</style>
        <div className="dialoghead">
          <h2>🧾 Proses Pembelian</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        {/* 0) KESIAPAN SIMPAN — jujur soal alokasi per proyek.
            Bila skema alokasi belum aktif, admin HARUS tahu SEBELUM menekan
            simpan: nota tetap tersimpan, tetapi pembagian proyek per barang
            tidak punya tempat di database. Menyembunyikan ini berarti admin
            mengira biaya sudah masuk ke proyek (defect acceptance-4 run 246). */}
        {cap && cap.state !== PURCHASE_CAP.READY && (
          <div
            className="purchase-cap-banner"
            data-testid="purchase-cap-banner"
            data-cap-state={cap.state}
            style={{
              margin: '0 0 10px',
              padding: '8px 10px',
              borderRadius: 6,
              fontSize: 11.5,
              lineHeight: 1.45,
              background: cap.state === PURCHASE_CAP.UNKNOWN ? '#f4f6f8' : '#fff8e1',
              border: `1px solid ${cap.state === PURCHASE_CAP.UNKNOWN ? '#d8dee4' : '#f0c36d'}`,
              color: '#5c4708'
            }}
          >
            <b>{cap.state === PURCHASE_CAP.UNKNOWN ? '⏳ Memeriksa kesiapan…' : '⚠️ Alokasi proyek belum tersimpan'}</b>
            <div style={{ marginTop: 3 }}>{purchaseCapabilityMessage(cap)}</div>
          </div>
        )}
        {cap && cap.state === PURCHASE_CAP.READY && (
          <div
            className="purchase-cap-banner ok"
            data-testid="purchase-cap-banner"
            data-cap-state={cap.state}
            style={{
              margin: '0 0 10px', padding: '8px 10px', borderRadius: 6, fontSize: 11.5,
              background: '#eef7ee', border: '1px solid #b7d9b7', color: '#1f4d1f'
            }}
          >
            ✓ Penyimpanan atomik aktif — alokasi proyek, material, dan harga riil per barang ikut tersimpan.
          </div>
        )}
        {splitBlocked && (
          <div
            className="purchase-split-blocked"
            data-testid="purchase-split-blocked"
            style={{
              margin: '0 0 10px', padding: '8px 10px', borderRadius: 6, fontSize: 11.5,
              background: '#fff4f4', border: '1px solid #e3b4b4', color: '#7a1f1f'
            }}
          >
            <b>⛔ Pembagian proyek belum bisa disimpan</b>
            <div style={{ marginTop: 3 }}>
              {splitRows.length} baris sudah dibagi ke beberapa proyek, tetapi skema alokasi per baris BELUM aktif di database.
              Tombol Simpan dimatikan supaya pembagian ini tidak hilang tanpa jejak. Pilih satu proyek per baris (batalkan pembagian),
              atau tunggu migrasi skema lalu periksa ulang.
            </div>
          </div>
        )}

        {/* 1) TOKO · NOTA · TANGGAL — identitas nota, satu baris */}
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
            No. Nota Toko
            <input
              type="text"
              placeholder="Contoh: TB-88912 (kosong = nota tanpa nomor)"
              value={form.invoiceNo}
              onChange={e => setField('invoiceNo', e.target.value)}
              data-testid="form-invoice"
            />
            <span className="purchase-field-hint" style={{ display: 'block' }}>
              Nota offline tanpa nomor boleh dikosongkan — sistem memakai referensi internal, bukan mengarang nomor toko.
            </span>
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
        </div>

        {/* 2) BARANG — qty & harga riil per item */}
        <div className="purchase-items-block">
          <div className="purchase-items-head">
            <b>Barang yang dibeli</b>
            <span className="purchase-muted">{form.items.length} barang</span>
          </div>
          <div className="purchase-items-scroll">
            {/* t_cde1b8ad: 5 kolom → 4 kolom. Kolom "Satuan" terpisah dihapus;
                satuannya menempel pada input Qty (mis. "Lembar") supaya tetap
                terbaca tanpa memakan kolom — tabel jadi cukup sempit untuk
                layar HP tanpa harus digeser ke samping. */}
            <table className="purchase-items-table" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  {/* t_cde1b8ad: judul kolom dibungkus <div> ber-white-space
                      normal. Aturan bersama `th { white-space: nowrap
                      !important }` membuat judul "Harga Satuan Riil" jadi satu
                      baris 149px dan menahan tabel di 446px; div anak boleh
                      wrap sendiri sehingga tabel bisa mengecil sampai pas di
                      layar HP tanpa mengubah styles/globals.css. */}
                  <th style={{ padding: '7px 6px' }}>
                    <div style={{ whiteSpace: 'normal' }}>Nama Barang</div>
                  </th>
                  <th style={{ width: '96px', padding: '7px 6px' }}>
                    <div style={{ whiteSpace: 'normal' }}>Qty Beli</div>
                  </th>
                  <th style={{ width: '92px', padding: '7px 5px' }}>
                    <div style={{ whiteSpace: 'normal' }}>Harga Satuan</div>
                  </th>
                  <th style={{ width: '84px', textAlign: 'right', padding: '7px 5px' }}>
                    <div style={{ whiteSpace: 'normal' }}>Subtotal</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, idx) => {
                  const rowKey = it.prItemId || it.formKey || `i${idx}`
                  const qty = Number(String(it.qty).replace(/[^\d.]/g, '')) || 0
                  const harga = Number(String(it.harga).replace(/[^\d]/g, '')) || 0
                  const subtotal = qty > 0 && harga > 0 ? Math.round(qty * harga) : null
                  const err = (it.prItemId && v.itemErrors[it.prItemId]) || {}
                  return (
                    <React.Fragment key={rowKey}>
                    <tr data-testid={`form-item-${rowKey}`}>
                      {/* class "cell-wrap" WAJIB di sini: aturan bersama
                          `th, td { white-space: nowrap !important }` di
                          styles/globals.css TIDAK bisa dilawan dengan inline
                          style (perilaku CSS: !important > inline). Tanpa
                          class ini, sel nama jadi satu baris tak terpotong
                          (≈419px) dan menyeret lebar tabel ke 820px di layar
                          HP — dialog jadi harus digeser ke samping.
                          cell-wrap sudah didefinisikan global
                          (white-space:normal !important; overflow-wrap:anywhere),
                          jadi tidak ada file CSS bersama yang perlu diubah. */}
                      <td className="cell-wrap">
                        {it.isDirect ? (
                          <input
                            type="text"
                            placeholder="Nama barang di nota toko…"
                            value={it.itemName}
                            onChange={e => setItem(rowKey, 'itemName', e.target.value)}
                            data-testid={`nama-${rowKey}`}
                            aria-label="Nama barang"
                            style={{ width: '100%', minWidth: 0, fontWeight: 600 }}
                          />
                        ) : (
                          <b style={{ fontSize: '12.5px' }}>{it.itemName}</b>
                        )}
                        <div className="purchase-muted" style={{ fontSize: '10.5px' }}>
                          {it.isDirect ? 'Belanja langsung (tanpa request)' : `${it.prNumber}${it.projectName ? ` · ${it.projectName}` : ''}${it.qtyPr ? ` · PR: ${it.qtyPr} ${it.unit}` : ''}`}
                        </div>
                        {/* IDENTITAS MATERIAL untuk belanja langsung (acceptance 4).
                            Baris dari PR mewarisi material_id exact dari pr_items,
                            jadi pemilih ini hanya muncul bila baris belum punya
                            material — tanpa itu DB menolak `material_unresolved`
                            dan admin tidak tahu harus apa. */}
                        {it.isDirect && (
                          <select
                            value={it.materialId || ''}
                            onChange={e => {
                              const mat = (materials || []).find(m => String(m.id) === String(e.target.value))
                              setForm(prev => ({
                                ...prev,
                                items: prev.items.map((x, i) => (rowKeyOf(x, i) === rowKey
                                  ? {
                                    ...x,
                                    materialId: e.target.value || null,
                                    // Satuan mengikuti master hanya bila admin belum mengisinya.
                                    unit: x.unit || mat?.satuan || mat?.unit || ''
                                  }
                                  : x))
                              }))
                            }}
                            data-testid={`material-${rowKey}`}
                            aria-label={`Material untuk ${it.itemName || 'barang'}`}
                            style={{ marginTop: 3, width: '100%', minWidth: 0, fontSize: 11 }}
                          >
                            <option value="">-- Pilih material --</option>
                            {(materials || []).map(m => (
                              <option key={m.id} value={m.id}>
                                {m.kode ? `${m.kode} · ${m.name}` : m.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {it.isDirect && !it.materialId && touched && (
                          <span className="purchase-field-error">Material wajib dipilih untuk belanja langsung.</span>
                        )}
                      </td>
                      <td style={{ padding: '7px 6px' }}>
                        {/* Satuan menempel di bawah input qty (bukan kolom
                            sendiri) — menjaga tabel cukup sempit di HP. */}
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={it.qty}
                          onChange={e => setItem(rowKey, 'qty', e.target.value)}
                          data-testid={`qty-${rowKey}`}
                          aria-label={`Qty beli ${it.itemName}`}
                          style={{ minWidth: 0, width: '100%' }}
                        />
                        <span className="purchase-muted" style={{ display: 'block', fontSize: '10.5px', marginTop: '2px' }}>
                          {it.unit || '—'}
                        </span>
                        {/* Tombol pembagian ADA DI SETIAP BARIS (bukan hanya
                            belanja langsung): acceptance 4 menuntut satu baris
                            bisa dibagi ke beberapa proyek, termasuk baris dari
                            PR. Saat pembagian aktif, pilihan proyek tunggal
                            disembunyikan karena kontrak DB = XOR. */}
                        {!it.splitOpen && (
                          <button
                            type="button"
                            className="purchase-link-btn"
                            onClick={() => openSplit(rowKey)}
                            data-testid={`split-open-${rowKey}`}
                            title="Bagi qty baris ini ke beberapa proyek"
                            style={{ fontSize: '10.5px', marginTop: 2, padding: 0 }}
                          >
                            ⇄ Bagi ke proyek
                          </button>
                        )}
                        {it.splitOpen && (
                          <span
                            className="purchase-muted"
                            data-testid={`split-active-${rowKey}`}
                            style={{ display: 'block', fontSize: '10.5px', marginTop: 2, color: '#1f4d1f' }}
                          >
                            dibagi {splitSummary(it.allocations).count} proyek
                          </span>
                        )}
                        {it.isDirect && !it.splitOpen && (
                          <select
                            value={it.projectId || ''}
                            onChange={e => setItem(rowKey, 'projectId', e.target.value)}
                            data-testid={`proj-${rowKey}`}
                            aria-label={`Proyek untuk ${it.itemName || 'barang'}`}
                            style={{ marginTop: '3px', width: '100%', minWidth: 0 }}
                          >
                            <option value="">-- Tanpa proyek --</option>
                            {projects.map(p => (
                              <option key={p.id} value={p.id}>{p.kode ? `[${p.kode}] ${p.name}` : p.name}</option>
                            ))}
                          </select>
                        )}
                        {touched && err.qty && <span className="purchase-field-error">{err.qty}</span>}
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={it.harga}
                          onChange={e => setItem(rowKey, 'harga', e.target.value.replace(/[^\d]/g, ''))}
                          data-testid={`harga-${rowKey}`}
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
                    {/* ---- PEMBAGIAN SATU BARIS → BEBERAPA PROYEK ----------
                        Acceptance 4: pembagian harus bisa DIISI admin, bukan
                        hanya diterima payload-nya. Baris ini muncul hanya saat
                        admin menekan "Bagi ke beberapa proyek", dan semua
                        isiannya tetap di state form sampai Simpan ditekan. */}
                    {it.splitOpen && (
                      <tr data-testid={`split-panel-${rowKey}`}>
                        <td colSpan={4} style={{ background: '#f7f9fb', padding: '8px 8px 10px' }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 5 }}>
                            Bagi “{it.itemName || 'barang'}” ke beberapa proyek
                            <span className="purchase-muted" style={{ fontWeight: 400 }}>
                              {' '}— qty beli {it.qty || '0'} {it.unit || ''}
                            </span>
                          </div>
                          {(it.allocations || []).map((a, ai) => (
                            <div key={a.key || ai} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 4 }}>
                              <select
                                value={a.projectId || ''}
                                onChange={e => setAlloc(rowKey, ai, 'projectId', e.target.value)}
                                data-testid={`split-proj-${rowKey}-${ai}`}
                                aria-label={`Proyek porsi ${ai + 1}`}
                                style={{ flex: '1 1 auto', minWidth: 0 }}
                              >
                                <option value="">-- Pilih proyek --</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.kode ? `[${p.kode}] ${p.name}` : p.name}</option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                value={a.qty}
                                onChange={e => setAlloc(rowKey, ai, 'qty', e.target.value)}
                                data-testid={`split-qty-${rowKey}-${ai}`}
                                aria-label={`Qty porsi ${ai + 1}`}
                                style={{ width: 72, minWidth: 0 }}
                              />
                              <button
                                type="button"
                                className="icon"
                                onClick={() => removeAlloc(rowKey, ai)}
                                data-testid={`split-del-${rowKey}-${ai}`}
                                aria-label={`Hapus porsi ${ai + 1}`}
                                title="Hapus porsi"
                              >×</button>
                            </div>
                          ))}
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                            <button type="button" className="outline" onClick={() => addAlloc(rowKey)} data-testid={`split-add-${rowKey}`}>
                              + Porsi proyek
                            </button>
                            <button type="button" className="outline" onClick={() => suggestAlloc(rowKey)} data-testid={`split-suggest-${rowKey}`}>
                              Isi otomatis (bagi rata)
                            </button>
                            <button type="button" className="outline" onClick={() => closeSplit(rowKey)} data-testid={`split-cancel-${rowKey}`}>
                              Batalkan pembagian
                            </button>
                          </div>
                          {(() => {
                            const sm = splitSummary(it.allocations)
                            const qtyNum = Number(String(it.qty).replace(/[^\d.]/g, '')) || 0
                            const beda = Math.round((qtyNum - sm.total) * 1000) / 1000
                            const ok = sm.distinct >= 2 && Math.abs(beda) <= 0.001
                            return (
                              <div
                                data-testid={`split-summary-${rowKey}`}
                                data-split-ok={ok ? 'yes' : 'no'}
                                data-split-distinct={sm.distinct}
                                style={{ marginTop: 6, fontSize: 11, color: ok ? '#1f4d1f' : '#8a5a00' }}
                              >
                                {sm.count} porsi · {sm.distinct} proyek berbeda · total dibagikan <b>{sm.total}</b> dari qty <b>{qtyNum}</b>
                                {ok
                                  ? ' — ✓ pas'
                                  : sm.distinct < 2
                                    ? ' — butuh minimal 2 proyek BERBEDA'
                                    : beda > 0
                                      ? ` — sisa ${beda} belum dibagikan`
                                      : ` — kelebihan ${Math.abs(beda)}`}
                              </div>
                            )
                          })()}
                          {touched && err.split && (
                            <div className="purchase-field-error" data-testid={`split-error-${rowKey}`}>{err.split}</div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3) TOTAL NOTA RIIL — angka utama, selalu terlihat.
               Tambahan & potongan dilipat di bawahnya (tidak dihapus). */}
        <div className="purchase-totals" data-testid="purchase-totals">
          <div
            className="purchase-totals-row purchase-totals-grand"
            style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}
          >
            <span>Total Nota Riil</span>
            <b data-testid="purchase-grand-total">{rupiah(totals.total)}</b>
          </div>
          <div className="purchase-totals-row">
            <span>Material</span>
            <b>{rupiah(totals.material)}</b>
          </div>
          {(adaTambahan || totals.biayaLain > 0) && (
            <div className="purchase-totals-row">
              <span>Biaya Lain / Ongkir</span>
              <b>{totals.biayaLain ? rupiah(totals.biayaLain) : '—'}</b>
            </div>
          )}
          {(adaTambahan || totals.diskon > 0) && (
            <div className="purchase-totals-row">
              <span>Diskon toko</span>
              <b>{totals.diskon ? `− ${rupiah(totals.diskon)}` : '—'}</b>
            </div>
          )}
          <details
            className="purchase-costs-fold"
            open={adaTambahan}
            style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '7px', marginTop: '2px' }}
          >
            <summary
              style={{
                cursor: 'pointer', listStyle: 'revert', fontSize: '11.5px',
                fontWeight: 700, color: 'var(--text-muted)'
              }}
            >
              ＋ Tambahan &amp; potongan (ongkir / diskon — opsional)
            </summary>
            <div className="purchase-cost-grid" style={{ marginTop: '8px' }}>
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
          </details>
        </div>

        {/* 4) BUKTI — dua kotak sejajar (opsional) */}
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

        {/* 5) CATATAN — satu baris, opsional */}
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
