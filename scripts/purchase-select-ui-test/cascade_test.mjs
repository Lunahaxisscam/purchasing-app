// ============================================================
// CASCADE TEST — checkbox kolom "Pilih" tabel Pembelian (t_b3768506)
// ============================================================
// Kenapa ada tes ini: screenshot DAT menunjukkan kolom centang TIDAK
// terlihat sama sekali. Pemeriksaan computed style di Chrome nyata
// (PC DAT, 1280x800, build staging 3001) membuktikan penyebabnya:
//   checkbox  -> width: 0px, height: 13px
//   sel <th>  -> lebar 36px, padding 14px 18px  => content box 0px
// karena aturan dasar `input { width: 100%; padding: 10px 14px }` di
// styles/globals.css ikut berlaku untuk input[type=checkbox].
//
// Tes ini membaca CSS NYATA (bukan salinan) dan gagal (RED) bila:
//   R1 aturan dasar input masih mengenai checkbox/radio
//   R2 tidak ada aturan ukuran eksplisit untuk checkbox di tabel Pembelian
//   R3 kolom pilih tidak punya lebar/padding yang menyisakan content box
//      cukup untuk kontrol 18px
//   R4 label kolom "Pilih" tidak ada di markup halaman Pembelian
//
// Mode:  node cascade_test.mjs                 -> periksa worktree (GREEN)
//        node cascade_test.mjs --git <rev>     -> periksa CSS di git rev (RED)
// ============================================================
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const args = process.argv.slice(2)
const revIdx = args.indexOf('--git')
const rev = revIdx >= 0 ? args[revIdx + 1] : null

function readRepoFile(rel) {
  if (rev) return execSync(`git show ${rev}:${rel}`, { cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 }).toString()
  return readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const css = readRepoFile('styles/globals.css')
const jsx = readRepoFile('modules/receivings/page.jsx')

let pass = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { failures.push(name); console.log(`  FAIL ${name}${extra ? '  -> ' + extra : ''}`) }
}

// --- helper: ambil blok deklarasi untuk sebuah selector literal ---
// Normalisasi spasi (baris baru, indentasi) supaya cocok dengan CSS nyata.
function norm(s) {
  return s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim()
}
function blockFor(selector) {
  const want = norm(selector)
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g)
  for (const m of rules) {
    const head = m[1]
    // buang komentar di selector
    const clean = head.replace(/\/\*[\s\S]*?\*\//g, '')
    if (norm(clean) === want) return m[2]
  }
  return null
}

console.log(rev ? `\nMODE RED — memeriksa git ${rev}` : '\nMODE GREEN — memeriksa worktree')

// R1 — aturan dasar input tidak boleh mengenai checkbox/radio
const baseInput = blockFor('input:not([type=\'checkbox\']):not([type=\'radio\']), select, textarea')
const legacyInput = blockFor('input, select, textarea')
check(
  'R1 aturan dasar input TIDAK lagi mengenai checkbox/radio (tidak ada blok `input, select, textarea` polos)',
  !!baseInput && !legacyInput,
  legacyInput ? 'masih ada blok `input, select, textarea { ... width: 100% }` yang mengenai checkbox' : 'blok dasar input yang mengecualikan checkbox tidak ditemukan'
)

// R2 — ukuran eksplisit checkbox tabel Pembelian
const cbBlock = blockFor('table.purchase-table input[type=\'checkbox\'],\n.mobile-card input[type=\'checkbox\']') ||
  blockFor("table.purchase-table input[type='checkbox']")
const widthMatch = cbBlock && /(^|[^-\w])width\s*:\s*(\d+)px/.exec(cbBlock)
const minWidthMatch = cbBlock && /min-width\s*:\s*(\d+)px/.exec(cbBlock)
check(
  'R2 checkbox tabel Pembelian punya width eksplisit >= 16px',
  !!widthMatch && Number(widthMatch[2]) >= 16,
  cbBlock ? `blok ada tapi width=${widthMatch ? widthMatch[2] + 'px' : 'tidak ada'}` : 'tidak ada aturan checkbox tabel Pembelian'
)
check(
  'R2b checkbox punya min-width >= 16px (tidak bisa dikempiskan layout tabel)',
  !!minWidthMatch && Number(minWidthMatch[1]) >= 16,
  minWidthMatch ? minWidthMatch[1] + 'px' : 'min-width tidak ada'
)
check(
  'R2c checkbox memakai accent-color (state checked kontras, bukan putih di atas putih)',
  !!cbBlock && /accent-color\s*:/.test(cbBlock),
  'accent-color tidak ada'
)

// R3 — kolom pilih: lebar & padding menyisakan content box >= 24px
const colBlock = blockFor('table.purchase-table th.purchase-select-col,\ntable.purchase-table td.purchase-select-col')
let colOk = false
let colDetail = 'aturan kolom pilih tidak ada'
if (colBlock) {
  const w = /width\s*:\s*(\d+)px/.exec(colBlock)
  const pad = /padding\s*:\s*([\d.]+)px\s+([\d.]+)px/.exec(colBlock)
  if (w && pad) {
    const content = Number(w[1]) - 2 * Number(pad[2])
    colOk = content >= 24
    colDetail = `width=${w[1]} padding-x=${pad[2]} -> content box ${content}px`
  }
}
check('R3 kolom pilih menyisakan content box >= 24px', colOk, colDetail)

// R4 — markup: header berlabel "Pilih" + kelas kolom + hint/alasan disabled
check(
  'R4 header tabel punya label teks "Pilih" + kelas purchase-select-col',
  /purchase-select-col/.test(jsx) && /purchase-select-all-label/.test(jsx) && /<span>Pilih<\/span>/.test(jsx),
  'label header "Pilih" tidak ditemukan'
)
check(
  'R5 tiap baris memakai kelas purchase-select-col (sel cukup lebar)',
  /<td className="purchase-select-col">/.test(jsx),
  'td baris tanpa kelas purchase-select-col'
)
check(
  'R6 ada petunjuk pemilihan + alasan tombol nonaktif (select-empty-hint / aria-describedby)',
  /select-empty-hint/.test(jsx) && /aria-describedby=\{selectedRows\.length \? undefined : 'purchase-select-hint'\}/.test(jsx),
  'hint/alasan nonaktif tidak ada'
)
check(
  'R7 checkbox baris punya aria-label aksesibel',
  /aria-label=\{`Pilih \$\{r\.itemName\}`\}/.test(jsx),
  'aria-label baris tidak ada'
)

console.log(`\n${pass} cek lolos, ${failures.length} gagal`)
if (failures.length) {
  console.log('GAGAL: ' + failures.join(' | '))
  process.exit(1)
}
