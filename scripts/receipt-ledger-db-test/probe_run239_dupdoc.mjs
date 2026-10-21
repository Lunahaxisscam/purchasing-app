// ============================================================
// probe_run239_dupdoc.mjs — DUA DOKUMEN untuk SATU PENERIMAAN (run 239)
// ============================================================
// LENSA KEENAM. Run 101..237 memakai: simpan, tampil, kesiapan, retur,
// waktu/snapshot (capability basi), dan hapus. Yang belum pernah diuji:
// DUA DOKUMEN pada SATU PENERIMAAN — dan apakah penguncian server menahannya.
//
// Kenapa ini bukan skenario karangan:
//   1. `purchaseSave.js` membuat SATU dokumen DRAFT otomatis per nota, tetapi
//      idempoten HANYA untuk pembuatan otomatis itu (SELECT dulu, baru INSERT).
//   2. Modul Handover punya tombol "+ Tambah Serah Terima" yang memilih
//      Penerimaan dari daftar. `save.js` mode TAMBAH tidak memeriksa apakah
//      penerimaan itu sudah punya dokumen yang belum diserahkan.
//   3. `handover_confirm` mengunci `handover:<id>` — per DOKUMEN, dan cek kuota
//      dilakukan SEBELUM baris `receiving_items` dikunci.
//
// Yang diuji di PostgreSQL NYATA:
//   S1  Dua dokumen DRAFT untuk satu penerimaan diterima database.
//   S2  KONTROL berurutan (commit dulu) → dokumen kedua DITOLAK kuota.
//       Jadi aturan kuotanya benar; yang diuji berikutnya adalah KESEGARAN.
//   S3  BERSAMAAN (dua koneksi, transaksi terbuka) → KEDUA dokumen ok:true,
//       total rincian 2× kuota, tanpa error.
//   S4  Akibat turunan: belum_diserahkan NEGATIF, qty_handed_over tidak
//       sinkron, checker integritas menandai mismatch.
//   S5  Mengapa bisa: serialisasi ADA tetapi TERLAMBAT. Transaksi kedua
//       menunggu di baris `receiving_items` (row lock), BUKAN di kunci
//       advisory — jadi cek kuotanya sudah selesai sebelum menunggu.
//       Dibuktikan dari `pg_locks` saat transaksi kedua benar-benar menunggu.
//
// Fixture sintetis, PG16 terisolasi. Bukan data produksi.
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

