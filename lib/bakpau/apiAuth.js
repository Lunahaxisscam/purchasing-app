// ============================================================
// lib/bakpau/apiAuth.js — IDENTITAS API KHUSUS BAKPAU (SERVER-ONLY)
// ============================================================
// Token connector Bakpau BUKAN service_role, BUKAN anon key, BUKAN password
// user. Ia hanya membuka dua izin sempit pada API purchasing:
//     purchasing:read    -> baca master/PR/pembelian/status fisik
//     purchasing:create  -> catat SATU nota pembelian (tanpa PR fiktif,
//                           tanpa serah terima fisik, tanpa invoice/payment)
//
// FORMAT TOKEN (dibuat di sisi server, hanya sekali, tidak pernah di URL):
//     bpk.<keyId>.<secret>
//   keyId  : 8-32 karakter [a-z0-9] — penanda kunci (bukan rahasia)
//   secret : >= 32 byte acak, base64url — RAHASIA
//
// PENYIMPANAN DI SERVER: HANYA HASH. Env `BAKPAU_API_TOKENS` berisi daftar
//     <keyId>:<sha256hex>:<scope>+<scope>
// dipisah koma. Tidak ada token mentah di server, tidak ada token di repo.
//
// FAIL CLOSED:
//   * env kosong / tidak bisa diparse  -> 503 api_not_configured (bukan 200).
//   * keyId tidak dikenal              -> 401 invalid_token.
//   * keyId ada di `BAKPAU_API_REVOKED`-> 401 token_revoked.
//   * hash tidak cocok                -> 401 invalid_token (constant-time).
//   * scope kurang                    -> 403 insufficient_scope.
//
// Semua pemeriksaan di file ini MURNI (tanpa DB/jaringan) sehingga handler
// bisa menolak permintaan SEBELUM satu pun query DB dibuat.
// ============================================================

import crypto from 'node:crypto'

export const API_ENV_KEYS = Object.freeze({
  TOKENS: 'BAKPAU_API_TOKENS',
  REVOKED: 'BAKPAU_API_REVOKED',
  RATE_LIMIT: 'BAKPAU_API_RATE_PER_MIN',
  MAX_BODY: 'BAKPAU_API_MAX_BODY_BYTES',
  // Kredensial BACA. HANYA kunci yang tunduk pada RLS (publishable/anon).
  // Service role TIDAK PERNAH dipakai untuk membaca lewat API ini — lihat
  // catatan kebijakan di bawah.
  READ_URL: 'BAKPAU_API_READ_SUPABASE_URL',
  READ_KEY: 'BAKPAU_API_READ_SUPABASE_KEY'
})

// ------------------------------------------------------------
// KEBIJAKAN KREDENSIAL BACA (dikoreksi setelah review Brooklyn)
// ------------------------------------------------------------
// Sebelumnya rantai ini berakhir di SUPABASE_SERVICE_ROLE_KEY. Itu keliru:
// service role MELEWATI RLS, sehingga "scope purchasing:read" hanya menjadi
// label di aplikasi — bukan batas izin database. Bila kunci itu yang dipakai,
// API Bakpau bisa membaca tabel apa pun yang diketahui namanya.
//
// Sekarang:
//   * HANYA kunci ber-RLS yang boleh: BAKPAU_API_READ_SUPABASE_KEY (khusus,
//     sebaiknya role baca terbatas) atau NEXT_PUBLIC_SUPABASE_ANON_KEY.
//   * Bila tidak ada kunci ber-RLS -> FAIL CLOSED (503 read_credential_missing).
//     Tidak ada fallback ke service role, tidak ada fallback ke "baca tanpa
//     batas".
//   * Kunci yang secara eksplisit ber-role service_role / berawalan sb_secret_
//     DITOLAK walau dipasang di BAKPAU_API_READ_SUPABASE_KEY (fail closed),
//     supaya salah-set env tidak diam-diam menghapus batas RLS.
export const READ_KEY_CHAIN = Object.freeze([
  'BAKPAU_API_READ_SUPABASE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
])
export const READ_URL_CHAIN = Object.freeze([
  'BAKPAU_API_READ_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL'
])

