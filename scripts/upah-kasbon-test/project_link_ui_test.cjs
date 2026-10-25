// ============================================================
// scripts/upah-kasbon-test/project_link_ui_test.cjs
// Uji UI Project ID pada prototipe Upah & Kasbon (public/upah-kasbon-prototype.html).
// Menjalankan HTML ASLI di jsdom, tanpa Supabase/network.
//
// Yang diuji (sesuai scope tiket):
//   1) SELECTOR Project ID tampil di form tambah/edit proyek dan memuat
//      kode/ID + nama + status dari master `projects`.
//   2) PERSIST setelah edit: pilih Project ID -> Simpan -> state & localStorage
//      menyimpan projectId, dan tetap ada setelah load ulang.
//   3) PROYEK TANPA LINK: ditandai "Belum terhubung", TIDAK ditebak otomatis
//      walau namanya sama persis dengan proyek master.
//   4) Daftar master gagal dimuat: tautan lama tidak hilang.
// ============================================================
const fs = require('fs')
const path = require('path')
const { JSDOM, VirtualConsole } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const root = path.resolve(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'public/upah-kasbon-prototype.html'), 'utf8')

const MASTER = [
  { id: 'PRJ-83', kode: '83', code: '83', name: 'Josh - Mabes', status: 'DONE' },
  { id: 'PRJ-99', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING' },
  { id: 'PRJ-100', kode: '100', code: '100', name: 'Citizen East', status: 'NOT_START' }
]

const fixture = {
  version: 2,
  activeKey: 'pujon',
  tukangs: [{
    key: 'pujon', name: 'Pujon', unit: 'Noir Living', seq: 1, idCounter: 0,
    projects: [
      { id: 'p-linked', name: 'Proyek Josh - Mabes', projectId: 'PRJ-83', status: 'Selesai' },
      { id: 'p-old', name: 'Proyek Lama Tanpa Nomor', status: 'On Going' },
      // Nama PERSIS sama dengan master, tetapi TIDAK boleh otomatis tertaut.
      { id: 'p-samename', name: 'Josh - Mabes', status: 'On Going' }
    ],
    upahItems: [], kasbon: [], totalans: [], projectOverrides: {}
  }]
}

let pass = 0, fail = 0
function check(name, condition, detail) {
  if (condition) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

function boot(extraMaster) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', e => errors.push(e.message))
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole,
    beforeParse(w) { if (extraMaster) w.__UPAH_MASTER_PROJECTS__ = extraMaster }
  })
  const w = dom.window
  w.confirm = () => true
  w.alert = () => {}
  return { w, errors }
}
function projects(w) { return JSON.parse(w.eval('JSON.stringify(D().projects)')) }
function projectById(w, id) { return projects(w).find(p => p.id === id) }
function rowTexts(w, selector) { return [...w.document.querySelectorAll(selector)].map(el => el.textContent) }
function submitProyek(w) {
  w.document.getElementById('formProyek').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }))
}
function pickProject(w, value) {
  const sel = w.document.getElementById('pProjectId')
  sel.value = value
  sel.dispatchEvent(new w.Event('change', { bubbles: true }))
  return sel
}

// ============================================================
const { w, errors } = boot(MASTER)
w.eval('state = ' + JSON.stringify(fixture) + '; render()')

console.log('1. Selector Project ID memuat kode/ID + nama + status master')
{
  const sel = w.document.getElementById('pProjectId')
  check('select #pProjectId ada di form proyek', !!sel)
  const opts = [...sel.options]
  check('opsi pertama = "Belum terhubung" (value kosong)', opts[0].value === '' && /Belum terhubung/.test(opts[0].textContent), opts[0] && opts[0].textContent)
  check('master ber-kode 83 tampil: [83] Josh - Mabes — Done', opts.some(o => o.value === 'PRJ-83' && /\[83\] Josh - Mabes — Done/.test(o.textContent)))
  check('master ber-kode 100 tampil dengan status Belum mulai', opts.some(o => o.value === 'PRJ-100' && /\[100\] Citizen East — Belum mulai/.test(o.textContent)))
  check('master ber-kode 99 tampil: [99] Baroni — On Going', opts.some(o => o.value === 'PRJ-99' && /\[99\] Baroni — On Going/.test(o.textContent)))
}

console.log('\n2. List proyek menandai tautan & "Belum terhubung"')
{
  const rows = rowTexts(w, '#proyekTableWrap tr')
  const linked = rows.find(t => t.includes('Proyek Josh - Mabes'))
  const old = rows.find(t => t.includes('Proyek Lama Tanpa Nomor'))
  const sameName = rows.find(t => t.includes('Josh - Mabes') && t.includes('Belum terhubung'))
  check('baris proyek tertaut menampilkan [83] Josh - Mabes · Done', !!linked && /\[83\] Josh - Mabes · Done/.test(linked), linked)
  check('baris proyek tanpa link menampilkan "Belum terhubung"', !!old && /Belum terhubung/.test(old), old)
  check('nama sama dengan master TETAP "Belum terhubung" (tanpa tebak nama)', !!sameName, sameName)
  const note = w.document.querySelector('#proyekTableWrap .note')
  check('ringkasan menyebut 2 proyek belum terhubung', !!note && /2 proyek Belum terhubung/.test(note.textContent), note && note.textContent)
}

