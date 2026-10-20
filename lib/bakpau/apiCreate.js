// ============================================================
// lib/bakpau/apiCreate.js — INPUT PEMBELIAN TERSTRUKTUR DARI BAKPAU
// ============================================================
// Jalur ini menerima HASIL EKSTRAKSI (bukan gambar mentah). Agen Bakpau yang
// membaca file wajib mengisi payload terstruktur dan MENANDAI baris ambigu.
// Server TIDAK mengarang qty/harga/proyek: field yang tidak yakin harus
// dikirim sebagai `ambiguous` -> permintaan ditolak 422 sebelum menyentuh DB.
//
// YANG DIPAKAI ULANG (tidak ada validasi/tulisan kedua):
//   * resolveVendor / resolveProject / resolvePrItemFor -> identitas master
//     exact/literal, ambiguitas ditolak (sama dengan jalur Telegram/WA).
//   * validatePurchaseBoundary -> kontrak validasi yang SAMA dengan form admin.
//   * buildPurchaseNote / buildItemPriceNote / buildEventMarks / buildItemMarks
//     -> satu-satunya pembentuk teks penanda nota.
//   * SATU RPC transaksional (atomicPurchase.js) untuk klaim idempoten +
//     header + baris + alokasi. Tidak ada tulisan multipart.
//   * readbackPurchaseStrict -> syarat status 'tercatat' (tanpa fallback).
//   * sendNotification -> notifikasi Telegram DAT saja.
//
// YANG TIDAK ADA DI SINI: PR baru, approval_steps, serah terima fisik,
// invoice penjualan, pembayaran, update stok, delete, DDL, ledger kedua.
//
// PERUBAHAN SETELAH REVIEW BROOKLYN (2026-10-21):
//   Sebelumnya alur menulis: claimBoth() -> writePurchase() (banyak request)
//   -> ledger.mark() -> releaseBoth() bila gagal. Itu BUKAN satu transaksi:
//   kegagalan non-partial bisa melepas kunci sehingga retry menulis nota
//   kedua, dan jalur admin tidak memakai ledger itu sama sekali sehingga
//   idempotensi lintas kanal tidak berlaku. Kini SEMUA penulisan berada di
//   dalam satu fungsi SQL; bila fungsi itu belum ada, create FAIL CLOSED.
// ============================================================

import crypto from 'node:crypto'
import { resolveVendor, resolveProject, literalKey } from './resolve.js'
import { validateViaSharedBoundary } from './purchaseAdapter.js'
import { buildPurchaseNote, buildItemPriceNote, TAHAP_DIBELI } from '../../lib/purchaseNote.js'
import { buildEventMarks, buildItemMarks } from './markers.js'
import { sendNotification } from './notify.js'
import { STATUS, REASON } from './constants.js'
import { API_LIMITS, API_REASON } from './apiAuth.js'
import {
  buildAtomicRpcArgs, callAtomicSave, verifyAtomicResult, readbackPurchaseStrict
} from './atomicPurchase.js'

export const CREATE_CHANNEL = 'bakpau-api'
export const MAX_STRING_LEN = 200
export const MAX_REF_LEN = 120

function fail(reason, error, extra = {}) {
  return { ok: false, reason, error, ...extra }
}

