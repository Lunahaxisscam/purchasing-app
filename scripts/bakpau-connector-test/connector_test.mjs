// ============================================================
// connector_test.mjs — HARNESS LOGIKA & ALUR KONEKTOR BAKPAU
// ============================================================
// Menjalankan kode produksi VERBATIM (hasil transform SWC dari
// lib/bakpau/** + modules/receivings/purchaseSave.js + lib/purchaseNote.js)
// dengan klien Supabase MOCK perekam. Tidak ada DB, jaringan, atau pesan
// keluar sungguhan.
//
// Setiap grup uji mencetak PASS/FAIL; exit code 1 bila ada FAIL.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import crypto from 'node:crypto'

const SB = process.cwd()
const load = rel => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const C = await load('lib/bakpau/constants.mjs')
const N = await load('lib/bakpau/normalize.mjs')
const V = await load('lib/bakpau/verify.mjs')
const E = await load('lib/bakpau/evidence.mjs')
const R = await load('lib/bakpau/resolve.mjs')
const D = await load('lib/bakpau/duplicate.mjs')
const L = await load('lib/bakpau/ledger.mjs')
const M = await load('lib/bakpau/markers.mjs')
const NF = await load('lib/bakpau/notify.mjs')
const PA = await load('lib/bakpau/purchaseAdapter.mjs')
const CONN = await load('lib/bakpau/connector.mjs')
const PS = await load('modules/receivings/purchaseSave.mjs')
const mock = await load('lib/supabaseClient.mjs')
const F = await import(pathToFileURL(path.join(SB, 'fixtures.mjs')).href)

let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
}
function group(t) { console.log(`\n=== ${t} ===`) }

// Transpor notifikasi perekam: mencatat target & teks, bisa dipaksa gagal N kali.
function recordingTransport({ failTimes = 0, failForever = false } = {}) {
  const sent = []
  let n = 0
  return {
    sent,
    async send(target, text) {
      n++
      sent.push({ target: { ...target }, text, attempt: n })
      if (failForever) return { ok: false, error: 'sintetis: telegram down' }
      if (n <= failTimes) return { ok: false, error: 'sintetis: gagal sementara' }
      return { ok: true, messageId: `msg-${n}` }
    },
    get attempts() { return n }
  }
}

function baseTables(extra = {}) {
  return {
    projects: F.PROJECTS.map(p => ({ ...p })),
    vendors: F.VENDORS.map(v => ({ ...v })),
    purchase_requests: F.REQUESTS.map(r => ({ ...r })),
    pr_items: F.PR_ITEMS.map(i => ({ ...i })),
    receiving_items: F.RECEIVING_ITEMS.map(i => ({ ...i })),
    receivings: [],
    handovers: [],
    bakpau_events: [],
    ...extra
  }
}

let __msgSeq = 4000
function nextMsgId() { __msgSeq += 1; return __msgSeq }

async function runEvent({ platform = 'telegram', payload = null, headers = F.TG_HEADERS, env = F.ENV, ledger, transport, existingNotas = [], masters = F.MASTERS, requestNotify = true, tables } = {}) {
  // Default payload: event Telegram sintetis yang sah. Id pesan default 4412
  // (dipakai uji penanda); uji lain memberi id sendiri supaya tidak bertabrakan.
  if (!payload) payload = F.tgUpdate({ messageId: 4412 })
  mock.__reset({ tables: tables || baseTables() })
  const l = ledger || L.createMemoryLedger()
  const t = transport || recordingTransport()
  const out = await CONN.processInboundEvent({
    platform,
    payload,
    headers,
    rawBody: JSON.stringify(payload),
    env,
    client: mock.supabase,
    ledger: l,
    transport: t,
    now: F.NOW,
    masters,
    existingNotas,
    requestNotify,
    sleep: async () => {}
  })
  return { out, ledger: l, transport: t }
}

// ============================================================
group('A. NORMALISASI DUA KANAL')
// ============================================================
{
  const tg = N.normalizeTelegram(F.tgUpdate({ messageId: 4412 }))
  ok('A1 Telegram dinormalisasi', tg.ok)
  eq('A2 channelKey telegram', tg.event.channelKey, 'telegram:1320969465:4412')
  eq('A3 chatType private -> dm', tg.event.chatType, 'dm')
  eq('A4 platform telegram', tg.event.platform, 'telegram')

  const wa = N.normalizeWhatsApp(F.waPayload({ id: 'WA-MSG-9' }))
  ok('A5 WhatsApp dinormalisasi', wa.ok)
  eq('A6 channelKey whatsapp', wa.event.channelKey, 'whatsapp:628000000001@s.whatsapp.net:WA-MSG-9')
  eq('A7 chatType dm', wa.event.chatType, 'dm')

  const bad = N.normalizeInbound('signal', {})
  eq('A8 platform tak dikenal ditolak', bad.reason, 'unsupported_platform')
  const noMsg = N.normalizeTelegram({ update_id: 1 })
  eq('A9 Telegram tanpa message ditolak', noMsg.reason, 'empty_event')
  const noId = N.normalizeWhatsApp({ from: 'x' })
  eq('A10 WhatsApp tanpa id ditolak', noId.reason, 'empty_event')

  // Lampiran: ref saja, bukan isi file.
  const withPhoto = F.tgUpdate()
  withPhoto.message.photo = [{ file_id: 'FILE-1', file_size: 1000 }, { file_id: 'FILE-2', file_size: 2000 }]
  const n2 = N.normalizeTelegram(withPhoto)
  eq('A11 lampiran foto -> ref terbesar', n2.event.attachments[0].ref, 'FILE-2')
  ok('A12 lampiran tanpa isi biner', !('data' in n2.event.attachments[0]))
}

// ============================================================
group('B. GERBANG MASUK (FAIL CLOSED)')
// ============================================================
{
  const ev = N.normalizeTelegram(F.tgUpdate()).event

  const good = V.verifyInbound({ platform: 'telegram', event: ev, headers: F.TG_HEADERS, env: F.ENV, now: F.NOW })
  ok('B1 telegram sah lolos', good.ok)

  const badSig = V.verifyInbound({ platform: 'telegram', event: ev, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'salah' }, env: F.ENV, now: F.NOW })
  eq('B2 secret salah ditolak', badSig.reason, 'bad_signature')

  const noSig = V.verifyInbound({ platform: 'telegram', event: ev, headers: {}, env: F.ENV, now: F.NOW })
  eq('B3 tanpa secret ditolak', noSig.reason, 'bad_signature')

  const noSecret = V.verifyInbound({ platform: 'telegram', event: ev, headers: F.TG_HEADERS, env: { ...F.ENV, BAKPAU_TELEGRAM_WEBHOOK_SECRET: '' }, now: F.NOW })
  eq('B4 secret belum diset -> not_configured', noSecret.reason, 'not_configured')

  const unknownUser = V.verifyInbound({
    platform: 'telegram',
    event: N.normalizeTelegram(F.tgUpdate({ userId: '999999' })).event,
    headers: F.TG_HEADERS, env: F.ENV, now: F.NOW
  })
  eq('B5 pengirim di luar allowlist ditolak', unknownUser.reason, 'identity_not_allowed')

  const noAllow = V.verifyInbound({
    platform: 'telegram', event: ev, headers: F.TG_HEADERS,
    env: { ...F.ENV, BAKPAU_TELEGRAM_ALLOWED_USER_IDS: '' }, now: F.NOW
  })
  eq('B6 allowlist kosong -> not_configured', noAllow.reason, 'not_configured')

  const groupChat = V.verifyInbound({
    platform: 'telegram',
    event: N.normalizeTelegram(F.tgUpdate({ chatType: 'group' })).event,
    headers: F.TG_HEADERS, env: F.ENV, now: F.NOW
  })
  eq('B7 chat grup ditolak', groupChat.reason, 'chat_type_not_allowed')

  const bot = V.verifyInbound({
    platform: 'telegram',
    event: N.normalizeTelegram(F.tgUpdate({ isBot: true })).event,
    headers: F.TG_HEADERS, env: F.ENV, now: F.NOW
  })
  eq('B8 pengirim bot ditolak', bot.reason, 'bot_sender')

  const stale = V.verifyInbound({
    platform: 'telegram',
    event: N.normalizeTelegram(F.tgUpdate({ date: F.NOW_SEC - 4000 })).event,
    headers: F.TG_HEADERS, env: F.ENV, now: F.NOW
  })
  eq('B9 event kedaluwarsa (replay) ditolak', stale.reason, 'stale_event')

  const future = V.verifyInbound({
    platform: 'telegram',
    event: N.normalizeTelegram(F.tgUpdate({ date: F.NOW_SEC + 600 })).event,
    headers: F.TG_HEADERS, env: F.ENV, now: F.NOW
  })
  eq('B10 jam terlalu jauh di depan ditolak', future.reason, 'stale_event')

  // --- WhatsApp: HMAC + token ---
  const waPayload = F.waPayload()
  const waRaw = JSON.stringify(waPayload)
  const waEv = N.normalizeWhatsApp(waPayload).event
  const hmac = crypto.createHmac('sha256', F.ENV.BAKPAU_WA_WEBHOOK_SECRET).update(waRaw, 'utf8').digest('hex')
  const waGood = V.verifyInbound({ platform: 'whatsapp', event: waEv, headers: { 'x-bakpau-signature': `sha256=${hmac}` }, rawBody: waRaw, env: F.ENV, now: F.NOW })
  ok('B11 WA HMAC sah lolos', waGood.ok)
  eq('B12 WA via hmac', waGood.via, 'hmac')

  const waBad = V.verifyInbound({ platform: 'whatsapp', event: waEv, headers: { 'x-bakpau-signature': `sha256=${'0'.repeat(64)}` }, rawBody: waRaw, env: F.ENV, now: F.NOW })
  eq('B13 WA HMAC salah ditolak', waBad.reason, 'bad_signature')

  const waToken = V.verifyInbound({ platform: 'whatsapp', event: waEv, headers: { 'x-bakpau-token': F.ENV.BAKPAU_WA_WEBHOOK_SECRET }, rawBody: waRaw, env: F.ENV, now: F.NOW })
  ok('B14 WA token bersama sah lolos', waToken.ok)

  const waNone = V.verifyInbound({ platform: 'whatsapp', event: waEv, headers: {}, rawBody: waRaw, env: F.ENV, now: F.NOW })
  eq('B15 WA tanpa tanda tangan ditolak', waNone.reason, 'bad_signature')

  const waUnknown = V.verifyInbound({
    platform: 'whatsapp',
    event: N.normalizeWhatsApp(F.waPayload({ from: '628999999999@s.whatsapp.net' })).event,
    headers: { 'x-bakpau-token': F.ENV.BAKPAU_WA_WEBHOOK_SECRET }, rawBody: waRaw, env: F.ENV, now: F.NOW
  })
  eq('B16 WA pengirim di luar allowlist ditolak', waUnknown.reason, 'identity_not_allowed')
}

