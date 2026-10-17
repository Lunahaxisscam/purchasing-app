// ============================================================
// modules/receivings/page.jsx — HALAMAN MODUL PURCHASE (belanja admin)
// ============================================================
// Arahan DAT (rombak besar modul Purchase — tahap belanja admin):
//   Tanggung jawab Purchase MURNI mencatat nota toko & uang keluar. Berhenti
//   sampai barang dibeli; distribusi fisik barang pindah ke modul Handover.
//
// DUA TAB:
//   1. "Siap Dibeli"        — barang APPROVED dari modul Approval, bisa
//                             difilter per Toko/Vendor atau per Proyek, bisa
//                             dicentang beberapa untuk dibeli sekaligus ke
//                             toko yang sama.
//   2. "Riwayat Pembelian"  — nota belanja yang sudah selesai, lengkap dengan
//                             total rupiah & lampiran bukti.
//
// TIDAK ADA lagi tombol gudang / tukang / retur / refund di halaman ini —
// itu urusan Handover. Halaman ini hanya: pilih barang -> isi nota -> selesai.
//
// ============================================================
// t_cde1b8ad (arahan DAT — "Purchase dipadatkan") — RINGKASAN PERUBAHAN
// ============================================================
// Nota = 6 hal saja: TOKO/VENDOR · NO. NOTA · TANGGAL · TOTAL · BUKTI ·
// CATATAN. Karena itu:
//   - Tabel "Siap Dibeli" 8 kolom -> 5 kolom (+checkbox). Satuan & kode
//     digabung ke sel Barang; No. PR digabung ke sel Proyek. Tidak ada
//     informasi yang hilang — hanya tidak lagi memakan kolom sendiri.
//   - Tabel "Riwayat" 9 kolom -> 6 kolom. Kolom Material & Biaya Lain tidak
//     dibuang: keduanya turun jadi baris kecil di bawah Total Nota (rincian
//     penuh tetap ada di tombol "▼ Rincian").
//   - Tombol "Proses Pembelian" di footer hanya muncul saat ADA barang
//     dicentang — sebelumnya tombol primer yang sama tampil dua kali
//     (toolbar + footer) walau tidak ada pilihan.
//   - Status nota / kendala (Retur/Refund/Rusak) TIDAK ditampilkan di UI
//     utama. Nilai `receivings.status` & `receivings.kendala` di DB TIDAK
//     disentuh modul ini (tidak pernah ditulis, tidak pernah dihapus) —
//     penyaringan "nota bermasalah" tetap ada di modul Handover.
//
// Semua angka rupiah dibulatkan sebelum ditampilkan (Math.round) supaya tidak
// ada desimal liar; harga satuan riil disimpan per barang dan menjadi acuan
// harga historis (modules/materials/acuan.js membaca [Harga: n]).
// ============================================================
import React, { useMemo, useState } from 'react'
import { format, rupiah } from '../../lib/constants'
import { parseItemPrice } from '../../lib/purchaseNote'
import {
  TAB_READY, TAB_HISTORY,
  buildReadyRows, filterReadyRows, readyFilterOptions,
  buildHistoryRows, historySummary, groupByVendor
} from './purchaseLogic'
import PurchaseForm from './purchaseForm'

// Buka lampiran (data-URL gambar) di jendela baru; fallback unduh.
function openAttachment(src, title) {
  const s = String(src || '')
  if (!s) return
  try {
    if (/^https?:\/\//i.test(s)) {
      const w = window.open(s, '_blank', 'noopener')
      if (w) return
    } else {
      const w = window.open('', '_blank')
      if (w && w.document) {
        w.document.title = title || 'Lampiran bukti'
        w.document.body.style.cssText = 'margin:16px;background:#0f172a;text-align:center;'
        const img = w.document.createElement('img')
        img.src = s
        img.alt = title || 'Lampiran bukti'
        img.style.cssText = 'max-width:100%;height:auto;border-radius:10px;'
        w.document.body.appendChild(img)
        return
      }
    }
  } catch (e) { /* lanjut ke fallback */ }
  try {
    const a = document.createElement('a')
    a.href = s
    a.download = 'bukti-belanja.jpg'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } catch (e) { /* tidak ada yang bisa dilakukan */ }
}

