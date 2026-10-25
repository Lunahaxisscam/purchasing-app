// ============================================================
// scripts/marketing/handler.js — HANDLER ENDPOINT KONTRAK MARKETING (DRY-RUN)
// ============================================================
// Logika endpoint tinggal di sini (bukan di pages/api) supaya harness menguji
// file yang SAMA PERSIS dengan yang dipakai Next — tidak ada salinan kedua.
// pages/api/marketing-contract.js hanya me-re-export default dari factory ini.
//
// DRY-RUN / READ-ONLY / KONTRAK SAJA:
//   * hanya GET; method lain 405 tanpa membaca apa pun,
//   * hanya membaca tabel yang boleh dibaca marketing (probe.js),
//   * TIDAK mengirim pesan (WA/email/DM), TIDAK membeli iklan,
//   * TIDAK menulis tabel apa pun (termasuk purchasing), TIDAK ada cron,
//   * payload lead TIDAK diterima lewat HTTP: validasi contoh memakai
//     `?sample=<id>` (data di repo) atau CLI `--validate <file>`.
//
// ROUTE GUARD (§4 dokumen kontrak): setiap permintaan yang MENGARAH ke aksi
// keluar (kirim, publikasi, iklan, kampanye berbayar, sinkronisasi) ditolak
// 403 ACTION_FORBIDDEN — bukan diabaikan diam-diam.
// ============================================================

import { AuthError, authFailure, requireAdmin } from './auth.js'
import { probe, DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT } from './probe.js'
import {
  CONTRACT_ID,
  CONTRACT_VERSION,
  LEAD_SOURCES,
  contractSummary,
  handoffPlan,
  validateLead
} from './contract.js'
import { SAMPLES, sampleById, sampleIds } from './samples.js'

export const ALLOWED_METHODS = Object.freeze(['GET'])
export const ALLOWED_VIEWS = Object.freeze(['summary', 'readiness', 'sample'])

// Aksi yang SECARA DESAIN tidak ada di lapisan ini. Ditolak eksplisit supaya
// tidak ada pemanggil yang mengira endpoint ini bisa mengirim/mengiklankan.
export const FORBIDDEN_ACTIONS = Object.freeze([
  'send', 'send-message', 'broadcast', 'blast', 'publish', 'post', 'dm',
  'email', 'whatsapp', 'wa', 'sms', 'call',
  'ads', 'ad', 'advertise', 'campaign-launch', 'launch', 'boost', 'promote',
  'spend', 'budget-commit', 'audience-upload', 'pixel',
  'write', 'insert', 'update', 'delete', 'upsert', 'sync', 'cron', 'schedule',
  'handoff-execute', 'execute', 'apply'
])

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

