// ============================================================
// LIB BAKPAU: VOID BARIS + REBUILD NOMINAL (PAKET 1)
// ============================================================
// Dipakai oleh endpoint purchases/edit untuk memenuhi brief Bakpau §5A.
//
// MASALAH YANG DIPERBAIKI:
//   1. Baris tidak bisa dinolkan -> nota duplikat tetap menambah cost.
//      Sekarang baris bisa di-VOID: harga 0 SAH dan ditandai eksplisit
//      `[Void: 1] [AlasanVoid: ...]` sehingga tetap terlihat tapi tidak
//      dihitung ke total/P&L.
//   2. Header `[Nominal: Rp ...]` dibiarkan basi setelah item diubah
//      (nota duplikat: header 282.000 padahal item [Harga: 1]).
//      Sekarang nominal header DIHITUNG ULANG dari baris efektif.
//
// KENAPA buildItemPriceNote() TIDAK DIPAKAI UNTUK HARGA 0:
//   Fungsi itu mengembalikan null untuk harga <= 0 (0 dianggap "tidak
//   tercatat"). Untuk void kita justru butuh penanda eksplisit harga 0,
//   jika tidak parser membacanya sebagai "harga tak diketahui".
// ============================================================

export const VOID_MARK = 'Void'
export const VOID_REASON_MARK = 'AlasanVoid'

export function fmtRp(n) {
  const v = Math.round(Number(n) || 0)
  return new Intl.NumberFormat("id-ID").format(v)
}

// Penanda harga untuk satu baris. harga 0 + void=false -> null (tak tercatat).
// harga 0 + void=true  -> "[Harga: 0]" (sah, nol disengaja).
export function buildItemPriceNoteLoose(harga, { voided = false } = {}) {
  const n = Math.round(Number(harga))
  if (!Number.isFinite(n) || n < 0) return null
  if (n === 0 && !voided) return '[Harga: 0]'
  return `[Harga: ${n}]`
}

// Tandai baris void: pertahankan penanda harga, tambah penanda void + alasan.
export function markItemVoid(note, reason) {
  const base = String(note || '')
    .replace(/\[Void:\s*[^\]]*\]/ig, ' ')
    .replace(/\[AlasanVoid:[^\]]*\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const r = String(reason || '').replace(/[[\]]/g, '').trim().slice(0, 200)
  return [base, `[${VOID_MARK}: 1]`, r ? `[${VOID_REASON_MARK}: ${r}]` : ''].filter(Boolean).join(' ')
}

// Baca harga satuan dari note baris: [Harga: n]. 0 SAH (baris dibatalkan).
// null = penanda tidak ada (data lama) â bukan nol.
export function parseHargaFromNote(note) {
  const m = String(note || '').match(/\[Harga:\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const n = Number(String(m[1]).replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function isItemVoided(note) {
  return /\[Void:\s*1\s*\]/i.test(String(note || ''))
}

// Total baris efektif: baris void = 0 walau harga tersimpan.
export function effectiveLineTotal(qty, harga, note) {
  if (isItemVoided(note)) return 0
  return (Number(qty) || 0) * (Number(harga) || 0)
}

// ------------------------------------------------------------
// Rebuild header note: hitung ulang [Nominal] dari baris, sisakan
// SEMUA penanda lain apa adanya (BuktiNota, Nota, Tahap, BakpauEvent, ...).
// ------------------------------------------------------------
export function rebuildHeaderNominal(note, lineTotal) {
  const s = String(note || '')
  const total = Math.round(Number(lineTotal) || 0)
  const hasNominal = /\[Nominal:[^\]]*\]/i.test(s)
  const nominalMark = `[Nominal: Rp ${fmtRp(total)}]`
  if (hasNominal) {
    return s.replace(/\[Nominal:[^\]]*\]/i, nominalMark)
  }
  // Data lama tanpa penanda nominal: jangan mengarang, cukup tambahkan bila
  // memang ada nilai baris (0 = tidak perlu penanda).
  if (total <= 0) return s.trim()
  return `${nominalMark} ${s}`.trim()
}
