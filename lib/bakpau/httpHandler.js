// ============================================================
// lib/bakpau/httpHandler.js — HANDLER HTTP (SERVER-ONLY) KONEKTOR BAKPAU
// ============================================================
// Dipakai oleh pages/api/bakpau/telegram.js dan pages/api/bakpau/whatsapp.js.
// PLATFORM DITENTUKAN OLEH ROUTE, BUKAN oleh payload/query — sehingga satu
// endpoint tidak bisa dipakai untuk mengaku sebagai kanal lain.
//
// KEAMANAN:
//   * Tanpa tanda tangan/token sah -> 401. Tanpa allowlist -> 503 (fail closed).
//   * Klien DB memakai SERVICE ROLE dan HANYA dibuat di server. Kunci tidak
//     pernah dikirim ke browser, tidak pernah dicetak, tidak pernah jadi
//     parameter URL.
//   * Body dibaca mentah (rawBody) untuk verifikasi HMAC WhatsApp.
//   * Balasan tidak pernah memuat teks bukti mentah, token, atau isi secret.
//
// METODE: POST saja. GET -> 405 (tidak ada endpoint baca publik).
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { processInboundEvent, loadMasters, loadExistingNotas } from './connector.js'
import { createDbLedger } from './ledger.js'
import { createRpcTransport } from './notify.js'
import { ENV_KEYS, REASON } from './constants.js'

export const ALLOWED_METHODS = Object.freeze(['POST'])

// Body dibaca MENTAH. Untuk WhatsApp, HMAC dihitung atas byte asli yang
// dikirim platform — kalau body sudah diparse lalu di-stringify ulang, urutan
// key/spasi bisa berubah dan tanda tangan yang SAH justru ditolak.
async function readBody(req) {
  let raw = ''
  if (typeof req.body === 'string') raw = req.body
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8')
  else if (req.body && typeof req.body === 'object') raw = JSON.stringify(req.body)
  else if (typeof req.on === 'function') {
    // bodyParser dimatikan (route WhatsApp) -> baca stream sendiri.
    raw = await new Promise((resolve, reject) => {
      let buf = ''
      req.on('data', c => { buf += c })
      req.on('end', () => resolve(buf))
      req.on('error', reject)
    })
  }
  let json = null
  try { json = raw ? JSON.parse(raw) : {} } catch { json = null }
  return { raw, json }
}

function serverClient(env) {
  const url = env[ENV_KEYS.SUPABASE_URL] || env[ENV_KEYS.PUBLIC_URL]
  const key = env[ENV_KEYS.SERVICE_KEY]
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Handler pabrik: `platform` WAJIB dari route, bukan dari request.
export function createBakpauIntakeHandler(platform, deps = {}) {
  const makeClient = deps.createClient || serverClient
  const processFn = deps.processInboundEvent || processInboundEvent
  const loadMastersFn = deps.loadMasters || loadMasters
  const loadExistingFn = deps.loadExistingNotas || loadExistingNotas

  return async function handler(req, res) {
    if (!ALLOWED_METHODS.includes(req.method)) {
      res.setHeader('Allow', ALLOWED_METHODS)
      return res.status(405).json({ ok: false, error: 'Hanya POST.', code: 'METHOD_NOT_ALLOWED' })
    }

    const env = deps.env || process.env
    const client = makeClient(env)
    if (!client) {
      // Tanpa service role, konektor TIDAK boleh jalan (anon tidak cukup untuk
      // menulis nota & membaca master). 503 = fail closed, bukan 200 kosong.
      return res.status(503).json({
        ok: false,
        error: `Kredensial server tidak tersedia (${ENV_KEYS.SERVICE_KEY} / ${ENV_KEYS.SUPABASE_URL}).`,
        code: REASON.NO_SERVICE_CREDENTIALS
      })
    }

    const body = await readBody(req)
    const rawBody = body.raw
    if (!body.json || typeof body.json !== 'object') {
      return res.status(400).json({ ok: false, error: 'Body bukan JSON yang sah.', code: 'BAD_JSON' })
    }
    const payload = body.json

    const ledger = deps.ledger || createDbLedger({ client })
    const transport = deps.transport || createRpcTransport({ client })

    // Master dibaca per request (read-only). Bisa diganti injeksi untuk tes.
    const mastersRes = await loadMastersFn({ client })
    if (!mastersRes.ok) {
      return res.status(502).json({ ok: false, error: mastersRes.error, code: mastersRes.reason || 'MASTERS_UNAVAILABLE' })
    }
    const existingRes = await loadExistingFn({ client })

    let out
    try {
      out = await processFn({
        platform,
        payload,
        headers: req.headers || {},
        rawBody,
        env,
        client,
        ledger,
        transport,
        masters: mastersRes.masters,
        existingNotas: existingRes.ok ? existingRes.rows : [],
        requestNotify: true
      })
    } catch (err) {
      // Kegagalan tak terduga TIDAK boleh berbunyi seperti sukses.
      console.error('bakpau intake error:', err?.message || err)
      return res.status(500).json({ ok: false, error: 'Kesalahan internal konektor.', code: 'INTERNAL_ERROR' })
    }

    const httpStatus = pickStatus(out)
    return res.status(httpStatus).json({
      ok: out.ok === true,
      status: out.status,
      reason: out.reason || null,
      error: out.error || null,
      receivingId: out.receivingId || null,
      invoiceNo: out.invoiceNo || null,
      notification: out.notification ? {
        sent: out.notification.sent === true,
        skipped: !!out.notification.skipped,
        reason: out.notification.reason || null,
        attempts: out.notification.attempts || 0
      } : null
    })
  }
}

function pickStatus(out) {
  const s = String(out.status || '')
  if (s === 'tercatat') return 200
  if (s === 'duplicate' || s === 'ignored_duplicate_event') return 200
  if (s === 'need_clarification') return 202
  if (s === 'gagal') {
    const r = String(out.reason || '')
    if ([REASON.BAD_SIGNATURE, REASON.IDENTITY_NOT_ALLOWED, REASON.CHAT_TYPE_NOT_ALLOWED,
      REASON.BOT_SENDER, REASON.STALE_EVENT].includes(r)) return 401
    if (r === REASON.NOT_CONFIGURED) return 503
    return 502
  }
  return 500
}
