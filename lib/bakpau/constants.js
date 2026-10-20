// ============================================================
// lib/bakpau/constants.js — KONSTANTA & ALLOWLIST KONEKTOR BAKPAU
// ============================================================
// FASE INI (izin DAT, kartu t_310dfb07):
//   * INPUT  : Telegram ATAU WhatsApp (dua kanal, satu jalur validasi).
//   * OUTPUT : notifikasi HANYA Telegram DM DAT — platform 'telegram',
//              chat_id 1320969465, user_id 1320969465, chat_type 'dm'.
//   * DILARANG: kirim ke WhatsApp, Novi, vendor, grup, atau pihak lain;
//              memakai asal input sebagai tujuan notifikasi; fallback
//              otomatis; menebak recipient.
//
// KENAPA TARGET NOTIFIKASI KONSTANTA (bukan env):
//   Tujuan notifikasi adalah KEPUTUSAN KEAMANAN, bukan konfigurasi.
//   Kalau bisa diubah lewat env, satu salah-set env (atau env yang diwarisi
//   dari profil lain) cukup untuk mengirim data belanja ke pihak lain.
//   Karena itu daftar tujuan dibekukan di kode dan diverifikasi ulang di
//   beberapa lapis (formatter → router → transport → RPC DB). Env TIDAK
//   boleh memperlebar daftar ini.
//
//   env hanya boleh MEMPERSEMPIT / mengaktifkan, yaitu:
//     BAKPAU_NOTIFY_ENABLED=0   -> matikan seluruh notifikasi keluar
// ============================================================

// --- Identitas notifikasi DAT (beku; jangan diubah tanpa izin tertulis) ---
export const DAT_NOTIFY_TARGET = Object.freeze({
  platform: 'telegram',
  chatId: '1320969465',
  userId: '1320969465',
  chatType: 'dm',
  label: 'DAT'
})

// Daftar tujuan notifikasi yang diizinkan. HANYA berisi DAT_NOTIFY_TARGET.
export const NOTIFY_ALLOWLIST = Object.freeze([DAT_NOTIFY_TARGET])

// Kanal keluar yang DIMATIKAN pada fase ini (outbound WA disabled).
export const OUTBOUND_DISABLED_PLATFORMS = Object.freeze(['whatsapp'])

// --- Status yang dilaporkan konektor ke DAT ---
// 'tercatat' HANYA boleh dipakai setelah commit sukses + readback exact.
export const STATUS = Object.freeze({
  DRAFT: 'draft',
  NEED_CLARIFICATION: 'need_clarification',
  TERCATAT: 'tercatat',
  DUPLICATE: 'duplicate',
  GAGAL: 'gagal'
})
export const STATUS_VALUES = Object.freeze(Object.values(STATUS))

// --- Alasan hasil (reason code) — dipakai test & notifikasi ---
export const REASON = Object.freeze({
  // auth / transport masuk
  NOT_CONFIGURED: 'not_configured',
  BAD_SIGNATURE: 'bad_signature',
  STALE_EVENT: 'stale_event',
  IDENTITY_NOT_ALLOWED: 'identity_not_allowed',
  CHAT_TYPE_NOT_ALLOWED: 'chat_type_not_allowed',
  BOT_SENDER: 'bot_sender',
  EMPTY_EVENT: 'empty_event',
  UNSUPPORTED_PLATFORM: 'unsupported_platform',
  // bukti
  NO_ITEM_LINES: 'no_item_lines',
  MONETARY_ONLY: 'monetary_only',
  VENDOR_MISSING: 'vendor_missing',
  VENDOR_UNKNOWN: 'vendor_unknown',
  DATE_MISSING: 'date_missing',
  DATE_INVALID: 'date_invalid',
  PROJECT_MISSING: 'project_missing',
  PROJECT_UNKNOWN: 'project_unknown',
  PROJECT_AMBIGUOUS: 'project_ambiguous',
  UNIT_UNKNOWN: 'unit_unknown',
  ITEM_INVALID: 'item_invalid',
  TOTAL_MISMATCH: 'total_mismatch',
  UNPARSED_LINES: 'unparsed_lines',
  QTY_EXCEEDS_REMAINING: 'qty_exceeds_remaining',
  SPEC_DIFFERS: 'spec_differs',
  // idempotensi / simpan
  DUPLICATE_EVENT: 'duplicate_event',
  DUPLICATE_EVIDENCE: 'duplicate_evidence',
  LEDGER_UNAVAILABLE: 'ledger_unavailable',
  NO_SERVICE_CREDENTIALS: 'no_service_credentials',
  SAVE_FAILED: 'save_failed',
  READBACK_FAILED: 'readback_failed',
  READBACK_MISMATCH: 'readback_mismatch',
  PARTIAL_WRITE: 'partial_write',
  // notifikasi
  RECIPIENT_NOT_ALLOWLISTED: 'recipient_not_allowlisted',
  OUTBOUND_PLATFORM_DISABLED: 'outbound_platform_disabled',
  NOTIFY_DISABLED: 'notify_disabled',
  NOTIFY_TRANSPORT_UNAVAILABLE: 'notify_transport_unavailable',
  NOTIFY_SEND_FAILED: 'notify_send_failed',
  NOTIFY_TARGET_MISMATCH: 'notify_target_mismatch'
})

