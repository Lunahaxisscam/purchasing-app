// ============================================================
// modules/sales-invoice/view.jsx — MODUL INVOICE PENJUALAN (Sales Invoice)
// ============================================================
// Alur: CRM (customer) → RAB final disetujui → Invoice Penjualan →
//       penerbitan nomor proyek di Master Project.
//
// KONTRAK UI (S4 — setelah review Brooklyn):
//   * Status TIDAK PERNAH berpindah otomatis. Tidak ada lagi tombol
//     "✓ Lunas" sekali klik tanpa bukti pembayaran, dan tidak ada
//     "✉ Terkirim" yang bisa ditekan untuk dokumen yang belum terbit.
//   * Setiap aksi meminta bukti yang benar-benar diminta server:
//       TERBIT    → tanpa bukti (server mengalokasikan nomor)
//       TERKIRIM  → kanal pengiriman (WA/email/cetak/serah)
//       LUNAS     → nominal diterima + tanggal + referensi pembayaran
//       BATAL     → konfirmasi
//   * Banner penyimpanan menyatakan dengan jujur apakah data durable
//     (Supabase) atau hanya pratinjau lokal — tidak ada klaim "tersimpan"
//     untuk file JSON yang hilang saat deploy.
// ============================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import CompactRoot from '../../components/CompactRoot'
import CreateInvoiceModal from './CreateInvoiceModal'
import { buildSalesInvoicePdf, downloadPdf, missingPaymentFields, missingIssuerFields } from './pdf'
// Template RESMI (hasil gabungan generator invoice): layout A4 Noir dengan
// termin, tabel item, dan tanda tangan. Dipakai sebagai PDF utama.
import { buildOfficialInvoicePdf, downloadBytes as downloadOfficial } from './official'
import {
  getAccessToken,
  issueInvoice,
  listInvoices,
  markPaid,
  markSent,
  voidInvoice
} from './apiClient'
import { DRAFT_STATUS, allowedTransitions, isDraftStatus } from './contract.js'

export const INVOICE_COLUMNS = [
  { key: 'invoice_no', label: 'No. Invoice' },
  { key: 'customer_name', label: 'Customer (CRM)' },
  { key: 'rab_reff', label: 'RAB Final / Disetujui' },
  { key: 'nominal', label: 'Nominal' },
  { key: 'status', label: 'Status Dokumen' }
]

export function invoiceStatusBadge(status) {
  const s = String(status || '').trim()
  if (!s) return { label: '—', tone: 'muted' }
  const known = {
    DRAFT: 'draft',
    TERBIT: 'issued',
    TERKIRIM: 'sent',
    DISETUJUI: 'approved',
    DITOLAK: 'rejected',
    LUNAS: 'paid',
    BATAL: 'void'
  }
  const tone = known[String(s).toUpperCase()]
  return { label: s.toUpperCase(), tone: tone || 'muted' }
}

