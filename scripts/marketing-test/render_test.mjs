// ============================================================
// UJI RENDER — modules/marketing/view.jsx (t_31a1a9f9)
// Merender komponen ASLI (hasil transform esbuild di dist/) dengan
// jsdom INTERAKTIF (createRoot), lalu memeriksa DOM:
//   A) Capability: host tidak mengirim lead -> panel "belum tersedia",
//      BUKAN papan kosong yang terlihat seperti bug.
//   B) Host mengirim [] -> "Belum ada lead terdata" (kasus lain).
//   C) Host mengirim data -> papan tahap tampil; tahap yang tidak
//      dikenali masuk ember "Tahap tidak diketahui", BUKAN New Lead.
//   D) Nilai kosong jujur: sumber/kampanye "Tidak tersedia", aksi
//      berikutnya "Belum ada aksi berikutnya" (bukan sel kosong).
//   E) Tanggal aksi lewat ditandai "Terlambat"; tanpa tanggal = none.
//   F) Tautan CRM 4 keadaan; data CRM tidak dikirim = "tidak dikirim",
//      BUKAN "tidak ditemukan".
//   G) Form tambah: draft muncul dengan label "Draf halaman"; baris
//      host TIDAK punya tombol ubah/hapus (baca saja).
//   H) Tidak ada penulisan DB: 0 fetch/XHR/localStorage saat render +
//      interaksi penuh.
//   I) CSV bisa diunduh.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fsMod from 'node:fs'

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
const MarketingModule = (await import(pathToFileURL(path.join(SB, 'dist/modules/marketing/view.mjs')).href)).default

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
  flushSync(() => root.render(React.createElement(MarketingModule, props)))
  return { dom, root }
}

const t = (doc, id) => {
  const el = doc.querySelector(`[data-testid="${id}"]`)
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null
}
const click = (el) => flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true })))
const submit = (form) => flushSync(() => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))

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
function pick(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(el, value)
  flushSync(() => el.dispatchEvent(new window.Event('change', { bubbles: true })))
}

const HOST = [
  { id: 'l1', name: 'Ibu Sarah', stage: 'new_lead', source: 'Instagram', campaign: 'Promo Lebaran', next_action: 'Kirim penawaran', next_action_date: '2026-10-20', customer_id: 'c1', notes: 'Butuh 3 lemari' },
  { id: 'l2', name: 'Pak Budi', stage: 'qualified', source: 'Referral', campaign: '', next_action: '', next_action_date: '', customer_id: '' },
  { id: 'l3', name: 'Ani', stage: 'negoriasi', source: '', campaign: 'Promo Lebaran' }
]
const CRM = [{ id: 'c1', name: 'Ibu Sarah' }]

// ---------- 3) A: capability unavailable ----------
console.log('\n[A] Host tidak mengirim lead -> panel kemampuan, bukan papan kosong')
{
  const { dom } = mount({ rows: {}, leads: undefined, customers: undefined })
  const doc = dom.window.document
  check('root tampil', !!doc.querySelector('[data-testid="mk-root"]'))
  check('capability = unavailable', doc.querySelector('[data-testid="mk-root"]').getAttribute('data-capability') === 'unavailable')
  check('panel kemampuan tampil', !!doc.querySelector('[data-testid="mk-capability"]'))
  check('judul menyebut tabel lead belum tersedia', /belum tersedia/i.test(t(doc, 'mk-capability-title') || ''))
  check('teks menyebut tidak ada lead contoh', /tidak ada lead contoh/i.test(t(doc, 'mk-root') || ''))
  check('tidak ada papan', !doc.querySelector('[data-testid="mk-board"]'))
  check('empty state menyebut sumber belum tersedia', /Sumber lead belum tersedia/.test(t(doc, 'mk-empty') || ''))
  check('KPI total = 0', t(doc, 'mk-kpi-total') === '0')
  check('tombol CSV disabled', doc.querySelector('[data-testid="mk-csv"]').disabled === true)
  check('contoh selector menulis data CRM tidak dikirim', /tidak dikirim/.test(t(doc, 'mk-selector-demo-input') || ''))
}

