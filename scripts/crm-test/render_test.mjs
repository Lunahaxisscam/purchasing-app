// ============================================================
// UJI RENDER — modules/crm/view.jsx (t_7253b859)
// Merender komponen ASLI (hasil transform SWC di dist/) dengan
// jsdom INTERAKTIF (createRoot), lalu memeriksa DOM:
//   A) Capability: host tidak mengirim data -> panel "belum tersedia",
//      BUKAN daftar kosong yang terlihat seperti bug.
//   B) Host mengirim [] -> "Belum ada customer terdata".
//   C) Host mengirim data -> tabel tampil; kontak kosong = "Tidak
//      tersedia" (bukan sel kosong / bukan "0").
//   D) Relasi invoice tidak dikirim -> "tidak dikirim", BUKAN 0.
//   E) Form tambah: validasi error + draft muncul dengan label
//      "Draf halaman" (bukan "tersimpan").
//   F) Baris host baca saja: tidak ada tombol ubah/hapus.
//   G) Tidak ada penulisan DB: tidak ada fetch/XHR/localStorage.
//   H) Drawer detail: sumber tiap field.
//   I) CSV bisa diunduh.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const REPO = process.argv[2] || path.dirname(path.dirname(SB))

// ---------- 1) DOM environment dulu (urutan wajib) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

// ---------- 2) Baru import React & komponen ----------
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const CrmModule = (await import(pathToFileURL(path.join(SB, 'dist/modules/crm/view.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

function mount(props = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  try { global.navigator = dom.window.navigator } catch { /* Node 22: read-only */ }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(CrmModule, props)))
  return { dom, root }
}

const t = (doc, id) => {
  const el = doc.querySelector(`[data-testid="${id}"]`)
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null
}
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event("click", { bubbles: true })))
const submit = (form) => flushSync(() => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })))

// React memakai value tracker sendiri: set .value langsung TIDAK memicu
// onChange. Pakai native setter supaya state React ikut berubah.
function type(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, value)
  flushSync(() => el.dispatchEvent(new window.Event('input', { bubbles: true })))
}

const HOST = [
  { id: 'c1', name: 'Ibu Sarah', phone: '0812-3456-789', email: 's@x.id', address: 'Jl. Melati 3', source: 'Instagram', notes: 'Butuh 3 lemari' },
  { id: 'c2', name: 'Pak Budi', phone: '', email: '', address: '', source: '', notes: '' },
  { id: 'c3', name: 'Ani Kosong', phone: '', email: '', address: '', source: 'Referral', notes: '' }
]

// ---------- 3) A: capability unavailable ----------
console.log('\n[A] Host tidak mengirim data -> panel kemampuan, bukan daftar kosong')
{
  const { dom } = mount({ rows: {}, customers: undefined })
  const doc = dom.window.document
  check('root tampil', !!doc.querySelector('[data-testid="crm-root"]'))
  check('capability = unavailable', doc.querySelector('[data-testid="crm-root"]').getAttribute('data-capability') === 'unavailable')
  check('panel kemampuan tampil', !!doc.querySelector('[data-testid="crm-capability"]'))
  check('judul menyebut tabel belum tersedia', /belum tersedia/i.test(t(doc, 'crm-capability-title') || ''))
  check('teks menyebut tidak ada customer contoh', /tidak ada customer contoh/i.test(t(doc, 'crm-root') || ''))
  check('tidak ada tabel customer', !doc.querySelector('[data-testid="crm-table"]'))
  check('empty state menyebut sumber belum tersedia', /sumber customer belum tersedia/i.test(t(doc, 'crm-empty') || ''))
  check('KPI total = 0', t(doc, 'crm-kpi-total') === '0')
  check('KPI relasi = "Tidak dikirim" (BUKAN 0)', t(doc, 'crm-kpi-relation') === 'Tidak dikirim')
  check('tombol CSV disabled', doc.querySelector('[data-testid="crm-csv"]').disabled === true)
}

// ---------- 4) B: capability empty ----------
console.log('\n[B] Host mengirim [] -> "Belum ada customer terdata"')
{
  const { dom } = mount({ rows: {}, customers: [] })
  const doc = dom.window.document
  check('capability = empty', doc.querySelector('[data-testid="crm-root"]').getAttribute('data-capability') === 'empty')
  check('judul "Belum ada customer terdata"', t(doc, 'crm-capability-title') === 'Belum ada customer terdata')
  check('empty state memakai label yang sama', /Belum ada customer terdata/.test(t(doc, 'crm-empty') || ''))
  check('tidak ada tabel', !doc.querySelector('[data-testid="crm-table"]'))
}