// ------------------------------------------------------------
// 1) VALIDASI BENTUK PAYLOAD (murni, tanpa DB)
// ------------------------------------------------------------
// Semua field yang menentukan uang/qty/proyek WAJIB eksplisit. Tidak ada
// nilai default yang "menyelamatkan" payload tidak lengkap.
export function validateStructuredPayload(body = {}) {
  const problems = []
  const push = (field, code, message) => problems.push({ field, code, message })

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(API_REASON.INVALID_PAYLOAD, 'Body harus objek JSON.', { problems: [{ field: '', code: 'not_object', message: 'Body bukan objek.' }] })
  }

  // Provenance: wajib menyebut dari mana hasil ekstraksi berasal.
  const prov = body.provenance
  if (!prov || typeof prov !== 'object') {
    push('provenance', 'missing', 'provenance wajib (sumber file/ekstraksi).')
  } else {
    if (!String(prov.sourceType || '').trim()) push('provenance.sourceType', 'missing', 'sourceType wajib (mis. foto_nota, pdf, wa_file).')
    if (!String(prov.sourceRef || '').trim()) push('provenance.sourceRef', 'missing', 'sourceRef wajib (nama file / id pesan / referensi bukti).')
    if (String(prov.sourceRef || '').length > MAX_REF_LEN) push('provenance.sourceRef', 'too_long', `sourceRef maks ${MAX_REF_LEN} karakter.`)
    if (!String(prov.extractedBy || '').trim()) push('provenance.extractedBy', 'missing', 'extractedBy wajib (agen/alat yang mengekstrak).')
  }

  // Idempotency: pemanggil WAJIB mengirim kunci stabil per dokumen.
  const idem = String(body.idempotencyKey || '').trim()
  if (!idem) push('idempotencyKey', 'missing', 'idempotencyKey wajib (kunci stabil per dokumen, bukan acak per retry).')
  else if (idem.length > 120) push('idempotencyKey', 'too_long', 'idempotencyKey maks 120 karakter.')

  const nota = body.purchase
  if (!nota || typeof nota !== 'object') {
    push('purchase', 'missing', 'purchase wajib berisi data nota.')
    return fail(API_REASON.INVALID_PAYLOAD, 'Payload tidak lengkap.', { problems })
  }

  // Vendor: id ATAU nama — keduanya tidak boleh kosong.
  const vendorId = String(nota.vendorId || '').trim()
  const vendorName = String(nota.vendorName || '').trim()
  if (!vendorId && !vendorName) push('purchase.vendorId', 'missing', 'vendorId atau vendorName wajib.')
  if (vendorId && !/^[0-9a-fA-F-]{36}$/.test(vendorId)) push('purchase.vendorId', 'bad_uuid', 'vendorId harus UUID.')
  if (vendorName.length > MAX_STRING_LEN) push('purchase.vendorName', 'too_long', 'vendorName terlalu panjang.')

  const date = String(nota.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) push('purchase.date', 'bad_date', 'date wajib YYYY-MM-DD (tidak ditebak dari jam).')

  const invoiceNo = String(nota.invoiceNo || '').trim()
  if (invoiceNo.length > 80) push('purchase.invoiceNo', 'too_long', 'invoiceNo maks 80 karakter.')

  for (const k of ['biayaLain', 'diskon']) {
    if (nota[k] === undefined || nota[k] === null) continue
    const n = Number(nota[k])
    if (!isFinite(n) || n < 0) push(`purchase.${k}`, 'bad_number', `${k} harus angka >= 0.`)
  }
  if (nota.statedTotal !== undefined && nota.statedTotal !== null) {
    const n = Number(nota.statedTotal)
    if (!isFinite(n) || n < 0) push('purchase.statedTotal', 'bad_number', 'statedTotal harus angka >= 0.')
  }

  // Proyek default (opsional) + proyek per baris.
  const projectId = String(nota.projectId || '').trim()
  const projectRef = String(nota.projectRef || '').trim()
  if (projectId && !/^[0-9a-fA-F-]{36}$/.test(projectId)) push('purchase.projectId', 'bad_uuid', 'projectId harus UUID.')

  const items = Array.isArray(nota.items) ? nota.items : []
  if (!items.length) push('purchase.items', 'missing', 'items wajib berisi minimal satu baris.')
  if (items.length > API_LIMITS.MAX_ITEMS_PER_NOTA) {
    push('purchase.items', 'too_many', `maksimum ${API_LIMITS.MAX_ITEMS_PER_NOTA} baris per nota.`)
  }

  items.forEach((it, i) => {
    const at = `purchase.items[${i}]`
    if (!it || typeof it !== 'object') { push(at, 'not_object', 'baris harus objek.'); return }

    // Tanda ambiguitas dari agen: DILARANG diisi nilai karangan.
    if (it.ambiguous === true || (Array.isArray(it.ambiguousFields) && it.ambiguousFields.length)) {
      const fields = Array.isArray(it.ambiguousFields) && it.ambiguousFields.length
        ? it.ambiguousFields.join(', ')
        : 'baris ditandai ambigu'
      push(at, 'ambiguous', `baris ambigu (${fields}) — perlu klarifikasi manusia, bukan tebakan.`)
      return
    }

    const name = String(it.itemName || '').trim()
    if (!name) push(`${at}.itemName`, 'missing', 'itemName wajib.')
    if (name.length > MAX_STRING_LEN) push(`${at}.itemName`, 'too_long', 'itemName terlalu panjang.')

    const qty = Number(it.qty)
    if (it.qty === undefined || it.qty === null || it.qty === '') push(`${at}.qty`, 'missing', 'qty wajib (tidak diisi 1 sebagai default).')
    else if (!isFinite(qty) || qty <= 0) push(`${at}.qty`, 'bad_number', 'qty harus angka > 0.')

    const harga = Number(it.harga)
    if (it.harga === undefined || it.harga === null || it.harga === '') push(`${at}.harga`, 'missing', 'harga satuan wajib (tidak diisi 0).')
    else if (!isFinite(harga) || harga <= 0) push(`${at}.harga`, 'bad_number', 'harga harus angka > 0.')

    if (it.projectId && !/^[0-9a-fA-F-]{36}$/.test(String(it.projectId))) push(`${at}.projectId`, 'bad_uuid', 'projectId harus UUID.')
    if (it.prItemId && !/^[0-9a-fA-F-]{36}$/.test(String(it.prItemId))) push(`${at}.prItemId`, 'bad_uuid', 'prItemId harus UUID.')
    if (it.unit && String(it.unit).length > 30) push(`${at}.unit`, 'too_long', 'unit terlalu panjang.')
  })

  // Ambiguitas tingkat nota (mis. total tidak terbaca).
  if (Array.isArray(body.ambiguous) && body.ambiguous.length) {
    push('ambiguous', 'ambiguous', `nota ditandai ambigu pada: ${body.ambiguous.join(', ')}.`)
  }

  if (problems.length) {
    const anyAmbiguous = problems.some(p => p.code === 'ambiguous')
    return fail(anyAmbiguous ? API_REASON.AMBIGUOUS_EXTRACTION : API_REASON.INVALID_PAYLOAD,
      anyAmbiguous
        ? 'Hasil ekstraksi masih ambigu — tidak ada data yang ditulis. Lengkapi/konfirmasi dulu.'
        : 'Payload pembelian tidak valid — tidak ada data yang ditulis.',
      { problems })
  }

  return {
    ok: true,
    idempotencyKey: idem,
    provenance: {
      sourceType: String(prov.sourceType).trim(),
      sourceRef: String(prov.sourceRef).trim(),
      extractedBy: String(prov.extractedBy).trim(),
      extractedAt: prov.extractedAt ? String(prov.extractedAt) : null
    },
    nota: {
      vendorId: vendorId || null,
      vendorName,
      date,
      invoiceNo,
      projectId: projectId || null,
      projectRef,
      biayaLain: nota.biayaLain === undefined || nota.biayaLain === null ? 0 : Number(nota.biayaLain),
      diskon: nota.diskon === undefined || nota.diskon === null ? 0 : Number(nota.diskon),
      statedTotal: nota.statedTotal === undefined || nota.statedTotal === null ? null : Number(nota.statedTotal),
      catatan: String(nota.catatan || '').trim().slice(0, 500),
      items: items.map(it => ({
        itemName: String(it.itemName).trim(),
        qty: Number(it.qty),
        harga: Number(it.harga),
        unit: it.unit ? String(it.unit).trim() : null,
        projectId: it.projectId ? String(it.projectId) : null,
        projectRef: it.projectRef ? String(it.projectRef).trim() : '',
        prItemId: it.prItemId ? String(it.prItemId) : null,
        prNumber: it.prNumber ? String(it.prNumber).trim() : '',
        spec: it.spec ? String(it.spec).trim() : ''
      }))
    }
  }
}

