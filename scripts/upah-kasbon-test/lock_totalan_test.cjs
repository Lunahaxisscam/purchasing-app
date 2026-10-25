// ============================================================
// scripts/upah-kasbon-test/lock_totalan_test.cjs
// ============================================================
// Uji KUNCI TOTALAN HISTORIS (keputusan DAT 24 Okt 2026):
//   totalan ber-`final` = dokumen tutup buku. Angkanya diambil apa adanya
//   dari snapshot (hasil sheet), TIDAK dihitung ulang dari kasbon/proyek.
//   Totalan non-final tetap berperilaku seperti sebelumnya.
// ============================================================
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const root = path.resolve(__dirname, '..', '..')
// The old header (which contained fileImport) was intentionally removed. Supply
// that optional, non-visible input in the harness so the prototype boots without
// an unrelated null.addEventListener error.
const html = fs.readFileSync(path.join(root, 'public', 'upah-kasbon-prototype.html'), 'utf8')
  .replace('<script>\n\'use strict\'', '<input id="fileImport" type="file" hidden>\n<script>\n\'use strict\'')
const { VirtualConsole } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
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

// Mount a real snapshot-shaped final totalan after standalone boot.
w.eval('state = ' + JSON.stringify({
  version: 2, activeKey: 'pujon', tukangs: [{
    key: 'pujon', name: 'Pujon', unit: 'Noir Living', seq: 1, idCounter: 0,
    projects: [{ id: 'p-final', name: 'Project Historis', status: 'Selesai' }],
    upahItems: [{ id: 'u-final', projectId: 'p-final', pekerjaan: 'Kabinet', ukuran: 1, hargaSatuan: 500000, upahRincian: 500000 }],
    kasbon: [{ id: 'k-final', tanggal: '2025-04-12', jenis: 'Kasbon', deskripsi: 'Kasbon mingguan', nominal: 200000 }],
    totalans: [{ id: 't-final', no: 'TOT-001', tanggal: '2025-04-30', seq: 1, projectIds: ['p-final'], kasbonIds: ['k-final'], pembayaranAktual: 300000, final: true,
      snapshot: { total_upah: 500000, kasbon_dipotong: 200000, hak_bersih: 300000, saldo_akhir: 0, status: 'Lunas' } }],
    projectOverrides: { 'p-final': 500000 }
  }]
}) + '; detailProjectId = "p-final"; render()')
const projectRow = [...w.document.querySelectorAll('#proyekTableWrap tr')].find(r => r.textContent.includes('Project Historis'))
const itemRow = [...w.document.querySelectorAll('#proyekDetailWrap tr')].find(r => r.textContent.includes('Kabinet'))
const cashbonRow = [...w.document.querySelectorAll('#kasbonTableWrap tr')].find(r => r.textContent.includes('Kasbon mingguan'))
const totalanRow = [...w.document.querySelectorAll('#totalanTableWrap tr')].find(r => r.textContent.includes('TOT-001'))

console.log('Historical data lock UI:')
cek('project final tidak punya aksi arsip/hapus', !!projectRow && !projectRow.querySelector('[data-arsip-proyek], [data-aktifkan-proyek], [data-del-proyek]'))
cek('detail upah final tidak punya aksi edit/hapus', !!itemRow && !itemRow.querySelector('[data-edit-upah], [data-del-upah]'))
cek('kasbon final tidak punya aksi edit/hapus', !!cashbonRow && !cashbonRow.querySelector('[data-edit-kasbon], [data-del-kasbon]'))
cek('totalan final tidak punya aksi hapus', !!totalanRow && !totalanRow.querySelector('[data-del-totalan]') && !!totalanRow.querySelector('[data-slip]'))
cek('proyek/kasbon final dikecualikan dari totalan baru', !w.document.querySelector('#tProjects input[value="p-final"]') && !w.document.querySelector('#tKasbon input[value="k-final"]'))
cek('tidak ada script error saat boot/render', scriptErrors.length === 0, scriptErrors.join(' | '))

// Non-final baseline: the ordinary edit/delete actions remain present.
w.eval('state = ' + JSON.stringify({
  version: 2, activeKey: 'asep', tukangs: [{
    key: 'asep', name: 'Asep', unit: 'Noir Living', seq: 0, idCounter: 0,
    projects: [{ id: 'p-open', name: 'Project Open', status: 'Selesai' }],
    upahItems: [{ id: 'u-open', projectId: 'p-open', pekerjaan: 'Rak', upahRincian: 100 }],
    kasbon: [{ id: 'k-open', tanggal: '2026-10-01', jenis: 'Kasbon', deskripsi: 'Kasbon baru', nominal: 50 }],
    totalans: [], projectOverrides: {}
  }]
}) + '; detailProjectId = "p-open"; render()')
const openRow = [...w.document.querySelectorAll('#proyekTableWrap tr')].find(r => r.textContent.includes('Project Open'))
const openItem = [...w.document.querySelectorAll('#proyekDetailWrap tr')].find(r => r.textContent.includes('Rak'))
const openCashbon = [...w.document.querySelectorAll('#kasbonTableWrap tr')].find(r => r.textContent.includes('Kasbon baru'))
cek('non-final project tetap bisa diedit/diarsipkan', !!openRow && !!openRow.querySelector('[data-arsip-proyek], [data-del-proyek]'))
cek('non-final upah tetap bisa diedit', !!openItem && !!openItem.querySelector('[data-edit-upah]'))
cek('kasbon belum dipotong tetap bisa diedit', !!openCashbon && !!openCashbon.querySelector('[data-edit-kasbon]'))

const finalFixture = {
  projects: [{ id: 'p1', name: 'Proyek A' }, { id: 'p2', name: 'Proyek B' }],
  upahItems: [], projectOverrides: { p1: 1000000, p2: 500000 },
  kasbon: [{ id: 'k1', tanggal: '2025-01-05', jenis: 'Kasbon', nominal: 200000 }],
  totalans: [
    { id: 't1', no: 'TOT-001', tanggal: '2025-01-31', seq: 1, projectIds: ['p1'], pembayaranAktual: 800000, kasbonIds: ['k1'] },
    { id: 't2', no: 'TOT-002', tanggal: '2025-02-28', seq: 2, projectIds: ['p2'], pembayaranAktual: 100000, kasbonIds: [], final: true,
      snapshot: { total_upah: 500000, kasbon_dipotong: 400000, hak_bersih: 100000, saldo_akhir: 0, status: 'Lunas' } }
  ]
}
const result = w.eval('hitungTotalans(' + JSON.stringify(finalFixture) + ')')
const historical = result.find(t => t.id === 't2')
cek('final snapshot tetap tampil sesuai sheet (totalan tersimpan)', historical.totalUpah === 500000 && historical.kasbonDipotong === 400000 && historical.status === 'Lunas', JSON.stringify(historical))

const finalTotalan = finalFixture.totalans[1]
const snapshot = w.eval('snapTotalan(' + JSON.stringify(finalTotalan) + ', ' + JSON.stringify(finalFixture) + ')')
cek('snapTotalan tetap menulis angka snapshot yang sama', snapshot.total_upah === 500000 && snapshot.kasbon_dipotong === 400000 && snapshot.status === 'Lunas', JSON.stringify(snapshot))

console.log(`\nHASIL: ${lulus} lulus, ${gagal} gagal`)

