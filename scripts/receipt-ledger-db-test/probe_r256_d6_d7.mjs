// probe_r256_d6_d7.mjs — REVIEW run 255: D6 (janji mustahil) + D7 (diagnosis
// ORPHAN pada dokumen SAH) + regresi yang langsung terkait.
//
// Modul produksi dijalankan apa adanya di atas PostgreSQL 16 (adapter nyata),
// bukan mock yang selalu menjawab "ok".
//
// Env: PGURL, SB (sandbox hasil compile)
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const PGURL = process.env.PGURL
const SB = process.env.SB
const REPO = process.env.REPO || SB
const { Client } = require('pg')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom.window; global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.HTMLInputElement = dom.window.HTMLInputElement
global.HTMLSelectElement = dom.window.HTMLSelectElement
global.Event = dom.window.Event
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const Q = await load('modules/handovers/queue.mjs')
const PM = await load('modules/handovers/physicalModal.mjs')
const CAP = await load('modules/receivings/receiptCapability.mjs')

const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await tick() }
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()
const click = (el) => el && el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))

let pass = 0, fail = 0
const ck = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)

function mount(el) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(el))
  return document
}
const waitFor = async (fn, { label = 'kondisi', tries = 160 } = {}) => {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await tick() }
  throw new Error(`timeout menunggu ${label}`)
}

// Dua koneksi: `su` = superuser (fixture/verifikasi), `c` = sesi `authenticated`
// dengan profil admin (fakta DB yang benar-benar dihadapi aplikasi).
const su = new Client({ connectionString: PGURL })
await su.connect()
const c = new Client({ connectionString: PGURL })
await c.connect()
await c.query('set role authenticated')
await c.query(`select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000001',false)`)
const SBclient = await import(pathToFileURL(path.join(SB, 'lib', 'supabaseClient.mjs')).href)
const admin = SBclient.supabase

// ============================================================
head('D0. Fixture: penerimaan NYATA dengan alokasi ke tukang')
// ============================================================
// Fixture baseline hanya punya nota shell (qty 0, tanpa event). Dokumen sah
// yang "siap dikonfirmasi" butuh event penerimaan nyata — dibuat lewat RPC
// produksi `receipt_apply_events` (bukan INSERT langsung) supaya kontraknya
// ikut diuji.
const REC = 'eeeeeeee-0000-0000-0000-000000000001'
const ITEM = 'ffffffff-0000-0000-0000-000000000001'
// Fixture baseline membuat baris nota dengan `quantity_received = 0` (shell).
// RPC v1 menolak `over_receipt` bila qty datang melebihi kolom itu, jadi
// kuantitas yang DIPESAN dinaikkan lebih dulu (setup fixture, bukan bagian
// dari perilaku yang diuji).
await su.query(`update public.receiving_items set quantity_received=6 where id=$1`, [ITEM])
const apply = await admin.rpc('receipt_apply_events', {
  p_receiving_id: REC,
  p_events: [{
    client_event_id: 'evt-r256-1',
    receiving_item_id: ITEM,
    qty_datang: 6, qty_rusak: 0, tujuan_ws: 0, tujuan_tukang: 6,
    penerima_tukang: 'Tukang Uji', retur_status: 'NONE', retur_qty: 0,
    discard_confirmed: false, source: 'FORM'
  }],
  p_meta: {}
})
ck('D0a event penerimaan (datang 6, tujuan tukang 6) tercatat lewat RPC v1',
  apply.data?.ok === true, JSON.stringify(apply).slice(0, 200))
const evRows = (await su.query(`select id, tujuan_tukang, qty_datang from public.receiving_events where receiving_id=$1`, [REC])).rows
ck('D0b event benar-benar tersimpan (bukan klaim UI)', evRows.length === 1 && Number(evRows[0].tujuan_tukang) === 6,
  JSON.stringify(evRows))

// ============================================================
head('D6. Teks orphan TIDAK menjanjikan tindakan yang dilarang database')
// ============================================================
// Fakta DB (bukan kutip): UPDATE receiving_id ditolak untuk authenticated,
// service_role, DAN superuser.
const ORPHAN = 'eeeeeeee-0000-0000-0000-0000000000e1'
const anyRec = (await su.query(`select id from public.receivings limit 1`)).rows[0]?.id || null
await su.query(`delete from public.handovers where id=$1`, [ORPHAN]).catch(() => {})
await su.query(`insert into public.handovers(id,receiving_id,received_by,handover_date,status,note)
  values ($1,null,'Pak Lama','2026-10-01','DRAFT','dokumen lama tanpa penerimaan')`, [ORPHAN])

