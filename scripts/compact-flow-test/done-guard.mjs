// Uji guard "proyek DONE tidak boleh dibuatkan PR baru" (arahan DAT 24 Okt).
// Memuat modules/requests/save.js ASLI lewat transform SWC (pola sama dengan
// logic.mjs) lalu menjalankan save() dengan ctx minimal + mock supabase.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const cache = new Map()

async function load(file) {
  file = resolve(root, file)
  if (cache.has(file)) return cache.get(file)
  // lib/supabaseClient memakai paket npm (tidak bisa di-resolve dari data: URL).
  // Guard proyek berjalan SEBELUM tulisan DB, jadi cukup stub yang selalu
  // menolak — kalau guard bocor, test akan melihat error DB, bukan lolos.
  if (file.endsWith('/lib/supabaseClient.js')) {
    const stub = 'data:text/javascript;base64,' + Buffer.from(
      "export const supabase={from(){throw new Error('DB tidak boleh tersentuh saat guard aktif')},rpc(){throw new Error('DB tidak boleh tersentuh saat guard aktif')}}"
    ).toString('base64')
    cache.set(file, stub)
    return stub
  }
  let src = readFileSync(file, 'utf8')
  const specs = [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => m[1])
  for (const spec of new Set(specs)) {
    let p = resolve(dirname(file), spec)
    if (!/\.[cm]?jsx?$/.test(p)) p += '.js'
    let url = await load(p)
    src = src.split("'" + spec + "'").join("'" + url + "'").split('"' + spec + '"').join('"' + url + '"')
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(src).toString('base64')
  cache.set(file, url)
  return url
}

const saveModule = await import(await load('modules/requests/save.js'))

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); console.log('PASS', name); pass++ }
  catch (e) { console.log('FAIL', name, '—', e.message); fail++ }
}

function ctxFor({ isEdit = false, projectId = 'p-done', projects = [] } = {}) {
  const said = []
  const closed = []
  return {
    said, closed,
    ctx: {
      form: { project_id: projectId, title: 'Uji', pr_number: 'PR-X', priority: 'NORMAL' },
      isEdit,
      editRow: isEdit ? { id: 'pr-1', notes: '' } : null,
      editItems: [],
      prItemsList: [{ name: 'Triplek', qty: 1, satuan: 'Lembar', estimated_price: 1000, material_id: 'm1' }],
      nextPrNum: 'PR-001',
      allMaterials: [{ id: 'm1', category: 'Plywood', name: 'Triplek' }],
      allVendors: [],
      allProjects: projects,
      say: (m) => said.push(m),
      close: () => closed.push(1),
      refresh: () => {},
      setSaving: () => {}
    }
  }
}

const PROJECTS = [
  { id: 'p-done', name: 'Josh - Mabes', status: 'DONE' },
  { id: 'p-live', name: 'Santi - Baroni Utara', status: 'ON_GOING' }
]

// 1) PR baru untuk proyek DONE -> ditolak, tidak ada tulisan, form tetap terbuka
// Jalur yang DIBLOKIR guard tidak menyentuh DB sama sekali; jalur yang lolos
// akan gagal di stub DB — itu justru bukti guard tidak ikut memblokir.
async function run(ctx) { try { await saveModule.save(ctx) } catch { /* stub DB */ } }
const a = ctxFor({ projects: PROJECTS })
await run(a.ctx)
test('PR baru untuk proyek DONE ditolak dengan pesan jelas',
  () => assert.match(a.said.join(' '), /sudah selesai \(DONE\)/i))
test('form tidak ditutup saat PR ditolak', () => assert.equal(a.closed.length, 0))

// 2) PR baru untuk proyek aktif -> guard TIDAK memblokir (gagal di jalur DB,
//    bukan karena guard proyek). Dipastikan dari pesan yang muncul.
const b = ctxFor({ projects: PROJECTS, projectId: 'p-live' })
await run(b.ctx)
test('PR baru untuk proyek aktif tidak diblokir guard proyek',
  () => assert.ok(!b.said.join(' ').match(/sudah selesai \(DONE\)/i), b.said.join(' | ')))

// 3) Edit PR lama yang proyeknya DONE tetap diizinkan (tidak buntu)
const c = ctxFor({ projects: PROJECTS, isEdit: true })
await run(c.ctx)
test('edit PR lama pada proyek DONE tidak diblokir guard',
  () => assert.ok(!c.said.join(' ').match(/sudah selesai \(DONE\)/i), c.said.join(' | ')))

// 4) Data proyek tidak dikirim -> guard tidak menebak (fail-open ke validasi lain)
const d = ctxFor({ projects: [] })
await run(d.ctx)
test('tanpa data proyek, guard tidak mengarang penolakan',
  () => assert.ok(!d.said.join(' ').match(/sudah selesai \(DONE\)/i), d.said.join(' | ')))

console.log(JSON.stringify({ pass, fail }))
process.exitCode = fail ? 1 : 0
