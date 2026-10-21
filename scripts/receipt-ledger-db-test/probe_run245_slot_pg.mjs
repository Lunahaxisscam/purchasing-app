// ============================================================
// probe_run245_slot_pg.mjs — KUNCI SLOT (PRIMARY KEY) vs URUTAN VERIFIKASI
// ============================================================
// Probe ini menjawab tepat temuan review run 244 (BUG-W1 + BUG-W2) pada
// PostgreSQL 16 NYATA, dengan DUA KONEKSI dan commit nyata.
//
// BUG-W1 yang harus ditutup: klaim run 243 "insert → verifikasi → tarik diri
// sendiri membuat keadaan akhir SELALU satu dokumen" TIDAK BENAR. Urutan
// aplikasi (A mulai dulu dengan created_at lebih awal, tetapi commit TERAKHIR)
// menghasilkan DUA dokumen aktif dan KEDUANYA `ok:true`.
//
// Mekanisme run 245: `handovers.id` adalah PRIMARY KEY. Setiap penulis
// menurunkan id dari (receiving_id, jumlah dokumen yang terlihat). Dua penulis
// yang melihat jumlah yang sama menghasilkan id yang SAMA. Akibatnya yang
// kedua TERTAHAN di kunci index (bukan lolos), lalu ditolak 23505 begitu
// penulis pertama commit. Tidak ada jendela, tidak bergantung urutan commit.
//
// CATATAN PENTING (perilaku nyata yang diukur, bukan diasumsikan): penulis
// kedua MENUNGGU (blocking), bukan langsung gagal. Probe ini karena itu
// menjalankan INSERT kedua secara TIDAK-AWAIT, lalu commit penulis pertama,
// baru menunggu hasilnya — persis yang terjadi pada dua permintaan HTTP.
//
// Yang diuji:
//   S1  id deterministik: kunci sama → id sama; slot beda → id beda.
//   S2  URUTAN APLIKASI run 244 (A lambat, commit terakhir) → TETAP 1 dokumen.
//   S3  BERSAMAAN sungguhan (keduanya belum commit) → hanya satu masuk.
//   S4  SERAH TERIMA BERTAHAP tetap SAH: dokumen lama dikonfirmasi → dokumen
//       baru untuk penerimaan yang sama DITERIMA (slot berikutnya kosong).
//   S5  Penerimaan BERBEDA tidak saling mengganggu (slot-nya terpisah).
//   S6  BUG-W2: partial unique index `(receiving_id) WHERE diserahkan_at IS
//       NULL` DAPAT dibuat dan TIDAK memblokir serah terima bertahap — jadi
//       penolakan DDL di kode adalah soal KEPEMILIKAN, bukan kemustahilan.
//       Index dibuat dan DI-DROP lagi di cluster lokal ini (tidak ke Supabase).
//   S7  BUKTI mekanisme LAMA (run 243) memang gagal pada urutan yang sama.
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'
const SB = process.env.SB || '/tmp/receipt-ledger-app-t7bc'

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const note = (m) => console.log(`    · ${m}`)

// Modul MURNI produksi (verbatim, hasil transform SWC) — id slot HARUS berasal
// dari kode yang dipakai aplikasi, bukan disalin ke skrip uji.
const G = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/duplicateGuard.mjs')).href)

const admin = new Client({ connectionString: PGURL })
await admin.connect()
const q = async (sql, p = []) => (await admin.query(sql, p)).rows

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1')).length
  ? (await q('select id from vendors limit 1'))[0].id : null

let seq = 0
async function freshReceiving(tag) {
  seq += 1
  const t = `${tag}-${seq}-${Date.now()}`
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,$2,'APPROVED',$3) returning id`, [`PR-${t}`, `uji slot ${t}`, prj]))[0].id
  return (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,purchase_request_id,project_id,note)
    values ($1,$2,current_date,'NORMAL',$3,$4,'[Tahap: DIBELI]') returning id`,
  [vend, `INV-${t}`, pr, prj]))[0].id
}
const countRows = async (rid) => Number((await q(
  'select count(*)::int n from handovers where receiving_id=$1', [rid]))[0].n)
const countActive = async (rid) => Number((await q(
  'select count(*)::int n from handovers where receiving_id=$1 and diserahkan_at is null', [rid]))[0].n)

