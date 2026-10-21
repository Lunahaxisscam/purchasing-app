// ============================================================
// probe_run245_doors_race.mjs — PINTU SERAGAM + BALAPAN YANG NYATA KALAH
// ============================================================
// Mengunci review run 244 (BUG-W1, BUG-W3) di jalur APLIKASI dengan modul
// produksi VERBATIM (hasil transform SWC) + mock perekam.
//
// BUG-W1 yang diuji: mekanisme run 243 (insert → verifikasi → tarik diri)
// TIDAK konvergen pada urutan aplikasi. Probe 244 membuktikannya; di sini
// yang diuji adalah MEKANISME PENGGANTINYA (id slot deterministik) pada urutan
// yang sama persis.
//
//   G1  URUTAN APLIKASI run 244 (A lambat, B selesai lebih dulu) → SATU
//       dokumen, dan permintaan kedua DITOLAK dengan sebab terbaca.
//   G2  KONTROL POSITIF: satu penulis sendirian tetap tersimpan (DRAFT).
//   G3  SERAH TERIMA BERTAHAP tetap sah lewat modul: dokumen lama
//       dikonfirmasi → dokumen baru DITERIMA.
//   G4  DUA penulis yang benar-benar bersamaan (pre-check sama-sama 0) →
//       hanya satu masuk (mock mengemulasi PRIMARY KEY 23505).
//   G5  BUG-W3a: `purchaseSave` (pintu 2) TIDAK membuat dokumen kedua.
//   G6  BUG-W3b: `purchaseSave` setelah semua dokumen dikonfirmasi TETAP
//       membuat antrean baru untuk sisa barang (pre-check dulu memfilter
//       salah / tidak memfilter sama sekali).
//   G7  BUG-W3c: pintu shell (`sendToTukang`) memakai penjaga yang sama —
//       diperiksa STATIS karena shell tidak bisa dirender di sandbox.
//   G8  Sisa dokumen ganda (saudaranya SUDAH dikonfirmasi) DITOLAK
//       dikonfirmasi — temuan L3 run 244.
//   G9  KONTROL POSITIF: dokumen yang DIBUAT SETELAH saudaranya dikonfirmasi
//       (serah terima bertahap) tetap BOLEH dikonfirmasi.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const REPO = process.env.REPO || SB

