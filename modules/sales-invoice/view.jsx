// ============================================================
// modules/sales-invoice/view.jsx — MODUL INVOICE PENJUALAN (Sales Invoice)
// ============================================================
// Tahap awal (t_ff3a96cf — arahan DAT: "Kamu buka dulu modulnya, nanti
// terminnya menyusul ya."): SHELL modul + daftar/empty state. Halaman
// admin-only source:'core' (dirender pages/index.js), pola sama dengan
// RAB & BOQ (t_18564dce).
//
// APA YANG SUDAH ADA:
//   - Judul halaman, intro, badge status fase.
//   - Daftar invoice dari data yang ADA (bila suatu saat tabel datanya
//     tersedia via props). Saat ini BELUM ada tabel DB invoice penjualan
//     -> halaman menampilkan EMPTY STATE jujur, bukan data demo.
//   - Kerangka kolom detail yang disepakati (customer CRM, RAB final/
//     disetujui, nominal, status dokumen) — hanya bila datanya ada.
//
// APA YANG SENGAJA BELUM ADA (menunggu keputusan DAT — jangan ditambahkan
// tanpa arahan):
//   - TOMBOL "Buat Invoice Baru": trigger draft vs invoice resmi BELUM
//     diputuskan. Tanpa tombol = tidak ada jalur input palsu.
//   - TERMIN: angka persen/jadwal termin BELUM diimplementasikan
//     ("terminnya menyusul").
//   - NOMOR DOKUMEN: tidak ada penomoran otomatis / nomor proyek dari BOQ
//     untuk alur baru; existing project tidak disentuh.
//   - SIMPAN: tidak ada tombol simpan, tidak ada insert/update, tidak ada
//     localStorage-as-db. Persistence menunggu fase database (lihat
//     README modul untuk catatan kebutuhan persistence).
// ============================================================
import React from 'react'

// Kolom kerangka detail invoice yang disepakati bisnis:
// CRM (identitas customer) -> RAB final/disetujui customer -> Invoice ->
// penerbitan nomor Master Project. Semua kolom read-only dari data.
export const INVOICE_COLUMNS = [
  { key: 'invoice_no', label: 'No. Invoice' },
  { key: 'customer_name', label: 'Customer (CRM)' },
  { key: 'rab_reff', label: 'RAB Final / Disetujui' },
  { key: 'nominal', label: 'Nominal' },
  { key: 'status', label: 'Status Dokumen' }
]

// Badge status dokumen — hanya menampilkan status yang dikenal; nilai lain
// ditampilkan apa adanya (tidak menebak).
export function invoiceStatusBadge(status) {
  const s = String(status || '').trim()
  if (!s) return { label: '—', tone: 'muted' }
  const known = {
    DRAFT: 'draft',
    TERKIRIM: 'sent',
    DISETUJUI: 'approved',
    DITOLAK: 'rejected',
    LUNAS: 'paid',
    BATAL: 'void'
  }
  const tone = known[String(s).toUpperCase()]
  return { label: s, tone: tone || 'muted' }
}

export function formatNominal(v) {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !isFinite(n)) return '—'
  return `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`
}

