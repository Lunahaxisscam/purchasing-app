// ============================================================
// lib/bakpau/connector.js — ORKESTRASI SATU EVENT MASUK
// ============================================================
// Urutan yang DIPAKSA (dan tidak boleh ditukar):
//
//   1. normalize   (platform -> bentuk kanonik)
//   2. verify      (tanda tangan, allowlist identitas, freshness)  [FAIL CLOSED]
//   3. parse bukti (teks -> draft mentah; anti-tebak)
//   4. resolve     (draft -> id master; ambiguitas = klarifikasi)
//   5. hitung evidenceHash (identitas bukti lintas kanal)
//   6. cek duplikat di DB existing (bukti sama / nota sama isi beda)
//   7. klaim ledger (event + bukti)  [FAIL CLOSED bila ledger tidak ada]
//   8. tulis pembelian lewat boundary bersama
//   9. READBACK EXACT  -> hanya bila cocok status menjadi 'tercatat'
//  10. notifikasi Telegram DAT (idempoten, retry terbatas)
//
// JAMINAN YANG DITEGAKKAN:
//   * Status 'tercatat' HANYA setelah langkah 8 sukses DAN langkah 9 cocok.
//   * Kegagalan kirim notifikasi (10) TIDAK PERNAH mengulang langkah 8 —
//     tidak ada penulisan pembelian kedua. Notifikasi gagal dilaporkan gagal.
//   * Draft / need_clarification / duplicate / gagal TIDAK PERNAH menyebut
//     "tersimpan".
//   * Bila penulisan gagal total, klaim ledger dilepas supaya event bisa
//     dicoba lagi tanpa menggandakan data.
// ============================================================

import { normalizeInbound } from './normalize.js'
import { verifyInbound } from './verify.js'
import { parseEvidenceText } from './evidence.js'
import { resolveDraft } from './resolve.js'
import { evidenceHashOf, decideDuplicate, canonicalEvidence } from './duplicate.js'
import { claimBoth, releaseBoth } from './ledger.js'
import { validateViaSharedBoundary, writePurchase, readbackPurchase, findShellReceiving } from './purchaseAdapter.js'
import { sendNotification } from './notify.js'
import { STATUS, REASON, APP_LINK_BASE, DAT_NOTIFY_TARGET } from './constants.js'
import { parseConnectorMarkers } from './markers.js'

// Ambil master read-only. Hanya SELECT.
export async function loadMasters({ client, limits = {} } = {}) {
  if (!client) return { ok: false, reason: REASON.NO_SERVICE_CREDENTIALS, error: 'Klien DB tidak tersedia.' }
  const q = async (table, cols = '*', cap = 5000) => {
    const { data, error } = await client.from(table).select(cols).limit(limits[table] || cap)
    if (error) return { error }
    return { data: data || [] }
  }
  const [projects, vendors, requests, prItems, receivingItems] = await Promise.all([
    q('projects'), q('vendors'), q('purchase_requests'), q('pr_items'), q('receiving_items')
  ])
  const firstErr = projects.error || vendors.error || requests.error || prItems.error || receivingItems.error
  if (firstErr) {
    return { ok: false, reason: REASON.READBACK_FAILED, error: `Gagal membaca master: ${firstErr.message}` }
  }
  return {
    ok: true,
    masters: {
      projects: projects.data,
      vendors: vendors.data,
      requests: requests.data,
      prItems: prItems.data,
      receivingItems: receivingItems.data
    }
  }
}