// ------------------------------------------------------------
// 2) RESOLUSI IDENTITAS (butuh masters yang dibaca server, bukan dari body)
// ------------------------------------------------------------
// vendorId/projectId dari body TIDAK dipercaya buta: harus ADA di master yang
// dibaca server. Bila body hanya memberi nama/kode, pencocokan LITERAL.
export function resolveStructuredNota({ nota, masters = {} } = {}) {
  const problems = []
  const push = (field, code, message) => problems.push({ field, code, message })

  // --- Vendor ---
  let vendor = null
  if (nota.vendorId) {
    vendor = (masters.vendors || []).find(v => String(v.id) === String(nota.vendorId)) || null
    if (!vendor) push('purchase.vendorId', 'unknown_reference', `Vendor ${nota.vendorId} tidak ada di master.`)
  } else {
    const rv = resolveVendor(nota.vendorName, masters.vendors || [])
    if (!rv.ok) push('purchase.vendorName', rv.reason, rv.error)
    else vendor = rv.vendor
  }

  // --- Proyek default ---
  let defaultProject = null
  if (nota.projectId) {
    defaultProject = (masters.projects || []).find(p => String(p.id) === String(nota.projectId)) || null
    if (!defaultProject) push('purchase.projectId', 'unknown_reference', `Proyek ${nota.projectId} tidak ada di master.`)
  } else if (nota.projectRef) {
    const rp = resolveProject(nota.projectRef, masters.projects || [])
    if (!rp.ok) push('purchase.projectRef', rp.reason, rp.error)
    else defaultProject = rp.project
  }

  // --- Baris ---
  const lines = []
  nota.items.forEach((it, i) => {
    const at = `purchase.items[${i}]`
    let projectId = it.projectId || null
    if (it.projectId) {
      const found = (masters.projects || []).find(p => String(p.id) === String(it.projectId))
      if (!found) push(`${at}.projectId`, 'unknown_reference', `Proyek ${it.projectId} tidak ada di master.`)
    } else if (it.projectRef) {
      const rp = resolveProject(it.projectRef, masters.projects || [])
      if (!rp.ok) push(`${at}.projectRef`, rp.reason, rp.error)
      else projectId = rp.project.id
    } else if (defaultProject) {
      projectId = defaultProject.id
    }

    let prItemId = it.prItemId || null
    let prId = null
    if (prItemId) {
      const prItem = (masters.prItems || []).find(x => String(x.id) === String(prItemId))
      if (!prItem) push(`${at}.prItemId`, 'unknown_reference', `PR item ${prItemId} tidak ada.`)
      else prId = prItem.pr_id || null
    } else if (it.prNumber) {
      // Tautan PR opsional: hanya bila nomor PR literal cocok DAN barangnya ada.
      const pr = (masters.requests || []).find(r => literalKey(r.pr_number).toLowerCase() === literalKey(it.prNumber).toLowerCase())
      if (!pr) push(`${at}.prNumber`, 'unknown_reference', `PR "${it.prNumber}" tidak ada di master.`)
      else {
        const cand = (masters.prItems || []).filter(x => String(x.pr_id) === String(pr.id)
          && literalKey(x.item_name).toLowerCase() === literalKey(it.itemName).toLowerCase())
        if (cand.length === 1) {
          prItemId = cand[0].id
          prId = pr.id
        } else if (cand.length > 1) {
          push(`${at}.prNumber`, 'ambiguous', `Barang "${it.itemName}" muncul ${cand.length}x di PR ${it.prNumber} — perlu klarifikasi.`)
        }
        // 0 kandidat: dibiarkan TANPA tautan PR (bukan PR fiktif), dicatat.
      }
    }

    lines.push({
      itemName: it.itemName,
      qty: it.qty,
      harga: it.harga,
      unit: it.unit,
      projectId,
      prItemId,
      prId,
      spec: it.spec || '',
      prNumber: it.prNumber || '',
      prVerified: !!prItemId
    })
  })

  if (problems.length) {
    const ambiguous = problems.some(p => p.code === 'ambiguous')
    return fail(ambiguous ? API_REASON.AMBIGUOUS_EXTRACTION : API_REASON.UNKNOWN_REFERENCE,
      ambiguous ? 'Referensi ambigu — tidak ada data yang ditulis.' : 'Referensi master tidak dikenal — tidak ada data yang ditulis.',
      { problems })
  }

  return {
    ok: true,
    vendorId: vendor.id,
    vendorName: vendor.name,
    projectId: defaultProject?.id || null,
    projectLabel: defaultProject ? (defaultProject.kode || defaultProject.code || defaultProject.name) : '',
    lines
  }
}

