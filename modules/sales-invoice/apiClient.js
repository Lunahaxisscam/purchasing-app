// ============================================================
// modules/sales-invoice/apiClient.js — KLIEN HTTP UNTUK /api/sales-invoices
// ============================================================
// Semua panggilan HTTP modul lewat sini supaya:
//   * header otorisasi (JWT sesi Supabase) SELALU ikut — endpoint sekarang
//     menolak permintaan tanpa sesi admin (guard UI saja tidak cukup),
//   * Idempotency-Key dikirim untuk POST supaya retry/double-click tidak
//     membuat invoice ganda,
//   * error server (code/blocker) diteruskan apa adanya ke UI, bukan
//     ditelan menjadi pesan generik.
// ============================================================

export const API_PATH = '/api/sales-invoices'

// Ambil token sesi Supabase yang sedang aktif. Dipakai supaya modul tidak
// perlu perubahan file CORE (pages/index.js) hanya untuk meneruskan session:
// endpoint tetap menerima JWT yang sah dan memverifikasinya sendiri.
export async function getAccessToken(client) {
  try {
    const c = client || (await import('../../lib/supabaseClient')).supabase
    if (!c || !c.auth) return null
    const { data } = await c.auth.getSession()
    return (data && data.session && data.session.access_token) || null
  } catch (_) {
    return null
  }
}

// Buat idempotency key untuk satu percobaan simpan. Dipakai ulang saat retry
// manual supaya permintaan yang sama tidak menghasilkan dua invoice.
export function makeIdempotencyKey(prefix = 'si') {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

export class InvoiceApiError extends Error {
  constructor(message, info = {}) {
    super(message)
    this.name = 'InvoiceApiError'
    this.code = info.code || 'API_ERROR'
    this.status = info.status || 0
    this.blocker = info.blocker || null
    this.errors = info.errors || null
    this.extra = info.extra || null
  }
}

async function request(path, { method = 'GET', body, token, idempotencyKey, fetchImpl } = {}) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!doFetch) throw new InvoiceApiError('Browser tidak mendukung fetch.', { code: 'NO_FETCH' })

  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let res
  try {
    res = await doFetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch (err) {
    throw new InvoiceApiError(
      `Tidak bisa menghubungi server invoice: ${err.message}`,
      { code: 'NETWORK_ERROR' }
    )
  }

  let json = null
  try {
    json = await res.json()
  } catch (_) {
    json = null
  }

  if (!res.ok || !json || json.ok === false) {
    throw new InvoiceApiError(
      (json && json.error) || `Permintaan invoice gagal (HTTP ${res.status}).`,
      {
        code: (json && json.code) || `HTTP_${res.status}`,
        status: res.status,
        blocker: json && json.blocker,
        errors: json && json.errors,
        extra: json
      }
    )
  }
  return json
}

export async function listInvoices({ token, fetchImpl } = {}) {
  return request(API_PATH, { token, fetchImpl })
}

export async function createDraftInvoice(payload, { token, idempotencyKey, fetchImpl } = {}) {
  return request(API_PATH, {
    method: 'POST',
    body: payload,
    token,
    idempotencyKey: idempotencyKey || makeIdempotencyKey('si-create'),
    fetchImpl
  })
}

export async function transitionInvoice({ id, status, fields, evidence }, { token, fetchImpl } = {}) {
  const body = { id, status }
  if (fields) body.fields = fields
  if (evidence) body.evidence = evidence
  return request(API_PATH, { method: 'PATCH', body, token, fetchImpl })
}

// Alias eksplisit supaya pemanggil tidak perlu tahu status string.
export const issueInvoice = (id, opts) => transitionInvoice({ id, status: 'TERBIT' }, opts)
export const markSent = (id, sentChannel, opts) =>
  transitionInvoice({ id, status: 'TERKIRIM', evidence: { sent_channel: sentChannel } }, opts)
export const markPaid = (id, evidence, opts) => transitionInvoice({ id, status: 'LUNAS', evidence }, opts)
export const voidInvoice = (id, opts) => transitionInvoice({ id, status: 'BATAL' }, opts)
