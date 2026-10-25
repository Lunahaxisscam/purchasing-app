// ============================================================
// scripts/reminders/handler.js — HANDLER ENDPOINT REMINDER (DRY-RUN)
// ============================================================
// Logika endpoint tinggal di sini (bukan di pages/api) supaya harness bisa
// mengimpor file yang SAMA PERSIS dengan yang dipakai Next — tidak ada
// salinan kedua yang bisa menyimpang. pages/api/reminders.js hanya
// mengekspor default dari factory ini.
//
// DRY-RUN / READ-ONLY:
//   * hanya membaca (SELECT) lewat collect.js,
//   * hanya menghitung lewat rules.js,
//   * TIDAK mengirim pesan keluar, TIDAK melakukan pembayaran,
//   * TIDAK mengubah status, TIDAK mendaftarkan/mengubah cron.
//
// Otorisasi admin memakai guard yang sama dengan /api/sales-invoices
// (JWT diverifikasi + peran dari tabel `profiles`); tanpa sesi 401,
// non-admin 403, 503 fail closed bila otorisasi belum dikonfigurasi.
// ============================================================

import { AuthError, authFailure, requireAdmin } from './auth.js'
import { collect, DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT } from './collect.js'
import { DEFAULT_THRESHOLDS, KINDS, buildReport, renderText, resolveThresholds } from './rules.js'

export const ALLOWED_METHODS = Object.freeze(['GET'])
export const DEFAULT_MAX_ITEMS = 200

function asBool(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'ya'
}

function parseIntInRange(v, min, max, fallback) {
  if (v === undefined || v === null || String(v).trim() === '') return fallback
  const n = Number(String(v).trim())
  if (!isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min || i > max) return fallback
  return i
}

function parseKinds(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null
  const list = String(raw).split(',').map(s => s.trim()).filter(Boolean)
  return list.length ? list : null
}

export function createRemindersHandler(deps = {}) {
  const env = deps.env || process.env
  const collectFn = deps.collect || collect
  const buildReportFn = deps.buildReport || buildReport

  return async function handler(req, res) {
    if (!ALLOWED_METHODS.includes(req.method)) {
      res.setHeader('Allow', ALLOWED_METHODS)
      return res.status(405).json({
        ok: false,
        error: 'Endpoint ini hanya menyediakan GET (dry-run). Tidak ada aksi tulis/kirim.',
        code: 'METHOD_NOT_ALLOWED'
      })
    }

    // --- 1) Otorisasi admin (fail closed) ---
    let auth
    try {
      auth = await requireAdmin(req, env, deps.authDeps || {})
    } catch (err) {
      if (err instanceof AuthError) return authFailure(res, err)
      console.error('reminders auth error:', err)
      return res.status(500).json({ ok: false, error: 'Gagal memverifikasi otorisasi.', code: 'AUTH_ERROR' })
    }

    const query = req.query || {}
    const format = String(query.format || 'json').trim().toLowerCase()
    if (!['json', 'text'].includes(format)) {
      return res.status(400).json({ ok: false, error: 'format harus "json" atau "text".', code: 'BAD_FORMAT' })
    }

    const rowLimit = parseIntInRange(query.limit, 1, MAX_ROW_LIMIT, DEFAULT_ROW_LIMIT)
    const maxItems = asBool(query.all) ? null : parseIntInRange(query.max_items, 1, 5000, DEFAULT_MAX_ITEMS)
    const kinds = parseKinds(query.kinds)
    const { values: thresholds, sources: thresholdSources, rejected } = resolveThresholds({ query, env })

    // --- 2) Baca data (SELECT saja) ---
    let collected
    try {
      collected = await collectFn({ env, rowLimit, client: deps.client || null })
    } catch (err) {
      console.error('reminders collect error:', err)
      return res.status(502).json({
        ok: false,
        error: `Gagal membaca data operasional: ${err.message}`,
        code: 'COLLECT_FAILED',
        dry_run: true,
        read_only: true
      })
    }

    // --- 3) Susun laporan ---
    const report = buildReportFn({
      dataset: collected.dataset,
      sources: collected.sources,
      thresholds,
      thresholdSources,
      rejectedThresholds: rejected,
      asOf: query.as_of || null,
      kinds,
      limit: rowLimit
    })

    const allItems = report.items
    const shownItems = maxItems === null ? allItems : allItems.slice(0, maxItems)

    // Readiness = jawaban eksplisit atas "data apa yang ada dan ambang apa
    // yang dipakai", supaya laporan tidak pernah tampak hijau hanya karena
    // tabelnya belum ada.
    const readiness = {
      dry_run: true,
      read_only: true,
      no_outbound_send: true,
      no_payment: true,
      no_cron_mutation: true,
      authorized_as: auth && auth.role ? auth.role : null,
      auth_via: auth && auth.via ? auth.via : null,
      as_of: report.as_of,
      data_ready: report.data_ready,
      status: report.status,
      row_limit_per_table: rowLimit,
      thresholds_used: thresholds,
      threshold_defaults: DEFAULT_THRESHOLDS,
      threshold_sources: thresholdSources,
      sources_available: report.sources.filter(s => s.available).map(s => s.key),
      sources_unavailable: report.sources.filter(s => !s.available).map(s => ({
        key: s.key,
        table: s.table,
        error_code: s.error_code,
        error_message: s.error_message,
        // t_50b783de: sumber yang SENGAJA tidak dibaca (modul Approval OFF)
        // dibedakan dari sumber yang gagal/tiada, supaya tidak terbaca error.
        skipped_by_policy: !!s.skipped_by_policy
      })),
      kinds_blocked: report.blocked,
      kinds_available: report.kinds.filter(k => !k.blocked).map(k => k.key),
      // Handoff S4: invoice hanya boleh dipakai untuk penagihan bila durable.
      invoice_source_durable: (() => {
        const s = report.sources.find(x => x.key === 'sales_invoices')
        return !!(s && s.available && s.durable !== false)
      })(),
      invoice_preview_file: (() => {
        const s = report.sources.find(x => x.key === 'sales_invoices')
        return s && s.preview ? s.preview : null
      })(),
      items_total: report.summary.total,
      items_shown: shownItems.length,
      items_truncated: shownItems.length < allItems.length
    }

    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(renderText({ ...report, items: shownItems }))
    }

    return res.status(200).json({
      ...report,
      items: shownItems,
      readiness,
      meta: {
        row_limit: rowLimit,
        max_items: maxItems,
        kinds_requested: kinds || KINDS.map(k => k.key),
        authorized_as: readiness.authorized_as,
        auth_via: readiness.auth_via,
        queries: collected.meta ? collected.meta.queries : []
      }
    })
  }
}

export default createRemindersHandler()
