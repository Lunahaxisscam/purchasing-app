// ============================================================
// scripts/upah-kasbon-test/totalan_kasbon_default_test.cjs
// ============================================================
// Uji DEFAULT pilihan kasbon di form Totalan (arahan DAT 25 Okt 2026):
//   Bagian "Kasbon yang Dipotong di Totalan Ini" harus MULAI KOSONG
//   (semua unselect). User mencentang manual. Setelah disentuh
//   (kasbonPickTouched = true), pilihan mengikuti state user dan tetap
//   bertahan saat form di-render ulang (restore lewat prevK).
//
// Sebelum perubahan, kasbon dengan tanggal <= tanggal totalan otomatis
// tercentang. Fixture di bawah sengaja memuat satu kasbon "masa lalu"
// (2026-01-05) supaya perilaku lama akan langsung menggagalkan tes ini.
// ============================================================
const fs = require('fs')
const path = require('path')
const { JSDOM, VirtualConsole } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const root = path.resolve(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'public', 'upah-kasbon-prototype.html'), 'utf8')
  .replace('<script>\n\'use strict\'', '<input id="fileImport" type="file" hidden>\n<script>\n\'use strict\'')

const scriptErrors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', e => scriptErrors.push(e.message))

let lulus = 0, gagal = 0
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  ✓ ' + nama) }
  else { gagal++; console.log('  ✗ ' + nama + (detail ? ' -> ' + detail : '')) }
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole
})
const w = dom.window
w.confirm = () => true

// Fixture: 1 proyek siap totalan + 2 kasbon belum terpotong.
// k1 = masa lalu (<= hari ini), k2 = masa depan. Perilaku lama hanya
// mencentang k1; perilaku baru = keduanya kosong.
w.eval('state = ' + JSON.stringify({
  version: 2, activeKey: 'budi', tukangs: [{
    key: 'budi', name: 'Budi', unit: 'Noir Living', seq: 0, idCounter: 0,
    projects: [{ id: 'p1', name: 'Proyek Satu', status: 'Selesai' }],
    upahItems: [{ id: 'u1', projectId: 'p1', pekerjaan: 'Kabinet', upahRincian: 1000000 }],
    kasbon: [
      { id: 'k1', tanggal: '2026-01-05', jenis: 'Kasbon', deskripsi: 'Kasbon lama', nominal: 200000 },
      { id: 'k2', tanggal: '2026-12-20', jenis: 'Kasbon', deskripsi: 'Kasbon baru', nominal: 150000 }
    ],
    totalans: [], projectOverrides: { p1: 1000000 }
  }]
}) + '; render()')

const doc = w.document
const kbBox = doc.getElementById('tKasbon')
const boxes = () => [...kbBox.querySelectorAll('input[type=checkbox]')]
const checked = () => boxes().filter(c => c.checked).map(c => c.value)
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }))

console.log('Default pilihan kasbon di form Totalan:')

cek('daftar kasbon form totalan terender (2 kasbon)', boxes().length === 2,
  'jumlah: ' + boxes().length)
cek('DEFAULT: tidak ada kasbon tercentang', checked().length === 0,
  'tercentang: ' + JSON.stringify(checked()))
cek('DEFAULT: kasbon bertanggal lampau (k1) ada di daftar tapi TIDAK tercentang',
  boxes().some(c => c.value === 'k1') && !boxes().find(c => c.value === 'k1').checked)
cek('DEFAULT: pratinjau "Kasbon Dipotong" = Rp0',
  (doc.getElementById('pvKasbon').textContent || '').replace(/\s/g, '') === 'Rp0',
  doc.getElementById('pvKasbon').textContent)
cek('DEFAULT: kasbonPickTouched masih false',
  w.eval('kasbonPickTouched') === false)

// --- Setelah user mencentang manual: state user harus dihormati ---
const k1 = boxes().find(c => c.value === 'k1')
k1.checked = true
fire(kbBox, 'change')
cek('centang manual k1 -> tercatat sebagai pilihan user',
  w.eval('kasbonPickTouched') === true && JSON.stringify(checked()) === JSON.stringify(['k1']),
  JSON.stringify(checked()))

// Render ulang lewat perubahan tanggal totalan (prevK harus me-restore pilihan).
const tgl = doc.getElementById('tTanggal')
tgl.value = '2026-10-25'
fire(tgl, 'change')
cek('render ulang (ganti tanggal) tidak menghilangkan centang manual k1',
  JSON.stringify(checked()) === JSON.stringify(['k1']), JSON.stringify(checked()))

const k2 = boxes().find(c => c.value === 'k2')
k2.checked = true
fire(kbBox, 'change')
fire(tgl, 'change')
cek('centang k1 + k2 lalu render ulang -> keduanya tetap tercentang',
  JSON.stringify(checked()) === JSON.stringify(['k1', 'k2']), JSON.stringify(checked()))

const k1b = boxes().find(c => c.value === 'k1')
k1b.checked = false
fire(kbBox, 'change')
fire(tgl, 'change')
cek('uncheck k1 lalu render ulang -> hanya k2 yang tersisa tercentang',
  JSON.stringify(checked()) === JSON.stringify(['k2']), JSON.stringify(checked()))

// --- Simpan totalan: pilihan user dipakai apa adanya, form baru mulai kosong ---
const p1 = doc.querySelector('#tProjects input[value="p1"]')
if (p1) { p1.checked = true; fire(doc.getElementById('tProjects'), 'change') }
const totalanSebelum = w.eval('D().totalans.length')
fire(doc.getElementById('formTotalan'), 'submit')

const totalans = w.eval('JSON.stringify(D().totalans)')
const saved = JSON.parse(totalans).slice(totalanSebelum)
cek('totalan tersimpan memakai kasbon yang dicentang user (k2 saja)',
  saved.length === 1 && JSON.stringify(saved[0].kasbonIds) === JSON.stringify(['k2']),
  totalans)
cek('setelah simpan, form totalan baru kembali KOSONG (tidak ada centang)',
  checked().length === 0, JSON.stringify(checked()))
cek('label "Kasbon yang Dipotong di Totalan Ini" tidak berubah',
  /Kasbon yang Dipotong di Totalan Ini/.test(doc.body.textContent))
cek('tidak ada script error saat boot/render/interaksi', scriptErrors.length === 0,
  scriptErrors.join(' | '))

console.log(`\nHASIL: ${lulus} lulus, ${gagal} gagal`)
process.exit(gagal ? 1 : 0)
