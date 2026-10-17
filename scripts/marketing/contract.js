// ============================================================
// scripts/marketing/contract.js — KONTRAK INTEGRASI MARKETING → CRM/PROJECT (S6)
// ============================================================
// LAPISAN KONTRAK SAJA. File ini MURNI: tanpa import node/browser, tanpa
// jaringan, tanpa tulis file, tanpa DB. Masukannya record lead/campaign/
// handoff, keluarannya putusan validasi + rencana (PLAN, bukan eksekusi).
//
// Yang dijawab file ini (permintaan DAT di kartu S6):
//   1) LEAD SOURCE      — taksonomi sumber lead yang tetap (enum), bukan teks bebas.
//   2) QUALIFICATION    — status kualifikasi + BUKTI yang wajib ada untuk masuk
//                         tiap status (pola sama dengan S4/S5: status tanpa bukti
//                         ditolak, bukan dianggap benar).
//   3) CUSTOMER HANDOFF — cara lead diserahkan ke CRM (`customers`): kunci
//                         dedupe, idempotensi, dan apa yang BOLEH/TIDAK boleh
//                         ditulis. Handoff menghasilkan RENCANA, tidak menulis.
//   4) CAMPAIGN         — atribusi (first touch & last touch, UTM, referral),
//                         dibekukan saat WON supaya angka historis tidak berubah.
//
// BATAS KERAS (ditegakkan harness, bukan niat):
//   * TIDAK ADA pengiriman pesan keluar (WA/email/IG DM) — kanal hanya LABEL
//     untuk percakapan yang SUDAH terjadi, bukan kemampuan mengirim.
//   * TIDAK ADA iklan berbayar / ad platform / spend / pixel / audience upload.
//   * TIDAK ADA cron / sinkronisasi latar.
//   * TIDAK menyentuh purchasing: purchase_requests, pr_items, approval_steps,
//     receivings, receiving_items, handovers, projects, sales_invoices adalah
//     tabel MILIK modul lain — marketing hanya MEMBACA `projects` (untuk
//     atribusi) dan TIDAK PERNAH menulis ke sana.
//
// Lihat docs/marketing-crm-integration-contract.md untuk alasan tiap aturan.
// ============================================================

export const CONTRACT_VERSION = 1
export const CONTRACT_ID = 'marketing-crm-project'

// ------------------------------------------------------------
// 1. TAKSONOMI SUMBER LEAD (LEAD SOURCE)
// ------------------------------------------------------------
// Enum tetap supaya laporan atribusi tidak pecah jadi ratusan ejaan
// ("ig", "Instagram", "INSTAGRAM ads"). Detail bebas tetap boleh, tetapi
// disimpan di `source_detail` dan TIDAK dipakai untuk agregasi.
export const LEAD_SOURCES = Object.freeze([
  'WALK_IN',      // datang langsung ke studio/workshop
  'REFERRAL',     // rekomendasi klien/relasi
  'INSTAGRAM',    // DM/komentar/profil
  'TIKTOK',
  'WHATSAPP',     // nomor bisnis, tanpa kampanye
  'WEBSITE',      // form/WA link di situs
  'MARKETPLACE',  // marketplace/aggregator (mis. Tokopedia, rumah123)
  'EVENT',        // pameran/showroom event
  'PARTNER',      // arsitek/kontraktor/desainer lain
  'OUTBOUND',     // pencarian aktif oleh tim (bukan iklan berbayar)
  'OTHER'
])

// Kanal = LABEL percakapan yang sudah terjadi. Ini BUKAN kemampuan mengirim:
// lapisan ini tidak punya kode kirim apa pun (dibuktikan harness C).
export const TOUCHPOINT_CHANNELS = Object.freeze([
  'WHATSAPP', 'PHONE', 'EMAIL', 'INSTAGRAM_DM', 'WALK_IN', 'MARKETPLACE_CHAT', 'REFERRAL_INTRO', 'OTHER'
])

// ------------------------------------------------------------
// 2. STATUS KUALIFIKASI (LEAD LIFECYCLE)
// ------------------------------------------------------------
// NEW → CONTACTED → QUALIFIED → (SURVEYED) → QUOTED → WON
// Setiap tahap punya BUKTI minimum. Tanpa bukti, transisi ditolak.
// WON dan LOST bersifat FINAL: koreksi dilakukan dengan lead baru yang
// menunjuk `supersedes_lead_id`, bukan dengan mengubah sejarah.
export const LEAD_STATUSES = Object.freeze([
  'NEW', 'CONTACTED', 'QUALIFIED', 'SURVEYED', 'QUOTED', 'WON', 'LOST', 'DORMANT'
])

