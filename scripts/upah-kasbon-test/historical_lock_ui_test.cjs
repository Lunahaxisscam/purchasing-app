// Regression UI test: completed historical totals lock their source rows.
// No Supabase/network calls; this executes the actual standalone prototype.
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const root = path.resolve(__dirname, '..', '..')
const html = fs.readFileSync(path.join(root, 'public/upah-kasbon-prototype.html'), 'utf8')
const { VirtualConsole } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const scriptErrors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', e => scriptErrors.push(e.message))
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole })
const w = dom.window
w.confirm = () => true

let pass = 0, fail = 0
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

const fixture = {
  version: 2,
  activeKey: 'pujon',
  tukangs: [{
    key: 'pujon', name: 'Pujon', unit: 'Noir Living', seq: 1, idCounter: 0,
    projects: [{ id: 'p-closed', name: 'Project Closed', status: 'Selesai' }],
    upahItems: [{ id: 'u-closed', projectId: 'p-closed', pekerjaan: 'Wardrobe', ukuran: 1, hargaSatuan: 500000, upahRincian: 500000 }],
    projectOverrides: { 'p-closed': 500000 },
    kasbon: [{ id: 'k-closed', tanggal: '2025-04-12', jenis: 'Kasbon', deskripsi: 'Kasbon mingguan', nominal: 200000 }],
    totalans: [{
      id: 't-closed', no: 'TOT-001', tanggal: '2025-04-30', seq: 1,
      projectIds: ['p-closed'], kasbonIds: ['k-closed'], pembayaranAktual: 300000,
      final: true,
      snapshot: { total_upah: 500000, kasbon_dipotong: 200000, hak_bersih: 300000, saldo_akhir: 0, status: 'Lunas' }
    }]
  }]
}

w.eval('state = ' + JSON.stringify(fixture) + '; detailProjectId = "p-closed"; render()')
const projectRow = [...w.document.querySelectorAll('#proyekTableWrap tr')].find(r => r.textContent.includes('Project Closed'))
const itemRow = [...w.document.querySelectorAll('#proyekDetailWrap tr')].find(r => r.textContent.includes('Wardrobe'))
const cashbonRow = [...w.document.querySelectorAll('#kasbonTableWrap tr')].find(r => r.textContent.includes('Kasbon mingguan'))
const totalanRow = [...w.document.querySelectorAll('#totalanTableWrap tr')].find(r => r.textContent.includes('TOT-001'))

console.log('Historical source records are read-only:')
check('closed project row has no archive/reactivate/delete action',
  !!projectRow && !projectRow.querySelector('[data-arsip-proyek], [data-aktifkan-proyek], [data-del-proyek]'))
check('closed project total override is not editable', !w.document.querySelector('#proyekDetailWrap [data-override]'))
check('closed upah detail row has no edit/delete action',
  !!itemRow && !itemRow.querySelector('[data-edit-upah], [data-del-upah]'))
check('kasbon already allocated to final total has no edit/delete action',
  !!cashbonRow && !cashbonRow.querySelector('[data-edit-kasbon], [data-del-kasbon]'))
check('final totalan has no delete action (slip remains available)',
  !!totalanRow && !totalanRow.querySelector('[data-del-totalan]') && !!totalanRow.querySelector('[data-slip]'))
check('closed project cannot re-enter a new totalan',
  !w.document.querySelector('#tProjects input[value="p-closed"]'))
check('allocated kasbon cannot re-enter a new totalan',
  !w.document.querySelector('#tKasbon input[value="k-closed"]'))

console.log('\nHistorical totals remain faithful to their saved sheet values:')
const totals = w.eval('hitungTotalans(state.tukangs[0])')
const closed = totals.find(t => t.id === 't-closed')
check('TOT-001 displayed snapshot amounts stay unchanged',
  closed.totalUpah === 500000 && closed.kasbonDipotong === 200000 && closed.hakBersih === 300000 && closed.status === 'Lunas',
  JSON.stringify(closed && { totalUpah: closed.totalUpah, kasbonDipotong: closed.kasbonDipotong, hakBersih: closed.hakBersih, status: closed.status }))

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`)
process.exit(fail ? 1 : 0)
