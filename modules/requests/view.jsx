// ============================================================
// modules/requests/view.jsx — Purchase Request (PR)
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Purchase Request (PR) diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, rupiah } from '../../lib/constants'
// t_50b783de (Approval OFF): label tombol kirim ulang mengikuti kebijakan
// terpusat — saat Approval OFF, PR REJECTED yang diperbaiki dikirim ulang
// lewat jalur lean dengan ID yang sama (bukan ke antrean approval).
import { isApprovalEnabled } from '../../lib/constants'
import { classifyRequest, requestStatusLabel, isLeanMarked, closeReasonOf, stripLeanMarkers } from './leanRequest'
import { requestFulfillment, FULFILL_DONE, FULFILL_CLOSED, FULFILL_PARTIAL } from './fulfillment'

// ============================================================
// ESTIMASI HARGA TERSIMPAN (t_ac0b39c0) — SNAPSHOT, bukan lookup dinamis
// ============================================================
// Kolom Estimasi Harga di daftar PR menampilkan harga yang TERSIMPAN di
// pr_items.estimated_price (snapshot saat PR dibuat/diedit). TIDAK ada
// penghitungan ulang dari histori terbaru di sini: reopening PR / menambah
// pembelian baru TIDAK mengubah angka PR lama (arahan snapshot DAT).
// Per-item: subtotal = qty × harga tersimpan. Total Estimasi PR dihitung
// dari snapshot yang tersimpan; item tanpa harga TIDAK dianggap 0 — total
// diberi label "belum lengkap".
export function effectiveEstimatePriceOf(it, materialMap) {
  if (!it) return null
  // 1. Snapshot tersimpan di pr_items.estimated_price
  const hasSaved = it.estimated_price !== null && it.estimated_price !== undefined && String(it.estimated_price).trim() !== ''
  if (hasSaved) {
    const rawSaved = Number(it.estimated_price)
    // Nonnegative finite valid -> dipakai (jangan ditimpa master)
    if (isFinite(rawSaved) && rawSaved >= 0) {
      return Math.round(rawSaved)
    }
    // Negatif / NaN = invalid -> null (dash / unknown, bukan 0)
    return null
  }
  // 2. Fallback ke harga acuan master HANYA jika snapshot belum pernah terisi
  if (materialMap && it.material_id) {
    const mat = materialMap.get(it.material_id)
    const rawMaster = (mat?.harga_acuan !== null && mat?.harga_acuan !== undefined && String(mat?.harga_acuan).trim() !== '')
      ? Number(mat.harga_acuan)
      : null
    if (rawMaster !== null && isFinite(rawMaster) && rawMaster >= 0) {
      return Math.round(rawMaster)
    }
  }
  return null
}

function savedPriceOf(it, materialMap) {
  return effectiveEstimatePriceOf(it, materialMap)
}
export { savedPriceOf }

export function prEstimateRows(items, materialMap) {
  const list = items || []
  let total = 0
  let unknown = 0
  for (const it of list) {
    const p = effectiveEstimatePriceOf(it, materialMap)
    const q = Number(it.quantity)
    if (p === null || !isFinite(q) || q <= 0) { unknown++; continue }
    total += Math.round(q * p)
  }
  return {
    total: Math.round(total),
    unknown,
    hasItems: list.length > 0,
    complete: list.length > 0 && unknown === 0
  }
}

// ============================================================
// PENGELOMPOKAN ITEM PER KATEGORI MATERIAL (t_48f6b336 — arahan DAT)
// ============================================================
// Sumber kategori = master material via item.material_id (relasi yang
// tersimpan) — BUKAN vendor, BUKAN tebakan nama/prefix. Material tanpa
// material_id, tidak ada di master, atau kategori kosong masuk grup
// "Belum Berkategori" (jujur — tidak mengarang kategori).
//
// Pengelompokan HANYA tampilan: urutan item asli di dalam grup dipertahankan
// (ordering stabil), urutan grup = kemunculan pertama (pr_items datang
// berurutan sort_order dari loadAll). TIDAK mengubah DB/tersimpan/total.
// Dipakai bersama modul PR & Approval.
export const UNCATEGORIZED_LABEL = 'Belum Berkategori'

function categoryOfItem(it, materialMap) {
  const mat = it && it.material_id ? materialMap.get(it.material_id) : null
  const cat = mat ? String(mat.category || '').trim() : ''
  return cat || null
}