export const LEAD_STATUS_TRANSITIONS = Object.freeze({
  NEW: Object.freeze(['CONTACTED', 'LOST', 'DORMANT']),
  CONTACTED: Object.freeze(['QUALIFIED', 'LOST', 'DORMANT']),
  QUALIFIED: Object.freeze(['SURVEYED', 'QUOTED', 'LOST', 'DORMANT']),
  SURVEYED: Object.freeze(['QUOTED', 'LOST', 'DORMANT']),
  QUOTED: Object.freeze(['WON', 'SURVEYED', 'LOST', 'DORMANT']),
  WON: Object.freeze([]),
  LOST: Object.freeze([]),
  DORMANT: Object.freeze(['CONTACTED', 'LOST'])
})

export const TERMINAL_LEAD_STATUSES = Object.freeze(['WON', 'LOST'])

// Bukti yang WAJIB ada untuk MASUK ke sebuah status (diperiksa dari record
// lead + jumlah touchpoint). `null` = tidak ada syarat tambahan.
export const QUALIFICATION_GATES = Object.freeze({
  NEW: Object.freeze({ required: Object.freeze([]), note: 'Cukup identitas kontak + sumber. Belum dikualifikasi.' }),
  CONTACTED: Object.freeze({
    required: Object.freeze(['min_touchpoints']),
    min_touchpoints: 1,
    note: 'Minimal satu touchpoint tercatat (kanal + waktu). Percakapan tanpa jejak bukan "sudah dihubungi".'
  }),
  QUALIFIED: Object.freeze({
    required: Object.freeze(['need_summary', 'qualification_basis']),
    note: 'Kebutuhan tertulis + dasar kualifikasi (survey/kunjungan/referensi).'
  }),
  SURVEYED: Object.freeze({
    required: Object.freeze(['survey_date', 'survey_ref']),
    note: 'Tanggal survey + rujukan hasil ukur. Tanggal saja tanpa rujukan tidak dihitung.'
  }),
  QUOTED: Object.freeze({
    required: Object.freeze(['quote_ref', 'quote_value', 'quote_date']),
    note: 'Rujukan RAB/BOQ yang disetujui + nilai penawaran > 0 + tanggal penawaran.'
  }),
  WON: Object.freeze({
    required: Object.freeze(['quote_ref', 'customer_id', 'project_id', 'won_at', 'confirmed_by']),
    note: 'Butuh customer CRM, project nyata, dan konfirmasi admin. TIDAK PERNAH otomatis dari nilai penawaran.'
  }),
  LOST: Object.freeze({
    required: Object.freeze(['lost_reason_code', 'lost_at']),
    note: 'Alasan hilang wajib berkode supaya bisa dianalisis.'
  }),
  DORMANT: Object.freeze({
    required: Object.freeze(['last_contact_at']),
    note: 'Terakhir dihubungi kapan — tanpa ini lead "menguap" tanpa jejak.'
  })
})

export const QUALIFICATION_BASIS = Object.freeze([
  'SITE_VISIT', 'PHONE_CALL', 'WHATSAPP_CHAT', 'REFERRAL_TRUST', 'MARKETPLACE_INQUIRY', 'OTHER'
])

export const LOST_REASON_CODES = Object.freeze([
  'PRICE', 'TIMING', 'COMPETITOR', 'OUT_OF_SCOPE', 'NO_RESPONSE', 'DUPLICATE', 'BUDGET_CANCELLED', 'OTHER'
])

// ------------------------------------------------------------
// 3. ATRIBUSI KAMPANYE
// ------------------------------------------------------------
// Dua model disimpan berdampingan: first touch (yang memperkenalkan) dan
// last touch (yang meyakinkan). Keduanya DIBEKUKAN saat WON sehingga laporan
// historis tidak berubah ketika kampanye diedit belakangan.
export const ATTRIBUTION_MODELS = Object.freeze(['FIRST_TOUCH', 'LAST_TOUCH'])
export const UTM_KEYS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'])
export const ATTRIBUTION_FROZEN_AT = 'WON'