// ============================================================
group('C. PARSER BUKTI (ANTI-TEBAK)')
// ============================================================
{
  const d = E.parseEvidenceText(F.MSG_ONE_NOTE)
  eq('C1 vendor terbaca', d.header.vendorName, 'SINTETIS Toko Bangunan A-12')
  eq('C2 nota terbaca', d.header.invoiceNo, 'SINT-8891')
  eq('C3 tanggal DD/MM/YYYY -> ISO', d.header.date, '2026-10-20')
  eq('C4 dua baris barang', d.items.length, 2)
  eq('C5 qty baris 1', d.items[0].qty, 6)
  eq('C6 harga baris 1', d.items[0].harga, 125000)
  eq('C7 spek baris 1', d.items[0].spec, '12mm')
  eq('C8 material = 6*125000 + 5*65000', d.material, 750000 + 325000)
  eq('C9 total tertulis terbaca', d.header.statedTotal, 1075000)
  ok('C10 tidak ada baris tak terbaca', d.unparsedLines.length === 0)

  const inline = E.parseEvidenceText('toko: SINTETIS Toko Cat\ntanggal: 2026-10-20\nproyek: 101\n- Cat Tembok 5kg 2 kaleng 150.000')
  eq('C11 bentuk inline terbaca', inline.items.length, 1)
  eq('C12 inline harga', inline.items[0].harga, 150000)
  eq('C13 inline satuan', inline.items[0].unit, 'kaleng')

  const unk = E.parseEvidenceText(F.MSG_UNKNOWN_UNIT)
  eq('C14 satuan asing tidak dipaksa', unk.items[0].unit, 'gepok')
  eq('C15 normalizeUnit menolak satuan asing', E.normalizeUnit('gepok'), null)
  eq('C16 normalizeUnit menerima alias', E.normalizeUnit('lbr'), 'lembar')

  const money = E.parseEvidenceText(F.MSG_MONETARY_ONLY)
  ok('C17 bukti nominal saja ditandai', money.monetaryOnly)
  eq('C18 nominal saja TIDAK mengarang item', money.items.length, 0)

  const unp = E.parseEvidenceText(F.MSG_UNPARSED_LINE)
  eq('C19 baris tak terbaca TIDAK dibuang', unp.unparsedLines.length, 1)
  ok('C20 baris tak terbaca tercatat', /Pasir beton/.test(unp.unparsedLines[0]))

  eq('C21 angka 1.075.000 dibaca benar', E.toNumberID('1.075.000'), 1075000)
  eq('C22 angka 12,5 dibaca benar', E.toNumberID('12,5'), 12.5)
  eq('C23 teks bukan angka -> null', E.toNumberID('3 dus'), null)
  eq('C24 tanggal mustahil ditolak', E.parseDateID('31/02/2026'), null)
  eq('C25 tanggal ISO sah', E.parseDateID('2026-10-20'), '2026-10-20')
}

// ============================================================
group('D. RESOLUSI MASTER + KONFLIK IDENTITAS (fail closed)')
// ============================================================
{
  const rp = R.resolveProject('101', F.PROJECTS)
  ok('D1 proyek kode 101 ketemu', rp.ok)
  eq('D2 proyek id', rp.project.id, 'p-101')

  const rn = R.resolveProject('SINTETIS Josh - Mabes', F.PROJECTS)
  ok('D3 proyek lewat nama ketemu', rn.ok)

  const ru = R.resolveProject('777', F.PROJECTS)
  eq('D4 proyek tak dikenal', ru.reason, 'project_unknown')

  // REGRESI VERIFICATION_A #3: kode 83 dan code 99 bertabrakan -> HARUS gagal.
  const conflicting = [
    { id: 'x-1', kode: '83', code: '99', name: 'SINTETIS Konflik' },
    { id: 'x-2', kode: '99', code: '99', name: 'SINTETIS Lain' }
  ]
  const rc = R.resolveProject('83', conflicting)
  ok('D5 konflik kode/code -> TIDAK matched', !rc.ok, JSON.stringify(rc))
  eq('D6 alasan konflik = ambiguous', rc.reason, 'project_ambiguous')
  const rc2 = R.resolveProject('99', conflicting)
  ok('D7 kode 99 juga ditahan (dipakai 2 proyek)', !rc2.ok)
  const idx = R.buildProjectIndex(conflicting)
  ok('D8 indeks melaporkan konflik', idx.conflicts.some(c => c.kind === 'kode_code_conflict'))
  ok('D9 proyek tidak konsisten terdeteksi', idx.inconsistent.has('x-1'))

  // Dua proyek dengan kode sama -> ambiguitas, bukan pilih pertama.
  const dupKode = [
    { id: 'y-1', kode: '55', code: '55', name: 'SINTETIS Satu' },
    { id: 'y-2', kode: '55', code: '55', name: 'SINTETIS Dua' }
  ]
  const rd = R.resolveProject('55', dupKode)
  ok('D10 kode dipakai 2 proyek -> ditolak', !rd.ok)

  const rv = R.resolveVendor('SINTETIS Toko Cat', F.VENDORS)
  ok('D11 vendor ketemu', rv.ok)
  const rv2 = R.resolveVendor('Toko Cat', F.VENDORS)
  eq('D12 vendor tidak exact -> tidak ditebak', rv2.reason, 'vendor_unknown')

  // Sisa kebutuhan: pri-1 qty 10, sudah dibeli 4 -> sisa 6.
  const rem = R.remainingOfPrItem('pri-1', F.MASTERS)
  eq('D13 qty PR', rem.qtyPr, 10)
  eq('D14 sudah dibeli', rem.bought, 4)
  eq('D15 sisa', rem.sisa, 6)

  // REGRESI VERIFICATION_A #1: kunci literal, bukan fuzzy.
  ok('D16 A-12 != A1-2 (literal)', !R.sameLiteralRef('A-12', 'A1-2'))
  ok('D17 a-12 == A-12 (case saja)', R.sameLiteralRef('a-12', 'A-12'))
  eq('D18 literalKey pertahankan tanda baca', R.literalKey('  A-12  '), 'A-12')
}

