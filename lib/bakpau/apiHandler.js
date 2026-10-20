// ============================================================
// lib/bakpau/apiHandler.js — HANDLER API AGEN BAKPAU (SERVER-ONLY)
// ============================================================
// Dua route tipis memakai file ini:
//   pages/api/bakpau/v1/read.js    -> POST { resource, query }  (scope read)
//   pages/api/bakpau/v1/purchases.js -> POST { …payload… }      (scope create)
//
// URUTAN GERBANG (penting, ini yang memperbaiki defect handler lama):
//   1. metode            -> 405
//   2. konfigurasi token -> 503 (fail closed)
//   3. ukuran body       -> 413
//   4. token + scope     -> 401/403   <-- SEBELUM satu pun query DB
//   5. rate limit        -> 429
//   6. bentuk payload    -> 400/422 (masih tanpa DB)
//   7. baru kemudian: klien server, master, tulis, readback, notifikasi.
//
// Balasan TIDAK PERNAH memuat token, kunci Supabase, SQL, stack trace, atau
// pesan error mentah dari Postgres. Semua error keluar sebagai kode stabil.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { ENV_KEYS } from './constants.js'
import {
  API_ENV_KEYS, API_LIMITS, API_REASON, SCOPES,
  READ_KEY_CHAIN, READ_URL_CHAIN, FORBIDDEN_READ_KEYS,
  classifyReadKey, verifyApiToken, createRateLimiter
} from './apiAuth.js'
import { planRead, runRead, READ_RESOURCE_NAMES, readPurchaseById } from './apiRead.js'
import { validateStructuredPayload, createPurchaseFromExtraction } from './apiCreate.js'
import { loadMasters } from './connector.js'
import { createRpcTransport } from './notify.js'

export const ALLOWED_METHODS = Object.freeze(['POST'])

// Satu limiter per proses. Cukup untuk menahan brute force token; bukan
// pengganti proteksi infrastruktur.
const limiter = createRateLimiter({
  perMinute: Number(process.env[API_ENV_KEYS.RATE_LIMIT] || API_LIMITS.RATE_PER_MIN) || API_LIMITS.RATE_PER_MIN
})

export function serverClient(env) {
  const url = env[ENV_KEYS.SUPABASE_URL] || env[ENV_KEYS.PUBLIC_URL]
  const key = env[ENV_KEYS.SERVICE_KEY]
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Klien BACA: HANYA kunci yang tunduk pada RLS.
//
// Review Brooklyn menemukan rantai lama jatuh ke SUPABASE_SERVICE_ROLE_KEY —
// dalam kondisi itu "scope purchasing:read" tidak lagi menjadi batas izin
// database (service role melewati RLS). Sekarang:
//   * kunci privileged DITOLAK walau dipasang di env baca khusus;
//   * tidak ada kunci ber-RLS -> null + alasan (handler menjawab 503
//     fail-closed, BUKAN membaca tanpa batas).
export function readCredential(env = {}) {
  for (const name of READ_KEY_CHAIN) {
    const raw = env[name]
    if (!raw) continue
    const cls = classifyReadKey(raw)
    if (!cls.ok) {
      return { client: null, keyFrom: name, reason: cls.reason, kind: cls.kind }
    }
    const url = READ_URL_CHAIN.map(k => env[k]).find(Boolean)
    if (!url) return { client: null, keyFrom: name, reason: API_REASON.READ_CREDENTIAL_MISSING, kind: cls.kind }
    return {
      client: createClient(url, raw, { auth: { persistSession: false, autoRefreshToken: false } }),
      keyFrom: name,
      urlFrom: READ_URL_CHAIN.find(k => env[k]) || null,
      reason: null,
      kind: cls.kind
    }
  }
  return { client: null, keyFrom: null, reason: API_REASON.READ_CREDENTIAL_MISSING, kind: 'absent' }
}

// Kompatibilitas: pemanggil lama hanya butuh klien (atau null).
export function readClient(env) {
  return readCredential(env).client
}

// Nama env yang TERPAKAI (bukan nilainya) — untuk laporan capability.
export function readCredentialSource(env) {
  const c = readCredential(env)
  return {
    urlFrom: c.urlFrom || null,
    keyFrom: c.keyFrom || null,
    keyKind: c.kind || null,
    reason: c.reason || null,
    usesServiceRole: false,
    forbiddenEnvPresent: FORBIDDEN_READ_KEYS.filter(k => !!env[k])
  }
}

function maxBody(env) {
  const n = Number(env[API_ENV_KEYS.MAX_BODY] || API_LIMITS.MAX_BODY_BYTES)
  return Number.isFinite(n) && n > 0 ? Math.min(n, API_LIMITS.MAX_BODY_BYTES) : API_LIMITS.MAX_BODY_BYTES
}

function send(res, status, payload, extraHeaders = {}) {
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(status).json(payload)
}

function bodyOf(req) {
  if (typeof req.body === 'string') return req.body
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body)
  return ''
}

