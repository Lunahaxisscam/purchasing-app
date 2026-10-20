#!/usr/bin/env node
// ============================================================
// scripts/bakpau-api-client/client.mjs — CLIENT API BAKPAU (RUNNABLE)
// ============================================================
// Dipakai oleh profil Bakpau untuk:
//   * BACA master/PR/pembelian/status fisik (scope purchasing:read)
//   * CATAT satu nota pembelian dari hasil ekstraksi (purchasing:create)
//
// KONTRAK KEAMANAN CLIENT:
//   * Base URL DIKUNCI ke HTTPS. Skema lain (http/file/ftp) DITOLAK.
//   * Token HANYA dari env `BAKPAU_API_TOKEN` — tidak pernah argumen CLI,
//     tidak pernah URL, tidak pernah dicetak. `--token` sengaja tidak ada.
//   * Perintah adalah DAFTAR PUTIH (lihat COMMANDS). Tidak ada perintah
//     "query bebas"/"SQL".
//   * Timeout dan retry TERBATAS. Retry HANYA untuk READ dan untuk
//     kegagalan jaringan/5xx yang tidak menghasilkan tulisan. CREATE
//     TIDAK PERNAH diulang otomatis — idempotencyKey yang menjamin aman,
//     dan bila ragu client berhenti serta melaporkan status.
//   * Setiap request membawa `X-Request-Id` (korelasi) yang dicetak ke
//     stderr agar bisa dicocokkan dengan log server.
//
// PEMAKAIAN
//   BAKPAU_API_BASE_URL=https://<host> BAKPAU_API_TOKEN=bpk.<id>.<secret> \
//     node client.mjs read masters/projects --limit 5
//   node client.mjs read purchases --vendor-id <uuid> --limit 20
//   node client.mjs create --file payload.json
//   node client.mjs doctor            # cek konfigurasi TANPA mencetak token
//
// Keluaran JSON ke stdout; diagnostik ke stderr. Exit code: 0 sukses,
// 2 = pemakaian salah/konfigurasi, 3 = ditolak server, 4 = gagal jaringan.
// ============================================================

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ENV_BASE = 'BAKPAU_API_BASE_URL'
const ENV_TOKEN = 'BAKPAU_API_TOKEN'
const ENV_TIMEOUT = 'BAKPAU_API_TIMEOUT_MS'

const DEFAULTS = Object.freeze({
  timeoutMs: 15000,
  maxRetries: 2,
  retryBackoffMs: 400,
  maxBodyBytes: 256 * 1024
})

// Daftar putih perintah. `read` butuh resource; `create` butuh file.
export const COMMANDS = Object.freeze(['read', 'create', 'doctor'])

export const RESOURCES = Object.freeze([
  'masters/projects', 'masters/materials', 'masters/vendors',
  'purchase-requests', 'purchase-request-items',
  'purchases', 'purchase-items', 'physical-status'
])

// Filter yang boleh diteruskan per resource (dijaga juga di server).
const FILTERS = Object.freeze({
  'masters/projects': ['id', 'kode', 'code', 'status'],
  'masters/materials': ['id', 'kode', 'code', 'category'],
  'masters/vendors': ['id', 'name', 'supplier_category'],
  'purchase-requests': ['id', 'pr_number', 'project_id', 'status', 'priority'],
  'purchase-request-items': ['id', 'pr_id', 'material_id', 'status', 'kode'],
  purchases: ['id', 'vendor_id', 'project_id', 'purchase_request_id', 'invoice_no', 'status'],
  'purchase-items': ['id', 'receiving_id', 'pr_item_id'],
  'physical-status': ['id', 'receiving_id', 'project_id', 'status']
})

class UsageError extends Error {}
class ConfigError extends Error {}
class RemoteError extends Error {
  constructor(message, { status, body, requestId } = {}) {
    super(message)
    this.status = status
    this.body = body
    this.requestId = requestId
  }
}