// Setiap percobaan dijalankan dalam transaksi sendiri lalu ROLLBACK, supaya
// dokumen uji tetap orphan apa pun hasilnya.
const tryLink = async (role, label) => {
  try {
    await c.query('begin')
    if (role) await c.query(`set local role ${role}`)
    await c.query(`update public.handovers set receiving_id=$1 where id=$2`, [anyRec, ORPHAN])
    await c.query('rollback')
    return { ok: true, label }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    return { ok: false, label, err: e.message, code: e.code }
  }
}
const linkAuth = await tryLink('authenticated', 'authenticated')
ck('E1 admin (authenticated) TIDAK bisa "menghubungkan dokumen ke penerimaan" — ditolak DB',
  linkAuth.ok === false && /handover_source_immutable/.test(String(linkAuth.err)), JSON.stringify(linkAuth))
const linkSvc = await tryLink('service_role', 'service_role')
ck('E2 service_role (SQL langsung) juga DITOLAK — bukan sekadar tombol belum ada',
  linkSvc.ok === false && /handover_source_immutable/.test(String(linkSvc.err)), JSON.stringify(linkSvc))
const linkSuper = await tryLink(null, 'superuser')
ck('E3 SUPERUSER pun DITOLAK — "perbaikan data oleh admin" tidak punya bentuk sah',
  linkSuper.ok === false && /handover_source_immutable/.test(String(linkSuper.err)), JSON.stringify(linkSuper))

const orphanText = Q.ORPHAN_NO_RECEIVING_REASON
ck('E4 teks TIDAK menawarkan "hubungkan dokumen ini ke penerimaan"',
  !/hubungkan dokumen ini ke penerimaan/i.test(orphanText), orphanText.slice(0, 200))
ck('E5 teks menyatakan dokumen TIDAK bisa diperbaiki dari aplikasi (jujur, sesuai E1–E3)',
  /tidak bisa diperbaiki dari aplikasi/i.test(orphanText), orphanText.slice(0, 260))
ck('E6 teks tetap menawarkan jalan keluar yang NYATA (hapus dokumen tanpa bukti)',
  /hapus dokumen ini/i.test(orphanText), orphanText.slice(0, 260))
ck('E7 teks tidak menyebut "perbaikan data oleh admin" (menyesatkan: itu operasi DBA)',
  !/perbaikan data oleh admin/i.test(orphanText))
ck('E8 teks tidak membocorkan kode SQL mentah ke admin',
  !/handover_source_immutable|physical_rpc_required|42501/.test(orphanText))

// ============================================================
head('D7. Dokumen SAH (punya receiving_id) + baris penerimaan TIDAK termuat')
// ============================================================
// Dokumen SAH untuk penerimaan yang baru saja diisi event di D0.
const HOID = 'eeeeeeee-0000-0000-0000-0000000000d7'
await su.query(`delete from public.handovers where id=$1`, [HOID]).catch(() => {})
await su.query(`delete from public.handovers where receiving_id=$1 and diserahkan_at is null`, [REC])
await su.query(`insert into public.handovers(id,receiving_id,received_by,handover_date,status,note)
  values ($1,$2,'Mandor Joko','2026-10-21','DRAFT','dokumen sah')`, [HOID, REC])
const HO = (await su.query(`select id, receiving_id, project_id, received_by, status, handover_date,
  diserahkan_at, note, created_at from public.handovers where id=$1`, [HOID])).rows[0]
ck('F0 dokumen uji benar-benar menunjuk penerimaan ber-event (bukan orphan)',
  HO?.receiving_id === REC, JSON.stringify(HO?.receiving_id))

// ctx.allReceivings SENGAJA kosong = satu query `receivings` gagal di loadAll.
CAP.resetReceiptCapability && CAP.resetReceiptCapability()
PM.resetPhysicalModal && PM.resetPhysicalModal()
const ctx = {
  rows: [HO], allReceivings: [], allReceivingItems: [], allRequests: [],
  H: { receivingItemsForReceiving: () => [], prItemsForPr: () => [] },
  say: () => {}, refresh: () => {}, onReceivingStatusChange: () => {}
}
let doc = mount(Q.renderHandoverQueue(ctx))
// Tunggu sampai pemeriksaan deliverability selesai (bukan sekadar 1 tick).
await settle(160)

const btn = tid(doc, `queue-act-terima-${HOID}`)
const reason = txt(tid(doc, `queue-finish-reason-${HOID}`))
ck('F1 tombol "Tandai Diserahkan" AKTIF untuk dokumen SAH (dulu: DISABLED — regresi D7)',
  btn && btn.disabled === false, `disabled=${btn?.disabled}`)
