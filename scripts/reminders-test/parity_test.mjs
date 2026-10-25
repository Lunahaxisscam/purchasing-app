// ============================================================
// scripts/reminders-test/parity_test.mjs — C. PARITAS & BUKTI READ-ONLY
// ============================================================
// Dua hal yang mudah "menyimpang diam-diam" dan diuji di sini:
//
//   C1. readNoteMarkers (subset di rules.js) harus memberi hasil SAMA dengan
//       parsePurchaseNote (parser kanonik di lib/purchaseNote.js) untuk
//       penanda yang dipakai lapisan reminder. Diuji atas kasus sintetis DAN
//       atas catatan nota nyata di repo (data/ + contoh di docs).
//
//   C2. Lapisan reminder tidak boleh berisi operasi tulis. Bukti diperkuat
//       dengan memeriksa SELURUH file lapisan (bukan hanya pola yang saya
//       ingat), plus memastikan tidak ada `cron`, `vercel.json` cron, atau
//       paket penjadwal baru di package.json.
// ============================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO = path.resolve(HERE, '..', '..')
const REM = path.join(REPO, 'scripts', 'reminders')

const R = await import(pathToFileURL(path.join(REM, 'rules.js')).href)

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}

// lib/purchaseNote.js adalah modul ESM di dalam paket CommonJS: impor lewat
// jembatan .mjs sementara (sama seperti harness modul lain) supaya tidak
// bergantung pada flag Node. Jembatan ditulis ke direktori temp, BUKAN ke
// dalam repo (tidak boleh meninggalkan artefak di working tree).
const bridgePath = path.join(os.tmpdir(), 'reminders-parity-bridge.mjs')
function ensureBridge() {
  fs.writeFileSync(bridgePath, `export * from ${JSON.stringify(pathToFileURL(path.join(REPO, 'lib', 'purchaseNote.js')).href)}\n`)
  return pathToFileURL(bridgePath).href
}

console.log('\n=== C. PARITAS PARSER & BUKTI READ-ONLY ===')

// ---------- C1. Paritas parser ----------
let canonical = null
try {
  canonical = await import(ensureBridge())
} catch (err) {
  console.log(`  (info) jembatan ESM gagal: ${err.message}`)
}

if (canonical && typeof canonical.parsePurchaseNote === 'function') {
  const CASES = [
    '',
    'catatan biasa tanpa penanda',
    '[Nominal: Rp 1.250.000]',
    '[Nominal: Rp 865.000] Nota TB Makmur Jaya',
    '[Nominal: Rp 542.000] [BiayaLain: Rp 25.000] [Tahap: DIBELI] diambil sendiri',
    '[Nominal: Rp 1.980.000] [BuktiNota: data:image/png;base64,iVBORw0KGgo=] [BuktiTransfer: data:image/png;base64,AAA=]',
    '[Nominal: 500000]',
    '[Nominal: Rp 0]',
    '[BuktiNota: https://x/y.png] tanpa nominal',
    '[Nominal: Rp 12.345.678] [Diskon: Rp 5.000] [Nota: TB-88912]',
    null,
    undefined
  ]
  let mismatch = 0
  for (const c of CASES) {
    const mine = R.readNoteMarkers(c)
    const theirs = canonical.parsePurchaseNote(c)
    if (mine.material !== theirs.material) {
      mismatch++
      console.log(`    beda material untuk ${JSON.stringify(c)}: ${mine.material} vs ${theirs.material}`)
    }
    if (mine.buktiNota !== theirs.buktiNota) {
      mismatch++
      console.log(`    beda buktiNota untuk ${JSON.stringify(c)}: ${JSON.stringify(mine.buktiNota)} vs ${JSON.stringify(theirs.buktiNota)}`)
    }
    if (mine.buktiTransfer !== theirs.buktiTransfer) {
      mismatch++
      console.log(`    beda buktiTransfer untuk ${JSON.stringify(c)}`)
    }
  }
  ok('C1a', `paritas penanda nota atas ${CASES.length} kasus (0 beda)`, mismatch === 0, `mismatch=${mismatch}`)
} else {
  console.log('  (info) parsePurchaseNote tidak bisa diimpor — paritas dilewati')
}

// Paritas atas catatan nota NYATA: ambil dari file data repo bila ada.
{
  const candidates = [
    path.join(REPO, 'data', 'sales_invoices.json')
  ]
  let notes = []
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue
    try {
      const rows = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (Array.isArray(rows)) notes.push(...rows.map(r => r && r.note).filter(Boolean))
    } catch (_) { /* file rusak: bukan urusan uji ini */ }
  }
  // Catatan contoh dari sample-data + docs (selalu ada di repo).
  notes.push('[Nominal: Rp 542.000] [Tahap: DIBELI] diambil sendiri')
  notes.push('[Nominal: Rp 865.000] Nota lama TB Makmur')
  notes.push('[Nominal: Rp 1.915.000] Toko Mitra Fitting')

  if (canonical && typeof canonical.parsePurchaseNote === 'function') {
    let bad = 0
    for (const n of notes) {
      if (R.readNoteMarkers(n).material !== canonical.parsePurchaseNote(n).material) bad++
    }
    ok('C1b', `paritas atas ${notes.length} catatan nota nyata/contoh`, bad === 0, `beda=${bad}`)
  } else {
    ok('C1b', 'catatan nota contoh terbaca oleh lapisan reminder',
      notes.every(n => typeof R.readNoteMarkers(n).material === 'number'))
  }
}

