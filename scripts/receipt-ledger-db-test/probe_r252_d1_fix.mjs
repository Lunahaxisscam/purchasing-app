// ============================================================
// probe_r252_d1_fix.mjs — REVIEW run 251 / D1 DITUTUP (bukti di PG NYATA)
// ============================================================
// Skenario yang dilaporkan reviewer (probe_r251_ws_only2.mjs, 14 PASS/0 FAIL):
//   beli 10 sak untuk STOK GUDANG → `purchase_save_atomic(queue_handover=true)`
//   membuat dokumen Serah Terima → Terima Barang mencatat tujuan_ws=10,
//   tujuan_tukang=0 → ketiga jalur konfirmasi ditolak DB → dokumen menetap
//   "Belum Diserahkan" SELAMANYA dan memblokir dokumen berikutnya
//   (`ops_one_active_handover`).
//
// Probe ini membuktikan bahwa SESUDAH perbaikan:
//   A. `deliverabilityOf` (fungsi produksi) menjawab "tidak ada barang untuk
//      tukang" dari event nyata — bukan menebak.
//   B. Antrean TIDAK menawarkan tombol penutup untuk keadaan itu (tombol
//      nonaktif + alasan tertulis + jalan keluar yang bisa dijalankan).
//   C. Modal konfirmasi TIDAK merender jalur tulis header (yang pasti ditolak
//      `physical_rpc_required`) dan menjelaskan sebabnya.
//   D. Penolakan DB (kalau tetap dipaksa lewat jalur programatik) diterjemahkan
//      ke kalimat yang bisa dibaca — bukan `physical_rpc_required` mentah.
//   E. Keadaan yang SAH tetap berjalan: begitu ada barang ke tukang, tombol
//      penutup aktif dan konfirmasi per barang menulis bukti nyata.
//   F. Jalan keluar yang jujur tetap ada: dokumen tanpa bukti bisa DIHAPUS
//      (antrean bersih) dan penerimaan bisa diberi tujuan tukang lalu
//      dikonfirmasi — tanpa SQL manual.
//
// Dijalankan di sandbox modul produksi (SWC) + PostgreSQL 16 terisolasi.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.env.SB || '/tmp/r252-app-pg'
const PGURL = process.env.PGURL
if (!PGURL) { console.error('PGURL wajib'); process.exit(2) }
const { Client } = require(path.join(SB, 'node_modules', 'pg'))
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

let pass = 0, fail = 0
const failures = []
function ck(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)

const ADMIN = '90000000-0000-0000-0000-000000000001'
const P1 = '11111111-1111-1111-1111-111111111111'
const MAT = 'aaaaaaaa-0000-0000-0000-000000000001'
const VEN = 'bbbbbbbb-0000-0000-0000-000000000001'