export function formatNominal(v) {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !isFinite(n)) return '—'
  return `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
}

const SENT_CHANNELS = [
  { id: 'WhatsApp', label: 'WhatsApp' },
  { id: 'Email', label: 'Email' },
  { id: 'Cetak / serah langsung', label: 'Cetak / serah langsung' },
  { id: 'Kurir', label: 'Kurir' }
]

// ------------------------------------------------------------
// KPI ringkas invoice — FUNGSI MURNI, diekspor supaya bisa diuji harness
// (dulu logikanya hanya di dalam useMemo sehingga harness menyalin ulang dan
// angka yang diuji bisa berbeda dari yang dirender).
// Kejujuran angka:
//  - totalNominal = SEMUA status (termasuk draf/batal) -> label kartu
//    menyatakan itu, bukan "omzet".
//  - paid = hanya paid_amount yang benar-benar tercatat. LUNAS tanpa
//    paid_amount TIDAK dihitung lunas; jumlahnya dilaporkan terpisah.
// ------------------------------------------------------------
export function computeInvoiceKpi(items) {
  const list = Array.isArray(items) ? items : []
  let totalNominal = 0
  let outstanding = 0
  let paid = 0
  let drafts = 0
  let lunasTanpaBukti = 0
  for (const inv of list) {
    const st = String(inv.status || '').toUpperCase()
    const amount = Number(inv.grand_total || inv.nominal || 0)
    totalNominal += amount
    if (st === DRAFT_STATUS) { drafts++; continue }
    if (st === 'LUNAS') {
      const p = Number(inv.paid_amount)
      if (Number.isFinite(p) && p > 0) paid += p
      else lunasTanpaBukti += 1
    } else if (st !== 'BATAL') outstanding += amount
  }
  return { totalCount: list.length, totalNominal, outstanding, paid, drafts, lunasTanpaBukti }
}

export default function SalesInvoiceModule({ invoices = null, allProjects = [], projects = [], say, issuer, payment }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState(null)
  const [numbering, setNumbering] = useState(null)
  const [formatsInUse, setFormatsInUse] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [dialog, setDialog] = useState(null) // { type, invoice }
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const effectiveProjects = useMemo(() => {
    return (allProjects && allProjects.length > 0) ? allProjects : (projects || [])
  }, [allProjects, projects])

  const fetchInvoices = useCallback(async () => {
    if (Array.isArray(invoices)) {
      setItems(invoices)
      setStorage(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      const token = await getAccessToken()
      if (!token) {
        setLoadError('Sesi login tidak ditemukan. Muat ulang halaman dan login sebagai admin.')
        setItems([])
        setLoading(false)
        return
      }
      const json = await listInvoices({ token })
      setItems(Array.isArray(json.invoices) ? json.invoices : [])
      setStorage(json.storage || null)
      setNumbering(json.numbering || (json.storage && json.storage.number_format) || null)
      setFormatsInUse(json.number_formats_in_use || null)
    } catch (err) {
      setLoadError(err.message || 'Gagal memuat daftar invoice.')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [invoices])

  useEffect(() => { fetchInvoices() }, [fetchInvoices])

  const replaceItem = (inv) => {
    setItems(prev => {
      const idx = prev.findIndex(x => x.id === inv.id)
      if (idx === -1) return [inv, ...prev]
      const next = prev.slice()
      next[idx] = inv
      return next
    })
  }

  async function runAction(invoice, fn, successMsg) {
    setBusyId(invoice.id)
    setActionError('')
    setNotice('')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sesi login tidak ditemukan. Login ulang sebagai admin.')
      const json = await fn(invoice.id, { token })
      replaceItem(json.invoice)
      const warn = (json.warnings || []).join(' ')
      setNotice(`${successMsg}${warn ? ' ' + warn : ''}`)
      if (say) say(`${successMsg}${warn ? ' ' + warn : ''}`)
      setDialog(null)
      return true
    } catch (err) {
      setActionError(err.message || 'Aksi gagal.')
      return false
    } finally {
      setBusyId(null)
    }
  }

  // ---- Dialog state untuk bukti ----
  const [sentChannel, setSentChannel] = useState(SENT_CHANNELS[0].id)
  const [paidAmount, setPaidAmount] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [paymentRef, setPaymentRef] = useState('')

  function openDialog(type, invoice) {
    setActionError('')
    setNotice('')
    setSentChannel(SENT_CHANNELS[0].id)
    setPaidAmount(String(invoice.grand_total || invoice.nominal || ''))
    setPaidAt(new Date().toISOString().slice(0, 10))
    setPaymentRef('')
    setDialog({ type, invoice })
  }

  const handleExportPdf = (invoice) => {
    try {
      const bytes = buildSalesInvoicePdf(invoice, { issuer, payment })
      const filename = `Invoice_${(invoice.invoice_no || 'DRAFT').replace(/\//g, '-')}_${invoice.customer_name || 'Client'}.pdf`
      downloadPdf(bytes, filename)
      const missPay = missingPaymentFields(payment)
      const missIss = missingIssuerFields(issuer)
      if (missPay.length || missIss.length) {
        const msg = [
          missIss.length ? `identitas penerbit belum lengkap (${missIss.join(', ')})` : '',
          missPay.length ? `data rekening belum lengkap (${missPay.join(', ')})` : ''
        ].filter(Boolean).join('; ')
        setNotice(`PDF diunduh, tetapi ${msg}. Dokumen menandainya sebagai "BELUM DIISI" — lengkapi sebelum dikirim ke klien.`)
      } else {
        setNotice(`PDF invoice ${invoice.invoice_no || 'draf'} berhasil diunduh.`)
      }
    } catch (err) {
      setActionError('Gagal membuat PDF: ' + err.message)
    }
  }

  // PDF TEMPLATE RESMI — memakai renderer generator (kop olive, BILL TO, tabel
  // item, termin, transfer, tanda tangan). Draf diberi watermark DRAF supaya
  // tidak bisa dipakai sebagai tagihan sah tanpa sengaja.
  const handleExportOfficial = async (invoice) => {
    try {
      setActionError('')
      const mode = isDraftStatus(invoice.status) ? 'draft' : 'final'
      const { bytes } = await buildOfficialInvoicePdf(invoice, { issuer, payment, mode })
      const filename = `Invoice_${(invoice.invoice_no || 'DRAFT').replace(/\//g, '-')}_${(invoice.customer_name || 'Client').replace(/[^\w-]+/g, '_')}${mode === 'draft' ? '-DRAF' : ''}.pdf`
      downloadOfficial(bytes, filename)
      setNotice(`PDF template resmi ${invoice.invoice_no || 'draf'} diunduh (${mode === 'draft' ? 'DRAF — berwatermark' : 'final'}).`)
    } catch (err) {
      setActionError('Gagal membuat PDF template resmi: ' + err.message)
    }
  }

  const filtered = useMemo(() => {
    return items.filter(inv => {
      if (filterStatus !== 'ALL') {
        if (String(inv.status || '').toUpperCase() !== filterStatus) return false
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const hay = `${inv.invoice_no || ''} ${inv.customer_name || ''} ${inv.project_name || ''} ${inv.project_code || ''} ${inv.rab_reff || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, filterStatus, search])

  // Angka KPI diambil dari fungsi murni computeInvoiceKpi (satu sumber dengan
  // yang diuji harness) — jangan menduplikasi logika di sini.
  const kpi = useMemo(() => computeInvoiceKpi(items), [items])

  const storageBanner = (() => {
    if (!storage) return null
    if (storage.durable) {
      return { tone: 'ok', text: `Tersimpan di Supabase (${storage.kind}). Nomor invoice dialokasikan server.` }
    }
    return {
      tone: 'warn',
      text: `PRATINJAU LOKAL — data hanya di file JSON mesin ini (hilang saat deploy) dan nomor proyek TIDAK diterbitkan. Jangan pakai untuk menagih klien.`
    }
  })()

  // DISCREPANCY FORMAT NOMOR — jangan disembunyikan, jangan migrasi otomatis.
  const numberingBanner = (() => {
    if (!numbering) return null
    const mixed = formatsInUse && formatsInUse['legacy-buku'] > 0 && formatsInUse['inv-nl'] > 0
    if (numbering.blocked) {
      return {
        tone: 'err',
        text: `Format nomor invoice BELUM DISEPAKATI (${numbering.code || 'NUMBER_FORMAT_NOT_AGREED'}): ${numbering.message || ''} Penerbitan ditolak sampai konfigurasi diperbaiki. Format authoritative Buku: NL<yymm><XXX>.`
      }
    }
    if (numbering.format === 'inv-nl') {
      return {
        tone: 'warn',
        text: `Format nomor AKTIF = INV/NL/TAHUN/BULAN/URUT (bukan format Buku NL<yymm><XXX>). Diaktifkan eksplisit lewat SALES_INVOICE_NO_FORMAT_ACK=1. Nomor lama TIDAK dimigrasi${mixed ? ' — dua format hidup berdampingan' : ''}.`
      }
    }
    if (mixed) {
      return {
        tone: 'warn',
        text: `Ditemukan ${formatsInUse['legacy-buku']} nomor format Buku dan ${formatsInUse['inv-nl']} nomor format INV/NL. Nomor lama TIDAK dimigrasi; penerbitan baru memakai format Buku.`
      }
    }
    return { tone: 'ok', text: `Format nomor: Buku (Obsidian) NL<yymm><XXX>, urut 3 digit, reset tahunan.` }
  })()

  return (
    <CompactRoot className="si-root" data-testid="sales-invoice-root">
      {/* HEADER */}
      <div className="si-intro">
        <div className="si-intro-copy">
          <strong>Invoice Penjualan</strong>
          <span>
            Alur bisnis: CRM (identitas customer) &rarr; RAB final yang disetujui
            customer &rarr; Invoice &rarr; penerbitan nomor Master Project.
          </span>
        </div>
        <div className="si-header-actions">
          <button type="button" className="si-btn-create" onClick={() => setIsModalOpen(true)}>
            + Buat Invoice Penjualan
          </button>
        </div>
      </div>

      {storageBanner && (
        <div className={`si-store-banner si-store-${storageBanner.tone}`} data-testid="si-storage-banner">
          {storageBanner.text}
        </div>
      )}

      {numberingBanner && (
        <div className={`si-store-banner si-store-${numberingBanner.tone}`} data-testid="si-numbering-banner">
          {numberingBanner.text}
        </div>
      )}

      {loadError && <div className="si-alert si-alert-err">{loadError}</div>}
      {actionError && <div className="si-alert si-alert-err">{actionError}</div>}
      {notice && <div className="si-alert si-alert-ok">{notice}</div>}

      {/* KPI */}
      <div className="si-kpi-grid">
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Total Invoice</span>
          <b className="si-kpi-val">{kpi.totalCount}</b>
          <small className="si-kpi-sub">{kpi.drafts} draf belum terbit</small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Total Nilai Tagihan</span>
          <b className="si-kpi-val">{formatNominal(kpi.totalNominal)}</b>
          <small className="si-kpi-sub">
            semua status termasuk draf &amp; batal — bukan omzet
          </small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Belum Dibayar</span>
          <b className="si-kpi-val si-c-warn">{formatNominal(kpi.outstanding)}</b>
          <small className="si-kpi-sub">terbit, belum lunas</small>
        </div>
        <div className="si-kpi-card">
          <span className="si-kpi-lbl">Lunas Terverifikasi</span>
          <b className="si-kpi-val si-c-ok">{formatNominal(kpi.paid)}</b>
          <small className="si-kpi-sub">
            {kpi.lunasTanpaBukti > 0
              ? `${kpi.lunasTanpaBukti} invoice LUNAS tanpa nominal bukti (tidak dihitung)`
              : 'ada bukti pembayaran'}
          </small>
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="si-toolbar">
        <div className="si-filter-tabs">
          {[
            { id: 'ALL', label: 'Semua' },
            { id: 'DRAFT', label: 'Draf' },
            { id: 'TERBIT', label: 'Terbit' },
            { id: 'TERKIRIM', label: 'Terkirim' },
            { id: 'LUNAS', label: 'Lunas' }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              className={`si-tab-btn ${filterStatus === tab.id ? 'active' : ''}`}
              onClick={() => setFilterStatus(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="si-search-wrap">
          <input
            type="text"
            placeholder="🔍 Cari invoice, customer, proyek..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* TABLE */}
      <div className="si-panel">
        <div className="si-panel-head">
          <strong>Daftar Invoice Penjualan</strong>
          <span>{filtered.length} invoice ditampilkan</span>
        </div>

        {loading ? (
          <div className="si-empty"><p>Memuat data invoice penjualan…</p></div>
        ) : filtered.length > 0 ? (
          <div className="si-table-wrap">
            <table className="si-table">
              <thead>
                <tr>
                  <th>No. Invoice</th>
                  <th>Tanggal</th>
                  <th>Customer (CRM)</th>
                  <th>Proyek &amp; No. Proyek</th>
                  <th>RAB Reff</th>
                  <th className="si-num">Nominal Tagihan</th>
                  <th>Status Dokumen</th>
                  <th style={{ textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const badge = invoiceStatusBadge(inv.status)
                  const pCode = inv.project_code ? `[${inv.project_code}] ` : ''
                  const next = allowedTransitions(inv.status)
                  const isDraft = isDraftStatus(inv.status)
                  const busy = busyId === inv.id
                  return (
                    <tr key={inv.id || inv.invoice_no}>
                      <td>
                        <strong className="si-inv-num">{inv.invoice_no || <span className="si-draft-num">draf</span>}</strong>
                      </td>
                      <td>
                        <div>{inv.issue_date || '—'}</div>
                        {inv.due_date && <small className="si-due-txt">JT: {inv.due_date}</small>}
                      </td>
                      <td>
                        <strong>{inv.customer_name}</strong>
                        {inv.customer_phone && <div className="si-subtxt">{inv.customer_phone}</div>}
                      </td>
                      <td>
                        <div>
                          {pCode ? <span className="si-proj-code">{pCode}</span> : null}
                          <span>{inv.project_name || '—'}</span>
                        </div>
                        {!inv.project_issued && !isDraft && (
                          <div className="si-subtxt si-warn-txt">nomor proyek belum terbit</div>
                        )}
                        {inv.project_address && <div className="si-subtxt">{inv.project_address}</div>}
                      </td>
                      <td><span className="si-rab-pill">{inv.rab_reff || '—'}</span></td>
                      <td className="si-num">
                        <strong>{formatNominal(inv.grand_total || inv.nominal)}</strong>
                        {inv.tax_amount > 0 && (
                          <div className="si-subtxt">Termasuk PPN ({formatNominal(inv.tax_amount)})</div>
                        )}
                      </td>
                      <td>
                        <span className={`si-badge si-badge-${badge.tone}`}>{badge.label}</span>
                        {inv.status === 'LUNAS' && inv.payment_ref && (
                          <div className="si-subtxt">ref: {inv.payment_ref}</div>
                        )}
                        {inv.sent_channel && (
                          <div className="si-subtxt">via {inv.sent_channel}</div>
                        )}
                      </td>
                      <td>
                        <div className="si-row-actions">
                          <button
                            type="button"
                            className="si-act-btn si-act-pdf"
                            title="Unduh PDF invoice (template resmi Noir, A4)"
                            onClick={() => handleExportOfficial(inv)}
                            data-testid="si-pdf-official"
                          >
                            📄 PDF
                          </button>
                          <button
                            type="button"
                            className="si-act-btn"
                            title="Unduh PDF ringkas (format lama)"
                            onClick={() => handleExportPdf(inv)}
                            data-testid="si-pdf-simple"
                          >
                            📄 Ringkas
                          </button>

                          {isDraft && (
                            <button
                              type="button"
                              className="si-act-btn si-act-issue"
                              title="Terbitkan: server memberi nomor invoice & (bila dipilih) nomor proyek"
                              disabled={busy}
                              onClick={() => runAction(inv, issueInvoice, `✓ Invoice ${inv.id} diterbitkan.`)}
                            >
                              ⬆ Terbitkan
                            </button>
                          )}

                          {next.includes('TERKIRIM') && (
                            <button
                              type="button"
                              className="si-act-btn si-act-send"
                              title="Catat bahwa dokumen benar-benar sudah dikirim ke klien"
                              disabled={busy}
                              onClick={() => openDialog('sent', inv)}
                            >
                              ✉ Sudah dikirim
                            </button>
                          )}

                          {next.includes('LUNAS') && (
                            <button
                              type="button"
                              className="si-act-btn si-act-pay"
                              title="Tandai lunas — wajib bukti pembayaran terverifikasi"
                              disabled={busy}
                              onClick={() => openDialog('paid', inv)}
                            >
                              ✓ Lunas
                            </button>
                          )}

                          {next.includes('BATAL') && !isDraft && (
                            <button
                              type="button"
                              className="si-act-btn si-act-void"
                              title="Batalkan invoice (nomor tetap terpakai)"
                              disabled={busy}
                              onClick={() => openDialog('void', inv)}
                            >
                              ✕ Batalkan
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="si-empty" data-testid="si-empty">
            <div className="si-empty-icon" aria-hidden="true">🧾</div>
            <strong>Belum ada invoice penjualan</strong>
            <p>
              Invoice penjualan diterbitkan setelah penawaran RAB / BOQ disetujui klien.
              Invoice dibuat sebagai draf dulu; nomor invoice dan nomor proyek resmi
              baru terbit saat Anda menekan Terbitkan.
            </p>
            <div className="si-empty-action">
              <button type="button" className="si-btn-create" onClick={() => setIsModalOpen(true)}>
                + Buat Invoice Penjualan Pertama
              </button>
            </div>
            <div className="si-empty-note">
              <b>Alur Bisnis:</b> CRM (Customer) &rarr; RAB Disetujui &rarr; Sales Invoice &rarr; Penerbitan Nomor Master Project.
            </div>
          </div>
        )}
      </div>

      {/* DIALOG BUKTI */}
      {dialog && (
        <div className="si-modal-overlay">
          <div className="si-dialog-card">
            <h4>
              {dialog.type === 'sent' && 'Catat pengiriman invoice'}
              {dialog.type === 'paid' && 'Tandai invoice lunas'}
              {dialog.type === 'void' && 'Batalkan invoice'}
            </h4>
            <p className="si-dialog-sub">
              {dialog.type === 'sent' && 'Status TERKIRIM berarti dokumen benar-benar sudah sampai ke klien. Pilih kanal yang dipakai.'}
              {dialog.type === 'paid' && 'Status LUNAS hanya untuk pembayaran yang sudah diterima & diverifikasi. Pembayaran sebagian tidak bisa menandai lunas.'}
              {dialog.type === 'void' && `Invoice ${dialog.invoice.invoice_no || dialog.invoice.id} akan dibatalkan permanen. Nomor invoice tetap tercatat terpakai.`}
            </p>

            {dialog.type === 'sent' && (
              <div className="si-field">
                <label>Kanal pengiriman *</label>
                <select value={sentChannel} onChange={e => setSentChannel(e.target.value)}>
                  {SENT_CHANNELS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}

            {dialog.type === 'paid' && (
              <>
                <div className="si-field">
                  <label>Nominal diterima (IDR) *</label>
                  <input type="number" min="1" step="1" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
                  <small>Total tagihan: {formatNominal(dialog.invoice.grand_total || dialog.invoice.nominal)}. Harus sama (selisih maks Rp 1).</small>
                </div>
                <div className="si-field">
                  <label>Tanggal dana diterima *</label>
                  <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
                </div>
                <div className="si-field">
                  <label>Referensi pembayaran / bukti transfer *</label>
                  <input type="text" placeholder="No. transfer / mutasi" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                </div>
              </>
            )}

            <div className="si-dialog-foot">
              <button type="button" className="si-btn-cancel" onClick={() => setDialog(null)} disabled={busyId === dialog.invoice.id}>
                Batal
              </button>
              <button
                type="button"
                className={dialog.type === 'void' ? 'si-btn-danger' : 'si-btn-submit'}
                disabled={busyId === dialog.invoice.id}
                onClick={() => {
                  if (dialog.type === 'sent') {
                    runAction(dialog.invoice, (id, o) => markSent(id, sentChannel, o), '✓ Pengiriman tercatat.')
                  } else if (dialog.type === 'paid') {
                    runAction(
                      dialog.invoice,
                      (id, o) => markPaid(id, { paid_amount: Number(paidAmount), paid_at: paidAt, payment_ref: paymentRef }, o),
                      '✓ Invoice ditandai lunas dengan bukti pembayaran.'
                    )
                  } else {
                    runAction(dialog.invoice, voidInvoice, '✓ Invoice dibatalkan.')
                  }
                }}
              >
                {busyId === dialog.invoice.id ? '⏳ Memproses…' : 'Konfirmasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BUAT INVOICE */}
      <CreateInvoiceModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); fetchInvoices() }}
        onSaved={replaceItem}
        projects={effectiveProjects}
        existingInvoices={items}
        say={say}
      />

      <style>{`
        .si-root { padding: 0; }
        .si-intro { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:0 0 12px; }
        .si-intro-copy strong { display:block; font-size:15px; color:var(--text-main); font-weight:700; }
        .si-intro-copy span { display:block; margin-top:3px; font-size:12.5px; color:var(--text-muted); max-width:640px; line-height:1.5; }
        .si-header-actions { display:flex; align-items:center; gap:10px; }
        .si-btn-create {
          background: #4b523a; color: #fff; border: 1px solid #3d432e;
          border-radius: 6px; padding: 7px 14px; font-size: 12.5px; font-weight: 600;
          cursor: pointer; transition: all 0.15s;
        }
        .si-btn-create:hover { background: #3d432e; box-shadow: 0 2px 6px rgba(0,0,0,0.12); }

        .si-store-banner { border-radius: 8px; padding: 9px 13px; font-size: 12px; margin-bottom: 12px; line-height: 1.5; }
        .si-store-ok { background: #eef4ea; border: 1px solid #cfe0c4; color: #33502a; }
        .si-store-warn { background: #fef6e7; border: 1px solid #f0d9a8; color: #7a4a08; font-weight: 600; }
        .si-store-err { background: #fdecec; border: 1px solid #f3c2c2; color: #8a1f1f; font-weight: 600; }

        .si-alert { border-radius: 8px; padding: 9px 13px; font-size: 12.5px; margin-bottom: 12px; }
        .si-alert-err { background: #fde8e8; border: 1px solid #f5c6c6; color: #b71c1c; }
        .si-alert-ok { background: #eef4ea; border: 1px solid #cfe0c4; color: #33502a; }

        .si-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
        .si-kpi-card {
          background: var(--card-bg, #fff); border: 1px solid var(--border-light, #e0e2db);
          border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column;
        }
        .si-kpi-lbl { font-size: 11px; color: var(--text-muted, #666); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .si-kpi-val { font-size: 18px; color: var(--text-main, #222); font-weight: 800; margin: 4px 0 2px; }
        .si-kpi-sub { font-size: 11px; color: #888; }
        .si-c-warn { color: #d97706; }
        .si-c-ok { color: #16a34a; }

        .si-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
        .si-filter-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .si-tab-btn {
          background: #f4f5f1; border: 1px solid #dcdfd6; border-radius: 6px;
          padding: 5px 12px; font-size: 12px; color: #555; cursor: pointer;
        }
        .si-tab-btn.active { background: #4b523a; color: #fff; border-color: #4b523a; font-weight: 600; }
        .si-search-wrap input {
          border: 1px solid #cfd3c7; border-radius: 6px; padding: 6px 12px;
          font-size: 12px; width: 240px; outline: none; background: #fff;
        }
        .si-search-wrap input:focus { border-color: #4b523a; }

        .si-panel { background:var(--card-bg, #fff); border:1px solid var(--border-light, #e0e2db); border-radius:12px; overflow:hidden; }
        .si-panel-head { display:flex; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border-light, #e0e2db); background:#fcfdfb; font-size:12.5px; }
        /* Tabel compact: TIDAK ada scroller samping — tabel dibuat muat
           (lapisan compact-admin.module.css). Rincian tetap lengkap; di
           layar sempit baris berubah jadi blok berlabel. */
        .si-table-wrap { overflow: visible; max-width: 100%; }
        .si-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .si-table th { text-align:left; font-size:11px; text-transform:uppercase; color:var(--text-muted, #666); background:#f5f6f2; padding:10px 14px; border-bottom:1px solid #e0e2db; }
        .si-table td { padding:12px 14px; border-bottom:1px solid #f0f2eb; vertical-align:middle; }
        .si-table tr:hover td { background: #fafbf9; }
        .si-num { text-align:right; font-variant-numeric:tabular-nums; }
        .si-inv-num { font-size:13px; color:#2a3024; }
        .si-draft-num { font-size:11.5px; color:#8a8f84; font-style:italic; font-weight:600; }
        .si-due-txt { display:block; font-size:10.5px; color:#c2410c; margin-top:2px; }
        .si-subtxt { font-size:11px; color:#777; margin-top:2px; }
        .si-warn-txt { color:#b45309; font-weight:600; }
        .si-proj-code { background: #eef2ea; color: #3b4233; font-weight: 700; font-size: 11px; padding: 2px 5px; border-radius: 4px; margin-right: 4px; }
        .si-rab-pill { background: #fdfaf2; color: #b45309; border: 1px solid #fed7aa; font-size: 11px; padding: 2px 7px; border-radius: 999px; font-weight: 600; }

        .si-badge { display:inline-block; font-size:10.5px; font-weight:700; border-radius:999px; padding:3px 8px; }
        .si-badge-draft { background:#f0f1ea; color:#4b523a; border:1px solid #d5d9ce; }
        .si-badge-issued { background:#e0edff; color:#1d4ed8; border:1px solid #bfdbfe; }
        .si-badge-sent { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
        .si-badge-approved { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
        .si-badge-paid { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; font-weight:800; }
        .si-badge-rejected { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
        .si-badge-void { background:#f3f4f6; color:#9ca3af; text-decoration:line-through; }
        .si-badge-muted { background:#f3f4f6; color:#6b7280; }

        .si-row-actions { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
        .si-act-btn { border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: all 0.15s; }
        .si-act-pdf { background: #fdf6e7; color: #b45309; border-color: #fed7aa; }
        .si-act-pdf:hover { background: #fef08a; color: #854d0e; }
        .si-act-issue { background: #e0edff; color: #1d4ed8; border-color: #bfdbfe; }
        .si-act-issue:hover { background: #dbeafe; }
        .si-act-pay { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
        .si-act-pay:hover { background: #dcfce7; }
        .si-act-send { background: #f0f9ff; color: #0369a1; border-color: #bae6fd; }
        .si-act-send:hover { background: #e0f2fe; }
        .si-act-void { background: #fdf2f2; color: #b91c1c; border-color: #fecaca; }
        .si-act-void:hover { background: #fee2e2; }
        .si-act-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .si-empty { padding: 48px 20px; text-align: center; }
        .si-empty-icon { font-size: 36px; margin-bottom: 8px; }
        .si-empty strong { display: block; font-size: 15px; color: #333; margin-bottom: 6px; }
        .si-empty p { font-size: 12.5px; color: #666; max-width: 520px; margin: 0 auto 16px; line-height: 1.5; }
        .si-empty-note { margin: 14px auto 0; font-size: 11.5px; color: #6b6f66; background: #f7f8f5; border: 1px dashed #d5d9ce; border-radius: 8px; padding: 8px 12px; max-width: 560px; }
        .si-empty-action { margin-top: 14px; }

        .si-modal-overlay {
          position: fixed; inset: 0; background: rgba(20, 24, 20, 0.6);
          display: flex; align-items: center; justify-content: center;
          z-index: 1200; padding: 16px;
        }
        .si-dialog-card {
          background: #fff; border-radius: 12px; padding: 20px 22px; width: 100%;
          max-width: 420px; box-shadow: 0 12px 32px rgba(0,0,0,0.25);
          border: 1px solid #dcded8;
        }
        .si-dialog-card h4 { margin: 0 0 6px; font-size: 15px; color: #232720; }
        .si-dialog-sub { font-size: 12px; color: #6b6f66; margin: 0 0 14px; line-height: 1.5; }
        .si-field { margin-bottom: 12px; }
        .si-field label { display: block; font-size: 11.5px; font-weight: 600; color: #4b523a; margin-bottom: 5px; }
        .si-field input, .si-field select {
          width: 100%; border: 1px solid #cfd3c7; border-radius: 6px;
          padding: 7px 10px; font-size: 12.5px; background: #fff; font-family: inherit;
        }
        .si-field small { display: block; font-size: 11px; color: #7a7e75; margin-top: 4px; }
        .si-dialog-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
        .si-btn-cancel { background: #fff; border: 1px solid #cfd3c7; color: #555; padding: 7px 14px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
        .si-btn-submit { background: #4b523a; border: 1px solid #3d432e; color: #fff; padding: 7px 18px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .si-btn-danger { background: #b91c1c; border: 1px solid #991b1b; color: #fff; padding: 7px 18px; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .si-btn-submit:disabled, .si-btn-danger:disabled, .si-btn-cancel:disabled { opacity: 0.55; cursor: not-allowed; }
      `}</style>
    </CompactRoot>
  )
}
