// ============================================================
// lib/bakpau/atomicPurchase.js — SATU TRANSAKSI: ledger + header + baris + alokasi
// ============================================================
// KENAPA FILE INI ADA (review Brooklyn, 2026-10-21)
// ------------------------------------------------
// Versi sebelumnya menulis dalam BEBERAPA request terpisah:
//   1) claimBoth()  -> INSERT ledger (event, lalu bukti)
//   2) writePurchase -> INSERT/UPDATE receivings
//   3) loop           -> INSERT/UPDATE receiving_items satu per satu
//   4) ledger.mark    -> UPDATE ledger
//   5) releaseBoth()  -> DELETE ledger bila langkah 2/3 gagal non-partial
//
// Itu BUKAN satu transaksi. Bila langkah 3 gagal setelah header tertulis,
// `partial` terdeteksi dan ledger TIDAK dilepas — tetapi bila kegagalan
// terjadi pada jalur yang tidak menandai `partial`, releaseBoth() membuka
// kunci lagi sehingga retry bisa menulis nota kedua di atas header yang
// sudah ada. Dan admin (form) sama sekali tidak memakai ledger itu, jadi
// idempotensi lintas kanal tidak pernah benar-benar berlaku.
//
// KONTRAK BARU — TIDAK ADA JALUR TULIS KEDUA
// ------------------------------------------
// Seluruh penulisan (klaim idempotensi, header, baris, penanda alokasi,
// status ledger) dilakukan oleh SATU fungsi SQL:
//
//     public.bakpau_save_purchase_atomic(p_payload jsonb) RETURNS jsonb
//
// Satu pemanggilan RPC = satu transaksi PostgreSQL. Tidak ada INSERT
// header tanpa baris, tidak ada klaim ledger tanpa nota, tidak ada
// "release lalu coba lagi" dari aplikasi: bila fungsi gagal, PostgreSQL
// me-rollback SEMUANYA (termasuk klaim), dan pemanggil menerima kode stabil.
//
// FAIL CLOSED: bila fungsi belum ada (belum di-apply Bandeng) atau
// signature-nya tidak cocok, handler menjawab 503 `atomic_rpc_unavailable`
// dan TIDAK menulis apa pun. Tidak ada fallback multipart, tidak ada
// penulisan "sementara", tidak ada ledger kedua.
//
// PEMILIK SKEMA: Bandeng. File SQL-nya adalah HANDOFF
// (migrations/2026-10-21_bakpau_atomic_purchase_rpc.DRAFT.sql), TIDAK
// dijalankan oleh lane ini di produksi.
// ============================================================

import crypto from 'node:crypto'
import { API_REASON } from './apiAuth.js'
import { REASON } from './constants.js'
import { buildItemPriceNote } from '../../lib/purchaseNote.js'
import { parseConnectorMarkers } from './markers.js'

export const ATOMIC_RPC = 'bakpau_save_purchase_atomic'
export const ATOMIC_CONTRACT_VERSION = 1

// Kode error PostgREST/Postgres yang berarti "fungsi belum ada / signature
// tidak cocok". Semua ini = fail closed (bukan tulis tanpa transaksi).
const RPC_MISSING_CODES = new Set(['PGRST202', 'PGRST203', '42883', '42P01', '3F000'])

export function isRpcMissing(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  if (RPC_MISSING_CODES.has(code)) return true
  return /could not find the function|function .* does not exist|no function matches/i.test(msg)
}

// Kode yang dikembalikan fungsi SQL untuk penolakan yang sah (bukan error).
// BK001/BK002 adalah SQLSTATE kustom dari fungsi (RAISE EXCEPTION) yang
// sengaja dipakai supaya transaksi ROLLBACK total — bukan RETURN yang commit.
const SQLSTATE_DUPLICATE = Object.freeze({
  BK001: 'conflict_invoice',
  BK002: 'duplicate_evidence',
  BK003: 'line_count_mismatch'
})

function fail(reason, error, extra = {}) {
  return { ok: false, reason, error, ...extra }
}

