// ============================================================
// lib/bakpau/apiEdit.js â KOREKSI NOTA VIA RPC ATOMIK (SERVER-ONLY)
// ============================================================
// Latar (izin DAT, 2026-11-12): nota yang sudah tercatat sebelumnya
// IMMUTABLE â salah catat harus dibuat duplikat, yang membebani laporan.
// Fungsi SQL berikut memperbaiki itu:
//
//     public.bakpau_edit_purchase_atomic(p_payload jsonb)
//
// SATU transaksi: klaim event edit -> kunci baris nota -> validasi patch ->
// terapkan perubahan -> snapshot before/after di ledger. Tidak ada jalur
// edit kedua; bila fungsi gagal, PostgreSQL me-rollback semuanya.
//
// ATURAN (dipaksa di SQL, dicermati di sini untuk balasan cepat):
//   * reason WAJIB â setiap koreksi punya alasan yang tercatat di ledger.
//   * field patch di-whitelist; field asing ditolak.
//   * nota terhubung PR: baris tidak boleh diganti, proyek tidak boleh
//     dipindah (qty barang PR hanya lewat alur PR).
//   * invoice_no tidak boleh dikosongkan dan tidak boleh bentrok dengan
//     nota lain untuk vendor yang sama.
//   * harga baris tetap hidup di note `[Harga: n]`, disusun oleh
//     buildItemPriceNote() â satu sumber dengan jalur create.
//   * detail driver/SQL tidak pernah keluar ke pemanggil API.
// ============================================================

import { ATOMIC_CONTRACT_VERSION, isRpcMissing } from './atomicPurchase.js'
import { buildItemPriceNote } from '../../lib/purchaseNote.js'
import {
  buildItemPriceNoteLoose, markItemVoid, effectiveLineTotal,
  rebuildHeaderNominal, parseHargaFromNote
} from './itemVoid.js'
import { API_LIMITS } from './apiAuth.js'

export const EDIT_RPC = 'bakpau_edit_purchase_atomic'
export const EDIT_CONTRACT_VERSION = ATOMIC_CONTRACT_VERSION

