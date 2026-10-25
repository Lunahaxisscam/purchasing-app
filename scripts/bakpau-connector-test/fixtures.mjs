// ============================================================
// FIXTURES SINTETIS BERLABEL — konektor Bakpau (t_310dfb07)
// ============================================================
// SEMUA data di file ini FIKTIF dan dibuat untuk pengujian. Tidak ada satu pun
// yang berasal dari pesan pelanggan nyata, nota nyata, atau respons API nyata.
// Nama proyek/toko/nominal sengaja diberi label SINTETIS.
//
// Setiap fixture membawa `_synthetic: true` dan `_label` supaya tidak mungkin
// dikira data produksi bila file ini terbaca ulang.
// ============================================================

export const SYNTH = { _synthetic: true }

export const PROJECTS = [
  { ...SYNTH, id: 'p-101', kode: '101', code: '101', name: 'SINTETIS Aan - BSD', status: 'active' },
  { ...SYNTH, id: 'p-83', kode: '83', code: '83', name: 'SINTETIS Josh - Mabes', status: 'active' },
  { ...SYNTH, id: 'p-99', kode: '99', code: '99', name: 'SINTETIS Baroni', status: 'active' },
  { ...SYNTH, id: 'p-ws', kode: 'WS', code: 'WS', name: 'SINTETIS Workshop', status: 'active' }
]

export const VENDORS = [
  { ...SYNTH, id: 'v-1', name: 'SINTETIS Toko Bangunan A-12' },
  { ...SYNTH, id: 'v-2', name: 'SINTETIS Toko Bangunan A12' },   // sengaja mirip v-1
  { ...SYNTH, id: 'v-3', name: 'SINTETIS Toko Cat' }
]

export const REQUESTS = [
  { ...SYNTH, id: 'pr-1', pr_number: 'PR-2026-0001', project_id: 'p-101', status: 'SUBMITTED', title: 'Kebutuhan SINTETIS 1', notes: '[Jalur: LEAN]' },
  { ...SYNTH, id: 'pr-2', pr_number: 'PR-2026-0002', project_id: 'p-83', status: 'SUBMITTED', title: 'Kebutuhan SINTETIS 2', notes: '[Jalur: LEAN]' }
]

export const PR_ITEMS = [
  { ...SYNTH, id: 'pri-1', pr_id: 'pr-1', item_name: 'Triplek 12mm', quantity: 10, unit: 'lembar', status: 'PENDING_APPROVAL', estimated_price: 120000 },
  { ...SYNTH, id: 'pri-2', pr_id: 'pr-1', item_name: 'Semen 50kg', quantity: 5, unit: 'sak', status: 'PENDING_APPROVAL', estimated_price: 65000 },
  { ...SYNTH, id: 'pri-3', pr_id: 'pr-2', item_name: 'Cat Tembok 5kg', quantity: 2, unit: 'kaleng', status: 'PENDING_APPROVAL', estimated_price: 150000 },
  { ...SYNTH, id: 'pri-4', pr_id: 'pr-2', item_name: 'Triplek 12mm', quantity: 4, unit: 'lembar', status: 'PENDING_APPROVAL', estimated_price: 118000 }
]

export const RECEIVING_ITEMS = [
  // pri-1 sudah dibeli 4 dari 10 -> sisa 6
  { ...SYNTH, id: 'ri-old-1', receiving_id: 'rcv-old', pr_item_id: 'pri-1', item_name: 'Triplek 12mm', unit: 'lembar', quantity_received: 4, note: '[Harga: 120000]' }
]

export const MASTERS = {
  projects: PROJECTS,
  vendors: VENDORS,
  requests: REQUESTS,
  prItems: PR_ITEMS,
  receivingItems: RECEIVING_ITEMS
}

