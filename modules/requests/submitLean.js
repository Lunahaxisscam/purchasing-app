// ============================================================
// modules/requests/submitLean.js — SERVICE BOUNDARY JALUR LEAN (tanpa approval)
// ============================================================
// Arahan DAT (kartu t_a5a73034):
//   - Request tukang TIDAK butuh approval terpisah. Admin langsung
//     menindaklanjuti.
//   - Pengiriman request membuat kebutuhan siap ditindaklanjuti TANPA
//     membuat approval_steps baru, TANPA cangkang nota lewat approval,
//     TANPA cap persetujuan palsu.
//   - Gunakan nilai status existing yang benar-benar didukung. Jangan buat
//     enum/DDL baru hanya untuk label.
//   - Jangan menganggap legacy SUBMITTED tanpa approval_steps otomatis jalur
//     lean: bedakan dengan penanda/kontrak eksplisit (lihat leanRequest.js).
//
// KONTRAK TULIS (yang benar-benar terjadi di DB):
//   purchase_requests.status : 'DRAFT'|'REVISI'  ->  'SUBMITTED'
//   purchase_requests.notes  : catatan manusia + `[Jalur: LEAN]`
//   pr_items.status          : TIDAK DIUBAH (tetap PENDING_APPROVAL / ORDERED)
//   approval_steps           : TIDAK ADA INSERT / UPDATE SAMA SEKALI
//   receivings               : TIDAK ADA baris baru (bukan cangkang nota)
//
// KENAPA status 'SUBMITTED' dan BUKAN 'APPROVED':
//   'APPROVED' berarti disetujui approver. Menulisnya di jalur tanpa approval
//   adalah cap persetujuan palsu. 'SUBMITTED' sudah dipakai data existing
//   (terverifikasi read-only: 2 PR live), jadi tidak butuh enum baru. Yang
//   membedakan jalur lean dari legacy adalah PENANDA `[Jalur: LEAN]`, bukan
//   nilai status. UI menerjemahkan SUBMITTED+LEAN menjadi "Siap
//   Ditindaklanjuti"; SUBMITTED tanpa penanda tetap ditampilkan sebagai
//   riwayat lama (LEGACY_UNKNOWN / LEGACY_APPROVAL).
//
// KENAPA pr_items.status TIDAK diubah:
//   Satu-satunya nilai item yang berarti "boleh dibelanjakan" di modul
//   Purchase adalah APPROVED/ORDERED (modules/receivings/purchaseLogic.js).
//   Menulis APPROVED = memalsukan persetujuan. Jadi item tetap
//   PENDING_APPROVAL dan KELAYAKANNYA DITURUNKAN DARI PENANDA REQUEST.
//   Kontrak untuk task B (Bamboo): item boleh dibeli bila
//     isLeanRequest(parentPR) === true  ATAU  isBuyableStatus(item.status)
//   Lihat docs/lean-request-contract.md §3.
//
// IDEMPOTEN: request yang sudah ber-penanda lean tidak ditulis ulang
// (0 write, hasil `alreadySubmitted: true`). Klik ganda aman.
// ============================================================
import { withLeanMarker, isLeanMarked, stripLeanMarkers, withCloseMarker, composeNotesWithMarkers } from './leanRequest'

const ELIGIBLE_STATUSES = ['DRAFT', 'REVISI']

/**
 * Kirim request lewat jalur lean (tanpa approval).
 * @param pr        baris purchase_requests (butuh .id, .pr_number, .status, .notes)
 * @param options   { supabase, confirmFn, setNotice, loadAll, actionBusy,
 *                    setActionBusy, lockRef }
 * @returns {ok, error?, reason?, alreadySubmitted?, pr_id?, pr_number?}
 */