// Baca harga satuan dari note baris ([Harga: n]) tanpa melempar.
// null (penanda tidak ada, data lama) dihitung 0 untuk penjumlahan.
function hargaFromItemNote(note) {
  const n = parseHargaFromNote(note)
  return n === null ? 0 : n
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Kode SQLSTATE kustom yang bisa dilempar fungsi edit (RAISE -> rollback).
const SQLSTATE_EDIT = Object.freeze({ BK003: 'line_count_mismatch' })

const PATCH_FIELD_MAP = Object.freeze({
  date: 'received_date',
  invoiceNo: 'invoice_no',
  note: 'note',
  kendala: 'kendala',
  deliveryNote: 'delivery_note',
  vendorId: 'vendor_id',
  projectId: 'project_id'
})

function bad(code, error, status = 422, extra = {}) {
  return { ok: false, status, code, error, ...extra }
}

function fail(reason, error, extra = {}) {
  return { ok: false, reason, error, ...extra }
}

function isUuid(v) { return UUID_RE.test(String(v || '')) }

function validDate(v) {
  const s = String(v || '')
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

// ------------------------------------------------------------
// 1) Validasi payload edit (murni, tanpa DB) + bangun argumen RPC
// ------------------------------------------------------------
// Input API (camelCase, konsisten dengan endpoint create):
//   { receivingId, reason, idempotencyKey,
//     patch?: { date, invoiceNo, note, kendala, deliveryNote, vendorId, projectId },
//     items?: [{ itemName, qty, harga, unit? }],   // penggantian penuh baris
//     provenance?, senderId?, messageId? }
export function buildEditRpcArgs(json = {}) {
  const receivingId = String(json.receivingId || '')
  if (!isUuid(receivingId)) {
    return bad('invalid_payload', 'receivingId wajib UUID nota.')
  }

  const reason = String(json.reason || '').trim()
  if (reason.length < 3 || reason.length > 500) {
    return bad('invalid_payload', 'reason wajib diisi (3-500 karakter) â alasan koreksi tercatat di ledger.')
  }

  const idempotencyKey = String(json.idempotencyKey || '').trim()
  if (!idempotencyKey || idempotencyKey.length > 120) {
    return bad('invalid_payload', 'idempotencyKey wajib (maks 120 karakter).')
  }

  const patchIn = json.patch
  if (patchIn !== undefined && (patchIn === null || typeof patchIn !== 'object' || Array.isArray(patchIn))) {
    return bad('invalid_payload', 'patch harus objek.')
  }

  const patch = {}
  const unknown = []
  if (patchIn && typeof patchIn === 'object') {
    for (const [k, v] of Object.entries(patchIn)) {
      if (!PATCH_FIELD_MAP[k]) { unknown.push(k); continue }
      if (v === null || v === undefined) return bad('invalid_payload', `patch.${k} tidak boleh null â gunakan string kosong untuk menghapus isi teks.`)
      patch[PATCH_FIELD_MAP[k]] = v
    }
  }
  if (unknown.length) {
    return bad('invalid_payload', `Field patch tidak dikenal: ${unknown.join(', ')}.`)
  }

  if ('received_date' in patch) {
    if (!validDate(patch.received_date)) return bad('invalid_patch', 'patch.date bukan tanggal sah (YYYY-MM-DD).')
  }
  if ('invoice_no' in patch) {
    const inv = String(patch.invoice_no || '').trim()
    if (!inv) return bad('invalid_patch', 'patch.invoiceNo tidak boleh kosong (identitas nota).')
    if (inv.length > 100) return bad('invalid_patch', 'patch.invoiceNo terlalu panjang (maks 100).')
    patch.invoice_no = inv
  }
  for (const t of ['note', 'kendala', 'delivery_note']) {
    if (t in patch) {
      const s = String(patch[t] === undefined ? '' : patch[t]).trim()
      if (s.length > 2000) return bad('invalid_patch', `patch.${t} terlalu panjang (maks 2000).`)
      patch[t] = s
    }
  }
  if ('vendor_id' in patch && !isUuid(patch.vendor_id)) {
    return bad('invalid_patch', 'patch.vendorId bukan UUID.')
  }
  if ('project_id' in patch) {
    const pid = String(patch.project_id || '').trim()
    if (pid && !isUuid(pid)) return bad('invalid_patch', 'patch.projectId bukan UUID.')
    patch.project_id = pid || null
  }

  const hasPatch = Object.keys(patch).length > 0
  const hasItems = Array.isArray(json.items)
  if (!hasPatch && !hasItems) {
    return bad('invalid_payload', 'Tidak ada perubahan: isi patch atau items.')
  }

  let items = null
  if (hasItems) {
    if (json.items.length === 0) {
      return bad('invalid_patch', 'items tidak boleh kosong â untuk nota tanpa barang, catat nota baru.')
    }
    if (json.items.length > API_LIMITS.MAX_ITEMS_PER_NOTA) {
      return bad('invalid_patch', `Terlalu banyak baris (maks ${API_LIMITS.MAX_ITEMS_PER_NOTA}).`)
    }
    items = json.items.map((it, i) => {
      const itemName = String(it?.itemName || '').trim()
      if (!itemName || itemName.length > 200) {
        return bad('invalid_patch', `items[${i}].itemName wajib diisi (maks 200 karakter).`)
      }
      const qty = Number(it?.qty)
      // PAKET 1: qty 0 tetap ditolak â baris yang dibatalkan di-VOID, bukan
      // dibuat qty 0 (barangnya tetap ada secara fisik).
      if (!Number.isFinite(qty) || qty <= 0) {
        return bad('invalid_patch', `items[${i}].qty harus angka > 0.`)
      }
      const harga = Number(it?.harga)
      // PAKET 1 (brief Bakpau 5A): harga 0 SEKARANG SAH â cara membatalkan
      // nilai baris tanpa menghapusnya. Dulu ditolak, sehingga nota duplikat
      // tetap menambah cost proyek.
      if (!Number.isFinite(harga) || harga < 0) {
        return bad('invalid_patch', `items[${i}].harga harus angka >= 0 (0 = baris dibatalkan).`)
      }
      const voided = it?.void === true || String(it?.status || '').toUpperCase() === 'VOID'
      const voidReason = String(it?.voidReason || '').trim()
      if (voided && !voidReason) {
        return bad('invalid_patch', `items[${i}].voidReason wajib diisi bila baris di-VOID.`)
      }
      if (voidReason.length > 200) {
        return bad('invalid_patch', `items[${i}].voidReason terlalu panjang (maks 200).`)
      }
      const unit = String(it?.unit || '').trim()
      if (unit.length > 40) {
        return bad('invalid_patch', `items[${i}].unit terlalu panjang (maks 40).`)
      }
      // Harga hidup di note. Baris void dapat penanda eksplisit supaya tetap
      // TERLIHAT di nota tapi tidak dihitung ke total/P&L.
      let note = buildItemPriceNoteLoose(harga, { voided })
      if (voided) note = markItemVoid(note, voidReason)
      return {
        line_no: i + 1,
        item_name: itemName,
        unit: unit || null,
        quantity_received: qty,
        note
      }
    })
    const firstBad = items.find(x => x && x.ok === false)
    if (firstBad) return firstBad
  }

  const provenanceIn = json.provenance
  const provenance = (provenanceIn && typeof provenanceIn === 'object' && !Array.isArray(provenanceIn))
    ? {
        source_type: String(provenanceIn.sourceType || '').slice(0, 100),
        source_ref: String(provenanceIn.sourceRef || '').slice(0, 200),
        extracted_by: String(provenanceIn.extractedBy || '').slice(0, 100),
        extracted_at: provenanceIn.extractedAt || null
      }
    : {}

  // ------------------------------------------------------------
  // PAKET 1 (brief Bakpau 5A): NOMINAL HEADER DIHITUNG ULANG DARI BARIS.
  // Dulu header dibiarkan basi (kasus nyata: header [Nominal: Rp 282.000]
  // padahal item sudah dinolkan) sehingga angka aplikasi berbeda dari isi
  // baris â berbahaya untuk audit. Sekarang nominal = jumlah baris EFEKTIF
  // (baris VOID bernilai 0). Bila klien mengirim patch.note, [Nominal]
  // di dalamnya diganti; bila tidak, hasil hitung dikirim sebagai
  // patch.nominal_rebuild untuk dipakai fungsi SQL.
  // ------------------------------------------------------------
  if (items) {
    const lineTotal = items.reduce(
      (sum, it) => sum + effectiveLineTotal(it.quantity_received, hargaFromItemNote(it.note), it.note),
      0
    )
    if ('note' in patch) {
      patch.note = rebuildHeaderNominal(String(patch.note || ''), lineTotal)
    } else {
      patch.nominal_rebuild = Math.round(lineTotal)
    }
  }

  return {
    ok: true,
    args: {
      contract_version: EDIT_CONTRACT_VERSION,
      // event_key deterministik: retry dengan kunci idempotensi sama = koreksi
      // yang sama, bukan koreksi kedua.
      event_key: `edit:${receivingId}:${idempotencyKey}`,
      channel: 'api',
      sender_id: json.senderId ? String(json.senderId).slice(0, 200) : null,
      message_id: json.messageId ? String(json.messageId).slice(0, 200) : null,
      idempotency_key: idempotencyKey,
      provenance,
      receiving_id: receivingId,
      reason,
      patch,
      ...(items ? { items } : {})
    }
  }
}

// ------------------------------------------------------------
// 2) Panggil RPC edit (satu-satunya jalur edit)
// ------------------------------------------------------------
export async function callAtomicEdit({ client, args } = {}) {
  if (!client || typeof client.rpc !== 'function') {
    return fail('no_service_credentials', 'Klien DB server tidak tersedia.')
  }
  let res
  try {
    res = await client.rpc(EDIT_RPC, { p_payload: args })
  } catch (err) {
    if (isRpcMissing(err)) {
      return fail('edit_rpc_unavailable', 'Transaksi edit atomik belum tersedia â koreksi ditahan.')
    }
    return fail('save_failed', 'Koreksi gagal (transaksi di-rollback).')
  }

  const { data, error } = res || {}
  if (error) {
    if (isRpcMissing(error)) {
      return fail('edit_rpc_unavailable', 'Transaksi edit atomik belum tersedia â koreksi ditahan.')
    }
    const code = String(error.code || '')
    if (SQLSTATE_EDIT[code]) {
      return fail('save_failed', 'Transaksi menolak koreksi â tidak ada data diubah.', { sqlstate: code })
    }
    return fail('save_failed', 'Koreksi gagal (transaksi di-rollback).')
  }

  const payload = data && typeof data === 'object' ? data : null
  if (!payload) {
    return fail('save_failed', 'Balasan transaksi tidak dikenal.')
  }
  if (payload.ok === false) {
    // Penolakan sah dari fungsi SQL -> kode stabil + status HTTP yang pas.
    const code = String(payload.code || 'save_failed')
    const map = {
      invalid_payload: 422,
      invalid_patch: 422,
      vendor_unknown: 422,
      project_unknown: 422,
      not_found: 404,
      duplicate_event: 409,
      conflict_invoice: 409,
      pr_linked_items: 409,
      pr_linked_header: 409
    }
    return {
      ok: false,
      status: map[code] || 500,
      code,
      error: String(payload.detail || 'Koreksi ditolak transaksi.'),
      receivingId: payload.receiving_id || null
    }
  }
  return { ok: true, data: payload }
}