// ---------- 5) C: ready ----------
console.log('\n[C] Host mengirim data -> tabel, kontak kosong = "Tidak tersedia"')
{
  const { dom } = mount({ rows: {}, customers: HOST, invoiceCounts: null })
  const doc = dom.window.document
  check('capability = ready', doc.querySelector('[data-testid="crm-root"]').getAttribute('data-capability') === 'ready')
  check('tidak ada panel capability', !doc.querySelector('[data-testid="crm-capability"]'))
  check('tabel tampil', !!doc.querySelector('[data-testid="crm-table"]'))
  check('KPI total = 3', t(doc, 'crm-kpi-total') === '3')
  check('KPI punya kontak = 1', t(doc, 'crm-kpi-contact') === '1')
  check('KPI tanpa kontak = 2', t(doc, 'crm-kpi-nocontact') === '2')

  const row1 = doc.querySelector('[data-testid="crm-row-ibu-sarah"]')
  check('baris host tampil', !!row1)
  check('baris host origin=host', row1 && row1.getAttribute('data-origin') === 'host')
  check('kontak host tampil', /0812-3456-789/.test(row1 ? row1.textContent : ''))

  const row2 = doc.querySelector('[data-testid="crm-row-pak-budi"]')
  check('baris tanpa kontak menulis "Tidak tersedia"', row2 && /Tidak tersedia/.test(row2.textContent))
  check('baris tanpa kontak TIDAK kosong polos', row2 && (row2.textContent || '').trim().length > 'Pak Budi'.length)
  check('sumber kosong juga "Tidak tersedia"', /Tidak tersedia/.test(row2 ? row2.textContent : ''))

  check('relasi invoice "tidak dikirim" (BUKAN 0)', /tidak dikirim ke halaman ini/i.test(t(doc, 'crm-relation-ibu-sarah') || ''))
  check('relasi tidak pernah memuat angka 0 untuk c1', !/Dirujuk di 0/.test(t(doc, 'crm-relation-ibu-sarah') || ''))

  check('baris host: TIDAK ada tombol ubah', !doc.querySelector('[data-testid="crm-edit-ibu-sarah"]'))
  check('baris host: TIDAK ada tombol hapus', !doc.querySelector('[data-testid="crm-delete-ibu-sarah"]'))
  check('baris host bertanda "Baca saja"', /Baca saja/.test(t(doc, 'crm-readonly-ibu-sarah') || ''))
}

// ---------- 6) D: relasi invoice dikirim ----------
console.log('\n[D] Host mengirim invoiceCounts -> relasi tampil')
{
  const { dom } = mount({ rows: {}, customers: HOST, invoiceCounts: { c1: 3, c2: 0 } })
  const doc = dom.window.document
  check('KPI relasi = "Dikirim host"', t(doc, 'crm-kpi-relation') === 'Dikirim host')
  check('relasi c1 = "Dirujuk di 3 invoice"', t(doc, 'crm-relation-ibu-sarah') === 'Dirujuk di 3 invoice')
  check('relasi c2 = 0 rujukan tetap ditulis 0 (dikirim)', t(doc, 'crm-relation-pak-budi') === 'Dirujuk di 0 invoice')
  check('relasi c3 tidak ada di counts -> tidak dikirim', /tidak dikirim ke halaman ini/i.test(t(doc, 'crm-relation-ani-kosong') || ''))
}