// ------------------------------------------------------------
// 4. SKEMA ENTITAS (dipakai validator + dokumen + endpoint)
// ------------------------------------------------------------
// `type`: string | uuid | enum | number | date | datetime | object | array
// `required_at`: status minimal tempat field itu wajib (null = selalu opsional)
export const ENTITY_SCHEMAS = Object.freeze({
  campaign: Object.freeze([
    { name: 'campaign_id', type: 'uuid', required_at: 'NEW', note: 'Idempotensi: satu kampanye satu id.' },
    { name: 'name', type: 'string', required_at: 'NEW' },
    { name: 'channel', type: 'enum', values: LEAD_SOURCES, required_at: 'NEW', note: 'Kanal perolehan, bukan kanal pengiriman.' },
    { name: 'started_at', type: 'date', required_at: 'NEW' },
    { name: 'ended_at', type: 'date', required_at: null },
    { name: 'budget_note', type: 'string', required_at: null, note: 'Catatan anggaran MANUAL. Tidak ada integrasi iklan berbayar.' },
    { name: 'is_paid_media', type: 'boolean', required_at: 'NEW', note: 'Selalu false di lapisan ini: tidak ada pembelian media.' }
  ]),
  lead: Object.freeze([
    { name: 'lead_id', type: 'uuid', required_at: 'NEW', note: 'Tidak didaur ulang; lead koreksi = lead baru + supersedes_lead_id.' },
    { name: 'source', type: 'enum', values: LEAD_SOURCES, required_at: 'NEW' },
    { name: 'source_detail', type: 'string', required_at: null, note: 'Teks bebas; TIDAK dipakai agregasi.' },
    { name: 'status', type: 'enum', values: LEAD_STATUSES, required_at: 'NEW' },
    { name: 'contact_name', type: 'string', required_at: 'NEW' },
    { name: 'contact_phone', type: 'string', required_at: null, note: 'Dinormalisasi; phone ATAU email wajib ada.' },
    { name: 'contact_email', type: 'string', required_at: null },
    { name: 'city', type: 'string', required_at: null },
    { name: 'need_summary', type: 'string', required_at: 'QUALIFIED' },
    { name: 'qualification_basis', type: 'enum', values: QUALIFICATION_BASIS, required_at: 'QUALIFIED' },
    { name: 'budget_min', type: 'number', required_at: null },
    { name: 'budget_max', type: 'number', required_at: null },
    { name: 'survey_date', type: 'date', required_at: 'SURVEYED' },
    { name: 'survey_ref', type: 'string', required_at: 'SURVEYED' },
    { name: 'quote_ref', type: 'string', required_at: 'QUOTED', note: 'Rujukan RAB/BOQ final (bukan angka karangan).' },
    { name: 'quote_value', type: 'number', required_at: 'QUOTED', note: 'Harus > 0.' },
    { name: 'quote_date', type: 'date', required_at: 'QUOTED' },
    { name: 'campaign_id', type: 'uuid', required_at: null },
    { name: 'attribution', type: 'object', required_at: null },
    { name: 'customer_id', type: 'uuid', required_at: 'WON', note: 'FK ke CRM `customers` (belum ada tabelnya).' },
    { name: 'project_id', type: 'uuid', required_at: 'WON', note: 'FK ke `projects` — SATU-SATUNYA jembatan ke purchasing.' },
    { name: 'won_at', type: 'datetime', required_at: 'WON' },
    { name: 'confirmed_by', type: 'uuid', required_at: 'WON', note: 'Admin yang mengonfirmasi; bukan nilai dari klien.' },
    { name: 'lost_reason_code', type: 'enum', values: LOST_REASON_CODES, required_at: 'LOST' },
    { name: 'lost_at', type: 'datetime', required_at: 'LOST' },
    { name: 'last_contact_at', type: 'datetime', required_at: 'DORMANT' },
    { name: 'supersedes_lead_id', type: 'uuid', required_at: null },
    { name: 'created_at', type: 'datetime', required_at: 'NEW' }
  ]),
  touchpoint: Object.freeze([
    { name: 'touchpoint_id', type: 'uuid', required_at: 'NEW' },
    { name: 'lead_id', type: 'uuid', required_at: 'NEW' },
    { name: 'channel', type: 'enum', values: TOUCHPOINT_CHANNELS, required_at: 'NEW' },
    { name: 'occurred_at', type: 'datetime', required_at: 'NEW', note: 'Kapan percakapan TERJADI (bukan kapan dicatat).' },
    { name: 'direction', type: 'enum', values: ['INBOUND', 'OUTBOUND'], required_at: 'NEW' },
    { name: 'summary', type: 'string', required_at: 'NEW' },
    { name: 'recorded_by', type: 'uuid', required_at: 'NEW' }
  ]),
  handoff: Object.freeze([
    { name: 'handoff_id', type: 'uuid', required_at: 'NEW' },
    { name: 'lead_id', type: 'uuid', required_at: 'NEW' },
    { name: 'customer_id', type: 'uuid', required_at: 'NEW', note: 'Hasil link/buat di CRM.' },
    { name: 'customer_key', type: 'string', required_at: 'NEW', note: 'Kunci dedupe hasil normalisasi (phone/email).' },
    { name: 'action', type: 'enum', values: ['LINK_EXISTING', 'CREATE_CUSTOMER'], required_at: 'NEW' },
    { name: 'idempotency_key', type: 'string', required_at: 'NEW', note: 'Unik; handoff diulang tidak membuat customer kedua.' },
    { name: 'requested_by', type: 'uuid', required_at: 'NEW' },
    { name: 'requested_at', type: 'datetime', required_at: 'NEW' },
    { name: 'attribution_snapshot', type: 'object', required_at: 'NEW', note: 'Dibekukan; tidak boleh dihitung ulang.' }
  ])
})