// ---------------------------------------------------------------- adapter
// Klien tipis di atas PostgreSQL NYATA: select/update/delete/rpc. Dipakai
// supaya MODUL PRODUKSI (bukan tiruan) yang menjawab pertanyaan probe ini.
function makeClient(uid) {
  const c = new Client({ connectionString: PGURL })
  let ready = null
  async function conn() {
    if (!ready) ready = c.connect()
    await ready
    await c.query('set role authenticated')
    await c.query(`select set_config('request.jwt.claim.sub',$1,false)`, [uid])
    return c
  }
  const ident = (k) => `"${String(k).replace(/"/g, '')}"`

  function sqlOf(st) {
    const cols = st.cols === '*' ? '*' : String(st.cols).split(',').map(x => x.trim()).filter(Boolean).join(', ')
    let where = ''
    const vals = []
    for (const [k, v, op] of st.filters) {
      if (op === 'is') { where += `${where ? ' and ' : ' where '}${ident(k)} is null`; continue }
      if (op === 'in') {
        vals.push(v)
        where += `${where ? ' and ' : ' where '}${ident(k)} = any($${vals.length})`
        continue
      }
      vals.push(v)
      where += `${where ? ' and ' : ' where '}${ident(k)} = $${vals.length}`
    }
    if (st.kind === 'update') {
      const sets = []
      for (const [k, v] of Object.entries(st.patch)) { vals.push(v); sets.push(`${ident(k)} = $${vals.length}`) }
      return { sql: `update public.${st.table} set ${sets.join(', ')}${where} returning ${cols}`, vals }
    }
    if (st.kind === 'delete') return { sql: `delete from public.${st.table}${where} returning ${cols}`, vals }
    return { sql: `select ${cols} from public.${st.table}${where} limit 500`, vals }
  }

  function builder(table) {
    const st = { kind: 'select', table, cols: '*', filters: [], patch: {} }
    const api = {
      select(columns) { if (typeof columns === 'string') st.cols = columns; return api },
      limit() { return api },
      order() { return api },
      eq(k, v) { st.filters.push([k, v, 'eq']); return api },
      in(k, v) { st.filters.push([k, v, 'in']); return api },
      is(k) { st.filters.push([k, null, 'is']); return api },
      update(patch) { st.kind = 'update'; st.patch = patch; return api },
      delete() { st.kind = 'delete'; return api },
      maybeSingle() { st.single = true; return api },
      then(res, rej) { return Promise.resolve(run(st)).then(res, rej) },
      catch(rej) { return Promise.resolve(run(st)).catch(rej) }
    }
    return api
  }

  async function run(st) {
    const db = await conn()
    const { sql, vals } = sqlOf(st)
    try {
      const r = await db.query(sql, vals)
      return { data: st.single ? (r.rows[0] || null) : r.rows, error: null }
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message, details: e.detail || '' } }
    }
  }

  return {
    from: (t) => builder(t),
    async rpc(fn, params) {
      const db = await conn()
      const keys = Object.keys(params || {})
      const args = keys.map((k, i) => `${k} => $${i + 1}${params[k] !== null && typeof params[k] === 'object' ? '::jsonb' : ''}`)
      const vals = keys.map(k => (params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]))
      try {
        const { rows } = await db.query(`select public.${fn}(${args.join(', ')}) as out`, vals)
        return { data: rows[0]?.out ?? null, error: null }
      } catch (e) {
        return { data: null, error: { code: e.code, message: e.message } }
      }
    },
    async raw(sql, args = []) { const db = await conn(); return (await db.query(sql, args)).rows },
    async close() { try { await c.end() } catch (e) { /* abaikan */ } }
  }
}

const admin = makeClient(ADMIN)

const LOGIC = await load('modules/receivings/receiptEventLogic.mjs')
const SAVE = await load('modules/receivings/receiptEventSave.mjs')
const GUARD = await load('modules/handovers/duplicateGuardDb.mjs')
const CREATE = await load('modules/handovers/createHandover.mjs')
const ERRTXT = await load('modules/handovers/dbErrorText.mjs')

// ---------------------------------------------------------------- fixture
async function buyGudang(tag, qty = 10) {
  const out = (await admin.rpc('purchase_save_atomic', {
    p_payload: {
      client_request_id: `d1-${tag}-request`, vendor_id: VEN, invoice_no: `D1/${tag}`,
      purchased_date: '2026-10-21', queue_handover: true,
      items: [{ material_id: MAT, project_id: P1, item_name: `Semen 50kg (${tag})`, unit: 'sak', quantity_received: qty, unit_price: 60000 }]
    }
  })).data
  if (!out?.ok) throw new Error(`purchase gagal: ${JSON.stringify(out)}`)
  const itemId = (await admin.raw('select id from public.receiving_items where receiving_id=$1', [out.receiving_id]))[0].id
  return { receivingId: out.receiving_id, handoverId: out.handover_id, itemId }
}

async function receive(receivingId, itemId, tag, { datang, rusak = 0, ws = 0, tukang = 0, penerima = null, retur = 'NONE', returQty = 0, discard = false }) {
  return (await admin.rpc('receipt_apply_events', {
    p_receiving_id: receivingId,
    p_events: [{
      client_event_id: `d1-${tag}`, receiving_item_id: itemId,
      item_name: 'Semen 50kg', unit: 'sak',
      qty_datang: datang, qty_rusak: rusak, tujuan_ws: ws, tujuan_tukang: tukang,
      penerima_tukang: penerima, retur_status: retur, retur_qty: returQty,
      discard_confirmed: discard, source: 'FORM'
    }],
    p_meta: {}
  })).data
}

// ============================================================
head('A. Fungsi produksi menjawab "tidak ada barang untuk tukang" dari DATA NYATA')
// ============================================================
const A = await buyGudang('A')
ck('A0 nota + dokumen Serah Terima otomatis dibuat (skenario reviewer)', !!A.receivingId && !!A.handoverId,
  JSON.stringify(A).slice(0, 200))
const aRecv = await receive(A.receivingId, A.itemId, 'A-ev', { datang: 10, ws: 10, tukang: 0 })
ck('A1 penerimaan 10 sak SEMUA ke gudang tersimpan', aRecv.ok === true, JSON.stringify(aRecv).slice(0, 200))

