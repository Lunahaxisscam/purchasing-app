// ============================================================
// modules/requests/submit.js — Service boundary submit & submit-ulang PR (t_3032ecb7)
// ============================================================
// ⚠️ t_50b783de (Approval OFF): handler ini adalah KONEKTOR APPROVAL (menulis
// approval_steps + memanggil alert Telegram approval). Saat modul Approval
// dimatikan, seluruh handler FAIL CLOSED di baris pertama: tidak ada SELECT,
// tidak ada INSERT/UPDATE, tidak ada RPC, tidak ada alert. PR REJECTED yang
// diperbaiki dikirim lewat jalur lean (modules/requests/submitLean.js) dengan
// ID yang sama — bukan lewat file ini.
//
// Menangani pengiriman PR ke antrean Approval:
// 1. PR DRAFT / REVISI -> pertama kali atau setelah revisi dikirim ke Approval.
// 2. PR REJECTED -> 'Submit Ulang' setelah diperbaiki admin/user.
//
// Prinsip & Kontrak:
// - Menggunakan PR ID dan pr_number yang SAMA (tidak membuat baris/nomor PR baru).
// - Tidak mem-bypass modul approval (tidak auto-approve).
// - Tidak memicu pembelian baru (pembelian hanya melalui modul Purchase).
// - Validasi kelayakan di service boundary (bukan cuma UI):
//     * Status harus DRAFT, REVISI, atau REJECTED.
//     * Memverifikasi status terkini dari DB (mencegah stale/race condition).
//     * Menolak PR kosong (0 item).
//     * Menolak item dengan nama kosong atau qty <= 0 / NaN.
//     * Tidak me-reset item yang sudah berstatus ORDERED.
//     * Jika semua item sudah ORDERED, tolak submit ulang.
// - Menyiapkan / mengaktifkan kembali approval step PENDING tanpa duplikasi step.
// - Mempertahankan catatan penolakan lama (rejection reason) di approval_steps.
// - Non-atomic write dicek seksama & diverifikasi melalui readback.
// - Guard actionBusy & lock ref mencegah klik ganda (double-click).
// ============================================================
import { approvalGuard } from '../../lib/constants'