async function connect() {
  const c = new Client({ connectionString: PGURL })
  await c.connect()
  // Jangan biarkan probe menggantung bila ada perilaku kunci yang tak terduga:
  // lebih baik GAGAL dengan pesan jelas daripada menunggu selamanya.
  await c.query("set statement_timeout = '15s'")
  await c.query("set lock_timeout = '15s'")
  return c
}

// Meniru `insertUniqueActiveHandover`: baca SEMUA baris (satu snapshot) →
// hitung slot → INSERT dengan id dari modul produksi.
async function appInsert(client, rid, who, stamp) {
  const rows = (await client.query(
    'select id from handovers where receiving_id=$1', [rid])).rows
  const id = G.slotHandoverId(rid, rows.length)
  try {
    const r = await client.query(
      `insert into handovers (id, receiving_id, project_id, received_by, status, handover_date, created_at)
       values ($1,$2,$3,$4,'DRAFT',current_date, coalesce($5::timestamptz, now())) returning id`,
      [id, rid, prj, who, stamp || null])
    return { ok: true, id: r.rows[0].id, slot: rows.length }
  } catch (e) {
    return { ok: false, code: e.code, error: e.message, slot: rows.length }
  }
}

// ===========================================================================
console.log('\n=== S1. id slot DETERMINISTIK (fungsi murni produksi) ===')
const ridA = await freshReceiving('S1')
const id0 = G.slotHandoverId(ridA, 0)
const id0b = G.slotHandoverId(ridA, 0)
const id1 = G.slotHandoverId(ridA, 1)
check('S1a kunci sama → id SAMA (bisa dipakai sebagai mutex)', id0 === id0b, `${id0} vs ${id0b}`)
check('S1b slot berbeda → id berbeda', id0 !== id1, `${id0} vs ${id1}`)
check('S1c bentuknya UUID yang sah (kolom handovers.id bertipe uuid)',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id0), id0)
check('S1d PostgreSQL MENERIMA id itu sebagai uuid', (await q('select $1::uuid is not null as ok', [id0]))[0].ok === true)
const other = G.slotHandoverId('rec-lain', 0)
check('S1e penerimaan berbeda → id berbeda (tidak saling mengunci)', id0 !== other, `${id0} vs ${other}`)

// ===========================================================================
console.log('\n=== S2. URUTAN APLIKASI run 244: A (created_at lebih awal) commit TERAKHIR ===')
// Ini PERSIS urutan yang menggagalkan mekanisme run 243.
const ridS2 = await freshReceiving('S2')
const A = await connect()
const B = await connect()

await A.query('begin')
const aRes = await appInsert(A, ridS2, 'Admin A', '2026-10-21T04:25:19.271Z')
note(`A insert (BELUM commit): ok=${aRes.ok} slot=${aRes.slot}`)

// B mulai belakangan dan BACANYA belum melihat A (A belum commit) → B
// menghitung slot yang SAMA. INSERT B akan MENUNGGU kunci index A.
await B.query('begin')
const bPromise = appInsert(B, ridS2, 'Admin B', '2026-10-21T04:25:19.275Z')
// Beri waktu B benar-benar sampai ke INSERT dan tertahan.
await new Promise(r => setTimeout(r, 300))
const bWaiting = (await q(
  `select count(*)::int n from pg_stat_activity
    where datname = current_database() and wait_event_type = 'Lock'`))[0].n
note(`sesi yang menunggu kunci: ${bWaiting}`)

// A commit — sekarang B bisa lanjut dan HARUS ditolak.
await A.query('commit')
const bRes = await bPromise
note(`B sesudah A commit: ok=${bRes.ok} code=${bRes.code || '-'}`)
check('S2a A masuk (penulis pertama)', aRes.ok === true, JSON.stringify(aRes))
check('S2b B TERTAHAN di kunci index (bukan lolos lebih dulu)', bWaiting >= 1, `menunggu=${bWaiting}`)
check('S2c B DITOLAK database 23505 (bukan diterima lalu ditarik)',
  bRes.ok === false && bRes.code === '23505', JSON.stringify(bRes))
