// ============================================================
// probe_run237_shell_wiring.mjs — SAMBUNGAN penjaga hapus ke shell (run 237)
// ============================================================
// Probe UI (probe_run237_delete_ui.mjs) membuktikan TOMBOLNYA berhenti.
// Probe DB (probe_run237_delete.mjs) membuktikan APA yang rusak bila lolos.
// Yang belum dibuktikan: apakah shell `pages/index.js` benar-benar memakai
// keputusan itu SEBELUM menulis — termasuk untuk jalur yang tidak lewat
// tombol (pemanggilan programatik, kartu mobile modul lain, dsb).
//
// Pemeriksaan ini STATIS (membaca sumber), dan mengatakannya apa adanya:
//   W1  `deleteDecision` diimpor dari modul penjaga.
//   W2  Dipanggil di dalam `deleteItem`.
//   W3  Pemanggilannya SEBELUM optimistic update `setRows(...)` — kalau
//       sesudahnya, baris sudah hilang dari layar lalu muncul lagi.
//   W4  Pemanggilannya SEBELUM `supabase.from(table).delete()` — kalau
//       sesudahnya, penjaga tidak menjaga apa pun.
//   W5  Ada early-return saat `ok === false` (bukan hanya console.log).
//   W6  `warn` dikonfirmasi ke admin (status basi) dan pembatalan menghentikan
//       penghapusan.
//   W7  Tidak ada jalur hapus handover LAIN di UI (satu-satunya `.delete()`
//       untuk handovers adalah yang dijaga).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.cwd()
let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const src = fs.readFileSync(path.join(REPO, 'pages', 'index.js'), 'utf8')
const at = src.indexOf('async function deleteItem(')
const fnEnd = (() => {
  // Ambil blok fungsi: dari deklarasi sampai penanda fungsi berikutnya.
  const next = src.indexOf('\n  async function ', at + 10)
  return next > at ? next : src.length
})()
const fn = src.slice(at, fnEnd)
const posGuard = fn.indexOf('deleteDecision(')
const posSetRows = fn.indexOf('setRows(prev =>')
const posDelete = fn.indexOf('.delete()')

console.log('\n=== W1–W6. Shell memakai keputusan penjaga SEBELUM menulis ===')
check('W1 deleteDecision diimpor', /import\s*\{\s*deleteDecision\s*\}\s*from\s*'\.\.\/modules\/handovers\/deleteGuard'/.test(src))
check('W2 deleteDecision dipanggil di dalam deleteItem', posGuard > -1, `pos=${posGuard}`)
check('W3 dipanggil SEBELUM optimistic update setRows(...)',
  posGuard > -1 && posSetRows > -1 && posGuard < posSetRows, `guard=${posGuard} setRows=${posSetRows}`)
check('W4 dipanggil SEBELUM supabase.from(table).delete()',
  posGuard > -1 && posDelete > -1 && posGuard < posDelete, `guard=${posGuard} delete=${posDelete}`)
check('W5 ada early-return saat penjaga menolak (bukan hanya log)',
  /if\s*\(\s*!del\.ok\s*\)\s*\{[\s\S]{0,200}?return[\s\S]{0,40}?\}/.test(fn), fn.slice(Math.max(0, posGuard), posGuard + 260))
check('W6 peringatan status basi dikonfirmasi & pembatalan menghentikan hapus',
  /del\.warn\s*&&\s*!window\.confirm\(del\.warn\)\)\s*return/.test(fn), fn.slice(Math.max(0, posGuard), posGuard + 500))

console.log('\n=== W7. Tidak ada jalur hapus handover lain di UI ===')
// UI = pages/*.js (shell), components/, modules/, lib/. `pages/api/**` adalah
// endpoint maintenance server (bukan UI) dan sengaja TIDAK dihitung di sini —
// lihat W7b untuk kejujurannya.
//
// REVISI run 242: satu jalur hapus BARU muncul di `duplicateGuardDb.js` —
// penarikan diri (compensating withdraw) saat dokumen yang baru dibuat kalah
// balapan. Jalur itu SAH hanya bila: (a) menunjuk ID yang baru saja dibuat
// sendiri (bukan input pengguna), dan (b) memakai CAS `.is('diserahkan_at',
// null)` sehingga bukti yang sudah tercatat mustahil terhapus. Kedua syarat
// itu DIPERIKSA di sini, bukan diberi pengecualian buta.
const roots = ['components', 'modules', 'lib']
const offenders = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) { walk(p); continue }
    if (!/\.(js|jsx)$/.test(entry.name)) continue
    const s = fs.readFileSync(p, 'utf8')
    const re = /from\(\s*['"]handovers['"]\s*\)\s*\.delete\(\)/g
    let m
    while ((m = re.exec(s)) !== null) {
      const tail = s.slice(m.index, m.index + 200)
      const cas = /\.is\(\s*['"]diserahkan_at['"]\s*,\s*null\s*\)/.test(tail)
      const guardedByOwnId = /\.eq\(\s*['"]id['"]\s*,\s*inserted\.id\s*\)/.test(tail)
      if (!(cas && guardedByOwnId)) offenders.push(path.relative(REPO, p))
    }
  }
}
for (const r of roots) walk(path.join(REPO, r))
// Shell (pages/index.js) memakai SATU jalur `.delete()` generik yang sudah
// dijaga di W2–W4 — bukan jalur hapus handover tersendiri.
const pageFiles = fs.readdirSync(path.join(REPO, 'pages')).filter(f => f.endsWith('.js'))
const pageDirect = pageFiles.filter(f => {
  const s = fs.readFileSync(path.join(REPO, 'pages', f), 'utf8')
  return /from\(\s*'handovers'\s*\)\s*\.delete\(\)/.test(s)
})
check('W7 tidak ada modul/komponen yang menghapus handovers langsung',
  offenders.length === 0, offenders.join(', '))
check('W7a shell hanya memakai jalur generik yang dijaga (tanpa hapus handover khusus)',
  pageDirect.length === 0, pageDirect.join(', '))

console.log('\n=== W7b. Batas yang DIKETAHUI: endpoint maintenance ===')
// Diketahui & TIDAK diklaim tertutup oleh card ini:
//   pages/api/seed-simulation.js menghapus handovers/receivings secara massal.
// Ia bukan UI, tetapi tetap jalur yang bisa menghancurkan bukti fisik — jadi
// keberadaannya dicatat di sini dan di docs §8, bukan disembunyikan.
const seedPath = path.join(REPO, 'pages/api/seed-simulation.js')
const seed = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf8') : ''
check('W7b endpoint seed massal masih ada (batas yang diakui, bukan ditutup)',
  !!seed && /from\('handovers'\)\s*\.delete\(\)/.test(seed))
check('W7b2 …dan setidaknya bertoken (tidak bisa dipanggil sembarang orang)',
  /MAINTENANCE_TOKEN/.test(seed) && /401|403/.test(seed))
check('W7b3 …dan diblokir guard approval saat modul OFF',
  /approvalGuard\('seed-simulation'\)/.test(seed))

console.log(`\n=== HASIL WIRING: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