// ------------------------------------------------------------
// 5. TABEL: SIAPA PEMILIK, SIAPA BOLEH BACA/TULIS
// ------------------------------------------------------------
// `owner`     : modul yang berhak MENULIS.
// `marketing` : izin lapisan ini ('none' | 'read' | 'write-future').
// Semua yang `marketing: 'none'` adalah tabel purchasing/keuangan: HARAM
// disentuh marketing (invarian P1/P2 di bawah).
export const TABLE_OWNERSHIP = Object.freeze([
  { table: 'leads', owner: 'marketing', marketing: 'write-future', exists: false, note: 'Belum ada tabelnya (PGRST205).' },
  { table: 'lead_touchpoints', owner: 'marketing', marketing: 'write-future', exists: false, note: 'Belum ada tabelnya.' },
  { table: 'campaigns', owner: 'marketing', marketing: 'write-future', exists: false, note: 'Belum ada tabelnya.' },
  { table: 'lead_handoffs', owner: 'marketing', marketing: 'write-future', exists: false, note: 'Jejak handoff + idempotensi.' },
  { table: 'customers', owner: 'crm', marketing: 'read', exists: false, note: 'CRM belum ada (PGRST205); lead hanya MEMINTA pembuatan customer.' },
  { table: 'projects', owner: 'projects', marketing: 'read', exists: true, note: 'Marketing hanya membaca untuk atribusi. Pembuatan project tetap milik modul projects.' },
  { table: 'sales_invoices', owner: 'sales-invoice', marketing: 'none', exists: false, note: 'Milik S4. Marketing TIDAK membaca/menulis (attribusi pendapatan menyusul lewat laporan read-only milik S5).' },
  { table: 'purchase_requests', owner: 'requests', marketing: 'none', exists: true, note: 'PURCHASING — tidak boleh disentuh.' },
  { table: 'pr_items', owner: 'requests', marketing: 'none', exists: true, note: 'PURCHASING — tidak boleh disentuh.' },
  { table: 'approval_steps', owner: 'approvals', marketing: 'none', exists: true, note: 'PURCHASING — tidak boleh disentuh.' },
  { table: 'receivings', owner: 'receivings', marketing: 'none', exists: true, note: 'PURCHASING — tidak boleh disentuh.' },
  { table: 'receiving_items', owner: 'receivings', marketing: 'none', exists: true, note: 'PURCHASING — tidak boleh disentuh.' },
  { table: 'handovers', owner: 'handovers', marketing: 'none', exists: true, note: 'PURCHASING/distribusi — tidak boleh disentuh.' }
])

