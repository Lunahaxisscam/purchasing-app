// ============================================================
// modules/requests/leanRequest.js — PENANDA JALUR LEAN (tanpa approval)
// ============================================================
// Arahan DAT (kartu t_a5a73034): request tukang TIDAK butuh approval
// terpisah. Admin langsung menindaklanjuti. TAPI:
//   "JANGAN menganggap semua legacy SUBMITTED tanpa approval_steps otomatis
//    jalur lean; bedakan request baru dengan penanda/kontrak eksplisit yang
//    aman dan teruji, tanpa memalsukan APPROVED/approver atau mass-update
//    histori."
//
// KENAPA PENANDA DI KOLOM TEKS (bukan kolom/enum baru):
//   Skema existing `purchase_requests` hanya punya (id, pr_number, project_id,
//   priority, status, notes, created_at, title, materials_summary) — dibaca
//   read-only dari PostgREST live. Tidak ada kolom penanda jalur, dan DAT
//   melarang DDL live + melarang membuat enum baru hanya untuk label.
//   Preseden yang SUDAH dipakai di aplikasi ini: `lib/purchaseNote.js`
//   menulis penanda skalar `[Nominal: …]`, `[Tahap: DIBELI]` di kolom teks
//   `receivings.note`, dengan SATU parser. File ini mengikuti pola yang sama
//   untuk `purchase_requests.notes`:
//
//     [Jalur: LEAN]            -> request dikirim lewat jalur admin langsung
//                                 (TIDAK ada approval_steps yang dibuat)
//     [Tutup: <alasan>]        -> sisa kebutuhan ditutup admin (alasan wajib)
//     [TutupPada: <ISO>]       -> waktu penutupan (audit sederhana)
//
// KONSEKUENSI YANG SENGAJA DIJAGA:
//   1. Penanda HANYA ditulis oleh jalur lean baru (submitLean). Request
//      legacy SUBMITTED yang tidak punya approval_steps TIDAK otomatis
//      dianggap lean — klasifikasinya 'LEGACY_UNKNOWN' (jujur: status tidak
//      jelas) dan UI menampilkannya sebagai riwayat lama, bukan antrean harian.
//   2. Tidak ada nilai status palsu: status tetap nilai enum existing
//      (DRAFT/SUBMITTED/…), item tetap PENDING_APPROVAL. Label UI yang
//      diterjemahkan (mis. SUBMITTED + lean -> "Siap Ditindaklanjuti").
//   3. Teks catatan manusia TIDAK dihapus: marker dipisah dari teks, dan
//      `stripLeanMarkers()` dipakai sebelum menampilkan/mengedit catatan
//      supaya admin tidak melihat/menghapus penanda teknis.
// ============================================================

export const LEAN_MARKER_KEY = 'Jalur'
export const LEAN_MARKER_VALUE = 'LEAN'

const RE_LEAN = /\[\s*Jalur\s*:\s*LEAN\s*\]/i
const RE_CLOSE = /\[\s*Tutup\s*:\s*([^\]]*)\]/i
const RE_CLOSE_AT = /\[\s*TutupPada\s*:\s*([^\]]*)\]/i
const RE_ANY_MARKER = /\[\s*(?:Jalur|Tutup|TutupPada)\s*:[^\]]*\]/gi

/** True bila catatan PR memuat penanda jalur lean yang ditulis jalur baru. */
export function isLeanMarked(notes) {
  return RE_LEAN.test(String(notes || ''))
}

/** Alasan penutupan sisa (null bila tidak ditutup). */
export function closeReasonOf(notes) {
  const m = String(notes || '').match(RE_CLOSE)
  if (!m) return null
  const reason = String(m[1] || '').trim()
  return reason || null
}

/** Waktu penutupan (string ISO) atau null. */
export function closedAtOf(notes) {
  const m = String(notes || '').match(RE_CLOSE_AT)
  return m ? (String(m[1] || '').trim() || null) : null
}

/**
 * Buang SEMUA penanda teknis dari catatan -> teks manusia saja.
 * Dipakai untuk tampilan catatan & prefill form edit supaya penanda tidak
 * terlihat sebagai catatan dan tidak terhapus saat admin mengedit catatan.
 */