ck('F2 alasan TIDAK menyebut "TIDAK terhubung ke penerimaan" (diagnosis palsu)',
  !/tidak terhubung ke penerimaan/i.test(reason), reason.slice(0, 200))
ck('F3 layar TIDAK menyarankan "hapus dokumen ini" untuk dokumen sah',
  !/hapus dokumen ini/i.test(txt(doc.body)), txt(doc.body).slice(0, 300))
ck('F4 progres dari ledger tampil (alokasi/sudah/sisa) — bukti DB benar-benar dibaca',
  !!tid(doc, `queue-deliver-progress-${HOID}`), txt(tid(doc, `queue-deliver-progress-${HOID}`)))

// Klik nyata → modal konfirmasi harus terbuka dengan baris dari DB.
let modalKind = null, qtyInputs = 0
if (btn && !btn.disabled) {
  flushSync(() => click(btn))
  await settle(120)
  const peek = PM.__peekForTest ? PM.__peekForTest() : null
  modalKind = peek ? peek.kind : null
  qtyInputs = document.querySelectorAll('[data-testid^="hc-qty-"]').length
}
ck('F5 klik membuka modal konfirmasi (dulu: tidak terbuka sama sekali)', modalKind === 'confirm', String(modalKind))
ck('F6 modal memuat baris qty NYATA dari DB lewat receiving_id dokumen', qtyInputs >= 1, `baris=${qtyInputs}`)

// KONTROL (bukan bagian perbaikan): modal konfirmasi SELALU membaca DB lewat
// `handover.receiving_id`, jadi ia sudah benar bahkan di pohon BASE. Yang
// diuji di sini adalah bahwa sekarang ANTREAN setuju dengan modal — dulu
// antrean melarang dengan diagnosis palsu sementara modal mengizinkan.
const ConfirmForm = (await load('modules/handovers/confirmForm.mjs')).default
const capReady = { ready: true, returnReady: true, events: true, handoverItems: true, returnLines: true, progress: true, probeFailed: false, missing: [] }
const says2 = []
doc = mount(React.createElement(ConfirmForm, {
  handover: HO, capability: capReady, say: (m) => says2.push(m), refresh: () => {}, close: () => {}
}))
await settle(120)
ck('F7 modal konfirmasi TIDAK menampilkan panel orphan untuk dokumen sah',
  !tid(doc, 'handover-confirm-empty'), txt(tid(doc, 'handover-confirm-empty')).slice(0, 160))
ck('F8 modal menampilkan baris qty (prefill dari penerimaan, tanpa ketik ulang)',
  document.querySelectorAll('[data-testid^="hc-qty-"]').length >= 1,
  String(document.querySelectorAll('[data-testid^="hc-qty-"]').length))
ck('F9 modal TIDAK menyebut "tidak terhubung ke penerimaan"', !/tidak terhubung ke penerimaan/i.test(txt(doc.body)))

// ============================================================
head('G. Regresi langsung: dokumen BENAR-BENAR orphan tetap ditutup dengan jujur')
// ============================================================
CAP.resetReceiptCapability && CAP.resetReceiptCapability()
PM.resetPhysicalModal && PM.resetPhysicalModal()
const HO_ORPHAN = (await c.query(`select id, receiving_id, project_id, received_by, status,
  handover_date, diserahkan_at, note, created_at from public.handovers where id=$1`, [ORPHAN])).rows[0]
const says3 = []
const ctxOrphan = {
  rows: [HO_ORPHAN], allReceivings: [], allReceivingItems: [], allRequests: [],
  H: { receivingItemsForReceiving: () => [], prItemsForPr: () => [] },
  say: (m) => says3.push(m), refresh: () => {}, onReceivingStatusChange: () => {}
}
doc = mount(Q.renderHandoverQueue(ctxOrphan))
await settle(160)
const obtn = tid(doc, `queue-act-terima-${ORPHAN}`)
const oreason = txt(tid(doc, `queue-finish-reason-${ORPHAN}`))
ck('G1 tombol NONAKTIF untuk dokumen yang BENAR-BENAR tanpa penerimaan', obtn?.disabled === true, `disabled=${obtn?.disabled}`)
ck('G2 alasan tertulis & menyebut dokumen tidak terhubung ke penerimaan', /tidak terhubung ke penerimaan/i.test(oreason), oreason.slice(0, 200))
ck('G3 alasan menawarkan HAPUS (jalan keluar nyata) tanpa janji "hubungkan"',
  /hapus dokumen ini/i.test(oreason) && !/hubungkan dokumen ini ke penerimaan/i.test(oreason), oreason.slice(0, 260))