// ------------------------------------------------------------
// Konfigurasi: hanya dari env. Nilai TIDAK pernah dicetak.
// ------------------------------------------------------------
export function loadConfig(env = process.env) {
  const baseRaw = String(env[ENV_BASE] || '').trim()
  const token = String(env[ENV_TOKEN] || '').trim()
  if (!baseRaw) throw new ConfigError(`${ENV_BASE} belum diset.`)
  if (!token) throw new ConfigError(`${ENV_TOKEN} belum diset.`)

  let url
  try { url = new URL(baseRaw) } catch { throw new ConfigError(`${ENV_BASE} bukan URL yang sah.`) }

  // HTTPS WAJIB. Satu-satunya pengecualian: loopback eksplisit untuk harness
  // lokal (BAKPAU_API_ALLOW_LOOPBACK=1). Pengecualian ini tidak bisa dipakai
  // untuk host jarak jauh, dan tidak pernah aktif secara default.
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const allowLoopback = String(env.BAKPAU_API_ALLOW_LOOPBACK || '') === '1'
  if (url.protocol !== 'https:') {
    const isLoop = url.protocol === 'http:' && loopbackHosts.has(url.hostname)
    if (!(isLoop && allowLoopback)) {
      throw new ConfigError(`${ENV_BASE} wajib https:// (ditolak: ${url.protocol}).`)
    }
  }
  if (url.username || url.password) throw new ConfigError(`${ENV_BASE} tidak boleh memuat kredensial di URL.`)
  // Token tidak boleh ikut di query/fragment base URL.
  if (url.search || url.hash) throw new ConfigError(`${ENV_BASE} tidak boleh memuat query/hash.`)

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'bpk' || parts[2].length < 32) {
    throw new ConfigError(`${ENV_TOKEN} tidak berformat bpk.<keyId>.<secret>.`)
  }

  const t = Number(env[ENV_TIMEOUT] || DEFAULTS.timeoutMs)
  const timeoutMs = Number.isFinite(t) && t >= 1000 && t <= 60000 ? t : DEFAULTS.timeoutMs

  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    token,
    keyId: parts[1],
    // Fingerprint NON-rahasia untuk verifikasi tanpa membocorkan token.
    tokenFingerprint: crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12),
    timeoutMs
  }
}

function headersFor(cfg, requestId) {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    authorization: `Bearer ${cfg.token}`,
    'x-request-id': requestId,
    'user-agent': 'bakpau-api-client/1.0'
  }
}

async function postOnce(cfg, route, payload, requestId) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(`${cfg.baseUrl}${route}`, {
      method: 'POST',
      headers: headersFor(cfg, requestId),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      redirect: 'error' // jangan pernah mengikuti redirect (token bisa bocor)
    })
    const text = await res.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = { raw: text.slice(0, 200) } }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

function isRetryableRead(status) {
  return status === 429 || status === 502 || status === 503 || status === 504
}

// READ: boleh retry terbatas (idempoten, tidak menulis).
export async function readResource(cfg, { resource, query = {}, log = () => {} } = {}) {
  if (!RESOURCES.includes(resource)) {
    throw new UsageError(`resource "${resource}" tidak dikenal. Pilihan: ${RESOURCES.join(', ')}`)
  }
  const allowed = FILTERS[resource]
  for (const key of Object.keys(query)) {
    if (!['limit', 'offset', 'order', ...allowed].includes(key)) {
      throw new UsageError(`filter "${key}" tidak sah untuk ${resource}. Yang boleh: ${allowed.join(', ')} (+limit/offset/order)`)
    }
  }
  const payload = { resource, query }

  let lastErr = null
  for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
    const requestId = crypto.randomUUID()
    log(`read ${resource} attempt=${attempt + 1} request_id=${requestId}`)
    try {
      const { status, body } = await postOnce(cfg, '/api/bakpau/v1/read', payload, requestId)
      if (status === 200 && body?.ok) return { ...body, requestId }
      if (isRetryableRead(status) && attempt < DEFAULTS.maxRetries) {
        lastErr = new RemoteError(`read ditolak sementara (HTTP ${status})`, { status, body, requestId })
        await sleep(DEFAULTS.retryBackoffMs * (attempt + 1))
        continue
      }
      throw new RemoteError(body?.error || `read gagal (HTTP ${status})`, { status, body, requestId })
    } catch (err) {
      if (err instanceof RemoteError) throw err
      lastErr = err
      if (attempt < DEFAULTS.maxRetries) {
        await sleep(DEFAULTS.retryBackoffMs * (attempt + 1))
        continue
      }
      throw new RemoteError(`gagal menghubungi server: ${err?.message || err}`, { requestId })
    }
  }
  throw lastErr || new RemoteError('read gagal')
}