const BUKTI_LABEL = { nota: '📷 Foto Nota', transfer: '💳 Bukti Transfer' }

// Baris kecil ringkasan biaya di bawah Total Nota (Material · Biaya lain ·
// Diskon). Nilai kosong TIDAK ditampilkan sebagai 0 — hanya yang benar-benar
// tercatat di nota. Tujuannya: kolom terpisah tidak diperlukan lagi.
function totalSubLine(row) {
  const parts = []
  if (row.material !== null && row.material !== undefined) parts.push(`Material ${rupiah(row.material)}`)
  if (row.biayaLain) parts.push(`Lain ${rupiah(row.biayaLain)}`)
  if (row.diskon) parts.push(`Diskon −${rupiah(row.diskon)}`)
  return parts.join(' · ')
}

export default function PurchasePage({ rows, refresh, say }) {
  const receivings = rows?.receivings || []
  const receivingItems = rows?.receiving_items || []
  const prItems = rows?.pr_items || []
  const requests = rows?.requests || []
  const projects = rows?.projects || []
  const vendors = rows?.vendors || []
  const materials = rows?.materials || []

  const [tab, setTab] = useState(TAB_READY)
  const [selected, setSelected] = useState(() => new Set())
  const [vendorFilter, setVendorFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [q, setQ] = useState('')
  const [formRows, setFormRows] = useState(null)
  const [expanded, setExpanded] = useState(null)

  const readyAll = useMemo(() => buildReadyRows({
    prItems, requests, projects, vendors, materials, receivings, receivingItems
  }), [prItems, requests, projects, vendors, materials, receivings, receivingItems])

  const readyRows = useMemo(
    () => filterReadyRows(readyAll, { vendorId: vendorFilter, projectId: projectFilter, q }),
    [readyAll, vendorFilter, projectFilter, q]
  )

  const historyRows = useMemo(() => buildHistoryRows({
    receivings, receivingItems, vendors, projects, requests
  }), [receivings, receivingItems, vendors, projects, requests])

  const options = useMemo(() => readyFilterOptions(readyAll), [readyAll])
  const selectedRows = useMemo(
    () => readyAll.filter(r => selected.has(r.prItemId)),
    [readyAll, selected]
  )
  const selectedByVendor = useMemo(() => groupByVendor(selectedRows), [selectedRows])
  const historyTotal = historyRows.reduce((s, r) => s + (Number(r.total) || 0), 0)

  function toggleOne(row) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(row.prItemId)) next.delete(row.prItemId)
      else next.add(row.prItemId)
      return next
    })
  }

  function toggleAllVisible() {
    const allOn = readyRows.length > 0 && readyRows.every(r => selected.has(r.prItemId))
    setSelected(prev => {
      const next = new Set(prev)
      for (const r of readyRows) {
        if (allOn) next.delete(r.prItemId)
        else next.add(r.prItemId)
      }
      return next
    })
  }

  function startPurchase() {
    if (!selectedRows.length) return
    // Toko di form terisi otomatis (toko dengan barang terbanyak) tapi BOLEH
    // diganti ke toko lain — DAT: "Toko / Vendor (otomatis terisi atau bisa
    // dipilih toko lain)". Karena itu SEMUA barang yang dicentang masuk nota;
    // tidak ada barang yang dibuang diam-diam. Bila centang mencakup beberapa
    // toko, admin diberi tahu bahwa satu nota idealnya satu toko.
    const primary = [...selectedByVendor].sort((a, b) => b.count - a.count)[0]
    setFormRows({ rows: selectedRows, vendorId: primary?.vendorId || '' })
  }

  function finishPurchase(res) {
    setFormRows(null)
    setSelected(new Set())
    setTab(TAB_HISTORY)
    if (res?.message) say?.(res.message)
    refresh?.()
  }

  const allVisibleSelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.prItemId))

  return (
    <>
      {/* ===== TAB ===== */}
      <div className="purchase-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === TAB_READY}
          className={`purchase-tab ${tab === TAB_READY ? 'active' : ''}`}
          onClick={() => setTab(TAB_READY)}
          data-testid="tab-ready"
        >
          <span className="purchase-tab-title">Siap Dibeli</span>
          <span className="purchase-tab-count">{readyAll.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === TAB_HISTORY}
          className={`purchase-tab ${tab === TAB_HISTORY ? 'active' : ''}`}
          onClick={() => setTab(TAB_HISTORY)}
          data-testid="tab-history"
        >
          <span className="purchase-tab-title">Riwayat Pembelian</span>
          <span className="purchase-tab-count">{historyRows.length}</span>
        </button>
      </div>

      {tab === TAB_READY && (
        <>
          <div className="purchase-toolbar">
            <div className="purchase-filters">
              <label className="purchase-filter purchase-filter-search">
                <span>Cari barang</span>
                <input
                  type="search"
                  placeholder="Nama barang, No. PR, proyek…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  data-testid="filter-search"
                />
              </label>
              <label className="purchase-filter">
                <span>Toko / Vendor</span>
                <select
                  value={vendorFilter}
                  onChange={e => setVendorFilter(e.target.value)}
                  data-testid="filter-vendor"
                >
                  <option value="">Semua toko</option>
                  {options.vendors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <label className="purchase-filter">
                <span>Proyek</span>
                <select
                  value={projectFilter}
                  onChange={e => setProjectFilter(e.target.value)}
                  data-testid="filter-project"
                >
                  <option value="">Semua proyek</option>
                  {options.projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="btn-purchase-primary"
              onClick={startPurchase}
              disabled={!selectedRows.length}
              data-testid="btn-process-purchase"
            >
              Proses Pembelian{selectedRows.length ? ` (${selectedRows.length})` : ''}
            </button>
          </div>

          {selectedRows.length > 0 && selectedByVendor.length > 1 && (
            <div className="purchase-hint" data-testid="hint-multi-vendor">
              Pilihan mencakup <b>{selectedByVendor.length} toko</b> — satu nota untuk satu toko. Ganti toko di form bila perlu.
            </div>
          )}
          {selectedRows.length > 0 && selectedByVendor.length === 1 && (
            <div className="purchase-hint purchase-hint-ok" data-testid="hint-one-vendor">
              {selectedRows.length} barang dipilih{selectedByVendor[0].vendorName ? ` · ${selectedByVendor[0].vendorName}` : ''} — siap dibuatkan satu nota.
            </div>
          )}

          {/* ===== TABEL SIAP DIBELI — 5 kolom (t_cde1b8ad) =====
              Barang (nama + kode + satuan) · Qty (PR + sisa) · Proyek (+No. PR)
              · Toko · Estimasi. Informasi yang dulu punya kolom sendiri tetap
              tampil, hanya digabung supaya baris tidak melebar ke samping. */}
          <div className="panel table desktop-table-view">
            <table className="purchase-table">
              <thead>
                <tr>
                  <th style={{ width: '34px' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      title="Pilih semua barang yang tampil"
                      data-testid="select-all"
                      aria-label="Pilih semua barang yang tampil"
                    />
                  </th>
                  <th>Barang</th>
                  <th style={{ width: '92px' }}>Qty</th>
                  <th>Proyek</th>
                  <th style={{ width: '140px' }}>Toko / Vendor</th>
                  <th style={{ width: '110px', textAlign: 'right' }}>Estimasi</th>
                </tr>
              </thead>
              <tbody>
                {readyRows.length ? readyRows.map(r => {
                  const on = selected.has(r.prItemId)
                  return (
                    <tr key={r.prItemId} className={on ? 'purchase-row-on' : undefined} data-testid={`ready-row-${r.prItemId}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleOne(r)}
                          data-testid={`check-${r.prItemId}`}
                          aria-label={`Pilih ${r.itemName}`}
                        />
                      </td>
                      <td>
                        <b className="purchase-item-name">{r.itemName}</b>
                        <span className="purchase-item-code">
                          {r.kode ? r.kode : '—'}{r.unit ? ` · ${r.unit}` : ''}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <b>{r.qtyPr}</b> <span className="purchase-muted">{r.unit || ''}</span>
                        {r.qtyBought > 0 && r.qtySisa < r.qtyPr && (
                          <span className="purchase-muted" style={{ display: 'block', fontSize: '10px' }}>
                            sisa {r.qtySisa}
                          </span>
                        )}
                      </td>
                      <td className="purchase-cell-wrap">
                        {r.projectName}
                        <span className="purchase-muted" style={{ display: 'block', fontSize: '10.5px' }}>
                          {r.prNumber}
                        </span>
                      </td>
                      <td className="purchase-cell-wrap">
                        {r.vendorName || <span className="purchase-muted">Belum ditentukan</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.estimasi !== null ? rupiah(r.estimasi) : <span className="purchase-muted">—</span>}
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="empty">
                      Tidak ada barang yang siap dibeli. Barang muncul di sini setelah disetujui di modul Approval.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile tab Siap Dibeli */}
          <div className="mobile-cards-view">
            {readyRows.length ? readyRows.map(r => {
              const on = selected.has(r.prItemId)
              return (
                <div className={`mobile-card ${on ? 'purchase-card-on' : ''}`} key={r.prItemId}>
                  <div className="mobile-card-header">
                    <label className="purchase-card-check">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleOne(r)}
                        data-testid={`check-mobile-${r.prItemId}`}
                        aria-label={`Pilih ${r.itemName}`}
                      />
                      <b className="mobile-card-title">{r.itemName}</b>
                    </label>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Qty PR</span>
                      <span className="mobile-val">
                        {r.qtyPr} {r.unit}
                        {r.qtyBought > 0 && r.qtySisa < r.qtyPr ? ` · sisa ${r.qtySisa}` : ''}
                      </span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Proyek</span>
                      <span className="mobile-val">{r.projectName} · {r.prNumber}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Toko</span>
                      <span className="mobile-val">{r.vendorName || 'Belum ditentukan'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Estimasi</span>
                      <span className="mobile-val">{r.estimasi !== null ? rupiah(r.estimasi) : '—'}</span>
                    </div>
                  </div>
                </div>
              )
            }) : (
              <div className="panel empty">Tidak ada barang yang siap dibeli.</div>
            )}
          </div>

          {/* Footer: hanya muncul saat ADA pilihan (t_cde1b8ad) — tombol primer
              tidak lagi tampil dua kali saat tidak ada yang dicentang. */}
          {selectedRows.length > 0 && (
            <div className="purchase-footer-bar">
              <span className="purchase-muted">
                {selectedRows.length} dipilih dari {readyRows.length} barang tampil
              </span>
              <button
                type="button"
                className="btn-purchase-primary"
                onClick={startPurchase}
              >
                Proses Pembelian ({selectedRows.length})
              </button>
            </div>
          )}
        </>
      )}

      {tab === TAB_HISTORY && (
        <>
          <div className="purchase-toolbar purchase-toolbar-history">
            <div className="purchase-history-summary">
              <b>{historyRows.length} nota</b>
              <span className="purchase-muted">total belanja tercatat</span>
              <b className="purchase-history-total" data-testid="history-total">{rupiah(historyTotal)}</b>
            </div>
          </div>

          {/* ===== RIWAYAT — 6 kolom (t_cde1b8ad) =====
              Tanggal · No. Nota · Toko · Total (+rincian biaya kecil) · Bukti ·
              Aksi. Rincian barang & biaya lengkap tetap di "▼ Rincian". */}
          <div className="panel table desktop-table-view">
            <table className="purchase-table">
              <thead>
                <tr>
                  <th style={{ width: '104px' }}>Tanggal</th>
                  <th style={{ width: '150px' }}>No. Nota</th>
                  <th>Toko / Vendor</th>
                  <th style={{ width: '210px', textAlign: 'right' }}>Total Nota</th>
                  <th style={{ width: '150px' }}>Bukti</th>
                  <th style={{ width: '96px', textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.length ? historyRows.map(row => {
                  const ring = historySummary(row)
                  const isOpen = expanded === row.id
                  const sub = totalSubLine(row)
                  return (
                    <React.Fragment key={row.id}>
                      <tr data-testid={`history-row-${row.id}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>{row.date ? format(row.date) : '—'}</td>
                        <td>
                          <b>{row.invoiceNo || '—'}</b>
                          {row.kind === 'LEGACY' && (
                            <div className="purchase-muted" style={{ fontSize: '10.5px' }}>nota lama</div>
                          )}
                          <div className="purchase-muted" style={{ fontSize: '10.5px' }}>
                            {ring.count ? `${ring.count} item` : 'rincian tidak tercatat'}
                          </div>
                        </td>
                        <td className="purchase-cell-wrap">
                          {row.vendorName || <span className="purchase-muted">Tidak dicatat</span>}
                          <span className="purchase-muted" style={{ display: 'block', fontSize: '10.5px' }}>
                            {row.projectName}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <b style={{ fontSize: '13px' }}>
                            {row.total !== null ? rupiah(row.total) : <span className="purchase-muted">—</span>}
                          </b>
                          {sub && (
                            <span className="purchase-muted" style={{ display: 'block', fontSize: '10.5px', fontWeight: 500 }}>
                              {sub}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="purchase-bukti">
                            {row.hasNotaPhoto && (
                              <button type="button" className="purchase-bukti-chip" onClick={() => openAttachment(row.buktiNotaSrc, 'Foto nota')}>
                                📷 Nota
                              </button>
                            )}
                            {row.hasTransferProof && (
                              <button type="button" className="purchase-bukti-chip" onClick={() => openAttachment(row.buktiTransferSrc, 'Bukti transfer')}>
                                💳 Transfer
                              </button>
                            )}
                            {!row.hasNotaPhoto && !row.hasTransferProof && (
                              <span className="purchase-muted">—</span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className="purchase-detail-btn"
                            onClick={() => setExpanded(isOpen ? null : row.id)}
                            data-testid={`detail-${row.id}`}
                            title="Lihat rincian barang & lampiran"
                          >
                            {isOpen ? '▲ Tutup' : '▼ Rincian'}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="purchase-detail-row">
                          <td colSpan={6}>
                            <div className="purchase-detail">
                              <div className="purchase-detail-head">
                                <span><b>No. Nota:</b> {row.invoiceNo || '—'}</span>
                                <span><b>Proyek:</b> {row.projectName}</span>
                                {row.prNumber ? <span><b>No. PR:</b> {row.prNumber}</span> : null}
                                <span><b>Tanggal:</b> {row.date ? format(row.date) : '—'}</span>
                              </div>
                              {row.items.length ? (
                                <table className="purchase-detail-table">
                                  <thead>
                                    <tr>
                                      <th>Barang</th>
                                      <th style={{ width: '120px' }}>Qty</th>
                                      <th style={{ width: '130px', textAlign: 'right' }}>Harga Satuan</th>
                                      <th style={{ width: '140px', textAlign: 'right' }}>Subtotal</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.items.map(it => {
                                      const harga = parseItemPrice(it.note)
                                      const qty = Number(it.quantity_received) || 0
                                      return (
                                        <tr key={it.id}>
                                          <td>{it.item_name || '—'}</td>
                                          <td>{qty} {it.unit || ''}</td>
                                          <td style={{ textAlign: 'right' }}>{harga ? rupiah(harga) : <span className="purchase-muted">—</span>}</td>
                                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                            {harga ? rupiah(Math.round(qty * harga)) : <span className="purchase-muted">—</span>}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="purchase-muted" style={{ margin: '4px 0' }}>Rincian barang nota ini tidak tercatat.</p>
                              )}
                              <div className="purchase-detail-totals">
                                <span>Material <b>{row.material !== null ? rupiah(row.material) : '—'}</b></span>
                                <span>Biaya lain <b>{row.biayaLain ? rupiah(row.biayaLain) : '—'}</b></span>
                                <span>Diskon <b>{row.diskon ? `− ${rupiah(row.diskon)}` : '—'}</b></span>
                                <span className="purchase-detail-grand">Total Nota <b>{row.total !== null ? rupiah(row.total) : '—'}</b></span>
                              </div>
                              {(row.hasNotaPhoto || row.hasTransferProof || row.notaUrl) && (
                                <div className="purchase-detail-attach">
                                  {row.hasNotaPhoto && (
                                    <button type="button" className="purchase-attach" onClick={() => openAttachment(row.buktiNotaSrc, 'Foto nota')}>
                                      <span className="purchase-attach-thumb">
                                        <img src={row.buktiNotaSrc} alt="Foto nota" />
                                      </span>
                                      <span>{BUKTI_LABEL.nota}</span>
                                    </button>
                                  )}
                                  {row.hasTransferProof && (
                                    <button type="button" className="purchase-attach" onClick={() => openAttachment(row.buktiTransferSrc, 'Bukti transfer')}>
                                      <span className="purchase-attach-thumb">
                                        <img src={row.buktiTransferSrc} alt="Bukti transfer" />
                                      </span>
                                      <span>{BUKTI_LABEL.transfer}</span>
                                    </button>
                                  )}
                                  {row.notaUrl && (
                                    <a className="purchase-attach purchase-attach-link" href={row.notaUrl} target="_blank" rel="noreferrer">
                                      🔗 Referensi nota
                                    </a>
                                  )}
                                </div>
                              )}
                              {row.catatan && <p className="purchase-detail-note">{row.catatan}</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="empty">Belum ada nota pembelian yang selesai.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile tab Riwayat */}
          <div className="mobile-cards-view">
            {historyRows.length ? historyRows.map(row => {
              const ring = historySummary(row)
              return (
                <div className="mobile-card" key={row.id}>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">{row.invoiceNo || 'Nota tanpa nomor'}</b>
                      <div className="mobile-card-sub">{row.vendorName || 'Toko tidak dicatat'}</div>
                    </div>
                    <span className="purchase-total-chip">{row.total !== null ? rupiah(row.total) : '—'}</span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row">
                      <span className="mobile-label">Tanggal</span>
                      <span className="mobile-val">{row.date ? format(row.date) : '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Proyek</span>
                      <span className="mobile-val">{row.projectName}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Barang</span>
                      <span className="mobile-val">{ring.count ? `${ring.count} item` : '—'}</span>
                    </div>
                  </div>
                  <div className="mobile-card-actions">
                    <button
                      type="button"
                      className="outline"
                      style={{ width: '100%' }}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {expanded === row.id ? '▲ Tutup rincian' : '▼ Lihat rincian nota'}
                    </button>
                    {expanded === row.id && (
                      <div className="purchase-detail" style={{ marginTop: '10px' }}>
                        {row.items.map(it => {
                          const harga = parseItemPrice(it.note)
                          const qty = Number(it.quantity_received) || 0
                          return (
                            <div key={it.id} className="purchase-detail-line">
                              <span>{it.item_name} · {qty} {it.unit || ''}</span>
                              <b>{harga ? rupiah(Math.round(qty * harga)) : '—'}</b>
                            </div>
                          )
                        })}
                        {row.hasNotaPhoto && (
                          <button type="button" className="purchase-bukti-chip" onClick={() => openAttachment(row.buktiNotaSrc, 'Foto nota')}>📷 Foto nota</button>
                        )}
                        {row.hasTransferProof && (
                          <button type="button" className="purchase-bukti-chip" onClick={() => openAttachment(row.buktiTransferSrc, 'Bukti transfer')}>💳 Bukti transfer</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            }) : (
              <div className="panel empty">Belum ada nota pembelian yang selesai.</div>
            )}
          </div>
        </>
      )}

      {formRows && (
        <PurchaseForm
          rows={formRows.rows}
          vendorId={formRows.vendorId}
          vendors={vendors}
          receivings={receivings}
          receivingItems={receivingItems}
          close={() => setFormRows(null)}
          onDone={finishPurchase}
          say={say}
        />
      )}
    </>
  )
}
