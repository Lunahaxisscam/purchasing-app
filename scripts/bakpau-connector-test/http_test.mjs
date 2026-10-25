// ============================================================
// http_test.mjs — HARNESS ENDPOINT (handler ASLI, tanpa server)
// ============================================================
// Memanggil createBakpauIntakeHandler dengan req/res tiruan untuk membuktikan:
//   * POST saja (GET 405), body bukan JSON 400
//   * tanpa kredensial server -> 503 (fail closed)
//   * secret salah -> 401, allowlist kosong -> 503, grup -> 401
//   * sukses -> 200 dengan status tercatat dan TIDAK membocorkan token/teks
//   * platform DIKUNCI oleh route (payload tidak bisa mengaku kanal lain)
//   * WhatsApp memakai HMAC atas body MENTAH (bukan hasil re-stringify)
// ============================================================
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = rel => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const H = await load('lib/bakpau/httpHandler.mjs')
const L = await load('lib/bakpau/ledger.mjs')
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

function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this }
  }
  return res
}

function makeReq({ method = 'POST', body = {}, headers = {}, raw = null } = {}) {
  const req = {
    method,
    headers,
    body: raw !== null ? raw : body,
    query: {}
  }
  return req
}

function tables() {
  return {
    projects: F.PROJECTS.map(p => ({ ...p })),
    vendors: F.VENDORS.map(v => ({ ...v })),
    purchase_requests: F.REQUESTS.map(r => ({ ...r })),
    pr_items: F.PR_ITEMS.map(i => ({ ...i })),
    receiving_items: F.RECEIVING_ITEMS.map(i => ({ ...i })),
    receivings: [],
    handovers: [],
    bakpau_events: []
  }
}

function transport() {
  const sent = []
  return { sent, async send(target, text) { sent.push({ target: { ...target }, text }); return { ok: true, messageId: 'm1' } } }
}

async function call(platform, { method = 'POST', body = {}, headers = {}, raw = null, env = F.ENV, client = mock.supabase, led = null, tr = null } = {}) {
  const handler = H.createBakpauIntakeHandler(platform, {
    env,
    createClient: () => client,
    ledger: led || L.createMemoryLedger(),
    transport: tr || transport(),
    processInboundEvent: undefined // pakai default (kode produksi)
  })
  const res = makeRes()
  await handler(makeReq({ method, body, headers, raw }), res)
  return res
}

// ============================================================
group('S. METODE & KONFIGURASI')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const get = await call('telegram', { method: 'GET' })
  eq('S1 GET ditolak 405', get.statusCode, 405)
  ok('S2 Allow header POST', String(get.headers.Allow).includes('POST'))

  const noCreds = await call('telegram', { client: null, body: F.tgUpdate(), headers: F.TG_HEADERS })
  eq('S3 tanda tangan sah tanpa kredensial server -> 503', noCreds.statusCode, 503)
  eq('S4 kode no_service_credentials', noCreds.body.code, 'no_service_credentials')

  // DEFECT YANG DITUTUP (t_dd743609): permintaan TIDAK SAH harus ditolak
  // SEBELUM klien DB dibuat / master dibaca. Tanpa kredensial DAN tanpa
  // tanda tangan -> 401, bukan 503 (bukti bahwa gerbang auth jalan lebih dulu).
  mock.__reset({ tables: tables() })
  const noCredsNoSig = await call('telegram', { client: null, body: F.tgUpdate(), headers: {} })
  eq('S6 tanpa kredensial & tanpa tanda tangan -> 401 (auth lebih dulu)', noCredsNoSig.statusCode, 401)

  // Dan dengan klien tersedia, penolakan auth tidak boleh menghasilkan satu
  // pun query DB (master/nota) — inilah inti perbaikan urutan gerbang.
  mock.__reset({ tables: tables() })
  const badSigNoDb = await call('telegram', { body: F.tgUpdate(), headers: { 'X-Telegram-Bot-Api-Secret-Token': 'palsu' } })
  eq('S7 tanda tangan salah -> 401', badSigNoDb.statusCode, 401)
  const dbTouches = mock.__state.calls.filter(c => ['select', 'insert', 'update', 'delete', 'rpc'].includes(c.op)).length
  eq('S8 nol aktivitas DB saat tanda tangan salah', dbTouches, 0)

  mock.__reset({ tables: tables() })
  const badJson = await call('telegram', { raw: '{bukan json' })
  eq('S5 body bukan JSON -> 400', badJson.statusCode, 400)
}