// ---------- 4) B: capability empty ----------
console.log('\n[B] Host mengirim [] -> "Belum ada lead terdata"')
{
  const { dom } = mount({ rows: {}, leads: [] })
  const doc = dom.window.document
  check('capability = empty', doc.querySelector('[data-testid="mk-root"]').getAttribute('data-capability') === 'empty')
  check('judul "Belum ada lead terdata"', t(doc, 'mk-capability-title') === 'Belum ada lead terdata')
  check('empty state memakai label yang sama', /Belum ada lead terdata/.test(t(doc, 'mk-empty') || ''))
  check('tidak ada papan', !doc.querySelector('[data-testid="mk-board"]'))
}

// ---------- 5) C: ready + tahap asing ----------
console.log('\n[C] Host mengirim data -> papan tahap; tahap asing di ember sendiri')
{
  const { dom } = mount({ rows: {}, leads: HOST, customers: undefined, today: '2026-10-18' })
  const doc = dom.window.document
  check('capability = ready', doc.querySelector('[data-testid="mk-root"]').getAttribute('data-capability') === 'ready')
  check('tidak ada panel capability', !doc.querySelector('[data-testid="mk-capability"]'))
  check('papan tampil', !!doc.querySelector('[data-testid="mk-board"]'))
  check('KPI total = 3', t(doc, 'mk-kpi-total') === '3')
  check('KPI terbuka = 2 (new_lead + qualified)', t(doc, 'mk-kpi-open') === '2', t(doc, 'mk-kpi-open'))
  check('KPI won/lost = "0 / 0"', t(doc, 'mk-kpi-wonlost') === '0 / 0')

  check('5 ember tahap sah tampil', ['new_lead', 'qualified', 'rab', 'won', 'lost'].every(k => !!doc.querySelector(`[data-testid="mk-column-${k}"]`)))
  check('ember tahap asing tampil', !!doc.querySelector('[data-testid="mk-column-unknown"]'))

  check('Sarah di ember new_lead', doc.querySelector('[data-testid="mk-card-ibu-sarah"]')?.getAttribute('data-stage') === 'new_lead')
  check('Budi di ember qualified', doc.querySelector('[data-testid="mk-card-pak-budi"]')?.getAttribute('data-stage') === 'qualified')
  check('Ani (tahap asing) di ember unknown', doc.querySelector('[data-testid="mk-card-ani"]')?.getAttribute('data-stage') === 'unknown',
    String(doc.querySelector('[data-testid="mk-card-ani"]')?.getAttribute('data-stage')))
  check('Ani TIDAK dipaksa ke New Lead', doc.querySelector('[data-testid="mk-column-new_lead"]')?.textContent.indexOf('Ani') === -1)
  check('ember new_lead hitung 1 (bukan 2)', t(doc, 'mk-count-new_lead') === '1', t(doc, 'mk-count-new_lead'))
  check('ember unknown hitung 1', t(doc, 'mk-count-unknown') === '1', t(doc, 'mk-count-unknown'))
  check('catatan ember asing tampil', /tidak dikenali/i.test(doc.querySelector('[data-testid="mk-column-unknown"]')?.textContent || ''))
}

// ---------- 6) D: nilai kosong jujur ----------
console.log('\n[D] Nilai kosong ditulis jujur, bukan dibiarkan kosong')
{
  const { dom } = mount({ rows: {}, leads: HOST, today: '2026-10-18' })
  const doc = dom.window.document
  check('kartu Budi: sumber "Tidak tersedia"', /Tidak tersedia/.test(t(doc, 'mk-card-pak-budi') || ''))
  check('kartu Budi: aksi berikutnya "Belum ada aksi berikutnya"', /Belum ada aksi berikutnya/.test(t(doc, 'mk-action-pak-budi') || ''), t(doc, 'mk-action-pak-budi'))
  check('kartu Budi: tanpa tanda Terlambat (tidak ada tanggal)', !/Terlambat/.test(t(doc, 'mk-card-pak-budi') || ''))
  check('kartu Sarah: aksi berikutnya tampil', t(doc, 'mk-action-ibu-sarah') === 'Kirim penawaran Terjadwal · 20 Okt 2026', t(doc, 'mk-action-ibu-sarah'))
}

