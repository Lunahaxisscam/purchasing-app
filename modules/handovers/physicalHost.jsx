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
// ============================================================
import React, { useEffect, useMemo, useState } from 'react'
import { usePhysicalModal, closePhysicalModal } from './physicalModal'
import { getReceiptCapability } from '../receivings/receiptCapability'
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

export function PhysicalModalHost({ ctx }) {
  const target = usePhysicalModal()
  const [cap, setCap] = useState(null)

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
    return <HandoverConfirmForm handover={target.handover} {...shared} />
  }

  return null
}

export default PhysicalModalHost