// CREATE: TIDAK PERNAH retry otomatis. Satu percobaan; hasil ambigu
// dilaporkan apa adanya supaya manusia/Bakpau memutuskan (bukan menulis dua
// kali karena timeout).
export async function createPurchase(cfg, payload, { log = () => {} } = {}) {
  if (!payload || typeof payload !== 'object') throw new UsageError('payload create harus objek.')
  if (!String(payload.idempotencyKey || '').trim()) {
    throw new UsageError('payload wajib memuat idempotencyKey (kunci stabil per dokumen).')
  }
  const requestId = crypto.randomUUID()
  log(`create idempotency=${String(payload.idempotencyKey).slice(0, 12)}… request_id=${requestId} (tanpa retry otomatis)`)
  try {
    const { status, body } = await postOnce(cfg, '/api/bakpau/v1/purchases', payload, requestId)
    const accepted = status === 201 || status === 200
    return { httpStatus: status, accepted, ...body, requestId }
  } catch (err) {
    // Jaringan/timeout: hasil TIDAK DIKETAHUI. Jangan retry — laporkan.
    return {
      httpStatus: null,
      accepted: false,
      ok: false,
      status: 'unknown',
      code: 'transport_unknown',
      error: `Hasil create TIDAK DIKETAHUI (${err?.message || err}). ` +
        'JANGAN ulangi dengan idempotencyKey baru; ulangi dengan kunci yang SAMA untuk memeriksa.',
      requestId
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------
function parseArgs(argv) {
  const [command, ...rest] = argv
  const opts = { _: [] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--file') opts.file = rest[++i]
    else if (a === '--limit') opts.limit = rest[++i]
    else if (a === '--offset') opts.offset = rest[++i]
    else if (a === '--order') opts.order = rest[++i]
    else if (a === '--json') opts.json = rest[++i]
    else if (a.startsWith('--')) {
      // --vendor-id -> vendor_id, dst. Hanya untuk filter yang dikenal.
      opts[a.slice(2).replace(/-/g, '_')] = rest[++i]
    } else opts._.push(a)
  }
  return { command, opts }
}

async function main(argv) {
  const { command, opts } = parseArgs(argv)
  const log = msg => process.stderr.write(`[bakpau-client] ${msg}\n`)

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`Perintah: ${COMMANDS.join(', ')}\n`)
    return 0
  }
  if (!COMMANDS.includes(command)) {
    throw new UsageError(`perintah "${command}" tidak dikenal. Pilihan: ${COMMANDS.join(', ')}`)
  }

  const cfg = loadConfig(process.env)

  if (command === 'doctor') {
    // TIDAK melakukan request; hanya memastikan konfigurasi terbaca & aman.
    process.stdout.write(JSON.stringify({
      ok: true,
      baseUrlHost: new URL(cfg.baseUrl).host,
      httpsOnly: true,
      keyId: cfg.keyId,
      tokenFingerprint: cfg.tokenFingerprint,
      tokenLengthOk: true,
      timeoutMs: cfg.timeoutMs,
      commands: COMMANDS,
      resources: RESOURCES
    }, null, 2) + '\n')
    return 0
  }

  if (command === 'read') {
    const resource = opts._[0]
    if (!resource) throw new UsageError(`resource wajib. Pilihan: ${RESOURCES.join(', ')}`)
    const query = {}
    if (opts.limit !== undefined) query.limit = Number(opts.limit)
    if (opts.offset !== undefined) query.offset = Number(opts.offset)
    if (opts.order !== undefined) query.order = opts.order
    for (const key of Object.keys(opts)) {
      if (['_', 'file', 'json', 'limit', 'offset', 'order'].includes(key)) continue
      query[key] = opts[key]
    }
    const out = await readResource(cfg, { resource, query, log })
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    return 0
  }

  // create
  let payload
  if (opts.file) {
    const p = path.resolve(opts.file)
    payload = JSON.parse(fs.readFileSync(p, 'utf8'))
  } else if (opts.json) {
    payload = JSON.parse(opts.json)
  } else {
    // stdin (memudahkan pipa dari agen lain tanpa menulis file sementara)
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  }
  const out = await createPurchase(cfg, payload, { log })
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  return out.accepted ? 0 : 3
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (isMain) {
  main(process.argv.slice(2)).then(code => process.exit(code)).catch(err => {
    if (err instanceof UsageError) { process.stderr.write(`PEMAKAIAN: ${err.message}\n`); process.exit(2) }
    if (err instanceof ConfigError) { process.stderr.write(`KONFIGURASI: ${err.message}\n`); process.exit(2) }
    if (err instanceof RemoteError) {
      process.stderr.write(`DITOLAK: ${err.message}${err.requestId ? ` (request_id=${err.requestId})` : ''}\n`)
      process.exit(3)
    }
    process.stderr.write(`GAGAL: ${err?.message || err}\n`)
    process.exit(4)
  })
}
