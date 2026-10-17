// ============================================================
// API Route: /api/sales-invoices — Invoice Penjualan (Sales Invoice)
// ============================================================
// SEBELUMNYA (main@18fb594): endpoint ini menulis data/sales_invoices.json
// TANPA syarat, TANPA otorisasi apa pun. Siapa pun yang tahu URL bisa
// membaca/menulis/mengubah status invoice, dan di produksi file itu ephemeral
// (hilang saat deploy, tidak dibagi antar-instance) — jadi "tersimpan" palsu.
//
// SEKARANG:
//   * SETIAP method wajib lolos verifyAdmin() → JWT Supabase diverifikasi,
//     peran diambil dari tabel `profiles`, hanya 'admin' yang lulus (403).
//     Mode pratinjau lokal butuh SALES_INVOICE_PREVIEW_TOKEN (fail closed).
//   * Store dipilih eksplisit (SALES_INVOICE_STORE): Supabase = kanonik.
//     File JSON hanya pratinjau non-produksi, dan DITOLAK di produksi.
//   * POST hanya membuat DRAFT (tanpa nomor invoice, tanpa nomor proyek).
//   * PATCH status menerapkan mesin transisi + bukti (TERKIRIM butuh kanal,
//     LUNAS butuh bukti pembayaran terverifikasi & nominal penuh).
//   * Idempotency-Key didukung: retry jaringan / double-click tidak
//     membuat invoice kedua.
//
// Bentuk respons selalu { ok, ... } dan error selalu { ok:false, error, code }.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { AuthError, authFailure, verifyAdmin } from '../../modules/sales-invoice/auth.js'
import {
  StoreError,
  createFileStore,
  createInvoice,
  createSupabaseStore,
  listInvoices,
  patchInvoice,
  resolveStorePlan,
  storeStatus
} from '../../modules/sales-invoice/store.js'
import { normalizeNewInvoice, normalizeTransition } from '../../modules/sales-invoice/contract.js'

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH']

function fail(res, err) {
  if (err instanceof AuthError) return authFailure(res, err)
  if (err instanceof StoreError) {
    return res.status(err.status || 400).json({
      ok: false,
      error: err.message,
      code: err.code,
      ...(err.blocker ? { blocker: err.blocker } : {}),
      ...(err.suggested_code ? { suggested_code: err.suggested_code } : {}),
      ...(err.expected_amount !== undefined
        ? { expected_amount: err.expected_amount, received_amount: err.received_amount }
        : {})
    })
  }
  console.error('sales-invoices API error:', err)
  return res.status(500).json({ ok: false, error: 'Terjadi kesalahan internal saat memproses invoice.', code: 'INTERNAL_ERROR' })
}

// ------------------------------------------------------------------
// FACTORY (dipakai harness untuk menyuntik store & auth palsu)
// ------------------------------------------------------------------
export function createSalesInvoiceHandler(deps = {}) {
  const env = deps.env || process.env
  const makeClient = deps.createClient || createClient
  const buildStore = deps.buildStore || function defaultBuildStore(plan, ctx) {
    if (plan.kind === 'supabase') {
      const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
      // Mutasi invoice & penerbitan proyek memakai service role bila tersedia
      // (RLS tetap berlaku di DB untuk klien sesi; server memvalidasi admin
      // lebih dulu lewat verifyAdmin).
      const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      const client = makeClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      return createSupabaseStore(client, {
        hasIssueRpc: env.SALES_INVOICE_ISSUE_RPC === '1',
        issueRpcName: env.SALES_INVOICE_ISSUE_RPC_NAME || undefined
      })
    }
    if (plan.kind === 'file-preview') return createFileStore({ file: deps.previewFile })
    return null
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')

    // --- 1. OTORISASI (semua method) ---
    let actor
    try {
      actor = await verifyAdmin(req, env, deps.authDeps || {})
    } catch (err) {
      return fail(res, err)
    }

    if (!ALLOWED_METHODS.includes(req.method)) {
      res.setHeader('Allow', ALLOWED_METHODS)
      return res.status(405).json({ ok: false, error: `Method ${req.method} tidak diizinkan.`, code: 'METHOD_NOT_ALLOWED' })
    }

    // --- 2. PILIH BACKEND ---
    const plan = deps.plan || resolveStorePlan(env)
    if (plan.kind === 'blocked') {
      return res.status(503).json({
        ok: false,
        error: plan.reason,
        code: 'STORE_UNAVAILABLE',
        blocker: plan.blocker || 'STORE_UNAVAILABLE'
      })
    }
    let store
    try {
      store = buildStore(plan, { actor })
    } catch (err) {
      return fail(res, err)
    }
    if (!store) {
      return res.status(503).json({ ok: false, error: 'Penyimpanan invoice tidak tersedia.', code: 'STORE_UNAVAILABLE' })
    }

    // --- 3. GET: daftar + status penyimpanan (jujur) ---
    if (req.method === 'GET') {
      try {
        const invoices = await listInvoices(store)
        return res.status(200).json({
          ok: true,
          invoices,
          storage: storeStatus(store),
          auth: { role: actor.role, via: actor.via }
        })
      } catch (err) {
        return fail(res, err)
      }
    }

    // --- 4. POST: buat DRAFT ---
    if (req.method === 'POST') {
      const normalized = normalizeNewInvoice(req.body || {})
      if (!normalized.ok) {
        return res.status(400).json({
          ok: false,
          error: normalized.errors[0].message,
          code: normalized.errors[0].code,
          errors: normalized.errors
        })
      }
      const idempotencyKey =
        (req.headers && (req.headers['idempotency-key'] || req.headers['Idempotency-Key'])) || (req.body && req.body.idempotency_key) || null
      try {
        const result = await createInvoice(store, normalized.value, { idempotencyKey })
        return res.status(result.replayed ? 200 : 201).json({
          ok: true,
          invoice: result.invoice,
          replayed: !!result.replayed,
          warnings: result.warnings,
          storage: storeStatus(store)
        })
      } catch (err) {
        return fail(res, err)
      }
    }

    // --- 5. PATCH: transisi status (TERBIT / TERKIRIM / LUNAS / BATAL ...) ---
    const normalized = normalizeTransition(req.body || {})
    if (!normalized.ok) {
      return res.status(400).json({
        ok: false,
        error: normalized.errors[0].message,
        code: normalized.errors[0].code,
        errors: normalized.errors
      })
    }
    try {
      const result = await patchInvoice(
        store,
        {
          ...normalized.value,
          // Verifikator pembayaran diambil dari sesi admin, bukan dari body,
          // supaya tidak bisa dikarang klien.
          evidence: { ...(normalized.value.evidence || {}), verified_by: actor.user.id }
        },
        {}
      )
      return res.status(200).json({
        ok: true,
        invoice: result.invoice,
        warnings: result.warnings,
        storage: storeStatus(store)
      })
    } catch (err) {
      return fail(res, err)
    }
  }
}

export default createSalesInvoiceHandler()
