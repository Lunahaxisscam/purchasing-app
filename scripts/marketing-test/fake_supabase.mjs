#!/usr/bin/env node
// ============================================================
// scripts/marketing-test/fake_supabase.mjs — SUPABASE PALSU UNTUK E2E (S6)
// ============================================================
// Server HTTP kecil yang meniru bagian Supabase yang dipakai endpoint
// /api/marketing-contract, supaya alur NYATA (Next server → handler → probe →
// supabase-js → HTTP → PostgREST) bisa diuji tanpa menyentuh data produksi.
//
// Yang ditiru:
//   GET  /auth/v1/user      → user admin (JWT apa pun yang tidak kosong)
//   GET  /rest/v1/profiles  → peran (admin / user)
//   GET  /rest/v1/projects  → 2 baris contoh (satu-satunya tabel marketing yang
//                             boleh dibaca dan memang ada)
//   GET  /rest/v1/leads|campaigns|customers|…  → 404 + PGRST205 (belum ada)
//   POST/PATCH/DELETE /rest/v1/* → 405 + DICATAT ke `writes[]`
//
// Selain itu ia MENOLAK (dan mencatat) permintaan ke tabel purchasing:
// kalau lapisan marketing sampai membaca purchase_requests/pr_items/…,
// uji ini akan menangkapnya — itu inti invarian P1/P3.
//
// Pemakaian: node scripts/marketing-test/fake_supabase.mjs 54321
// ============================================================

import http from 'node:http'

const PORT = Number(process.argv[2] || 54321)

// Tabel yang memang BELUM ADA di Supabase (kondisi nyata 18 Okt 2026).
const MISSING_TABLES = new Set([
  'leads', 'lead_touchpoints', 'campaigns', 'lead_handoffs', 'customers', 'sales_invoices'
])

// Tabel milik purchasing/keuangan: TIDAK BOLEH disentuh lapisan marketing.
const FORBIDDEN_TABLES = new Set([
  'purchase_requests', 'pr_items', 'approval_steps',
  'receivings', 'receiving_items', 'handovers'
])

const DATASET = {
  projects: [
    { id: 'proj-e2e-1', name: 'Josh - Mabes', kode: '83', code: '83', status: 'ON_GOING' },
    { id: 'proj-e2e-2', name: 'Baroni', kode: '99', code: '99', status: 'NOT_START' }
  ]
}

const writes = []
const forbiddenReads = []

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders
  })
  res.end(payload)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname

  // --- auth ---
  if (p === '/auth/v1/user') {
    const auth = req.headers.authorization || ''
    if (!auth.toLowerCase().startsWith('bearer ') || auth.slice(7).trim() === '') {
      return json(res, 401, { message: 'invalid claim: missing sub claim' })
    }
    const token = auth.slice(7).trim()
    const isUser = token.includes('user')
    return json(res, 200, {
      id: isUser ? 'u-user-e2e' : 'u-admin-e2e',
      email: isUser ? 'staf@noir.id' : 'admin@noir.id',
      aud: 'authenticated',
      role: 'authenticated'
    })
  }

  // --- rest ---
  if (p.startsWith('/rest/v1/')) {
    const table = p.slice('/rest/v1/'.length).split('?')[0]

    // Operasi tulis: ditolak DAN dicatat. Kalau lapisan marketing punya jalur
    // tulis, daftar ini tidak akan kosong.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writes.push({ method: req.method, table })
      return json(res, 405, { code: '42501', message: 'uji ini TIDAK mengizinkan operasi tulis' })
    }

    // Tabel purchasing: dicatat sebagai pelanggaran bila dibaca.
    if (FORBIDDEN_TABLES.has(table)) {
      forbiddenReads.push({ table, method: req.method })
      return json(res, 403, {
        code: '42501',
        message: `tabel ${table} milik modul purchasing — lapisan marketing TIDAK boleh membacanya`
      })
    }

    if (table === 'profiles') {
      const idFilter = url.searchParams.get('id')
      const all = [
        { id: 'u-admin-e2e', role: 'admin', full_name: 'Admin E2E' },
        { id: 'u-user-e2e', role: 'user', full_name: 'Staf E2E' }
      ]
      const rows = idFilter && idFilter.startsWith('eq.')
        ? all.filter(r => r.id === idFilter.slice(3))
        : all
      return json(res, 200, rows, { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` })
    }

    if (MISSING_TABLES.has(table)) {
      return json(res, 404, {
        code: 'PGRST205',
        details: null,
        hint: null,
        message: `Could not find the table 'public.${table}' in the schema cache`
      })
    }

    if (!(table in DATASET)) {
      return json(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    }

    const all = DATASET[table]
    let rows = all
    const range = req.headers.range
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/)
      if (m) rows = all.slice(Number(m[1]), Number(m[2]) + 1)
    }
    return json(res, 200, rows, {
      'Content-Range': `0-${Math.max(0, rows.length - 1)}/${all.length}`,
      'Content-Type': 'application/json'
    })
  }

  // --- diagnostik ---
  if (p === '/__writes') return json(res, 200, { writes, forbidden_reads: forbiddenReads })
  if (p === '/__reset') { writes.length = 0; forbiddenReads.length = 0; return json(res, 200, { ok: true }) }

  return json(res, 404, { message: `tidak ditiru: ${req.method} ${p}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-supabase (marketing) siap di http://127.0.0.1:${PORT}`)
})
