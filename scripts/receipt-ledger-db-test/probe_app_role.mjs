// ============================================================
// probe_app_role.mjs — apakah role APLIKASI (authenticated) benar-benar bisa
// memakai semua yang dibutuhkan mode READY?
// ============================================================
// Mode READY ditentukan `receiptCapability.getReceiptCapability()`: keempat
// objek harus bisa di-SELECT oleh sesi user biasa (bukan superuser, bukan
// service_role). Paket migrasi 00..04 diuji dengan role `postgres`, sehingga
// masalah GRANT tidak terlihat sama sekali.
//
// Skrip ini menjalankan pengujian sebagai role `authenticated` pada cluster
// terisolasi (setelah `run.py`), dan melaporkan apa adanya:
//
//   A1  keempat tabel ledger bisa dibaca
//   A2  view v_receipt_progress bisa dibaca  ← kalau gagal, READY mustahil
//   A3  receiving_items.qty_arrived bisa dibaca (jalur data form)
//   A4  ketiga RPC bisa DIPANGGIL (bukan "permission denied")
//   A5  anon TIDAK bisa membaca ledger (postur keamanan tetap)
//
// Jalankan: PGURL=... node scripts/receipt-ledger-db-test/probe_app_role.mjs
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

const c = new Client({ connectionString: PGURL })
await c.connect()
const q = async (sql, p = []) => (await c.query(sql, p)).rows

const uid = (await q('select id::text from receivings limit 1'))[0]?.id || null

// Jalankan fn() di dalam transaksi sebagai role tertentu (selalu rollback).
async function asRole(role, fn) {
  await c.query('begin')
  await c.query(`set local role ${role}`)
  if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid])
  try { return await fn() } finally { await c.query('rollback') }
}
const tryRead = async (role, table) => {
  try {
    const r = await asRole(role, () => q(`select count(*)::int n from public.${table}`))
    return { ok: true, n: r[0].n }
  } catch (e) { return { ok: false, error: e.message } }
}

console.log('\n=== A1/A2. Role `authenticated` membaca objek yang diprobe aplikasi ===')
const tables = ['receiving_events', 'handover_items', 'return_cases', 'return_lines']
for (const t of tables) {
  const r = await tryRead('authenticated', t)
  check(`A1 ${t} bisa dibaca`, r.ok === true, r.error || '')
}
const view = await tryRead('authenticated', 'v_receipt_progress')
// Ini yang menentukan mode READY. Kalau gagal, jangan ditambal di aplikasi —
// grant adalah keputusan schema owner (t_03b41644).
check('A2 v_receipt_progress bisa dibaca (SYARAT mode READY)', view.ok === true,
  view.error ? `${view.error} → tanpa grant ini ready SELALU false` : '')

console.log('\n=== A3. Kolom turunan yang dipakai form ===')
{
  let err = ''
  try {
    await asRole('authenticated', () => q('select qty_arrived, qty_handed_over from public.receiving_items limit 1'))
  } catch (e) { err = e.message }
  check('A3 receiving_items.qty_arrived/qty_handed_over bisa dibaca', !err, err)
}

console.log('\n=== A4. RPC bisa DIPANGGIL sebagai authenticated (bukan permission denied) ===')
const rpcCalls = [
  ['receipt_apply_events', `select public.receipt_apply_events($1, '[]'::jsonb, '{}'::jsonb) out`, [uid]],
  ['handover_confirm', `select public.handover_confirm($1, '[]'::jsonb) out`, [uid]],
  ['return_create', `select public.return_create($1, '[]'::jsonb, 'RETURN', null) out`, [uid]]
]
for (const [name, sql, params] of rpcCalls) {
  let out = null, err = ''
  try {
    const r = await asRole('authenticated', () => q(sql, params))
    out = r[0]?.out
  } catch (e) { err = e.message }
  // Payload kosong => RPC menjawab ok:false dengan alasan domain (empty_*).
  // Yang diuji: BUKAN permission denied.
  const denied = /permission denied/i.test(err)
  check(`A4 ${name} bisa dipanggil (bukan permission denied)`, !denied,
    denied ? err : `out=${JSON.stringify(out)}`)
}

console.log('\n=== A5. anon TIDAK boleh membaca ledger ===')
for (const t of [...tables, 'v_receipt_progress']) {
  const r = await tryRead('anon', t)
  check(`A5 anon ditolak di ${t}`, r.ok === false, r.ok ? `bocor: n=${r.n}` : '')
}

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)
// Exit code 2 = aplikasi/role OK, tetapi ada BLOCKER skema (grant view).
// Dibedakan dari 1 (regresi) supaya harness tidak "merah" karena hal yang
// memang belum boleh diperbaiki di sini — tetapi tetap TIDAK hijau, karena
// hijau berarti "siap DDL" dan itu tidak benar.
if (fail) {
  const blocker = !view.ok
  console.log(blocker
    ? 'BLOCKER SKEMA: A2 gagal → mode READY tidak akan pernah menyala.\n'
      + '  Grant view adalah DDL milik schema owner t_03b41644, bukan kode aplikasi.'
    : 'CATATAN: kegagalan di atas adalah temuan untuk schema owner t_03b41644.')
  await c.end()
  process.exit(blocker ? 2 : 1)
}
await c.end()
process.exit(0)
