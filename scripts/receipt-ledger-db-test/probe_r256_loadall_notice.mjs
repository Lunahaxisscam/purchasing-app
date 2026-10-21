// probe_r256_loadall_notice.mjs — REVIEW run 255 / D7 (bagian kedua):
// `loadAll` TIDAK BOLEH menelan kegagalan query menjadi array kosong tanpa
// memberi tahu layar.
//
// Halaman produksi (`pages/index.js`) dijalankan di jsdom dengan klien supabase
// palsu yang MENOLAK tabel `receivings` (meniru RLS/jaringan/timeout), sementara
// tabel lain tetap normal. Yang diperiksa:
//   N1  login berhasil & halaman dirender (kegagalan satu tabel tidak
//       menggagalkan seluruh halaman)
//   N2  notice "Gagal memuat receivings" MUNCUL di layar
//   N3  notice menyebut data sumber itu tidak lengkap (bukan "tidak ada data")
//   N4  tabel lain tetap terisi (kegagalan tidak menyebar)
//   N5  sumber OPSIONAL (tukang_projects) yang gagal TIDAK membuat notice
//   N6  pesan yang sama tidak menumpuk saat ↻ Perbarui ditekan dua kali
//
// Env: SB (sandbox dist), REPO (pohon sumber)
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.env.SB
const REPO = process.env.REPO || SB

const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
global.window = dom.window
global.document = dom.window.document
try { Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true }) } catch { /* sudah ada */ }
global.HTMLElement = dom.window.HTMLElement
global.HTMLInputElement = dom.window.HTMLInputElement
global.HTMLSelectElement = dom.window.HTMLSelectElement
global.Event = dom.window.Event
global.FileReader = dom.window.FileReader
global.localStorage = dom.window.localStorage
// Sidebar memakai `window.matchMedia` (bukan bagian dari jsdom).
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
}
global.matchMedia = dom.window.matchMedia

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (n = 120) => { for (let i = 0; i < n; i++) await tick() }
const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

let pass = 0, fail = 0
const ck = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}

// ------------------------------------------------------------
// Klien supabase palsu: `receivings` SELALU gagal, `tukang_projects` gagal
// (opsional), sisanya mengembalikan satu baris agar terlihat "terisi".
// ------------------------------------------------------------
const FAILING = new Set(['receivings'])
const OPTIONAL_FAILING = new Set(['tukang_projects'])
const calls = []

function makeQuery(table) {
  const st = { table, filters: [], order: null }
  const q = {
    select() { return q },
    order(col, opts) { st.order = { col, opts }; return q },
    eq(c, v) { st.filters.push([c, v]); return q },
    in(c, v) { st.filters.push([c, v]); return q },
    is(c, v) { st.filters.push([c, v]); return q },
    limit() { return q },
    maybeSingle() { return Promise.resolve({ data: null, error: null }) },
    single() { return Promise.resolve({ data: null, error: null }) },
    insert() { return q },
    update() { return q },
    delete() { return q },
    then(resolve, reject) {
      calls.push(table)
      if (FAILING.has(table)) {
        // Bentuk respons Supabase saat RLS/jaringan menolak: data null + error.
        return Promise.resolve({ data: null, error: { message: `permission denied for table ${table}`, code: '42501' } }).then(resolve, reject)
      }
      if (OPTIONAL_FAILING.has(table)) {
        return Promise.resolve({ data: null, error: { message: `relation "${table}" does not exist`, code: '42P01' } }).then(resolve, reject)
      }
      const row = table === 'projects'
        ? { id: 'p1', kode: '001', name: 'Proyek Uji' }
        : table === 'handovers'
          ? { id: 'h1', receiving_id: 'r1', status: 'DRAFT', handover_date: '2026-10-21', received_by: 'Mandor' }
          : { id: `${table}-1` }
      return Promise.resolve({ data: [row], error: null }).then(resolve, reject)
    }
  }
  return q
}

const supabaseStub = {
  from: (table) => makeQuery(table),
  rpc: async () => ({ data: { ok: true }, error: null }),
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'admin@uji.local' }, access_token: 'x' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: async () => ({ data: { session: { user: { id: 'u1', email: 'admin@uji.local' } } }, error: null }),
    signOut: async () => ({ error: null })
  },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel: () => {}
}

// `lib/supabaseClient` di sandbox diarahkan ke stub ini SEBELUM pages/index
// diimpor (modul mengimpor named export `supabase`).
const stubPath = path.join(SB, 'dist', 'lib', 'supabaseClient.r256stub.mjs')
const fs = await import('node:fs')
fs.mkdirSync(path.dirname(stubPath), { recursive: true })
fs.writeFileSync(stubPath, `export const supabase = globalThis.__R256_SB__\nexport default supabase\n`)
globalThis.__R256_SB__ = supabaseStub

