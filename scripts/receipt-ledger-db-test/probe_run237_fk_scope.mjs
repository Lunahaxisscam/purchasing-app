// ============================================================
// probe_run237_fk_scope.mjs — KEJUJURAN CAKUPAN penjaga hapus (run 237)
// ============================================================
// Penjaga aplikasi (`modules/handovers/deleteGuard.js`) hanya boleh
// MENCERMINKAN kenyataan database — tidak lebih longgar (tombol dijanjikan
// berhasil lalu gagal dengan pesan SQL mentah) dan tidak lebih ketat
// (pekerjaan sah diblokir).
//
// Probe ini menetapkan kebenaran itu di PostgreSQL NYATA:
//
//   F1  FK `handovers.receiving_id → receivings(id)` TIDAK cascade
//       → hapus NOTA yang punya serah terima APA PUN (bahkan DRAFT) DITOLAK
//       database dengan 23503 + pesan mentah.
//   F2  Karena itu penjaga aplikasi untuk `receivings` harus menolak SEMUA
//       nota yang punya serah terima — bukan hanya yang berbekti. Kalau
//       aplikasi mengizinkan, admin melihat "berhasil dihapus" (optimistic
//       update) lalu barisnya kembali dengan pesan constraint.
//   F3  FK `handover_items.handover_id → handovers(id)` CASCADE
//       → hapus dokumen serah terima MENGHAPUS rinciannya (defect utama).
//   F4  `handover_items.receiving_event_id → receiving_events(id)` RESTRICT
//       → rantai hapus nota lewat events juga tertahan.
//   F5  Hapus PR yang punya nota ditolak `pr_items_pr_id_fkey` (23503) —
//       di luar cakupan penjaga ini, dicatat supaya tidak diklaim tertutup.
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
async function sqlSafe(sql, p = []) {
  try { return { rows: (await client.query(sql, p)).rows } } catch (e) { return { error: e.message, code: e.code } }
}

const prj = (await q('select id from projects limit 1'))[0].id
const vend = (await q('select id from vendors limit 1'))[0].id

// ---------------------------------------------------------------- F1–F4
console.log('\n=== F1–F4. Definisi FK yang menentukan kebenaran penjaga ===')
const fks = await q(`
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint
   where contype = 'f'
     and (confrelid = 'public.receivings'::regclass
          or confrelid = 'public.handovers'::regclass
          or confrelid = 'public.receiving_events'::regclass)
   order by 1, 2`)
const fk = (tbl, col) => fks.find(f => f.tbl === tbl && f.def.includes(`(${col})`))
const hoRecv = fk('handovers', 'receiving_id')
const hiHo = fk('handover_items', 'handover_id')
const hiEv = fk('handover_items', 'receiving_event_id')

check('F1a FK handovers.receiving_id ADA', !!hoRecv, JSON.stringify(fks.map(f => f.tbl + ':' + f.def)))
check('F1b … dan TIDAK cascade (tanpa ON DELETE CASCADE)',
  !!hoRecv && !/on delete cascade/i.test(hoRecv.def), hoRecv?.def)
check('F3a FK handover_items.handover_id CASCADE (rincian ikut terhapus)',
  !!hiHo && /on delete cascade/i.test(hiHo.def), hiHo?.def)
check('F4a FK handover_items.receiving_event_id RESTRICT',
  !!hiEv && /on delete restrict/i.test(hiEv.def), hiEv?.def)

// Bukti perilaku, bukan hanya definisi: hapus nota yang hanya punya DRAFT.
console.log('\n=== F2. Perilaku nyata: hapus NOTA dengan serah terima DRAFT ===')
const rec = (await q(`insert into receivings (vendor_id,invoice_no,received_date,status,project_id,note)
  values ($1,'INV-F2',current_date,'NORMAL',$2,'[Tahap: DIBELI]') returning id`, [vend, prj]))[0].id
await q(`insert into handovers (receiving_id,project_id,received_by,handover_date,status)
  values ($1,$2,'Pak Joko',current_date,'DRAFT')`, [rec, prj])
const delRec = await sqlSafe('delete from receivings where id=$1', [rec])
check('F2a hapus nota DITOLAK database walau serah terimanya masih DRAFT',
  delRec.code === '23503' && /handovers_receiving_id_fkey/.test(delRec.error || ''),
  JSON.stringify(delRec).slice(0, 300))
check('F2b pesannya mentah (tidak ada penjelasan untuk admin) — karena itu penjaga aplikasi perlu',
  /violates foreign key constraint/i.test(delRec.error || ''), String(delRec.error || '').slice(0, 160))
check('F2c nota tetap utuh', (await q('select count(*)::int as n from receivings where id=$1', [rec]))[0].n === 1)

// ---------------------------------------------------------------- F5
console.log('\n=== F5. Di luar cakupan: hapus PR yang punya nota ===')
const pr = (await q(`insert into purchase_requests (pr_number,title,status,project_id)
  values ('PR-F5','uji','APPROVED',$1) returning id`, [prj]))[0].id
await q(`insert into receivings (vendor_id,invoice_no,received_date,status,purchase_request_id,project_id,note)
  values ($1,'INV-F5',current_date,'NORMAL',$2,$3,'[Tahap: DIBELI]')`, [vend, pr, prj])
const delPr = await sqlSafe('delete from purchase_requests where id=$1', [pr])
check('F5a hapus PR ditolak FK (23503) — perilaku lama, TIDAK diklaim ditutup card ini',
  delPr.code === '23503', JSON.stringify(delPr).slice(0, 250))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
if (failures.length) console.log('GAGAL: ' + failures.join(' | '))
await client.end()
process.exit(fail ? 1 : 0)