const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const DB = await importDist('modules/handovers/duplicateGuardDb.mjs')
const G = await importDist('modules/handovers/duplicateGuard.mjs')
const SAVE = await importDist('modules/handovers/save.mjs')
const PS = await importDist('modules/receivings/purchaseSave.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const note = (m) => console.log(`    · ${m}`)

const REC = 'rec-245'
const ROW = (id, stamp, who, extra = {}) => ({
  id, receiving_id: REC, project_id: 'p1', received_by: who, handover_date: '2026-10-21',
  status: 'DRAFT', note: '', created_at: stamp, diserahkan_at: null, ...extra
})

// ===========================================================================
console.log('\n=== G1. URUTAN APLIKASI run 244 (A lambat) → mekanisme BARU ===')
// A menyimpan lebih dulu (created_at lebih awal) tetapi commit/verifikasi
// terakhir. Di mekanisme run 243 ini menghasilkan DUA dokumen aktif.
mock.__reset({ handovers: [] })
mock.__state.insertStamp = '2026-10-21T04:25:19.271Z'
const insA = await DB.insertUniqueActiveHandover({
  data: { receiving_id: REC, project_id: 'p1', received_by: 'Admin A', status: 'DRAFT', handover_date: '2026-10-21' }
})
const rowA = insA.row ? mock.__state.handovers.get(insA.row.id) : null
check('G1a penulis pertama (A) tersimpan', insA.ok === true, JSON.stringify(insA).slice(0, 200))
// B menulis sesudahnya TANPA melihat A (meniru A belum commit bagi B): baris A
// tidak terlihat oleh SELECT, TETAPI id-nya sudah memegang PRIMARY KEY —
// persis perilaku PostgreSQL (probe_run245_slot_pg S2 membuktikannya nyata).
if (rowA) {
  mock.__state.handovers.delete(rowA.id)
  mock.__state.pendingIds.push(rowA.id)
  mock.__state.pendingRows[rowA.id] = { ...rowA }
}
mock.__state.insertStamp = '2026-10-21T04:25:19.275Z'
const insB = await DB.insertUniqueActiveHandover({
  data: { receiving_id: REC, project_id: 'p1', received_by: 'Admin B', status: 'DRAFT', handover_date: '2026-10-21' }
})
note(`B: ok=${insB.ok} raced=${!!insB.raced} existingId=${insB.existingId || '-'}`)
check('G1b B DITOLAK (bukan dua-duanya ok:true)', insB.ok === false, JSON.stringify(insB).slice(0, 220))
// A "commit" → barisnya terlihat sekarang (dan id-nya keluar dari pending).
if (rowA) {
  mock.__state.pendingIds = mock.__state.pendingIds.filter(x => x !== rowA.id)
  mock.__state.handovers.set(rowA.id, rowA)
}
const active1 = [...mock.__state.handovers.values()].filter(h => h.receiving_id === REC && !h.diserahkan_at)
note(`dokumen aktif: ${active1.length} (${active1.map(h => h.received_by).join(', ')})`)
check('G1c INVARIAN: tepat SATU dokumen aktif tersisa', active1.length === 1, `jumlah=${active1.length}`)
check('G1d yang bertahan = A (penulis pertama)', active1[0]?.received_by === 'Admin A', String(active1[0]?.received_by))
check('G1e sebabnya terbaca admin (bukan pesan SQL mentah)',
  /dokumen Serah Terima aktif yang dibuat lebih dulu|Tidak ada dokumen kedua/i.test(String(insB.reason || '')),
  String(insB.reason || '').slice(0, 200))

// ===========================================================================
console.log('\n=== G2. KONTROL POSITIF: satu penulis sendirian tetap tersimpan ===')
mock.__reset({ handovers: [] })
const solo = await DB.insertUniqueActiveHandover({
  data: { receiving_id: REC, project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21' }
})
const soloRows = [...mock.__state.handovers.values()].filter(h => h.receiving_id === REC)
check('G2a dokumen tersimpan', solo.ok === true, JSON.stringify(solo).slice(0, 160))
check('G2b status DRAFT (konfirmasi fisik terpisah)', soloRows[0]?.status === 'DRAFT', String(soloRows[0]?.status))
check('G2c id = slot deterministik untuk penerimaan ini', soloRows[0]?.id === G.slotHandoverId(REC, 0),
  `${soloRows[0]?.id} vs ${G.slotHandoverId(REC, 0)}`)

// ===========================================================================
console.log('\n=== G3. SERAH TERIMA BERTAHAP tetap sah lewat modul ===')
// Dokumen pertama dikonfirmasi (bukti fisik) → dokumen BARU untuk sisa barang.
const firstRow = soloRows[0]
mock.__state.handovers.set(firstRow.id, { ...firstRow, diserahkan_at: '2026-10-21T08:00:00.000Z', status: 'CONFIRMED' })
mock.__state.insertStamp = '2026-10-21T09:00:00.000Z'
const staged = await DB.insertUniqueActiveHandover({
  data: { receiving_id: REC, project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21' }
})
check('G3a dokumen BARU untuk sisa barang DITERIMA', staged.ok === true, JSON.stringify(staged).slice(0, 200))
check('G3b id-nya slot berikutnya (bukan menabrak slot 0)', staged.row?.id === G.slotHandoverId(REC, 1),
  String(staged.row?.id))

// ===========================================================================
console.log('\n=== G4. SLOT DIPEGANG penulis lain (menunggu kunci lalu 23505) ===')
// Keadaan nyata yang diukur di PostgreSQL (probe_run245_slot_pg S2/S3): dua
// penulis melihat 0 dokumen; INSERT pertama memegang PRIMARY KEY; INSERT kedua
// MENUNGGU, lalu ditolak 23505 begitu yang pertama commit — dan pada saat itu
// baris pemenang sudah terlihat. Di sini `pendingIds` memodelkan kunci itu.
mock.__reset({ handovers: [] })
const RACE = 'rec-race'
const winnerRow = {
  id: G.slotHandoverId(RACE, 0), receiving_id: RACE, project_id: 'p1', received_by: 'Sesi Lain',
  status: 'DRAFT', handover_date: '2026-10-21', created_at: '2026-10-21T00:00:00.000Z',
  diserahkan_at: null, note: ''
}
let hookArmed = true
mock.__state.beforeInsert = () => {
  if (!hookArmed) return
  hookArmed = false
  mock.__state.pendingIds.push(winnerRow.id)
  mock.__state.pendingRows[winnerRow.id] = { ...winnerRow }
}
const r1 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: RACE, project_id: 'p1', received_by: 'Paralel 1', status: 'DRAFT', handover_date: '2026-10-21' }
})
// Percobaan kedua (admin lain, sesudah baris pemenang terlihat) — harus
// ditolak pada jalur cepat pre-check, bukan pada INSERT.
const r2 = await DB.insertUniqueActiveHandover({
  data: { receiving_id: RACE, project_id: 'p1', received_by: 'Paralel 2', status: 'DRAFT', handover_date: '2026-10-21' }
})
const active4 = [...mock.__state.handovers.values()].filter(h => h.receiving_id === RACE && !h.diserahkan_at)
note(`r1=${r1.ok} (${r1.raced ? 'raced' : '-'}) · r2=${r2.ok} · aktif=${active4.length} · pemenang=${active4.map(h => h.received_by).join(',')}`)
check('G4a penulis yang menabrak slot TIDAK melaporkan sukses', r1.ok === false, JSON.stringify(r1).slice(0, 220))
check('G4b hanya SATU dokumen aktif di DB (dokumen pemegang slot)', active4.length === 1, `jumlah=${active4.length}`)
check('G4b2 yang bertahan = pemegang slot lebih dulu', active4[0]?.id === winnerRow.id, String(active4[0]?.id))
check('G4c percobaan berikutnya ditolak pre-check (bukan INSERT)', r2.ok === false && !r2.raced,
  JSON.stringify({ ok: r2.ok, raced: r2.raced }).slice(0, 160))