const client = new Client({ connectionString: PGURL })
await client.connect()
const q = async (sql, p = []) => (await client.query(sql, p)).rows

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// ---------------------------------------------------------------------------
// Fixture: 1 nota, 1 barang, DATANG 10 — 5 Workshop + 5 Tukang.
// Kuota tukang = 5, jadi penyerahan 2×5 MUSTAHIL sah.
// ---------------------------------------------------------------------------
async function fixture(tag) {
  const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
    values ($1,$2,'APPROVED',$3) returning id`, [`PR-${tag}`, `uji dokumen ganda ${tag}`, prj]))[0].id
  const pi = (await q(`insert into pr_items (pr_id,item_name,quantity,unit,status,vendor_id)
    values ($1,'Semen',10,'Sak','APPROVED',$2) returning id`, [pr, vend]))[0].id
  const rec = (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,purchase_request_id,project_id,note)
    values ($1,$2,current_date,'NORMAL',$3,$4,'[Tahap: DIBELI]') returning id`, [vend, `INV-${tag}`, pr, prj]))[0].id
  const ri = (await q(`insert into receiving_items (receiving_id,pr_item_id,item_name,unit,quantity_received,note)
    values ($1,$2,'Semen','Sak',10,'[Harga: 10000]') returning id`, [rec, pi]))[0].id
  const payload = [{
    client_event_id: `${tag}:${rec}:${ri}:0->10`,
    receiving_item_id: ri, pr_item_id: pi, item_name: 'Semen', unit: 'Sak',
    qty_datang: 10, qty_rusak: 0, tujuan_ws: 5, tujuan_tukang: 5,
    penerima_tukang: 'Pak Joko', retur_status: 'NONE', retur_qty: 0,
    discard_confirmed: false, foto_ref: null
  }]
  const applied = await q(`select receipt_apply_events($1,$2::jsonb,'{}'::jsonb) as out`,
    [rec, JSON.stringify(payload)])
  if (applied[0].out?.ok !== true) throw new Error(`fixture ${tag}: ${JSON.stringify(applied[0].out)}`)
  const ev = (await q(`select id from receiving_events where receiving_id=$1`, [rec]))[0].id
  const mkHo = async () => (await q(`insert into handovers (receiving_id,project_id,received_by,handover_date,status)
    values ($1,$2,'Pak Joko',current_date,'DRAFT') returning id`, [rec, prj]))[0].id
  return { tag, pr, rec, ri, ev, mkHo }
}
const lines = (ev) => [{ receiving_event_id: ev, qty_diserahkan: 5, penerima: 'Pak Joko' }]
const rpcOn = (c, ho, ls) => c.query(`select handover_confirm($1,$2::jsonb) as out`, [ho, JSON.stringify(ls)])
// `handover_confirm` RAISE (bukan return ok:false) saat kuota dilanggar —
// transaksi rollback, CAS batal. Harus ditangkap supaya probe tidak mati.
async function rpcSafeOn(c, ho, ls) {
  try { return (await rpcOn(c, ho, ls)).rows[0].out } catch (e) { return { thrown: e.message, code: e.code } }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------
console.log('\n=== S1. Dua dokumen DRAFT untuk SATU penerimaan (prasyarat) ===')
const f = await fixture('DUP-1')
const hoA = await f.mkHo()
const hoB = await f.mkHo()
const hoCount = Number((await q(`select count(*) as n from handovers where receiving_id=$1 and diserahkan_at is null`, [f.rec]))[0].n)
check('S1a database menerima 2 dokumen belum-diserahkan untuk 1 penerimaan', hoCount === 2, String(hoCount))
check('S1b keduanya id berbeda (memang dua dokumen, bukan satu baris)', hoA !== hoB)

// ---------------------------------------------------------------------------
console.log('\n=== S2. KONTROL: berurutan (commit dulu) → dokumen kedua DITOLAK ===')
const okA = (await rpcOn(client, hoA, lines(f.ev))).rows[0].out
check('S2a dokumen pertama diterima (5 unit)', okA?.ok === true && okA.inserted === 1, JSON.stringify(okA))
const okBseq = await rpcSafeOn(client, hoB, lines(f.ev))
check('S2b dokumen kedua DITOLAK karena kuota habis (aturan kuota BENAR)',
  okBseq?.ok === false || (!!okBseq?.thrown && /Melebihi alokasi/i.test(String(okBseq?.thrown || ''))),
  JSON.stringify(okBseq).slice(0, 220))
const totSeq = Number((await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items where receiving_event_id=$1`, [f.ev]))[0].n)
check('S2c total rincian tetap 5 (tidak ada penyerahan ganda berurutan)', totSeq === 5, String(totSeq))

// ---------------------------------------------------------------------------
console.log('\n=== S3. BERSAMAAN: dua koneksi, dua dokumen, satu penerimaan ===')
const g = await fixture('DUP-2')
const hoC = await g.mkHo()
const hoD = await g.mkHo()

const cA = new Client({ connectionString: PGURL })
const cB = new Client({ connectionString: PGURL })
await cA.connect()
await cB.connect()

await cA.query('begin')
const resA = (await rpcOn(cA, hoC, lines(g.ev))).rows[0].out
check('S3a dokumen C diterima di dalam transaksi (belum commit)', resA?.ok === true, JSON.stringify(resA))

await cB.query('begin')
// Dijalankan TANPA menunggu commit A — persis dua admin menekan Konfirmasi
// hampir bersamaan pada dua dokumen penerimaan yang sama.
const pendingB = rpcSafeOn(cB, hoD, lines(g.ev))
await sleep(400)
await cA.query('commit')
const resB = await pendingB
let commitBErr = ''
try { await cB.query('commit') } catch (e) { commitBErr = e.message }

check('S3b dokumen D juga DITERIMA (ok:true) — tidak ditolak kuota', resB?.ok === true, JSON.stringify(resB).slice(0, 260))
check('S3c TIDAK ADA error/penolakan dari database', !resB?.thrown && !commitBErr, `${resB?.thrown || ''} ${commitBErr}`)
const totConc = Number((await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items where receiving_event_id=$1`, [g.ev]))[0].n)
const quota = Number((await q(`select tujuan_tukang from receiving_events where id=$1`, [g.ev]))[0].tujuan_tukang)
check(`S3d total rincian ${totConc} MELEBIHI kuota tukang ${quota} — penyerahan ganda tercatat`,
  totConc > quota, `total=${totConc} kuota=${quota}`)
const rowsCnt = Number((await q(`select count(*) as n from handover_items where receiving_event_id=$1`, [g.ev]))[0].n)
check('S3e dua baris rincian dari dua dokumen untuk event yang sama', rowsCnt === 2, String(rowsCnt))