// ---------- 7) E: tanggal terlambat ----------
console.log('\n[E] Tanggal aksi yang lewat ditandai "Terlambat"')
{
  const late = [{ id: 'x1', name: 'Lead Telat', stage: 'qualified', next_action: 'Telpon', next_action_date: '2026-10-01' }]
  const { dom } = mount({ rows: {}, leads: late, today: '2026-10-18' })
  const doc = dom.window.document
  check('kartu bertanda Terlambat', /Terlambat/.test(t(doc, 'mk-card-lead-telat') || ''), t(doc, 'mk-card-lead-telat'))
  check('tanggal tetap ditulis "1 Okt 2026"', /1 Okt 2026/.test(t(doc, 'mk-card-lead-telat') || ''))
  check('KPI aksi terlambat = 1', t(doc, 'mk-kpi-overdue') === '1', t(doc, 'mk-kpi-overdue'))
}

// ---------- 8) F: tautan CRM 4 keadaan ----------
console.log('\n[F] Tautan CRM — "tidak dikirim" BUKAN "tidak ditemukan"')
{
  // linked + unresolved
  const rowsF = [
    { id: 'f1', name: 'Lead Linked', stage: 'new_lead', customer_id: 'c1' },
    { id: 'f2', name: 'Lead Gagal', stage: 'new_lead', customer_id: 'c9' }
  ]
  const { dom } = mount({ rows: {}, leads: rowsF, customers: CRM })
  const doc = dom.window.document
  check('linked: menampilkan nama customer', /Ibu Sarah/.test(t(doc, 'mk-link-lead-linked') || ''), t(doc, 'mk-link-lead-linked'))
  check('kartu linked data-link=linked', doc.querySelector('[data-testid="mk-card-lead-linked"]')?.getAttribute('data-link') === 'linked')
  check('unresolved: menyebut tidak ditemukan di data CRM', /tidak ditemukan di data CRM/.test(t(doc, 'mk-link-lead-gagal') || ''), t(doc, 'mk-link-lead-gagal'))
}
{
  // unknown — host tidak mengirim data CRM sama sekali
  const rowsG = [{ id: 'g1', name: 'Lead Tanpa CRM', stage: 'new_lead', customer_id: 'c1' }]
  const { dom } = mount({ rows: {}, leads: rowsG, customers: undefined })
  const doc = dom.window.document
  check('unknown: teks "Data customer CRM tidak dikirim ke halaman ini"', t(doc, 'mk-link-lead-tanpa-crm') === 'Data customer CRM tidak dikirim ke halaman ini', t(doc, 'mk-link-lead-tanpa-crm'))
  check('unknown: TIDAK memuat kata "tidak ditemukan"', !/tidak ditemukan/.test(t(doc, 'mk-link-lead-tanpa-crm') || ''))
}
{
  // missing — customer_id kosong, lebih spesifik dari unknown
  const rowsH = [{ id: 'h1', name: 'Lead Belum Taut', stage: 'new_lead', customer_id: '' }]
  const { dom } = mount({ rows: {}, leads: rowsH, customers: undefined })
  const doc = dom.window.document
  check('missing: "Belum ditautkan ke CRM"', t(doc, 'mk-link-lead-belum-taut') === 'Belum ditautkan ke CRM', t(doc, 'mk-link-lead-belum-taut'))
}