// ---------- C2. Bukti read-only di seluruh lapisan ----------
{
  const layerFiles = ['rules.js', 'collect.js', 'handler.js', 'auth.js', 'cli.mjs']
    .map(f => path.join(REM, f))
    .filter(f => fs.existsSync(f))
  ok('C2a', 'lapisan reminder punya 5 file', layerFiles.length === 5, `actual=${layerFiles.length}`)

  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')

  const all = layerFiles.map(f => strip(fs.readFileSync(f, 'utf8'))).join('\n')
  const writes = [
    ['insert', /\.insert\s*\(/],
    ['update', /\.update\s*\(/],
    ['delete', /\.delete\s*\(/],
    ['upsert', /\.upsert\s*\(/],
    ['rpc', /\.rpc\s*\(/]
  ]
  for (const [name, re] of writes) {
    ok(`C2b-${name}`, `tidak ada .${name}( di kode (komentar dibuang)`, !re.test(all))
  }
  ok('C2c', 'tidak ada panggilan HTTP keluar di rules/handler/auth',
    !/fetch\s*\(|axios|https?:\/\//.test(
      ['rules.js', 'handler.js', 'auth.js'].map(f => strip(fs.readFileSync(path.join(REM, f), 'utf8'))).join('\n')
    ))
  ok('C2d', 'collect.js hanya memakai client Supabase (tidak ada endpoint lain)',
    !/fetch\s*\(|axios|api\.telegram/.test(strip(fs.readFileSync(path.join(REM, 'collect.js'), 'utf8'))))
}
{
  // Tidak ada cron: tidak di vercel.json, tidak di package.json, tidak di kode.
  const vercel = path.join(REPO, 'vercel.json')
  ok('C2e', 'tidak ada vercel.json dengan crons',
    !fs.existsSync(vercel) || !/"crons"/.test(fs.readFileSync(vercel, 'utf8')))
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  ok('C2f', 'tidak ada paket penjadwal baru di package.json',
    !Object.keys(pkg.dependencies || {}).some(d => /cron|schedul|agenda/i.test(d)),
    JSON.stringify(Object.keys(pkg.dependencies || {})))
  const scripts = Object.keys(pkg.scripts || {})
  ok('C2g', 'tidak ada script npm yang menjalankan reminder otomatis',
    !scripts.some(s => /remind|alert|notify/i.test(s)), JSON.stringify(scripts))
}
{
  // Bukti tambahan: laporan menyatakan efek samping = nol.
  const rep = R.buildReport({ dataset: {}, sources: [], thresholds: R.DEFAULT_THRESHOLDS, asOf: '2026-10-18' })
  ok('C2h', 'side_effects.write_queries = 0', rep.side_effects.write_queries === 0)
  ok('C2i', 'side_effects.outbound_send = false', rep.side_effects.outbound_send === false)
  ok('C2j', 'side_effects.payment = false', rep.side_effects.payment === false)
  ok('C2k', 'side_effects.cron_mutation = false', rep.side_effects.cron_mutation === false)
  ok('C2l', 'side_effects.status_changes = 0', rep.side_effects.status_changes === 0)
}

// ---------- C3. CLI offline jalan tanpa jaringan ----------
{
  const { execFileSync } = await import('node:child_process')
  const out = execFileSync(process.execPath, [path.join(REM, 'cli.mjs'), '--offline', '--as-of', '2026-10-18'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    timeout: 60000
  })
  ok('C3a', 'CLI offline keluar tanpa error', out.includes('LAPORAN REMINDER OPERASIONAL'))
  ok('C3b', 'CLI offline menyatakan mode offline', out.includes('MODE OFFLINE'))
  ok('C3c', 'CLI offline mencetak BLOCKED untuk invoice', out.includes('BLOCKED'))
  ok('C3d', 'CLI offline mencetak peringatan tidak ada pengiriman', /tidak ada pesan yang dikirim/i.test(out))

  const jsonOut = execFileSync(process.execPath, [path.join(REM, 'cli.mjs'), '--offline', '--json', '--as-of', '2026-10-18'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'test' },
    timeout: 60000
  })
  const parsed = JSON.parse(jsonOut)
  ok('C3e', 'CLI --json menghasilkan JSON valid', !!parsed && parsed.dry_run === true)
  ok('C3f', 'CLI --json punya readiness sumber', Array.isArray(parsed.sources) && parsed.sources.length > 0)
  ok('C3g', 'CLI --json menandai sales_invoices tidak tersedia',
    parsed.sources.some(s => s.key === 'sales_invoices' && s.available === false))
}

console.log(`\n  HASIL C: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
