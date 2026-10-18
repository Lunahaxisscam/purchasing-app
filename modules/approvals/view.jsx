// ============================================================
// modules/approvals/view.jsx — Approval
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Approval diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, rupiah } from '../../lib/constants'
// Total Estimasi PR (t_ac0b39c0): snapshot harga tersimpan pr_items —
// read-only di Approval (detail persetujuan), resolver/list jujur sumbernya.
import { prEstimateRows } from '../requests/view'
// Drawer detail approval (t_ff02257a S1): dibuka dari daftar compact, dirender
// PORTAL document.body oleh renderModuleModal (bukan di dalam tbody).
import { approvalDetail } from './detailDrawer'
// t_48f6b336 (arahan DAT): pengelompokan item per kategori master material
// (via material_id — bukan vendor, bukan tebakan nama). Helper yang sama
// dipakai modul PR; sumber kategori & urutan konsisten.
import { groupItemsByCategory, groupHeadingText, materialMapFrom, attachMaterialIds } from '../requests/view'

// ============================================================
// CATATAN APPROVAL — aturan render (t_1fe52e80)
// ============================================================
// Kolom/note card "Catatan" HANYA berisi catatan yang benar-benar diketik
// pengguna. Approval baru dibuat TANPA note (null) — teks "Menunggu
// persetujuan..." tidak pernah disemai lagi (pages/index.js finishPr sudah
// berhenti menyemai). Untuk data lama yang pernah disemai otomatis oleh
// versi aplikasi sebelumnya, teks tsb digantikan dash "—" saat render
// (TIDAK ada mutasi DB). Deteksi legacy dilakukan dua lapis agar catatan
// pengguna yang KEBETULAN mengandung frasa yang sama tidak pernah
// disembunyikan:
//   1) TEKS: harus sama persis dengan satu pola auto-generate yang dikenal
//      (setelah trim). Pola dijaga ketat — menambah pola baru di sini hanya
//      jika pola itu memang lahir dari kode auto-generate.
//   2) METADATA: baris approval harus berasal dari jalur auto-seed, yaitu
//      step pertama yang dibuat finishPr (step_number === 1) dan BELUM
//      diputuskan (decided_at kosong). Catatan keputusan (selalu punya
//      decided_at) tidak pernah memenuhi syarat, apa pun teksnya.
// Keterbatasan (didokumentasikan, tidak ada cleanup palsu): bila pengguna
// lama sengaja mengetik teks yang 100% identik dengan pola auto pada step-1
// yang masih pending, teksnya ikut tampil sebagai dash — kasus ini tidak
// bisa dibedakan dari luar tanpa kolom provenance di DB (tidak ada migrasi).
// ============================================================

// Pola teks auto-generate yang pernah dipakai aplikasi saat membuat/
// mengaktifkan approval step (exact match setelah trim). SATU-SATUNYA sumber
// pola: template literal di finishPr() pages/index.js sebelum t_1fe52e80.
const LEGACY_AUTO_NOTE_PATTERNS = [
  /^Menunggu persetujuan Direksi \/ PM untuk .*$/ // `Menunggu persetujuan Direksi / PM untuk ${pr.pr_number || 'PR'}`
]

// True bila note adalah sisa auto-seed legacy yang aman diganti dash.
export function isLegacyAutoNote(r) {
  const note = typeof r?.note === 'string' ? r.note.trim() : null
  if (!note) return false
  // Lapis 2 (metadata): hanya step-1 yang belum diputuskan yang pernah
  // di-seed otomatis. Catatan keputusan tidak pernah lolos gerbang ini.
  if (r.step_number !== 1 || r.decided_at) return false
  // Lapis 1 (teks): exact match ke pola yang dikenal.
  return LEGACY_AUTO_NOTE_PATTERNS.some(re => re.test(note))
}

// Teks catatan siap render: null/'' -> null (dash oleh format()),
// sisa auto-seed legacy -> null, catatan pengguna -> utuh apa adanya.
export function displayNote(r) {
  if (isLegacyAutoNote(r)) return null
  const note = r?.note
  if (note === null || note === undefined || note === '') return null
  return note
}

