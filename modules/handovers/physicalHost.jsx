// ============================================================
// modules/handovers/physicalHost.jsx — HOST modal fisik (satu tempat render)
// ============================================================
// Membaca store `physicalModal` dan merender form yang tepat:
//   receipt → Terima Barang per item   (receiptForm.jsx)
//   return  → Retur dari barang rusak  (returnForm.jsx)
//   confirm → Konfirmasi fisik per item (confirmForm.jsx)
//
// Capability probe dijalankan SEKALI saat modal dibuka (bukan per render),
// supaya UI tidak pernah mengklaim "tersimpan" untuk tabel yang belum ada.
//
// `orderedFor` dibangun dari ctx.H (helper yang sudah dimuat halaman) —
// TIDAK ada query tambahan dan TIDAK ada perubahan kontrak ctx.
//
// REVIEW run 242 (BUG-V1): gerbang konfirmasi dulu memakai `ctx.rows`
// (memori halaman). Halaman ini tidak punya realtime dan tidak refresh saat
// tab kembali fokus, jadi dokumen yang dibuat admin lain SESUDAH halaman
// dimuat tidak terlihat — modal merender FORM dan dokumen duplikat bisa
// dikonfirmasi. Sekarang gerbangnya membaca DB lewat `guardConfirmFresh()`
// tepat saat modal dibuka, dan GAGAL BACA = TIDAK MERENDER FORM (fail closed).
// ============================================================
import React, { useEffect, useMemo, useState } from 'react'
import { usePhysicalModal, closePhysicalModal } from './physicalModal'
import { getReceiptCapability } from '../receivings/receiptCapability'
import { guardConfirmFresh } from './duplicateGuardDb'
import ReceiptForm from './receiptForm'
import ReturnForm from './returnForm'
import HandoverConfirmForm from './confirmForm'

// Qty pesanan per baris nota: pr_item.quantity lewat receiving_items.pr_item_id.
// null = beli langsung / tidak terhubung PR (sisa tidak dihitung dari tebakan).
function makeOrderedFor(ctx) {
  return (item) => {
    const prItemId = item?.pr_item_id
    if (!prItemId || !ctx?.H?.prItemsForPr) return null
    const rec = (ctx.allReceivings || []).find(r => r && r.id === item.receiving_id) || null
    const prId = rec && rec.purchase_request_id
    if (!prId) return null
    const list = ctx.H.prItemsForPr(prId) || []
    const hit = list.find(p => p && p.id === prItemId)
    const n = Number(hit?.quantity)
    return isFinite(n) && n > 0 ? n : null
  }
}

function BlockedPanel({ title, text, testId, onRetry }) {
  return (
    <div className="modal">
      <div className="dialog" data-testid={testId}>
        <div className="dialoghead">
          <h2>{title}</h2>
          <button type="button" className="icon" onClick={closePhysicalModal} aria-label="Tutup">×</button>
        </div>
        <p style={{ fontSize: '12.5px', lineHeight: 1.5, margin: 0 }}>{text}</p>
        <div className="actions" style={{ marginTop: 12 }}>
          {onRetry && (
            <button type="button" className="outline" onClick={onRetry}>🔄 Periksa ulang</button>
          )}
          <button type="button" className="outline" onClick={closePhysicalModal}>Tutup</button>
        </div>
      </div>
    </div>
  )
}