// Nama env yang TIDAK BOLEH menjadi kredensial baca API ini.
export const FORBIDDEN_READ_KEYS = Object.freeze(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'])

// Mendekode klaim `role` dari JWT Supabase tanpa memverifikasi tanda tangan
// (verifikasi tanda tangan bukan urusan kita: kuncinya milik server sendiri).
// Tujuannya SATU: menolak kunci privileged yang salah dipasang.
export function jwtRole(key) {
  const raw = String(key || '').trim()
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof payload?.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

// Klasifikasi kunci baca. `ok:false` = JANGAN dipakai (fail closed).
export function classifyReadKey(key) {
  const raw = String(key || '').trim()
  if (!raw) return { ok: false, reason: API_REASON.READ_CREDENTIAL_MISSING, kind: 'absent' }
  if (/^sb_secret_/i.test(raw)) {
    return { ok: false, reason: API_REASON.READ_CREDENTIAL_PRIVILEGED, kind: 'sb_secret' }
  }
  if (/^sb_publishable_/i.test(raw)) return { ok: true, kind: 'sb_publishable' }
  const role = jwtRole(raw)
  if (role === 'service_role') {
    return { ok: false, reason: API_REASON.READ_CREDENTIAL_PRIVILEGED, kind: 'jwt_service_role' }
  }
  if (role && role !== 'anon' && role !== 'authenticated') {
    return { ok: false, reason: API_REASON.READ_CREDENTIAL_PRIVILEGED, kind: `jwt_${role}` }
  }
  return { ok: true, kind: role ? `jwt_${role}` : 'opaque' }
}

export const SCOPES = Object.freeze({
  READ: 'purchasing:read',
  CREATE: 'purchasing:create'
})
export const ALL_SCOPES = Object.freeze([SCOPES.READ, SCOPES.CREATE])

export const API_LIMITS = Object.freeze({
  MAX_BODY_BYTES: 256 * 1024,
  MAX_PAGE_SIZE: 200,
  DEFAULT_PAGE_SIZE: 50,
  MAX_OFFSET: 100000,
  RATE_PER_MIN: 120,
  MAX_ITEMS_PER_NOTA: 80,
  TOKEN_MIN_SECRET_LEN: 32
})

export const API_REASON = Object.freeze({
  NOT_CONFIGURED: 'api_not_configured',
  MISSING_TOKEN: 'missing_token',
  MALFORMED_TOKEN: 'malformed_token',
  INVALID_TOKEN: 'invalid_token',
  TOKEN_REVOKED: 'token_revoked',
  INSUFFICIENT_SCOPE: 'insufficient_scope',
  METHOD_NOT_ALLOWED: 'method_not_allowed',
  UNKNOWN_RESOURCE: 'unknown_resource',
  UNKNOWN_PARAMETER: 'unknown_parameter',
  BAD_QUERY: 'bad_query',
  BAD_JSON: 'bad_json',
  BODY_TOO_LARGE: 'body_too_large',
  RATE_LIMITED: 'rate_limited',
  NOT_FOUND: 'not_found',
  INVALID_PAYLOAD: 'invalid_payload',
  AMBIGUOUS_EXTRACTION: 'ambiguous_extraction',
  UNKNOWN_REFERENCE: 'unknown_reference',
  WRITE_UNAVAILABLE: 'write_unavailable',
  LEDGER_UNAVAILABLE: 'ledger_unavailable',
  DUPLICATE_EVENT: 'duplicate_event',
  DUPLICATE_EVIDENCE: 'duplicate_evidence',
  SAVE_FAILED: 'save_failed',
  READBACK_FAILED: 'readback_failed',
  // Kredensial BACA: fail closed, bukan jatuh ke kunci privileged.
  READ_CREDENTIAL_MISSING: 'read_credential_missing',
  READ_CREDENTIAL_PRIVILEGED: 'read_credential_privileged',
  // RPC atomik bersama (Bandeng) belum ada -> tulis ditahan.
  ATOMIC_RPC_UNAVAILABLE: 'atomic_rpc_unavailable',
  INTERNAL_ERROR: 'internal_error'
})

// ------------------------------------------------------------
// Perbandingan constant-time. Panjang berbeda tetap dibandingkan lewat
// hash supaya panjang rahasia tidak bocor lewat waktu respons.
// ------------------------------------------------------------
export function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest()
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

// ------------------------------------------------------------
// Parse konfigurasi token. Bentuk: keyId:hash:scope+scope, dipisah koma.
// Entri rusak DIBUANG (bukan dianggap wildcard). Bila seluruh konfigurasi
// rusak/kosong -> `configured:false` sehingga handler menolak semua.
// ------------------------------------------------------------
export function parseTokenConfig(env = {}) {
  const raw = String(env[API_ENV_KEYS.TOKENS] || '').trim()
  const entries = new Map()
  const problems = []
  if (!raw) return { configured: false, entries, problems: ['env kosong'] }

  for (const chunk of raw.split(',')) {
    const part = chunk.trim()
    if (!part) continue
    // Scope mengandung ':' (purchasing:read), jadi pisahkan HANYA dua field
    // pertama; sisanya adalah daftar scope.
    const m = part.match(/^([a-z0-9]{8,32}):([a-f0-9A-F]{64}):(.+)$/)
    if (!m) { problems.push('entri tidak berformat keyId:hash:scope'); continue }
    const keyId = m[1]
    const hash = m[2]
    const scopeRaw = m[3]
    if (!/^[a-f0-9]{64}$/.test(hash.toLowerCase())) { problems.push(`hash tidak sah untuk ${keyId}`); continue }
    const scopes = scopeRaw.split('+').map(s => s.trim()).filter(Boolean)
    const unknown = scopes.filter(s => !ALL_SCOPES.includes(s))
    if (!scopes.length || unknown.length) { problems.push(`scope tidak sah untuk ${keyId}`); continue }
    if (entries.has(keyId)) { problems.push(`keyId ganda: ${keyId}`); continue }
    entries.set(keyId, { keyId, hash: hash.toLowerCase(), scopes })
  }
  return { configured: entries.size > 0, entries, problems }
}

export function parseRevoked(env = {}) {
  const set = new Set()
  for (const part of String(env[API_ENV_KEYS.REVOKED] || '').split(/[,\s]+/)) {
    const id = part.trim().toLowerCase()
    if (id) set.add(id)
  }
  return set
}

// ------------------------------------------------------------
// Verifikasi token dari header Authorization.
// TIDAK PERNAH menerima token dari query string / body / cookie.
// ------------------------------------------------------------
export function verifyApiToken({ headers, env = {}, requiredScope } = {}) {
  const cfg = parseTokenConfig(env)
  if (!cfg.configured) {
    return {
      ok: false, status: 503, reason: API_REASON.NOT_CONFIGURED,
      error: `Identitas API Bakpau belum dikonfigurasi di server (${API_ENV_KEYS.TOKENS} kosong/tidak sah).`
    }
  }

  const auth = headerOf(headers, 'authorization')
  if (!auth) {
    return {
      ok: false, status: 401, reason: API_REASON.MISSING_TOKEN,
      error: 'Header Authorization: Bearer <token> wajib ada.'
    }
  }
  const m = String(auth).match(/^Bearer\s+(.+)$/i)
  if (!m) {
    return { ok: false, status: 401, reason: API_REASON.MALFORMED_TOKEN, error: 'Format Authorization tidak dikenali (Bearer).' }
  }
  const raw = m[1].trim()
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== 'bpk') {
    return { ok: false, status: 401, reason: API_REASON.MALFORMED_TOKEN, error: 'Token API tidak berformat bpk.<keyId>.<secret>.' }
  }
  const [, keyId, secret] = parts
  if (!/^[a-z0-9]{8,32}$/.test(keyId) || secret.length < API_LIMITS.TOKEN_MIN_SECRET_LEN) {
    return { ok: false, status: 401, reason: API_REASON.MALFORMED_TOKEN, error: 'Token API tidak berformat sah.' }
  }

  const revoked = parseRevoked(env)
  if (revoked.has(keyId)) {
    return { ok: false, status: 401, reason: API_REASON.TOKEN_REVOKED, error: 'Token API ini sudah dicabut.' }
  }

  const entry = cfg.entries.get(keyId)
  if (!entry) {
    // Tetap hitung hash supaya waktu respons tidak membedakan "keyId tidak
    // ada" dari "hash salah".
    sha256Hex(secret)
    return { ok: false, status: 401, reason: API_REASON.INVALID_TOKEN, error: 'Token API tidak sah.' }
  }
  const got = sha256Hex(secret)
  if (!timingSafeEqualStr(got, entry.hash)) {
    return { ok: false, status: 401, reason: API_REASON.INVALID_TOKEN, error: 'Token API tidak sah.' }
  }

  if (requiredScope && !entry.scopes.includes(requiredScope)) {
    return {
      ok: false, status: 403, reason: API_REASON.INSUFFICIENT_SCOPE,
      error: `Token ini tidak punya izin "${requiredScope}".`,
      keyId, scopes: entry.scopes
    }
  }

  return { ok: true, keyId, scopes: entry.scopes.slice() }
}

function headerOf(headers, name) {
  if (!headers) return ''
  const lower = String(name).toLowerCase()
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return String(headers[k] ?? '')
  }
  return ''
}

// ------------------------------------------------------------
// Rate limit sederhana per keyId (best effort, per instance server).
// Bukan pengganti WAF: hanya membatasi percobaan brutal pada satu proses.
// ------------------------------------------------------------
export function createRateLimiter({ perMinute = API_LIMITS.RATE_PER_MIN, now = () => Date.now() } = {}) {
  const buckets = new Map()
  return {
    check(keyId) {
      const t = now()
      const win = Math.floor(t / 60000)
      const cur = buckets.get(keyId)
      if (!cur || cur.win !== win) {
        buckets.set(keyId, { win, n: 1 })
        return { ok: true, remaining: perMinute - 1 }
      }
      if (cur.n >= perMinute) return { ok: false, retryAfterSec: 60 - Math.floor((t % 60000) / 1000) }
      cur.n += 1
      return { ok: true, remaining: perMinute - cur.n }
    },
    reset() { buckets.clear() }
  }
}