// ============================================================
// BARIS ITEM APPROVAL + PENGELOMPOKAN (t_48f6b336 — arahan DAT)
// ============================================================
// approvalItemRows (itemHelpers) mengembalikan { text, qty } — kolom Items
// & QTY terpisah melenceng saat teks wrap. Arahan DAT: SATU baris per item
// berisi nama + qty + subtotal SEJAJAR (row-per-child), dikelompokkan per
// kategori master material via material_id. Fallback legacy (ringkasan teks
// PR lama) tetap didukung — tanpa material_id → grup "Belum Berkategori".
// Murni TAMPILAN: tidak ada perubahan data tersimpan/DB/master.
function approvalItemRowsFull(H, approval) {
  const rows = H.approvalItemRows(approval).map(row => ({ ...row }))
  // Zip 1:1 dengan pr_items mentah (urutan sama — helper shared memetakan
  // langsung) untuk material_id → kategori master. Legacy (tanpa pr_items)
  // panjang beda → tidak ditempel (masuk Belum Berkategori, jujur).
  return attachMaterialIds(rows, H.approvalItems(approval))
}

// --- Filter tabs ---
// Urutan tab (arahan DAT t_0a35264f): antrean "⏳ Menunggu" SELALU di posisi
// pertama dan aktif secara default (state awal approvalFilter='PENDING' di
// ModuleView.js). Riwayat tetap bisa dibuka eksplisit lewat tab-nya; data
// tidak pernah dihapus. "Semua" dipindah ke akhir karena bukan antrean kerja.
export function filters(ctx) {
  const { rows, approvalFilter, setApprovalFilter } = ctx
  return (
    <div className="filter-tabs">
      <button
        type="button"
        className={`pill ${approvalFilter === 'PENDING' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('PENDING')}
        style={rows.some(r => r.status === 'PENDING') ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
      >
        ⏳ Menunggu ({rows.filter(r => r.status === 'PENDING').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'APPROVED' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('APPROVED')}
      >
        ✓ Disetujui ({rows.filter(r => r.status === 'APPROVED').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'REVISI' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('REVISI')}
      >
        ✎ Revisi ({rows.filter(r => r.status === 'REVISI').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'REJECTED' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('REJECTED')}
      >
        ✕ Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
      </button>
      <button
        type="button"
        className={`pill ${approvalFilter === 'all' ? 'active' : ''}`}
        onClick={() => setApprovalFilter('all')}
      >
        Semua ({rows.length})
      </button>
    </div>
  )
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H } = ctx
  const { approvalItemLines, approvalItemQtys } = H

  if (h === 'items') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>
            • {line}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'items_qty') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {approvalItemQtys(r).length ? approvalItemQtys(r).map((q, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, fontWeight: 600 }}>
            {q}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  // Kolom Catatan (t_1fe52e80): hanya catatan pengguna; sisa auto-seed legacy
  // tampil dash. Null/'' dirender dash via format() — konsisten dgn modul lain.
  if (h === 'note') {
    const note = displayNote(r)
    return (
      <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
        {format(note)}
      </div>
    )
  }
  return null
}

// --- Baris desktop khusus: master-detail item approval (rowSpan) ---
// t_48f6b336 (arahan DAT): setiap item = SATU baris fisik berisi Nama + Qty +
// Subtotal sejajar (tidak lagi kolom Items vs QTY terpisah yang melenceng
// saat wrap), dikelompokkan per kategori master material (via material_id).
// Judul kategori tampil sekali sebagai baris pemisah grup di area item.
// Material tanpa relasi → "Belum Berkategori" (jujur). Kolom parent (No. PR,
// Project, Judul, Step, Status, Catatan, Waktu, Aksi) tetap satu dokumen —
// rowSpan mencakup semua baris grup + baris Total Estimasi.
// Murni tampilan: tidak ada perubahan alur approval, nomor, status, atau data.
// ============================================================
// COMPACT (t_ff02257a S1 — arahan DAT): dengan kolom compact
// (pr_number/project_name/title/step_number/status — lib/constants.js
// headersFor), desktopRow efektif SATU BARIS per PR:
//   No. PR | Project | Judul | Step | Status | Total Estimasi |
//   Diputuskan | Rincian | Aksi.
// Rincian item & catatan tolak/revisi TIDAK di tabel — dibuka lewat drawer
// (portal document.body) via tombol "≡ Rincian". Bila shell lama memakai
// kolom 9-kolom penuh (tanpa compact), area item tetap dirender
// master-detail seperti semula — jalur lama utuh, tidak ada regresi.
// ============================================================
export function desktopRow(r, ctx) {
  const { H, columns, allMaterials, approvalDetailId, setApprovalDetailId } = ctx
  const compactMode = !!columns && !columns.includes('items')
  const rows = approvalItemRowsFull(H, r)
  const groups = rows.length
    ? groupItemsByCategory(rows, materialMapFrom(allMaterials))
    : []
  // approvals = 9 kolom + Aksi = 10; parent (No.PR/Project/Judul) = 3,
  // ekor (Step/Status/Catatan/Waktu/Aksi) = 5 → area item = nCols - 8.
  const nCols = columns.length + 1
  const itemAreaSpan = nCols - 8
  // CATATAN: baris perluasan material TIDAK dirender di sini — shell
  // ModuleView merendernya via renderModuleRowExpand(setelah customRow).
  // Merendernya dua kali = panel dobel.
  // ------------------------------------------------------------
  // JALUR COMPACT (t_ff02257a): daftar ringkas SATU BARIS per PR —
  // rincian item & catatan keputusan dibuka lewat drawer (portal body).
  // Total Estimasi langsung di baris (snapshot pr_items, label jujur
  // "belum lengkap" bila ada item tanpa harga — BUKAN klaim lengkap).
  // ------------------------------------------------------------
  if (compactMode) {
    const est = prEstimateRows(H.approvalItems(r))
    const open = approvalDetailId === r.id
    return [(
      <tr key="ap-compact" className="pr-compact-row">
        <td><b>{format(r.pr_number)}</b></td>
        <td>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(r.project_name || '')}>
            {format(r.project_name)}
          </div>
        </td>
        <td><div title={String(r.title || '')}>{format(r.title)}</div></td>
        <td>{format(r.step_number)}</td>
        <td><span className={`badge status-${r.status}`}>{r.status}</span></td>
        <td>
          {/* Total Estimasi snapshot (sumber & label jujur = t_ac0b39c0):
              tanpa item → dash; item tanpa harga → "(belum lengkap)" */}
          {est.hasItems
            ? (
              <>
                <b style={{ color: est.complete ? '#137333' : '#b45309' }}>{rupiah(est.total)}</b>
                {!est.complete && <span style={{ color: '#b45309', display: 'block', fontSize: '11px' }}>{`belum lengkap — ${est.unknown} item belum ada harga`}</span>}
              </>
              )
            : <span className="muted">—</span>}
        </td>
        <td>{format(r.decided_at)}</td>
        <td>
          {/* Jangkar drawer: BUKAN perluasan tbody (izin explicit DAT);
              baris detail = portal document.body. SELALU dirender bila
              callback drawer tersedia — drawer menangani baris tanpa item
              ("Rincian per barang belum tersimpan") & catatan keputusan. */}
          {setApprovalDetailId && (
            <button
              type="button"
              onClick={() => setApprovalDetailId(open ? null : r.id)}
              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: open ? '#137333' : '#1f3a34', whiteSpace: 'nowrap' }}
            >
              {open ? '▲ Tutup' : `≡ Rincian`}
            </button>
          )}
        </td>
        {rowActions(r, ctx)}
      </tr>
    )]
  }
  if (!rows.length) {
    // Legacy tanpa rincian: satu baris dash saja (perilaku lama dipertahankan).
    return [(
      <tr key="ap-none">
        <td>{format(r.pr_number)}</td>
        <td>{format(r.project_name)}</td>
        <td>{format(r.title)}</td>
        <td colSpan={itemAreaSpan} style={{ color: '#9aa8a4' }}>—</td>
        <td style={{ textAlign: 'center' }}>{format(r.step_number)}</td>
        <td>{format(r.status)}</td>
        <td>{format(displayNote(r))}</td>
        <td>{format(r.decided_at)}</td>
        {rowActions(r, ctx)}
      </tr>
    )]
  }
  // ============================================================
  // Total Estimasi (t_ac0b39c0): SNAPSHOT pr_items tersimpan — read-only,
  // TIDAK berubah karena pengelompokan; item tanpa harga ≠ 0.
  // Verifikasi geometri run 93: label colSpan = itemAreaSpan-1 (kolom Item
  // SAJA) dan nilai di kolom Qty — parent (Step/Status/Catatan/Waktu/Aksi)
  // sudah menutup kolom 5..9 via rowSpan, jadi label colSpan penuh
  // (itemAreaSpan) mendorong nilai keluar grid (kolom hantu ke-11) dan
  // versi lama (itemAreaSpan+2 + filler 2) menciptakan 2 kolom hantu lagi.
  // Grid baris total: 3 parent + 1 label + 1 nilai + 5 parent = 10 ✓.
  // ============================================================
  const est = prEstimateRows(H.approvalItems(r))
  const totalRow = [(
    <tr key="ap-est-total" className="pr-est-total-row">
      <td colSpan={itemAreaSpan - 1} style={{ textAlign: 'right', fontWeight: 700, color: '#1f3a34', borderTop: '2px solid #1f3a34', background: '#fbfdfc' }}>
        Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
      </td>
      <td className="pr-item-qty" style={{ fontWeight: 700, color: est.complete ? '#137333' : '#b45309', borderTop: '2px solid #1f3a34', background: '#fbfdfc', whiteSpace: 'nowrap' }}>
        {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
      </td>
    </tr>
  )]
  // Susun baris fisik: heading kategori (pemisah grup) + item. Nama & Qty
  // berada di baris fisik yang sama — tidak ada lagi pasangan kolom terpisah
  // yang melenceng saat teks wrap.
  const bodyRows = []
  for (const g of groups) {
    bodyRows.push({ kind: 'heading', heading: g.heading })
    for (const it of g.items) bodyRows.push({ kind: 'item', it })
  }
  const estRowSpan = bodyRows.length + 1 // + baris total (selalu ada bila ada item)
  const parentTds = first => first ? (
    <>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}><b>{format(r.pr_number)}</b></td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(r.project_name || '')}>
          {format(r.project_name)}
        </div>
      </td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div title={String(r.title || '')}>{format(r.title)}</div>
      </td>
    </>
  ) : null
  // Kolom Aksi ikut rowSpan (verifikasi geometri run 93): tanpa rowSpan, kolom
  // Aksi hanya menutup baris pertama → baris item berlubang di grid & baris
  // Total Estimasi salah tempat. opts.rowSpan hanya dipakai jalur grouped;
  // jalur legacy (satu baris) tetap tanpa rowSpan.
  const endTds = first => first ? (
    <>
      <td rowSpan={estRowSpan} style={{ textAlign: 'center', verticalAlign: 'top' }}>{format(r.step_number)}</td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>{format(r.status)}</td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
          {format(displayNote(r))}
        </div>
      </td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>{format(r.decided_at)}</td>
      {rowActions(r, ctx, { rowSpan: estRowSpan, valign: 'top' })}
    </>
  ) : null
  return bodyRows.map((row, idx) => {
    const first = idx === 0
    if (row.kind === 'heading') {
      return (
        <tr key={`ap-grp-${idx}`} className="pr-group-row">
          {parentTds(first)}
          <td colSpan={itemAreaSpan} className="pr-group-cell">
            <span className="pr-group-label">{groupHeadingText(row.heading)}</span>
          </td>
          {endTds(first)}
        </tr>
      )
    }
    const it = row.it
    return (
      <tr key={`ap-item-${idx}`} className="pr-item-row">
        {parentTds(first)}
        <td className="ap-item-name">{it.text}</td>
        <td className="pr-item-qty"><b>{it.qty}</b></td>
        {endTds(first)}
      </tr>
    )
  }).concat(totalRow)
}

// --- Aksi per baris (desktop): Setujui / Tolak / Revisi + perluasan material ---
// Standar Noir Living (review Brooklyn #B.3): kolom aksi tabel VERTIKAL —
// tombol tersusun ke bawah dengan lebar seragam supaya tidak melompat
// berantakan saat kolom menyempit di layar sempit.
// t_48f6b336 run 93 (verifikasi geometri): opts.rowSpan dipakai jalur
// master-detail grouped (kolom Aksi ikut rowSpan parent — tanpa itu kolom
// Aksi hanya menutup baris pertama & baris item berlubang di grid). Tanpa
// opts (jalur legacy / baris tunggal) perilaku lama dipertahankan.
export function rowActions(r, ctx, opts) {
  const { H, expandedApproval, setExpandedApproval, approvalDetailId, setApprovalDetailId, onDecideApproval, onReviseApproval } = ctx
  const { approvalItemLines } = H
  const span = opts && opts.rowSpan ? opts.rowSpan : undefined
  const valign = opts && opts.valign ? opts.valign : undefined
  // Jangkar drawer detail (t_ff02257a S1): BUKAN perluasan tbody. Bila baris
  // sudah terbuka di drawer → teks "▲ Tutup" + highlight (state jelas).
  // SELALU dirender bila callback drawer tersedia — drawer menangani baris
  // tanpa item ("Rincian per barang belum tersimpan") & catatan keputusan.
  const detailBtn = (compact) => {
    if (!setApprovalDetailId) return null
    const open = approvalDetailId === r.id
    return (
      <button
        type="button"
        onClick={() => setApprovalDetailId(open ? null : r.id)}
        style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: compact ? '3px 8px' : '4px 8px', fontSize: compact ? '10px' : '11px', cursor: 'pointer', fontWeight: 600, color: open ? '#137333' : '#1f3a34', width: '100%' }}
      >
        {open ? '▲ Tutup' : `≡ Rincian (${approvalItemLines(r).length})`}
      </button>
    )
  }
  return (
    <td rowSpan={span} style={{ textAlign: 'center', verticalAlign: valign }}>
      {r.status === 'PENDING' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', width: '110px', margin: '0 auto' }}>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'APPROVED')}
            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✓ Setujui
          </button>
          <button
            type="button"
            onClick={() => onDecideApproval(r, 'REJECTED')}
            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✕ Tolak
          </button>
          <button
            type="button"
            onClick={() => onReviseApproval(r)}
            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, width: '100%' }}
          >
            ✎ Revisi
          </button>
          {detailBtn(true)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
          <span className={`badge status-${r.status}`}>{r.status}</span>
          {detailBtn(false)}
        </div>
      )}
    </td>
  )
}

// --- Grup item approval utk panel perluasan ---
// Kelompokkan pr_items mentah per kategori master material (material_id).
// Subtotal kategori HANYA dari harga snapshot valid per item (estimated_price
// × qty — sumber sama dgn Total Estimasi t_ac0b39c0); item tanpa harga
// di-skip (bukan dianggap 0). Bukan penjumlahan qty satuan berbeda.
function approvalGroups(r, H, ctx) {
  const rawItems = H.approvalItems(r)
  const groups = groupItemsByCategory(rawItems, materialMapFrom(ctx.allMaterials))
  for (const g of groups) {
    let subtotal = null
    for (const it of g.items) {
      const price = savedPriceOf(it)
      const q = Number(it.quantity)
      if (price === null || !isFinite(q) || q <= 0) continue
      subtotal = (subtotal || 0) + Math.round(q * price)
    }
    g.estSubtotal = subtotal
  }
  return groups
}

// Harga snapshot pr_items (sumber sama dgn prEstimateRows t_ac0b39c0):
// nonnegative finite → integer rupiah; selain itu null (bukan 0 palsu).
// Diekspor: detailDrawer memakai fungsi yang SAMA (t_ff02257a).
export function savedPriceOf(it) {
  const raw = (it.estimated_price !== null && it.estimated_price !== undefined && it.estimated_price !== '')
    ? Number(it.estimated_price) : null
  return raw !== null && isFinite(raw) && raw >= 0 ? Math.round(raw) : null
}

// Satu <tr> item di tabel perluasan (markup & perilaku persis versi lama —
// dipindah ke helper agar bisa dipakai ulang per grup kategori).
function approvalItemTr(it, itemState, { r, onApproveItem, onMarkPrItemOrdered }) {
  const st = itemState(it)
  const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
  const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
  const price = savedPriceOf(it)
  const qNum = Number(it.quantity)
  const subtotal = (price !== null && isFinite(qNum) && qNum > 0) ? Math.round(qNum * price) : null
  return (
    <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
      <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
      <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
      <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
      <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
      <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {/* Subtotal per item (snapshot): harga satuan × qty */}
        {subtotal !== null
          ? <>
              <span className="muted" style={{ fontSize: '10px' }}>{rupiah(price)}</span>
              <div style={{ fontWeight: 700, color: '#137333' }}>{rupiah(subtotal)}</div>
            </>
          : <span className="muted">—</span>}
      </td>
      <td style={{ padding: '4px 6px' }}>
        <span className={`badge ${st === 'ORDERED' ? 'status-APPROVED' : (st === 'APPROVED' ? 'badge-item-approved' : 'status-PENDING')}`} style={{ fontSize: '10px' }}>
          {st === 'ORDERED' ? '✓ Sudah Order' : (st === 'APPROVED' ? '✓ Disetujui' : '⏳ Menunggu')}
        </span>
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
        {st === 'ORDERED' ? (
          <span style={{ fontSize: '10px', color: '#137333' }}>→ ke Purchase</span>
        ) : canOrder ? (
          <button
            type="button"
            onClick={() => onMarkPrItemOrdered(it)}
            style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            🛒 Sudah Order
          </button>
        ) : canApprove ? (
          <button
            type="button"
            onClick={() => onApproveItem(it)}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            ✓ Setujui
          </button>
        ) : st === 'APPROVED' ? (
          <span style={{ fontSize: '10px', color: '#b45309', whiteSpace: 'nowrap' }}>⏳ Menunggu PR disetujui</span>
        ) : (
          <span style={{ fontSize: '10px', color: '#71817d' }}>—</span>
        )}
      </td>
    </tr>
  )
}

// --- Baris perluasan: setujui material per barang ---
// t_48f6b336: item panel perluasan dikelompokkan per kategori master material
// (material_id × allMaterials) — konsisten dgn daftar PR & desktop Approval.
export function rowExpand(r, ctx) {
  const { H, columns, expandedApproval, onApproveItem, onMarkPrItemOrdered, allMaterials } = ctx
  const { approvalItems, approvalItemLines, itemState } = H
  if (!(expandedApproval === r.id)) return null
  // ============================================================
  // Total Estimasi (t_ac0b39c0): harga SNAPSHOT pr_items yang tersimpan —
  // read-only, TIDAK dihitung ulang dari histori terbaru saat dibuka ulang.
  // Item tanpa harga ≠ 0 → label "belum lengkap".
  // ============================================================
  const est = prEstimateRows(approvalItems(r))
  return (
    <tr>
      <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#1f3a34' }}>
          📋 Material — setujui per barang{r.status === 'APPROVED' ? ', lalu tandai yang sudah dipesan ke supplier' : ''}
        </div>
        {approvalItems(r).length === 0 ? (
          <div>
            {approvalItemLines(r).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                {approvalItemLines(r).map((line, i) => (
                  <span key={i} style={{ fontSize: '11px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>• {line}</span>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: '11px', margin: 0 }}>
              Rincian per barang belum tersimpan untuk PR lama ini — gunakan tombol ✓ Setujui untuk menyetujui seluruh PR.
            </p>
          </div>
        ) : (
          <div>
            {/* t_48f6b336: item dikelompokkan per kategori master material
                (material_id) — sama dgn daftar PR. Heading grup tampil sekali;
                subtotal kategori hanya bila SEMUA item grup punya harga
                snapshot valid (tidak mencampur qty satuan berbeda). */}
            {approvalGroups(r, H, ctx).map((g, gi) => (
              <div key={gi} className="ap-group-block">
                <div className="ap-group-heading">
                  <span>{groupHeadingText(g.heading)}</span>
                  {g.estSubtotal !== null && g.estSubtotal !== undefined && (
                    <span style={{ fontWeight: 600, color: '#137333' }}>Subtotal: {rupiah(g.estSubtotal)}</span>
                  )}
                </div>
                <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginBottom: '8px' }}>
                  <thead>
                    <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                      <th style={{ padding: '4px 6px', width: '90px' }}>Kode</th>
                      <th style={{ padding: '4px 6px' }}>Nama Item</th>
                      <th style={{ padding: '4px 6px', width: '70px' }}>Qty</th>
                      <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                      <th style={{ padding: '4px 6px', width: '110px', textAlign: 'right' }}>Subtotal</th>
                      <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                      <th style={{ padding: '4px 6px', width: '150px', textAlign: 'center' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map(it => approvalItemTr(it, itemState, { r, onApproveItem, onMarkPrItemOrdered }))}
                  </tbody>
                </table>
              </div>
            ))}
            {/* Total Estimasi PR — snapshot tersimpan, read-only. TIDAK
                berubah karena pengelompokan (bukan jumlah subtotal grup yang
                di-skip — dihitung dari seluruh item seperti sebelumnya). */}
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr className="pr-est-total-row">
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, color: '#1f3a34', borderTop: '2px solid #1f3a34', background: '#fbfdfc' }}>
                    Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
                  </td>
                  <td style={{ fontWeight: 700, color: est.complete ? '#137333' : '#b45309', borderTop: '2px solid #1f3a34', background: '#fbfdfc', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
                  </td>
                  <td colSpan={2} style={{ borderTop: '2px solid #1f3a34', background: '#fbfdfc' }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { H, onDecideApproval, onReviseApproval, allMaterials, approvalDetailId, setApprovalDetailId } = ctx
  const { approvalItemLines, approvalItems } = H
  // t_48f6b336: kelompokkan item per kategori master material (material_id) —
  // konsisten dgn daftar PR & desktop. Fallback legacy (ringkasan teks) tetap
  // tampil, masuk grup "Belum Berkategori" (tanpa mengarang kategori).
  const rawItems = approvalItems(r)
  const groups = rawItems.length
    ? groupItemsByCategory(rawItems, materialMapFrom(allMaterials))
    : (approvalItemLines(r).length
      ? [{ heading: null, items: H.approvalItemRows(r).map(row => ({ ...row, quantity: undefined })) }]
      : [])
  // Total Estimasi (t_ac0b39c0): snapshot tersimpan, read-only — nilai tidak
  // berubah karena pengelompokan.
  const est = prEstimateRows(rawItems)
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
          <div className="mobile-card-sub">{r.project_name || 'Tanpa Project'}</div>
        </div>
        <span className={`badge status-${r.status}`}>{r.status}</span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Judul:</span>
          <span className="mobile-val">{r.title || '—'}</span>
        </div>
        <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <span className="mobile-label">Item Material ({approvalItemLines(r).length}):</span>
          <div className="mobile-items-box">
            {groups.length ? groups.map((g, gi) => (
              <div key={gi} className="mobile-item-group">
                <div className="mobile-group-label">{groupHeadingText(g.heading)}</div>
                {g.items.map((it, idx) => {
                  // Raw pr_items → item_name/quantity/unit; fallback legacy → text/qty.
                  const label = it.item_name !== undefined ? String(it.item_name || it.kode || '').trim() || '—' : it.text
                  const qtyText = it.qty !== undefined
                    ? it.qty
                    : ((it.quantity ?? '') === '' ? '—' : `${it.quantity ?? ''} ${it.unit || ''}`.trim())
                  return (
                    <div key={idx} className="mobile-item-line">
                      • {label}{qtyText && qtyText !== '—' ? <b> — {qtyText}</b> : null}
                      {/* Subtotal per item (snapshot) — legacy fallback tampil "belum ada harga" */}
                      {it.quantity !== undefined && (() => {
                        const price = savedPriceOf(it)
                        const qNum = Number(it.quantity)
                        const subtotal = (price !== null && isFinite(qNum) && qNum > 0) ? Math.round(qNum * price) : null
                        return subtotal !== null
                          ? <span style={{ color: '#137333' }}> · {rupiah(subtotal)}</span>
                          : <span style={{ color: '#b45309' }}> · belum ada harga</span>
                      })()}
                    </div>
                  )
                })}
              </div>
            )) : <span className="muted">—</span>}
          </div>
        </div>
        {/* Total Estimasi PR — snapshot tersimpan; label jujur bila belum lengkap */}
        {est.hasItems && (
          <div className="mobile-card-row" style={{ borderTop: '1px solid #e1e7e4', paddingTop: '6px' }}>
            <span className="mobile-label">
              Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
            </span>
            <span className="mobile-val" style={{ fontWeight: 700, color: est.complete ? '#137333' : '#b45309' }}>
              {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
            </span>
          </div>
        )}
        {/* Catatan (t_1fe52e80): hanya catatan pengguna yang tampil. Sisa
            auto-seed legacy & pending tanpa catatan sama-sama tampil dash. */}
        {displayNote(r) && (
          <div className="mobile-card-note">
            <b>Catatan:</b> {displayNote(r)}
          </div>
        )}
        {!displayNote(r) && r.status !== 'PENDING' && (
          <div className="mobile-card-note">
            <b>Catatan:</b> —
          </div>
        )}
        {r.decided_at && (
          <div className="mobile-card-row">
            <span className="mobile-label">Diputuskan:</span>
            <span className="mobile-val">{format(r.decided_at)}</span>
          </div>
        )}
      </div>
      <div className="mobile-card-actions">
        {r.status === 'PENDING' ? (
          <div className="mobile-action-grid-3">
            <button
              type="button"
              className="btn-mobile-approve"
              onClick={() => onDecideApproval(r, 'APPROVED')}
            >
              ✓ Setujui
            </button>
            <button
              type="button"
              className="btn-mobile-reject"
              onClick={() => onDecideApproval(r, 'REJECTED')}
            >
              ✕ Tolak
            </button>
            <button
              type="button"
              className="btn-mobile-revise"
              onClick={() => onReviseApproval(r)}
            >
              ✎ Revisi
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', fontSize: '12px', color: '#556b65', padding: '6px' }}>
            Sudah diproses ({r.status})
          </div>
        )}
        {/* Jangkar drawer detail (t_ff02257a S1): fungsionalitas tombol perluasan
            Material lama dipindah ke drawer (portal document.body) — bukan
            perluasan tbody */}
        {approvalItemLines(r).length > 0 && (
          <button
            type="button"
            className="outline"
            style={{ width: '100%' }}
            onClick={() => setApprovalDetailId(approvalDetailId === r.id ? null : r.id)}
          >
            {approvalDetailId === r.id ? '▲ Tutup Rincian' : `≡ Rincian (${approvalItemLines(r).length})`}
          </button>
        )}
      </div>
    </>
  )
}

// ============================================================
// DRAWER DETAIL APPROVAL (t_ff02257a S1 — arahan DAT)
// ============================================================
// Hook modal modul (renderModuleModal, dipanggil SEKALI per render halaman,
// bukan per baris). Konten = portal document.body (modules/approvals/
// detailDrawer.jsx) — BUKAN di dalam <tbody> supaya geometri tabel
// master-detail rowSpan tidak pecah.
//
// Murni TAMPILAN: drawer hanya baca (rincian material & catatan tolak/revisi);
// tidak ada tombol keputusan, tidak ada tulis DB — alur submit/approve/
// revise/reject tidak berubah.
export function receiptForm(ctx) {
  const { H, rows, approvalDetailId, setApprovalDetailId, allMaterials } = ctx
  if (!approvalDetailId || !setApprovalDetailId) return null
  const r = (rows || []).find(x => x.id === approvalDetailId)
  if (!r) return null
  return approvalDetail({ H, r, close: () => setApprovalDetailId(null), allMaterials })
}