check('G4d sebabnya terbaca admin — bukan pesan SQL mentah',
  [r1, r2].every(r => /SUDAH punya dokumen Serah Terima|slot dokumen/i.test(String(r.reason || '')) &&
    !/duplicate key value violates/i.test(String(r.reason || ''))),
  `${String(r1.reason || '').slice(0, 120)} | ${String(r2.reason || '').slice(0, 120)}`)

// ===========================================================================
console.log('\n=== G5/G6. BUG-W3: pintu `purchaseSave` (nota pembelian) ===')
// G5: nota kedua untuk penerimaan yang SUDAH punya dokumen aktif tidak boleh
//     membuat dokumen kedua.
// G6: setelah SEMUA dokumen dikonfirmasi, nota berikutnya HARUS mendapat
//     antrean baru (serah terima bertahap) — pre-check lama tidak memfilter
//     `diserahkan_at` sehingga antrean itu hilang.
function notaForm(invoiceNo) {
  return {
    vendorId: 'v1', tanggal: '2026-10-21', invoiceNo, biayaLain: '0', diskon: '0',
    notaUrl: '', buktiNota: '', buktiTransfer: '', catatan: '',
    items: [{ itemName: 'Semen', unit: 'Sak', qty: '1', harga: '50000' }]
  }
}
const VENDORS = [{ id: 'v1', name: 'Toko A' }]