// Kelompokkan baris item (output requestItemRows/approvalItemRows + source
// pr_items mentah utk lookup kategori) -> [{ heading, items, estSubtotal }].
// Urutan grup & item stabil (kemunculan pertama); heading null utk yang tak
// berkategori — label tampilan "Belum Berkategori" dipakai saat render.
export function groupItemsByCategory(itemRows, materialMap) {
  const groups = []
  const byHeading = new Map()
  for (let i = 0; i < (itemRows || []).length; i++) {
    const it = itemRows[i]
    const heading = categoryOfItem(it, materialMap)
    let g = byHeading.get(heading)
    if (!g) {
      g = { heading, items: [] }
      byHeading.set(heading, g)
      groups.push(g)
    }
    // Pertahankan baris asli apa adanya + subtotal snapshot (utk opsi subtotal
    // kategori — hanya angka dari sumber valid, bukan penjumlahan qty campur
    // satuan).
    g.items.push(it)
    if (it.savedSubtotal !== null && it.savedSubtotal !== undefined) {
      g.estSubtotal = (g.estSubtotal || 0) + it.savedSubtotal
    }
  }
  return groups
}

// Header grup pendek utk mobile & kolom sempit — nama kategori utuh, hanya
// pemisah visual yang berbeda (tanpa trim kategori — nama kategori master
// TIDAK dipotong).
export function groupHeadingText(heading) {
  return heading || UNCATEGORIZED_LABEL
}

// Map master material utk lookup kategori (id -> material). Menerima array
// allMaterials dari ctx — TIDAK ada query, semua dari data halaman.
export function materialMapFrom(allMaterials) {
  return new Map((allMaterials || []).map(m => [m.id, m]))
}

// Tempelkan material_id dari pr_items mentah ke baris tampilan (zip per index:
// requestItemRows/approvalItemRows memetakan prItems 1:1 dgn urutan sama).
// Fallback legacy (ringkasan teks, tanpa pr_items) tidak punya material_id →
// baris tetap tanpa material_id → masuk "Belum Berkategori". Murni tampilan —
// objek baris baru, data tersimpan tidak disentuh.
export function attachMaterialIds(itemRows, rawItems) {
  const rows = itemRows || []
  const raw = rawItems || []
  if (!raw.length || raw.length !== rows.length) return rows
  return rows.map((row, i) => (
    raw[i] && raw[i].material_id ? { ...row, material_id: raw[i].material_id } : row
  ))
}