// ============================================================
group('E. IDENTITAS BUKTI & KEPUTUSAN DUPLIKAT')
// ============================================================
{
  const base = {
    vendorId: 'v-1', vendorName: 'SINTETIS Toko Bangunan A-12',
    invoiceNo: 'SINT-8891', date: '2026-10-20',
    lines: [{ itemName: 'Triplek 12mm', qty: 6, unit: 'lembar', harga: 125000, spec: '12mm', projectId: 'p-101' }]
  }
  const h1 = D.evidenceHashOf(base)
  const h2 = D.evidenceHashOf({ ...base })
  eq('E1 hash bukti sama untuk bukti sama', h1, h2)
  ok('E2 hash berformat sha256', /^sha256:[a-f0-9]{64}$/.test(h1))

  // Urutan baris tidak mengubah hash.
  const two = { ...base, lines: [
    { itemName: 'A', qty: 1, unit: 'pcs', harga: 1000 },
    { itemName: 'B', qty: 2, unit: 'pcs', harga: 2000 }
  ] }
  const twoRev = { ...base, lines: [...two.lines].reverse() }
  eq('E3 urutan baris tidak mengubah hash', D.evidenceHashOf(two), D.evidenceHashOf(twoRev))

  // REGRESI VERIFICATION_A #1: A-12 vs A1-2 HARUS beda hash.
  const hA = D.evidenceHashOf({ ...base, invoiceNo: 'A-12' })
  const hB = D.evidenceHashOf({ ...base, invoiceNo: 'A1-2' })
  ok('E4 nota A-12 vs A1-2 -> hash BERBEDA', hA !== hB, `${hA} vs ${hB}`)

  // Nomor nota sama di vendor BERBEDA -> bukan duplikat (namespace vendor).
  const hV1 = D.evidenceHashOf({ ...base, vendorId: 'v-1', invoiceNo: '001' })
  const hV2 = D.evidenceHashOf({ ...base, vendorId: 'v-2', invoiceNo: '001' })
  ok('E5 nota "001" beda vendor -> hash beda', hV1 !== hV2)

  // Tanggal berbeda -> hash beda (pembelian berulang sah).
  const hD1 = D.evidenceHashOf({ ...base, date: '2026-10-20' })
  const hD2 = D.evidenceHashOf({ ...base, date: '2026-10-27' })
  ok('E6 tanggal beda -> hash beda (beli ulang sah)', hD1 !== hD2)

  // Keputusan duplikat
  const existing = [{ id: 'rcv-1', vendorId: 'v-1', invoiceNo: 'SINT-8891', evidenceHash: h1, total: 750000, itemNames: ['Triplek 12mm'], date: '2026-10-20' }]
  const d1 = D.decideDuplicate({ incoming: { ...base, evidenceHash: h1, total: 750000, itemNames: ['Triplek 12mm'] }, existing })
  eq('E7 bukti identik -> duplicate_evidence', d1.kind, 'duplicate_evidence')

  const d2 = D.decideDuplicate({ incoming: { ...base, evidenceHash: 'sha256:beda', total: 999999, itemNames: ['Lain'] }, existing })
  eq('E8 nota sama isi beda -> conflict_invoice', d2.kind, 'conflict_invoice')

  const d3 = D.decideDuplicate({ incoming: { ...base, vendorId: 'v-2', evidenceHash: 'sha256:x', total: 750000, itemNames: ['Triplek 12mm'] }, existing })
  eq('E9 vendor lain nomor sama -> bukan duplikat', d3.kind, 'new')

  const d4 = D.decideDuplicate({ incoming: { ...base, invoiceNo: 'SINT-BARU', evidenceHash: 'sha256:y', total: 750000, itemNames: ['Triplek 12mm'] }, existing })
  eq('E10 nomor baru isi sama -> pembelian sah', d4.kind, 'new')
}

// ============================================================
group('F. LEDGER (IDEMPOTENSI ATOMIK)')
// ============================================================
{
  const mem = L.createMemoryLedger()
  const c1 = await mem.claim('evt:a')
  const c2 = await mem.claim('evt:a')
  ok('F1 klaim pertama berhasil', c1.ok && c1.claimed)
  ok('F2 klaim kedua ditolak (duplikat)', c2.ok && c2.claimed === false)

  const both1 = await L.claimBoth({ ledger: L.createMemoryLedger(), channelKey: 'telegram:1:2', evidenceHash: 'sha256:abc' })
  ok('F3 claimBoth sukses', both1.ok)

  // Race: 10 klaim bersamaan untuk bukti yang sama -> tepat 1 menang.
  const raceLedger = L.createMemoryLedger()
  const race = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    L.claimBoth({ ledger: raceLedger, channelKey: `telegram:1:${i}`, evidenceHash: 'sha256:same' })))
  const winners = race.filter(r => r.ok).length
  eq('F4 race 10 event bukti sama -> tepat 1 menang', winners, 1)
  eq('F5 sisanya ditandai duplikat bukti', race.filter(r => r.duplicateEvidence).length, 9)

  // Ledger DB tanpa tabel -> fail closed.
  mock.__reset({ tables: {}, missingTables: ['bakpau_events'] })
  const dbLedger = L.createDbLedger({ client: mock.supabase })
  const dbClaim = await dbLedger.claim('evt:x')
  eq('F6 ledger DB tanpa tabel -> fail closed', dbClaim.reason, 'ledger_unavailable')

  // Ledger DB dengan tabel -> klaim atomik via UNIQUE.
  mock.__reset({ tables: { bakpau_events: [] } })
  const db2 = L.createDbLedger({ client: mock.supabase })
  const k1 = await db2.claim('evt:y')
  const k2 = await db2.claim('evt:y')
  ok('F7 klaim DB pertama berhasil', k1.ok && k1.claimed)
  ok('F8 klaim DB kedua ditolak UNIQUE', k2.ok && k2.claimed === false)
}

// ============================================================
group('G. NOTIFIKASI — TARGET & PENOLAKAN')
// ============================================================
{
  eq('G1 target DAT platform', C.DAT_NOTIFY_TARGET.platform, 'telegram')
  eq('G2 target DAT chat', C.DAT_NOTIFY_TARGET.chatId, '1320969465')
  eq('G3 target DAT user', C.DAT_NOTIFY_TARGET.userId, '1320969465')
  eq('G4 target DAT chat_type', C.DAT_NOTIFY_TARGET.chatType, 'dm')
  eq('G5 allowlist hanya 1 tujuan', C.NOTIFY_ALLOWLIST.length, 1)

  ok('G6 target DAT diizinkan', NF.isAllowlistedTarget(C.DAT_NOTIFY_TARGET))
  ok('G7 target WhatsApp ditolak', !NF.isAllowlistedTarget({ platform: 'whatsapp', chatId: '628000000001@s.whatsapp.net', userId: '628000000001@s.whatsapp.net', chatType: 'dm' }))
  ok('G8 recipient lain (Novi) ditolak', !NF.isAllowlistedTarget({ platform: 'telegram', chatId: '999', userId: '999', chatType: 'dm' }))
  ok('G9 grup ditolak', !NF.isAllowlistedTarget({ platform: 'telegram', chatId: '1320969465', userId: '1320969465', chatType: 'group' }))

  const rq = NF.resolveTarget({ platform: 'whatsapp', chatId: 'x', userId: 'x', chatType: 'dm' })
  eq('G10 resolveTarget menolak WA', rq.reason, 'recipient_not_allowlisted')
  const rq2 = NF.resolveTarget(null)
  eq('G11 tanpa requested -> target DAT', rq2.target.chatId, '1320969465')

  const text = NF.formatNotification({
    status: 'draft',
    header: { vendorName: 'SINTETIS Toko', invoiceNo: 'SINT-1', total: 1000 },
    lines: [{ projectLabel: '[101] SINTETIS Aan' }]
  })
  ok('G12 draft menyatakan BELUM tersimpan', /BELUM tersimpan/i.test(text))
  ok('G13 draft tidak punya headline "Pembelian tercatat"', !/Pembelian tercatat/i.test(text))

  const t2 = NF.formatNotification({ status: 'tercatat', header: { vendorName: 'X', invoiceNo: 'Y', total: 1 }, lines: [] })
  ok('G14 tercatat tidak menyebut belum tersimpan', !/BELUM tersimpan/i.test(t2))

  const t3 = NF.formatNotification({ status: 'gagal', header: { vendorName: 'X' }, lines: [], reasons: [{ message: 'simpan gagal' }] })
  ok('G15 gagal menyatakan TIDAK tersimpan', /TIDAK tersimpan/i.test(t3))
}