// ------------------------------------------------------------
// 1) Bangun argumen RPC (murni, tanpa DB)
// ------------------------------------------------------------
// Catatan: `note` header dan `note` per baris SUDAH berbentuk final dari
// buildPurchaseNote()/buildItemMarks() — format penanda tetap satu sumber di
// JavaScript. SQL tidak pernah menyusun teks penanda sendiri.
export function buildAtomicRpcArgs({
  resolved,
  nota,
  boundary,
  header = {},
  eventKey,
  evidenceHash,
  channel,
  senderId,
  messageId,
  now = Date.now()
} = {}) {
  const lines = resolved.lines
  const headerNote = String(header.note || '')
  const lineNotes = lines.map((l, i) => {
    const price = buildItemPriceNote(boundary.nota.items[i].harga)
    const suffix = String((header.lineNoteSuffixes || [])[i] || '').trim()
    return [price, suffix].filter(Boolean).join(' ').trim()
  })

  return {
    contract_version: ATOMIC_CONTRACT_VERSION,
    event_key: String(eventKey),
    evidence_hash: String(evidenceHash),
    channel: String(channel),
    sender_id: senderId ? String(senderId).slice(0, 200) : null,
    message_id: messageId ? String(messageId).slice(0, 200) : null,
    idempotency_key: String(nota.idempotencyKey || ''),
    provenance: {
      source_type: String(nota.provenance?.sourceType || ''),
      source_ref: String(nota.provenance?.sourceRef || ''),
      extracted_by: String(nota.provenance?.extractedBy || ''),
      extracted_at: nota.provenance?.extractedAt || null
    },
    header: {
      vendor_id: resolved.vendorId,
      invoice_no: String(header.invoiceNo || '').trim(),
      delivery_note_label: String(header.deliveryNoteLabel || ''),
      received_date: boundary.nota.tanggal,
      note: headerNote,
      project_id: resolved.projectId || null,
      purchase_request_id: header.prId || null,
      status: String(header.status || 'DIBELI'),
      alokasi: null,
      masuk_gudang: false,
      material: boundary.nota.material,
      biaya_lain: boundary.nota.biayaLain,
      diskon: boundary.nota.diskon,
      total: boundary.nota.total,
      is_internal_ref: !!header.isInternalRef,
      internal_ref_prefix: String(header.internalRefPrefix || 'BK')
    },
    items: lines.map((l, i) => ({
      line_no: i + 1,
      item_name: String(l.itemName),
      unit: l.unit || null,
      quantity_received: boundary.nota.items[i].qty,
      // Subtotal ikut dikirim supaya fungsi SQL bisa memverifikasi bahwa
      // rincian baris benar-benar menjumlah ke `material` header. Bila tidak
      // cocok, transaksi ditolak (bukan disimpan dengan total karangan).
      subtotal: boundary.nota.items[i].subtotal,
      note: lineNotes[i] || null,
      project_id: l.projectId || null,
      pr_item_id: l.prItemId || null
    })),
    requested_at: new Date(now).toISOString()
  }
}

