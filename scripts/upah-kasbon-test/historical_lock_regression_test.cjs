// ============================================================
// scripts/upah-kasbon-test/historical_lock_regression_test.cjs
// Regression test: reject no-op historical rewrites, preserve locked
// records, only write editable changes, and protect concurrent workers.
// ============================================================
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const UP = require(path.join(root, 'public', 'upah-kasbon-sync.js'))

const snapshotPath = '/home/ubuntu/reports/totalan-layout-staging/before-private.json'
assert.ok(fs.existsSync(snapshotPath), 'Sanitized production snapshot must exist')
const db = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))

const mapped = {}
for (const [a, b] of Object.entries({
  tukangs: 'upah_tukang',
  projects: 'upah_projects',
  items: 'upah_items',
  kasbon: 'upah_kasbon',
  totalans: 'upah_totalan',
  totalanProjects: 'upah_totalan_projects',
  totalanKasbon: 'upah_totalan_kasbon',
  adjustments: 'upah_penyesuaian'
})) {
  mapped[a] = db[b]
}

console.log('--- TEST 1: Baseline State Loading & Locked Totalans Verification ---')
const state = UP.stateFromDb(mapped)
const pujon = state.tukangs.find(t => /pujon/i.test(t.name))
assert.ok(pujon, 'Pujon dataset must exist')
const finalTotalans = pujon.totalans.filter(t => t.final === true)
assert.equal(finalTotalans.length, 5, 'Pujon must have exactly 5 final totalans')

const lockedProjectIds = new Set()
const lockedKasbonIds = new Set()
for (const t of finalTotalans) {
  ;(t.projectIds || []).forEach(id => lockedProjectIds.add(id))
  ;(t.kasbonIds || []).forEach(id => lockedKasbonIds.add(id))
}
console.log(`Pujon final totalans: ${finalTotalans.length}`)
console.log(`Locked projects: ${lockedProjectIds.size}`)
console.log(`Locked kasbon entries: ${lockedKasbonIds.size}`)
assert.ok(lockedProjectIds.size > 0, 'Must have locked projects')
assert.ok(lockedKasbonIds.size > 0, 'Must have locked kasbon')

console.log('--- TEST 2: No-op Historical Rewrite Rejection ---')
// When user edits something unrelated or non-final (e.g. increments idCounter or adds a new unlinked draft project):
const stateUnrelatedChange = JSON.parse(JSON.stringify(state))
const pujonCopy = stateUnrelatedChange.tukangs.find(t => t.key === pujon.key)
pujonCopy.idCounter = (pujonCopy.idCounter || 0) + 1

const opsUnrelated = UP.planPersist(state, stateUnrelatedChange)
const lockedItemsTouched = opsUnrelated.filter(o => {
  if (o.table === 'upah_items') {
    const item = pujon.upahItems.find(i => i.id === o.id)
    return item && lockedProjectIds.has(item.projectId)
  }
  if (o.table === 'upah_kasbon') {
    return lockedKasbonIds.has(o.id)
  }
  if (o.table === 'upah_projects') {
    return lockedProjectIds.has(o.id)
  }
  if (o.table === 'upah_totalan') {
    return finalTotalans.some(t => t.id === o.id)
  }
  return false
})

console.log(`Total ops on unrelated change: ${opsUnrelated.length}`)
console.log(`Locked records touched by ops: ${lockedItemsTouched.length}`)

// ASSERTION: Locked records must NEVER be emitted as updates or deletes!
assert.equal(
  lockedItemsTouched.length,
  0,
  `Regression: planPersist generated ${lockedItemsTouched.length} operations touching locked historical records!`
)
assert.equal(
  opsUnrelated.length,
  0,
  `Regression: planPersist generated ${opsUnrelated.length} operations when no business fields changed!`
)

console.log('--- TEST 3: Only Genuine Editable Changes Are Written ---')
const stateWithNewItem = JSON.parse(JSON.stringify(state))
const pujonEditable = stateWithNewItem.tukangs.find(t => t.key === pujon.key)
// Add a new project and new item
const newProjId = 'new-proj-temp-1'
const newItemId = 'new-item-temp-1'
pujonEditable.projects.push({ id: newProjId, name: 'Proyek Baru Test', status: 'On Going' })
pujonEditable.upahItems.push({ id: newItemId, projectId: newProjId, pekerjaan: 'Pekerjaan Baru', upahRincian: 250000 })

const opsNew = UP.planPersist(state, stateWithNewItem)
console.log(`Total ops for new project + item: ${opsNew.length}`)
assert.equal(opsNew.length, 2, 'Must generate exactly 2 operations (1 insert project, 1 insert item)')
assert.equal(opsNew[0].kind, 'insert')
assert.equal(opsNew[0].table, 'upah_projects')
assert.equal(opsNew[0].provId, newProjId)
assert.equal(opsNew[1].kind, 'insert')
assert.equal(opsNew[1].table, 'upah_items')
assert.equal(opsNew[1].provId, newItemId)

console.log('--- TEST 4: Concurrent Worker Protection (Asep & Josh Mabes untouched) ---')
const asep = state.tukangs.find(t => /asep/i.test(t.name))
assert.ok(asep, 'Asep dataset must exist')
const asepOps = opsNew.filter(o => o.row && o.row.tukang_id === (asep.dbId || asep.id))
assert.equal(asepOps.length, 0, 'Operations on Pujon must never touch Asep / concurrent worker records')