// ============================================================
group('T. AUTENTIKASI ENDPOINT')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const noSig = await call('telegram', { body: F.tgUpdate(), headers: {} })
  eq('T1 tanpa secret -> 401', noSig.statusCode, 401)
  eq('T2 kode bad_signature', noSig.body.reason, 'bad_signature')

  mock.__reset({ tables: tables() })
  const badSig = await call('telegram', { body: F.tgUpdate(), headers: { 'X-Telegram-Bot-Api-Secret-Token': 'palsu' } })
  eq('T3 secret salah -> 401', badSig.statusCode, 401)

  mock.__reset({ tables: tables() })
  const noAllow = await call('telegram', {
    body: F.tgUpdate(), headers: F.TG_HEADERS,
    env: { ...F.ENV, BAKPAU_TELEGRAM_ALLOWED_USER_IDS: '' }
  })
  eq('T4 allowlist kosong -> 503 (fail closed)', noAllow.statusCode, 503)

  mock.__reset({ tables: tables() })
  const stranger = await call('telegram', { body: F.tgUpdate({ userId: '424242' }), headers: F.TG_HEADERS })
  eq('T5 pengirim asing -> 401', stranger.statusCode, 401)

  mock.__reset({ tables: tables() })
  const grp = await call('telegram', { body: F.tgUpdate({ chatType: 'group' }), headers: F.TG_HEADERS })
  eq('T6 grup -> 401', grp.statusCode, 401)

  mock.__reset({ tables: tables() })
  const stale = await call('telegram', { body: F.tgUpdate({ date: F.NOW_SEC - 9999 }), headers: F.TG_HEADERS })
  eq('T7 replay -> 401', stale.statusCode, 401)

  mock.__reset({ tables: tables() })
  const rpcNoSecret = await call('telegram', {
    body: F.tgUpdate(), headers: F.TG_HEADERS,
    env: { ...F.ENV, BAKPAU_TELEGRAM_WEBHOOK_SECRET: '' }
  })
  eq('T8 secret belum diset -> 503', rpcNoSecret.statusCode, 503)
}

// ============================================================
group('U. SUKSES & KEBOCORAN DATA')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const tr = transport()
  const okRes = await call('telegram', { body: F.tgUpdate({ messageId: 9911 }), headers: F.TG_HEADERS, tr })
  eq('U1 sukses -> 200', okRes.statusCode, 200)
  eq('U2 status tercatat', okRes.body.status, 'tercatat')
  ok('U3 ada receivingId', !!okRes.body.receivingId)
  eq('U4 notifikasi terkirim', okRes.body.notification.sent, true)
  eq('U5 tujuan DAT', tr.sent[0].target.chatId, '1320969465')

  const rawBody = JSON.stringify(okRes.body)
  ok('U6 respons tanpa secret Telegram', !rawBody.includes(F.ENV.BAKPAU_TELEGRAM_WEBHOOK_SECRET))
  ok('U7 respons tanpa service key', !rawBody.includes('service_role'))
  ok('U8 respons tanpa teks bukti mentah', !rawBody.includes('Triplek 12mm | 6'))
  ok('U9 respons tanpa token bot', !/bot\d+:/.test(rawBody))

  // Platform dikunci route: payload WhatsApp dikirim ke route telegram -> ditolak
  // sebagai payload Telegram yang tidak sah (bukan diproses sebagai WA).
  mock.__reset({ tables: tables() })
  const cross = await call('telegram', { body: F.waPayload(), headers: F.TG_HEADERS })
  ok('U10 payload WA di route telegram tidak diproses sebagai WA', cross.body.status !== 'tercatat', JSON.stringify(cross.body))
  eq('U11 nol tulisan', mock.__rows('receivings').length, 0)
}