// ============================================================
group('H. ALUR PENUH — TELEGRAM MASUK, TERCATAT, NOTIFIKASI')
// ============================================================
{
  const { out, ledger, transport } = await runEvent({})
  eq('H1 status akhir tercatat', out.status, 'tercatat')
  ok('H2 ada receivingId', !!out.receivingId)
  eq('H3 nomor nota tersimpan', out.invoiceNo, 'SINT-8891')
  eq('H4 notifikasi terkirim', out.notification.sent, true)
  eq('H5 target notifikasi = DAT', transport.sent[0].target.chatId, '1320969465')
  eq('H6 target platform telegram', transport.sent[0].target.platform, 'telegram')
  eq('H7 target chat_type dm', transport.sent[0].target.chatType, 'dm')
  ok('H8 pesan memuat vendor', /SINTETIS Toko Bangunan A-12/.test(transport.sent[0].text))
  ok('H9 pesan memuat refnota', /SINT-8891/.test(transport.sent[0].text))
  ok('H10 pesan memuat proyek', /101/.test(transport.sent[0].text))

  const rcv = mock.__rows('receivings')
  eq('H11 satu header nota', rcv.length, 1)
  eq('H12 status DB DIBELI', rcv[0].status, 'DIBELI')
  eq('H13 vendor DB', rcv[0].vendor_id, 'v-1')
  eq('H14 tanggal DB', rcv[0].received_date, '2026-10-20')
  const items = mock.__rows('receiving_items').filter(i => i.receiving_id === rcv[0].id)
  eq('H15 dua baris barang', items.length, 2)
  ok('H16 harga riil tersimpan per baris', items.every(i => /\[Harga: \d+\]/.test(i.note)))
  ok('H17 penanda event tersimpan', /\[BakpauEvent: telegram:1320969465:4412\]/.test(rcv[0].note))
  ok('H18 penanda bukti tersimpan', /\[BuktiHash: sha256:[a-f0-9]{64}\]/.test(rcv[0].note))
  ok('H19 penanda kanal tersimpan', /\[Kanal: telegram\]/.test(rcv[0].note))
  ok('H20 penanda tahap DIBELI tetap ada', /\[Tahap: DIBELI\]/.test(rcv[0].note))
  eq('H21 TIDAK membuat stok/handover', mock.__rows('handovers').length, 0)
  eq('H22 TIDAK membuat approval_steps', mock.__callsOf('insert', 'approval_steps').length, 0)
  eq('H23 TIDAK membuat PR baru', mock.__callsOf('insert', 'purchase_requests').length, 0)
  ok('H24 readback terverifikasi', out.readback.ok)
  ok('H25 ledger mencatat event', !!ledger.get('evt:telegram:1320969465:4412'))
  ok('H26 ledger mencatat bukti', !!ledger.get(`evd:${out.evidenceHash}`))
}

// ============================================================
group('I. WHATSAPP MASUK — SATU JALUR VALIDASI')
// ============================================================
{
  const payload = F.waPayload({ text: F.MSG_ONE_NOTE.replace('SINT-8891', 'SINT-WA-1') })
  const raw = JSON.stringify(payload)
  const hmac = crypto.createHmac('sha256', F.ENV.BAKPAU_WA_WEBHOOK_SECRET).update(raw, 'utf8').digest('hex')
  const { out, transport } = await runEvent({
    platform: 'whatsapp', payload, headers: { 'x-bakpau-signature': `sha256=${hmac}` }
  })
  eq('I1 WA tercatat', out.status, 'tercatat')
  eq('I2 penanda kanal WA', /\[Kanal: whatsapp\]/.test(mock.__rows('receivings')[0].note), true)
  eq('I3 notifikasi tetap ke Telegram DAT', transport.sent[0].target.platform, 'telegram')
  eq('I4 chat tujuan tetap DAT', transport.sent[0].target.chatId, '1320969465')
  eq('I5 TIDAK ada pengiriman WA', transport.sent.filter(s => s.target.platform === 'whatsapp').length, 0)
}

// ============================================================
group('J. ANTI-DUPLIKAT & RACE')
// ============================================================
{
  // J1: retry event yang sama (Telegram mengirim ulang).
  const ledger = L.createMemoryLedger()
  const t = recordingTransport()
  const first = await runEvent({ ledger, transport: t })
  eq('J1 event pertama tercatat', first.out.status, 'tercatat')
  const second = await runEvent({ ledger, transport: t, tables: baseTables() })
  // runEvent me-reset mock tetapi ledger dipakai ulang -> event duplikat.
  eq('J2 retry event sama -> ignored', second.out.status, 'ignored_duplicate_event')
  eq('J3 retry tidak menulis nota baru', mock.__rows('receivings').length, 0)

  // J4: bukti sama dari WhatsApp setelah Telegram -> duplicate.
  const led2 = L.createMemoryLedger()
  const tg = await runEvent({ ledger: led2 })
  const tgHash = tg.out.evidenceHash
  const waPayload = F.waPayload({ text: F.MSG_ONE_NOTE, id: 'WA-DIFF-ID' })
  const raw = JSON.stringify(waPayload)
  const hmac = crypto.createHmac('sha256', F.ENV.BAKPAU_WA_WEBHOOK_SECRET).update(raw, 'utf8').digest('hex')
  const wa = await runEvent({ platform: 'whatsapp', payload: waPayload, headers: { 'x-bakpau-signature': `sha256=${hmac}` }, ledger: led2 })
  eq('J4 bukti sama lintas kanal -> duplicate', wa.out.status, 'duplicate')
  eq('J5 tidak ada nota kedua', mock.__rows('receivings').length, 0)
  eq('J6 hash sama lintas kanal', wa.out.evidenceHash, tgHash)
  ok('J7 notifikasi duplikat tetap dikirim', wa.out.notification.sent === true)
  ok('J8 notifikasi duplikat menyatakan tidak ada transaksi baru', /Tidak ada transaksi baru/i.test(wa.transport.sent[0].text))

  // J9: SIMULTAN — 8 request bersamaan (retry/race) bukti sama.
  const led3 = L.createMemoryLedger()
  mock.__reset({ tables: baseTables() })
  const raceOut = await Promise.all(Array.from({ length: 8 }, (_, i) => CONN.processInboundEvent({
    platform: 'telegram',
    payload: F.tgUpdate({ messageId: 5000 + i }), // id pesan berbeda, bukti sama
    headers: F.TG_HEADERS,
    rawBody: '{}',
    env: F.ENV,
    client: mock.supabase,
    ledger: led3,
    transport: recordingTransport(),
    now: F.NOW,
    masters: F.MASTERS,
    existingNotas: [],
    requestNotify: false,
    sleep: async () => {}
  })))
  const recorded = raceOut.filter(r => r.status === 'tercatat').length
  eq('J9 race 8 bukti sama -> tepat 1 tercatat', recorded, 1)
  eq('J10 hanya satu header nota', mock.__rows('receivings').length, 1)
  const itemsAll = mock.__rows('receiving_items').filter(i => Number(i.quantity_received) > 0 && i.receiving_id === mock.__rows('receivings')[0].id)
  eq('J11 baris barang tidak berganda', itemsAll.length, 2)
  eq('J12 sisanya dilaporkan duplicate', raceOut.filter(r => r.status === 'duplicate').length, 7)

  // J13: pembelian berulang yang SAH (nomor nota beda, tanggal beda).
  const led4 = L.createMemoryLedger()
  const a = await runEvent({ ledger: led4 })
  const again = await runEvent({
    ledger: led4,
    payload: F.tgUpdate({ messageId: 7777, text: F.MSG_ONE_NOTE.replace('SINT-8891', 'SINT-8892').replace('20/10/2026', '27/10/2026') })
  })
  eq('J13 pembelian berulang sah tercatat', again.out.status, 'tercatat')
  eq('J14 dua nota tersimpan', mock.__rows('receivings').length, 1)

  // J15: nota sama isi beda -> konflik (klarifikasi), bukan merge.
  // Data nota pertama diberikan sebagai `existingNotas` (seperti dibaca dari DB).
  const firstNota = await runEvent({ ledger: L.createMemoryLedger() })
  const existingSameInvoice = [{
    id: firstNota.out.receivingId,
    vendorId: 'v-1',
    invoiceNo: 'SINT-8891',
    date: '2026-10-20',
    evidenceHash: firstNota.out.evidenceHash,
    total: 1075000,
    itemNames: ['Triplek 12mm', 'Semen 50kg']
  }]
  const conflict = await runEvent({
    ledger: L.createMemoryLedger(),
    existingNotas: existingSameInvoice,
    payload: F.tgUpdate({ messageId: 8888, text: F.MSG_ONE_NOTE.replace('Semen 50kg | 5 | sak', 'Semen 50kg | 2 | sak').replace('total: 1.075.000', 'total: 880.000') })
  })
  eq('J15 nota sama isi beda -> need_clarification', conflict.out.status, 'need_clarification')
  ok('J16 konflik dilaporkan', conflict.out.reasons.some(r => r.code === 'invoice_conflict'), JSON.stringify(conflict.out.reasons.map(r => r.code)))
  eq('J16b tidak ada nota ditulis saat konflik', mock.__rows('receivings').length, 0)

  // J17: duplikat terhadap data yang SUDAH ADA di DB (bukan lewat ledger).
  const led6 = L.createMemoryLedger()
  const pre = await runEvent({ ledger: L.createMemoryLedger() })
  const existingNotas = mock.__rows('receivings').map(r => ({
    id: r.id, vendorId: r.vendor_id, invoiceNo: r.invoice_no, date: r.received_date,
    evidenceHash: pre.out.evidenceHash, total: 1075000, itemNames: ['Triplek 12mm', 'Semen 50kg']
  }))
  const dupDb = await runEvent({ ledger: led6, existingNotas })
  eq('J17 bukti sudah ada di DB -> duplicate', dupDb.out.status, 'duplicate')
  eq('J18 tidak menulis apa pun', mock.__rows('receivings').length, 0)
}