// ------------------------------------------------------------
// 2) Panggil RPC (satu-satunya jalur tulis)
// ------------------------------------------------------------
export async function callAtomicSave({ client, args } = {}) {
  if (!client || typeof client.rpc !== 'function') {
    return fail(API_REASON.INTERNAL_ERROR, 'Klien DB server tidak tersedia.')
  }
  let res
  try {
    res = await client.rpc(ATOMIC_RPC, { p_payload: args })
  } catch (err) {
    if (isRpcMissing(err)) {
      return fail(API_REASON.ATOMIC_RPC_UNAVAILABLE, 'Transaksi atomik bersama belum tersedia — penulisan ditahan.')
    }
    // Detail driver tidak pernah keluar ke pemanggil API.
    return fail(API_REASON.INTERNAL_ERROR, 'Penyimpanan nota gagal (transaksi di-rollback).')
  }

  const { data, error } = res || {}
  if (error) {
    if (isRpcMissing(error)) {
      return fail(API_REASON.ATOMIC_RPC_UNAVAILABLE, 'Transaksi atomik bersama belum tersedia — penulisan ditahan.')
    }
    // Penolakan yang SAH dari fungsi (SQLSTATE kustom) -> kode stabil, bukan
    // error internal. Transaksi sudah di-rollback oleh PostgreSQL.
    const code = String(error.code || '')
    if (SQLSTATE_DUPLICATE[code]) {
      const kind = SQLSTATE_DUPLICATE[code]
      if (kind === 'conflict_invoice') {
        return {
          ok: false, status: 'duplicate', reason: API_REASON.DUPLICATE_EVIDENCE,
          error: 'Nomor nota ini sudah tercatat untuk vendor yang sama — tidak dicatat ulang.',
          sqlstate: code
        }
      }
      if (kind === 'duplicate_evidence') {
        return {
          ok: false, status: 'duplicate', reason: API_REASON.DUPLICATE_EVIDENCE,
          error: 'Bukti nota ini sudah tercatat (kanal lain) — tidak dicatat ulang.',
          sqlstate: code
        }
      }
      return fail(API_REASON.SAVE_FAILED, 'Transaksi menolak penulisan — tidak ada data ditulis.', { sqlstate: code })
    }
    return fail(API_REASON.SAVE_FAILED, 'Penyimpanan nota gagal (transaksi di-rollback).', {
      dbCode: code
    })
  }

  const payload = normalizeRpcData(data)
  if (!payload || typeof payload !== 'object') {
    return fail(API_REASON.INTERNAL_ERROR, 'Balasan transaksi tidak dikenali.')
  }
  if (payload.ok !== true) {
    const code = String(payload.code || '')
    if (code === 'duplicate_event') {
      return { ok: true, status: 'ignored_duplicate_event', reason: API_REASON.DUPLICATE_EVENT, result: payload }
    }
    if (code === 'duplicate_evidence' || code === 'conflict_invoice') {
      return {
        ok: false, status: 'duplicate', reason: API_REASON.DUPLICATE_EVIDENCE,
        error: code === 'conflict_invoice'
          ? 'Nomor nota ini sudah tercatat untuk vendor yang sama — tidak dicatat ulang.'
          : 'Bukti nota ini sudah tercatat (kanal lain) — tidak dicatat ulang.',
        result: payload
      }
    }
    if (code === 'ledger_unavailable') {
      return fail(API_REASON.LEDGER_UNAVAILABLE, 'Ledger idempotensi tidak tersedia — penulisan ditahan.', { result: payload })
    }
    if (code === 'invalid_payload' || code === 'unknown_reference') {
      return fail(API_REASON.INVALID_PAYLOAD, 'Payload ditolak oleh transaksi bersama — tidak ada data ditulis.', { result: payload })
    }
    return fail(API_REASON.SAVE_FAILED, 'Transaksi menolak penulisan — tidak ada data ditulis.', { result: payload })
  }
  return { ok: true, status: 'recorded', result: payload }
}

// Supabase mengembalikan jsonb sebagai objek; sebagian driver mengembalikan
// string. Keduanya diterima, bentuk lain ditolak (bukan ditebak).
function normalizeRpcData(data) {
  if (data == null) return null
  if (typeof data === 'string') {
    try { return JSON.parse(data) } catch { return null }
  }
  if (Array.isArray(data)) return data.length === 1 ? data[0] : null
  return data
}

// ------------------------------------------------------------
// 3) Verifikasi hasil transaksi (semantik, bukan HTTP 200)
// ------------------------------------------------------------
// Balasan RPC tidak dipercaya buta: id harus UUID, jumlah baris harus sama,
// dan setiap baris harus membawa identitas lengkap yang kita kirim. Baru
// setelah itu readback DB dilakukan (lihat readbackPurchaseStrict).
export function verifyAtomicResult({ result, args, expectedTotal }) {
  const diffs = []
  if (!result) return { ok: false, diffs: ['tanpa_balasan'] }
  const rid = String(result.receiving_id || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) diffs.push('receiving_id')
  if (String(result.evidence_hash || '') !== String(args.evidence_hash)) diffs.push('evidence_hash')
  if (String(result.event_key || '') !== String(args.event_key)) diffs.push('event_key')
  if (Number(result.item_count) !== args.items.length) diffs.push(`item_count(${result.item_count}≠${args.items.length})`)
  if (expectedTotal !== undefined && expectedTotal !== null && Math.round(Number(result.total)) !== Math.round(Number(expectedTotal))) {
    diffs.push('total')
  }
  const rows = Array.isArray(result.items) ? result.items : []
  if (rows.length !== args.items.length) diffs.push(`rows(${rows.length}≠${args.items.length})`)
  return { ok: diffs.length === 0, diffs }
}