await B.query('rollback')
const s2rows = await countRows(ridS2)
note(`sesudah semuanya: ${s2rows} baris`)
check('S2d INVARIAN TERTEGAKKAN: tepat SATU dokumen (bukan dua)', s2rows === 1, `baris=${s2rows}`)
check('S2e yang bertahan adalah A',
  (await q('select received_by from handovers where receiving_id=$1', [ridS2]))[0]?.received_by === 'Admin A')
await A.end(); await B.end()

// ===========================================================================
console.log('\n=== S3. BERSAMAAN sungguhan: dua transaksi, keduanya belum commit ===')
const ridS3 = await freshReceiving('S3')
const E = await connect()
const F = await connect()
await E.query('begin')
await F.query('begin')
const eRes = await appInsert(E, ridS3, 'Admin E', null)
const fPromise = appInsert(F, ridS3, 'Admin F', null)
await new Promise(r => setTimeout(r, 300))
await E.query('commit')
const fRes = await fPromise
note(`E ok=${eRes.ok} · F ok=${fRes.ok} code=${fRes.code || '-'}`)
check('S3a tepat SATU INSERT diterima', (eRes.ok ? 1 : 0) + (fRes.ok ? 1 : 0) === 1,
  `E=${eRes.ok} F=${fRes.ok}/${fRes.code}`)
check('S3b yang kalah ditolak 23505 (bukan error lain)', fRes.ok === false && fRes.code === '23505', JSON.stringify(fRes))
await F.query('rollback')
const s3rows = await countRows(ridS3)
check('S3c keadaan akhir: SATU dokumen', s3rows === 1, `baris=${s3rows}`)
await E.end(); await F.end()

// ===========================================================================
console.log('\n=== S4. SERAH TERIMA BERTAHAP tetap SAH (slot berikutnya kosong) ===')
const ridS4 = await freshReceiving('S4')
const G1 = await connect()
const first = await appInsert(G1, ridS4, 'Admin 1', null)
check('S4a dokumen pertama masuk', first.ok === true, JSON.stringify(first))
await G1.query(`update handovers set status='CONFIRMED', diserahkan_at=now() where id=$1`, [first.id])
const second = await appInsert(G1, ridS4, 'Admin 2', null)
check('S4b dokumen BARU untuk sisa barang DITERIMA (bukan diblokir)', second.ok === true, JSON.stringify(second))
check('S4c dua baris total, hanya SATU yang aktif',
  (await countRows(ridS4)) === 2 && (await countActive(ridS4)) === 1,
  `total=${await countRows(ridS4)} aktif=${await countActive(ridS4)}`)
check('S4d id dokumen kedua = slot 1 (bukan slot 0)', second.id === G.slotHandoverId(ridS4, 1), String(second.id))
await G1.end()

// ===========================================================================
console.log('\n=== S5. Penerimaan BERBEDA tidak saling mengganggu ===')
const ridX = await freshReceiving('S5x')
const ridY = await freshReceiving('S5y')
const H = await connect()
const hx = await appInsert(H, ridX, 'Admin X', null)
const hy = await appInsert(H, ridY, 'Admin Y', null)
check('S5a keduanya masuk (slot terpisah per penerimaan)', hx.ok === true && hy.ok === true, `${hx.ok}/${hy.ok}`)
await H.end()

// ===========================================================================
console.log('\n=== S6. BUG-W2: partial unique index BISA dibuat & TIDAK memblokir bertahap ===')
// Index dibuat di cluster LOKAL ini lalu DI-DROP. Tidak ada DDL ke Supabase.
const ridS6 = await freshReceiving('S6')
let idxCreated = false
try {
  await q(`create unique index probe_run245_partial_uniq on handovers (receiving_id) where diserahkan_at is null`)
  idxCreated = true
  check('S6a index parsial (receiving_id) WHERE diserahkan_at IS NULL DAPAT dibuat', true)
} catch (e) {
  check('S6a index parsial DAPAT dibuat', false, e.message)
}
if (idxCreated) {
  const J = await connect()
  const j1 = await appInsert(J, ridS6, 'Admin J1', null)
  let rejected = null
  try {
    // id ACAK (meniru SQL manual / jalur di luar aplikasi) — index-lah yang
    // menahannya, bukan id slot.
    await J.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date)
      values ($1,$2,'Manual','DRAFT',current_date)`, [ridS6, prj])
  } catch (e) { rejected = e.code }
  check('S6b dokumen aktif kedua DITOLAK index (23505) — bahkan dari jalur luar aplikasi',
    j1.ok === true && rejected === '23505', `j1=${j1.ok} manual=${rejected}`)
  await J.query(`update handovers set status='CONFIRMED', diserahkan_at=now() where id=$1`, [j1.id])
  let stagedOk = true
  try {
    await J.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date)
      values ($1,$2,'Manual 2','DRAFT',current_date)`, [ridS6, prj])
  } catch (e) { stagedOk = false }
  check('S6c serah terima BERTAHAP tetap SAH dengan index terpasang', stagedOk === true)
  check('S6d penerimaan lain tidak terpengaruh index', (await countActive(ridS3)) === 1)
  await J.end()
  await q('drop index if exists probe_run245_partial_uniq')
  check('S6e index uji sudah DI-DROP lagi (tidak ada DDL tertinggal)', (await q(
    `select 1 from pg_indexes where indexname='probe_run245_partial_uniq'`)).length === 0)
}