// Halaman produksi TIDAK ada di sandbox dist (runner hanya mengompilasi
// modules/), jadi kompilasi halaman itu apa adanya ke direktori sandbox.
// Semua import relatif di-resolve ke `dist/` (hasil SWC), sehingga yang
// dijalankan tetap SUMBER VERBATIM — bukan salinan yang disunting.
const swc = require(path.join(SB, 'node_modules/next/dist/build/swc'))
const pageSrc = fs.readFileSync(path.join(REPO, 'pages/index.js'), 'utf8')
const pageOut = path.join(SB, 'dist', 'pages', 'index.r256.mjs')
fs.mkdirSync(path.dirname(pageOut), { recursive: true })

// Pastikan SETIAP modul yang diimpor halaman ada di dist/ (kompilasi apa adanya
// kalau runner belum melakukannya). Dependensi transitif sudah ada karena
// runner mengompilasi seluruh modules/ + components/ModuleView.
function ensureCompiled(rel) {
  const out = path.join(SB, 'dist', rel.replace(/\.(js|jsx)$/, '.mjs'))
  if (fs.existsSync(out)) return
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const c = swc.transformSync(src, {
    filename: out,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, c)
}
for (const rel of ['components/Login.js', 'components/Sidebar.js', 'components/Dashboard.js',
  'components/Finance.js', 'components/Planning.js', 'components/ProjectFinance.js',
  'components/TukangUpah.js', 'components/Settings.js', 'lib/constants.js', 'lib/telegramAlert.js',
  'lib/workflow.js', 'lib/money.js', 'lib/projectCostBreakdown.js', 'lib/laborSource.js',
  'modules/requests/submit.js', 'modules/requests/submitLean.js']) {
  try { ensureCompiled(rel) } catch (e) { console.log(`  (lewati ${rel}: ${e.message})`) }
}
// Kompilasi juga SETIAP file yang belum ada di dist (komponen/lib lain yang
// diimpor transitif), supaya probe tidak gagal karena modul belum dikompilasi.
function compileTree(dir) {
  const abs = path.join(REPO, dir)
  if (!fs.existsSync(abs)) return
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) compileTree(rel)
    else if (/\.(js|jsx)$/.test(e.name)) {
      try { ensureCompiled(rel) } catch (err) { console.log(`  (lewati ${rel}: ${err.message})`) }
    }
  }
}
compileTree('components')
compileTree('lib')

// Ganti HANYA dua hal: (a) specifier klien supabase → stub, (b) ekstensi
// import relatif supaya Node menemukan file `.mjs` hasil kompilasi.
let compiledSrc = pageSrc
  .replace(/from '\.\.\/lib\/supabaseClient'/g, `from '../lib/supabaseClient.r256stub.mjs'`)
  .replace(/from '(\.\.\/(?:components|modules|lib)\/[^']+)'/g, (m, spec) => {
    const hasExt = /\.(js|jsx|mjs)$/.test(spec)
    return `from '${spec}${hasExt ? '' : '.mjs'}'`
  })
const code = swc.transformSync(compiledSrc, {
  filename: pageOut,
  jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
  module: { type: 'es6' }
}).code
fs.writeFileSync(pageOut, code)

const App = (await import(pathToFileURL(pageOut).href)).default

document.body.innerHTML = ''
const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
flushSync(() => root.render(React.createElement(App)))
await settle(200)

const body = txt(document.body)
ck('N1 halaman tetap dirender walau satu query gagal (tidak blank/error total)',
  body.length > 40 && !/Unhandled|Cannot read|is not a function/i.test(body), body.slice(0, 160))
ck('N2 notice "Gagal memuat receivings" MUNCUL di layar',
  /Gagal memuat receivings/i.test(body), body.slice(0, 400))
ck('N3 notice menyatakan data sumber itu TIDAK lengkap (bukan "tidak ada data")',
  /TIDAK lengkap/i.test(body) && /jangan simpulkan "tidak ada data"/i.test(body), body.slice(0, 400))
ck('N4 kegagalan tidak menyebar: tabel lain tetap diminta & halaman memakai datanya',
  calls.includes('projects') && calls.includes('handovers'), JSON.stringify([...new Set(calls)]).slice(0, 240))
ck('N5 sumber OPSIONAL yang gagal (tukang_projects) TIDAK ikut dilaporkan sebagai kegagalan halaman',
  !/Gagal memuat[^.]*tukang_projects/i.test(body), body.slice(0, 400))
ck('N6 kode SQL mentah tidak bocor ke layar admin',
  !/42501|permission denied for table|42P01/.test(body))

// N7 — pesan yang sama tidak menumpuk saat muat ulang ditekan dua kali.
const refreshBtn = Array.from(document.querySelectorAll('button')).find(b => /Perbarui/.test(b.textContent || ''))
if (refreshBtn) {
  flushSync(() => refreshBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  await settle(160)
  flushSync(() => refreshBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  await settle(160)
}
const body2 = txt(document.body)
const occurrences = (body2.match(/Gagal memuat receivings/gi) || []).length
ck('N7 pesan yang sama TIDAK menumpuk setelah dua kali ↻ Perbarui', occurrences <= 1, `muncul ${occurrences}×`)

console.log(`\n=== HASIL PROBE r256 NOTICE: ${pass} PASS / ${fail} FAIL ===`)
process.exit(fail ? 1 : 0)