// ---------------------------------------------------------------------------
console.log('\n=== S4. Akibat turunan pada data yang dibaca aplikasi ===')
const prog = (await q(`select qty_datang, qty_handed_over, tujuan_tukang, belum_diserahkan
  from v_receipt_progress where receiving_item_id=$1`, [g.ri]))[0]
check('S4a view: belum_diserahkan NEGATIF (barang "belum diserahkan" minus)',
  Number(prog.belum_diserahkan) < 0, JSON.stringify(prog))
check('S4b view: qty_handed_over melebihi alokasi tukang',
  Number(prog.qty_handed_over) > Number(prog.tujuan_tukang), JSON.stringify(prog))
const col = Number((await q(`select coalesce(qty_handed_over,0) as n from receiving_items where id=$1`, [g.ri]))[0].n)
check('S4c kolom turunan receiving_items.qty_handed_over TIDAK mencerminkan 10 (snapshot sendiri)',
  col !== 10, `qty_handed_over=${col} padahal rincian=10`)
const chk = await q(`select check_name, violations from check_receipt_qty_consistency()`)
const mismatch = Number(chk.find(r => r.check_name === 'qty_handed_over_mismatch')?.violations || 0)
check('S4d checker integritas DB menandai qty_handed_over_mismatch > 0', mismatch > 0, JSON.stringify(chk))

// ---------------------------------------------------------------------------
console.log('\n=== S5. MENGAPA bisa: serialisasi ADA, tetapi TERLAMBAT ===')
const h = await fixture('DUP-3')
const hoFirst = await h.mkHo()
const hoSecond = await h.mkHo()
const cC = new Client({ connectionString: PGURL })
const cE = new Client({ connectionString: PGURL })
await cC.connect(); await cE.connect()

await cC.query('begin')
const firstRes = (await rpcOn(cC, hoFirst, lines(h.ev))).rows[0].out
check('S5a dokumen pertama lolos cek kuota & menulis rincian (belum commit)', firstRes?.ok === true, JSON.stringify(firstRes))

await cE.query('begin')
let secondDone = false
const secondCall = rpcSafeOn(cE, hoSecond, lines(h.ev)).then(r => { secondDone = true; return r })
await sleep(600)
check('S5b transaksi KEDUA benar-benar MENUNGGU (serialisasi ada)', secondDone === false, `secondDone=${secondDone}`)

// Selagi menunggu: apa yang ditunggu, dan kunci apa yang dipegang?
const waitLocks = await q(`select locktype, mode, granted from pg_locks where pid = $1`, [cE.processID])
const advWait = waitLocks.filter(l => l.locktype === 'advisory')
const txWait = waitLocks.filter(l => l.locktype === 'transactionid' && l.granted === false)
const advFirst = await q(`select objid::text as objid from pg_locks
  where pid = $1 and locktype = 'advisory' and granted`, [cC.processID])
const advSecond = await q(`select objid::text as objid from pg_locks
  where pid = $1 and locktype = 'advisory' and granted`, [cE.processID])
// Kunci advisory milik transaksi kedua SUDAH DAPAT (granted) — karena kuncinya
// BERBEDA (dokumen berbeda), ia tidak pernah menunggu di sana. Itulah akarnya:
// serialisasi per-dokumen tidak menjumpai dokumen lain.
check('S5c transaksi kedua MEMEGANG kunci advisory-nya sendiri (tidak menunggu di sana)',
  advWait.length >= 1 && advWait.every(l => l.granted === true), JSON.stringify(advWait))
check('S5d kunci advisory kedua transaksi BERBEDA (kunci per dokumen, bukan per penerimaan)',
  advFirst.length === 1 && advSecond.length === 1 && advFirst[0].objid !== advSecond[0].objid,
  JSON.stringify({ first: advFirst, second: advSecond }))
check('S5e transaksi kedua menunggu di ROW LOCK (transactionid) — yaitu UPDATE receiving_items',
  txWait.length >= 1, JSON.stringify(waitLocks))

await cC.query('commit')
const secondRes = await secondCall
let commitEErr = ''
try { await cE.query('commit') } catch (e) { commitEErr = e.message }
check('S5f setelah dokumen pertama commit, transaksi kedua TETAP diterima (cek kuota sudah lewat)',
  secondRes?.ok === true && !commitEErr, `${JSON.stringify(secondRes).slice(0, 160)} ${commitEErr}`)
const totAfter = Number((await q(`select coalesce(sum(qty_diserahkan),0) as n from handover_items where receiving_event_id=$1`, [h.ev]))[0].n)
check('S5g total rincian menjadi 10 untuk kuota 5 (bukti akhir)', totAfter === 10, String(totAfter))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
await cA.end(); await cB.end(); await cC.end(); await cE.end(); await client.end()
process.exit(fail ? 1 : 0)