// Gerbang bersama: metode, konfigurasi, ukuran, token, scope, rate limit.
// Mengembalikan { ok:true, keyId, scopes, json } atau { ok:false } setelah
// respons ditulis. TIDAK menyentuh DB sama sekali.
function gate(req, res, { env, requiredScope, deps }) {
  if (!ALLOWED_METHODS.includes(req.method)) {
    res.setHeader('Allow', ALLOWED_METHODS.join(', '))
    send(res, 405, { ok: false, code: API_REASON.METHOD_NOT_ALLOWED, error: 'Hanya POST.' })
    return { ok: false }
  }

  const raw = bodyOf(req)
  const bytes = Buffer.byteLength(raw || '', 'utf8')
  if (bytes > maxBody(env)) {
    send(res, 413, { ok: false, code: API_REASON.BODY_TOO_LARGE, error: 'Body melebihi batas.' })
    return { ok: false }
  }

  const auth = (deps.verifyToken || verifyApiToken)({ headers: req.headers || {}, env, requiredScope })
  if (!auth.ok) {
    if (auth.status === 403) {
      send(res, 403, { ok: false, code: API_REASON.INSUFFICIENT_SCOPE, error: auth.error, scopes: auth.scopes || [] })
    } else if (auth.status === 503) {
      send(res, 503, { ok: false, code: API_REASON.NOT_CONFIGURED, error: auth.error })
    } else {
      send(res, 401, { ok: false, code: auth.reason || API_REASON.INVALID_TOKEN, error: auth.error })
    }
    return { ok: false }
  }

  const rl = (deps.rateLimiter || limiter).check(auth.keyId)
  if (!rl.ok) {
    send(res, 429, { ok: false, code: API_REASON.RATE_LIMITED, error: 'Terlalu banyak permintaan.' },
      { 'Retry-After': String(rl.retryAfterSec || 60) })
    return { ok: false }
  }

  let json
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    send(res, 400, { ok: false, code: API_REASON.BAD_JSON, error: 'Body bukan JSON yang sah.' })
    return { ok: false }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    send(res, 400, { ok: false, code: API_REASON.BAD_JSON, error: 'Body harus objek JSON.' })
    return { ok: false }
  }

  return { ok: true, keyId: auth.keyId, scopes: auth.scopes, json, raw }
}

// ------------------------------------------------------------
// READ HANDLER
// ------------------------------------------------------------
export function createBakpauReadHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env
    const g = gate(req, res, { env, requiredScope: SCOPES.READ, deps })
    if (!g.ok) return

    const resource = String(g.json.resource || '')
    const query = (g.json.query && typeof g.json.query === 'object' && !Array.isArray(g.json.query)) ? g.json.query : {}
    if (!resource) {
      return send(res, 400, {
        ok: false, code: API_REASON.UNKNOWN_RESOURCE,
        error: 'Field "resource" wajib.', resources: READ_RESOURCE_NAMES
      })
    }

    const plan = planRead({ resource, query })
    if (!plan.ok) {
      return send(res, 400, { ok: false, code: plan.reason, error: plan.error })
    }

    // Kredensial baca WAJIB ber-RLS. Tidak ada fallback privileged: bila yang
    // tersedia hanya service role, permintaan ditolak (fail closed) — lebih
    // baik API tidak membaca daripada membaca melewati RLS.
    const cred = deps.createReadClient
      ? { client: deps.createReadClient(env), reason: null }
      : readCredential(env)
    if (!cred.client) {
      const reason = cred.reason || API_REASON.READ_CREDENTIAL_MISSING
      return send(res, 503, {
        ok: false,
        code: reason,
        error: reason === API_REASON.READ_CREDENTIAL_PRIVILEGED
          ? 'Kredensial baca API tidak berizin sempit (kunci privileged ditolak) — pembacaan ditahan.'
          : 'Kredensial baca ber-RLS belum tersedia di server — pembacaan ditahan.'
      })
    }

    const out = await runRead({ client: cred.client, plan })
    if (!out.ok) {
      // Pesan DB internal tidak pernah diteruskan ke pemanggil.
      // Kesalahan bentuk/nilai filter = 400 (salah pemanggil), bukan 502.
      const status = out.reason === API_REASON.BAD_QUERY ? 400 : 502
      return send(res, status, {
        ok: false,
        code: out.reason || API_REASON.INTERNAL_ERROR,
        error: status === 400 ? out.error : 'Pembacaan data gagal.'
      })
    }

    return send(res, 200, {
      ok: true,
      resource,
      data: out.rows,
      page: out.page,
      order: out.order,
      filters: out.filters,
      columns: plan.columns
    })
  }
}