// --- Filter tabs ---
export function filters(ctx) {
  const { rows, prFilter, setPrFilter } = ctx
  // t_a5a73034 — tab "Siap Ditindaklanjuti" hanya menghitung request yang
  // BENAR-BENAR bertanda jalur lean. Request SUBMITTED lama tanpa penanda
  // dipisah ke "Submitted lama" supaya tidak tercampur ke antrean harian
  // admin (arahan DAT: jangan anggap legacy otomatis lean).
  const leanRows = rows.filter(r => isLeanMarked(r.notes))
  const legacySubmitted = rows.filter(r => String(r.status || '').toUpperCase() === 'SUBMITTED' && !isLeanMarked(r.notes))
  return (
    <div className="filter-tabs">
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        type="button"
        className={`pill ${prFilter === 'all' ? 'active' : ''}`}
        onClick={() => setPrFilter('all')}
        title="Semua PR yang belum disetujui — riwayat PR approved ada di tab Approved"
      >
        Semua Aktif ({rows.filter(r => r.status !== 'APPROVED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'DRAFT' ? 'active' : ''}`}
        onClick={() => setPrFilter('DRAFT')}
      >
        Draft ({rows.filter(r => r.status === 'DRAFT').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'LEAN' ? 'active' : ''}`}
        onClick={() => setPrFilter('LEAN')}
        title="Request yang sudah dikirim lewat jalur admin — siap ditindaklanjuti tanpa approval"
      >
        Siap Ditindaklanjuti ({leanRows.length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'SUBMITTED_LEGACY' ? 'active' : ''}`}
        onClick={() => setPrFilter('SUBMITTED_LEGACY')}
        title="Request SUBMITTED dari alur lama (tanpa penanda jalur lean) — riwayat, bukan antrean harian"
      >
        Submitted lama ({legacySubmitted.length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'APPROVED' ? 'active' : ''}`}
        onClick={() => setPrFilter('APPROVED')}
      >
        Approved ({rows.filter(r => r.status === 'APPROVED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'REVISI' ? 'active' : ''}`}
        onClick={() => setPrFilter('REVISI')}
      >
        Revisi ({rows.filter(r => r.status === 'REVISI').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'REJECTED' ? 'active' : ''}`}
        onClick={() => setPrFilter('REJECTED')}
      >
        Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
      </button>
      <button
        type="button"
        className={`pill ${prFilter === 'URGENT' ? 'active' : ''}`}
        onClick={() => setPrFilter('URGENT')}
        style={rows.some(r => r.priority === 'URGENT') ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
      >
        🚨 Prioritas ({rows.filter(r => r.priority === 'URGENT').length})
      </button>
      </div>
    </div>
  )
}

// ============================================================
// LABEL STATUS JUJUR (t_a5a73034)
// ============================================================
// Nilai enum di DB TIDAK diubah. Yang diterjemahkan hanya tampilannya:
//   SUBMITTED + penanda lean -> "Siap Ditindaklanjuti"
//   SUBMITTED tanpa penanda  -> "Submitted lama (…)" : riwayat, bukan antrean.
// Class warna dipisah (badge-lean / badge-legacy) supaya tidak tertukar.

// t_50b783de: tooltip tombol kirim ulang mengikuti kebijakan Approval.
// Saat OFF: kirim ulang jalur lean (ID sama, riwayat penolakan tetap).
// Saat ON : perilaku lama — kembali ke antrean approval.
export function resubmitTitle(r, fallbackTitle) {
  const label = r?.pr_number || fallbackTitle
  if (isApprovalEnabled()) {
    return `Submit Ulang — kirim kembali ${label} ke modul Approval (riwayat lama dipertahankan)`
  }
  return `Kirim Ulang — perbaikan ${label} langsung dikirim ke daftar kebutuhan siap dibeli (ID & nomor sama, riwayat penolakan tetap tersimpan)`
}

export function statusBadge(r, ctx = {}) {
  const stepCount = ctx.approvalStepsForPr ? ctx.approvalStepsForPr(r.id).length : 0
  const cls = classifyRequest(r, { approvalStepCount: stepCount })
  const tone = cls.key === 'LEAN' ? 'badge-lean' : (cls.legacy ? 'badge-legacy' : `status-${r.status}`)
  const title = cls.key === 'LEGACY_UNKNOWN'
    ? 'Status SUBMITTED dari alur lama tanpa jejak approval — tidak dianggap jalur lean, tidak diubah massal.'
    : (cls.key === 'LEAN' ? 'Dikirim lewat jalur admin: langsung ditindaklanjuti, tanpa approval terpisah.' : undefined)
  return (
    <span className={`badge ${tone}`} style={{ fontSize: '10.5px', padding: '2px 6px', whiteSpace: 'nowrap' }} title={title}>
      {requestStatusLabel(r, { approvalStepCount: stepCount })}
    </span>
  )
}

// --- Header kolom khusus: ikon prioritas (bukan teks "Priority") ---
export function header(h) {
  if (h === 'priority') {
    return <span className="prio-dot prio-header" title="Prioritas — klik untuk urutkan" />
  }
  // t_cde1b8ad (arahan DAT): PR tidak lagi "memesan" toko. Kolom ini tetap
  // ADA karena datanya masih tersimpan (pr_items.vendor_id — rencana toko dari
  // data lama) dan dipakai estimator harga; labelnya dibuat jujur supaya tidak
  // terbaca sebagai supplier aktual. Toko AKTUAL dicatat di modul Purchase.
  if (h === 'vendor_name') {
    return (
      <span title="Rencana toko dari data lama — toko AKTUAL dicatat di modul Purchase saat nota dibuat">
        Rencana Toko
      </span>
    )
  }
  return null
}

// --- Cell tabel desktop ---
export function renderCell(h, r, rawVal, ctx) {
  const { H, openNoteId, setOpenNoteId } = ctx
  const { requestItemRows, requestItemLines } = H

  if (h === 'pr_number') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <b>{format(rawVal)}</b>
          <button
            type="button"
            className={`note-dot ${stripLeanMarkers(r.notes) ? 'note-dot-on' : ''}`}
            title={stripLeanMarkers(r.notes) || 'Tidak ada catatan'}
            aria-label="Catatan PR"
            onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
          />
        </div>
        <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
        {openNoteId === r.id && (
          <div className="note-pop">{stripLeanMarkers(r.notes) || 'Tidak ada catatan.'}</div>
        )}
      </div>
    )
  }
  if (h === 'priority') {
    return (
      <span
        className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
        title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
      />
    )
  }
  if (h === 'items_qty') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemRows(r).length ? requestItemRows(r).map((it, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {it.qtyText}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'vendor_name') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemRows(r).length ? requestItemRows(r).map((it, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, color: it.vendor ? '#1a73e8' : '#9aa8a4', whiteSpace: 'normal' }}>
            {it.vendor || '—'}
          </span>
        )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
      </div>
    )
  }
  if (h === 'materials_summary') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {requestItemLines(r).map((line, idx) => (
          <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, whiteSpace: 'normal', paddingLeft: '12px', textIndent: '-12px' }}>
            • {line}
          </span>
        ))}
      </div>
    )
  }
  return null
}

// --- Baris desktop khusus: master-detail item PR (rowSpan; tiap item 1 baris) ---
// ============================================================
// AKSI TUTUP SISA (t_a5a73034 — jalur lean)
// ============================================================
// Admin menutup sisa kebutuhan dengan ALASAN SINGKAT. Yang berubah HANYA
// catatan (penanda [Tutup: …]); qty permintaan asli di pr_items TIDAK
// disentuh dan status request tidak dipalsukan. Alasan wajib — tombol
// membuka dialog kecil (bukan window.prompt) supaya terbaca di HP.
export function LeanCloseAction({ pr, onCloseRemaining }) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [err, setErr] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const alreadyClosed = !!closeReasonOf(pr.notes)
  if (!onCloseRemaining) return null

  async function submit(e) {
    if (e) e.preventDefault()
    const clean = String(reason || '').trim()
    if (!clean) { setErr('Alasan penutupan wajib diisi.'); return }
    setErr('')
    setBusy(true)
    try {
      const res = await onCloseRemaining(pr, clean)
      if (res && res.ok === false) setErr(res.error || 'Gagal menutup sisa kebutuhan.')
      else { setOpen(false); setReason('') }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-lean-close"
        onClick={() => { setOpen(true); setErr('') }}
        title={alreadyClosed ? `Sisa sudah ditutup: ${closeReasonOf(pr.notes)}` : 'Tutup sisa kebutuhan dengan alasan singkat (qty permintaan tidak diubah)'}
        style={{ fontSize: '10px', padding: '3px 6px', whiteSpace: 'nowrap', width: '100%', marginBottom: '2px' }}
      >
        {alreadyClosed ? '🔒 Sisa ditutup' : '🔒 Tutup sisa'}
      </button>
      {open && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Tutup sisa kebutuhan">
          <form className="dialog lean-close-dialog" onSubmit={submit} style={{ maxWidth: '420px' }}>
            <div className="dialoghead">
              <h2>Tutup Sisa — {pr.pr_number || 'PR'}</h2>
              <button type="button" className="icon" onClick={() => setOpen(false)} aria-label="Tutup dialog">×</button>
            </div>
            <p className="muted" style={{ fontSize: '12px', margin: '0 0 8px' }}>
              Qty permintaan asli <b>tidak diubah</b>. Request ditandai selesai-ditutup untuk sisa yang
              memang tidak akan dibeli (mis. kebutuhan sudah terpenuhi di proyek lain).
            </p>
            <label>Alasan penutupan
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Contoh: sisa material diambil dari stok workshop"
                autoFocus
              />
            </label>
            {err && <p style={{ color: '#be123c', fontSize: '12px', fontWeight: 600, margin: '4px 0 0' }}>{err}</p>}
            <div className="actions">
              <button type="button" className="outline" onClick={() => setOpen(false)}>Batal</button>
              <button type="submit" disabled={busy}>{busy ? 'Menyimpan…' : 'Tutup sisa'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

// --- Baris desktop khusus: master-detail item PR (rowSpan; tiap item 1 baris) ---
export function desktopRow(r, ctx) {
  const { H, title, page, setEditRow, onFinishPr, onCloseRemaining, onDelete, openNoteId, setOpenNoteId, allMaterials } = ctx
  const { requestItemRows } = H
  // Master-detail: setiap item = satu baris tabel; Qty / Item Material /
  // Vendor PASTI sejajar karena berada di baris fisik yang sama.
  // ============================================================
  // t_48f6b336 (arahan DAT): item DILEMPOKKAN per kategori material dari
  // MASTER (via pr_items.material_id — bukan vendor, bukan tebakan nama).
  // Judul kategori tampil SEKALI sebagai baris pemisah grup di area item;
  // nama item tetap nama saja. Material tanpa relasi kategori masuk grup
  // "Belum Berkategori" (jujur, tidak mengarang). Urutan grup & item stabil
  // (kemunculan pertama; pr_items datang terurut sort_order). Pengelompokan
  // murni TAMPILAN — dokumen PR, nomor, status & alur approval tidak berubah.
  // ============================================================
  const itemList = requestItemRows(r)
  const noItems = !itemList.length
  const list = noItems ? [{ name: '—', qtyText: '—', vendor: '' }] : itemList
  // Kategori via pr_items.material_id (relasi tersimpan) × master material.
  // Zip 1:1 pr_items → baris tampilan (urutan sama, dari helper shared).
  const groups = noItems
    ? []
    : groupItemsByCategory(
        attachMaterialIds(itemList, H.prItemsForPr(r.id)),
        materialMapFrom(allMaterials)
      )
  const urgent = String(r.priority || '').toUpperCase() === 'URGENT'
  // ============================================================
  // TOTAL ESTIMASI (t_ac0b39c0): harga snapshot pr_items yang tersimpan —
  // bukan lookup dinamis. Item tanpa harga ≠ 0 → label "belum lengkap".
  // ============================================================
  const itemsForEst = H.prItemsForPr(r.id)
  const est = prEstimateRows(itemsForEst, materialMapFrom(allMaterials))
  // Parent rowSpan mencakup heading grup + baris item + baris total (total
  // row SELALU ada bila PR punya item — lengkap maupun belum lengkap) +
  // baris pemenuhan (hanya utk request jalur lean yang punya item).
  // Penghitung `hasFulfilRow` DIPAKAI BERSAMA oleh rowSpan dan barisnya
  // supaya grid tidak pernah berlubang (rowSpan tanpa baris = kolom hantu).
  const hasFulfilRow = isLeanMarked(r.notes) && H.prItemsForPr(r.id).length > 0
  const estRowSpan = list.length + groups.length + (est.hasItems ? 1 : 0) + (hasFulfilRow ? 1 : 0)
  // ===== Baris Total Estimasi PR (snapshot tersimpan) — baris ekstra di
  // bawah item; parent rowSpan diperpanjang agar tetap menyatukan semua.
  // Nilai TIDAK berubah karena pengelompokan (jumlah subtotal snapshot sama).
  // Verifikasi geometri run 93: kolom parent (prioritas/noPR/project/judul,
  // rowSpan) + kolom status/aksi (rowSpan) MENUTUP kolom 0..3 & 8..9 baris
  // ini — filler colSpan 2 di ujung kanan menciptakan 2 kolom hantu
  // (grid 12 vs header 10, strip kosong tampak di kanan kolom Aksi).
  // Label colSpan 3 = Qty..Vendor, nilai = kolom Estimasi Harga (sejajar
  // dgn subtotal item di atasnya). Grid baris: 4 (parent) + 3 + 1 + 2 = 10.
  const totalRow = est.hasItems ? [(
    <tr key="pr-est-total" className="pr-est-total-row">
      <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700, color: '#1f3a34', borderTop: '2px solid #1f3a34', background: '#fbfdfc' }}>
        Total Estimasi{est.complete ? '' : ' (belum lengkap)'}:
      </td>
      <td style={{ fontWeight: 700, color: est.complete ? '#137333' : '#b45309', borderTop: '2px solid #1f3a34', background: '#fbfdfc', whiteSpace: 'nowrap' }}>
        {rupiah(est.total)}{!est.complete ? ` — ${est.unknown} item belum ada harga` : ''}
      </td>
    </tr>
  )] : []
  // ===== Baris PEMENUHAN (t_a5a73034) — dihitung dari nota DIBELI valid,
  // BUKAN dari status request. Ditempatkan sebagai baris ekstra di area item
  // (colSpan 4 = Qty..Estimasi) agar grid tetap 10 kolom: parent rowSpan
  // menutup kolom 0..3 & 8..9. Tidak ada kolom hantu.
  const fulfil = requestFulfillment(r, {
    items: H.prItemsForPr(r.id),
    receivings: ctx.allReceivings || [],
    receivingItems: ctx.allReceivingItems || []
  })
  const fulfilRow = hasFulfilRow ? [(
    <tr key="pr-fulfil" className="pr-fulfil-row">
      <td colSpan={4} style={{ fontSize: '10.5px', padding: '3px 6px', background: '#fbfdfc', borderTop: '1px dashed #d8e3dd' }}>
        <span className={`pr-fulfil-note ${fulfil.status === FULFILL_DONE ? 'is-done' : (fulfil.status === FULFILL_CLOSED ? 'is-closed' : '')}`}>
          Pemenuhan: {fulfil.label}
          {fulfil.status === FULFILL_PARTIAL && fulfil.remaining > 0 ? ` — sisa ${fulfil.remaining}` : ''}
          {fulfil.status === FULFILL_CLOSED && fulfil.closedReason ? ` — ${fulfil.closedReason}` : ''}
        </span>
      </td>
    </tr>
  )] : []
  // ===== Susun baris fisik: heading kategori (pemisah grup) + item, rata.
  const bodyRows = []
  if (noItems) {
    bodyRows.push({ kind: 'item', it: list[0] })
  } else {
    for (const g of groups) {
      bodyRows.push({ kind: 'heading', heading: g.heading })
      for (const it of g.items) bodyRows.push({ kind: 'item', it })
    }
  }
  // Sel parent (prioritas/noPR/project/judul + status/aksi) — dirender SEKALI
  // di baris fisik pertama dengan rowSpan mencakup SEMUA baris (heading grup,
  // item, total) sehingga parent tetap terkait dengan semua grup.
  const parentStartTds = first => first ? (
    <>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <span className={`prio-dot ${urgent ? 'prio-urgent' : 'prio-normal'}`} title={urgent ? 'Prioritas' : 'Standard'} />
      </td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <b>{format(r.pr_number)}</b>
            <button
              type="button"
              className={`note-dot ${stripLeanMarkers(r.notes) ? 'note-dot-on' : ''}`}
              title={stripLeanMarkers(r.notes) || 'Tidak ada catatan'}
              aria-label="Catatan PR"
              onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
            />
          </div>
          <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
          {openNoteId === r.id && (
            <div className="note-pop">{stripLeanMarkers(r.notes) || 'Tidak ada catatan.'}</div>
          )}
        </div>
      </td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'break-word', fontSize: '12px', lineHeight: 1.35, fontWeight: 500, color: '#1f3a34' }} title={String(r.project_name || '')}>
          {format(r.project_name)}
        </div>
      </td>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top' }}>
        <div className="pr-title-cell" title={String(r.title || '')} style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'break-word', fontSize: '12px', lineHeight: 1.35 }}>
          {format(r.title)}
        </div>
      </td>
    </>
  ) : null
  const parentEndTds = first => first ? (
    <>
      <td rowSpan={estRowSpan} style={{ verticalAlign: 'top', textAlign: 'center' }}>
        {statusBadge(r, ctx)}
      </td>
      <td rowSpan={estRowSpan} style={{ textAlign: 'center', verticalAlign: 'top' }}>
        <div className="pr-actions-cell" style={{ display: 'flex', flexDirection: 'column', gap: '3px', justifyContent: 'center', alignItems: 'center', margin: '0 auto' }}>
          {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
            <button
              type="button"
              className="btn-finish btn-lean-send"
              onClick={() => onFinishPr(r)}
              title={`Selesai & Kirim — ${r.pr_number || title} langsung masuk daftar kebutuhan siap dibeli (tanpa approval)`}
              style={{ fontSize: '10px', padding: '3px 6px', whiteSpace: 'nowrap', width: '100%', marginBottom: '2px' }}
            >
              ✓ Selesai &amp; Kirim
            </button>
          )}
          {/* Jalur lean: request yang SUDAH dikirim bisa ditutup sisanya oleh
              admin dengan alasan singkat — qty permintaan asli tidak diubah. */}
          {isLeanMarked(r.notes) && (
            <LeanCloseAction pr={r} onCloseRemaining={onCloseRemaining} />
          )}
          {String(r.status || '').toUpperCase() === 'REJECTED' && (
            <button
              type="button"
              className="btn-finish btn-resubmit"
              onClick={() => onFinishPr(r)}
              title={resubmitTitle(r, title)}
              style={{ fontSize: '10px', padding: '3px 6px', whiteSpace: 'nowrap', width: '100%', marginBottom: '2px' }}
            >
              ↻ Submit Ulang
            </button>
          )}
          <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn-edit icon-btn"
              onClick={() => setEditRow(r)}
              title={`Edit ${r.pr_number || title}`}
            >
              ✏️
            </button>
            <button
              type="button"
              className="btn-delete icon-btn"
              onClick={() => onDelete(page, r)}
              title={`Hapus ${r.pr_number || title}`}
            >
              🗑️
            </button>
          </div>
        </div>
      </td>
    </>
  ) : null
  return bodyRows.map((row, idx) => {
    const first = idx === 0
    if (row.kind === 'heading') {
      // Baris pemisah grup: judul kategori SEKALI di kolom Item Material
      // (colSpan Qty+Item+Vendor+Estimasi); kolom parent berlanjut rowSpan.
      return (
        <tr key={`pr-grp-${idx}`} className="pr-group-row">
          {parentStartTds(first)}
          <td colSpan={4} className="pr-group-cell">
            <span className="pr-group-label">{groupHeadingText(row.heading)}</span>
          </td>
          {parentEndTds(first)}
        </tr>
      )
    }
    const it = row.it
    return (
      <tr key={`pr-item-${idx}`} className="pr-item-row">
        {parentStartTds(first)}
        <td className="pr-item-qty"><b>{it.qtyText}</b></td>
        <td className="pr-item-name">{it.name}</td>
        <td className="pr-item-vendor" style={{ color: it.vendor ? '#1a73e8' : '#9aa8a4' }}>{it.vendor || '—'}</td>
        <td className="pr-item-price">
          {/* Subtotal per item = qty × harga TERSIMPAN (snapshot) */}
          {it.savedSubtotal !== null && it.savedSubtotal !== undefined
            ? rupiah(it.savedSubtotal)
            : (it.estPrice !== null && it.estPrice !== undefined ? rupiah(it.estPrice) : '—')}
        </td>
        {parentEndTds(first)}
      </tr>
    )
  }).concat(totalRow).concat(fulfilRow)
}

// --- Aksi per baris (desktop) ---
export function rowActions(r, ctx) {
  const { title, page, setEditRow, onFinishPr, onCloseRemaining, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div className="pr-actions-cell" style={{ display: 'flex', flexDirection: 'column', gap: '3px', justifyContent: 'center', alignItems: 'center', margin: '0 auto' }}>
        {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
          <button
            type="button"
            className="btn-finish btn-lean-send"
            onClick={() => onFinishPr(r)}
            title={`Selesai & Kirim — ${r.pr_number || title} langsung masuk daftar kebutuhan siap dibeli (tanpa approval)`}
            style={{ fontSize: '10px', padding: '3px 6px', whiteSpace: 'nowrap', width: '100%', marginBottom: '2px' }}
          >
            ✓ Selesai &amp; Kirim
          </button>
        )}
        {isLeanMarked(r.notes) && <LeanCloseAction pr={r} onCloseRemaining={onCloseRemaining} />}
        {String(r.status || '').toUpperCase() === 'REJECTED' && (
          <button
            type="button"
            className="btn-finish btn-resubmit"
            onClick={() => onFinishPr(r)}
            title={resubmitTitle(r, title)}
            style={{ fontSize: '10px', padding: '3px 6px', whiteSpace: 'nowrap', width: '100%', marginBottom: '2px' }}
          >
            ↻ Submit Ulang
          </button>
        )}
        <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
          <button
            type="button"
            className="btn-edit icon-btn"
            onClick={() => setEditRow(r)}
            title={`Edit ${r.pr_number || title}`}
          >
            ✏️
          </button>
          <button
            type="button"
            className="btn-delete icon-btn"
            onClick={() => onDelete(page, r)}
            title={`Hapus ${r.pr_number || title}`}
          >
            🗑️
          </button>
        </div>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { H, page, setEditRow, onFinishPr, onCloseRemaining, onDelete, allMaterials } = ctx
  const { requestItemRows } = H
  // Total Estimasi (t_ac0b39c0): snapshot harga tersimpan pr_items.
  const est = prEstimateRows(H.prItemsForPr(r.id), materialMapFrom(allMaterials))
  // t_a5a73034: pemenuhan dihitung dari REALISASI (nota DIBELI), bukan dari
  // status request. `receivings`/`receivingItems` datang dari ctx halaman.
  const fulfil = requestFulfillment(r, {
    items: H.prItemsForPr(r.id),
    receivings: ctx.allReceivings || [],
    receivingItems: ctx.allReceivingItems || []
  })
  // t_48f6b336: kelompokkan item per kategori master material — sama dgn
  // desktop. Heading grup tampil sekali; item tetap nama + qty + vendor +
  // subtotal. Tanpa relasi kategori → "Belum Berkategori".
  const itemList = requestItemRows(r)
  const groups = groupItemsByCategory(
    attachMaterialIds(itemList, H.prItemsForPr(r.id)),
    materialMapFrom(allMaterials)
  )
  return (
    <>
      <div className="mobile-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
            title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
          />
          <div>
            <b className="mobile-card-title">{r.pr_number || 'PR'}</b>
            <div className="mobile-card-sub">{format(r.created_at)}</div>
          </div>
        </div>
        <span className={`badge ${isLeanMarked(r.notes) ? 'badge-lean' : (String(r.status).toUpperCase() === 'SUBMITTED' ? 'badge-legacy' : `status-${r.status}`)}`}>
          {requestStatusLabel(r)}
        </span>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Project:</span>
          <span className="mobile-val">{r.project_name || '—'}</span>
        </div>
        <div className="mobile-card-row">
          <span className="mobile-label">Judul:</span>
          <span className="mobile-val">{r.title || '—'}</span>
        </div>
        <div className="mobile-card-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <span className="mobile-label">Item Material:</span>
          <div className="mobile-items-box">
            {groups.length ? groups.map((g, gi) => (
              <div key={gi} className="mobile-item-group">
                <div className="mobile-group-label">{groupHeadingText(g.heading)}</div>
                {g.items.map((it, idx) => (
                  <div key={idx} className="mobile-item-line">
                    • {it.name}
                    {it.qtyText && it.qtyText !== '—' ? <b> — {it.qtyText}</b> : null}
                    {it.vendor ? <span style={{ color: '#1a73e8' }}> · 🛒 {it.vendor}</span> : null}
                    {/* Subtotal per item (snapshot): fallback estPrice utk data lama */}
                    {(it.savedSubtotal !== null && it.savedSubtotal !== undefined)
                      ? <span style={{ color: '#137333' }}> · {rupiah(it.savedSubtotal)}</span>
                      : (it.estPrice !== null && it.estPrice !== undefined
                        ? <span style={{ color: '#137333' }}> · {rupiah(it.estPrice)}</span>
                        : <span style={{ color: '#b45309' }}> · belum ada harga</span>)}
                  </div>
                ))}
              </div>
            )) : <span className="muted">—</span>}
          </div>
        </div>
        {/* Total Estimasi PR — snapshot tersimpan; label jujur bila belum lengkap.
            Nilai sama seperti sebelum pengelompokan (total tidak terpengaruh). */}
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
        {/* PEMENUHAN (t_a5a73034): dihitung dari nota DIBELI yang valid.
            Request terkirim BUKAN berarti selesai — sisa tetap terlihat. */}
        {fulfil.counts.total > 0 && (
          <div className="mobile-card-row" style={{ borderTop: '1px solid #e1e7e4', paddingTop: '6px', alignItems: 'flex-start' }}>
            <span className="mobile-label">Pemenuhan:</span>
            <span className="mobile-val" style={{ fontWeight: 700, color: fulfil.status === FULFILL_DONE ? '#047857' : (fulfil.status === FULFILL_CLOSED ? '#64748b' : '#b45309') }}>
              {fulfil.label}
              {fulfil.status === FULFILL_PARTIAL && fulfil.remaining > 0 ? ` — sisa ${fulfil.remaining}` : ''}
            </span>
          </div>
        )}
        {stripLeanMarkers(r.notes) && (
          <div className="mobile-card-note">
            <b>Catatan PR:</b> {stripLeanMarkers(r.notes)}
          </div>
        )}
      </div>
      <div className="mobile-card-actions">
        <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
          {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
            <button
              type="button"
              className="btn-finish btn-lean-send"
              onClick={() => onFinishPr(r)}
              style={{ flex: 1, padding: '8px', fontSize: '12px' }}
            >
              ✓ Selesai &amp; Kirim
            </button>
          )}
          {isLeanMarked(r.notes) && (
            <div style={{ flex: 1, minWidth: '130px' }}>
              <LeanCloseAction pr={r} onCloseRemaining={onCloseRemaining} />
            </div>
          )}
          {String(r.status || '').toUpperCase() === 'REJECTED' && (
            <button
              type="button"
              className="btn-finish btn-resubmit"
              onClick={() => onFinishPr(r)}
              style={{ flex: 1, padding: '8px', fontSize: '12px' }}
            >
              ↻ Submit Ulang
            </button>
          )}
          <button
            type="button"
            className="outline"
            onClick={() => setEditRow(r)}
            style={{ padding: '8px 14px', fontSize: '12px' }}
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            className="btn-delete"
            onClick={() => onDelete(page, r)}
            style={{ padding: '8px 14px', fontSize: '12px' }}
          >
            🗑️
          </button>
        </div>
      </div>
    </>
  )
}