export function stripLeanMarkers(notes) {
  return String(notes || '')
    .replace(RE_ANY_MARKER, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Gabungkan teks catatan manusia + penanda yang sudah ada.
 * `next` = teks manusia baru (boleh kosong); `existingNotes` = catatan DB.
 * Penanda lean/tutup yang sudah ada DIPERTAHANKAN (tidak hilang saat edit).
 * Tidak pernah menduplikasi penanda.
 */
export function composeNotesWithMarkers(next, existingNotes) {
  const human = String(next || '').trim()
  const markers = String(existingNotes || '').match(RE_ANY_MARKER) || []
  const unique = []
  for (const m of markers) {
    const norm = m.replace(/\s+/g, ' ').trim()
    if (!unique.includes(norm)) unique.push(norm)
  }
  const parts = []
  if (human) parts.push(human)
  if (unique.length) parts.push(unique.join(' '))
  return parts.join('\n')
}

/** Catatan + penanda jalur lean (idempotent: penanda tidak dobel). */
export function withLeanMarker(notes) {
  const base = String(notes || '')
  if (isLeanMarked(base)) return base
  const human = stripLeanMarkers(base)
  // Penanda LAIN (mis. [Tutup: …]) dipertahankan — jangan hilang saat kirim.
  const others = (base.match(RE_ANY_MARKER) || []).filter(m => !/\[\s*Jalur\s*:/i.test(m))
  const parts = []
  if (human) parts.push(human)
  parts.push(`[${LEAN_MARKER_KEY}: ${LEAN_MARKER_VALUE}]`)
  if (others.length) parts.push(others.join(' '))
  return parts.join('\n')
}

/** Catatan + penanda penutupan sisa kebutuhan (alasan wajib, idempotent). */
export function withCloseMarker(notes, reason, now = new Date()) {
  const clean = String(reason || '').trim()
  if (!clean) return { ok: false, error: 'Alasan penutupan wajib diisi.' }
  if (clean.includes(']')) return { ok: false, error: 'Alasan tidak boleh memuat karakter "]".' }
  if (clean.length > 300) return { ok: false, error: 'Alasan maksimal 300 karakter.' }
  let base = String(notes || '')
  // Penutupan ulang: ganti penanda lama, jangan menumpuk.
  base = base.replace(RE_CLOSE, ' ').replace(RE_CLOSE_AT, ' ')
  const human = stripLeanMarkers(base)
  const stamp = now instanceof Date ? now.toISOString() : String(now)
  const parts = []
  if (human) parts.push(human)
  if (isLeanMarked(notes)) parts.push(`[${LEAN_MARKER_KEY}: ${LEAN_MARKER_VALUE}]`)
  parts.push(`[Tutup: ${clean}]`)
  parts.push(`[TutupPada: ${stamp}]`)
  return { ok: true, notes: parts.join('\n') }
}

// ============================================================
// KLASIFIKASI JALUR (satu sumber, dipakai UI + service + kontrak Bamboo)
// ============================================================
// Nilai:
//   'DRAFT'          — masih draft (bisa dilanjutkan / dikirim)
//   'LEAN'           — sudah dikirim lewat jalur admin langsung (penanda ada)
//   'LEGACY_APPROVAL'— punya riwayat approval_steps (alur lama, dipertahankan)
//   'LEGACY_UNKNOWN' — status SUBMITTED tanpa penanda DAN tanpa approval_steps
//                      (data lama): TIDAK dianggap lean, tidak diubah massal.
//   'APPROVED'/'REJECTED'/'REVISI' — status lama, apa adanya.
export function classifyRequest(pr, { approvalStepCount = 0 } = {}) {
  const status = String(pr?.status || '').toUpperCase()
  const lean = isLeanMarked(pr?.notes)
  if (status === 'DRAFT') return { key: 'DRAFT', lean, legacy: false }
  if (lean) return { key: 'LEAN', lean: true, legacy: false }
  if (status === 'SUBMITTED') {
    return approvalStepCount > 0
      ? { key: 'LEGACY_APPROVAL', lean: false, legacy: true }
      : { key: 'LEGACY_UNKNOWN', lean: false, legacy: true }
  }
  if (status === 'APPROVED' || status === 'REJECTED' || status === 'REVISI') {
    return { key: status, lean: false, legacy: true }
  }
  return { key: status || 'UNKNOWN', lean: false, legacy: true }
}

/** True hanya bila request benar-benar dikirim lewat jalur lean. */
export function isLeanRequest(pr) {
  return isLeanMarked(pr?.notes)
}

// ============================================================
// LABEL UI JUJUR (nilai enum TIDAK diubah, hanya terjemahan tampilan)
// ============================================================
export function requestStatusLabel(pr, opts = {}) {
  const c = classifyRequest(pr, opts)
  if (c.key === 'LEAN') return 'Siap Ditindaklanjuti'
  if (c.key === 'DRAFT') return 'Draft'
  if (c.key === 'LEGACY_APPROVAL') return 'Antrean Approval (lama)'
  if (c.key === 'LEGACY_UNKNOWN') return 'Submitted lama (tanpa jejak approval)'
  if (c.key === 'APPROVED') return 'Disetujui (lama)'
  if (c.key === 'REJECTED') return 'Ditolak (lama)'
  if (c.key === 'REVISI') return 'Revisi (lama)'
  return String(pr?.status || '—')
}

/** True bila baris ini masih "kerja harian admin" (boleh ditindaklanjuti). */
export function isActionable(pr, opts = {}) {
  const c = classifyRequest(pr, opts)
  return c.key === 'LEAN' || c.key === 'DRAFT'
}