console.log('\n  G5. dokumen aktif sudah ada → TIDAK ada dokumen kedua')
// Nota ini HARUS memakai penerimaan yang sama (cangkang PR yang dipakai ulang),
// karena itu jalur nyata: satu cangkang Approval → satu penerimaan → satu
// dokumen antrean. Tanpa `receiving_items` + `pr_item_id`, purchaseSave membuat
// penerimaan BARU (dan antreannya memang sah) — bukan yang diuji di sini.
const RECEIVINGS5 = [{ id: 'rec-1', vendor_id: null, invoice_no: '', status: 'NORMAL', note: '' }]
const RI5 = [{ id: 'ri5', receiving_id: 'rec-1', pr_item_id: 'pi5', quantity_received: 0 }]
const PR5 = [{ id: 'pi5', pr_id: 'pr5', item_name: 'Semen', unit: 'Sak', quantity: 1, status: 'APPROVED' }]
const form5 = notaForm('TB-245-A')
form5.items = [{ prItemId: 'pi5', itemName: 'Semen', unit: 'Sak', qty: '1', harga: '50000' }]
mock.__reset({
  receivings: RECEIVINGS5.map(r => ({ ...r })),
  receivingItems: RI5.map(r => ({ ...r })),
  prItems: PR5.map(p => ({ ...p })),
  handovers: [{ id: 'ho-active', receiving_id: 'rec-1', status: 'DRAFT', diserahkan_at: null, created_at: '2026-10-21T01:00:00Z' }]
})
const hoBefore5 = mock.__state.handovers.size
const resG5 = await PS.savePurchaseWithClient({
  client: mock.supabase, form: form5, receivings: RECEIVINGS5, receivingItems: RI5, prItems: PR5, vendors: VENDORS
})
note(`nota=${resG5.ok} · penerimaan=${resG5.receivingId} · total handovers ${hoBefore5}→${mock.__state.handovers.size}`)
check('G5a nota tetap tersimpan', resG5.ok === true, resG5.error || '')
check('G5a2 nota memakai penerimaan yang SAMA (jalur cangkang, bukan nota baru)',
  String(resG5.receivingId) === 'rec-1', String(resG5.receivingId))
check('G5b TIDAK ada dokumen kedua dibuat (jumlah baris tidak bertambah)',
  mock.__state.handovers.size === hoBefore5, `${hoBefore5} → ${mock.__state.handovers.size}`)
check('G5c dilaporkan jujur bahwa antreannya sudah ada (bukan "gagal")',
  resG5.handoverQueued === true && !resG5.handoverError, JSON.stringify({ q: resG5.handoverQueued, e: resG5.handoverError }))

console.log('\n  G6. semua dokumen SUDAH dikonfirmasi → antrean baru HARUS dibuat')
mock.__reset({
  handovers: [{
    id: 'ho-done', receiving_id: 'rec-1', status: 'CONFIRMED',
    diserahkan_at: '2026-10-21T02:00:00Z', created_at: '2026-10-21T01:00:00Z'
  }]
})
const resG6 = await PS.savePurchaseWithClient({
  client: mock.supabase, form: notaForm('TB-245-B'), receivings: [], receivingItems: [], vendors: VENDORS
})
const hoG6 = [...mock.__state.handovers.values()].filter(h => h.receiving_id === resG6.receivingId)
note(`nota=${resG6.ok} · dokumen BARU: ${hoG6.length} · handoverQueued=${resG6.handoverQueued}`)
check('G6a nota tersimpan', resG6.ok === true, resG6.error || '')
check('G6b dokumen antrean BARU dibuat (dulu hilang karena pre-check tanpa filter)',
  hoG6.length === 1, `jumlah=${hoG6.length}`)
check('G6c dokumen lama yang sudah dikonfirmasi TIDAK diubah',
  mock.__state.handovers.get('ho-done')?.diserahkan_at === '2026-10-21T02:00:00Z',
  String(mock.__state.handovers.get('ho-done')?.diserahkan_at))
check('G6d dilaporkan masuk antrean', resG6.handoverQueued === true && /antrean Serah Terima/.test(String(resG6.message || '')))