const scopedCss = `
.si-root { padding: 0; }
.si-intro { display:flex; align-items:flex-start; gap:12px; flex-wrap:wrap; margin:0 0 18px; }
.si-intro-copy { flex:1; min-width:240px; }
.si-intro-copy strong { display:block; font-size:14px; color:var(--text-main); }
.si-intro-copy span { display:block; margin-top:3px; font-size:12.5px; color:var(--text-muted); max-width:640px; line-height:1.55; }
.si-badge-fase { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:#4b523a; background:#f0f1ea; border:1px solid #d5d9ce; border-radius:999px; padding:5px 11px; white-space:nowrap; }
.si-panel { background:var(--card-bg); border:1px solid var(--border-light); border-radius:12px; padding:0; overflow:hidden; box-shadow:0 1px 2px rgba(32,37,31,.04); }
.si-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:14px 18px; border-bottom:1px solid var(--border-light); background:var(--ivory-2); }
.si-panel-head strong { font-size:13.5px; color:var(--text-main); }
.si-panel-head span { font-size:11.5px; color:var(--text-muted); }
.si-table { width:100%; border-collapse:collapse; font-size:13px; }
.si-table th { text-align:left; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); background:var(--olive-50); padding:10px 18px; border-bottom:1px solid var(--border-subtle); white-space:nowrap; }
.si-table td { padding:12px 18px; border-bottom:1px solid var(--border-light); color:var(--text-main); vertical-align:top; }
.si-table tr:last-child td { border-bottom:none; }
.si-table td.si-num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.si-badge { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.03em; border-radius:999px; padding:3px 9px; border:1px solid transparent; white-space:nowrap; }
.si-badge-draft { background:#f0f1ea; color:#4b523a; border-color:#d5d9ce; }
.si-badge-sent { background:#fdf5e8; color:#945719; border-color:#f0dcb4; }
.si-badge-approved { background:#e7f2ec; color:#1b6348; border-color:#bfdccd; }
.si-badge-paid { background:#e7f2ec; color:#1b6348; border-color:#bfdccd; }
.si-badge-rejected { background:#fdeeee; color:#8c2f2f; border-color:#f0c9c9; }
.si-badge-void { background:#f4f4f2; color:#6b6f66; border-color:#dcded8; text-decoration:line-through; }
.si-badge-muted { background:#f4f4f2; color:#6b6f66; border-color:#dcded8; }
.si-empty { padding:44px 18px 48px; text-align:center; }
.si-empty-icon { font-size:30px; line-height:1; margin-bottom:10px; }
.si-empty strong { display:block; font-size:14.5px; color:var(--text-main); margin-bottom:6px; }
.si-empty p { margin:0 auto; font-size:12.5px; color:var(--text-muted); max-width:520px; line-height:1.6; }
.si-empty-note { margin:14px auto 0; font-size:11.5px; color:var(--text-muted); background:var(--ivory-2); border:1px dashed var(--border-subtle); border-radius:8px; padding:8px 12px; max-width:560px; }
.si-empty-note b { color:#4b523a; }
.si-notebar { margin:14px 2px 0; font-size:12px; color:var(--text-muted); line-height:1.6; }
.si-notebar b { color:#4b523a; }
@media (max-width: 720px) {
  .si-panel-head, .si-intro { padding-left:0; }
  .si-table th, .si-table td { padding-left:12px; padding-right:12px; }
}
`

export default function SalesInvoiceModule({ invoices = null }) {
  // `invoices` HARUS datang dari pemilik data (props dari pages/index.js /
  // tabel DB kelak). Modul ini TIDAK pernah membaca localStorage/seed demo:
  // undefined/null/array kosong = memang belum ada data -> empty state.
  const list = Array.isArray(invoices) ? invoices : []
  const hasData = list.length > 0

  return (
    <div className="si-root" data-testid="sales-invoice-root">
      <style>{scopedCss}</style>

      <div className="si-intro">
        <div className="si-intro-copy">
          <strong>Invoice Penjualan</strong>
          <span>
            Alur bisnis: CRM (identitas customer) &rarr; RAB final yang disetujui
            customer &rarr; Invoice &rarr; penerbitan nomor Master Project. Modul ini
            baru membuka halaman &amp; kerangka daftar; pengaturan penagihan/termin
            menyusul setelah arahan DAT.
          </span>
        </div>
        <span className="si-badge-fase">Tahap pembukaan modul</span>
      </div>

      <div className="si-panel">
        <div className="si-panel-head">
          <strong>Daftar Invoice Penjualan</strong>
          <span>{hasData ? `${list.length} invoice` : 'belum ada data'}</span>
        </div>
        {hasData ? (
          <table className="si-table">
            <thead>
              <tr>
                {INVOICE_COLUMNS.map(c => (
                  <th key={c.key} className={c.key === 'nominal' ? 'si-num' : ''}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((inv, i) => {
                const badge = invoiceStatusBadge(inv.status)
                return (
                  <tr key={inv.id || i}>
                    <td>{inv.invoice_no || '—'}</td>
                    <td>{inv.customer_name || '—'}</td>
                    <td>{inv.rab_reff || '—'}</td>
                    <td className="si-num">{formatNominal(inv.nominal)}</td>
                    <td>
                      <span className={'si-badge si-badge-' + badge.tone}>{badge.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="si-empty" data-testid="si-empty">
            <div className="si-empty-icon" aria-hidden="true">🧾</div>
            <strong>Belum ada invoice penjualan</strong>
            <p>
              Pengaturan penagihan/termin akan ditambahkan berikutnya.
              Modul ini belum terhubung ke tabel data, jadi tidak ada
              daftar invoice yang bisa ditampilkan di sini.
            </p>
            <div className="si-empty-note">
              <b>Menunggu keputusan DAT:</b> trigger draft vs invoice resmi belum
              diputuskan, dan jadwal/termin penagihan menyusul. Setelah disepakati,
              daftar ini akan diisi dari data invoice yang tersimpan.
            </div>
          </div>
        )}
      </div>

      <p className="si-notebar">
        <b>Status implementasi:</b> kerangka halaman &amp; navigasi aktif —
        penyimpanan, penomoran dokumen, dan termin <b>belum</b> diimplementasikan
        (menunggu arahan). Tidak ada tombol simpan pada tahap ini.
      </p>
    </div>
  )
}
