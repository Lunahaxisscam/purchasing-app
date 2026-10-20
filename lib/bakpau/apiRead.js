// ============================================================
// lib/bakpau/apiRead.js — BACA TERBATAS UNTUK AGEN BAKPAU (SERVER-ONLY)
// ============================================================
// Prinsip:
//   * BUKAN SQL/GraphQL bebas. Resource, kolom, filter, urutan, dan batas
//     halaman SEMUANYA daftar putih di kode ini.
//   * Parameter tak dikenal DITOLAK (bukan diabaikan diam-diam) supaya
//     pemanggil tidak mengira filter sudah diterapkan padahal tidak.
//   * Filter kode/ID dibandingkan LITERAL (trim + rapatkan spasi). Tidak ada
//     fuzzy, tidak ada "LIKE %...%", tidak ada pencocokan substring.
//   * Tidak ada tabel sensitif di daftar ini: users/profiles/credentials/
//     private_secrets/invoices/payments TIDAK bisa dibaca lewat API Bakpau.
// ============================================================

import { API_LIMITS, API_REASON } from './apiAuth.js'

// Kolom yang boleh dikembalikan per resource. `id` selalu ada.
export const READ_RESOURCES = Object.freeze({
  'masters/projects': Object.freeze({
    table: 'projects',
    columns: Object.freeze(['id', 'name', 'status', 'kode', 'code', 'created_at']),
    filters: Object.freeze(['id', 'kode', 'code', 'status']),
    order: 'kode'
  }),
  'masters/materials': Object.freeze({
    table: 'materials',
    columns: Object.freeze(['id', 'name', 'category', 'kode', 'code', 'unit', 'satuan', 'harga_acuan', 'current_stock', 'min_stock', 'created_at']),
    filters: Object.freeze(['id', 'kode', 'code', 'category']),
    order: 'kode'
  }),
  'masters/vendors': Object.freeze({
    table: 'vendors',
    columns: Object.freeze(['id', 'name', 'phone', 'supplier_category', 'store_link', 'created_at']),
    filters: Object.freeze(['id', 'name', 'supplier_category']),
    order: 'name'
  }),
  'purchase-requests': Object.freeze({
    table: 'purchase_requests',
    columns: Object.freeze(['id', 'pr_number', 'project_id', 'priority', 'status', 'title', 'materials_summary', 'notes', 'created_at']),
    filters: Object.freeze(['id', 'pr_number', 'project_id', 'status', 'priority']),
    order: 'pr_number'
  }),
  'purchase-request-items': Object.freeze({
    table: 'pr_items',
    columns: Object.freeze(['id', 'pr_id', 'material_id', 'vendor_id', 'quantity', 'estimated_price', 'status', 'item_name', 'kode', 'unit', 'supplier_category', 'sort_order']),
    filters: Object.freeze(['id', 'pr_id', 'material_id', 'status', 'kode']),
    order: 'sort_order'
  }),
  'purchases': Object.freeze({
    table: 'receivings',
    columns: Object.freeze(['id', 'purchase_request_id', 'vendor_id', 'status', 'received_date', 'invoice_no', 'delivery_note', 'note', 'project_id', 'alokasi', 'masuk_gudang', 'kendala', 'created_at']),
    filters: Object.freeze(['id', 'vendor_id', 'project_id', 'purchase_request_id', 'invoice_no', 'status']),
    order: 'created_at'
  }),
  'purchase-items': Object.freeze({
    table: 'receiving_items',
    columns: Object.freeze(['id', 'receiving_id', 'pr_item_id', 'item_name', 'quantity_received', 'unit', 'note', 'created_at']),
    filters: Object.freeze(['id', 'receiving_id', 'pr_item_id']),
    order: 'created_at'
  }),
  'physical-status': Object.freeze({
    table: 'handovers',
    columns: Object.freeze(['id', 'receiving_id', 'project_id', 'received_by', 'handover_date', 'status', 'note', 'diserahkan_at', 'created_at']),
    filters: Object.freeze(['id', 'receiving_id', 'project_id', 'status']),
    order: 'handover_date'
  })
})

export const READ_RESOURCE_NAMES = Object.freeze(Object.keys(READ_RESOURCES))

// Parameter kueri yang dikenal. `limit`, `offset`, dan `order` bukan filter.
const RESERVED_PARAMS = Object.freeze(['limit', 'offset', 'order'])

function fail(reason, error, extra = {}) {
  return { ok: false, reason, error, ...extra }
}