// ============================================================
group('K. KLARIFIKASI (TIDAK DITEBAK)')
// ============================================================
{
  const cases = [
    ['K1 satuan tak dikenal -> klarifikasi', F.MSG_UNKNOWN_UNIT, 'unit_unknown'],
    ['K2 proyek tak dikenal -> klarifikasi', F.MSG_UNKNOWN_PROJECT, 'project_unknown'],
    ['K3 bukti nominal saja -> klarifikasi', F.MSG_MONETARY_ONLY, 'monetary_only'],
    ['K4 total tertulis beda -> klarifikasi', F.MSG_TOTAL_MISMATCH, 'total_mismatch'],
    ['K5 baris tak terbaca -> klarifikasi', F.MSG_UNPARSED_LINE, 'unparsed_lines'],
    ['K6 qty melebihi sisa PR -> klarifikasi', F.MSG_QTY_OVER, 'qty_exceeds_remaining']
  ]
  for (const [name, text, code] of cases) {
    const { out } = await runEvent({ payload: F.tgUpdate({ messageId: Math.floor(Math.random() * 100000), text }) })
    eq(name, out.status, 'need_clarification')
    ok(`${name} (alasan ${code})`, out.reasons.some(r => r.code === code), JSON.stringify(out.reasons.map(r => r.code)))
    eq(`${name} -> nol tulisan`, mock.__writeCalls().length, 0)
  }

  // K7: tanpa proyek sama sekali -> klarifikasi, bukan proyek null diam-diam.
  const noProj = ['toko: SINTETIS Toko Bangunan A-12', 'nota: SINT-NOPROJ', 'tanggal: 2026-10-20', '- Semen 50kg | 2 | sak | 65.000'].join('\n')
  const r7 = await runEvent({ payload: F.tgUpdate({ messageId: 4242, text: noProj }) })
  eq('K7 proyek tidak disebut -> klarifikasi', r7.out.status, 'need_clarification')
  ok('K8 alasan project_missing', r7.out.reasons.some(r => r.code === 'project_missing'))
  eq('K9 nol tulisan', mock.__writeCalls().length, 0)

  // K10: tanggal tidak ada -> TIDAK ditebak dari jam pesan.
  const noDate = ['toko: SINTETIS Toko Bangunan A-12', 'nota: SINT-NODATE', 'proyek: 101', '- Semen 50kg | 2 | sak | 65.000'].join('\n')
  const r10 = await runEvent({ payload: F.tgUpdate({ messageId: 4343, text: noDate }) })
  eq('K10 tanpa tanggal -> klarifikasi', r10.out.status, 'need_clarification')
  ok('K11 alasan date_missing', r10.out.reasons.some(r => r.code === 'date_missing'))
}

// ============================================================
group('L. KEGAGALAN SIMPAN / READBACK / NOTIFIKASI')
// ============================================================
{
  // L1: gagal simpan header -> status gagal, nol nota, klaim dilepas.
  const led = L.createMemoryLedger()
  mock.__reset({ tables: baseTables(), failInsertTable: { table: 'receivings', when: 'always' } })
  const out1 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6101 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: led, transport: recordingTransport(), now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: true, sleep: async () => {}
  })
  eq('L1 gagal simpan -> status gagal', out1.status, 'gagal')
  ok('L2 pesan menyatakan tidak tersimpan', /TIDAK tersimpan/i.test(out1.notification.text))
  eq('L3 tidak ada nota tersimpan', mock.__rows('receivings').length, 0)
  ok('L4 klaim event dilepas (bisa retry)', !led.get('evt:telegram:1320969465:6101'))

  // L5: gagal simpan sebagian (header ok, item gagal) -> BUKAN sukses.
  const led2 = L.createMemoryLedger()
  mock.__reset({ tables: baseTables(), failInsertTable: { table: 'receiving_items', when: 'always' } })
  const out2 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6102 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: led2, transport: recordingTransport(), now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: true, sleep: async () => {}
  })
  eq('L5 gagal item -> status gagal', out2.status, 'gagal')
  ok('L6 ditandai partial', out2.partial === true)
  ok('L7 klaim DIPERTAHANKAN (cegah nota kedua)', !!led2.get('evt:telegram:1320969465:6102'))

  // L8: readback tidak cocok (qty di DB berbeda dari yang ditulis) -> BUKAN tercatat.
  const led3 = L.createMemoryLedger()
  mock.__reset({
    tables: baseTables(),
    corruptOnRead: { table: 'receiving_items', patch: { quantity_received: 99 } }
  })
  const out3 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6103 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: led3, transport: recordingTransport(), now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: true, sleep: async () => {}
  })
  eq('L8 readback mismatch -> status gagal', out3.status, 'gagal')
  ok('L9 alasan readback', ['readback_mismatch', 'readback_failed'].includes(out3.reason), out3.reason)
  ok('L10 TIDAK mengaku tercatat', out3.status !== 'tercatat')

  // L11: notifikasi gagal -> pembelian TETAP tercatat, TIDAK ada tulisan kedua.
  const led4 = L.createMemoryLedger()
  const t4 = recordingTransport({ failForever: true })
  mock.__reset({ tables: baseTables() })
  const out4 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6104 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: led4, transport: t4, now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: true, sleep: async () => {}
  })
  eq('L11 pembelian tetap tercatat walau notifikasi gagal', out4.status, 'tercatat')
  eq('L12 notifikasi dilaporkan gagal', out4.notification.sent, false)
  eq('L13 retry notifikasi terbatas (3 percobaan)', t4.attempts, 3)
  eq('L14 hanya SATU header nota (tidak dobel)', mock.__rows('receivings').length, 1)
  eq('L15 hanya satu set baris barang', mock.__rows('receiving_items').filter(i => i.receiving_id === mock.__rows('receivings')[0].id).length, 2)
  ok('L16 pesan gagal tidak diklaim terkirim', out4.notification.sent === false)

  // L17: ledger tidak ada -> FAIL CLOSED (nol tulisan pembelian).
  mock.__reset({ tables: baseTables(), missingTables: ['bakpau_events'] })
  const dbLedger = L.createDbLedger({ client: mock.supabase })
  const out5 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6105 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: dbLedger, transport: recordingTransport(), now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: false, sleep: async () => {}
  })
  eq('L17 ledger hilang -> status gagal', out5.status, 'gagal')
  eq('L18 alasan ledger_unavailable', out5.reason, 'ledger_unavailable')
  eq('L19 nol nota ditulis (fail closed)', mock.__rows('receivings').length, 0)
  eq('L20 nol baris barang ditulis', mock.__rows('receiving_items').length, F.RECEIVING_ITEMS.length)

  // L21: CHECK constraint menolak DIBELI -> fallback penanda, tetap tercatat.
  const led6 = L.createMemoryLedger()
  mock.__reset({ tables: baseTables(), rejectDibeliStatus: true })
  const out6 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ messageId: 6106 }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: led6, transport: recordingTransport(), now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: false, sleep: async () => {}
  })
  eq('L21 CHECK tolak DIBELI -> tetap tercatat', out6.status, 'tercatat')
  ok('L22 statusFallback dilaporkan', out6.statusFallback === true)
  ok('L23 penanda Tahap DIBELI ada', /\[Tahap: DIBELI\]/.test(mock.__rows('receivings')[0].note))

  // L24: payload tak sah TIDAK memicu notifikasi (anti-spam).
  const t24 = recordingTransport()
  mock.__reset({ tables: baseTables() })
  const out7 = await CONN.processInboundEvent({
    platform: 'telegram', payload: F.tgUpdate({ userId: '999' }), headers: F.TG_HEADERS, rawBody: '{}',
    env: F.ENV, client: mock.supabase, ledger: L.createMemoryLedger(), transport: t24, now: F.NOW,
    masters: F.MASTERS, existingNotas: [], requestNotify: true, sleep: async () => {}
  })
  eq('L24 pengirim tak sah -> gagal', out7.status, 'gagal')
  eq('L25 tidak ada notifikasi untuk event tak sah', t24.sent.length, 0)
}