export async function handleFinishPr(pr, options = {}) {
  // GATE PERTAMA (fail closed): tidak ada write/call sama sekali saat OFF.
  const gate = approvalGuard('submit-legacy')
  if (!gate.ok) {
    if (options.setNotice) options.setNotice(gate.error)
    return { ok: false, disabled: true, code: gate.code, error: gate.error }
  }

  const {
    supabase,
    session,
    confirmFn,
    setNotice,
    loadAll,
    actionBusy,
    setActionBusy,
    lockRef,
    sendPrAlert
  } = options

  if (!supabase) {
    if (setNotice) setNotice('Supabase client tidak tersedia.')
    return { ok: false, error: 'Supabase client tidak tersedia' }
  }

  // 1. Guard klik ganda via synchronous lock ref & actionBusy
  if (actionBusy || (lockRef && lockRef.current)) {
    return { ok: false, error: 'Permintaan sedang diproses, harap tunggu...' }
  }

  // 2. Validasi status awal dari objek PR
  const currentStatus = String(pr?.status || '').toUpperCase()
  const isResubmit = currentStatus === 'REJECTED'
  const isEligible = ['DRAFT', 'REVISI', 'REJECTED'].includes(currentStatus)
  if (!isEligible) {
    const msg = `PR ${pr?.pr_number || ''} tidak dapat diajukan (status saat ini: ${pr?.status || 'tidak diketahui'}). Hanya DRAFT, REVISI, atau REJECTED yang dapat diajukan.`
    if (setNotice) setNotice(msg)
    return { ok: false, error: msg }
  }

  // 3. Konfirmasi jelas sebelum ada penulisan ke DB
  const confirmMsg = isResubmit
    ? `Kirim ulang PR "${pr?.pr_number || pr?.title || ''}" ke antrean Approval (menunggu persetujuan)?`
    : `Tandai PR "${pr?.pr_number || pr?.title || ''}" selesai dan kirim ke modul Approval?`

  const confirmed = confirmFn ? confirmFn(confirmMsg) : true
  if (!confirmed) {
    // 0 writes saat pembatalan
    return { ok: false, reason: 'cancelled' }
  }

  // Pasang lock
  if (lockRef) lockRef.current = true
  if (setActionBusy) setActionBusy(true)

  try {
    // 4. Verifikasi status terkini dari DB (Service Boundary Guard)
    const { data: latestPr, error: fetchErr } = await supabase
      .from('purchase_requests')
      .select('id, pr_number, title, status, project_id, priority, notes, materials_summary')
      .eq('id', pr.id)
      .single()

    if (fetchErr || !latestPr) {
      const errMsg = `Gagal memverifikasi status PR: ${fetchErr?.message || 'Data PR tidak ditemukan di database.'}`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    const latestStatus = String(latestPr.status || '').toUpperCase()
    if (!['DRAFT', 'REVISI', 'REJECTED'].includes(latestStatus)) {
      const errMsg = `PR ${latestPr.pr_number || pr.pr_number || ''} tidak dapat diajukan karena berstatus ${latestPr.status}. Hanya PR DRAFT, REVISI, atau REJECTED yang dapat diajukan.`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    // 5. Validasi item PR (no empty items, valid qty, no meaningfulemptyitems)
    const { data: items, error: itemsErr } = await supabase
      .from('pr_items')
      .select('id, pr_id, item_name, quantity, unit, status, estimated_price')
      .eq('pr_id', pr.id)

    if (itemsErr) {
      const errMsg = `Gagal membaca item PR: ${itemsErr.message}`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    if (!items || items.length === 0) {
      const errMsg = `PR ${latestPr.pr_number} tidak memiliki item barang — tambahkan minimal 1 item sebelum mengajukan approval.`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    for (const it of items) {
      if (!it.item_name || !String(it.item_name).trim()) {
        const errMsg = `Item PR tidak valid: nama item kosong.`
        if (setNotice) setNotice(errMsg)
        return { ok: false, error: errMsg }
      }
      const qty = Number(it.quantity)
      if (isNaN(qty) || qty <= 0) {
        const errMsg = `Item "${it.item_name}" memiliki quantity tidak valid (${it.quantity}). Minimal quantity adalah > 0.`
        if (setNotice) setNotice(errMsg)
        return { ok: false, error: errMsg }
      }
    }

    // Periksa status item individual: jangan pernah me-reset item yang sudah ORDERED
    const allOrdered = items.every(it => String(it.status || '').toUpperCase() === 'ORDERED')
    if (allOrdered) {
      const errMsg = `Semua item dalam PR ${latestPr.pr_number} sudah berstatus ORDERED (tidak dapat diajukan ulang ke approval).`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    // 6. Siapkan approval step PENDING tanpa membuat step duplikat
    const { data: steps, error: stepsErr } = await supabase
      .from('approval_steps')
      .select('id, step_number, status, note')
      .eq('purchase_request_id', pr.id)
      .order('step_number', { ascending: true })

    if (stepsErr) {
      const errMsg = `Gagal membaca antrean approval: ${stepsErr.message}`
      if (setNotice) setNotice(errMsg)
      return { ok: false, error: errMsg }
    }

    if (steps && steps.length) {
      // Step sudah ada (PR pernah diajukan/direvisi/ditolak)
      // Aktifkan kembali step pertama. Catatan penolakan sebelumnya TIDAK dihapus.
      const { error: stErr } = await supabase.from('approval_steps').update({
        status: 'PENDING',
        decided_at: null
      }).eq('id', steps[0].id)

      if (stErr) {
        const errMsg = `Gagal mengaktifkan approval: ${stErr.message}`
        if (setNotice) setNotice(errMsg)
        return { ok: false, error: errMsg }
      }
    } else {
      // Approval step baru untuk PR draft awal
      let approverId = session?.user?.id || null
      if (!approverId) {
        const { data: profs, error: profErr } = await supabase.from('profiles')
          .select('id').order('created_at', { ascending: true }).limit(1)
        if (profErr) {
          const errMsg = `Gagal membaca profil approver: ${profErr.message}`
          if (setNotice) setNotice(errMsg)
          return { ok: false, error: errMsg }
        }
        approverId = (profs && profs[0] && profs[0].id) || null
      }
      if (!approverId) {
        const errMsg = 'Tidak ada profil approver — hubungi administrator.'
        if (setNotice) setNotice(errMsg)
        return { ok: false, error: errMsg }
      }

      const { error: stErr } = await supabase.from('approval_steps').insert({
        purchase_request_id: pr.id,
        approver_id: approverId,
        step_number: 1,
        status: 'PENDING'
      })
      if (stErr) {
        const errMsg = `Gagal membuat approval: ${stErr.message}`
        if (setNotice) setNotice(errMsg)
        return { ok: false, error: errMsg }
      }
    }

    // 7. Update status item yang belum ORDERED ke PENDING_APPROVAL
    const nonOrderedItems = items.filter(it => String(it.status || '').toUpperCase() !== 'ORDERED')
    for (const it of nonOrderedItems) {
      if (String(it.status || '').toUpperCase() !== 'PENDING_APPROVAL') {
        const { error: itemUpErr } = await supabase.from('pr_items').update({
          status: 'PENDING_APPROVAL'
        }).eq('id', it.id)
        if (itemUpErr) {
          console.warn(`Peringatan update item ${it.id}:`, itemUpErr.message)
        }
      }
    }

    // 8. Ubah status PR -> SUBMITTED (reuse SAME PR id & pr_number)
    const { error: prErr } = await supabase
      .from('purchase_requests')
      .update({ status: 'SUBMITTED' })
      .eq('id', pr.id)

    if (prErr) {
      const errMsg = `Approval siap, tapi gagal update status PR: ${prErr.message}`
      if (setNotice) setNotice(errMsg)
      if (loadAll) loadAll()
      return { ok: false, error: errMsg }
    }

    // 9. Verifikasi readback status PR
    const { data: verifyPr, error: vErr } = await supabase
      .from('purchase_requests')
      .select('id, status')
      .eq('id', pr.id)
      .single()

    if (vErr || !verifyPr || verifyPr.status !== 'SUBMITTED') {
      const errMsg = `Verifikasi readback gagal: status PR belum SUBMITTED (${verifyPr?.status || 'gagal dibaca'}).`
      if (setNotice) setNotice(errMsg)
      if (loadAll) loadAll()
      return { ok: false, error: errMsg }
    }

    // 10. Trigger alert Telegram opsional jika > Rp 5 juta
    let alertNote = ''
    if (sendPrAlert) {
      try {
        const alert = await sendPrAlert(supabase, pr.id)
        if (alert && alert.ok && alert.sent) {
          alertNote = ' 🔔 Alert Telegram (PR > 5 Juta) terkirim ke DAT.'
        } else if (alert && alert.sent === false && alert.reason === 'send_failed') {
          alertNote = ` ⚠️ Alert Telegram gagal terkirim (${alert.error || 'error'}) — cek konfigurasi bot.`
        }
      } catch (alertErr) {
        alertNote = ` ⚠️ Alert Telegram error: ${alertErr.message}`
      }
    }

    const prNumberStr = latestPr.pr_number || pr.pr_number || ''
    const successMsg = isResubmit
      ? `PR ${prNumberStr} berhasil diajukan ulang dan sudah masuk modul Approval (menunggu persetujuan).${alertNote}`
      : `PR ${prNumberStr} selesai dan sudah masuk modul Approval (menunggu persetujuan).${alertNote}`

    if (setNotice) setNotice(successMsg)
    if (loadAll) loadAll()

    return {
      ok: true,
      isResubmit,
      pr_number: prNumberStr,
      pr_id: pr.id
    }
  } finally {
    if (lockRef) lockRef.current = false
    if (setActionBusy) setActionBusy(false)
  }
}