// ---------- 9) G: form draft ----------
console.log('\n[G] Form tambah -> draf memori, label "Draf halaman"')
{
  const { dom } = mount({ rows: {}, leads: HOST, customers: CRM, today: '2026-10-18' })
  const doc = dom.window.document

  click(doc.querySelector('[data-testid="mk-add-toggle"]'))
  check('form muncul', !!doc.querySelector('[data-testid="mk-form"]'))
  check('form bertanda "Draf halaman"', /Draf halaman/.test(t(doc, 'mk-form') || ''))

  submit(doc.querySelector('[data-testid="mk-form"]'))
  check('error nama wajib tampil', /Nama lead wajib diisi/.test(t(doc, 'mk-error-name') || ''))
  check('belum ada baris baru', !doc.querySelector('[data-testid="mk-card-ibu-ratna"]'))

  // tahap asing ditolak, tidak dibuang diam-diam
  const nameInput = doc.querySelector('[data-testid="mk-input-name"]')
  const stageInput = doc.querySelector('[data-testid="mk-input-stage"]')
  type(nameInput, 'Ibu Ratna')
  pick(stageInput, '')
  submit(doc.querySelector('[data-testid="mk-form"]'))
  check('tahap kosong diterima (default New Lead)', !!doc.querySelector('[data-testid="mk-card-ibu-ratna"]'))

  const draft = doc.querySelector('[data-testid="mk-card-ibu-ratna"]')
  check('draft origin=draft', draft && draft.getAttribute('data-origin') === 'draft')
  check('draf bertanda "Draf halaman"', /Draf halaman/.test(draft ? draft.textContent : ''))
  check('draf ada tombol hapus', !!doc.querySelector('[data-testid="mk-delete-ibu-ratna"]'))
  check('notice menyebut memori halaman & dimuat ulang', /memori halaman/.test(t(doc, 'mk-notice') || '') && /dimuat ulang/.test(t(doc, 'mk-notice') || ''), t(doc, 'mk-notice'))
  check('form tertutup setelah submit', !doc.querySelector('[data-testid="mk-form"]'))
  check('KPI total jadi 4', t(doc, 'mk-kpi-total') === '4')

  // baris host baca saja
  check('baris host: TIDAK ada tombol ubah', !doc.querySelector('[data-testid="mk-edit-ibu-sarah"]'))
  check('baris host: TIDAK ada tombol hapus', !doc.querySelector('[data-testid="mk-delete-ibu-sarah"]'))
  check('baris host bertanda "Baca saja"', /Baca saja/.test(t(doc, 'mk-readonly-ibu-sarah') || ''))

  // duplikat -> warning, bukan blok
  click(doc.querySelector('[data-testid="mk-add-toggle"]'))
  const n2 = doc.querySelector('[data-testid="mk-input-name"]')
  type(n2, 'ibu sarah')
  submit(doc.querySelector('[data-testid="mk-form"]'))
  check('peringatan duplikat muncul', /Data mirip lead/.test(t(doc, 'mk-warnings') || ''), t(doc, 'mk-warnings'))
  check('draf duplikat tetap dibuat (peringatan, bukan blok)', t(doc, 'mk-kpi-total') === '5')
  // dua kartu bernama sama tetap punya data-testid berbeda
  check('kartu bernama sama tetap bisa dibedakan', doc.querySelectorAll('[data-testid^="mk-card-ibu-sarah"]').length === 2,
    String(doc.querySelectorAll('[data-testid^="mk-card-ibu-sarah"]').length))

  // hapus draf
  click(doc.querySelector('[data-testid="mk-delete-ibu-ratna"]'))
  check('draf terhapus dari memori', !doc.querySelector('[data-testid="mk-card-ibu-ratna"]'))
  check('KPI total 4 (sisa 1 lead host sarah + draf duplikat + 2 host lain)',
    t(doc, 'mk-kpi-total') === '4', t(doc, 'mk-kpi-total'))
  check('dua kartu bernama ibu sarah tetap terpisah & bisa dibedakan',
    doc.querySelectorAll('[data-testid^="mk-card-ibu-sarah"]').length === 2,
    String(doc.querySelectorAll('[data-testid^="mk-card-ibu-sarah"]').length))
  // pastikan kartu draf (yang punya tombol hapus) berbeda dari kartu host
  const sarahDels = doc.querySelectorAll('[data-testid^="mk-delete-ibu-sarah"]').length
  const sarahReadonly = doc.querySelectorAll('[data-testid^="mk-readonly-ibu-sarah"]').length
  check('salah satu kartu ibu sarah = host (baca saja), satu lagi = draf',
    sarahDels === 1 && sarahReadonly === 1, `del=${sarahDels} ro=${sarahReadonly}`)
}