// ------------------------------------------------------------
// 3) Bukti kanonik + hash (idempotensi lintas kanal)
// ------------------------------------------------------------
// Format sengaja SAMA dengan jalur Telegram/WA (vendor + nota + tanggal +
// baris qty/harga) supaya nota yang sama dari kanal berbeda terdeteksi
// duplikat, bukan tercatat dua kali.
export function evidenceForStructured({ resolved, nota } = {}) {
  const lines = resolved.lines.map(l => ({
    itemName: l.itemName,
    qty: l.qty,
    harga: l.harga,
    projectId: l.projectId || null
  }))
  const payload = {
    vendorId: resolved.vendorId,
    vendorName: resolved.vendorName,
    invoiceNo: nota.invoiceNo || '',
    date: nota.date,
    biayaLain: Number(nota.biayaLain) || 0,
    diskon: Number(nota.diskon) || 0,
    lines
  }
  const canonical = JSON.stringify(payload)
  return { payload, hash: crypto.createHash('sha256').update(canonical, 'utf8').digest('hex') }
}

// ------------------------------------------------------------
// 4) TEKS NOTA (satu sumber: lib/purchaseNote.js + markers.js)
// ------------------------------------------------------------
export function buildHeaderText({ boundary, validated, resolved, eventKey, evidenceHash }) {
  const base = buildPurchaseNote({
    material: boundary.nota.material,
    biayaLain: boundary.nota.biayaLain,
    diskon: boundary.nota.diskon,
    notaUrl: '',
    buktiNota: '',
    buktiTransfer: '',
    catatan: validated.nota.catatan,
    tahap: TAHAP_DIBELI
  })
  const marks = buildEventMarks({
    eventKey,
    evidenceHash,
    channel: CREATE_CHANNEL,
    senderId: validated.provenance.extractedBy,
    messageId: validated.provenance.sourceRef
  })
  const note = [base, marks].filter(Boolean).join(' ').trim() || ''
  const lineSuffixes = resolved.lines.map(l => buildItemMarks({
    spec: l.spec || '',
    projectId: l.projectId || '',
    prItemId: l.prItemId || ''
  }))
  return { note, lineSuffixes }
}