// --- Env uji (nilai palsu, bukan secret nyata) ---
export const ENV = {
  BAKPAU_TELEGRAM_WEBHOOK_SECRET: 'synthetic-tg-secret-not-real',
  BAKPAU_WA_WEBHOOK_SECRET: 'synthetic-wa-secret-not-real',
  BAKPAU_TELEGRAM_ALLOWED_USER_IDS: '1320969465',
  BAKPAU_WA_ALLOWED_JIDS: '628000000001@s.whatsapp.net',
  BAKPAU_NOTIFY_ENABLED: '1'
}

// Waktu "sekarang" untuk uji freshness. Diambil dari jam NYATA saat harness
// dijalankan (bukan tanggal hard-code) supaya uji replay/freshness menguji
// perilaku produksi, bukan tanggal yang kebetulan lewat.
export const NOW = Date.now()
export const NOW_SEC = Math.floor(NOW / 1000)

// --- Pesan bukti sintetis ---
export const MSG_ONE_NOTE = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-8891',
  'tanggal: 20/10/2026',
  'proyek: 101',
  'total: 1.075.000',
  '- Triplek 12mm | 6 | lembar | 125.000 | spek=12mm',
  '- Semen 50kg | 5 | sak | 65.000'
].join('\n')

export const MSG_MIXED = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-MIX-001',
  'tanggal: 2026-10-20',
  'total: 960.000',
  '- Triplek 12mm | 4 | lembar | 125.000 | proyek=101 | pr=PR-2026-0001',
  '- Cat Tembok 5kg | 2 | kaleng | 150.000 | proyek=83 | pr=PR-2026-0002',
  '- Sekrup 5cm | 2 | dus | 80.000 | proyek=101'
].join('\n')

export const MSG_UNKNOWN_UNIT = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-UNK-1',
  'tanggal: 2026-10-20',
  'proyek: 101',
  '- Triplek 12mm | 3 | gepok | 125.000'
].join('\n')

export const MSG_UNKNOWN_PROJECT = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-UNK-2',
  'tanggal: 2026-10-20',
  'proyek: 777',
  '- Semen 50kg | 2 | sak | 65.000'
].join('\n')

export const MSG_MONETARY_ONLY = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-MONEY-1',
  'tanggal: 2026-10-20',
  'proyek: 101',
  'total: 2.500.000'
].join('\n')

export const MSG_TOTAL_MISMATCH = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-MISMATCH-1',
  'tanggal: 2026-10-20',
  'proyek: 101',
  'total: 900.000',
  '- Semen 50kg | 5 | sak | 65.000'
].join('\n')

export const MSG_UNPARSED_LINE = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-UNP-1',
  'tanggal: 2026-10-20',
  'proyek: 101',
  '- Semen 50kg | 5 | sak | 65.000',
  '- Pasir beton 1 colt (harga menyusul)'
].join('\n')

export const MSG_QTY_OVER = [
  'toko: SINTETIS Toko Bangunan A-12',
  'nota: SINT-OVER-1',
  'tanggal: 2026-10-20',
  'proyek: 101',
  '- Triplek 12mm | 20 | lembar | 125.000 | pr=PR-2026-0001'
].join('\n')

// --- Payload Telegram sintetis ---
export function tgUpdate({ text = MSG_ONE_NOTE, messageId = 4412, userId = '1320969465', chatId = '1320969465', chatType = 'private', date = NOW_SEC - 5, isBot = false } = {}) {
  return {
    update_id: 900000 + messageId,
    message: {
      message_id: messageId,
      date,
      chat: { id: Number(chatId), type: chatType },
      from: { id: Number(userId), is_bot: isBot, first_name: 'SINTETIS DAT' },
      text
    }
  }
}

export const TG_HEADERS = { 'X-Telegram-Bot-Api-Secret-Token': ENV.BAKPAU_TELEGRAM_WEBHOOK_SECRET }

// --- Payload WhatsApp sintetis ---
export function waPayload({ text = MSG_ONE_NOTE, id = 'WA-MSG-0001', from = '628000000001@s.whatsapp.net', chatId = null, timestamp = NOW_SEC - 5, chatType = 'dm' } = {}) {
  return {
    id,
    from,
    chatId: chatId || from,
    chatType,
    timestamp,
    body: text,
    hasMedia: false
  }
}