// ------------------------------------------------------------
// 4) READBACK KETAT (tanpa fallback candidates[0])
// ------------------------------------------------------------
// Review Brooklyn: `readbackPurchase` lama memakai `candidates[0]` bila tidak
// ada baris yang cocok proyeknya, dan tidak memeriksa proyek kosong. Artinya
// nota dengan alokasi proyek salah masih bisa dinyatakan "tercatat".
//
// Aturan di sini:
//   * setiap baris yang diharapkan harus cocok TEPAT SATU baris DB pada
//     identitas lengkap: nama + satuan + qty + proyek + pr_item_id;
//   * tidak ada fallback ke kandidat pertama;
//   * jumlah baris DB harus SAMA dengan yang diharapkan (tidak boleh ada
//     baris ekstra);
//   * proyek pada header diperiksa bila nota memang satu proyek;
//   * harga harus muncul di catatan baris (satu-satunya tempat harga disimpan).
export async function readbackPurchaseStrict({ client, receivingId, expected } = {}) {
  if (!client) return fail(API_REASON.INTERNAL_ERROR, 'Klien DB server tidak tersedia.')
  if (!receivingId) return fail(API_REASON.READBACK_FAILED, 'ID nota tidak ada — tidak ada yang bisa dibaca ulang.')

  const { data: heads, error: hErr } = await client.from('receivings').select('*').eq('id', receivingId).limit(1)
  if (hErr) return fail(API_REASON.READBACK_FAILED, 'Readback nota gagal.')
  const head = (heads || [])[0]
  if (!head) return fail(API_REASON.READBACK_FAILED, 'Nota tidak ditemukan saat readback.')

  const { data: items, error: iErr } = await client.from('receiving_items').select('*').eq('receiving_id', receivingId)
  if (iErr) return fail(API_REASON.READBACK_FAILED, 'Readback barang gagal.')
  const rows = items || []

  const diffs = []
  const exp = expected || {}
  if (exp.vendorId && String(head.vendor_id) !== String(exp.vendorId)) diffs.push('vendor_id')
  if (exp.invoiceNo && String(head.invoice_no) !== String(exp.invoiceNo)) diffs.push('invoice_no')
  if (exp.date && String(head.received_date).slice(0, 10) !== String(exp.date)) diffs.push('received_date')
  if (exp.projectId && String(head.project_id || '') !== String(exp.projectId)) diffs.push('project_id')
  if (exp.projectId === null && exp.requireEmptyProject && String(head.project_id || '')) diffs.push('project_id_should_be_empty')
  if (exp.eventKey) {
    const mk = parseConnectorMarkers(head.note)
    if (mk.eventKey !== String(exp.eventKey)) diffs.push('marker:event')
    if (exp.evidenceHash && mk.evidenceHash !== String(exp.evidenceHash)) diffs.push('marker:evidence')
    if (exp.channel && mk.channel !== String(exp.channel)) diffs.push('marker:channel')
  }

  const posRows = rows.filter(r => Number(r.quantity_received) > 0)
  if (exp.itemCount !== undefined && posRows.length !== exp.itemCount) diffs.push(`item_count(${posRows.length}≠${exp.itemCount})`)
  if (exp.totalRows !== undefined && rows.length !== exp.totalRows) diffs.push(`row_count(${rows.length}≠${exp.totalRows})`)

  if (Array.isArray(exp.items)) {
    const used = new Set()
    for (const want of exp.items) {
      const wantProj = want.projectId === null || want.projectId === undefined ? '' : String(want.projectId)
      const wantPr = want.prItemId === null || want.prItemId === undefined ? '' : String(want.prItemId)
      const matches = posRows.filter(r => {
        if (used.has(r.id)) return false
        if (String(r.item_name || '') !== String(want.item_name || '')) return false
        if (String(r.unit || '') !== String(want.unit || '')) return false
        if (Math.round(Number(r.quantity_received) * 1000) !== Math.round(Number(want.quantity_received) * 1000)) return false
        if (String(r.pr_item_id || '') !== wantPr) return false
        const mk = parseConnectorMarkers(r.note)
        return String(mk.projectId || '') === wantProj
      })
      // TIDAK ADA fallback: 0 kandidat = mismatch, >1 = ambigu (juga mismatch).
      if (matches.length !== 1) {
        diffs.push(`${matches.length === 0 ? 'item_hilang' : 'item_ganda'}:${want.item_name}`)
        continue
      }
      const got = matches[0]
      used.add(got.id)
      const wantPrice = buildItemPriceNote(want.harga)
      if (wantPrice && String(got.note || '').indexOf(wantPrice) < 0) diffs.push(`harga:${want.item_name}`)
    }
    if (used.size !== posRows.length) diffs.push(`baris_ekstra(${posRows.length - used.size})`)
  }

  if (diffs.length) {
    return {
      ok: false,
      reason: REASON.READBACK_MISMATCH,
      error: `Readback nota TIDAK cocok pada: ${diffs.join(', ')}. Status "tercatat" tidak diklaim.`,
      diffs, head, items: rows
    }
  }
  return { ok: true, head, items: rows, verifiedAt: new Date().toISOString() }
}