export async function submitLean(pr, options = {}) {
  const { supabase, confirmFn, setNotice, loadAll, actionBusy, setActionBusy, lockRef } = options

  if (!supabase) {
    if (setNotice) setNotice('Supabase client tidak tersedia.')
    return { ok: false, error: 'Supabase client tidak tersedia' }
  }
  if (actionBusy || (lockRef && lockRef.current)) {
    return { ok: false, error: 'Permintaan sedang diproses, harap tunggu...' }
  }
  if (!pr?.id) return { ok: false, error: 'Request tidak valid (id kosong).' }

  const confirmed = confirmFn
    ? confirmFn(`Kirim request "${pr.pr_number || pr.title || ''}" ke daftar kebutuhan siap dibeli?\n\nTidak perlu approval terpisah — admin langsung menindaklanjuti.`)
    : true
  if (!confirmed) return { ok: false, reason: 'cancelled' }

  if (lockRef) lockRef.current = true
  if (setActionBusy) setActionBusy(true)

  try {
    // 1. Baca status terkini dari DB (cegah stale / race).
    const { data: latest, error: fetchErr } = await supabase
      .from('purchase_requests')
      .select('id, pr_number, title, status, notes, project_id')
      .eq('id', pr.id)
      .single()

    if (fetchErr || !latest) {
      const msg = `Gagal memverifikasi request: ${fetchErr?.message || 'data tidak ditemukan.'}`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }

    const latestStatus = String(latest.status || '').toUpperCase()

    // 2. Idempoten: sudah jalur lean -> tidak menulis apa pun.
    if (isLeanMarked(latest.notes)) {
      const msg = `Request ${latest.pr_number || ''} sudah dikirim lewat jalur admin (siap ditindaklanjuti). Tidak ada perubahan.`
      if (setNotice) setNotice(msg)
      return { ok: true, alreadySubmitted: true, pr_id: latest.id, pr_number: latest.pr_number }
    }

    if (!ELIGIBLE_STATUSES.includes(latestStatus)) {
      const msg = `Request ${latest.pr_number || ''} tidak dapat dikirim (status: ${latest.status || 'tidak diketahui'}). Hanya DRAFT atau REVISI.`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }

    // 3. Validasi item: tidak kosong, nama ada, qty > 0. Tidak mengubah status item.
    const { data: items, error: itemsErr } = await supabase
      .from('pr_items')
      .select('id, pr_id, item_name, quantity, unit, status')
      .eq('pr_id', latest.id)

    if (itemsErr) {
      const msg = `Gagal membaca item request: ${itemsErr.message}`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }
    if (!items || items.length === 0) {
      const msg = `Request ${latest.pr_number || ''} belum punya item — tambahkan minimal 1 item.`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }
    for (const it of items) {
      if (!String(it.item_name || '').trim()) {
        const msg = 'Item tidak valid: nama item kosong.'
        if (setNotice) setNotice(msg)
        return { ok: false, error: msg }
      }
      const qty = Number(it.quantity)
      if (!isFinite(qty) || qty <= 0) {
        const msg = `Item "${it.item_name}" punya qty tidak valid (${it.quantity}).`
        if (setNotice) setNotice(msg)
        return { ok: false, error: msg }
      }
    }

    // 4. Tulis status existing + penanda. Catatan manusia DIPERTAHANKAN.
    const nextNotes = withLeanMarker(composeNotesWithMarkers(stripLeanMarkers(latest.notes), latest.notes))
    const { error: upErr } = await supabase
      .from('purchase_requests')
      .update({ status: 'SUBMITTED', notes: nextNotes })
      .eq('id', latest.id)

    if (upErr) {
      const msg = `Gagal mengirim request: ${upErr.message}`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }

    // 5. Readback: status & penanda benar-benar tersimpan.
    const { data: verify, error: vErr } = await supabase
      .from('purchase_requests')
      .select('id, status, notes')
      .eq('id', latest.id)
      .single()

    if (vErr || !verify || String(verify.status).toUpperCase() !== 'SUBMITTED' || !isLeanMarked(verify.notes)) {
      const msg = `Verifikasi gagal: request belum tercatat siap ditindaklanjuti (status ${verify?.status || 'tidak terbaca'}).`
      if (setNotice) setNotice(msg)
      if (loadAll) loadAll()
      return { ok: false, error: msg }
    }

    if (setNotice) setNotice(`Request ${latest.pr_number || ''} terkirim — siap ditindaklanjuti admin (tanpa approval).`)
    if (loadAll) loadAll()
    return { ok: true, pr_id: latest.id, pr_number: latest.pr_number, itemCount: items.length }
  } finally {
    if (lockRef) lockRef.current = false
    if (setActionBusy) setActionBusy(false)
  }
}

/**
 * Tutup sisa kebutuhan request dengan alasan singkat.
 * TIDAK mengubah qty permintaan asli, TIDAK mengubah status, TIDAK
 * memalsukan pemenuhan: hanya menambah penanda `[Tutup: alasan]`.
 * @returns {ok, error?, notes?}
 */
export async function closeRequestRemaining(pr, reason, options = {}) {
  const { supabase, confirmFn, setNotice, loadAll, actionBusy, setActionBusy, lockRef } = options

  if (!supabase) return { ok: false, error: 'Supabase client tidak tersedia' }
  if (actionBusy || (lockRef && lockRef.current)) return { ok: false, error: 'Permintaan sedang diproses, harap tunggu...' }
  if (!pr?.id) return { ok: false, error: 'Request tidak valid (id kosong).' }

  const composed = withCloseMarker(pr.notes, reason)
  if (!composed.ok) {
    if (setNotice) setNotice(composed.error)
    return { ok: false, error: composed.error }
  }

  const confirmed = confirmFn
    ? confirmFn(`Tutup sisa kebutuhan request "${pr.pr_number || pr.title || ''}"?\n\nQty permintaan asli TIDAK diubah. Alasan: ${String(reason).trim()}`)
    : true
  if (!confirmed) return { ok: false, reason: 'cancelled' }

  if (lockRef) lockRef.current = true
  if (setActionBusy) setActionBusy(true)
  try {
    const { error } = await supabase
      .from('purchase_requests')
      .update({ notes: composed.notes })
      .eq('id', pr.id)
    if (error) {
      const msg = `Gagal menutup sisa kebutuhan: ${error.message}`
      if (setNotice) setNotice(msg)
      return { ok: false, error: msg }
    }
    if (setNotice) setNotice(`Sisa kebutuhan ${pr.pr_number || ''} ditutup. Qty permintaan asli tetap tersimpan.`)
    if (loadAll) loadAll()
    return { ok: true, notes: composed.notes }
  } finally {
    if (lockRef) lockRef.current = false
    if (setActionBusy) setActionBusy(false)
  }
}
