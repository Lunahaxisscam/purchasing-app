#!/usr/bin/env node
// ============================================================
// scripts/marketing/cli.mjs — ALAT KONTRAK MARKETING DI TERMINAL (DRY-RUN)
// ============================================================
// Pemakaian:
//   node scripts/marketing/cli.mjs                       # ringkasan kontrak
//   node scripts/marketing/cli.mjs --readiness           # cek tabel (SELECT saja)
//   node scripts/marketing/cli.mjs --samples             # validasi semua contoh
//   node scripts/marketing/cli.mjs --samples --json
//   node scripts/marketing/cli.mjs --validate berkas.json  # validasi lead sendiri
//   node scripts/marketing/cli.mjs --plan berkas.json      # rencana handoff
//
// SIFAT: read-only. Hanya SELECT (mode --readiness) dan mencetak. Tidak ada
// pengiriman pesan, tidak ada iklan berbayar, tidak ada penulisan tabel,
// tidak ada cron.
//
// --validate / --plan menerima berkas JSON:
//   { "lead": {...}, "touchpoint_count": 2, "existing_customer": {...} }
// atau langsung objek lead. Tidak ada data yang dikirim ke mana pun.
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { probe } from './probe.js'
import { contractSummary, handoffPlan, validateLead } from './contract.js'
import { SAMPLES, sampleById, sampleIds } from './samples.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

function parseArgs(argv) {
  const out = { flags: {}, values: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out.values[key] = next; i++ }
    else out.flags[key] = true
  }
  return out
}

