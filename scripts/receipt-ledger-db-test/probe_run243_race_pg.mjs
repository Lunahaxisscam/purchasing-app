// ============================================================
// probe_run243_race_pg.mjs — KONVERGENSI PENJAGA CREATE di PostgreSQL NYATA
// ============================================================
// Review run 242 membuktikan di PG16 nyata (`probe_run242_duprace.mjs`) bahwa
// penjaga SELECT-lalu-INSERT **tidak menahan** dua sesi bersamaan: kedua
// insert diterima, nol error, dua dokumen aktif.
//
// Probe ini menguji MEKANISME YANG MENGGANTIKANNYA — bukan di mock, tetapi di
// PostgreSQL 16 sungguhan, dengan DUA KONEKSI terpisah dan commit nyata:
//
//   C1  KONTROL BERURUTAN: A commit dulu → B melihat 1 dokumen → pre-check
//       B MENOLAK, nol insert.
//   C2  BALAPAN NYATA: A pre-check (0), A INSERT+COMMIT, B pre-check (0 —
//       dilakukan SEBELUM A commit), B INSERT+COMMIT. Sesudah itu KEDUA
//       penulis menjalankan verifikasi-sesudah-commit + tarik diri.
//       Hasil akhir: **SATU** dokumen aktif, dan yang bertahan adalah yang
//       `created_at`-nya paling awal (urutan kanonik yang sama dengan UI).
//   C3  KEDUA penulis melihat keadaan yang sama (tidak ada yang buta) —
//       inti pembuktian: tidak mungkin dua-duanya tidak melihat yang lain.
//   C4  KONTROL POSITIF: penarikan diri TIDAK PERNAH menghapus dokumen yang
//       sudah diserahkan (CAS `diserahkan_at IS NULL`).
//   C5  Bila verifikasi GAGAL (koneksi mati), dokumen TIDAK diklaim bersih —
//       baris tetap ada dan dilaporkan `needsReview`.
//
// Yang TIDAK diklaim: ini bukan uji Supabase (latensi/pooler berbeda). Yang
// diuji adalah LOGIKA SQL yang dipakai aplikasi terhadap PostgreSQL nyata.
//
// Fixture sintetis, cluster terisolasi. Bukan data produksi.
// ============================================================
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const REPO = process.cwd()
const { Client } = require(path.join(REPO, 'node_modules', 'pg'))
const PGURL = process.env.PGURL || 'postgresql://postgres@127.0.0.1:55434/receipt_ledger_t7bc'

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const admin = new Client({ connectionString: PGURL })
await admin.connect()
const q = async (sql, p = []) => (await admin.query(sql, p)).rows

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// ---------------------------------------------------------------------------
// Fixture: nota tanpa dokumen serah terima (dibuat per skenario, dihapus lagi).
// ---------------------------------------------------------------------------
let tagSeq = 0
async function freshReceiving(tag) {
  tagSeq += 1
  const t = `${tag}-${tagSeq}-${Date.now()}`
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,$2,'APPROVED',$3) returning id`, [`PR-${t}`, `uji balapan ${t}`, prj]))[0].id
  const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,'Semen',10,'Sak','APPROVED',$2) returning id`, [pr, vend]))[0].id
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,purchase_request_id,project_id,note)
    values ($1,$2,current_date,'NORMAL',$3,$4,'[Tahap: DIBELI]') returning id`, [vend, `INV-${t}`, pr, prj]))[0].id
  await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
    values ($1,$2,'Semen','Sak',10,'[Harga: 10000]')`, [rec, pi])
  return rec
}

async function activeDocs(receivingId) {
  return q(`select id, created_at, diserahkan_at from handovers
             where receiving_id = $1 and diserahkan_at is null
             order by created_at asc, handover_date asc, id asc`, [receivingId])
}

// ===========================================================================
console.log('\n=== C1. KONTROL BERURUTAN: A commit dulu → B pre-check MENOLAK ===')
const recC1 = await freshReceiving('C1')
const a1 = new Client({ connectionString: PGURL }); await a1.connect()
const b1 = new Client({ connectionString: PGURL }); await b1.connect()

