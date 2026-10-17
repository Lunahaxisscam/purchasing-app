#!/usr/bin/env node
// ============================================================
// scripts/reminders/cli.mjs — LAPORAN REMINDER DI TERMINAL (DRY-RUN)
// ============================================================
// Pemakaian:
//   node scripts/reminders/cli.mjs                    # baca Supabase (butuh env)
//   node scripts/reminders/cli.mjs --as-of 2026-10-18
//   node scripts/reminders/cli.mjs --json             # keluarkan JSON
//   node scripts/reminders/cli.mjs --offline          # pakai data contoh di repo
//   node scripts/reminders/cli.mjs --kinds invoice_due,handover_pending
//
// SIFAT: read-only. CLI ini hanya SELECT dan mencetak. Tidak ada pengiriman
// keluar, tidak ada pembayaran, tidak ada perubahan status/cron.
//
// Variabel lingkungan Supabase dibaca dari .env.local bila ada (hanya untuk
// kenyamanan lokal; di server nilainya sudah di environment).
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collect } from './collect.js'
import { buildReport, renderText, resolveThresholds } from './rules.js'

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

// Muat .env.local sederhana (tanpa dependensi) — hanya bila belum diset.
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const offline = !!args.flags.offline
  const asJson = !!args.flags.json
  const asOf = args.values['as-of'] || args.values.as_of || null
  const kinds = args.values.kinds ? String(args.values.kinds).split(',').map(s => s.trim()).filter(Boolean) : null

  loadEnvFile()

  let collected
  if (offline) {
    const samplePath = path.join(HERE, 'sample-data.json')
    const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
    collected = {
      dataset: sample.dataset,
      sources: sample.sources,
      meta: { read_only: true, offline: true, queries: [] }
    }
  } else {
    collected = await collect({ env: process.env })
  }

  const { values: thresholds, sources: thresholdSources, rejected } = resolveThresholds({ query: {}, env: process.env })
  const report = buildReport({
    dataset: collected.dataset,
    sources: collected.sources,
    thresholds,
    thresholdSources,
    rejectedThresholds: rejected,
    asOf,
    kinds,
    generatedAt: new Date().toISOString()
  })

  if (asJson) {
    console.log(JSON.stringify({
      ...report,
      meta: { offline, queries: collected.meta?.queries || [] }
    }, null, 2))
  } else {
    if (offline) {
      console.log('(MODE OFFLINE: memakai scripts/reminders/sample-data.json, bukan data produksi)\n')
    }
    console.log(renderText(report))
  }

  // Exit code: 0 = laporan dibuat. Sengaja TIDAK memakai exit code khusus
  // untuk "ada reminder" supaya tidak ada yang menyambungkannya ke cron/alert
  // otomatis tanpa keputusan manusia.
  return 0
}

main().then(code => process.exit(code)).catch(err => {
  console.error('Gagal membuat laporan reminder:', err.message)
  process.exit(2)
})