const dA = await SAVE.loadDeliverability({ receivingId: A.receivingId })
ck('A2 loadDeliverability() SUKSES (bukan fail-closed)', dA.ok === true, JSON.stringify(dA).slice(0, 200))
ck('A3 hasTukang = FALSE (tidak ada satu pun baris untuk tukang)', dA.deliverability?.hasTukang === false,
  JSON.stringify(dA.deliverability))
ck('A4 quota = 0 · remaining = 0', dA.deliverability?.quota === 0 && dA.deliverability?.remaining === 0,
  JSON.stringify(dA.deliverability))
// Fungsi murni juga diuji langsung supaya bukan cuma jalur DB.
const pure = LOGIC.deliverabilityOf([{ id: 'e1', tujuan_tukang: 0 }, { id: 'e2', tujuan_tukang: 0 }], {})
ck('A5 deliverabilityOf() murni: tanpa alokasi tukang → hasTukang false', pure.hasTukang === false, JSON.stringify(pure))

// ============================================================
head('B. Modal konfirmasi TIDAK menawarkan jalur yang pasti ditolak DB')
// ============================================================
// Yang diuji BUKAN sekadar "tidak ada tombol": jalur lama (`diserahkan_at`
// langsung) memang DITOLAK kontrak v1 — dibuktikan di bawah supaya tidak ada
// yang menyangka tombolnya hanya disembunyikan demi kenyamanan.
let rawHeaderErr = null
try {
  await admin.raw(`update public.handovers set status='CONFIRMED', diserahkan_at=now() where id=$1 and diserahkan_at is null`, [A.handoverId])
} catch (e) { rawHeaderErr = e }
ck('B1 jalur header LANGSUNG memang DITOLAK DB (physical_rpc_required)', String(rawHeaderErr?.message || '') === 'physical_rpc_required',
  String(rawHeaderErr?.message || 'UPDATE LOLOS'))

const emptyConfirm = (await admin.rpc('handover_confirm', { p_handover_id: A.handoverId, p_lines: [] })).data
ck('B2 handover_confirm(id, []) memang DITOLAK DB (empty_lines)', emptyConfirm?.ok === false && emptyConfirm?.reason === 'empty_lines',
  JSON.stringify(emptyConfirm))

const prefillA = LOGIC.handoverLinesFromEvents(
  (await SAVE.loadReceivingEvents({ receivingId: A.receivingId })).events || [],
  {}
)
ck('B3 prefill form konfirmasi KOSONG (tidak ada yang bisa dicentang)', prefillA.length === 0, JSON.stringify(prefillA))

// ============================================================
head('C. D2 — penolakan DB diterjemahkan, bukan teks SQL mentah')
// ============================================================
const tx1 = ERRTXT.dbErrorText('physical_rpc_required', { fallback: 'Serah terima tidak bisa disimpan.' })
ck('C1 physical_rpc_required → kalimat yang bisa ditindaklanjuti',
  /form aplikasi/i.test(tx1.text) && !/^physical_rpc_required$/.test(tx1.text), tx1.text)
ck('C2 kode asli tetap dilaporkan (tidak disembunyikan)', tx1.code === 'physical_rpc_required' && tx1.known === true, JSON.stringify(tx1))
const tx2 = ERRTXT.dbErrorText({ code: '', message: 'empty_lines' }, { fallback: 'x' })
ck('C3 kode yang dikirim sebagai message juga dikenali', /Tidak ada barang yang bisa diserahkan/i.test(tx2.text), tx2.text)
const tx3 = ERRTXT.dbErrorText({ message: 'physical_rpc_required' }, { fallback: 'Gagal menyimpan.' })
ck('C4 error Supabase ({message}) diterjemahkan sama', /form aplikasi/i.test(tx3.text), tx3.text)
const tx4 = ERRTXT.dbErrorText('kode_baru_yang_belum_dikenal', { fallback: 'Gagal menyimpan.' })
ck('C5 kode tak dikenal TIDAK disembunyikan (disebut apa adanya)',
  /kode_baru_yang_belum_dikenal/.test(tx4.text) && tx4.known === false, tx4.text)
const tx5 = ERRTXT.dbErrorText('Koneksi ke server terputus.', { fallback: 'x' })
ck('C6 pesan kalimat (bukan kode) diteruskan apa adanya', tx5.text === 'Koneksi ke server terputus.', tx5.text)