// ---------- 10) H: filter & pencarian ----------
console.log('\n[H] Pencarian & filter')
{
  const { dom } = mount({ rows: {}, leads: HOST, customers: CRM, today: '2026-10-18' })
  const doc = dom.window.document
  const search = doc.querySelector('[data-testid="mk-search"]')
  type(search, 'budi')
  check('cari "budi" -> 1 kartu', doc.querySelectorAll('[data-testid^="mk-card-"]').length === 1, String(doc.querySelectorAll('[data-testid^="mk-card-"]').length))
  type(search, 'zzz')
  check('tanpa hasil -> empty state filter', /cocok dengan filter/i.test(t(doc, 'mk-empty') || ''), t(doc, 'mk-empty'))

  type(search, '')
  pick(doc.querySelector('[data-testid="mk-filter-stage"]'), 'unknown')
  check('filter tahap asing -> hanya Ani', doc.querySelectorAll('[data-testid^="mk-card-"]').length === 1 &&
    doc.querySelector('[data-testid^="mk-card-"]')?.getAttribute('data-stage') === 'unknown')

  pick(doc.querySelector('[data-testid="mk-filter-stage"]'), 'all')
  pick(doc.querySelector('[data-testid="mk-filter-source"]'), 'Referral')
  check('filter sumber Referral -> hanya Budi', doc.querySelectorAll('[data-testid^="mk-card-"]').length === 1 &&
    /Pak Budi/.test(doc.querySelector('[data-testid^="mk-card-"]')?.textContent || ''))

  pick(doc.querySelector('[data-testid="mk-filter-source"]'), 'all')
  pick(doc.querySelector('[data-testid="mk-filter-campaign"]'), 'Promo Lebaran')
  check('filter kampanye -> 2 kartu', doc.querySelectorAll('[data-testid^="mk-card-"]').length === 2, String(doc.querySelectorAll('[data-testid^="mk-card-"]').length))
}

// ---------- 11) I: drawer ----------
console.log('\n[I] Drawer detail — sumber tiap nilai')
{
  const { dom } = mount({ rows: {}, leads: HOST, customers: CRM, today: '2026-10-18' })
  const doc = dom.window.document
  click(doc.querySelector('[data-testid="mk-card-ibu-sarah"]'))
  check('drawer terbuka', !!doc.querySelector('[data-testid="mk-drawer"]'))
  check('drawer menampilkan nama', /Ibu Sarah/.test(t(doc, 'mk-drawer') || ''))
  check('drawer menyebut sumber lead', /Instagram/.test(t(doc, 'mk-drawer-source') || ''))
  check('drawer menandai nilai ada data-present=yes', doc.querySelector('[data-testid="mk-drawer-source"]')?.getAttribute('data-present') === 'yes')
  check('drawer menyebut kampanye', /Promo Lebaran/.test(t(doc, 'mk-drawer-campaign') || ''))
  check('drawer menandai kampanye ada data-present=yes', doc.querySelector('[data-testid="mk-drawer-campaign"]')?.getAttribute('data-present') === 'yes')
  check('drawer aksi berikutnya tampil', t(doc, 'mk-drawer-next_action') === 'Kirim penawaran')
  check('drawer tanggal aksi ditulis', t(doc, 'mk-drawer-next_action_date') === '20 Okt 2026')

  // Ani: sumber KOSONG -> label jujur, bukan sel kosong
  click(doc.querySelector('[data-testid="mk-card-ani"]'))
  check('drawer baris tanpa sumber menulis "Tidak tersedia"', t(doc, 'mk-drawer-source') === 'Tidak tersedia', t(doc, 'mk-drawer-source'))
  check('drawer baris tanpa sumber data-present=no', doc.querySelector('[data-testid="mk-drawer-source"]')?.getAttribute('data-present') === 'no')

  // Pak Budi: aksi & tautan CRM kosong
  click(doc.querySelector('[data-testid="mk-card-pak-budi"]'))
  check('drawer aksi berikutnya "Belum ada aksi berikutnya"', t(doc, 'mk-drawer-next_action') === 'Belum ada aksi berikutnya', t(doc, 'mk-drawer-next_action'))
  check('drawer tautan CRM "Belum ditautkan ke CRM"', t(doc, 'mk-drawer-link') === 'Belum ditautkan ke CRM', t(doc, 'mk-drawer-link'))

  click(doc.querySelector('[data-testid="mk-drawer-close"]'))
  check('drawer tertutup', !doc.querySelector('[data-testid="mk-drawer"]'))
}