// ---------- 7) E: form draft ----------
console.log('\n[E] Form tambah -> draft memori, diberi label "Draf halaman"')
{
  const { dom } = mount({ rows: {}, customers: HOST })
  const doc = dom.window.document

  click(doc.querySelector('[data-testid="crm-add-toggle"]'))
  check('form muncul', !!doc.querySelector('[data-testid="crm-form"]'))
  check('form bertanda "Draf halaman"', /Draf halaman/.test(t(doc, 'crm-form') || ''))

  // submit kosong -> error validasi (event submit pada <form>, bukan klik tombol)
  submit(doc.querySelector('[data-testid="crm-form"]'))
  check('error nama wajib tampil', /Nama customer wajib diisi/.test(t(doc, 'crm-error-name') || ''))
  check('belum ada baris baru', !doc.querySelector('[data-testid="crm-row-ibu-ratna"]'))

  // isi nama + kontak
  const nameInput = doc.querySelector('[data-testid="crm-input-name"]')
  const phoneInput = doc.querySelector('[data-testid="crm-input-phone"]')
  type(nameInput, 'Ibu Ratna')
  type(phoneInput, '0812')
  submit(doc.querySelector('[data-testid="crm-form"]'))
  check('error telepon terlalu pendek', /terlalu pendek/.test(t(doc, 'crm-error-phone') || ''))

  type(phoneInput, '081234567890')
  submit(doc.querySelector('[data-testid="crm-form"]'))

  check('draft muncul di tabel', !!doc.querySelector('[data-testid="crm-row-ibu-ratna"]'))
  const draft = doc.querySelector('[data-testid="crm-row-ibu-ratna"]')
  check('draft bertanda "Draf halaman"', /Draf halaman/.test(draft ? draft.textContent : ''))
  check('draft origin=draft', draft && draft.getAttribute('data-origin') === 'draft')
  check('notice menyebut draf & memori halaman', /draf halaman/i.test(t(doc, 'crm-notice') || '') && /memori halaman/i.test(t(doc, 'crm-notice') || ''), t(doc, 'crm-notice'))
  check('form tertutup setelah submit', !doc.querySelector('[data-testid="crm-form"]'))
  check('KPI total jadi 4', t(doc, 'crm-kpi-total') === '4')

  // draft bisa dihapus
  click(doc.querySelector('[data-testid="crm-delete-ibu-ratna"]'))
  check('draft terhapus dari memori', !doc.querySelector('[data-testid="crm-row-ibu-ratna"]'))
  check('KPI total kembali 3', t(doc, 'crm-kpi-total') === '3')

  // duplikat -> warning, bukan blok
  click(doc.querySelector('[data-testid="crm-add-toggle"]'))
  const n2 = doc.querySelector('[data-testid="crm-input-name"]')
  type(n2, 'Ibu Sarah')
  submit(doc.querySelector('[data-testid="crm-form"]'))
  check('peringatan duplikat muncul', /Data mirip customer/.test(t(doc, 'crm-warnings') || ''), t(doc, 'crm-warnings'))
}

// ---------- 8) F: pencarian ----------
console.log('\n[F] Pencarian & filter')
{
  const { dom } = mount({ rows: {}, customers: HOST })
  const doc = dom.window.document
  const search = doc.querySelector('[data-testid="crm-search"]')
  type(search, 'budi')
  check('cari "budi" -> 1 baris', doc.querySelectorAll('[data-testid^="crm-row-"]').length === 1, String(doc.querySelectorAll('[data-testid^="crm-row-"]').length))
  type(search, '628123456789')
  check('cari lewat nomor 62 menemukan baris', doc.querySelector('[data-testid="crm-row-ibu-sarah"]') !== null,
    String(doc.querySelectorAll('[data-testid^="crm-row-"]').length))
  type(search, '08123456789')
  check('cari format 0 & 62 hasil sama', doc.querySelectorAll('[data-testid^="crm-row-"]').length === 1)
  type(search, 'zzz')
  check('pencarian tanpa hasil -> empty state', /tidak ada customer yang cocok/i.test(t(doc, 'crm-empty') || ''), t(doc, 'crm-empty'))
}

// ---------- 9) G: drawer ----------
console.log('\n[G] Drawer detail')
{
  const { dom } = mount({ rows: {}, customers: HOST })
  const doc = dom.window.document
  click(doc.querySelector('[data-testid="crm-row-ibu-sarah"]'))
  check('drawer terbuka', !!doc.querySelector('[data-testid="crm-drawer"]'))
  check('drawer menampilkan nama', /Ibu Sarah/.test(t(doc, 'crm-drawer') || ''))
  check('drawer menampilkan relasi', /tidak dikirim/i.test(t(doc, 'crm-drawer-relation') || ''))
  click(doc.querySelector('[data-testid="crm-row-pak-budi"]'))
  check('drawer baris tanpa kontak menulis "Tidak tersedia"',
    /Tidak tersedia/.test(t(doc, 'crm-drawer') || ''))
  click(doc.querySelector('[data-testid="crm-drawer-close"]'))
  check('drawer tertutup', !doc.querySelector('[data-testid="crm-drawer"]'))
}