ck('G4 klik programatik TIDAK membuka modal', (() => {
  if (obtn) { obtn.disabled = false; obtn.removeAttribute('disabled'); flushSync(() => click(obtn)) }
  const peek = PM.__peekForTest ? PM.__peekForTest() : null
  return peek === null
})())
ck('G5 tidak ada klaim sukses palsu', !says3.some(m => /tersimpan|berhasil|sudah diserahkan/i.test(String(m))),
  JSON.stringify(says3).slice(0, 200))
ck('G6 dokumen tetap DRAFT & diserahkan_at NULL (nol tulisan)', (await su.query(
  `select status, diserahkan_at from public.handovers where id=$1`, [ORPHAN])).rows[0].diserahkan_at === null)

// ============================================================
head('H. Regresi: finishGate tidak berubah untuk keadaan lain')
// ============================================================
ck('H1 ledger belum siap (LEGACY) → tetap terbuka', Q.finishGate(false, null, { hasReceiving: false }).blocked === '')
ck('H2 ledger siap + pemeriksaan belum selesai → DITAHAN (fail closed)',
  Q.finishGate(true, null, { hasReceiving: true }).blocked === Q.DELIVER_CHECKING_REASON)
ck('H3 pemeriksaan gagal → DITAHAN dengan sebab', Q.finishGate(true, { ok: false }, { hasReceiving: true }).blocked === Q.DELIVER_CHECK_FAILED_REASON)
const dlOk = { ok: true, deliverability: { hasTukang: true, allDelivered: false, quota: 2, done: 0, remaining: 2 } }
ck('H4 siap + ada tukang + ada sisa → BOLEH', Q.finishGate(true, dlOk, { hasReceiving: true }).blocked === '')
ck('H5 semua sudah diserahkan → DITAHAN', Q.finishGate(true, { ok: true, deliverability: { hasTukang: true, allDelivered: true } }, { hasReceiving: true }).blocked === Q.ALL_DELIVERED_REASON)

// ============================================================
head('I. Sumber: hasReceiving TIDAK lagi diturunkan dari memori halaman')
// ============================================================
const qsrc = fs.readFileSync(path.join(SB, 'modules/handovers/queue.mjs'), 'utf8')
ck('I1 finishGate dipanggil dengan `hasReceiving` (bukan `!!deliverKey`)',
  /finishGate\(ledgerReady, deliver, \{ hasReceiving \}\)/.test(qsrc))
ck('I2 `hasReceiving` diturunkan dari `handover.receiving_id`',
  /const hasReceiving = !!\(handover && handover\.receiving_id\)/.test(qsrc))
ck('I3 `deliverKey` memakai `receivingId` dari dokumen (bukan `receiving?.id`)',
  /const deliverKey = ledgerReady && receivingId \?/.test(qsrc))
ck('I4 loadDeliverability dipanggil dengan `receivingId` dokumen',
  /loadDeliverability\(\{ receivingId \}\)/.test(qsrc))
ck('I5 TIDAK ada lagi `hasReceiving: !!deliverKey` (sumber defect D7)',
  !/hasReceiving: !!deliverKey/.test(qsrc))
const isrc = fs.readFileSync(path.join(REPO, 'pages/index.js'), 'utf8')
// Ambil HANYA badan loadAll (bukan seluruh file — `const { data, error }` bisa
// muncul di handler lain dan membuat pemeriksaan ini lolos secara palsu).
const loadStart = isrc.indexOf('async function loadAll()')
const loadEnd = isrc.indexOf('async function login(')
const loadBody = loadStart >= 0 && loadEnd > loadStart ? isrc.slice(loadStart, loadEnd) : isrc
ck('I6 loadAll MEMBACA `error` dari query (tidak lagi `const { data }`)',
  /const \{ data, error \}/.test(loadBody) && /const \{ data: allProj, error: projErr \}/.test(loadBody),
  loadBody.slice(0, 120))
ck('I7 kegagalan query dilaporkan lewat notice',
  /Gagal memuat \$\{fatal/.test(loadBody) && /setNotice/.test(loadBody))
ck('I8 `receivings` termasuk sumber WAJIB (bukan dikecualikan sebagai opsional)',
  !/OPTIONAL_SOURCES = new Set\(\[[^\]]*'receivings'/.test(loadBody))
ck('I9 tidak ada lagi pola telan-error `const { data } = await` di loadAll',
  !/^\s*const \{ data \} = await/m.test(loadBody), (loadBody.match(/^\s*const \{ data \} = await/gm) || []).join(','))

console.log(`\n=== HASIL PROBE r256: ${pass} PASS / ${fail} FAIL ===`)
await c.end()
process.exit(fail ? 1 : 0)