// Nota existing untuk pemeriksaan duplikat (hanya nota yang benar-benar
// tercatat: punya invoice_no atau penanda tahap DIBELI).
//
// `itemNames` ikut dibaca dari `receiving_items` supaya nota yang dicatat
// lewat JALUR ADMIN (tanpa penanda [BuktiHash]) tetap bisa dikenali sebagai
// duplikat bukti ketika nomor nota + toko + total + nama barang semuanya
// sama. Tanpa nama barang, nota admin hanya akan terdeteksi sebagai
// "konflik" (aman, tapi memaksa klarifikasi yang tidak perlu).
export async function loadExistingNotas({ client, limit = 2000 } = {}) {
  if (!client) return { ok: false, error: 'Klien DB tidak tersedia.' }
  const { data, error } = await client.from('receivings')
    .select('id, vendor_id, invoice_no, received_date, note, status, project_id').limit(limit)
  if (error) return { ok: false, error: error.message }
  const rows = (data || []).filter(r => !!String(r.invoice_no || '').trim() || /\[Tahap:\s*DIBELI\]/i.test(String(r.note || '')))

  const ids = rows.map(r => r.id).filter(Boolean)
  const namesById = new Map()
  if (ids.length) {
    const { data: items, error: iErr } = await client.from('receiving_items')
      .select('receiving_id, item_name, quantity_received').in('receiving_id', ids)
    if (iErr) return { ok: false, error: iErr.message }
    for (const it of (items || [])) {
      if (!(Number(it.quantity_received) > 0)) continue
      const list = namesById.get(it.receiving_id) || []
      list.push(String(it.item_name || ''))
      namesById.set(it.receiving_id, list)
    }
  }

  return {
    ok: true,
    rows: rows.map(r => ({
      id: r.id,
      vendorId: r.vendor_id,
      invoiceNo: r.invoice_no,
      date: r.received_date,
      // Nota admin tidak punya penanda hash; string kosong = tidak diketahui.
      evidenceHash: parseConnectorMarkers(r.note).evidenceHash || '',
      itemNames: namesById.get(r.id) || [],
      channel: parseConnectorMarkers(r.note).channel || 'admin',
      eventKey: parseConnectorMarkers(r.note).eventKey || ''
    }))
  }
}

function linkFor({ receivingId, invoiceNo }) {
  const q = receivingId ? `?nota=${encodeURIComponent(receivingId)}` : ''
  return `${APP_LINK_BASE}/#purchase${q}`
}

