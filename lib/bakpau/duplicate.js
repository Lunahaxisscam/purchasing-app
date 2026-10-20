// ============================================================
// lib/bakpau/duplicate.js — IDENTITAS BUKTI & KEPUTUSAN DUPLIKAT
// ============================================================
// DUA LAPIS IDEMPOTENSI (dipisah sengaja, sesuai arahan DAT):
//   LAPIS 1 — EVENT per kanal.  channelKey = `telegram:<chat>:<msg>` /
//             `whatsapp:<chat>:<msg>`. Event yang sama (retry, race, webhook
//             dikirim dua kali) TIDAK PERNAH diproses dua kali.
//   LAPIS 2 — BUKTI lintas kanal. evidenceHash = SHA-256 dari bukti yang
//             SUDAH dinormalisasi (vendor namespace + nota literal + tanggal
//             + baris barang). Bukti yang sama dari Telegram, WA, atau admin
//             menghasilkan hash yang sama -> satu transaksi, bukan tiga.
//
// KENAPA TIDAK MEMAKAI "nomor nota / total / item sama" SAJA:
//   Temuan verifikasi A: kunci yang membuang tanda baca bisa bertabrakan
//   ('A-12' vs 'A1-2'). Nomor nota juga TIDAK unik lintas vendor (nota
//   "001" ada di banyak toko), dan total+item yang sama bisa jadi pembelian
//   berulang yang SAH (beli triplek lagi minggu depan). Karena itu:
//
//   * evidenceHash memakai nomor nota LITERAL (tanda baca dipertahankan) dan
//     SELALU menyertakan namespace vendor + tanggal. Bukan fuzzy key.
//   * "Nomor nota sama tapi isi berbeda" -> BUKAN duplikat, tapi KONFLIK
//     yang harus diklarifikasi (tidak auto-merge, tidak auto-insert).
//   * "Nomor nota sama DAN isi sama" -> duplikat bukti (satu transaksi).
//   * "Isi sama tapi nomor nota berbeda" -> pembelian berulang yang SAH.
//   * Tanpa nomor nota vendor: identitas bukti memakai hash isi + tanggal;
//     nota tanpa nomor yang identik pada hari yang sama = duplikat bukti.
// ============================================================

import crypto from 'node:crypto'
import { literalKey } from './resolve.js'

function canonicalNumber(n) {
  const v = Number(n)
  if (!isFinite(v)) return 'NaN'
  return String(Math.round(v * 1000) / 1000)
}

// Vendor namespace: id vendor bila sudah terpetakan, selain itu nama LITERAL
// yang dinormalisasi ringan (hanya spasi & huruf). TIDAK membuang tanda baca
// pada nama toko karena nama toko bisa membedakan cabang ("TB A-12" vs
// "TB A12" adalah dua toko berbeda secara literal).
export function vendorNamespace({ vendorId, vendorName } = {}) {
  const id = literalKey(vendorId)
  if (id) return `id:${id}`
  const name = literalKey(vendorName).toLowerCase()
  return name ? `name:${name}` : ''
}

// Bentuk kanonik bukti yang stabil & dapat direproduksi.
// Urutan baris TIDAK memengaruhi hash (diurutkan), tapi isi setiap baris
// (nama literal, qty, satuan, harga) YA.
export function canonicalEvidence({ vendorId, vendorName, invoiceNo, date, biayaLain = 0, diskon = 0, lines = [] } = {}) {
  const ns = vendorNamespace({ vendorId, vendorName })
  const rows = (lines || []).map(l => [
    literalKey(l.itemName).toLowerCase(),
    canonicalNumber(l.qty),
    String(l.unit || '').toLowerCase(),
    canonicalNumber(l.harga),
    literalKey(l.spec || '').toLowerCase(),
    literalKey(l.projectId || '')
  ].join('~')).sort()
  return JSON.stringify({
    v: 1,
    ns,
    invoice: literalKey(invoiceNo).toLowerCase(),   // LITERAL, bukan normKey
    date: literalKey(date),
    biayaLain: canonicalNumber(biayaLain),
    diskon: canonicalNumber(diskon),
    rows
  })
}