// ------------------------------------------------------------
// 5) EKSEKUSI CREATE (dipanggil handler SETELAH auth + validasi bentuk)
// ------------------------------------------------------------
// `deps` memungkinkan harness menyuntikkan klien/transport tiruan tanpa
// mengubah kode produksi.
export async function createPurchaseFromExtraction({
  client, validated, masters, transport, env = {}, now = Date.now(), notify = true, sleep
} = {}) {
  if (!client) return fail(API_REASON.INTERNAL_ERROR, 'Klien DB server tidak tersedia.')

  const resolved = resolveStructuredNota({ nota: validated.nota, masters })
  if (!resolved.ok) return resolved

  // Validasi lewat BOUNDARY BERSAMA — kontrak yang sama dengan form admin.
  const notaInput = {
    vendorId: resolved.vendorId,
    tanggal: validated.nota.date,
    invoiceNo: validated.nota.invoiceNo,
    biayaLain: validated.nota.biayaLain,
    diskon: validated.nota.diskon,
    items: resolved.lines.map(l => ({
      prItemId: l.prItemId,
      prId: l.prId,
      projectId: l.projectId,
      itemName: l.itemName,
      unit: l.unit,
      qty: l.qty,
      harga: l.harga
    }))
  }
  const boundary = validateViaSharedBoundary(notaInput)
  if (!boundary.ok) {
    return fail(API_REASON.INVALID_PAYLOAD, boundary.error, { problems: [{ field: 'purchase', code: boundary.reason, message: boundary.error }] })
  }

  // Rekonsiliasi total tertulis vs rincian (sama seperti jalur teks).
  if (validated.nota.statedTotal !== null) {
    const computed = boundary.nota.total
    if (Math.round(Number(validated.nota.statedTotal)) !== computed) {
      return fail(API_REASON.AMBIGUOUS_EXTRACTION,
        `Total tertulis Rp ${validated.nota.statedTotal} berbeda dengan rincian Rp ${computed} — perlu klarifikasi.`,
        { problems: [{ field: 'purchase.statedTotal', code: REASON.TOTAL_MISMATCH, message: 'Total tidak cocok dengan rincian.' }] })
    }
  }

  const evidence = evidenceForStructured({ resolved, nota: validated.nota })
  const channelKey = `${CREATE_CHANNEL}:${validated.idempotencyKey}`

  // Satu proyek / satu PR hanya bila SELURUH baris menunjuk nilai yang sama —
  // kalau berbeda, header dibiarkan kosong (alokasi tetap per baris), bukan
  // dipilih salah satu secara diam-diam.
  const projectSet = new Set(resolved.lines.map(l => String(l.projectId || '')))
  const singleProject = projectSet.size === 1 ? (resolved.lines[0]?.projectId || null) : null
  const prSet = new Set(resolved.lines.map(l => String(l.prItemId || '')))
  const singlePrItem = prSet.size === 1 ? (resolved.lines[0]?.prItemId || null) : null
  const headerPrId = singlePrItem
    ? ((masters.prItems || []).find(it => String(it.id) === String(singlePrItem))?.pr_id || null)
    : null

  const text = buildHeaderText({ boundary, validated, resolved, eventKey: channelKey, evidenceHash: evidence.hash })

  const invoiceNo = String(validated.nota.invoiceNo || '').trim()
  const args = buildAtomicRpcArgs({
    resolved,
    nota: validated,
    boundary,
    header: {
      invoiceNo,
      note: text.note,
      lineNoteSuffixes: text.lineSuffixes,
      projectId: singleProject,
      prId: headerPrId,
      isInternalRef: !invoiceNo
    },
    eventKey: channelKey,
    evidenceHash: evidence.hash,
    channel: CREATE_CHANNEL,
    senderId: validated.provenance.extractedBy,
    messageId: validated.provenance.sourceRef,
    now
  })

  // ---- SATU-SATUNYA TULISAN: satu transaksi (fail closed bila RPC absen) ----
  const saved = await callAtomicSave({ client, args })
  if (!saved.ok) {
    if (saved.status === 'duplicate') {
      return {
        ok: false, status: STATUS.DUPLICATE, reason: saved.reason, error: saved.error,
        idempotencyKey: validated.idempotencyKey, evidenceHash: evidence.hash
      }
    }
    return fail(saved.reason, saved.error, { dbCode: saved.dbCode || null })
  }
  if (saved.status === 'ignored_duplicate_event') {
    return {
      ok: true, status: 'ignored_duplicate_event', reason: API_REASON.DUPLICATE_EVENT,
      error: 'Idempotency key ini sudah diproses — tidak ada tulisan kedua.',
      idempotencyKey: validated.idempotencyKey,
      receivingId: saved.result?.receiving_id || null,
      evidenceHash: evidence.hash
    }
  }

  // ---- Verifikasi semantik balasan transaksi ----
  const verified = verifyAtomicResult({ result: saved.result, args, expectedTotal: boundary.nota.total })
  if (!verified.ok) {
    return fail(API_REASON.READBACK_FAILED, 'Balasan transaksi tidak konsisten — status "tercatat" tidak diklaim.', {
      receivingId: saved.result?.receiving_id || null,
      diffs: verified.diffs
    })
  }
  const receivingId = String(saved.result.receiving_id)
  const savedInvoiceNo = String(saved.result.invoice_no || invoiceNo)

  // ---- READBACK KETAT dari DB (bukan dari payload) ----
  const rb = await readbackPurchaseStrict({
    client,
    receivingId,
    expected: {
      vendorId: boundary.nota.vendorId,
      invoiceNo: savedInvoiceNo,
      date: boundary.nota.tanggal,
      projectId: singleProject,
      requireEmptyProject: singleProject === null,
      eventKey: channelKey,
      evidenceHash: evidence.hash,
      channel: CREATE_CHANNEL,
      itemCount: boundary.nota.items.length,
      totalRows: boundary.nota.items.length,
      items: boundary.nota.items.map((it, i) => ({
        item_name: it.itemName,
        unit: it.unit,
        quantity_received: it.qty,
        harga: it.harga,
        projectId: resolved.lines[i]?.projectId || null,
        prItemId: resolved.lines[i]?.prItemId || null
      }))
    }
  })
  if (!rb.ok) {
    return fail(API_REASON.READBACK_FAILED, rb.error || 'Readback tidak cocok — status "tercatat" tidak diklaim.', {
      receivingId, diffs: rb.diffs || []
    })
  }

  // Notifikasi HANYA ke DAT (allowlist konstan). Kegagalan kirim TIDAK
  // mengulang tulisan pembelian — transaksi sudah commit.
  let notification = { skipped: true, reason: 'request_notify_false' }
  if (notify) {
    const out = await sendNotification({
      status: STATUS.TERCATAT,
      header: {
        vendorName: resolved.vendorName,
        invoiceNo: savedInvoiceNo,
        isInternalRef: !!saved.result.is_internal_ref,
        date: boundary.nota.tanggal,
        total: boundary.nota.total,
        dedupKey: `tercatat:${channelKey}`
      },
      lines: resolved.lines.map(l => ({ ...l, prVerified: !!l.prItemId })),
      reasons: [],
      link: `https://purchasing.noirliving.app/?receiving=${receivingId}`,
      extra: [`Sumber: ${validated.provenance.sourceType} / ${validated.provenance.sourceRef}`],
      transport,
      ledger: null,
      env,
      now,
      sleep
    })
    notification = {
      sent: out.sent === true,
      skipped: !!out.skipped,
      reason: out.reason || null,
      attempts: out.attempts || 0
    }
  }

  return {
    ok: true,
    status: STATUS.TERCATAT,
    receivingId,
    invoiceNo: savedInvoiceNo,
    isInternalRef: !!saved.result.is_internal_ref,
    idempotencyKey: validated.idempotencyKey,
    evidenceHash: evidence.hash,
    totals: {
      material: boundary.nota.material,
      biayaLain: boundary.nota.biayaLain,
      diskon: boundary.nota.diskon,
      total: boundary.nota.total
    },
    items: resolved.lines.map((l, i) => ({
      itemName: l.itemName,
      qty: boundary.nota.items[i].qty,
      harga: boundary.nota.items[i].harga,
      unit: l.unit,
      projectId: l.projectId,
      prItemId: l.prItemId
    })),
    readback: { ok: true, verifiedAt: rb.verifiedAt, itemCount: (rb.items || []).filter(i => Number(i.quantity_received) > 0).length },
    notification
  }
}