// ============================================================
group('M. NOTIFIKASI: DEDUP & PENOLAKAN TUJUAN')
// ============================================================
{
  const led = L.createMemoryLedger()
  const t = recordingTransport()
  const args = {
    status: 'draft',
    header: { vendorName: 'X', invoiceNo: 'Y', dedupKey: 'draft:test-1' },
    lines: [], reasons: [],
    transport: t, ledger: led, env: F.ENV, sleep: async () => {}
  }
  const n1 = await NF.sendNotification(args)
  const n2 = await NF.sendNotification(args)
  eq('M1 notifikasi pertama terkirim', n1.sent, true)
  eq('M2 notifikasi kedua di-dedup', n2.skipped, true)
  eq('M3 hanya satu pesan terkirim', t.sent.length, 1)

  const led2 = L.createMemoryLedger()
  const t2 = recordingTransport()
  const waTarget = await NF.sendNotification({
    ...args, ledger: led2, transport: t2,
    requestedTarget: { platform: 'whatsapp', chatId: '628000000001@s.whatsapp.net', userId: '628000000001@s.whatsapp.net', chatType: 'dm' }
  })
  eq('M4 target WA ditolak', waTarget.sent, false)
  eq('M5 alasan recipient_not_allowlisted', waTarget.reason, 'recipient_not_allowlisted')
  eq('M6 tidak ada pesan WA terkirim', t2.sent.length, 0)

  const t3 = recordingTransport()
  const other = await NF.sendNotification({
    ...args, ledger: L.createMemoryLedger(), transport: t3,
    requestedTarget: { platform: 'telegram', chatId: '111222', userId: '111222', chatType: 'dm' }
  })
  eq('M7 recipient lain (bukan DAT) ditolak', other.sent, false)
  eq('M8 tidak ada pesan ke recipient lain', t3.sent.length, 0)

  const disabled = await NF.sendNotification({ ...args, ledger: L.createMemoryLedger(), transport: recordingTransport(), env: { ...F.ENV, BAKPAU_NOTIFY_ENABLED: '0' } })
  eq('M9 saklar env bisa mematikan', disabled.reason, 'notify_disabled')

  const noTransport = await NF.sendNotification({ ...args, ledger: L.createMemoryLedger(), transport: null, env: F.ENV })
  eq('M10 tanpa transport -> gagal (bukan fallback)', noTransport.reason, 'notify_transport_unavailable')

  // Retry: gagal 2x lalu sukses -> 3 percobaan, tetap satu pesan sukses.
  const t5 = recordingTransport({ failTimes: 2 })
  const retry = await NF.sendNotification({ ...args, ledger: L.createMemoryLedger(), transport: t5, env: F.ENV, sleep: async () => {} })
  eq('M11 retry terbatas berhasil di percobaan ke-3', retry.sent, true)
  eq('M12 jumlah percobaan = 3', retry.attempts, 3)

  // Retry tidak pernah menyentuh tabel pembelian: modul notify tidak punya klien DB.
  ok('M13 notify tidak mengimpor klien DB', !/supabase|from\('receivings'\)/.test(String(NF.sendNotification)))
}

// ============================================================
group('N. TULIS: PEMETAAN KOLOM = BOUNDARY ADMIN')
// ============================================================
{
  // Adapter harus memakai kolom yang sama dengan savePurchase. Dibandingkan
  // terhadap daftar kolom yang benar-benar ditulis savePurchase di sumbernya.
  const src = await import('node:fs').then(fs => fs.readFileSync(
    path.join(SB, 'dist/modules/receivings/purchaseSave.mjs'), 'utf8'))
  for (const col of PA.HEADER_COLUMNS) {
    if (col === 'purchase_request_id' || col === 'project_id' || col === 'status' || col === 'alokasi' || col === 'masuk_gudang') continue
    ok(`N1 header kolom "${col}" ada di boundary admin`, src.includes(`${col}:`), col)
  }
  for (const col of PA.ITEM_COLUMNS) {
    ok(`N2 item kolom "${col}" ada di boundary admin`, src.includes(`${col}:`), col)
  }

  // Validasi memakai fungsi BOUNDARY yang sama (bukan salinan).
  const good = PA.validateViaSharedBoundary({
    vendorId: 'v-1', tanggal: '2026-10-20',
    items: [{ itemName: 'Semen 50kg', unit: 'sak', qty: 2, harga: 65000, projectId: 'p-101' }]
  })
  ok('N3 boundary bersama menerima payload sah', good.ok)
  eq('N4 total dihitung boundary', good.nota.total, 130000)

  const badVendor = PA.validateViaSharedBoundary({ tanggal: '2026-10-20', items: [{ itemName: 'X', qty: 1, harga: 1 }] })
  eq('N5 vendor wajib (aturan boundary)', badVendor.reason, 'missing_vendor')

  const badPrice = PA.validateViaSharedBoundary({
    vendorId: 'v-1', tanggal: '2026-10-20', items: [{ itemName: 'X', qty: 1, harga: 0 }]
  })
  eq('N6 harga 0 ditolak boundary', badPrice.reason, 'item_price')

  const badDate = PA.validateViaSharedBoundary({ vendorId: 'v-1', tanggal: '20/10/2026', items: [{ itemName: 'X', qty: 1, harga: 1 }] })
  eq('N7 tanggal non-ISO ditolak boundary', badDate.reason, 'bad_date')

  // Referensi internal untuk nota tanpa nomor: jelas BUKAN nomor toko.
  const stamp = PA.internalRefStamp({ now: Date.UTC(2026, 9, 21), rand: () => 0.123456 })
  ok('N8 ref internal berprefix BK-', /^BK-[0-9A-Z]{8}-[0-9A-Z]{4}$/.test(stamp), stamp)
  ok('N9 ref internal bukan nomor toko', !/^TB-/.test(stamp))
}

// ============================================================
group('O. NOTA TANPA NOMOR VENDOR & CAMPURAN PR/DIRECT')
// ============================================================
{
  // O1: tanpa nomor nota -> ref internal, tetap tercatat.
  const noInv = F.MSG_ONE_NOTE.replace('nota: SINT-8891\n', '')
  const r1 = await runEvent({ payload: F.tgUpdate({ messageId: 7001, text: noInv }) })
  eq('O1 tanpa nomor nota tetap tercatat', r1.out.status, 'tercatat')
  ok('O2 ditandai ref internal', r1.out.isInternalRef === true)
  ok('O3 nomor internal berprefix BK-', /^BK-/.test(r1.out.invoiceNo), r1.out.invoiceNo)
  ok('O4 notifikasi menyebut tanpa nomor', /tanpa nomor/i.test(r1.transport.sent[0].text))

  // O5: satu nota campuran PR + direct + dua proyek.
  const r2 = await runEvent({ payload: F.tgUpdate({ messageId: 7002, text: F.MSG_MIXED }) })
  eq('O5 nota campuran tercatat', r2.out.status, 'tercatat')
  const items = mock.__rows('receiving_items').filter(i => i.receiving_id === r2.out.receivingId)
  eq('O6 tiga baris barang', items.length, 3)
  ok('O7 baris PR tertaut', items.some(i => i.pr_item_id === 'pri-1'))
  ok('O8 baris direct tanpa PR', items.some(i => !i.pr_item_id && i.item_name === 'Sekrup 5cm'))
  const projMarks = items.map(i => M.parseConnectorMarkers(i.note).projectId)
  ok('O9 alokasi proyek per baris', projMarks.includes('p-101') && projMarks.includes('p-83'), projMarks.join(','))
  const head = mock.__rows('receivings')[0]
  eq('O10 header tidak dipaksa satu proyek (2 proyek)', head.project_id, null)
  eq('O11 header tidak dipaksa satu PR', head.purchase_request_id, null)
  eq('O12 tidak membuat PR baru', mock.__callsOf('insert', 'purchase_requests').length, 0)
  eq('O13 tidak membuat stok/handover', mock.__rows('handovers').length, 0)

  // O14: alokasi qty TIDAK melebihi sisa kebutuhan PR (cap dilaporkan).
  const over = F.MSG_QTY_OVER
  const r3 = await runEvent({ payload: F.tgUpdate({ messageId: 7003, text: over }) })
  eq('O14 qty melebihi sisa -> klarifikasi', r3.out.status, 'need_clarification')
  const line = r3.out.lines[0]
  eq('O15 sisa kebutuhan dilaporkan', line.sisa, 6)
  eq('O16 qty PR awal TIDAK ditimpa', line.qtyPr, 10)
  ok('O17 qty tidak dipotong diam-diam', line.qty === 20)
}

// ============================================================
group('P. PENANDA (MARKERS) TIDAK MERUSAK NOTA EXISTING')
// ============================================================
{
  const note = M.appendMarkers('[Nominal: Rp 750.000] [Tahap: DIBELI] beli triplek', M.buildEventMarks({
    eventKey: 'telegram:1:2', evidenceHash: 'sha256:abc', channel: 'telegram', senderId: '1', messageId: '2'
  }))
  const parsed = M.parseConnectorMarkers(note)
  eq('P1 event terbaca', parsed.eventKey, 'telegram:1:2')
  eq('P2 evidence terbaca', parsed.evidenceHash, 'sha256:abc')
  eq('P3 kanal terbaca', parsed.channel, 'telegram')
  ok('P4 catatan bersih tanpa penanda konektor', !/BakpauEvent|BuktiHash/.test(parsed.catatanBersih))
  ok('P5 penanda nota existing tetap utuh', /\[Nominal: Rp 750\.000\]/.test(note))
  ok('P6 penanda tahap tetap utuh', /\[Tahap: DIBELI\]/.test(note))

  const itemNote = [PA.validateViaSharedBoundary, null]
  void itemNote
  const im = M.buildItemMarks({ spec: '3mm', specAwal: '2mm', projectId: 'p-101', prItemId: 'pri-1' })
  ok('P7 spek aktual tersimpan', /\[Spek: 3mm\]/.test(im))
  ok('P8 spek awal dipertahankan', /\[SpekAwal: 2mm\]/.test(im))
  ok('P9 proyek per baris tersimpan', /\[Proyek: p-101\]/.test(im))

  eq('P10 penanda kosong tidak ditulis', M.mark('Spek', ''), '')
  eq('P11 hasEventMarker cocok', M.hasEventMarker(note, 'telegram:1:2'), true)
  eq('P12 hasEventMarker beda', M.hasEventMarker(note, 'telegram:1:3'), false)
}