// Invarian "tidak mengganggu purchasing". Harness memeriksa kode untuk
// membuktikan masing-masing, bukan sekadar mencetak kalimat ini.
export const PURCHASING_INVARIANTS = Object.freeze([
  Object.freeze({ id: 'P1', rule: 'Marketing tidak menulis ke tabel purchasing/keuangan apa pun.', enforced_by: 'harness C: tidak ada insert/update/delete/upsert/rpc di seluruh lapisan marketing' }),
  Object.freeze({ id: 'P2', rule: 'Tidak ada kolom/FK baru pada purchase_requests, pr_items, approval_steps, receivings, receiving_items, handovers, projects, sales_invoices.', enforced_by: 'nol file migrasi; DDL usulan hanya untuk tabel marketing/customers' }),
  Object.freeze({ id: 'P3', rule: 'Kode purchasing tidak membaca tabel marketing (leads/campaigns/customers).', enforced_by: 'harness C: pemindaian modules/requests, approvals, receivings, handovers, materials, vendors + lib/' }),
  Object.freeze({ id: 'P4', rule: 'Pembuatan project tetap di modul projects; marketing hanya MEMINTA (request), tidak menulis projects.', enforced_by: 'TABLE_OWNERSHIP.projects.marketing = read; rencana handoff hanya menyebut target_table customers' }),
  Object.freeze({ id: 'P5', rule: 'Jembatan lead→project HANYA lewat projects.id (tidak ada tabel project paralel).', enforced_by: 'skema lead: project_id uuid; tidak ada entitas project kedua' }),
  Object.freeze({ id: 'P6', rule: 'Tidak ada pengiriman pesan keluar, tidak ada iklan berbayar/ad platform/spend.', enforced_by: 'harness C: tidak ada telegram/wa/email/webhook/fetch ads/pixel/audience; is_paid_media selalu false' }),
  Object.freeze({ id: 'P7', rule: 'Tidak ada cron / sinkronisasi latar / retry otomatis.', enforced_by: 'harness C: tidak ada vercel crons, scheduler, setInterval, setTimeout, queue' }),
  Object.freeze({ id: 'P8', rule: 'sales_invoices.customer_id tetap NULLABLE — handoff bersifat aditif & opsional, invoice lama tidak rusak.', enforced_by: 'paritas dengan docs/sales-invoice-contract.md (customer_id uuid tanpa not null)' })
])

// ------------------------------------------------------------
// 6. NORMALISASI KONTAK & KUNCI DEDUPE
// ------------------------------------------------------------
// Nama TIDAK PERNAH cukup untuk dedupe (dua "Bu Rina" bisa berbeda orang).
// Kunci dedupe = nomor telepon ternormalisasi, atau email, atau null.
export function normalizePhone(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim()
  if (!raw) return null
  let digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  digits = digits.replace(/\D/g, '')
  if (!digits) return null
  // 08xx… / 8xx… → 62…
  if (digits.startsWith('0')) digits = '62' + digits.slice(1)
  else if (digits.startsWith('8')) digits = '62' + digits
  else if (digits.startsWith('620')) digits = '62' + digits.slice(3)
  if (digits.length < 9 || digits.length > 15) return null
  return digits
}

export function normalizeEmail(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
  if (!raw) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) return null
  return raw
}

export function customerKey({ phone = null, email = null } = {}) {
  const p = normalizePhone(phone)
  if (p) return `phone:${p}`
  const e = normalizeEmail(email)
  if (e) return `email:${e}`
  return null
}

export function normalizeUtm(utm = {}) {
  const out = {}
  for (const key of UTM_KEYS) {
    const v = utm[key]
    if (v === null || v === undefined || String(v).trim() === '') continue
    out[key] = String(v).trim().toLowerCase().slice(0, 120)
  }
  return out
}

// ------------------------------------------------------------
// 7. VALIDATOR (MURNI)
// ------------------------------------------------------------
function isDateLike(v) {
  if (typeof v !== 'string') return false
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v)) return false
  const d = new Date(v)
  return !isNaN(d.getTime())
}

function fieldSpec(entity, name) {
  const list = ENTITY_SCHEMAS[entity] || []
  return list.find(f => f.name === name) || null
}

function err(code, field, message) { return { code, field, message } }