// ===========================================================================
console.log('\n=== S7. BUKTI mekanisme LAMA (run 243) memang gagal pada urutan yang sama ===')
// Reproduksi apa adanya: TANPA id deterministik, urutan aplikasi menghasilkan
// dua dokumen. Ini yang membuat klaim run 243 harus dicabut, bukan diperbaiki
// dengan kata-kata.
const ridS7 = await freshReceiving('S7')
const K = await connect()
const L = await connect()
await K.query('begin')
const kIns = (await K.query(
  `insert into handovers (receiving_id, project_id, received_by, status, handover_date, created_at)
   values ($1,$2,'Lama A','DRAFT',current_date,'2026-10-21T06:00:00.000Z') returning id`, [ridS7, prj])).rows[0]
await L.query('begin')
const lIns = (await L.query(
  `insert into handovers (receiving_id, project_id, received_by, status, handover_date, created_at)
   values ($1,$2,'Lama B','DRAFT',current_date,'2026-10-21T06:00:01.000Z') returning id`, [ridS7, prj])).rows[0]
await L.query('commit')
const bSees = (await L.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [ridS7])).rows
await K.query('commit')
const aSees = (await K.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [ridS7])).rows
note(`B melihat ${bSees.length} · A melihat ${aSees.length}`)
check('S7a mekanisme lama memang menghasilkan DUA dokumen aktif (cacat run 244 terbukti)',
  (await countActive(ridS7)) === 2, `aktif=${await countActive(ridS7)}`)
check('S7b keduanya tidak menarik diri (A kanonik, B tidak melihat A)',
  bSees.length === 1 && aSees.length === 2, `B=${bSees.length} A=${aSees.length}`)
await K.end(); await L.end()

// Mekanisme BARU pada keadaan yang sama: id deterministik menolak yang kedua.
const ridS7b = await freshReceiving('S7b')
const M = await connect()
const N = await connect()
await M.query('begin'); await N.query('begin')
const mRes = await appInsert(M, ridS7b, 'Baru A', '2026-10-21T06:10:00.000Z')
const nPromise = appInsert(N, ridS7b, 'Baru B', '2026-10-21T06:10:01.000Z')
await new Promise(r => setTimeout(r, 300))
await M.query('commit')
const nRes = await nPromise
check('S7c mekanisme BARU pada urutan yang sama: hanya SATU masuk',
  (mRes.ok ? 1 : 0) + (nRes.ok ? 1 : 0) === 1, `M=${mRes.ok} N=${nRes.ok}/${nRes.code}`)
await N.query('rollback')
check('S7d keadaan akhir mekanisme baru: SATU dokumen', (await countRows(ridS7b)) === 1,
  `baris=${await countRows(ridS7b)}`)
await M.end(); await N.end()

// Bersihkan baris uji supaya cluster bersama tidak menumpuk (bukan data live).
await q(`delete from handovers where received_by like 'Admin %'`)
await q(`delete from handovers where received_by like 'Lama %'`)
await q(`delete from handovers where received_by like 'Baru %'`)
await q(`delete from handovers where received_by in ('Manual','Manual 2')`)

console.log(`\n=== HASIL PROBE SLOT (run 245): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('TEMUAN: ' + failures.join(' | '))
await admin.end()
process.exit(fail ? 1 : 0)