// ---------- 12) H: tanpa penulisan DB ----------
console.log('\n[H] Tidak ada penulisan DB / localStorage')
const fsMod = await import('node:fs')
{
  let fetchCalls = 0
  let xhrCalls = 0
  let lsCalls = 0
  // localStorage hanya boleh muncul di KOMENTAR, bukan sebagai pemanggilan
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const src2 = fsMod.readFileSync(path.join(REPO, 'modules/crm/view.jsx'), 'utf8')
  const l2 = fsMod.readFileSync(path.join(REPO, 'modules/crm/logic.js'), 'utf8')
  const srcCode2 = stripComments(src2)
  const lCode2 = stripComments(l2)
  check('view tidak memakai localStorage (kode)', !/localStorage/.test(srcCode2))
  check('logic tidak memakai localStorage (kode)', !/localStorage/.test(lCode2))
  check('view tidak memanggil fetch', !/\bfetch\s*\(/.test(srcCode2))
  check('view tidak memanggil supabase', !/supabase/.test(srcCode2))
  check('view tidak membuat tabel/insert/update', !/\.from\(|\.insert\(|\.update\(|CREATE TABLE/.test(srcCode2))
  check('view tidak membuat URL api', !/\/api\//.test(srcCode2))
  check('logic tidak memanggil fetch/supabase', !/fetch\s*\(|supabase|\.from\(/.test(lCode2))
  const s = fsMod.readFileSync(path.join(REPO, 'modules/crm/selector.jsx'), 'utf8')
  const sCode = stripComments(s)
  check('selector tidak memanggil fetch/supabase', !/fetch\s*\(|supabase|localStorage|\.from\(/.test(sCode))

  // jalankan render interaksi penuh dan pastikan tidak ada efek jaringan/storage
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
  global.window = dom.window
  global.document = dom.window.document
  global.fetch = () => { fetchCalls++; return Promise.resolve({}) }
  global.XMLHttpRequest = function () { xhrCalls++; this.open = () => {}; this.send = () => {} }
  global.localStorage = {
    getItem() { lsCalls++; return null },
    setItem() { lsCalls++ },
    removeItem() { lsCalls++ }
  }
  const root = createRoot(document.getElementById('app'))
  flushSync(() => root.render(React.createElement(CrmModule, { rows: {}, customers: HOST })))
  const d = global.document
  click(d.querySelector('[data-testid="crm-add-toggle"]'))
  const n = d.querySelector('[data-testid="crm-input-name"]')
  type(n, 'Tes Jaringan')
  submit(d.querySelector('[data-testid="crm-form"]'))
  click(d.querySelector('[data-testid="crm-row-ibu-sarah"]'))
  check('render + interaksi: 0 panggilan fetch', fetchCalls === 0, String(fetchCalls))
  check('render + interaksi: 0 panggilan XHR', xhrCalls === 0, String(xhrCalls))
  check('render + interaksi: 0 akses localStorage', lsCalls === 0, String(lsCalls))
}

// ---------- 11) I: CSV ----------
console.log('\n[I] Unduh CSV')
{
  const { dom } = mount({ rows: {}, customers: HOST })
  const doc = dom.window.document
  let downloaded = null
  // downloadCsv membuat <a> baru lalu click() — intersep lewat
  // HTMLAnchorElement.prototype.click supaya terlihat di harness.
  const proto = dom.window.HTMLAnchorElement.prototype
  const origClick = proto.click
  proto.click = function () { downloaded = this.download }
  click(doc.querySelector('[data-testid="crm-csv"]'))
  proto.click = origClick
  check('nama file csv ditentukan', downloaded === 'customer-crm.csv', String(downloaded))
  check('tombol CSV aktif saat ada data', doc.querySelector('[data-testid="crm-csv"]').disabled === false)
}

// ---------- 12) J: selector ----------
console.log('\n[J] Selector reusable — contoh di halaman')
{
  const { dom } = mount({ rows: {}, customers: HOST })
  const doc = dom.window.document
  check('contoh selector tampil', !!doc.querySelector('[data-testid="crm-selector-demo"]'))
  const sel = doc.querySelector('[data-testid="crm-selector-demo-input"]')
  check('selector disabled (hanya contoh)', sel && sel.disabled === true)
  check('selector berisi opsi dari data asli', sel && sel.options.length === 3, sel && String(sel.options.length))
  check('tidak ada opsi "Pilih customer…" tanpa data', sel && sel.options[0].textContent.indexOf('Ibu Sarah') === 0)
}

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
