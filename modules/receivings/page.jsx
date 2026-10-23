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
import ReturnRequest from './returnRequest'

// Draft item belanja langsung (tanpa request) untuk dialog Proses Pembelian.
// Identitas barang aktual ditulis admin; TANPA pr_item_id (tidak membuat
// request/PR artifisial). Hubungan ke request tetap OPSIONAL: bila admin
// menulis nama yang sama, data tetap berdiri sendiri.
export function directPurchaseRow({ itemName = '', unit = '', qty = '1', projectId = null, projectName = 'Belanja langsung' } = {}) {
  return {
    key: `direct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    prItemId: null,
    prId: null,
    prNumber: '',
    prTitle: '',
    itemName: String(itemName).trim(),
    kode: '',
    unit,
    qtyPr: null,
    qtyBought: 0,
    qtySisa: null,
    estimasi: null,
    materialId: null,
    hargaAcuan: null,
    kategori: '',
    projectId,
    projectName,
    vendorId: '',
    vendorName: '',
    vendorKnown: false,
    isDirect: true
  }
}

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
  // Antrean nota per vendor (arahan DAT bagian 2): pilihan lintas toko dipecah
  // menjadi beberapa nota berurutan, bukan satu nota bercampur.
  const [purchaseQueue, setPurchaseQueue] = useState([])
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
    // dipilih toko lain".
    //
    // PEMECAHAN PER VENDOR (arahan DAT bagian 2): satu nota toko TIDAK boleh
    // memuat barang vendor lain — kalau boleh, nota diberi label satu vendor
    // padahal isinya campuran, sehingga harga/retur per vendor salah cocok.
    // Karena itu pilihan lintas toko dipecah menjadi SATU FORM PER VENDOR;
    // jejak PR tetap di tiap baris (prItemId → purchase_request_id).
    const groups = selectedByVendor.filter(g => g.vendorId)
    const tanpaVendor = selectedByVendor.filter(g => !g.vendorId)
    // No planned vendor is valid: choose the actual supplier in Purchase,
    // never force a submitted PR to be edited merely to buy its items.
    if (!groups.length) {
      setPurchaseQueue([])
      setFormRows({ rows: selectedRows, vendorId: '', vendorName: '' })
      return
    }
    // Urutan: vendor terbanyak lebih dulu (kebiasaan admin), sisanya menyusul.
    const ordered = [...groups, ...tanpaVendor].sort((a, b) => b.count - a.count)
    const queue = ordered.map(g => ({ rows: g.rows, vendorId: g.vendorId, vendorName: g.vendorName }))
    setPurchaseQueue(queue)
    // Buka nota vendor PERTAMA; sisanya berurutan setelah nota tersimpan.
    setFormRows(queue[0])
  }

  // Belanja langsung (Tahap B): catat pembelian TANPA request — form tetap
  // satu dialog, toko/proyek diisi admin di dalamnya. Item langsung tidak
  // dipilih via checkbox (identitasnya belum ada) — langsung buka form.
  function startDirectPurchase() {
    const row = directPurchaseRow({
      itemName: '',
      projectId: projectFilter || null
    })
    setPurchaseQueue([])
    setFormRows({ rows: [row], vendorId: vendorFilter || '' })
  }

  // Satu nota selesai → lanjut ke vendor berikutnya (bukan mencampur).
  function finishPurchase(res) {
    if (res?.message) say?.(res.message)
    setFormRows(null)
    refresh?.()
    setPurchaseQueue(prev => {
      const rest = prev.slice(1)
      if (rest.length) {
        // Masih ada vendor lain: buka form berikutnya tanpa menutup alur.
        setFormRows(rest[0])
        say?.(`Nota ${res?.invoiceNo || ''} tersimpan. Lanjut nota vendor berikutnya: ${rest[0].vendorName || 'tanpa nama'}.`)
        return rest
      }
      setSelected(new Set())
      setTab(TAB_HISTORY)
      return []
    })
  }

  // Batal di tengah antrean vendor: hentikan sisa antrean dengan jujur
  // (nota yang sudah tersimpan TETAP ada — tidak ada rollback data).
  function cancelPurchaseQueue() {
    const sisa = purchaseQueue.length
    setFormRows(null)
    setPurchaseQueue([])
    setSelected(new Set())
    if (sisa > 0) say?.('Sisa nota vendor yang belum dibuat dibatalkan. Nota yang sudah tersimpan tetap ada di Riwayat Pembelian.')
  }

  function actualPriceFor(prItemId) {
    const prices = receivingItems.filter(i => i.pr_item_id === prItemId && Number(i.quantity_received) > 0)
      .map(i => parseItemPrice(i.note)).filter(p => p !== null && p !== undefined)
    const unique = [...new Set(prices)]
    return unique.length > 1 ? 'Beberapa pembelian' : unique.length === 1 ? rupiah(unique[0]) : '—'
  }
  const allVisibleSelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.prItemId))

  return (
    <div className="ops-container">
      <details className="compact-flow-detail"><summary>Revisi PR dari Pembelian</summary>{requests.filter(p=>['SUBMITTED','APPROVED'].includes(String(p.status).toUpperCase())).map(p=><div key={p.id} style={{display:'flex',gap:8,alignItems:'center',marginBottom:6}}><b>{p.pr_number}</b><ReturnRequest pr={p} refresh={refresh} say={say}/></div>)}</details>
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
          <span className="purchase-tab-title">Belum Tuntas</span>
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
              title={selectedRows.length ? undefined : 'Pilih minimal satu barang dulu — centang kotak di kolom paling kiri tabel.'}
              aria-describedby={selectedRows.length ? undefined : 'purchase-select-hint'}
              data-testid="btn-process-purchase"
            >
              Proses Pembelian{selectedRows.length ? ` (${selectedRows.length})` : ''}
            </button>
            <button
              type="button"
              className="outline"
              onClick={startDirectPurchase}
              data-testid="btn-direct-purchase"
              title="Catat nota belanja langsung tanpa request"
            >
              + Belanja langsung (tanpa request)
            </button>
            {/* Petunjuk pemilihan (t_b3768506): jumlah pilihan + alasan tombol
                nonaktif harus terbaca tanpa menebak. */}
            <div className="purchase-select-status" role="status" aria-live="polite">
              {selectedRows.length > 0 ? (
                <span className="purchase-select-count" data-testid="select-count">
                  {selectedRows.length} barang dipilih — siap dibuatkan satu nota
                </span>
              ) : (
                <span className="purchase-select-hint" id="purchase-select-hint" data-testid="select-empty-hint">
                  Pilih barang untuk satu nota/toko: centang kotak di kolom <b>Pilih</b>, lalu klik <b>Proses Pembelian</b>.
                </span>
              )}
            </div>
          </div>

          {selectedRows.length > 0 && selectedByVendor.length > 1 && (
            <div className="purchase-hint" data-testid="hint-multi-vendor">
              Pilihan mencakup <b>{selectedByVendor.length} toko</b> — akan dibuat <b>{selectedByVendor.filter(g => g.vendorId).length} nota terpisah</b> (satu nota per toko, berurutan). Jejak PR tetap tersimpan di tiap barang.
            </div>
          )}
          {selectedRows.length > 0 && selectedByVendor.length === 1 && (
            <div className="purchase-hint purchase-hint-ok" data-testid="hint-one-vendor">
              {selectedRows.length} barang dipilih{selectedByVendor[0].vendorName ? ` · ${selectedByVendor[0].vendorName}` : ''} — siap dibuatkan satu nota.
            </div>
          )}
          {selectedRows.length > 0 && selectedByVendor.some(g => !g.vendorId) && (
            <div className="purchase-hint" data-testid="hint-no-vendor">
              {selectedByVendor.filter(g => !g.vendorId).reduce((s, g) => s + g.rows.length, 0)} barang belum punya rencana toko — pilih toko aktual pada form pembelian.
            </div>
          )}

          {/* ===== TABEL SIAP DIBELI — 7 kolom (t_4f9625b3) =====
              Urutan konsisten diminta DAT: PILIH · NOMOR PR · PROJECT ·
              QUANTITY · BARANG (Nama + kode/satuan) · TOKO / VENDOR ·
              ESTIMASI. Setiap informasi berdiri di kolomnya sendiri —
              tidak ada yang digabung/dihilangkan. */}
          <div className="panel table desktop-table-view">
            <table className="purchase-table">
              <thead>
                <tr>
                  <th className="purchase-select-col" scope="col">
                    <label className="purchase-select-all-label">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        title="Pilih semua barang yang tampil"
                        data-testid="select-all"
                        aria-label="Pilih semua barang yang tampil"
                      />
                      <span>Pilih</span>
                    </label>
                  </th>
                  <th style={{ width: '104px' }}>Nomor PR</th>
                  <th>Project</th>
                  <th>Barang / Spesifikasi</th>
                  <th>Jumlah PR</th>
                  <th>Dibeli / Sisa</th>
                  <th style={{ textAlign: 'right' }}>Est. Harga Satuan</th>
                  <th>Harga Beli</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {readyRows.length ? readyRows.map(r => {
                  const on = selected.has(r.prItemId)
                  return (
                    <tr key={r.prItemId} className={on ? 'purchase-row-on' : undefined} data-testid={`ready-row-${r.prItemId}`}>
                      <td className="purchase-select-col">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleOne(r)}
                          data-testid={`check-${r.prItemId}`}
                          aria-label={`Pilih ${r.itemName}`}
                        />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="purchase-pr-number">{r.prNumber || '—'}</span>
                      </td>
                      <td className="purchase-cell-wrap">
                        {r.projectName}
                      </td>
                      <td className="purchase-cell-wrap"><b>{r.itemName}</b><small className="compact-flow-sub">{r.kode || ''}</small></td>
                      <td>{r.qtyPr} {r.unit}</td>
                      <td><span>Dibeli {r.qtyBought} {r.unit}</span><strong className="compact-flow-remaining">Sisa {r.qtySisa} {r.unit}</strong></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.estimasi !== null ? rupiah(r.estimasi) : <span className="purchase-muted">—</span>}
                      </td>
                      <td>{actualPriceFor(r.prItemId)}</td>
                      <td><div className="compact-flow-actions"><button onClick={()=>setFormRows({rows:[r],vendorId:r.vendorId||'',vendorName:r.vendorName||''})}>{r.qtyBought>0?'Beli Sisa':'Beli'}</button><details><summary>Detail</summary><ReturnRequest pr={requests.find(p=>p.id===r.prId)} refresh={refresh} say={say}/><small>Rencana toko: {r.vendorName||'Belum ditentukan'}. Harga beli aktual dan riwayat per nota ada di Riwayat Pembelian.</small></details></div></td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={9} className="empty">
                      Tidak ada sisa kebutuhan. Barang muncul setelah PR di-submit.
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
                        {r.qtyPr} {r.unit} · Dibeli {r.qtyBought}
                        <strong className="compact-flow-remaining">Sisa {r.qtySisa} {r.unit}</strong>
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
                      <span className="mobile-label">Est. Harga Satuan</span>
                      <span className="mobile-val">{r.estimasi !== null ? rupiah(r.estimasi) : '—'}</span>
                    </div>
                    <div className="mobile-card-row"><span>Harga Beli</span><span>{actualPriceFor(r.prItemId)}</span></div>
                    <div className="compact-flow-actions"><button onClick={()=>setFormRows({rows:[r],vendorId:r.vendorId||'',vendorName:r.vendorName||''})}>{r.qtyBought>0?'Beli Sisa':'Beli'}</button><details><summary>Detail</summary><ReturnRequest pr={requests.find(p=>p.id===r.prId)} refresh={refresh} say={say}/></details></div>
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
          key={`${formRows.vendorId}:${formRows.rows.map(r => r.prItemId || r.formKey).join(',')}`}
          rows={formRows.rows}
          vendorId={formRows.vendorId}
          vendors={vendors}
          projects={projects}
          receivings={receivings}
          receivingItems={receivingItems}
          close={cancelPurchaseQueue}
          onDone={finishPurchase}
          say={say}
        />
      )}
    </div>
  )
}