// ------------------------------------------------------------
// PROSES SATU EVENT
// ------------------------------------------------------------
export async function processInboundEvent({
  platform,
  payload,
  headers,
  rawBody,
  env = {},
  client = null,
  ledger = null,
  transport = null,
  now = Date.now(),
  masters = null,
  existingNotas = null,
  requestNotify = true,
  sleep
} = {}) {
  const steps = []
  const log = (step, info) => steps.push({ step, at: new Date(now).toISOString(), ...(info || {}) })

  // --- 1) Normalisasi ---
  const norm = normalizeInbound(platform, payload)
  if (!norm.ok) {
    log('normalize', { ok: false, reason: norm.reason })
    return { ok: false, status: STATUS.GAGAL, reason: norm.reason, error: norm.error, steps }
  }
  const event = norm.event
  log('normalize', { ok: true, channelKey: event.channelKey })

  // --- 2) Gerbang masuk ---
  const gate = verifyInbound({ platform, event, headers, rawBody, env, now })
  if (!gate.ok) {
    log('verify', { ok: false, reason: gate.reason })
    // Event yang DITOLAK tidak dinotifikasi: mengirim pemberitahuan untuk
    // setiap payload tak sah = jalur spam/DoS ke DM DAT.
    return { ok: false, status: STATUS.GAGAL, reason: gate.reason, error: gate.error, event: safeEvent(event), steps }
  }
  log('verify', { ok: true, via: gate.via, ageSec: gate.ageSec })

  // --- 3) Parse bukti ---
  const draft = parseEvidenceText(event.text)
  log('parse', {
    ok: draft.hasAnyContent,
    items: draft.items.length,
    unparsed: draft.unparsedLines.length,
    monetaryOnly: draft.monetaryOnly
  })

  if (!draft.hasAnyContent) {
    const res = {
      ok: false,
      status: STATUS.NEED_CLARIFICATION,
      reason: REASON.NO_ITEM_LINES,
      error: 'Pesan kosong — tidak ada bukti yang bisa dibaca.',
      event: safeEvent(event),
      reasons: [{ code: REASON.NO_ITEM_LINES, message: 'Pesan tidak memuat teks bukti.' }],
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }

  // --- 4) Resolusi identitas master ---
  const m = masters
  if (!m) {
    log('masters', { ok: false, reason: REASON.READBACK_FAILED })
    return { ok: false, status: STATUS.GAGAL, reason: REASON.READBACK_FAILED, error: 'Master proyek/vendor tidak tersedia.', event: safeEvent(event), steps }
  }
  const resolved = resolveDraft({ draft, masters: m })
  log('resolve', { ok: resolved.ok, status: resolved.status, reasons: resolved.reasons.length })

  const evidence = {
    vendorId: resolved.header.vendorId,
    vendorName: resolved.header.vendorName,
    invoiceNo: resolved.header.invoiceNo,
    date: resolved.header.date,
    biayaLain: resolved.header.biayaLain,
    diskon: resolved.header.diskon,
    lines: resolved.lines
  }
  const evidenceHash = evidenceHashOf(evidence)
  log('evidence', { evidenceHash })

  // --- 5) Duplikat terhadap data yang SUDAH ada (sebelum klaim apa pun) ---
  const existing = existingNotas || []

  // (5a) Event ini SUDAH tercatat sebelumnya (webhook retry setelah sukses).
  // Dikenali dari penanda [BakpauEvent] pada nota yang sudah ada — dicek
  // SEBELUM notifikasi supaya retry tidak mengirim pesan ulang ke DM DAT.
  const sameEvent = existing.find(e => String(e?.eventKey || '') && String(e.eventKey) === String(event.channelKey))
  if (sameEvent) {
    log('duplicate', { kind: 'duplicate_event', existingId: sameEvent.id || null })
    return {
      ok: true,
      status: 'ignored_duplicate_event',
      reason: REASON.DUPLICATE_EVENT,
      error: 'Event ini sudah tercatat sebelumnya — tidak diproses ulang.',
      receivingId: sameEvent.id || null,
      invoiceNo: sameEvent.invoiceNo || null,
      event: safeEvent(event),
      steps
    }
  }
  const incomingForDup = {
    vendorId: resolved.header.vendorId,
    vendorName: resolved.header.vendorName,
    invoiceNo: resolved.header.invoiceNo,
    evidenceHash,
    total: resolved.total,
    itemNames: resolved.lines.map(l => l.itemName)
  }
  const dup = decideDuplicate({ incoming: incomingForDup, existing })
  if (dup.kind === 'duplicate_evidence') {
    log('duplicate', { kind: dup.kind, existingId: dup.existing?.id || null })
    const res = {
      ok: false,
      status: STATUS.DUPLICATE,
      reason: REASON.DUPLICATE_EVIDENCE,
      error: dup.message,
      duplicate: { kind: dup.kind, existingId: dup.existing?.id || null, existingInvoiceNo: dup.existing?.invoiceNo || '' },
      header: headerForNotify(resolved),
      lines: resolved.lines,
      reasons: [{ code: REASON.DUPLICATE_EVIDENCE, message: dup.message }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }
  if (dup.kind === 'conflict_invoice') {
    log('duplicate', { kind: dup.kind })
    const res = {
      ok: false,
      status: STATUS.NEED_CLARIFICATION,
      reason: REASON.DUPLICATE_EVIDENCE,
      error: dup.message,
      header: headerForNotify(resolved),
      lines: resolved.lines,
      reasons: [{ code: 'invoice_conflict', message: dup.message }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }

  // --- 6) Belum valid? -> klarifikasi (TIDAK ada tulisan) ---
  if (!resolved.ok) {
    const res = {
      ok: false,
      status: STATUS.NEED_CLARIFICATION,
      reason: resolved.reasons[0]?.code || REASON.ITEM_INVALID,
      error: resolved.reasons[0]?.message || 'Data bukti belum lengkap.',
      header: headerForNotify(resolved),
      lines: resolved.lines,
      reasons: resolved.reasons,
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }

  // --- 7) Validasi lewat BOUNDARY BERSAMA (satu kontrak dengan admin) ---
  const notaInput = {
    vendorId: resolved.header.vendorId,
    tanggal: resolved.header.date,
    invoiceNo: resolved.header.invoiceNo,
    biayaLain: resolved.header.biayaLain,
    diskon: resolved.header.diskon,
    items: resolved.lines.map(l => ({
      prItemId: l.prItemId,
      prId: null,
      projectId: l.projectId,
      itemName: l.itemName,
      unit: l.unit,
      qty: l.qty,
      harga: l.harga
    }))
  }
  const boundary = validateViaSharedBoundary(notaInput)
  if (!boundary.ok) {
    log('boundary', { ok: false, reason: boundary.reason })
    const res = {
      ok: false,
      status: STATUS.NEED_CLARIFICATION,
      reason: boundary.reason,
      error: boundary.error,
      header: headerForNotify(resolved),
      lines: resolved.lines,
      reasons: [{ code: boundary.reason, message: boundary.error }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }
  log('boundary', { ok: true, material: boundary.nota.material, total: boundary.nota.total })

  // --- 8) Klaim ledger (event + bukti) — FAIL CLOSED bila tidak tersedia ---
  const claim = await claimBoth({
    ledger,
    channelKey: event.channelKey,
    evidenceHash,
    meta: { platform: event.platform, chatId: event.chatId, messageId: event.messageId }
  })
  if (!claim.ok) {
    log('claim', { ok: false, reason: claim.reason, dupEvent: !!claim.duplicateEvent, dupEvidence: !!claim.duplicateEvidence })
    if (claim.duplicateEvent) {
      // Retry event yang sama: TIDAK diproses ulang, TIDAK ada notifikasi
      // ulang (kecuali pemanggil meminta), TIDAK ada tulisan.
      return {
        ok: true,
        status: 'ignored_duplicate_event',
        reason: REASON.DUPLICATE_EVENT,
        error: claim.error,
        event: safeEvent(event),
        steps
      }
    }
    if (claim.duplicateEvidence) {
      const res = {
        ok: false,
        status: STATUS.DUPLICATE,
        reason: REASON.DUPLICATE_EVIDENCE,
        error: claim.error,
        header: headerForNotify(resolved),
        lines: resolved.lines,
        reasons: [{ code: REASON.DUPLICATE_EVIDENCE, message: 'Bukti ini sudah tercatat (lintas kanal) — tidak dicatat ulang.' }],
        evidenceHash,
        event: safeEvent(event),
        steps
      }
      return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
    }
    // Ledger tidak tersedia -> TIDAK menulis pembelian (tidak bisa menjamin
    // atomisitas). Dilaporkan jujur sebagai gagal, bukan sukses.
    const res = {
      ok: false,
      status: STATUS.GAGAL,
      reason: claim.reason || REASON.LEDGER_UNAVAILABLE,
      error: claim.error || 'Ledger idempotensi tidak tersedia — penulisan ditahan.',
      header: headerForNotify(resolved),
      lines: resolved.lines,
      reasons: [{ code: claim.reason || REASON.LEDGER_UNAVAILABLE, message: claim.error || 'Ledger tidak tersedia.' }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }
  log('claim', { ok: true })

  // --- 9) Tulis pembelian ---
  let shell = { ok: true, shellReceivingId: null }
  const prItemIds = resolved.lines.map(l => l.prItemId).filter(Boolean)
  if (prItemIds.length) shell = await findShellReceiving({ client, prItemIds })

  const singleProject = new Set(resolved.lines.map(l => String(l.projectId || ''))).size === 1
    ? resolved.lines[0]?.projectId || null : null
  const singlePr = new Set(resolved.lines.map(l => String(l.prItemId || ''))).size === 1
    ? resolved.lines[0]?.prItemId || null : null
  // Header PR hanya diisi bila SATU baris PR (pemetaan kolom header tunggal);
  // tautan per baris tetap tersimpan di receiving_items.pr_item_id.
  const headerPrId = singlePr
    ? (m.prItems.find(it => String(it.id) === String(singlePr))?.pr_id || null)
    : null

  const write = await writePurchase({
    client,
    validated: boundary,
    header: {
      invoiceNo: resolved.header.invoiceNo,
      catatan: resolved.header.catatan,
      notaUrl: '',
      buktiNota: '',
      buktiTransfer: ''
    },
    lines: resolved.lines,
    eventKey: event.channelKey,
    evidenceHash,
    channel: event.platform,
    senderId: event.userId,
    messageId: event.messageId,
    shellReceivingId: shell.ok ? shell.shellReceivingId : null,
    projectId: singleProject,
    prId: headerPrId,
    now
  })
  log('write', { ok: write.ok, receivingId: write.receivingId || null, reason: write.reason || null })

  if (!write.ok) {
    // Gagal total (belum ada baris tersimpan) -> lepas klaim supaya bisa
    // dicoba lagi. Gagal SEBAGIAN (header sudah ada) -> klaim DIPERTAHANKAN
    // supaya retry tidak membuat nota kedua; pengguna diminta memeriksa.
    if (!write.partial) await releaseBoth({ ledger, evtKey: claim.evtKey, evdKey: claim.evdKey })
    const res = {
      ok: false,
      status: STATUS.GAGAL,
      reason: write.reason || REASON.SAVE_FAILED,
      error: write.error,
      partial: !!write.partial,
      receivingId: write.receivingId || null,
      header: headerForNotify(resolved, write),
      lines: resolved.lines,
      reasons: [{ code: write.reason || REASON.SAVE_FAILED, message: write.error }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }

  // --- 10) READBACK EXACT (syarat status 'tercatat') ---
  const rb = await readbackPurchase({
    client,
    receivingId: write.receivingId,
    expected: {
      vendorId: boundary.nota.vendorId,
      invoiceNo: write.invoiceNo,
      date: boundary.nota.tanggal,
      eventKey: event.channelKey,
      evidenceHash,
      channel: event.platform,
      itemCount: boundary.nota.items.length,
      items: boundary.nota.items.map((it, i) => ({
        item_name: it.itemName,
        unit: it.unit,
        quantity_received: it.qty,
        harga: it.harga,
        projectId: resolved.lines[i]?.projectId || null
      }))
    }
  })
  log('readback', { ok: rb.ok, reason: rb.reason || null, diffs: rb.diffs || [] })

  if (!rb.ok) {
    const res = {
      ok: false,
      status: STATUS.GAGAL,
      reason: rb.reason || REASON.READBACK_FAILED,
      error: rb.error,
      partial: true,
      receivingId: write.receivingId,
      header: headerForNotify(resolved, write),
      lines: resolved.lines,
      reasons: [{ code: rb.reason || REASON.READBACK_FAILED, message: rb.error }],
      evidenceHash,
      event: safeEvent(event),
      steps
    }
    return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
  }

  // --- 11) Sukses terverifikasi ---
  const verifiedLines = resolved.lines.map(l => ({ ...l, prVerified: !!l.prItemId }))
  const res = {
    ok: true,
    status: STATUS.TERCATAT,
    reason: null,
    receivingId: write.receivingId,
    invoiceNo: write.invoiceNo,
    isInternalRef: write.isInternalRef,
    statusFallback: write.statusFallback,
    header: headerForNotify(resolved, write),
    lines: verifiedLines,
    reasons: [],
    evidenceHash,
    readback: { ok: true, verifiedAt: rb.verifiedAt, itemCount: (rb.items || []).filter(i => Number(i.quantity_received) > 0).length },
    totals: { material: write.material, biayaLain: write.biayaLain, diskon: write.diskon, total: write.total },
    link: linkFor({ receivingId: write.receivingId, invoiceNo: write.invoiceNo }),
    event: safeEvent(event),
    steps
  }
  if (ledger && typeof ledger.mark === 'function') {
    await ledger.mark(claim.evdKey, 'recorded', { receivingId: write.receivingId })
    await ledger.mark(claim.evtKey, 'recorded', { receivingId: write.receivingId })
  }
  return finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep })
}

function headerForNotify(resolved, write) {
  const h = {
    vendorName: resolved.header.vendorName,
    invoiceNo: (write && write.invoiceNo) || resolved.header.invoiceNo,
    isInternalRef: !!(write && write.isInternalRef),
    date: resolved.header.date,
    total: (write && write.total) || resolved.total,
    dedupKey: ''
  }
  return h
}

function safeEvent(event) {
  // Jangan pernah mengembalikan teks bukti mentah ke pemanggil API/log.
  return {
    platform: event.platform,
    channelKey: event.channelKey,
    chatId: event.chatId,
    userId: event.userId,
    chatType: event.chatType,
    messageId: event.messageId,
    attachmentCount: (event.attachments || []).length,
    textLength: String(event.text || '').length
  }
}

// Kirim notifikasi (bila diminta) lalu kembalikan hasil dengan blok notifikasi.
async function finishWithNotify({ res, event, env, transport, ledger, requestNotify, now, sleep }) {
  if (!requestNotify) return { ...res, notification: { skipped: true, reason: 'request_notify_false' } }

  const header = { ...(res.header || {}), dedupKey: `${res.status}:${event.channelKey}` }
  const out = await sendNotification({
    status: res.status,
    header,
    lines: res.lines || [],
    reasons: res.reasons || [],
    link: res.link || '',
    extra: res.status === STATUS.DUPLICATE && res.duplicate?.existingId
      ? [`Nota lama: ${res.duplicate.existingId}`] : [],
    transport,
    ledger: ledger ? notificationLedger(ledger) : null,
    env,
    now,
    sleep
  })
  return { ...res, notification: out }
}

// Adaptor ledger notifikasi: memakai ledger yang SAMA (tidak ada ledger kedua),
// dengan namespace kunci `ntf:` supaya tidak bertabrakan dengan `evt:`/`evd:`.
function notificationLedger(ledger) {
  return {
    async claim(dedupKey) {
      const r = await ledger.claim(`ntf:${dedupKey}`, { kind: 'notification' })
      return r
    },
    async release(dedupKey) { return ledger.release(`ntf:${dedupKey}`) },
    async record(dedupKey, result) { return ledger.record(`ntf:${dedupKey}`, result) }
  }
}

export { DAT_NOTIFY_TARGET, canonicalEvidence }