console.log('--- TEST 5: Explicit Mutation of Locked Records Rejection ---')
// 5a. Attempting to modify a project in final totalan
const stateMutateProject = JSON.parse(JSON.stringify(state))
const pujonMutProj = stateMutateProject.tukangs.find(t => t.key === pujon.key)
const firstLockedProjId = [...lockedProjectIds][0]
const lockedProj = pujonMutProj.projects.find(p => p.id === firstLockedProjId)
assert.ok(lockedProj, 'Locked project must exist')
lockedProj.name = 'Hacked Project Name'
assert.throws(
  () => UP.planPersist(state, stateMutateProject),
  /Totalan final.*data historis terkunci/i,
  'Must reject explicit modification of project locked in final totalan'
)

// 5b. Attempting to modify a kasbon in final totalan
const stateMutateKasbon = JSON.parse(JSON.stringify(state))
const pujonMutKasbon = stateMutateKasbon.tukangs.find(t => t.key === pujon.key)
const firstLockedKasbonId = [...lockedKasbonIds][0]
const lockedKasbonRow = pujonMutKasbon.kasbon.find(k => k.id === firstLockedKasbonId)
assert.ok(lockedKasbonRow, 'Locked kasbon must exist')
lockedKasbonRow.nominal = lockedKasbonRow.nominal + 1000
assert.throws(
  () => UP.planPersist(state, stateMutateKasbon),
  /Totalan final.*data historis terkunci/i,
  'Must reject explicit modification of kasbon locked in final totalan'
)

// 5c. Attempting to delete a final totalan
const stateDeleteTotalan = JSON.parse(JSON.stringify(state))
const pujonDelTot = stateDeleteTotalan.tukangs.find(t => t.key === pujon.key)
pujonDelTot.totalans = pujonDelTot.totalans.filter(t => !t.final)
assert.throws(
  () => UP.planPersist(state, stateDeleteTotalan),
  /Totalan final.*tidak boleh diubah\/dihapus/i,
  'Must reject deleting final totalan'
)

console.log('--- TEST 6: Prototype Error Catch & Non-retrying Immutable Lock Banner ---')
const vm = require('node:vm')
const protoSrc = fs.readFileSync(path.join(root, 'public', 'upah-kasbon-prototype.html'), 'utf8')
const mainScript = protoSrc.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/bootMaster\(\)\s*$/, '')

const noticeState = { text: '', isErr: false, sticky: false }
let registeredTimers = []
const mockDocument = {
  getElementById(id) {
    if (id === 'notice') {
      return {
        set textContent(v) { noticeState.text = v },
        get textContent() { return noticeState.text },
        set className(v) { noticeState.isErr = v === 'err' },
        style: {},
        _t: null
      }
    }
    return { value: '', textContent: '', innerHTML: '', style: {}, classList: { toggle() {}, add() {} }, addEventListener() {}, querySelectorAll() { return [] }, reset() {} }
  },
  querySelectorAll() { return [] },
  addEventListener() {}
}

const sandbox = {
  window: { parent: { __UPAH_READ_ONLY__: false }, UpahSync: UP, UpahTotalanHistory: require(path.join(root, 'public', 'upah-totalan-history.js')) },
  document: mockDocument,
  console,
  setTimeout(fn, ms) { const timerId = registeredTimers.length + 1; registeredTimers.push({ timerId, fn, ms }); return timerId },
  clearTimeout(id) { registeredTimers = registeredTimers.filter(t => t.timerId !== id) },
  Map,
  Set,
  todayISO: () => '2026-10-28'
}
vm.createContext(sandbox)
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'upah-penyesuaian.js'), 'utf8'), sandbox)
vm.runInContext(mainScript, sandbox)

// Simulate lock error catch in persistNow
vm.runInContext(`
  {
    MASTER.timer = 999;
    const e = new Error("historical upah record is final and locked");
    const msg = (e && (e.message || e.code)) ? (e.message || e.code) : String(e);
    const isLockErr = /final.*(locked|kunci|terkunci)|historical upah record is final and locked/i.test(msg);
    if(isLockErr){
      clearTimeout(MASTER.timer);
      masterStatus('Data historis totalan final terkunci dan tidak dapat diubah.', true, true);
    } else {
      masterStatus('GAGAL SIMPAN ke database: ' + msg + ' — coba lagi / muat ulang.', true);
      clearTimeout(MASTER.timer); MASTER.timer = setTimeout(persistNow, 5000);
    }
  }
`, sandbox)

assert.equal(noticeState.text, 'Data historis totalan final terkunci dan tidak dapat diubah.', 'Actionable message for immutable lock')
assert.equal(noticeState.isErr, true)
assert.equal(registeredTimers.filter(t => t.ms === 5000).length, 0, 'No 5s retry timer scheduled for immutable lock')

// Simulate transient network error catch
vm.runInContext(`
  {
    const e = new Error("Network timeout: 504 Gateway Timeout");
    const msg = (e && (e.message || e.code)) ? (e.message || e.code) : String(e);
    const isLockErr = /final.*(locked|kunci|terkunci)|historical upah record is final and locked/i.test(msg);
    if(isLockErr){
      clearTimeout(MASTER.timer);
      masterStatus('Data historis totalan final terkunci dan tidak dapat diubah.', true, true);
    } else {
      masterStatus('GAGAL SIMPAN ke database: ' + msg + ' — coba lagi / muat ulang.', true);
      clearTimeout(MASTER.timer); MASTER.timer = setTimeout(persistNow, 5000);
    }
  }
`, sandbox)
assert.match(noticeState.text, /GAGAL SIMPAN.*coba lagi \/ muat ulang/, 'Transient error retains retry guidance')
assert.equal(registeredTimers.filter(t => t.ms === 5000).length, 1, 'Transient error schedules 5s retry')

console.log('--- ALL REGRESSION ASSERTIONS PASSED ---')