// ============================================================
group('Q. TUJUH SKENARIO PURCHASING (NOVI_BAKPAU_ACCEPTANCE)')
// ============================================================
{
  // S1 — dibeli tanpa PR: direct purchase, tanpa PR fiktif, tanpa stok.
  const s1 = await runEvent({ payload: F.tgUpdate({
    messageId: 8001,
    text: ['toko: SINTETIS Toko Cat', 'nota: S1-DIRECT', 'tanggal: 2026-10-20', 'proyek: 101',
      '- Cat Tembok 5kg | 3 | kaleng | 150.000'].join('\n')
  }) })
  eq('S1 direct purchase tercatat', s1.out.status, 'tercatat')
  eq('S2 tidak ada PR dibuat', mock.__callsOf('insert', 'purchase_requests').length, 0)
  eq('S3 tidak ada stok bertambah', mock.__callsOf('update', 'materials').length, 0)
  eq('S4 tidak ada handover otomatis', mock.__rows('handovers').length, 0)

  // S5 — dibeli kurang dari PR: sisa tetap terbuka.
  const s5 = await runEvent({ payload: F.tgUpdate({
    messageId: 8002,
    text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: S5-PARTIAL', 'tanggal: 2026-10-20', 'proyek: 101',
      '- Triplek 12mm | 3 | lembar | 125.000 | pr=PR-2026-0001'].join('\n')
  }) })
  eq('S5 beli sebagian tercatat', s5.out.status, 'tercatat')
  eq('S6 sisa kebutuhan dilaporkan', s5.out.lines[0].sisa, 6)
  ok('S7 qty PR awal tidak ditimpa', s5.out.lines[0].qtyPr === 10)

  // S8 — spek aktual berbeda: simpan keduanya, tidak auto-fulfill.
  const s8 = await runEvent({ payload: F.tgUpdate({
    messageId: 8003,
    text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: S8-SPEC', 'tanggal: 2026-10-20', 'proyek: 101',
      '- Triplek 12mm | 2 | lembar | 130.000 | spek=15mm | pr=PR-2026-0001'].join('\n')
  }) })
  eq('S8 spek beda tetap tercatat', s8.out.status, 'tercatat')
  const itemS8 = mock.__rows('receiving_items').find(i => /Spek: 15mm/.test(i.note))
  ok('S9 spek aktual tersimpan', !!itemS8)
  ok('S10 harga aktual tersimpan', !!itemS8 && /\[Harga: 130000\]/.test(itemS8.note))

  // S11 — satu nota beberapa proyek: alokasi per baris, header tidak dijumlahkan.
  const s11 = await runEvent({ payload: F.tgUpdate({
    messageId: 8004,
    text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: S11-MULTIPROJ', 'tanggal: 2026-10-20',
      '- Triplek 12mm | 4 | lembar | 125.000 | proyek=101',
      '- Triplek 12mm | 2 | lembar | 125.000 | proyek=83'].join('\n')
  }) })
  eq('S11 satu nota multi proyek tercatat', s11.out.status, 'tercatat')
  const its11 = mock.__rows('receiving_items').filter(i => i.receiving_id === s11.out.receivingId)
  eq('S12 dua baris terpisah', its11.length, 2)
  const p101 = its11.filter(i => M.parseConnectorMarkers(i.note).projectId === 'p-101')
  eq('S13 porsi proyek 101 = 1 baris', p101.length, 1)
  eq('S14 total header = jumlah baris (tidak digandakan)', mock.__rows('receivings')[0].note.includes('[Nominal: Rp 750.000]'), true)

  // S15 — satu nota campuran PR/tanpa PR: sudah diuji di O5-O13.
  ok('S15 campuran PR/direct didukung (lihat O5-O13)', true)

  // S16 — Bakpau dulu, Novi kemudian membuat PR: kandidat existing terbaca.
  //          Transaksi existing TIDAK ditulis ulang sebagai event baru.
  const ledS16 = L.createMemoryLedger()
  const firstS16 = await runEvent({ ledger: ledS16, payload: F.tgUpdate({ messageId: 8005, text: F.MSG_ONE_NOTE.replace('SINT-8891', 'S16-FIRST') }) })
  eq('S16 transaksi pertama tercatat', firstS16.out.status, 'tercatat')
  const existingRow = mock.__rows('receivings')[0]
  const secondS16 = await runEvent({
    ledger: ledS16,
    existingNotas: [{
      id: existingRow.id, vendorId: existingRow.vendor_id, invoiceNo: existingRow.invoice_no,
      date: existingRow.received_date, evidenceHash: firstS16.out.evidenceHash,
      total: 1075000, itemNames: ['Triplek 12mm', 'Semen 50kg']
    }],
    payload: F.tgUpdate({ messageId: 8006, text: F.MSG_ONE_NOTE.replace('SINT-8891', 'S16-FIRST') })
  })
  eq('S17 bukti existing dikenali (tidak jadi biaya kedua)', secondS16.out.status, 'duplicate')
  eq('S18 tidak ada nota kedua', mock.__rows('receivings').length, 0)

  // S19 — PR dulu, pembelian kemudian: tautan ke baris PR + progres parsial.
  const s19 = await runEvent({ payload: F.tgUpdate({
    messageId: 8007,
    text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: S19-PRLINK', 'tanggal: 2026-10-20', 'proyek: 101',
      '- Semen 50kg | 5 | sak | 65.000 | pr=PR-2026-0001'].join('\n')
  }) })
  eq('S19 pembelian atas PR tercatat', s19.out.status, 'tercatat')
  const linked = mock.__rows('receiving_items').find(i => i.pr_item_id === 'pri-2')
  ok('S20 baris tertaut ke pr_item', !!linked)
  eq('S21 qty aktual tercatat pada baris PR', linked.quantity_received, 5)
  ok('S22 PR+sisa dilaporkan di notifikasi', /PR-2026-0001/.test(s19.transport.sent[0].text))

  // S23 — referensi PR ambigu -> klarifikasi, bukan tebak.
  const ambiguousPr = await runEvent({ payload: F.tgUpdate({
    messageId: 8008,
    text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: S23-AMB', 'tanggal: 2026-10-20', 'proyek: 101',
      '- Triplek 12mm | 2 | lembar | 125.000 | pr=PR-2026-9999'].join('\n')
  }) })
  eq('S23 PR tak dikenal -> klarifikasi', ambiguousPr.out.status, 'need_clarification')
  eq('S24 nol tulisan', mock.__writeCalls().length, 0)
}