// ============================================================
group('V. WHATSAPP: HMAC ATAS BODY MENTAH')
// ============================================================
{
  const payload = F.waPayload({ text: F.MSG_ONE_NOTE.replace('SINT-8891', 'SINT-HTTP-WA') })
  // Body mentah dengan spasi/format yang TIDAK sama dengan JSON.stringify(payload)
  const raw = `{ "id": ${JSON.stringify(payload.id)}, "from": ${JSON.stringify(payload.from)}, "chatId": ${JSON.stringify(payload.chatId)}, "chatType": "dm", "timestamp": ${payload.timestamp}, "body": ${JSON.stringify(payload.body)} }`
  const hmac = crypto.createHmac('sha256', F.ENV.BAKPAU_WA_WEBHOOK_SECRET).update(raw, 'utf8').digest('hex')

  mock.__reset({ tables: tables() })
  const tr = transport()
  const good = await call('whatsapp', {
    raw,
    headers: { 'x-bakpau-signature': `sha256=${hmac}` },
    tr
  })
  eq('V1 HMAC atas body mentah diterima', good.statusCode, 200)
  eq('V2 status tercatat', good.body.status, 'tercatat')
  eq('V3 notifikasi ke Telegram DAT (bukan WA)', tr.sent[0].target.platform, 'telegram')

  // HMAC dari re-stringify (bentuk berbeda) HARUS gagal -> membuktikan raw dipakai.
  mock.__reset({ tables: tables() })
  const wrongHmac = crypto.createHmac('sha256', F.ENV.BAKPAU_WA_WEBHOOK_SECRET).update(JSON.stringify(payload), 'utf8').digest('hex')
  const bad = await call('whatsapp', { raw, headers: { 'x-bakpau-signature': `sha256=${wrongHmac}` } })
  eq('V4 HMAC atas bentuk lain ditolak', bad.statusCode, 401)

  mock.__reset({ tables: tables() })
  const token = await call('whatsapp', { raw, headers: { 'x-bakpau-token': F.ENV.BAKPAU_WA_WEBHOOK_SECRET } })
  eq('V5 token bersama diterima', token.statusCode, 200)

  mock.__reset({ tables: tables() })
  const noAuth = await call('whatsapp', { raw, headers: {} })
  eq('V6 tanpa auth -> 401', noAuth.statusCode, 401)

  mock.__reset({ tables: tables() })
  const otherJid = await call('whatsapp', {
    raw,
    headers: { 'x-bakpau-token': F.ENV.BAKPAU_WA_WEBHOOK_SECRET },
    env: { ...F.ENV, BAKPAU_WA_ALLOWED_JIDS: '628111111111@s.whatsapp.net' }
  })
  eq('V7 JID di luar allowlist -> 401', otherJid.statusCode, 401)
}

// ============================================================
group('W. STATUS HTTP UNTUK KLARIFIKASI & DUPLIKAT')
// ============================================================
{
  mock.__reset({ tables: tables() })
  const clar = await call('telegram', { body: F.tgUpdate({ messageId: 9921, text: F.MSG_UNKNOWN_UNIT }), headers: F.TG_HEADERS })
  eq('W1 klarifikasi -> 202', clar.statusCode, 202)
  eq('W2 status need_clarification', clar.body.status, 'need_clarification')
  eq('W3 nol tulisan', mock.__rows('receivings').length, 0)

  // Duplikat: proses dua kali dengan ledger yang SAMA (retry event).
  mock.__reset({ tables: tables() })
  const led = L.createMemoryLedger()
  const first = await call('telegram', { body: F.tgUpdate({ messageId: 9931 }), headers: F.TG_HEADERS, led })
  eq('W4 pertama tercatat', first.body.status, 'tercatat')
  const second = await call('telegram', { body: F.tgUpdate({ messageId: 9931 }), headers: F.TG_HEADERS, led })
  eq('W5 retry event -> 200', second.statusCode, 200)
  eq('W6 status ignored_duplicate_event', second.body.status, 'ignored_duplicate_event')
  eq('W7 tidak ada nota kedua', mock.__rows('receivings').length, 1)

  // Bukti sama, id pesan beda -> duplicate (bukan tercatat kedua).
  mock.__reset({ tables: tables() })
  const led2 = L.createMemoryLedger()
  await call('telegram', { body: F.tgUpdate({ messageId: 9941 }), headers: F.TG_HEADERS, led: led2 })
  const dup = await call('telegram', { body: F.tgUpdate({ messageId: 9942 }), headers: F.TG_HEADERS, led: led2 })
  eq('W8 bukti sama -> 200 duplicate', dup.statusCode, 200)
  eq('W9 status duplicate', dup.body.status, 'duplicate')
  eq('W10 tetap satu nota', mock.__rows('receivings').length, 1)
}

// ============================================================
group('X. LEDGER TIDAK ADA -> TIDAK MENULIS (fail closed)')
// ============================================================
{
  mock.__reset({ tables: tables(), missingTables: ['bakpau_events'] })
  const dbLedger = L.createDbLedger({ client: mock.supabase })
  const res = await call('telegram', { body: F.tgUpdate({ messageId: 9951 }), headers: F.TG_HEADERS, led: dbLedger })
  eq('X1 status HTTP 502', res.statusCode, 502)
  eq('X2 alasan ledger_unavailable', res.body.reason, 'ledger_unavailable')
  eq('X3 nol nota ditulis', mock.__rows('receivings').length, 0)
  eq('X4 nol baris barang ditulis', mock.__rows('receiving_items').length, F.RECEIVING_ITEMS.length)
}

// ============================================================
console.log(`\n${'='.repeat(60)}`)
console.log(`HASIL http_test: ${pass} lulus, ${fail} gagal`)
if (fail) {
  console.log('\nRincian gagal:')
  for (const f of failures) console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`)
}
console.log('='.repeat(60))
process.exit(fail ? 1 : 0)