// Kunci literal: trim + rapatkan spasi. Tanda baca & besar-kecil dipertahankan
// untuk KODE, tetapi pencocokan akhir case-insensitive HANYA pada huruf
// (konsisten dengan resolve.js: 'A-12' != 'A1-2', 'a-12' == 'A-12').
export function literalKey(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

export function sameLiteral(a, b) {
  const x = literalKey(a).toLowerCase()
  const y = literalKey(b).toLowerCase()
  return !!x && x === y
}

// ------------------------------------------------------------
// Validasi parameter kueri -> rencana baca (tanpa menyentuh DB).
// ------------------------------------------------------------
export function planRead({ resource, query = {} } = {}) {
  const spec = READ_RESOURCES[String(resource || '')]
  if (!spec) {
    return fail(API_REASON.UNKNOWN_RESOURCE,
      `Resource "${resource}" tidak tersedia. Pilihan: ${READ_RESOURCE_NAMES.join(', ')}.`)
  }

  const unknown = Object.keys(query).filter(k => !spec.filters.includes(k) && !RESERVED_PARAMS.includes(k))
  if (unknown.length) {
    return fail(API_REASON.UNKNOWN_PARAMETER,
      `Parameter tidak dikenal untuk ${resource}: ${unknown.join(', ')}. ` +
      `Filter yang sah: ${spec.filters.join(', ')}; plus limit/offset/order.`)
  }

  // limit
  let limit = API_LIMITS.DEFAULT_PAGE_SIZE
  if (query.limit !== undefined && query.limit !== '') {
    const n = Number(query.limit)
    if (!Number.isInteger(n) || n < 1) return fail(API_REASON.BAD_QUERY, 'limit harus bilangan bulat >= 1.')
    limit = Math.min(n, API_LIMITS.MAX_PAGE_SIZE)
  }
  // offset
  let offset = 0
  if (query.offset !== undefined && query.offset !== '') {
    const n = Number(query.offset)
    if (!Number.isInteger(n) || n < 0) return fail(API_REASON.BAD_QUERY, 'offset harus bilangan bulat >= 0.')
    if (n > API_LIMITS.MAX_OFFSET) return fail(API_REASON.BAD_QUERY, `offset melebihi batas ${API_LIMITS.MAX_OFFSET}.`)
    offset = n
  }
  // order: hanya kolom yang ada di daftar putih, arah asc/desc
  let order = { column: spec.order, ascending: true }
  if (query.order !== undefined && query.order !== '') {
    const raw = String(query.order).trim()
    const m = raw.match(/^([a-z_]+)(?:\.(asc|desc))?$/i)
    if (!m) return fail(API_REASON.BAD_QUERY, 'order harus berbentuk kolom atau kolom.asc/kolom.desc.')
    const col = m[1].toLowerCase()
    if (!spec.columns.includes(col)) {
      return fail(API_REASON.BAD_QUERY, `order hanya boleh pada kolom: ${spec.columns.join(', ')}.`)
    }
    order = { column: col, ascending: (m[2] || 'asc').toLowerCase() === 'asc' }
  }

  const filters = []
  for (const key of spec.filters) {
    const v = query[key]
    if (v === undefined || v === '') continue
    if (Array.isArray(v)) return fail(API_REASON.BAD_QUERY, `Parameter ${key} hanya boleh satu nilai.`)
    const str = String(v)
    if (str.length > 200) return fail(API_REASON.BAD_QUERY, `Nilai ${key} terlalu panjang.`)
    filters.push({ column: key, value: str })
  }

  return {
    ok: true,
    table: spec.table,
    columns: spec.columns.slice(),
    filters,
    limit,
    offset,
    order
  }
}

// ------------------------------------------------------------
// Eksekusi rencana baca memakai klien Supabase yang disuntikkan.
// HANYA select. Tidak ada insert/update/delete/rpc di jalur baca.
// ------------------------------------------------------------
export async function runRead({ client, plan } = {}) {
  if (!client) return fail(API_REASON.INTERNAL_ERROR, 'Klien DB server tidak tersedia.')
  if (!plan || !plan.ok) return fail(API_REASON.BAD_QUERY, 'Rencana baca tidak sah.')

  let q = client.from(plan.table).select(plan.columns.join(','), { count: 'exact' })
  for (const f of plan.filters) {
    // `id` dan kolom UUID lain dibandingkan apa adanya; kode/teks memakai
    // pencocokan literal case-insensitive yang setara dengan `ilike` TANPA
    // wildcard (escape % dan _ supaya tidak jadi pola).
    if (f.column === 'id' || f.column.endsWith('_id')) q = q.eq(f.column, f.value)
    else q = q.ilike(f.column, escapeLike(f.value))
  }
  q = q.order(plan.order.column, { ascending: plan.order.ascending })
  q = q.range(plan.offset, plan.offset + plan.limit - 1)

  const { data, error, count } = await q
  if (error) {
    return fail(API_REASON.INTERNAL_ERROR, `Pembacaan ${plan.table} gagal.`, { dbCode: String(error.code || '') })
  }
  const rows = Array.isArray(data) ? data : []
  return {
    ok: true,
    table: plan.table,
    rows: rows.map(r => pick(r, plan.columns)),
    page: { limit: plan.limit, offset: plan.offset, returned: rows.length, total: count === null ? null : count },
    order: plan.order,
    filters: plan.filters.map(f => ({ column: f.column, value: f.value }))
  }
}

export function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, ch => `\\${ch}`)
}

function pick(row, columns) {
  const out = {}
  for (const c of columns) if (Object.prototype.hasOwnProperty.call(row || {}, c)) out[c] = row[c]
  return out
}

// ------------------------------------------------------------
// Baca satu nota + barisnya (untuk readback create). Tetap memakai daftar
// putih kolom yang sama; tidak ada `select('*')`.
// ------------------------------------------------------------
export async function readPurchaseById({ client, receivingId } = {}) {
  if (!client) return fail(API_REASON.INTERNAL_ERROR, 'Klien DB server tidak tersedia.')
  if (!receivingId || !/^[0-9a-fA-F-]{36}$/.test(String(receivingId))) {
    return fail(API_REASON.BAD_QUERY, 'receivingId harus UUID.')
  }
  const headCols = READ_RESOURCES['purchases'].columns.join(',')
  const itemCols = READ_RESOURCES['purchase-items'].columns.join(',')

  const { data: heads, error: hErr } = await client.from('receivings').select(headCols).eq('id', receivingId).limit(1)
  if (hErr) return fail(API_REASON.READBACK_FAILED, 'Pembacaan nota gagal.')
  const head = (heads || [])[0]
  if (!head) return fail(API_REASON.NOT_FOUND, `Nota ${receivingId} tidak ditemukan.`)

  const { data: items, error: iErr } = await client.from('receiving_items').select(itemCols).eq('receiving_id', receivingId)
  if (iErr) return fail(API_REASON.READBACK_FAILED, 'Pembacaan baris nota gagal.')

  return { ok: true, purchase: head, items: items || [] }
}