export function PhysicalModalHost({ ctx }) {
  const target = usePhysicalModal()
  const [cap, setCap] = useState(null)
  // Gerbang duplikat: `null` = SEDANG DIPERIKSA. `{ok}` = hasil baca DB.
  // Tidak pernah memakai `ctx.rows` untuk KEPUTUSAN (hanya untuk tampilan).
  const [dup, setDup] = useState(null)
  const [dupNonce, setDupNonce] = useState(0)

  // Probe setiap kali modal dibuka. `force` supaya hasil setelah migrasi
  // langsung terbaca tanpa reload halaman.
  //
  // PENTING (run 212 / BUG-R1): `null` berarti BELUM DIKETAHUI. Kalau probe
  // GAGAL (jaringan/RLS), jangan biarkan `cap` tetap null — form akan menunggu
  // selamanya tanpa penjelasan. Kegagalan ditandai `probeFailed:true` supaya
  // UI bisa bilang "pemeriksaan gagal" (dan tetap TIDAK menulis).
  useEffect(() => {
    let cancelled = false
    if (!target) { setCap(null); return }
    setCap(null)
    getReceiptCapability({ force: true })
      .then(c => { if (!cancelled) setCap(c || { ready: false, returnReady: false, probeFailed: true, missing: ['probe tidak mengembalikan hasil'] }) })
      .catch(err => {
        if (!cancelled) setCap({ ready: false, returnReady: false, probeFailed: true, missing: [String(err?.message || err || 'probe gagal')] })
      })
    return () => { cancelled = true }
  }, [target])

  // ============================================================
  // REVIEW run 242 (BUG-V1) — gerbang konfirmasi MEMBACA DATABASE
  // ============================================================
  // Modal konfirmasi bisa dibuka dari banner antrean, tombol ✓ baris
  // desktop, tombol kartu mobile, dan pemanggilan programatik. Semua pintu
  // itu lewat komponen ini, jadi pemeriksaan di sini menutup SEMUA pintu.
  //
  // Yang dibaca adalah DB, bukan `ctx.rows`: dua admin di lapangan tidak
  // saling melihat halaman, dan `save.js` sudah menyatakan hal yang sama
  // untuk invarian yang sama ("daftar di halaman bisa basi").
  //
  // Gagal baca = JANGAN merender form konfirmasi (fail closed). Konfirmasi
  // mengunci `diserahkan_at` permanen (CAS), jadi "coba saja" bukan pilihan:
  // salah konfirmasi tidak bisa dibatalkan dari UI.
  useEffect(() => {
    let cancelled = false
    if (!target || target.kind !== 'confirm') { setDup(null); return }
    setDup(null)
    guardConfirmFresh({ handover: target.handover })
      .then(res => { if (!cancelled) setDup(res || { ok: false, failed: true, reason: 'Pemeriksaan dokumen ganda tidak mengembalikan hasil.' }) })
      .catch(err => {
        if (!cancelled) setDup({ ok: false, failed: true, reason: `Pemeriksaan dokumen ganda gagal (${String(err?.message || err)}). Konfirmasi dikunci supaya tidak menandai dokumen yang salah.` })
      })
    return () => { cancelled = true }
  }, [target, dupNonce])

  const orderedFor = useMemo(() => makeOrderedFor(ctx), [ctx])

  if (!target) return null

  const shared = {
    capability: cap,
    say: ctx?.say,
    refresh: ctx?.refresh,
    close: closePhysicalModal
  }

  if (target.kind === 'receipt') {
    const items = target.receiving?.id && ctx?.H?.receivingItemsForReceiving
      ? (ctx.H.receivingItemsForReceiving(target.receiving.id) || [])
      : []
    return <ReceiptForm receiving={target.receiving} items={items} orderedFor={orderedFor} {...shared} />
  }

  if (target.kind === 'return') {
    return <ReturnForm receiving={target.receiving} {...shared} />
  }

  if (target.kind === 'confirm') {
    // Pemeriksaan BELUM SELESAI: jangan merender form, jangan menulis apa pun.
    if (dup === null) {
      return (
        <div className="modal">
          <div className="dialog" data-testid="handover-confirm-dup-checking">
            <div className="dialoghead">
              <h2>Memeriksa dokumen Serah Terima…</h2>
              <button type="button" className="icon" onClick={closePhysicalModal} aria-label="Tutup">×</button>
            </div>
            <p style={{ fontSize: '12.5px', lineHeight: 1.5, margin: 0 }}>
              Memastikan penerimaan ini hanya punya SATU dokumen aktif. Tidak ada data yang ditulis sampai pemeriksaan selesai.
            </p>
          </div>
        </div>
      )
    }
    if (dup.failed) {
      return (
        <BlockedPanel
          testId="handover-confirm-dup-check-failed"
          title="⚠ Konfirmasi dikunci — pemeriksaan gagal"
          text={dup.reason}
          onRetry={() => setDupNonce(n => n + 1)}
        />
      )
    }
    if (!dup.ok) {
      return (
        <BlockedPanel
          testId="handover-confirm-dup-blocked"
          title="⚠ Konfirmasi dikunci — dokumen duplikat"
          text={dup.reason}
        />
      )
    }
    return <HandoverConfirmForm handover={target.handover} {...shared} />
  }

  return null
}

export default PhysicalModalHost
