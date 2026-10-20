// ============================================================
// lib/bakpau/markers.js — PENANDA JEJAK KONEKTOR DI KOLOM TEKS EXISTING
// ============================================================
// Skema DB dibekukan (tidak ada DDL di lane ini). Karena itu jejak konektor
// ditulis sebagai penanda skalar di kolom teks yang SUDAH ADA, mengikuti pola
// yang sudah dipakai aplikasi ini (lib/purchaseNote.js untuk nominal/tahap,
// modules/requests/leanRequest.js untuk penanda jalur):
//
//   receivings.note
//     [BakpauEvent: telegram:1320969465:4412]   -> identitas event kanal
//     [BuktiHash: sha256:9f2c…]                 -> identitas BUKTI (lintas kanal)
//     [Kanal: telegram|whatsapp|admin]          -> asal input
//     [Pengirim: 1320969465]                    -> identitas pengirim
//     [Pesan: 4412]                             -> id pesan platform
//
//   receiving_items.note  (selain [Harga: n] milik purchaseNote)
//     [Spek: 3mm]        -> spek AKTUAL dari bukti
//     [SpekAwal: 2mm]    -> spek AWAL dari baris PR (tidak pernah ditimpa)
//     [Proyek: <uuid>]   -> alokasi proyek PER BARIS (satu nota lintas proyek)
//     [PRItem: <uuid>]   -> tautan baris kebutuhan (opsional per baris)
//
// ATURAN PENTING:
//   1. Penanda TIDAK ditulis ke nota kecuali nilainya benar-benar ada. Tidak
//      ada nilai karangan/placeholder.
//   2. `parseConnectorMarkers` adalah SATU-SATUNYA parser; jangan membaca
//      penanda dengan regex lepas di tempat lain (bisa menyimpang).
//   3. Penanda di `receivings.note` TIDAK merusak `parsePurchaseNote`: fungsi
//      itu hanya membuang penanda yang ia kenal, sisanya masuk `catatan`.
//      Karena itu adapter menambahkan penanda HANYA ke nota yang dibuat
//      konektor dan menyimpannya SETELAH teks catatan manusia, sehingga teks
//      yang dibaca UI tetap utuh (lihat `appendMarkers`).
// ============================================================

import { MARK } from './constants.js'

function esc(v) {
  return String(v ?? '').replace(/[[\]]/g, '').trim()
}

// Bangun satu penanda; string kosong -> '' (tidak menulis penanda kosong).
export function mark(key, value) {
  const v = esc(value)
  return v ? `[${key}: ${v}]` : ''
}

// Rangkai daftar penanda menjadi satu string (abaikan yang kosong).
export function joinMarks(list) {
  return (list || []).filter(Boolean).join(' ')
}

// Penanda identitas event + bukti untuk header nota.
export function buildEventMarks({ eventKey, evidenceHash, channel, senderId, messageId } = {}) {
  return joinMarks([
    mark(MARK.EVENT, eventKey),
    mark(MARK.EVIDENCE, evidenceHash),
    mark(MARK.CHANNEL, channel),
    mark(MARK.SENDER, senderId),
    mark(MARK.MSG, messageId)
  ])
}

// Penanda per baris barang.
export function buildItemMarks({ spec, specAwal, projectId, prItemId } = {}) {
  return joinMarks([
    mark(MARK.SPEC, spec),
    mark(MARK.SPEC_AWAL, specAwal),
    mark(MARK.PROYEK, projectId),
    mark('PRItem', prItemId)
  ])
}

// Baca satu nilai penanda ('' bila tidak ada).
function grab(text, key) {
  const m = String(text || '').match(new RegExp(`\\[${key}:\\s*([^\\]]*)\\]`, 'i'))
  return m ? String(m[1] || '').trim() : ''
}

// Parser tunggal untuk semua penanda konektor.
export function parseConnectorMarkers(note) {
  const s = String(note || '')
  return {
    eventKey: grab(s, MARK.EVENT),
    evidenceHash: grab(s, MARK.EVIDENCE),
    channel: grab(s, MARK.CHANNEL).toLowerCase(),
    senderId: grab(s, MARK.SENDER),
    messageId: grab(s, MARK.MSG),
    spec: grab(s, MARK.SPEC),
    specAwal: grab(s, MARK.SPEC_AWAL),
    projectId: grab(s, MARK.PROYEK),
    prItemId: grab(s, 'PRItem'),
    // Penanda konektor dibuang dari teks tampilan supaya catatan manusia tetap
    // bersih di UI (tanpa mengubah penanda nota lain milik purchaseNote).
    catatanBersih: s
      .replace(/\[BakpauEvent:[^\]]*\]/ig, ' ')
      .replace(/\[BuktiHash:[^\]]*\]/ig, ' ')
      .replace(/\[Kanal:[^\]]*\]/ig, ' ')
      .replace(/\[Pengirim:[^\]]*\]/ig, ' ')
      .replace(/\[Pesan:[^\]]*\]/ig, ' ')
      .replace(/\[Spek:[^\]]*\]/ig, ' ')
      .replace(/\[SpekAwal:[^\]]*\]/ig, ' ')
      .replace(/\[Proyek:[^\]]*\]/ig, ' ')
      .replace(/\[PRItem:[^\]]*\]/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

// Tambahkan penanda ke catatan nota yang SUDAH dirangkai purchaseNote.
// Teks asli tidak diubah urutannya; penanda ditaruh di akhir.
export function appendMarkers(note, marks) {
  const base = String(note || '').trim()
  const extra = String(marks || '').trim()
  if (!extra) return base || null
  return base ? `${base} ${extra}` : extra
}

// Apakah catatan memuat penanda event tertentu? (dipakai cek idempotensi)
export function hasEventMarker(note, eventKey) {
  if (!eventKey) return false
  return parseConnectorMarkers(note).eventKey === String(eventKey)
}

export function hasEvidenceMarker(note, evidenceHash) {
  if (!evidenceHash) return false
  return parseConnectorMarkers(note).evidenceHash === String(evidenceHash)
}