// ---------- 12) J: tanpa penulisan DB ----------
console.log('\n[J] Tidak ada penulisan DB / localStorage / jaringan')
{
  let fetchCalls = 0
  let xhrCalls = 0
  let lsCalls = 0
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const srcCode = stripComments(fsMod.readFileSync(path.join(REPO, 'modules/marketing/view.jsx'), 'utf8'))
  const lCode = stripComments(fsMod.readFileSync(path.join(REPO, 'modules/marketing/logic.js'), 'utf8'))
  check('view tidak memakai localStorage (kode)', !/localStorage/.test(srcCode))
  check('logic tidak memakai localStorage (kode)', !/localStorage/.test(lCode))
  check('view tidak memanggil fetch', !/\bfetch\s*\(/.test(srcCode))
  check('view tidak memanggil supabase', !/supabase/.test(srcCode))
  check('view tidak membuat tabel/insert/update', !/\.from\(|\.insert\(|\.update\(|CREATE TABLE/.test(srcCode))
  check('view tidak membuat URL api', !/\/api\//.test(srcCode))
  check('logic tidak memanggil fetch/supabase', !/fetch\s*\(|supabase|\.from\(/.test(lCode))
  check('logic tidak membuat tabel', !/CREATE TABLE|create table/.test(lCode))

  // render + interaksi penuh, hitung efek jaringan/storage
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
  flushSync(() => root.render(React.createElement(MarketingModule, { rows: {}, leads: HOST, customers: CRM, today: '2026-10-18' })))
  const d = global.document
  click(d.querySelector('[data-testid="mk-add-toggle"]'))
  const n = d.querySelector('[data-testid="mk-input-name"]')
  type(n, 'Tes Jaringan')
  submit(d.querySelector('[data-testid="mk-form"]'))
  click(d.querySelector('[data-testid="mk-card-ibu-sarah"]'))
  check('render + interaksi: 0 panggilan fetch', fetchCalls === 0, String(fetchCalls))
  check('render + interaksi: 0 panggilan XHR', xhrCalls === 0, String(xhrCalls))
  check('render + interaksi: 0 akses localStorage', lsCalls === 0, String(lsCalls))
}

// ---------- 13) K: CSV ----------
console.log('\n[K] Unduh CSV')
{
  const { dom } = mount({ rows: {}, leads: HOST, customers: CRM, today: '2026-10-18' })
  const doc = dom.window.document
  let downloaded = null
  const proto = dom.window.HTMLAnchorElement.prototype
  const origClick = proto.click
  proto.click = function () { downloaded = this.download }
  click(doc.querySelector('[data-testid="mk-csv"]'))
  proto.click = origClick
  check('nama file csv ditentukan', downloaded === 'marketing-leads.csv', String(downloaded))
  check('tombol CSV aktif saat ada data', doc.querySelector('[data-testid="mk-csv"]').disabled === false)
}

// ---------- 14) L: batasan ditulis di halaman ----------
console.log('\n[L] Batasan modul ditulis di halaman, bukan disembunyikan')
{
  const { dom } = mount({ rows: {}, leads: [] })
  const doc = dom.window.document
  const lim = t(doc, 'mk-limitations') || ''
  check('panel batasan tampil', !!doc.querySelector('[data-testid="mk-limitations"]'))
  check('menyebut tidak ada penulisan ke database', /penulisan ke database/i.test(lim))
  check('menyebut lead baru hanya draf memori halaman', /draf di memori halaman/i.test(lim))
  check('menyebut tahap tidak dikenali tidak dipaksa New Lead', /tidak dipaksa masuk New Lead/i.test(lim))
  check('menyebut tidak ada lead contoh', /tidak ada lead contoh/i.test(lim))
}

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
