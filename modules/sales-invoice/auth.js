// ============================================================
// modules/sales-invoice/auth.js — OTORISASI SERVER-SIDE (ADMIN ONLY)
// ============================================================
// SERVER-ONLY. Guard peran di UI (menu disembunyikan + panel "khusus
// administrator") BUKAN keamanan: siapa pun yang memanggil
// /api/sales-invoices langsung tetap harus ditolak. Modul ini yang menegakkan:
//
//   1) permintaan WAJIB membawa JWT Supabase (Authorization: Bearer ...),
//   2) JWT diverifikasi ke Supabase (bukan hanya di-decode),
//   3) peran diambil dari tabel `profiles` (server data), HANYA 'admin' lulus,
//   4) mode pratinjau lokal (tanpa kredensial) tetap butuh token
//      SALES_INVOICE_PREVIEW_TOKEN supaya endpoint tidak terbuka di dev.
//
// Kegagalan auth SELALU fail closed: tidak ada jalur "kalau ragu, izinkan".
// ============================================================

import { createClient } from '@supabase/supabase-js'

export class AuthError extends Error {
  constructor(code, message, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export function bearerToken(req) {
  const header = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || ''
  const h = String(header)
  if (!h.toLowerCase().startsWith('bearer ')) return null
  const token = h.slice(7).trim()
  return token || null
}

function serviceCredentials(env) {
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return { url, serviceKey, anonKey }
}

// Klien yang membawa JWT pengguna yang SUDAH diverifikasi.
// Ini penting: klien anon TANPA JWT tidak melihat baris apa pun di bawah RLS,
// jadi peran admin tidak akan pernah terbaca dan `profiles` tampak "kosong".
// Dengan meneruskan sesi user, RLS tetap menegakkan aturan DB (bukan bypass).
export function createSessionClient(url, anonKey, token, deps = {}) {
  const makeClient = deps.createClient || createClient
  return makeClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

// verifyAdmin(req, env) -> { ok:true, user:{id,email}, role:'admin', via, sessionToken }
// Melempar AuthError untuk semua kegagalan (dipetakan handler ke 401/403).
export async function verifyAdmin(req, env = process.env, deps = {}) {
  const makeClient = deps.createClient || createClient
  const { url, serviceKey, anonKey } = serviceCredentials(env)

  // --- Mode pratinjau lokal (tanpa kredensial Supabase) ---
  // Endpoint tetap TIDAK terbuka: wajib token pratinjau eksplisit.
  if (!url || !(serviceKey || anonKey)) {
    const expected = String(env.SALES_INVOICE_PREVIEW_TOKEN || '').trim()
    if (!expected) {
      throw new AuthError(
        'AUTH_NOT_CONFIGURED',
        'Otorisasi belum dikonfigurasi: kredensial Supabase tidak tersedia dan SALES_INVOICE_PREVIEW_TOKEN belum diset. Endpoint menolak semua permintaan (fail closed).',
        503
      )
    }
    const provided = String(
      (req && req.headers && (req.headers['x-preview-token'] || req.headers['X-Preview-Token'])) || ''
    ).trim()
    if (!provided || provided !== expected) {
      throw new AuthError('UNAUTHORIZED', 'Token pratinjau tidak valid. Endpoint ini hanya untuk admin.', 401)
    }
    return { ok: true, user: { id: 'preview', email: null }, role: 'admin', via: 'preview-token' }
  }

  const token = bearerToken(req)
  if (!token) {
    throw new AuthError('UNAUTHORIZED', 'Permintaan wajib menyertakan sesi login (header Authorization: Bearer <token>).', 401)
  }

  const verifier = makeClient(url, anonKey || serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 1) Verifikasi JWT ke server auth Supabase.
  let user = null
  if (deps.getUser) {
    user = await deps.getUser(token)
  } else {
    const { data, error } = await verifier.auth.getUser(token)
    if (error || !data || !data.user) {
      throw new AuthError('INVALID_SESSION', 'Sesi login tidak valid atau sudah kedaluwarsa. Silakan login ulang.', 401)
    }
    user = data.user
  }
  if (!user || !user.id) {
    throw new AuthError('INVALID_SESSION', 'Sesi login tidak valid.', 401)
  }

  // 2) Peran HARUS dari tabel profiles (server data), bukan dari klien.
  //    Klien peran memakai SESI USER yang sudah diverifikasi bila service role
  //    tidak tersedia — supaya RLS `profiles` (admin-only) tetap berlaku dan
  //    permintaan tidak bergantung pada akses anon. Klien anon TANPA JWT
  //    melihat 0 baris di bawah RLS → peran selalu tampak kosong → 403 palsu.
  const roleKey = serviceKey || anonKey
  const roleClient = serviceKey
    ? makeClient(url, roleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createSessionClient(url, roleKey, token, { createClient: makeClient })
  const { data: profile, error: roleErr } = await roleClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (roleErr) {
    throw new AuthError('ROLE_LOOKUP_FAILED', `Gagal memverifikasi peran admin: ${roleErr.message}`, 503)
  }
  const role = String((profile && profile.role) || '').trim().toLowerCase()
  if (role !== 'admin') {
    throw new AuthError('FORBIDDEN', 'Halaman ini khusus administrator.', 403)
  }

  // Token sesi diteruskan ke store supaya mutasi memakai identitas user
  // (RLS tetap menegakkan admin), bukan klien anon tanpa JWT.
  return {
    ok: true,
    user: { id: user.id, email: user.email || null },
    role: 'admin',
    via: 'jwt',
    sessionToken: token,
    sessionClientMode: serviceKey ? 'service-role' : 'user-session'
  }
}

// Dipakai handler: ubah AuthError menjadi respons JSON yang konsisten.
export function authFailure(res, err) {
  const status = err instanceof AuthError ? err.status : 500
  const code = err instanceof AuthError ? err.code : 'AUTH_ERROR'
  const message = err instanceof AuthError ? err.message : 'Gagal memverifikasi otorisasi.'
  return res.status(status).json({ ok: false, error: message, code })
}