export function evidenceHashOf(evidence) {
  const canon = canonicalEvidence(evidence)
  return `sha256:${crypto.createHash('sha256').update(canon, 'utf8').digest('hex')}`
}

// ------------------------------------------------------------
// KEPUTUSAN DUPLIKAT
// ------------------------------------------------------------
// existing = daftar nota yang sudah tercatat (dari DB atau mock), masing-masing:
//   { id, vendorId, invoiceNo, date, evidenceHash, total, itemNames:[…], channel }
//
// Return salah satu:
//   { kind:'duplicate_evidence' }   -> sudah ada transaksi untuk bukti ini
//   { kind:'conflict_invoice' }     -> nomor nota sama, isi beda -> klarifikasi
//   { kind:'new' }                  -> boleh dibuat transaksi baru
export function decideDuplicate({ incoming, existing = [] } = {}) {
  const inc = {
    vendorId: incoming?.vendorId || null,
    vendorName: incoming?.vendorName || '',
    invoiceNo: literalKey(incoming?.invoiceNo),
    evidenceHash: incoming?.evidenceHash || ''
  }
  const incNs = vendorNamespace(inc)
  const list = existing || []

  // (1) Bukti identik (hash sama) -> duplikat. Hash sudah memuat namespace
  //     vendor + nota literal + tanggal + isi baris, jadi tidak mungkin
  //     bertabrakan hanya karena total/kemiripan nama.
  if (inc.evidenceHash) {
    const hit = list.find(e => String(e?.evidenceHash || '') === inc.evidenceHash)
    if (hit) {
      return {
        kind: 'duplicate_evidence',
        existing: hit,
        message: `Bukti yang sama sudah tercatat sebagai nota ${hit.invoiceNo || '(tanpa nomor)'}` +
          (hit.id ? ` (id ${hit.id})` : '') + ' — tidak dicatat ulang.'
      }
    }
  }

  // (2) Nomor nota sama DALAM NAMESPACE VENDOR YANG SAMA.
  //     Nomor nota tidak unik lintas vendor -> namespace wajib sama.
  if (inc.invoiceNo) {
    const sameNs = list.filter(e => vendorNamespace({ vendorId: e?.vendorId, vendorName: e?.vendorName }) === incNs)
    const sameNo = sameNs.filter(e => literalKey(e?.invoiceNo).toLowerCase() === inc.invoiceNo.toLowerCase())
    if (sameNo.length) {
      // Isi sama tetapi hash berbeda bisa terjadi bila hash lama tidak ada
      // (nota dari admin). Bandingkan total + nama barang sebagai bukti
      // pendukung — tetap TIDAK auto-merge, hanya untuk membedakan
      // "duplikat" dari "konflik".
      const exact = sameNo.find(e => {
        const t = Number(e?.total)
        const u = Number(incoming?.total)
        if (!isFinite(t) || !isFinite(u) || Math.round(t) !== Math.round(u)) return false
        const a = (e?.itemNames || []).map(n => literalKey(n).toLowerCase()).sort().join('|')
        const b = (incoming?.itemNames || []).map(n => literalKey(n).toLowerCase()).sort().join('|')
        return !!a && a === b
      })
      if (exact) {
        return {
          kind: 'duplicate_evidence',
          existing: exact,
          message: `Nota ${inc.invoiceNo} dari toko yang sama dengan isi yang sama sudah tercatat — tidak dicatat ulang.`
        }
      }
      return {
        kind: 'conflict_invoice',
        existing: sameNo[0],
        candidates: sameNo,
        message: `Nomor nota ${inc.invoiceNo} sudah dipakai di toko yang sama tetapi ISI-nya berbeda. ` +
          'Tidak digabung otomatis — perlu klarifikasi (nota koreksi, nota berbeda, atau salah nomor?).'
      }
    }
  }

  return { kind: 'new' }
}