// validateLead(lead, { touchpointCount }) ->
//   { ok, status, errors[], warnings[], next_allowed[], gate }
export function validateLead(lead, { touchpointCount = 0 } = {}) {
  const errors = []
  const warnings = []
  const rec = lead && typeof lead === 'object' ? lead : {}

  if (!rec.lead_id || String(rec.lead_id).trim() === '') {
    errors.push(err('LEAD_ID_REQUIRED', 'lead_id', 'lead_id wajib ada (idempotensi & jejak).'))
  }
  const status = String(rec.status || 'NEW').trim().toUpperCase()
  if (!LEAD_STATUSES.includes(status)) {
    errors.push(err('UNKNOWN_STATUS', 'status', `Status "${rec.status}" tidak dikenal. Pilihan: ${LEAD_STATUSES.join(', ')}.`))
  }
  const source = String(rec.source || '').trim().toUpperCase()
  if (!LEAD_SOURCES.includes(source)) {
    errors.push(err('UNKNOWN_SOURCE', 'source', `Sumber "${rec.source}" tidak ada di taksonomi. Pilihan: ${LEAD_SOURCES.join(', ')}.`))
  }
  if (!String(rec.contact_name || '').trim()) {
    errors.push(err('CONTACT_NAME_REQUIRED', 'contact_name', 'Nama kontak wajib ada.'))
  }

  const phone = rec.contact_phone === undefined || rec.contact_phone === null ? null : String(rec.contact_phone)
  const email = rec.contact_email === undefined || rec.contact_email === null ? null : String(rec.contact_email)
  const normPhone = phone && phone.trim() !== '' ? normalizePhone(phone) : null
  const normEmail = email && email.trim() !== '' ? normalizeEmail(email) : null
  // Nomor/email yang diisi tetapi tidak sah TIDAK boleh disembunyikan. Tetapi
  // ia hanya MENGGAGALKAN lead bila tidak ada kanal lain yang bisa dipakai:
  // salah ketik nomor sementara email benar bukan alasan membuang lead nyata —
  // cukup dilaporkan sebagai peringatan supaya bisa diperbaiki.
  if (phone && phone.trim() !== '' && !normPhone) {
    if (normEmail) {
      warnings.push({ code: 'PHONE_INVALID', field: 'contact_phone', message: 'Nomor telepon tidak bisa dinormalisasi (butuh 9–15 digit); lead masih bisa dihubungi lewat email, tetapi nomornya harus diperbaiki.' })
    } else {
      errors.push(err('PHONE_INVALID', 'contact_phone', 'Nomor telepon tidak bisa dinormalisasi (butuh 9–15 digit).'))
    }
  }
  if (email && email.trim() !== '' && !normEmail) {
    if (normPhone) {
      warnings.push({ code: 'EMAIL_INVALID', field: 'contact_email', message: 'Email tidak valid; lead masih bisa dihubungi lewat telepon, tetapi emailnya harus diperbaiki.' })
    } else {
      errors.push(err('EMAIL_INVALID', 'contact_email', 'Email tidak valid.'))
    }
  }
  if (!normPhone && !normEmail) {
    errors.push(err('CONTACT_CHANNEL_REQUIRED', 'contact_phone', 'Minimal satu kanal kontak (telepon atau email) harus valid — tanpa itu lead tidak bisa dihubungi.'))
  }

  if (rec.budget_min !== undefined && rec.budget_min !== null && !(Number(rec.budget_min) >= 0)) {
    errors.push(err('BUDGET_MIN_INVALID', 'budget_min', 'budget_min harus angka ≥ 0.'))
  }
  if (rec.budget_max !== undefined && rec.budget_max !== null && !(Number(rec.budget_max) >= 0)) {
    errors.push(err('BUDGET_MAX_INVALID', 'budget_max', 'budget_max harus angka ≥ 0.'))
  }
  if (Number(rec.budget_min) > 0 && Number(rec.budget_max) > 0 && Number(rec.budget_min) > Number(rec.budget_max)) {
    errors.push(err('BUDGET_RANGE_INVERTED', 'budget_min', 'budget_min lebih besar dari budget_max.'))
  }

  if (rec.quote_value !== undefined && rec.quote_value !== null && !(Number(rec.quote_value) > 0)) {
    errors.push(err('QUOTE_VALUE_INVALID', 'quote_value', 'quote_value harus > 0 (penawaran Rp 0 bukan penawaran).'))
  }

  if (rec.attribution !== undefined && rec.attribution !== null) {
    if (typeof rec.attribution !== 'object' || Array.isArray(rec.attribution)) {
      errors.push(err('ATTRIBUTION_INVALID', 'attribution', 'attribution harus objek { first_touch, last_touch }.'))
    } else {
      const utm = rec.attribution.utm
      if (utm !== undefined && (typeof utm !== 'object' || Array.isArray(utm))) {
        errors.push(err('UTM_INVALID', 'attribution.utm', 'utm harus objek.'))
      } else if (utm) {
        const unknown = Object.keys(utm).filter(k => !UTM_KEYS.includes(k))
        if (unknown.length) warnings.push({ code: 'UTM_UNKNOWN_KEY', field: 'attribution.utm', message: `Kunci UTM tidak dikenal diabaikan: ${unknown.join(', ')}.` })
      }
      const models = rec.attribution.model
      if (models !== undefined && !ATTRIBUTION_MODELS.includes(String(models).toUpperCase())) {
        errors.push(err('ATTRIBUTION_MODEL_INVALID', 'attribution.model', `model harus salah satu: ${ATTRIBUTION_MODELS.join(', ')}.`))
      }
    }
  }

  if (!rec.campaign_id && !rec.attribution) {
    warnings.push({ code: 'ATTRIBUTION_MISSING', field: 'campaign_id', message: 'Tanpa campaign_id/atribusi: lead tetap sah (walk-in/referral), tetapi tidak bisa dilaporkan per kampanye.' })
  }

  // Field asing = risiko "menambah kolom diam-diam" ke tabel bersama.
  const known = new Set((ENTITY_SCHEMAS.lead || []).map(f => f.name))
  const unknownFields = Object.keys(rec).filter(k => !known.has(k))
  if (unknownFields.length) {
    warnings.push({ code: 'UNKNOWN_FIELD', field: unknownFields[0], message: `Field tidak ada di kontrak: ${unknownFields.join(', ')}. Jangan menambah kolom tanpa perubahan kontrak.` })
  }

  // Gerbang bukti untuk status saat ini.
  const gate = QUALIFICATION_GATES[status] || null
  if (gate) {
    for (const req of gate.required) {
      if (req === 'min_touchpoints') {
        if (Number(touchpointCount) < Number(gate.min_touchpoints || 1)) {
          errors.push(err('GATE_TOUCHPOINT_MISSING', 'touchpoints', `Status ${status} butuh minimal ${gate.min_touchpoints} touchpoint tercatat; sekarang ${Number(touchpointCount) || 0}.`))
        }
        continue
      }
      const v = rec[req]
      const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
      if (empty) {
        errors.push(err('GATE_FIELD_MISSING', req, `Status ${status} butuh "${req}" — belum ada. ${gate.note}`))
      }
    }
    if (status === 'QUALIFIED') {
      const basis = String(rec.qualification_basis || '').toUpperCase()
      if (basis && !QUALIFICATION_BASIS.includes(basis)) {
        errors.push(err('QUALIFICATION_BASIS_INVALID', 'qualification_basis', `Dasar kualifikasi harus salah satu: ${QUALIFICATION_BASIS.join(', ')}.`))
      }
    }
    if (status === 'LOST') {
      const reason = String(rec.lost_reason_code || '').toUpperCase()
      if (reason && !LOST_REASON_CODES.includes(reason)) {
        errors.push(err('LOST_REASON_INVALID', 'lost_reason_code', `Alasan harus salah satu: ${LOST_REASON_CODES.join(', ')}.`))
      }
    }
    for (const req of gate.required) {
      const spec = fieldSpec('lead', req)
      if (!spec) continue
      if (spec.type === 'date' && rec[req] && !isDateLike(rec[req])) {
        errors.push(err('DATE_INVALID', req, `${req} harus tanggal YYYY-MM-DD.`))
      }
      if (spec.type === 'datetime' && rec[req] && !isDateLike(rec[req])) {
        errors.push(err('DATETIME_INVALID', req, `${req} harus tanggal/waktu ISO.`))
      }
    }
  }

  return {
    ok: errors.length === 0,
    status,
    errors,
    warnings,
    next_allowed: LEAD_STATUS_TRANSITIONS[status] ? [...LEAD_STATUS_TRANSITIONS[status]] : [],
    gate: gate ? { required: [...gate.required], note: gate.note } : null,
    contact: { phone: normPhone, email: normEmail, customer_key: customerKey({ phone, email }) },
    attribution_frozen: status === 'WON'
  }
}