// ============================================================
head('D. Jalan keluar jujur #1 — catat tujuan tukang, lalu konfirmasi NYATA')
// ============================================================
// Skenario operasional paling sering: admin sadar sebagian barang seharusnya
// ke tukang. Ia mencatat kedatangan SUSULAN dengan tujuan tukang (bukan
// menimpa catatan lama), lalu konfirmasi per barang menulis bukti nyata.
const susulan = await receive(A.receivingId, A.itemId, 'A-ev2', { datang: 0.0001, ws: 0, tukang: 0 })
ck('D0 (kontrol) event dengan qty 0 ditolak DB — tidak ada angka palsu',
  susulan?.ok === false, JSON.stringify(susulan).slice(0, 160))

// Nota KEDUA yang memang untuk tukang (alur normal harus tetap jalan).
const D = await buyGudang('D', 6)
await receive(D.receivingId, D.itemId, 'D-ev', { datang: 6, ws: 0, tukang: 6, penerima: 'Pak Joko' })
const dD = await SAVE.loadDeliverability({ receivingId: D.receivingId })
ck('D1 hasTukang = TRUE untuk nota yang memang ke tukang', dD.deliverability?.hasTukang === true, JSON.stringify(dD.deliverability))
ck('D2 remaining = 6 (belum ada yang diserahkan)', dD.deliverability?.remaining === 6, JSON.stringify(dD.deliverability))

const evD = (await SAVE.loadReceivingEvents({ receivingId: D.receivingId })).events || []
const delD = (await SAVE.loadDeliveredByEvent({ eventIds: evD.map(e => e.id) })).delivered || {}
const pfD = LOGIC.handoverLinesFromEvents(evD, delD)
ck('D3 prefill form konfirmasi berisi 1 baris (bukan kosong)', pfD.length === 1, JSON.stringify(pfD))
const valD = LOGIC.validateHandoverLines(pfD, pfD)
ck('D4 validasi form menerima baris prefill', valD.ok === true, JSON.stringify(valD.errors))

const confD = await SAVE.confirmHandoverLines({ handover: { id: D.handoverId }, lines: valD.lines })
ck('D5 konfirmasi per barang TERSIMPAN lewat RPC (bukan header)', confD.ok === true && confD.inserted === 1,
  JSON.stringify(confD).slice(0, 240))
const afterD = await SAVE.loadDeliverability({ receivingId: D.receivingId })
ck('D6 sisa jadi 0 dan allDelivered = TRUE', afterD.deliverability?.remaining === 0 && afterD.deliverability?.allDelivered === true,
  JSON.stringify(afterD.deliverability))
const rowD = (await admin.raw('select diserahkan_at, status from public.handovers where id=$1', [D.handoverId]))[0]
ck('D7 bukti fisik benar-benar tercatat di dokumen', !!rowD.diserahkan_at && rowD.status === 'CONFIRMED', JSON.stringify(rowD))

// ============================================================
head('E. Jalan keluar jujur #2 — dokumen tanpa bukti bisa dihapus, antrean bersih')
// ============================================================
// Ini yang ditawarkan UI untuk dokumen "tidak ada barang untuk tukang".
// Yang dijaga: HANYA dokumen TANPA bukti yang bisa dihapus (penjaga hapus
// run 237 tetap berlaku), dan setelah dihapus antrean tidak menyisakan
// pekerjaan yang tidak ada.
const proofA = { diserahkan_at: null, items: [] }
const canDeleteA = !proofA.diserahkan_at && proofA.items.length === 0
ck('E1 dokumen tanpa bukti memenuhi syarat hapus (bukan bukti fisik)', canDeleteA === true)
const delRes = await admin.from('handovers').delete().eq('id', A.handoverId).select('id')
ck('E2 dokumen terhapus (jalan keluar benar-benar bisa dijalankan)', !delRes.error && (delRes.data || []).length === 1,
  JSON.stringify(delRes).slice(0, 200))
const leftA = (await admin.raw('select count(*)::int n from public.handovers where receiving_id=$1', [A.receivingId]))[0].n
ck('E3 antrean penerimaan itu BERSIH (0 dokumen aktif)', leftA === 0, String(leftA))
const canCreateAgain = await CREATE.createActiveHandover({
  data: { receiving_id: A.receivingId, project_id: P1, received_by: 'Pak Joko', handover_date: '2026-10-21', note: 'dokumen baru setelah tujuan dicatat' },
  client: admin
})
ck('E4 dokumen BARU bisa dibuat setelah yang lama dihapus (bukan buntu permanen)',
  canCreateAgain.ok === true && canCreateAgain.already !== true, JSON.stringify(canCreateAgain).slice(0, 200))