// detectForbiddenAction(query) -> { action } | null
// Melihat `action`, `do`, `op`, `cmd`, `intent`, dan flag bernama aksi
// (mis. ?send=1&ads=true). Semua nama aksi dicocokkan case-insensitive.
export function detectForbiddenAction(query = {}) {
  const q = query || {}
  const direct = ['action', 'do', 'op', 'cmd', 'intent', 'mode']
  for (const key of direct) {
    const raw = q[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') continue
    const val = String(raw).trim().toLowerCase()
    if (FORBIDDEN_ACTIONS.includes(val)) return { action: val, via: key }
  }
  for (const key of Object.keys(q)) {
    const k = String(key).toLowerCase()
    if (!FORBIDDEN_ACTIONS.includes(k)) continue
    if (asBool(q[key])) return { action: k, via: key }
  }
  return null
}

export function createMarketingHandler(deps = {}) {
  const env = deps.env || process.env
  const probeFn = deps.probe || probe
  const summaryFn = deps.contractSummary || contractSummary

  return async function handler(req, res) {
    // --- 0) Route guard: hanya GET ---
    if (!ALLOWED_METHODS.includes(req.method)) {
      res.setHeader('Allow', ALLOWED_METHODS)
      return res.status(405).json({
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        error: 'Endpoint kontrak marketing hanya menyediakan GET (dry-run). Tidak ada jalur tulis, kirim, atau iklan.',
        allowed_methods: [...ALLOWED_METHODS]
      })
    }

    const query = req.query || {}

    // --- 1) Route guard: aksi keluar tidak ada di lapisan ini ---
    const forbidden = detectForbiddenAction(query)
    if (forbidden) {
      return res.status(403).json({
        ok: false,
        code: 'ACTION_FORBIDDEN',
        action: forbidden.action,
        via: forbidden.via,
        error: `Aksi "${forbidden.action}" tidak tersedia di lapisan kontrak ini. Lapisan marketing hanya membaca dan merencanakan (dry-run): tidak mengirim pesan, tidak memasang/membeli iklan, tidak menulis tabel apa pun.`,
        side_effects: { outbound_send: false, paid_ads: false, writes: 0 }
      })
    }

    // --- 2) Otorisasi admin (fail closed, guard yang sama dengan S4/S5) ---
    let auth
    try {
      auth = await requireAdmin(req, env, deps.authDeps || {})
    } catch (err) {
      if (err instanceof AuthError) return authFailure(res, err)
      console.error('marketing contract auth error:', err)
      return res.status(500).json({ ok: false, error: 'Gagal memverifikasi otorisasi.', code: 'AUTH_ERROR' })
    }

    const view = String(query.view || 'summary').trim().toLowerCase()
    if (!ALLOWED_VIEWS.includes(view)) {
      return res.status(400).json({
        ok: false,
        code: 'BAD_VIEW',
        error: `view harus salah satu: ${ALLOWED_VIEWS.join(', ')}.`,
        allowed_views: [...ALLOWED_VIEWS]
      })
    }

    const summary = summaryFn()

    // --- 3) view=readiness: ketersediaan tabel (SELECT saja) ---
    if (view === 'readiness') {
      const rowLimit = parseIntInRange(query.limit, 1, MAX_ROW_LIMIT, DEFAULT_ROW_LIMIT)
      let probed
      try {
        probed = await probeFn({ env, rowLimit, client: deps.client || null })
      } catch (err) {
        console.error('marketing probe error:', err)
        return res.status(502).json({
          ok: false,
          code: 'PROBE_FAILED',
          error: `Gagal memeriksa ketersediaan tabel: ${err.message}`,
          dry_run: true,
          read_only: true
        })
      }
      const available = probed.sources.filter(s => s.available).map(s => s.key)
      const unavailable = probed.sources.filter(s => !s.available)
      const crmReady = available.includes('customers')
      const marketingReady = available.includes('leads') && available.includes('campaigns')
      return res.status(200).json({
        ok: true,
        contract_id: CONTRACT_ID,
        contract_version: CONTRACT_VERSION,
        dry_run: true,
        read_only: true,
        side_effects: { outbound_send: false, paid_ads: false, cron: false, write_queries: 0 },
        view,
        authorized_as: auth && auth.role ? auth.role : null,
        auth_via: auth && auth.via ? auth.via : null,
        data_ready: marketingReady && crmReady,
        status: (marketingReady && crmReady) ? 'ok' : (available.length ? 'degraded' : 'unavailable'),
        readiness: {
          marketing_tables_ready: marketingReady,
          crm_table_ready: crmReady,
          project_table_ready: available.includes('projects'),
          sources_available: available,
          sources_unavailable: unavailable.map(s => ({
            key: s.key, table: s.table, owner: s.owner, error_code: s.error_code, error_message: s.error_message
          })),
          // Jenis laporan yang TIDAK bisa dibuat tanpa tabelnya — dinyatakan
          // BLOCKED, bukan "0 lead" (pola sama dengan S5).
          blocked_capabilities: [
            !marketingReady && { capability: 'lead_pipeline', reason: 'Tabel leads/campaigns belum ada — pipeline TIDAK dinilai (bukan berarti kosong).' },
            !crmReady && { capability: 'customer_handoff', reason: 'Tabel customers (CRM) belum ada — handoff hanya bisa DIRENCANAKAN, tidak dieksekusi.' },
            !available.includes('projects') && { capability: 'project_link', reason: 'Tabel projects tidak terbaca — penautan lead→project tidak bisa diverifikasi.' }
          ].filter(Boolean),
          note: 'Lapisan ini KONTRAK + PEMERIKSA saja. Tidak ada data marketing yang dikarang dan tidak ada pesan/iklan yang dijalankan.'
        },
        sources: probed.sources,
        meta: { row_limit: rowLimit, queries: probed.meta ? probed.meta.queries : [] }
      })
    }

    // --- 4) view=sample: validasi contoh (dry-run, data dari repo) ---
    if (view === 'sample') {
      const id = String(query.sample || '').trim().toLowerCase()
      if (id && !sampleById(id)) {
        return res.status(404).json({
          ok: false,
          code: 'SAMPLE_NOT_FOUND',
          error: `Contoh "${id}" tidak ada.`,
          available_samples: sampleIds()
        })
      }
      const ids = id ? [id] : sampleIds()
      const results = ids.map(sid => {
        const s = sampleById(sid)
        const validation = validateLead(s.lead, { touchpointCount: s.touchpoint_count || 0 })
        const plan = handoffPlan({
          lead: s.lead,
          touchpointCount: s.touchpoint_count || 0,
          existingCustomer: s.existing_customer || null
        })
        return {
          sample_id: sid,
          title: s.title,
          intent: s.intent,
          touchpoint_count: s.touchpoint_count || 0,
          lead: s.lead,
          validation,
          handoff_plan: plan,
          executed: false,
          wrote: 0
        }
      })
      return res.status(200).json({
        ok: true,
        contract_id: CONTRACT_ID,
        contract_version: CONTRACT_VERSION,
        dry_run: true,
        read_only: true,
        side_effects: { outbound_send: false, paid_ads: false, cron: false, write_queries: 0 },
        view,
        authorized_as: auth && auth.role ? auth.role : null,
        auth_via: auth && auth.via ? auth.via : null,
        note: 'Contoh di repo, BUKAN data pelanggan nyata. Hasil validasi + rencana handoff; tidak ada yang dieksekusi.',
        samples: results,
        summary: {
          total: results.length,
          valid: results.filter(r => r.validation.ok).length,
          invalid: results.filter(r => !r.validation.ok).length,
          plans_create: results.filter(r => r.handoff_plan.action === 'CREATE_CUSTOMER').length,
          plans_link: results.filter(r => r.handoff_plan.action === 'LINK_EXISTING').length,
          plans_blocked: results.filter(r => r.handoff_plan.action === 'BLOCKED').length
        }
      })
    }

    // --- 5) view=summary (default): kontrak lengkap, tanpa jaringan ---
    return res.status(200).json({
      ...summary,
      view,
      authorized_as: auth && auth.role ? auth.role : null,
      auth_via: auth && auth.via ? auth.via : null,
      side_effects: { outbound_send: false, paid_ads: false, cron: false, write_queries: 0, status_changes: 0 },
      lead_sources_count: LEAD_SOURCES.length,
      samples: sampleIds(),
      routes: {
        self: '/api/marketing-contract',
        allowed_methods: [...ALLOWED_METHODS],
        views: [...ALLOWED_VIEWS],
        forbidden_actions: [...FORBIDDEN_ACTIONS]
      }
    })
  }
}

export default createMarketingHandler()