export function canTransition(from, to) {
  const f = String(from || '').trim().toUpperCase()
  const t = String(to || '').trim().toUpperCase()
  const allowed = LEAD_STATUS_TRANSITIONS[f]
  if (!allowed) return { ok: false, code: 'UNKNOWN_FROM', message: `Status asal "${from}" tidak dikenal.` }
  if (!LEAD_STATUSES.includes(t)) return { ok: false, code: 'UNKNOWN_TO', message: `Status tujuan "${to}" tidak dikenal.` }
  if (!allowed.includes(t)) {
    return {
      ok: false,
      code: 'TRANSITION_NOT_ALLOWED',
      message: `${f} → ${t} tidak diizinkan. Yang boleh: ${allowed.length ? allowed.join(', ') : '(final — buat lead baru)'}.`
    }
  }
  return { ok: true, code: 'OK', message: `${f} → ${t} diizinkan.` }
}

// ------------------------------------------------------------
// 8. RENCANA HANDOFF KE CRM (PLAN SAJA — TIDAK MENULIS)
// ------------------------------------------------------------
// handoffPlan({ lead, touchpointCount, existingCustomer }) -> rencana deterministik
//   action: LINK_EXISTING | CREATE_CUSTOMER | BLOCKED
//   would_write: SELALU false (lapisan ini tidak punya jalur tulis)
// `existingCustomer` = { customer_id, customer_key } hasil pencarian CRM (read-only)
// yang dilakukan pemanggil; di sini hanya dipakai untuk memutuskan link vs buat.
export function handoffPlan({ lead = null, touchpointCount = 0, existingCustomer = null } = {}) {
  const v = validateLead(lead, { touchpointCount })
  const key = v.contact.customer_key
  const blocked = []
  if (!v.ok) blocked.push({ code: 'LEAD_INVALID', message: `Lead belum sah: ${v.errors.map(e => e.code).join(', ')}.` })
  if (!key) blocked.push({ code: 'NO_DEDUPE_KEY', message: 'Tidak ada telepon/email valid → customer tidak bisa dicocokkan tanpa membuat duplikat.' })

  const action = blocked.length ? 'BLOCKED' : (existingCustomer && existingCustomer.customer_id ? 'LINK_EXISTING' : 'CREATE_CUSTOMER')

  return {
    dry_run: true,
    would_write: false,
    executed: false,
    action,
    lead_id: lead && lead.lead_id ? lead.lead_id : null,
    customer_key: key,
    idempotency_key: lead && lead.lead_id ? `handoff:${lead.lead_id}:${key || 'nokey'}` : null,
    target_table: 'customers',
    target_owner: 'crm',
    project_request: {
      requested: v.status === 'WON',
      executed_by: 'projects-module',
      note: 'Marketing TIDAK membuat project. Ia hanya menandai bahwa project perlu dibuat setelah WON.',
      fields_proposed: { name: null, kode: null, code: null, status: 'NOT_START' }
    },
    blocked_reasons: blocked,
    preconditions: [
      'Lead berstatus WON dengan bukti lengkap (quote_ref, customer_id, project_id, won_at, confirmed_by).',
      'Tabel `customers` tersedia (saat ini BELUM — PGRST205).',
      'Admin yang memanggil sudah terverifikasi (guard yang sama dengan /api/sales-invoices).'
    ],
    postconditions: [
      'Satu baris `customers` per customer_key (tidak ada duplikat).',
      'Satu baris `lead_handoffs` per (lead_id, customer_key) — idempotensi.',
      '`leads.customer_id` terisi; `projects` TIDAK ditulis oleh marketing.',
      'attribution_snapshot dibekukan; perubahan kampanye setelahnya tidak mengubah angka historis.'
    ],
    forbidden: [
      'menulis purchase_requests / pr_items / approval_steps / receivings / receiving_items / handovers / projects / sales_invoices',
      'mengirim pesan ke lead (WA/email/DM)',
      'membeli iklan / mengunggah audience / memasang pixel'
    ]
  }
}