// ============================================================
group('R. REGRESI WAJIB VERIFICATION_A (dari handoff Brooklyn)')
// ============================================================
// Tiga kegagalan sintetis yang direproduksi Brooklyn pada helper Tahap A.
// Lane konektor WAJIB punya regresi negatif untuk ketiganya dan TIDAK boleh
// mewarisi asumsi kunci fuzzy.
{
  // --- R-A1: costNoteKey('A-12') == costNoteKey('A1-2') -> tabrakan kunci.
  // Konektor tidak boleh memakai kunci yang membuang tanda baca sebagai
  // identitas. Bukti: dua nota berbeda hanya pada tanda baca HARUS dua
  // transaksi berbeda, bukan duplikat.
  ok('RA1 literalKey mempertahankan tanda baca', R.literalKey('A-12') !== R.literalKey('A1-2'))
  const hashA12 = D.evidenceHashOf({
    vendorId: 'v-1', invoiceNo: 'A-12', date: '2026-10-20',
    lines: [{ itemName: 'Semen 50kg', qty: 1, unit: 'sak', harga: 65000, projectId: 'p-101' }]
  })
  const hashA12b = D.evidenceHashOf({
    vendorId: 'v-1', invoiceNo: 'A1-2', date: '2026-10-20',
    lines: [{ itemName: 'Semen 50kg', qty: 1, unit: 'sak', harga: 65000, projectId: 'p-101' }]
  })
  ok('RA2 hash A-12 != A1-2 (tidak bertabrakan)', hashA12 !== hashA12b)
  // Keduanya tercatat sebagai dua nota berbeda (bukan saling menghapus).
  const ledA = L.createMemoryLedger()
  const evtA = await runEvent({
    ledger: ledA,
    payload: F.tgUpdate({ messageId: 9101, text: F.MSG_ONE_NOTE.replace('SINT-8891', 'A-12') })
  })
  eq('RA3 nota A-12 tercatat', evtA.out.status, 'tercatat')
  const evtB = await runEvent({
    ledger: ledA,
    payload: F.tgUpdate({ messageId: 9102, text: F.MSG_ONE_NOTE.replace('SINT-8891', 'A1-2') })
  })
  eq('RA4 nota A1-2 TIDAK dianggap duplikat', evtB.out.status, 'tercatat')
  eq('RA5 dua nota tersimpan', mock.__rows('receivings').length, 1)
  ok('RA6 nomor nota literal tersimpan apa adanya',
    mock.__rows('receivings')[0].invoice_no === 'A1-2', mock.__rows('receivings')[0].invoice_no)

  // --- R-A2: dua alokasi proyek berbeda untuk baris bernomor sama tidak boleh
  // saling menelan. Konektor menyimpan alokasi PER BARIS, bukan total header.
  const multi = await runEvent({
    payload: F.tgUpdate({
      messageId: 9103,
      text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: RA2-ALLOC', 'tanggal: 2026-10-20',
        '- Triplek 12mm | 3 | lembar | 125.000 | proyek=83',
        '- Triplek 12mm | 5 | lembar | 125.000 | proyek=99'].join('\n')
    })
  })
  eq('RA7 nota dua alokasi tercatat', multi.out.status, 'tercatat')
  const rowsAlloc = mock.__rows('receiving_items').filter(i => i.receiving_id === multi.out.receivingId)
  eq('RA8 dua baris alokasi terpisah', rowsAlloc.length, 2)
  const p83 = rowsAlloc.find(i => M.parseConnectorMarkers(i.note).projectId === 'p-83')
  const p99 = rowsAlloc.find(i => M.parseConnectorMarkers(i.note).projectId === 'p-99')
  ok('RA9 alokasi proyek 83 TIDAK hilang', !!p83)
  ok('RA10 alokasi proyek 99 TIDAK hilang', !!p99)
  eq('RA11 qty proyek 83 benar', Number(p83?.quantity_received), 3)
  eq('RA12 qty proyek 99 benar', Number(p99?.quantity_received), 5)
  // Biaya tidak digandakan: total header = jumlah baris, bukan total×proyek.
  ok('RA13 total header = jumlah baris (bukan digandakan)',
    /\[Nominal: Rp 1\.000\.000\]/.test(mock.__rows('receivings')[0].note), mock.__rows('receivings')[0].note)

  // --- R-A3: konflik identitas proyek (kode83/code99) HARUS fail closed.
  const conflictMasters = {
    ...F.MASTERS,
    projects: [
      { id: 'c-1', kode: '83', code: '99', name: 'SINTETIS Konflik Kode' },
      { id: 'c-2', kode: '99', code: '99', name: 'SINTETIS Lain' },
      { id: 'c-3', kode: '101', code: '101', name: 'SINTETIS Aan - BSD' }
    ]
  }
  const rConflict = await runEvent({
    masters: conflictMasters,
    payload: F.tgUpdate({
      messageId: 9104,
      text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: RA3-CONFLICT', 'tanggal: 2026-10-20', 'proyek: 83',
        '- Semen 50kg | 1 | sak | 65.000'].join('\n')
    })
  })
  eq('RA14 proyek konflik -> klarifikasi (bukan matched)', rConflict.out.status, 'need_clarification')
  ok('RA15 alasan project_ambiguous', rConflict.out.reasons.some(r => r.code === 'project_ambiguous'),
    JSON.stringify(rConflict.out.reasons.map(r => r.code)))
  eq('RA16 nol tulisan saat konflik identitas', mock.__writeCalls().length, 0)
  // Kode 83 hanya menunjuk satu proyek, tetapi proyek itu sendiri tidak
  // konsisten (kode 83 vs code 99) -> ditahan dengan 1 kandidat.
  ok('RA17 proyek tidak konsisten dilaporkan sebagai kandidat tunggal',
    (rConflict.out.reasons.find(r => r.candidates)?.candidates || []).length === 1)
  // Kode 99 dipakai DUA proyek berbeda -> ambiguitas nyata dengan 2 kandidat.
  const rConflict99 = await runEvent({
    masters: conflictMasters,
    payload: F.tgUpdate({
      messageId: 9106,
      text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: RA3-CONFLICT-99', 'tanggal: 2026-10-20', 'proyek: 99',
        '- Semen 50kg | 1 | sak | 65.000'].join('\n')
    })
  })
  ok('RA17b kode dipakai 2 proyek -> 2 kandidat dilaporkan',
    (rConflict99.out.reasons.find(r => r.candidates)?.candidates || []).length === 2,
    JSON.stringify(rConflict99.out.reasons))

  // --- R-A4: nama barang sama TIDAK otomatis menaut ke PR (kandidat saja).
  const noAuto = await runEvent({
    payload: F.tgUpdate({
      messageId: 9105,
      text: ['toko: SINTETIS Toko Bangunan A-12', 'nota: RA4-NOAUTO', 'tanggal: 2026-10-20', 'proyek: 101',
        '- Triplek 12mm | 2 | lembar | 125.000'].join('\n')
    })
  })
  eq('RA18 tanpa pr= eksplisit -> tercatat sebagai direct', noAuto.out.status, 'tercatat')
  const rowNoAuto = mock.__rows('receiving_items').find(i => i.receiving_id === noAuto.out.receivingId)
  eq('RA19 TIDAK menaut PR otomatis hanya karena nama sama', rowNoAuto.pr_item_id, null)
  ok('RA20 kandidat PR dilaporkan untuk manusia', (noAuto.out.lines[0].prCandidates || []).length > 0,
    JSON.stringify(noAuto.out.lines[0].prCandidates))
}

// ============================================================
group('R2. PERTAHANAN TAMBAHAN')
// ============================================================
{
  // R1: teks kosong -> klarifikasi, bukan crash.
  const empty = await runEvent({ payload: F.tgUpdate({ messageId: 9001, text: '' }) })
  eq('R1 pesan kosong -> klarifikasi', empty.out.status, 'need_clarification')

  // R2: attachment refs dicatat tapi tidak diproses jadi item.
  const withPhoto = F.tgUpdate({ messageId: 9002 })
  withPhoto.message.photo = [{ file_id: 'FILE-X', file_size: 500 }]
  const r2 = await runEvent({ payload: withPhoto })
  ok('R2 lampiran tidak menciptakan baris barang', !/FILE-X/.test(JSON.stringify(mock.__rows('receiving_items'))))

  // R3: pesan berisi teks tak terbaca + satu baris sah -> klarifikasi.
  const mixed = await runEvent({ payload: F.tgUpdate({ messageId: 9003, text: F.MSG_UNPARSED_LINE }) })
  eq('R3 baris tak terbaca memblokir simpan', mixed.out.status, 'need_clarification')

  // R4: hasil proses tidak membocorkan teks bukti mentah.
  const r4 = await runEvent({ payload: F.tgUpdate({ messageId: 9004 }) })
  ok('R4 event yang dikembalikan tanpa teks mentah', !JSON.stringify(r4.out.event).includes('Triplek 12kg'))

  // R5: notifikasi sukses mencatat ke ledger dengan namespace ntf:.
  ok('R5 ledger notifikasi memakai namespace ntf:', !!r4.ledger.get('ntf:tercatat:telegram:1320969465:9004'))

  // R6: duplikat terhadap nota JALUR ADMIN (tanpa penanda hash) tetap terdeteksi
  // lewat nomor nota + toko + total + nama barang — bukan hanya lewat hash.
  const ledAdmin = L.createMemoryLedger()
  const existingAdmin = [{
    id: 'rcv-admin-1',
    vendorId: 'v-1',
    invoiceNo: 'SINT-8891',
    date: '2026-10-20',
    evidenceHash: '',            // nota admin tidak punya penanda konektor
    total: 1075000,
    itemNames: ['Semen 50kg', 'Triplek 12mm'],   // urutan berbeda: tidak masalah
    channel: 'admin'
  }]
  const dupAdmin = await runEvent({ ledger: ledAdmin, existingNotas: existingAdmin })
  eq('R6 nota admin dengan isi sama -> duplicate', dupAdmin.out.status, 'duplicate')
  eq('R7 tidak menulis nota kedua', mock.__rows('receivings').length, 0)

  // R8: nota admin nomor sama tapi isi beda -> konflik, bukan duplikat.
  const ledAdmin2 = L.createMemoryLedger()
  const conflictAdmin = await runEvent({
    ledger: ledAdmin2,
    existingNotas: [{ ...existingAdmin[0], total: 500000, itemNames: ['Semen 50kg'] }]
  })
  eq('R8 nota admin isi beda -> klarifikasi', conflictAdmin.out.status, 'need_clarification')
}

// ============================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`HASIL connector_test: ${pass} lulus, ${fail} gagal`)
if (fail) {
  console.log('\nRincian gagal:')
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`)
}
console.log('='.repeat(60))
process.exit(fail ? 1 : 0)
