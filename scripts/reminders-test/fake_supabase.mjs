#!/usr/bin/env node
// ============================================================
// scripts/reminders-test/fake_supabase.mjs — SUPABASE PALSU UNTUK E2E
// ============================================================
// Server HTTP kecil yang meniru bagian Supabase yang dipakai endpoint
// /api/reminders, supaya alur NYATA (Next server → handler → supabase-js →
// HTTP → PostgREST) bisa diuji tanpa menyentuh data produksi.
//
// Yang ditiru:
//   GET /auth/v1/user            → user admin (JWT apa pun yang tidak kosong)
//   GET /rest/v1/<table>         → baris tabel (SELECT *), dengan header
//                                  Content-Range untuk count exact
//   GET /rest/v1/sales_invoices  → 404 + kode PGRST205 (meniru tabel yang
//                                  belum dimigrasikan)
//   POST/PATCH/DELETE /rest/v1/* → 405 + dicatat ke `writes[]` (kalau ada
//                                  jalur tulis, uji ini akan menangkapnya)
//
// Pemakaian:
//   node scripts/reminders-test/fake_supabase.mjs 54321
//   (lalu jalankan Next dengan SUPABASE_URL=http://127.0.0.1:54321)
// ============================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.argv[2] || 54321)
const HERE = path.dirname(new URL(import.meta.url).pathname)
const SAMPLE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'reminders', 'sample-data.json'), 'utf8'))

// Tabel yang "belum ada" di Supabase — dipakai untuk membuktikan laporan
// menyatakan BLOCKED, bukan 0 temuan.
const MISSING_TABLES = new Set(['sales_invoices'])

const dataset = { ...SAMPLE.dataset }
delete dataset.sales_invoices

const writes = []

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
    // Token yang memuat "user" dianggap akun non-admin; lainnya admin.
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

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writes.push({ method: req.method, table })
      return json(res, 405, { code: '42501', message: 'uji ini TIDAK mengizinkan operasi tulis' })
    }

    if (MISSING_TABLES.has(table)) {
      return json(res, 404, {
        code: 'PGRST205',
        details: null,
        hint: null,
        message: `Could not find the table 'public.${table}' in the schema cache`
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

    if (!(table in dataset)) {
      return json(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    }

    let rows = Array.isArray(dataset[table]) ? dataset[table] : []
    // Dukungan minimal untuk ?id=eq.<x> (dipakai store lain, bukan reminder).
    const idFilter = url.searchParams.get('id')
    if (idFilter && idFilter.startsWith('eq.')) {
      const v = idFilter.slice(3)
      rows = rows.filter(r => String(r.id) === v)
    }
    const range = req.headers.range
    if (range) {
      const m = String(range).match(/^(\d+)-(\d+)$/)
      if (m) rows = rows.slice(Number(m[1]), Number(m[2]) + 1)
    }
    const total = Array.isArray(dataset[table]) ? dataset[table].length : rows.length
    return json(res, 200, rows, {
      'Content-Range': `${rows.length ? 0 : 0}-${Math.max(0, rows.length - 1)}/${total}`,
      'Content-Type': 'application/json'
    })
  }

  // --- diagnostik (dipakai skrip uji untuk membuktikan nol tulis) ---
  if (p === '/__writes') {
    return json(res, 200, { writes })
  }

  return json(res, 404, { message: `tidak ditiru: ${req.method} ${p}` })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake-supabase siap di http://127.0.0.1:${PORT}`)
})