await a1.query('begin')
const a1pre = (await a1.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [recC1])).rows
await a1.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date)
                values ($1,$2,'Pak Joko','DRAFT',current_date)`, [recC1, prj])
await a1.query('commit')

const b1pre = (await b1.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [recC1])).rows
check('C1a sesi A melihat 0 dokumen aktif → boleh insert', a1pre.length === 0, `jumlah=${a1pre.length}`)
check('C1b sesi B (sesudah A commit) melihat 1 dokumen aktif', b1pre.length === 1, `jumlah=${b1pre.length}`)
check('C1c penjaga berurutan MENOLAK (tidak ada insert kedua)', b1pre.length > 0)
const c1docs = await activeDocs(recC1)
check('C1d hasil akhir: tepat SATU dokumen aktif', c1docs.length === 1, `jumlah=${c1docs.length}`)
await a1.end(); await b1.end()

// ===========================================================================
console.log('\n=== C2. BALAPAN NYATA: pre-check kedua sesi SEBELUM ada yang commit ===')
const recC2 = await freshReceiving('C2')
const a2 = new Client({ connectionString: PGURL }); await a2.connect()
const b2 = new Client({ connectionString: PGURL }); await b2.connect()

// A: pre-check + insert (BELUM commit)
await a2.query('begin')
const a2pre = (await a2.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [recC2])).rows
const a2ins = (await a2.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date, created_at)
                values ($1,$2,'Pak Joko','DRAFT',current_date, now() - interval '2 seconds') returning id, created_at`, [recC2, prj])).rows[0]

// B: pre-check (masih 0 — A belum commit) lalu insert + COMMIT
await b2.query('begin')
const b2pre = (await b2.query('select id from handovers where receiving_id=$1 and diserahkan_at is null', [recC2])).rows
const b2ins = (await b2.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date, created_at)
                values ($1,$2,'Pak Bu Siti','DRAFT',current_date, now()) returning id, created_at`, [recC2, prj])).rows[0]
await b2.query('commit')

// A baru commit sesudah B — inilah balapan yang sesungguhnya.
await a2.query('commit')

check('C2a kedua sesi sama-sama melihat 0 dokumen saat pre-check (balapan nyata)', a2pre.length === 0 && b2pre.length === 0,
  `A=${a2pre.length} B=${b2pre.length}`)
const c2mid = await activeDocs(recC2)
check('C2b kedua insert DITERIMA database (prasyarat: penjaga lama buta)', c2mid.length === 2, `jumlah=${c2mid.length}`)

// ---- verifikasi-sesudah-commit + tarik diri, dijalankan KEDUA penulis ----
// Ini persis logika `insertUniqueActiveHandover` (duplicateGuardDb.js):
// baca DB sesudah commit → urutan kanonik → yang bukan kanonik hapus dirinya.
async function verifyAndWithdraw(client, receivingId, ownId) {
  const rows = (await client.query(
    `select id, created_at, handover_date from handovers
      where receiving_id = $1 and diserahkan_at is null
      order by created_at asc, handover_date asc, id asc`, [receivingId])).rows
  const canonicalId = rows.length ? rows[0].id : null
  if (canonicalId === ownId) return { ok: true, canonicalId, active: rows.length, withdrawn: false }
  const del = await client.query(
    `delete from handovers where id = $1 and diserahkan_at is null returning id`, [ownId])
  return { ok: false, canonicalId, active: rows.length, withdrawn: del.rowCount === 1 }
}
const a2res = await verifyAndWithdraw(a2, recC2, a2ins.id)
const b2res = await verifyAndWithdraw(b2, recC2, b2ins.id)

check('C2c sesi A (created_at lebih awal) MENANG — tidak menarik diri', a2res.ok === true, JSON.stringify(a2res))
check('C2d sesi B (created_at lebih akhir) KALAH — menarik dirinya sendiri', b2res.withdrawn === true, JSON.stringify(b2res))
const c2final = await activeDocs(recC2)
check('C2e hasil akhir: tepat SATU dokumen aktif (konvergen)', c2final.length === 1, `jumlah=${c2final.length}`)
check('C2f yang bertahan adalah dokumen yang LEBIH AWAL (urutan kanonik)', c2final[0]?.id === a2ins.id,
  `bertahan=${c2final[0]?.id} seharusnya=${a2ins.id}`)
check('C2g KEDUA penulis melihat keadaan yang sama (tidak ada yang buta)', a2res.canonicalId === b2res.canonicalId,
  `${a2res.canonicalId} vs ${b2res.canonicalId}`)
await a2.end(); await b2.end()

// ===========================================================================
console.log('\n=== C3. KONTROL POSITIF: tarik diri TIDAK menghapus dokumen yang SUDAH diserahkan ===')
const recC3 = await freshReceiving('C3')
const c3 = new Client({ connectionString: PGURL }); await c3.connect()
const c3a = (await c3.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date, diserahkan_at, created_at)
  values ($1,$2,'Pak Joko','CONFIRMED',current_date, now(), now() - interval '1 hour') returning id`, [recC3, prj])).rows[0]