console.log('\n3. Edit proyek: pilih Project ID lalu simpan (persist)')
{
  w.document.querySelector('[data-edit-proyek="p-old"]').click()
  check('form masuk mode edit (tombol = Simpan Perubahan)', w.document.getElementById('pSubmit').textContent === 'Simpan Perubahan')
  check('nama proyek terisi saat edit', w.document.getElementById('pName').value === 'Proyek Lama Tanpa Nomor')
  check('select menampilkan tautan saat ini (kosong = belum terhubung)', w.document.getElementById('pProjectId').value === '')

  pickProject(w, 'PRJ-99')
  check('hint menampilkan ID master setelah memilih', /PRJ-99/.test(w.document.getElementById('pProjectHint').textContent))
  submitProyek(w)

  const p = projectById(w, 'p-old')
  check('state menyimpan projectId = PRJ-99 setelah edit', p && p.projectId === 'PRJ-99', JSON.stringify(p))
  check('project_name tetap snapshot historis (tidak diganti nama master)', p && p.name === 'Proyek Lama Tanpa Nomor', p && p.name)
  const saved = JSON.parse(w.localStorage.getItem('modulUpahKasbon.v2'))
  const savedP = saved.tukangs[0].projects.find(x => x.id === 'p-old')
  check('localStorage menyimpan projectId (persist)', savedP && savedP.projectId === 'PRJ-99', JSON.stringify(savedP))

  // load ulang dari localStorage: projectId harus bertahan
  w.eval('state = loadState(); render()')
  const reloaded = projectById(w, 'p-old')
  check('projectId bertahan setelah load ulang (loadState)', reloaded && reloaded.projectId === 'PRJ-99', JSON.stringify(reloaded))
  const row = rowTexts(w, '#proyekTableWrap tr').find(t => t.includes('Proyek Lama Tanpa Nomor'))
  check('baris berubah menampilkan [99] Baroni · On Going', !!row && /\[99\] Baroni · On Going/.test(row), row)
}

console.log('\n4. Edit proyek yang sudah tertaut: tautan tidak hilang')
{
  w.document.querySelector('[data-edit-proyek="p-linked"]').click()
  check('select terisi tautan lama PRJ-83 saat edit', w.document.getElementById('pProjectId').value === 'PRJ-83')
  submitProyek(w)
  const p = projectById(w, 'p-linked')
  check('projectId PRJ-83 tetap tersimpan setelah edit', p && p.projectId === 'PRJ-83', JSON.stringify(p))
}

console.log('\n4b. Lepas tautan secara eksplisit (Belum terhubung kembali)')
{
  w.document.querySelector('[data-edit-proyek="p-linked"]').click()
  pickProject(w, '')
  submitProyek(w)
  const p = projectById(w, 'p-linked')
  check('projectId menjadi null setelah tautan dilepas', p && p.projectId === null, JSON.stringify(p))
  const row = rowTexts(w, '#proyekTableWrap tr').find(t => t.includes('Proyek Josh - Mabes'))
  check('baris kembali menampilkan "Belum terhubung"', !!row && /Belum terhubung/.test(row), row)
  // kembalikan tautan supaya bagian berikutnya tetap menguji proyek tertaut
  w.document.querySelector('[data-edit-proyek="p-linked"]').click()
  pickProject(w, 'PRJ-83')
  submitProyek(w)
  check('tautan bisa dipasang kembali (PRJ-83)', projectById(w, 'p-linked').projectId === 'PRJ-83')
}

console.log('\n5. Tambah proyek baru dengan Project ID')
{
  w.document.getElementById('pName').value = 'Proyek Baru Intercon'
  w.document.getElementById('pStatus').value = 'On Going'
  pickProject(w, 'PRJ-100')
  submitProyek(w)
  const baru = projects(w).find(p => p.name === 'Proyek Baru Intercon')
  check('proyek baru tersimpan dengan projectId = PRJ-100', baru && baru.projectId === 'PRJ-100', JSON.stringify(baru))
  const row = rowTexts(w, '#proyekTableWrap tr').find(t => t.includes('Proyek Baru Intercon'))
  check('baris proyek baru menampilkan [100] Citizen East', !!row && /\[100\] Citizen East/.test(row), row)
}

console.log('\n6. Proyek tanpa link tidak berubah karena proyek lain diedit')
{
  const p = projectById(w, 'p-samename')
  check('proyek "Josh - Mabes" tetap tanpa projectId (null)', p && (p.projectId === null || p.projectId === undefined), JSON.stringify(p))
  check('tidak ada script error saat boot/render', errors.length === 0, errors.join(' | '))
}

console.log('\n7. Daftar master gagal dimuat: tautan lama tetap utuh')
{
  const { w: w2, errors: errors2 } = boot(null) // tanpa __UPAH_MASTER_PROJECTS__
  w2.eval('state = ' + JSON.stringify(fixture) + '; render()')
  const p = JSON.parse(w2.eval('JSON.stringify(D().projects)')).find(x => x.id === 'p-linked')
  check('projectId tersimpan tetap PRJ-83 walau master tidak termuat', p && p.projectId === 'PRJ-83', JSON.stringify(p))
  const row = rowTexts(w2, '#proyekTableWrap tr').find(t => t.includes('Proyek Josh - Mabes'))
  check('baris menampilkan "Terhubung — master tidak termuat"', !!row && /Terhubung — master tidak termuat/.test(row), row)
  const sel = w2.document.getElementById('pProjectId')
  check('selector tetap ada (hanya opsi "Belum terhubung")', !!sel && sel.options.length === 1)
  check('tidak ada script error pada mode tanpa master', errors2.length === 0, errors2.join(' | '))
}

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