// ===========================================================================
console.log('\n=== G7. BUG-W3c: pintu shell memakai penjaga yang sama (STATIS) ===')
const shell = fs.readFileSync(path.join(REPO, 'pages', 'index.js'), 'utf8')
const atSend = shell.indexOf('async function sendToTukang(')
const endSend = shell.indexOf('\n  async function ', atSend + 10)
const sendFn = shell.slice(atSend, endSend > atSend ? endSend : shell.length)
check('G7a `sendToTukang` memakai SATU pembungkus create (bukan INSERT langsung)',
  /createActiveHandover\(/.test(sendFn), sendFn.slice(0, 120))
check('G7a2 pembungkus itu benar-benar memuat DUA jalur (RPC kontrak v1 + slot LEGACY)',
  (() => {
    const p = path.join(REPO, 'modules', 'handovers', 'createHandover.js')
    if (!fs.existsSync(p)) return false
    const s = fs.readFileSync(p, 'utf8')
    return /handover_create_atomic/.test(s) && /insertUniqueActiveHandover\(/.test(s)
  })(), 'createHandover.js tidak memuat salah satu jalur')
check('G7a3 ketiga pintu create memakai pembungkus yang SAMA',
  (() => {
    const doors = [
      path.join(REPO, 'modules', 'handovers', 'save.js'),
      path.join(REPO, 'modules', 'receivings', 'purchaseSave.js'),
      path.join(REPO, 'pages', 'index.js')
    ]
    return doors.every(d => fs.existsSync(d) && /createActiveHandover/.test(fs.readFileSync(d, 'utf8')))
  })(), 'ada pintu create yang belum memakai pembungkus')
check('G7b tidak ada lagi `from(\'handovers\').insert(` di jalur itu',
  !/from\(\s*'handovers'\s*\)\s*\.insert\(/.test(sendFn), 'masih ada INSERT langsung')
check('G7c jalur konfirmasi shell memakai `confirmUniqueHandover` (bukan confirm.js langsung)',
  /confirmUniqueHandover\(/.test(shell))
check('G7d seluruh jalur UI: hanya modul penjaga yang INSERT handovers langsung',
  (() => {
    // `pages/api/**` = endpoint maintenance server (bukan UI), sudah dicatat
    // sebagai batas di docs §8 / probe 237 W7b. Di sini yang diperiksa jalur UI.
    const roots = ['components', 'modules', 'lib', 'pages']
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue
        if (e.name === 'api') continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!/\.(js|jsx)$/.test(e.name)) continue
        const s = fs.readFileSync(p, 'utf8')
        if (/from\(\s*'handovers'\s*\)\s*\.insert\(/.test(s)) hits.push(path.relative(REPO, p))
      }
    }
    for (const r of roots) { const p = path.join(REPO, r); if (fs.existsSync(p)) walk(p) }
    note(`INSERT langsung handovers di jalur UI: ${hits.join(', ') || '(tidak ada)'}`)
    return hits.length === 1 && hits[0].endsWith(path.join('handovers', 'duplicateGuardDb.js'))
  })())

// ===========================================================================
console.log('\n=== G8. Sisa dokumen ganda (saudaranya SUDAH dikonfirmasi) DITOLAK ===')
// Keadaan dari probe_run244_after_first: dokumen 1 dikonfirmasi, dokumen 2
// tinggal sendirian → dulu dianggap kanonik dan penjaga meloloskan.
mock.__reset({
  handovers: [
    { ...ROW('ho-a', '2026-10-21T01:00:00Z', 'Admin A'), diserahkan_at: '2026-10-21T05:00:00Z', status: 'CONFIRMED' },
    { ...ROW('ho-b', '2026-10-21T01:00:01Z', 'Admin B') }
  ]
})
const g8 = await DB.guardConfirmFresh({ handover: mock.__state.handovers.get('ho-b') })
note(`ok=${g8.ok} kind=${g8.kind} canonical=${g8.canonicalId}`)
check('G8a dokumen sisa DITOLAK dikonfirmasi', g8.ok === false, JSON.stringify(g8).slice(0, 240))
check('G8b sebabnya menyebut sisa dokumen ganda + jalan keluarnya',
  /SISA DOKUMEN GANDA/i.test(String(g8.reason || '')) && /dokumen BARU/i.test(String(g8.reason || '')),
  String(g8.reason || '').slice(0, 220))
check('G8c menunjuk dokumen yang SUDAH dikonfirmasi sebagai pembanding', g8.deliveredSiblingId === 'ho-a',
  String(g8.deliveredSiblingId))
const info8 = G.duplicateInfoFor(mock.__state.handovers.get('ho-b'), [...mock.__state.handovers.values()])
check('G8d badge tampilan juga menyala (dulu MATI sesudah dokumen pertama dikonfirmasi)',
  info8.staleDuplicate === true, JSON.stringify(info8))

// ===========================================================================
console.log('\n=== G9. KONTROL POSITIF: dokumen yang DIBUAT SETELAH saudaranya dikonfirmasi ===')
// Ini serah terima BERTAHAP yang SAH — tidak boleh ikut diblokir.
mock.__reset({
  handovers: [
    { ...ROW('ho-old', '2026-10-21T01:00:00Z', 'Admin A'), diserahkan_at: '2026-10-21T05:00:00Z', status: 'CONFIRMED' },
    { ...ROW('ho-staged', '2026-10-21T06:00:00Z', 'Admin B') }
  ]
})
const g9 = await DB.guardConfirmFresh({ handover: mock.__state.handovers.get('ho-staged') })
check('G9a dokumen bertahap TETAP boleh dikonfirmasi', g9.ok === true, JSON.stringify(g9).slice(0, 220))
check('G9b tanpa peringatan palsu', !g9.warn, String(g9.warn || ''))
const info9 = G.duplicateInfoFor(mock.__state.handovers.get('ho-staged'), [...mock.__state.handovers.values()])
check('G9c tidak ditandai sisa duplikat', info9.staleDuplicate === false, JSON.stringify(info9))
// Data lama TANPA created_at: presisi turun ke `handover_date` (HARI).
mock.__reset({
  handovers: [
    { ...ROW('ho-x', null, 'Admin A'), diserahkan_at: '2026-10-21T05:00:00Z', status: 'CONFIRMED' },
    { ...ROW('ho-y', null, 'Admin B') }
  ]
})
const g9d = await DB.guardConfirmFresh({ handover: mock.__state.handovers.get('ho-y') })
check('G9d data lama tanpa created_at, tanggal SAMA dengan konfirmasi → fail closed',
  g9d.ok === false, JSON.stringify(g9d).slice(0, 200))
// Data lama yang jelas BERTAHAP: dokumen dibuat SETELAH tanggal konfirmasi
// saudaranya → tetap sah (bukan diblokir karena tidak punya created_at).
mock.__reset({
  handovers: [
    { ...ROW('ho-x2', null, 'Admin A'), handover_date: '2026-10-20', diserahkan_at: '2026-10-20T05:00:00Z', status: 'CONFIRMED' },
    { ...ROW('ho-y2', null, 'Admin B'), handover_date: '2026-10-22' }
  ]
})
const g9e = await DB.guardConfirmFresh({ handover: mock.__state.handovers.get('ho-y2') })
check('G9e data lama yang JELAS bertahap (tanggal lebih akhir) tetap boleh',
  g9e.ok === true, JSON.stringify(g9e).slice(0, 220))
// Tanpa created_at DAN tanpa handover_date: tidak bisa dibedakan → fail closed.
mock.__reset({
  handovers: [
    { ...ROW('ho-x3', null, 'Admin A'), handover_date: null, diserahkan_at: '2026-10-21T05:00:00Z', status: 'CONFIRMED' },
    { ...ROW('ho-y3', null, 'Admin B'), handover_date: null }
  ]
})
const g9f = await DB.guardConfirmFresh({ handover: mock.__state.handovers.get('ho-y3') })
check('G9f tanpa waktu sama sekali → fail closed (tidak menebak aman)',
  g9f.ok === false, JSON.stringify(g9f).slice(0, 200))

console.log(`\n=== HASIL PROBE PINTU+BALAPAN (run 245): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('TEMUAN: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
