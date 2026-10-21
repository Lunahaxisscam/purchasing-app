// ============================================================
// probe_run242_duprace.mjs — APAKAH PENJAGA "SATU DOKUMEN AKTIF" BERTAHAN
// TERHADAP DUA SESI BERSAMAAN? (review run 242)
// ============================================================
// Run 239 menutup defect "dua dokumen aktif" untuk jalur KONFIRMASI
// (`handover_confirm` mengunci per dokumen). Untuk jalur PEMBUATAN
// (`save.js` mode TAMBAH) penjaganya adalah:
//
//     SELECT ... FROM handovers WHERE receiving_id=$1 AND diserahkan_at IS NULL
//     -- bila kosong --
//     INSERT INTO handovers (...)
//
// Itu pola check-then-act TANPA kunci dan TANPA constraint unik. Pertanyaannya
// sederhana: bila dua sesi menjalankannya BERSAMAAN, apakah penjaganya
// bertahan? Skrip ini menjalankan URUTAN PERSIS itu di PostgreSQL NYATA
// dengan dua koneksi terpisah — bukan menebak dari kode.
//
//   R1  KONTROL BERURUTAN: sesi A commit dulu → sesi B melihat 1 dokumen →
//       aplikasi (handoverCreateGuard) MENOLAK. Aturan berurutan benar.
//   R2  BERSAMAAN: kedua sesi SELECT sebelum salah satu COMMIT → KEDUANYA
//       menyimpulkan "belum ada dokumen aktif" → KEDUANYA INSERT → 2 dokumen
//       aktif. Penjaga aplikasi TERLEWATI.
//   R3  Tidak ada constraint/index yang menahan (sengaja: serah terima
//       bertahap sah) → database menerima keduanya tanpa satu pun error.
//   R4  Akibat lanjutan: dua dokumen aktif itu kini bisa dikonfirmasi
//       keduanya → rincian melebihi kuota (kelas defect run 239 hidup lagi,
//       hanya jalan masuknya berbeda).
//
// Jalankan: node probe_run242_duprace.mjs   (PGURL=...)
// ============================================================
import pg from 'pg'

const URL = process.env.PGURL
if (!URL) { console.error('PGURL tidak ada'); process.exit(2) }

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}   ${extra}`) }
}

const c = new pg.Client({ connectionString: URL })
await c.connect()

// --- Siapkan satu penerimaan + alokasi tukang yang bersih ----------------
await c.query('begin')
const pr = await c.query(`insert into purchase_requests (pr_number, title, project_id, status)
  select 'PR-R242', 'Probe race run242', id, 'APPROVED' from projects order by created_at limit 1
  returning id, project_id`).catch(async e => { throw e })
const prId = pr.rows[0].id
const projId = pr.rows[0].project_id
const pitem = await c.query(`insert into pr_items (pr_id, item_name, unit, quantity, status)
  values ($1,'Semen race','sak',5,'APPROVED') returning id`, [prId])
const prItemId = pitem.rows[0].id
const rec = await c.query(`insert into receivings (purchase_request_id, project_id, vendor_id, invoice_no, delivery_note, received_date, status)
  select $1, $2, (select id from vendors order by created_at limit 1), 'RACE-242', 'Nota RACE-242', current_date, 'DIBELI'
  returning id`, [prId, projId])
const recId = rec.rows[0].id
await c.query(`insert into receiving_items (receiving_id, pr_item_id, item_name, unit, quantity_received)
  values ($1,$2,'Semen race','sak',5)`, [recId, prItemId])
await c.query('commit')

// --- Bukti: TIDAK ADA unique index / constraint yang bisa menahan --------
const idx = await c.query(`select indexdef from pg_indexes where tablename='handovers'`)
const uniq = idx.rows.map(r => r.indexdef).filter(d => /unique/i.test(d) && /receiving_id/i.test(d))
check('R0  tidak ada unique index pada handovers(receiving_id) — DB memang tidak menahan',
  uniq.length === 0, JSON.stringify(uniq))

// SQL PERSIS yang dijalankan save.js (lihat modules/handovers/save.js:89-93)
const SELECT_ACTIVE = `select id, receiving_id, handover_date, created_at, diserahkan_at
  from handovers where receiving_id = $1 and diserahkan_at is null`
const INSERT_DRAFT = `insert into handovers (receiving_id, project_id, received_by, status, handover_date, note)
  values ($1,$2,'Belum ditentukan','DRAFT',current_date,null) returning id`

// ============================ R1: KONTROL BERURUTAN =====================
const a = new pg.Client({ connectionString: URL }); await a.connect()
const b = new pg.Client({ connectionString: URL }); await b.connect()

await a.query('begin')
const aSees = (await a.query(SELECT_ACTIVE, [recId])).rows
const aIns = await a.query(INSERT_DRAFT, [recId, projId])
await a.query('commit')

await b.query('begin')
const bSees = (await b.query(SELECT_ACTIVE, [recId])).rows
// Aplikasi: handoverCreateGuard({ receiving, handovers: bSees })
const bGuardOk = bSees.length === 0
await b.query('rollback')

check('R1a sesi A (pertama) melihat 0 dokumen aktif → boleh insert', aSees.length === 0)
check('R1b sesi B (berurutan, A sudah commit) melihat 1 dokumen aktif → penjaga MENOLAK',
  bSees.length === 1 && bGuardOk === false, `bSees=${bSees.length}`)

// bersihkan supaya R2 mulai dari nol
await c.query(`delete from handovers where receiving_id=$1`, [recId])

// ============================ R2: BERSAMAAN ============================
await a.query('begin'); await b.query('begin')
// kedua sesi membaca SEBELUM salah satu menulis — persis dua admin menekan
// Simpan pada saat yang hampir sama (READ COMMITTED: tidak saling melihat)
const aSees2 = (await a.query(SELECT_ACTIVE, [recId])).rows
const bSees2 = (await b.query(SELECT_ACTIVE, [recId])).rows
const aGuard2 = aSees2.length === 0
const bGuard2 = bSees2.length === 0
const aIns2 = await a.query(INSERT_DRAFT, [recId, projId])
const bIns2 = await b.query(INSERT_DRAFT, [recId, projId])
await a.query('commit')
let bCommitErr = null
try { await b.query('commit') } catch (e) { bCommitErr = e.message; await b.query('rollback').catch(() => {}) }

const active = (await c.query(SELECT_ACTIVE, [recId])).rows
check('R2a kedua sesi sama-sama melihat 0 dokumen aktif (penjaga kedua-duanya lolos)',
  aSees2.length === 0 && bSees2.length === 0, `a=${aSees2.length} b=${bSees2.length}`)
check('R2b handoverCreateGuard pada kedua sesi sama-sama ok:true', aGuard2 && bGuard2)
check('R2c KEDUA insert diterima database tanpa error', !bCommitErr, String(bCommitErr))
check('R2d hasil akhir: 2 DOKUMEN AKTIF untuk satu penerimaan (defect run 239 hidup lagi)',
  active.length === 2, `active=${active.length}`)

// ============================ R3: akibat lanjutan =======================
// Dua dokumen aktif = dua kunci advisory berbeda di handover_confirm
// (handover:<id>) → keduanya bisa menulis rincian untuk barang yang sama.
check('R3  dua dokumen itu masih AKTIF (belum diserahkan) → keduanya masih bisa dikonfirmasi',
  active.every(r => r.diserahkan_at === null))

console.log(`\n=== HASIL PROBE RACE: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await a.end(); await b.end(); await c.end()
process.exit(fail ? 1 : 0)
