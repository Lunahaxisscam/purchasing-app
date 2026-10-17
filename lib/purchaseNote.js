// ============================================================
// lib/purchaseNote.js — KONTRAK CATATAN NOTA BELANJA (kolom teks existing)
// ============================================================
// Modul Purchase mencatat nota belanja ke kolom yang SUDAH ADA (skema beku:
// tidak ada migrasi dijalankan oleh task ini). Supaya tidak ada "packing
// JSON", setiap dimensi ditulis sebagai SATU penanda skalar yang punya
// parser tunggal di file ini:
//
//   receivings.note
//     [Nominal: Rp 1.250.000]      -> subtotal MATERIAL (dasar biaya material
//                                     Finance/ProjectFinance — format lama,
//                                     tetap dibaca parseNominalFromNote)
//     [BiayaLain: Rp 25.000]       -> ongkir / biaya tambahan toko (beban
//                                     operasional WS, BUKAN harga material)
//     [Diskon: Rp 10.000]          -> diskon toko (mengurangi total nota)
//     [Nota: <url|no. resi>]       -> referensi nota (format lama)
//     [BuktiNota: <data-url>]      -> foto nota/struk (opsional)
//     [BuktiTransfer: <data-url>]  -> bukti transfer/pembayaran (opsional)
//     [Tahap: DIBELI]              -> penanda tahap bila kolom status tidak
//                                     bisa diisi 'DIBELI' (CHECK constraint)
//     <catatan bebas>
//
//   receiving_items.note
//     [Harga: 125000]              -> harga satuan RIIL NETTO per unit yang
//                                     benar-benar dibayar di nota toko.
//                                     Inilah sumber acuan harga historis
//                                     (dibaca modules/materials/acuan.js).
//
// Bila schema owner (t_03b41644) menambahkan kolom asli, kode membaca kolom
// lebih dulu (unit_price/price_actual) dan penanda hanya menjadi fallback —
// lihat receivingItemActualPrice() di modules/materials/acuan.js.
// ============================================================

export const PURCHASED_STATUS = 'DIBELI'
export const TAHAP_DIBELI = 'DIBELI'

function toDigits(v) {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : null
}

function toMoney(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  if (!isFinite(n)) return null
  return Math.round(n)
}

function fmtRp(n) {
  return new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))
}

// Baca SEMUA penanda dari catatan nota. Data lama (tanpa penanda) aman:
// seluruh teksnya masuk `catatan`, angka null.
export function parsePurchaseNote(note) {
  const s = String(note || '')
  const grab = (re) => {
    const m = s.match(re)
    return m ? String(m[1] || '').trim() : ''
  }
  const material = toDigits(grab(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i))
  const biayaLain = toDigits(grab(/\[BiayaLain:\s*Rp\s*([\d.,]+)\s*\]/i))
  const diskon = toDigits(grab(/\[Diskon:\s*Rp\s*([\d.,]+)\s*\]/i))
  const notaUrl = grab(/\[Nota:\s*([^\]]+)\]/i)
  const buktiNota = grab(/\[BuktiNota:\s*([^\]]+)\]/i)
  const buktiTransfer = grab(/\[BuktiTransfer:\s*([^\]]+)\]/i)
  const tahap = grab(/\[Tahap:\s*([^\]]+)\]/i).toUpperCase()
  const catatan = s
    .replace(/\[Nominal:[^\]]*\]/ig, ' ')
    .replace(/\[BiayaLain:[^\]]*\]/ig, ' ')
    .replace(/\[Diskon:[^\]]*\]/ig, ' ')
    .replace(/\[Nota:[^\]]*\]/ig, ' ')
    .replace(/\[BuktiNota:[^\]]*\]/ig, ' ')
    .replace(/\[BuktiTransfer:[^\]]*\]/ig, ' ')
    .replace(/\[Tahap:[^\]]*\]/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const total = material === null
    ? null
    : Math.max(0, material + (biayaLain || 0) - (diskon || 0))

  return {
    material, biayaLain, diskon, notaUrl, buktiNota, buktiTransfer, tahap, catatan, total
  }
}

// Susun ulang catatan nota dari isian form. Nilai 0 / kosong tidak ditulis
// supaya penanda tidak menumpuk angka nol yang tidak berarti.
export function buildPurchaseNote({
  material, biayaLain, diskon, notaUrl, buktiNota, buktiTransfer, catatan, tahap
} = {}) {
  const parts = []
  const mat = toMoney(material)
  if (mat !== null && mat > 0) parts.push(`[Nominal: Rp ${fmtRp(mat)}]`)
  const lain = toMoney(biayaLain)
  if (lain !== null && lain > 0) parts.push(`[BiayaLain: Rp ${fmtRp(lain)}]`)
  const disc = toMoney(diskon)
  if (disc !== null && disc > 0) parts.push(`[Diskon: Rp ${fmtRp(disc)}]`)
  const nota = String(notaUrl || '').trim()
  if (nota) parts.push(`[Nota: ${nota}]`)
  const bn = String(buktiNota || '').trim()
  if (bn) parts.push(`[BuktiNota: ${bn}]`)
  const bt = String(buktiTransfer || '').trim()
  if (bt) parts.push(`[BuktiTransfer: ${bt}]`)
  const tp = String(tahap || '').trim().toUpperCase()
  if (tp) parts.push(`[Tahap: ${tp}]`)
  const extra = String(catatan || '').trim()
  if (extra) parts.push(extra)
  return parts.length ? parts.join(' ') : null
}

// Harga satuan riil per item (receiving_items.note).
export function buildItemPriceNote(harga) {
  const n = toMoney(harga)
  if (n === null || n <= 0) return null
  return `[Harga: ${n}]`
}

export function parseItemPrice(note) {
  const m = String(note || '').match(/\[Harga:\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const n = toDigits(m[1])
  return n && n > 0 ? n : null
}

// Nota dianggap "sudah dibeli" bila status kolom ATAU penanda tahap
// menyatakan DIBELI (fallback saat kolom status dibatasi CHECK constraint).
export function isPurchasedNota(rec) {
  if (!rec) return false
  if (String(rec.status || '').toUpperCase() === PURCHASED_STATUS) return true
  return parsePurchaseNote(rec.note).tahap === TAHAP_DIBELI
}