// ------------------------------------------------------------
// CREATE HANDLER
// ------------------------------------------------------------
// URUTAN: auth (di gate) -> validasi bentuk -> kredensial server -> masters ->
// SATU RPC transaksional. Tidak ada klaim ledger terpisah, tidak ada tulisan
// header/baris multipart, tidak ada release-lalu-retry. Bila RPC bersama
// belum tersedia, jawabannya 503 dan NOL baris ditulis (fail closed).
export function createBakpauCreateHandler(deps = {}) {
  return async function handler(req, res) {
    const env = deps.env || process.env
    const g = gate(req, res, { env, requiredScope: SCOPES.CREATE, deps })
    if (!g.ok) return

    // 1) Bentuk payload divalidasi SEBELUM DB disentuh.
    const validated = validateStructuredPayload(g.json)
    if (!validated.ok) {
      return send(res, 422, { ok: false, code: validated.reason, error: validated.error, problems: validated.problems || [] })
    }

    const client = (deps.createClient || serverClient)(env)
    if (!client) {
      return send(res, 503, {
        ok: false, code: REASON_NO_SERVICE,
        error: 'Kredensial server untuk menyimpan nota tidak tersedia.'
      })
    }

    // 2) Master dibaca server (bukan dari body) — hanya setelah auth sah.
    const mastersRes = await (deps.loadMasters || loadMasters)({ client })
    if (!mastersRes.ok) {
      return send(res, 502, {
        ok: false, code: 'masters_unavailable',
        error: 'Master proyek/vendor tidak bisa dibaca — tidak ada data yang ditulis.'
      })
    }

    const transport = deps.transport || createRpcTransport({ client })

    let out
    try {
      out = await createPurchaseFromExtraction({
        client,
        validated,
        masters: mastersRes.masters,
        transport,
        env,
        notify: deps.notify !== false
      })
    } catch (err) {
      // Detail internal tidak keluar; hanya kode stabil.
      console.error('bakpau api create error:', sanitizeLogMessage(err?.message || err))
      return send(res, 500, { ok: false, code: API_REASON.INTERNAL_ERROR, error: 'Kesalahan internal saat menyimpan nota.' })
    }

    const status = pickCreateStatus(out)
    return send(res, status, {
      ok: out.ok === true,
      status: out.status || null,
      code: out.reason || null,
      error: out.error || null,
      receivingId: out.receivingId || null,
      invoiceNo: out.invoiceNo || null,
      isInternalRef: out.isInternalRef === true,
      idempotencyKey: out.idempotencyKey || null,
      totals: out.totals || null,
      items: out.items || null,
      readback: out.readback || null,
      notification: out.notification || null,
      problems: out.problems || null
    })
  }
}

// Pesan log tidak boleh memuat kredensial/URL berkunci. Nilai rahasia tidak
// pernah kita tulis ke log, tetapi driver bisa menyertakan connection string
// pada error — potong kueri/parameter yang mengandung kunci.
export function sanitizeLogMessage(msg) {
  let s = String(msg ?? '')
  s = s.replace(/(password|apikey|api_key|token|secret|authorization)=([^\s&]+)/gi, '$1=***')
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
  return s.slice(0, 400)
}

function pickCreateStatus(out) {
  if (out.ok && out.status === 'tercatat') return 201
  if (out.ok && out.status === 'ignored_duplicate_event') return 200
  if (out.status === 'duplicate') return 200
  if (out.reason === API_REASON.AMBIGUOUS_EXTRACTION) return 422
  if (out.reason === API_REASON.INVALID_PAYLOAD || out.reason === API_REASON.UNKNOWN_REFERENCE) return 422
  if (out.reason === API_REASON.LEDGER_UNAVAILABLE) return 503
  if (out.reason === API_REASON.ATOMIC_RPC_UNAVAILABLE) return 503
  if (out.reason === API_REASON.READBACK_FAILED) return 502
  return 502
}

const REASON_NO_SERVICE = 'no_service_credentials'

// Ekspor untuk tes: memastikan tidak ada jalur lain yang bisa menulis.
export const WRITE_ROUTES = Object.freeze(['purchases'])