function loadEnvFile() {
  const file = path.join(REPO, '.env.local')
  if (!fs.existsSync(file)) return false
  const raw = fs.readFileSync(file, 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    if (process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return true
}

function printSummary(s) {
  const L = []
  L.push('KONTRAK INTEGRASI MARKETING → CRM/PROJECT (DRY-RUN · KONTRAK SAJA)')
  L.push(`Kontrak        : ${s.contract_id} v${s.contract_version}`)
  L.push('Efek samping   : tidak ada kirim pesan · tidak ada iklan berbayar · tidak ada tulis tabel · tidak ada cron')
  L.push('')
  L.push(`SUMBER LEAD (${s.lead_sources.length} enum tetap)`)
  L.push('  ' + s.lead_sources.join(', '))
  L.push('')
  L.push(`STATUS KUALIFIKASI (${s.lead_statuses.length})`)
  for (const st of s.lead_statuses) {
    const next = s.transitions[st] || []
    const gate = s.qualification_gates[st] || { required: [] }
    const req = gate.required.length ? gate.required.join(' + ') : '—'
    L.push(`  ${st.padEnd(10)} → ${(next.length ? next.join(', ') : '(final)').padEnd(28)} bukti: ${req}`)
  }
  L.push('')
  L.push('ATRIBUSI')
  L.push(`  model: ${s.attribution.models.join(', ')} · dibekukan saat: ${s.attribution.frozen_at}`)
  L.push(`  utm  : ${s.attribution.utm_keys.join(', ')}`)
  L.push('')
  L.push('KEPEMILIKAN TABEL')
  for (const t of s.table_ownership) {
    const akses = t.marketing === 'none' ? 'TIDAK BOLEH DISENTUH' : (t.marketing === 'read' ? 'baca saja' : 'pemilik (nanti)')
    L.push(`  ${t.table.padEnd(18)} owner=${String(t.owner).padEnd(13)} marketing=${akses}${t.exists ? '' : '  [tabel belum ada]'}`)
  }
  L.push('')
  L.push('INVARIAN PURCHASING')
  for (const i of s.purchasing_invariants) L.push(`  ${i.id}: ${i.rule}`)
  L.push('')
  L.push('Tidak ada pesan yang dikirim, tidak ada iklan yang dibeli, tidak ada tabel yang ditulis.')
  return L.join('\n')
}

function printReadiness(result) {
  const L = []
  L.push('KETERSEDIAAN TABEL UNTUK LAPISAN MARKETING (READ-ONLY)')
  L.push('')
  const width = Math.max(16, ...result.sources.map(s => s.key.length))
  for (const s of result.sources) {
    const state = s.available ? 'TERSEDIA' : 'TIDAK   '
    const extra = s.available
      ? `${s.row_count} baris · owner ${s.owner}`
      : `${s.error_code || 'ERROR'} — owner ${s.owner}`
    L.push(`  ${state} ${s.key.padEnd(width)} ${extra}`)
    if (!s.available && s.error_message) L.push(`           ${String(s.error_message).slice(0, 120)}`)
  }
  const available = result.sources.filter(s => s.available).map(s => s.key)
  const marketingReady = available.includes('leads') && available.includes('campaigns')
  const crmReady = available.includes('customers')
  L.push('')
  L.push(`Tabel marketing siap : ${marketingReady ? 'YA' : 'TIDAK — pipeline lead TIDAK dinilai (bukan berarti kosong)'}`)
  L.push(`Tabel CRM siap       : ${crmReady ? 'YA' : 'TIDAK — handoff hanya bisa DIRENCANAKAN, tidak dieksekusi'}`)
  L.push(`Tabel projects siap  : ${available.includes('projects') ? 'YA (baca saja)' : 'TIDAK'}`)
  L.push('')
  L.push('Tidak ada pesan yang dikirim, tidak ada iklan yang dibeli, tidak ada tabel yang ditulis.')
  return L.join('\n')
}

function runSample(s) {
  const validation = validateLead(s.lead, { touchpointCount: s.touchpoint_count || 0 })
  const plan = handoffPlan({ lead: s.lead, touchpointCount: s.touchpoint_count || 0, existingCustomer: s.existing_customer || null })
  return { sample_id: s.id, title: s.title, intent: s.intent, validation, handoff_plan: plan }
}

function printSamples(results) {
  const L = []
  L.push('VALIDASI CONTOH (DRY-RUN — data karangan, bukan pelanggan nyata)')
  L.push('')
  for (const r of results) {
    const v = r.validation
    L.push(`  ${v.ok ? 'LULUS' : 'GAGAL'}  ${r.sample_id}`)
    L.push(`         ${r.title}`)
    if (v.errors.length) for (const e of v.errors) L.push(`         ✗ ${e.code} (${e.field}): ${e.message}`)
    if (v.warnings.length) for (const w of v.warnings) L.push(`         ! ${w.code} (${w.field}): ${w.message}`)
    L.push(`         status=${v.status} · key=${v.contact.customer_key || '—'} · rencana handoff=${r.handoff_plan.action}`)
  }
  const ok = results.filter(r => r.validation.ok).length
  L.push('')
  L.push(`Total: ${results.length} contoh · ${ok} lulus · ${results.length - ok} gagal`)
  L.push('Tidak ada pesan yang dikirim, tidak ada iklan yang dibeli, tidak ada tabel yang ditulis.')
  return L.join('\n')
}

function readInput(file) {
  const raw = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
  const parsed = JSON.parse(raw)
  if (parsed && typeof parsed === 'object' && parsed.lead) {
    return { lead: parsed.lead, touchpoint_count: parsed.touchpoint_count || 0, existing_customer: parsed.existing_customer || null }
  }
  return { lead: parsed, touchpoint_count: 0, existing_customer: null }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  loadEnvFile()

  if (args.values.validate) {
    const input = readInput(args.values.validate)
    const v = validateLead(input.lead, { touchpointCount: input.touchpoint_count })
    if (args.flags.json) {
      console.log(JSON.stringify({ ok: v.ok, validation: v, executed: false, wrote: 0 }, null, 2))
    } else {
      console.log(`VALIDASI LEAD (dry-run) — ${v.ok ? 'LULUS' : 'GAGAL'}`)
      console.log(`  status=${v.status} key=${v.contact.customer_key || '—'} next=${v.next_allowed.join(', ') || '(final)'}`)
      for (const e of v.errors) console.log(`  ✗ ${e.code} (${e.field}): ${e.message}`)
      for (const w of v.warnings) console.log(`  ! ${w.code} (${w.field}): ${w.message}`)
      console.log('Tidak ada yang disimpan/dikirim.')
    }
    return 0
  }

  if (args.values.plan) {
    const input = readInput(args.values.plan)
    const plan = handoffPlan(input)
    if (args.flags.json) console.log(JSON.stringify(plan, null, 2))
    else {
      console.log('RENCANA HANDOFF KE CRM (PLAN SAJA — TIDAK DIEKSEKUSI)')
      console.log(`  action          : ${plan.action}`)
      console.log(`  customer_key    : ${plan.customer_key || '—'}`)
      console.log(`  idempotency_key : ${plan.idempotency_key || '—'}`)
      console.log(`  target          : ${plan.target_table} (owner: ${plan.target_owner})`)
      console.log(`  would_write     : ${plan.would_write}`)
      for (const b of plan.blocked_reasons) console.log(`  ✗ ${b.code}: ${b.message}`)
      console.log('  prasyarat:')
      for (const p of plan.preconditions) console.log(`    - ${p}`)
      console.log('  dilarang:')
      for (const f of plan.forbidden) console.log(`    - ${f}`)
      console.log('Tidak ada yang dieksekusi: lapisan ini tidak punya jalur tulis.')
    }
    return 0
  }

  if (args.flags.samples) {
    const results = SAMPLES.map(runSample)
    if (args.flags.json) console.log(JSON.stringify({ samples: results, executed: false, wrote: 0 }, null, 2))
    else console.log(printSamples(results))
    return 0
  }

  if (args.flags.readiness) {
    const result = await probe({ env: process.env })
    if (args.flags.json) console.log(JSON.stringify(result, null, 2))
    else console.log(printReadiness(result))
    return 0
  }

  const s = contractSummary()
  if (args.flags.json) console.log(JSON.stringify({ ...s, samples: sampleIds() }, null, 2))
  else console.log(printSummary(s))
  return 0
}

main().then(code => process.exit(code)).catch(err => {
  console.error('GAGAL:', err && err.message ? err.message : err)
  process.exit(1)
})