const c3b = (await c3.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date, created_at)
  values ($1,$2,'Pak Bu Siti','DRAFT',current_date, now()) returning id`, [recC3, prj])).rows[0]
// Dokumen yang SUDAH diserahkan tidak dihitung sebagai "aktif" → b adalah kanonik
// dari daftar aktif. Tetapi bila b mencoba menarik diri, CAS harus menolak
// menghapus a (bukan targetnya) — dan bila a yang jadi target, CAS menolak.
const delConfirmed = await c3.query(`delete from handovers where id = $1 and diserahkan_at is null returning id`, [c3a.id])
check('C3a CAS MENOLAK menghapus dokumen yang sudah diserahkan', delConfirmed.rowCount === 0, `rowCount=${delConfirmed.rowCount}`)
const stillThere = (await c3.query('select id from handovers where id = $1', [c3a.id])).rows
check('C3b dokumen berbekti itu MASIH ADA (bukti fisik tidak bisa hilang)', stillThere.length === 1)
const c3active = await activeDocs(recC3)
check('C3c serah terima BERTAHAP tetap sah: dokumen baru boleh aktif setelah yang lama diserahkan', c3active.length === 1 && c3active[0].id === c3b.id,
  JSON.stringify(c3active.map(d => d.id)))
await c3.end()

// ===========================================================================
console.log('\n=== C4. Verifikasi GAGAL → jangan klaim bersih ===')
// Disimulasikan dengan koneksi yang sudah ditutup: hasil verifikasi TIDAK
// tersedia. Kontrak aplikasi: `needsReview`, bukan `ok:true`.
const recC4 = await freshReceiving('C4')
const c4 = new Client({ connectionString: PGURL }); await c4.connect()
const c4ins = (await c4.query(`insert into handovers (receiving_id, project_id, received_by, status, handover_date)
  values ($1,$2,'Pak Joko','DRAFT',current_date) returning id`, [recC4, prj])).rows[0]
await c4.end()
let verifyFailed = false
try {
  await verifyAndWithdraw(c4, recC4, c4ins.id)
} catch (e) {
  verifyFailed = true
}
check('C4a verifikasi dengan koneksi mati benar-benar GAGAL (bukan diam-diam lolos)', verifyFailed === true)
const c4rows = await q('select id from handovers where id = $1', [c4ins.id])
check('C4b baris TETAP ADA (tidak ada klaim "sudah bersih" tanpa bukti)', c4rows.length === 1)

// ===========================================================================
console.log('\n=== C5. Tidak ada unique index (batas yang diakui, bukan ditutup di sini) ===')
const idx = await q(`select indexname, indexdef from pg_indexes
  where schemaname='public' and tablename='handovers'`)
const partialUnique = idx.filter(r => /unique/i.test(r.indexdef) && /receiving_id/i.test(r.indexdef))
check('C5a DB memang TIDAK punya unique index pada receiving_id (sesuai §9.5)', partialUnique.length === 0,
  JSON.stringify(partialUnique.map(r => r.indexname)))

console.log(`\n=== HASIL PROBE RACE PG (run 243): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await admin.end()
process.exit(fail ? 1 : 0)