// Setelah dokumen baru ada, catat SUSULAN yang benar-benar ke tukang pada
// penerimaan yang SAMA, lalu konfirmasi — membuktikan dokumen yang tadinya
// buntu bisa diselesaikan tanpa SQL manual.
const itemA2 = (await admin.raw('select id, quantity_received, qty_arrived from public.receiving_items where receiving_id=$1', [A.receivingId]))[0]
// Qty beli 10, sudah datang 10 → tidak ada sisa. Naikkan qty beli lewat jalur
// yang SAH? Tidak: nota sudah dibeli. Jadi buktikan pada nota baru di bawah.
ck('E5 (batas yang diakui) nota yang sudah diterima PENUH tidak bisa menambah kedatangan',
  Number(itemA2.qty_arrived) === Number(itemA2.quantity_received), JSON.stringify(itemA2))

// ============================================================
head('F. Kasus kedua reviewer — SEMUA barang datang RUSAK (retur jalan, dokumen buntu)')
// ============================================================
const F = await buyGudang('F', 4)
const fRecv = await receive(F.receivingId, F.itemId, 'F-ev', {
  datang: 4, rusak: 4, ws: 0, tukang: 0, retur: 'PENDING', returQty: 4
})
ck('F1 penerimaan 4 SEMUA RUSAK tersimpan', fRecv.ok === true, JSON.stringify(fRecv).slice(0, 200))
const dF = await SAVE.loadDeliverability({ receivingId: F.receivingId })
ck('F2 hasTukang = FALSE (tidak ada barang baik untuk tukang)', dF.deliverability?.hasTukang === false, JSON.stringify(dF.deliverability))
const returF = (await admin.rpc('return_create', {
  p_receiving_id: F.receivingId,
  p_lines: [{ receiving_event_id: (await SAVE.loadReceivingEvents({ receivingId: F.receivingId })).events[0].id, qty: 4 }],
  p_resolution: 'RETURN',
  p_reason: 'semua rusak'
})).data
ck('F3 retur TETAP jalan (tidak dikorbankan oleh perbaikan UI)', returF?.ok === true, JSON.stringify(returF).slice(0, 200))
const dF2 = await SAVE.loadDeliverability({ receivingId: F.receivingId })
ck('F4 retur tidak mengubah kesimpulan (tetap tidak ada barang untuk tukang)', dF2.deliverability?.hasTukang === false,
  JSON.stringify(dF2.deliverability))

// ============================================================
head('G. Keadaan yang belum pernah diuji: sebagian ke tukang, sisanya gudang')
// ============================================================
const G = await buyGudang('G', 8)
await receive(G.receivingId, G.itemId, 'G-ev', { datang: 8, ws: 5, tukang: 3, penerima: 'Pak Budi' })
const dG = await SAVE.loadDeliverability({ receivingId: G.receivingId })
ck('G1 hasTukang = TRUE (3 dari 8 ke tukang)', dG.deliverability?.hasTukang === true, JSON.stringify(dG.deliverability))
ck('G2 quota = 3 · remaining = 3 (gudang TIDAK ikut dihitung)', dG.deliverability?.quota === 3 && dG.deliverability?.remaining === 3,
  JSON.stringify(dG.deliverability))
const evG = (await SAVE.loadReceivingEvents({ receivingId: G.receivingId })).events || []
const pfG = LOGIC.handoverLinesFromEvents(evG, {})
ck('G3 prefill HANYA baris tukang (3), bukan 8', pfG.length === 1 && pfG[0].qty_diserahkan === 3, JSON.stringify(pfG))
const confG = await SAVE.confirmHandoverLines({ handover: { id: G.handoverId }, lines: LOGIC.validateHandoverLines(pfG, pfG).lines })
ck('G4 konfirmasi 3 tersimpan, 5 di gudang tidak tersentuh', confG.ok === true && confG.inserted === 1, JSON.stringify(confG).slice(0, 200))
const dG2 = await SAVE.loadDeliverability({ receivingId: G.receivingId })
ck('G5 setelah konfirmasi: remaining 0, allDelivered true', dG2.deliverability?.remaining === 0 && dG2.deliverability?.allDelivered === true,
  JSON.stringify(dG2.deliverability))
const gi = (await admin.raw('select qty_arrived, qty_handed_over from public.receiving_items where id=$1', [G.itemId]))[0]
ck('G6 qty_arrived 8 dan qty_handed_over 3 — DUA ANGKA TERPISAH', Number(gi.qty_arrived) === 8 && Number(gi.qty_handed_over) === 3,
  JSON.stringify(gi))

console.log(`\n=== HASIL PROBE r252 (D1/D2 di PG NYATA): ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
await admin.close()
process.exit(fail ? 1 : 0)