// --- Penanda di kolom teks existing (pola yang sama dengan purchaseNote.js) ---
// Tidak ada kolom/tabel baru: seluruh jejak konektor ditulis sebagai penanda
// skalar di `receivings.note` + `receiving_items.note`, dibaca oleh SATU
// parser di lib/bakpau/markers.js.
export const MARK = Object.freeze({
  EVENT: 'BakpauEvent',      // [BakpauEvent: telegram:1320969465:12345]
  EVIDENCE: 'BuktiHash',     // [BuktiHash: sha256:ab12…]
  CHANNEL: 'Kanal',          // [Kanal: telegram|whatsapp]
  SENDER: 'Pengirim',        // [Pengirim: 1320969465]
  MSG: 'Pesan',              // [Pesan: <messageId>]
  SPEC: 'Spek',              // [Spek: 3mm]            (spek AKTUAL dari bukti)
  SPEC_AWAL: 'SpekAwal',     // [SpekAwal: 2mm]        (spek awal dari PR)
  PROYEK: 'Proyek'           // [Proyek: <projectId>]  (alokasi per baris)
})

// --- Batas operasional ---
export const LIMITS = Object.freeze({
  MAX_EVENT_AGE_SEC: 900,        // tolak event lebih tua dari 15 menit (replay)
  MAX_FUTURE_SKEW_SEC: 120,      // toleransi jam server sedikit di depan
  MAX_TEXT_LEN: 8000,            // pesan masuk lebih panjang -> dipotong & ditandai
  MAX_ITEMS: 80,                 // satu nota maksimum 80 baris
  MAX_NOTIFY_ATTEMPTS: 3,        // retry terbatas (1 percobaan + 2 retry)
  NOTIFY_BACKOFF_MS: 150        // backoff linear antar percobaan
})

// --- Kunci env yang dipakai konektor (nama saja; NILAI tidak pernah dicetak) ---
export const ENV_KEYS = Object.freeze({
  TG_SECRET: 'BAKPAU_TELEGRAM_WEBHOOK_SECRET',
  WA_SECRET: 'BAKPAU_WA_WEBHOOK_SECRET',
  WA_ALLOWLIST: 'BAKPAU_WA_ALLOWED_JIDS',
  TG_ALLOWLIST: 'BAKPAU_TELEGRAM_ALLOWED_USER_IDS',
  NOTIFY_ENABLED: 'BAKPAU_NOTIFY_ENABLED',
  LEDGER_MODE: 'BAKPAU_LEDGER_MODE',
  SUPABASE_URL: 'SUPABASE_URL',
  SERVICE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  PUBLIC_URL: 'NEXT_PUBLIC_SUPABASE_URL'
})

export const APP_LINK_BASE = 'https://purchasing.noirliving.app'