// ------------------------------------------------------------
// 9. RINGKASAN KONTRAK (dipakai endpoint & CLI, bukan data live)
// ------------------------------------------------------------
export function contractSummary() {
  return {
    contract_id: CONTRACT_ID,
    contract_version: CONTRACT_VERSION,
    dry_run: true,
    read_only: true,
    lead_sources: [...LEAD_SOURCES],
    lead_statuses: [...LEAD_STATUSES],
    transitions: Object.fromEntries(Object.entries(LEAD_STATUS_TRANSITIONS).map(([k, v]) => [k, [...v]])),
    terminal_statuses: [...TERMINAL_LEAD_STATUSES],
    qualification_gates: Object.fromEntries(
      Object.entries(QUALIFICATION_GATES).map(([k, v]) => [k, { required: [...v.required], note: v.note, ...(v.min_touchpoints ? { min_touchpoints: v.min_touchpoints } : {}) }])
    ),
    qualification_basis: [...QUALIFICATION_BASIS],
    lost_reason_codes: [...LOST_REASON_CODES],
    touchpoint_channels: [...TOUCHPOINT_CHANNELS],
    attribution: {
      models: [...ATTRIBUTION_MODELS],
      utm_keys: [...UTM_KEYS],
      frozen_at: ATTRIBUTION_FROZEN_AT,
      note: 'First touch & last touch disimpan berdampingan; dibekukan saat WON.'
    },
    entities: Object.fromEntries(
      Object.entries(ENTITY_SCHEMAS).map(([k, v]) => [k, v.map(f => ({ ...f, ...(f.values ? { values: [...f.values] } : {}) }))])
    ),
    table_ownership: TABLE_OWNERSHIP.map(t => ({ ...t })),
    purchasing_invariants: PURCHASING_INVARIANTS.map(i => ({ ...i })),
    no_public_send: true,
    no_paid_ads: true,
    no_cron: true,
    writes_in_this_layer: 0
  }
}
