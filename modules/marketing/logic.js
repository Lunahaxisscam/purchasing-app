// ============================================================
// modules/marketing/logic.js — LOGIKA MURNI (t_31a1a9f9)
// ============================================================
// Prototype Marketing / Lead Pipeline — READ-ONLY dari sisi DB.
//
// TANPA React, TANPA DOM, TANPA DB, TANPA jaringan. Semua fungsi
// deterministik dan bisa diuji headless. Tampilan ada di
// modules/marketing/view.jsx.
//
// KEPUTUSAN YANG DIJAGA (kontrak modul):
//
// 1. TIDAK ADA PERSISTENSI PALSU. Modul ini tidak membuat tabel, tidak
//    memanggil RPC, tidak menulis Supabase, tidak memakai localStorage.
//    Lead yang ditambahkan lewat form hidup sebagai DRAF di state React
//    halaman dan diberi label "Draf halaman" — itu ditulis jelas di
//    layar, bukan disamarkan sebagai "tersimpan".
//
// 2. TIDAK ADA LEAD CONTOH. Kalau host tidak mengirim data, papan
//    pipeline kosong dan halaman mengatakan kosong. Tidak ada data demo
//    yang disuntikkan supaya tampilan terlihat "hidup".
//
// 3. STATUS KEMAMPUAN (capability) JUJUR:
//      'unavailable' : host TIDAK mengirim prop leads sama sekali
//                       (tabel/RLS belum dipasang) -> panel penjelasan,
//                       BUKAN papan kosong yang terlihat seperti bug.
//      'empty'       : host mengirim array kosong -> "Belum ada lead
//                       terdata".
//      'ready'       : ada baris lead -> papan pipeline.
//
// 4. TAHAP TIDAK DIKARANG. Lead dengan tahap yang tidak dikenali TIDAK
//    dipaksa masuk "New Lead"; ia masuk ember sendiri bertanda
//    "Tahap tidak diketahui" supaya bisa diperbaiki, bukan dihilangkan.
//
// 5. ANGKA KOSONG = "Tidak tersedia", BUKAN 0 dan BUKAN string kosong.
//    Aksi berikutnya yang belum ada ditulis "Belum ada aksi
//    berikutnya", bukan dibiarkan kosong yang terbaca "tidak ada
//    tindakan".
//
// 6. TAUTAN CRM JUJUR. Empat keadaan yang berbeda maknanya:
//      linked     -> customer_id ada DAN ditemukan di data CRM yang dikirim
//      missing    -> customer_id kosong (belum ditautkan)
//      unresolved -> customer_id ada tapi TIDAK ada di data CRM yang dikirim
//      unknown    -> host tidak mengirim data CRM sama sekali
//    Yang terakhir BUKAN "tidak ditemukan" — halaman bilang sumbernya
//    tidak dikirim, sama seperti relasi invoice di modul CRM.
// ============================================================

// Label yang dipakai berkali-kali — satu tempat supaya tidak drift.
export const UNAVAILABLE_LABEL = 'Tidak tersedia'
export const DRAFT_LABEL = 'Draf halaman'
export const EMPTY_LABEL = 'Belum ada lead terdata'
export const SELECTOR_EMPTY_LABEL = 'Belum ada lead terdata'
export const NEXT_ACTION_UNKNOWN = 'Belum ada aksi berikutnya'
export const CRM_LINK_UNKNOWN = 'Data customer CRM tidak dikirim ke halaman ini'
export const STAGE_UNKNOWN_LABEL = 'Tahap tidak diketahui'

// ============================================================
// TAHAP PIPELINE
// ============================================================
// Urutan ember di papan. Won/Lost adalah tahap akhir (closed) —
// tetap tampil di papan supaya funnel terlihat utuh, tapi tidak
// dihitung sebagai "lead terbuka".
export const STAGES = [
  { key: 'new_lead', label: 'New Lead', order: 1, closed: false },
  { key: 'qualified', label: 'Qualified', order: 2, closed: false },
  { key: 'rab', label: 'RAB', order: 3, closed: false },
  { key: 'won', label: 'Won', order: 4, closed: true },
  { key: 'lost', label: 'Lost', order: 5, closed: true }
]

// Ember tambahan untuk lead yang tahapnya tidak dikenali. Tidak
// pernah diisi otomatis dari tahap sah — hanya menampung yang
// memang tidak bisa dibaca.
export const STAGE_UNKNOWN = { key: 'unknown', label: STAGE_UNKNOWN_LABEL, order: 99, closed: false }

export const STAGE_BUCKETS = [...STAGES, STAGE_UNKNOWN]

const STAGE_ALIASES = {
  new_lead: 'new_lead',
  'new lead': 'new_lead',
  newlead: 'new_lead',
  lead: 'new_lead',
  baru: 'new_lead',
  qualified: 'qualified',
  kualifikasi: 'qualified',
  qualified_lead: 'qualified',
  rab: 'rab',
  quotation: 'rab',
  penawaran: 'rab',
  won: 'won',
  menang: 'won',
  deal: 'won',
  closed_won: 'won',
  lost: 'lost',
  kalah: 'lost',
  batal: 'lost',
  closed_lost: 'lost'
}

const STAGE_KEYS = new Set(STAGES.map(s => s.key))

/**
 * Normalkan tulisan tahap apa adanya ke kunci kanonik.
 * Yang tidak dikenali -> null (BUKAN dipaksa ke 'new_lead').
 */
export function normalizeStage(raw) {
  if (raw == null) return null
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (key === '') return null
  const direct = STAGE_ALIASES[key]
  if (direct) return direct
  const spaced = String(raw).trim().toLowerCase()
  return STAGE_ALIASES[spaced] ?? null
}

export function isKnownStage(key) {
  return STAGE_KEYS.has(String(key ?? ''))
}

/** Label tahap; yang tidak dikenal tetap dapat label jujur. */
export function stageLabel(key) {
  if (key == null || key === '') return STAGE_UNKNOWN_LABEL
  const found = STAGE_BUCKETS.find(s => s.key === key)
  return found ? found.label : STAGE_UNKNOWN_LABEL
}

/** Opsi untuk <select> form — hanya tahap yang sah. */
export function stageSelectOptions() {
  return STAGES.map(s => ({ value: s.key, label: s.label }))
}

/** Tahap sebuah lead (hasil normalisasi). */
export function leadStage(lead) {
  return normalizeStage(lead?.stage)
}

// ============================================================
// KEMAMPUAN SUMBER DATA
// ============================================================
export const CAPABILITY = {
  UNAVAILABLE: 'unavailable',
  EMPTY: 'empty',
  READY: 'ready'
}

/**
 * Menilai sumber data lead yang dikirim host. Menerima prop mentah
 * (bukan hasil readLeads) supaya bisa membedakan "tabel belum
 * dipasang" (undefined/null) dari "tabel kosong" ([]).
 */
export function leadCapability(raw) {
  if (!Array.isArray(raw)) return CAPABILITY.UNAVAILABLE
  return raw.length > 0 ? CAPABILITY.READY : CAPABILITY.EMPTY
}

export const CAPABILITY_COPY = {
  unavailable: {
    title: 'Tabel lead marketing belum tersedia di aplikasi ini',
    body: 'Halaman pipeline sudah siap dipakai, tapi sumber datanya (tabel + RLS) belum dipasang. Tidak ada lead contoh yang ditampilkan — papan di bawah hanya berisi data yang benar-benar dikirim ke halaman ini, dan draf yang kamu buat sendiri.'
  },
  empty: {
    title: EMPTY_LABEL,
    body: 'Sumber lead sudah terbaca, tapi masih kosong. Lead yang ditambahkan dari form di halaman ini hidup sebagai draf di memori halaman sampai penyimpanan server aktif.'
  },
  ready: {
    title: 'Papan pipeline lead',
    body: 'Kartu di bawah dibaca dari data yang dikirim host ke halaman ini. Halaman ini tidak menulis ke database.'
  }
}

// Keterbatasan yang ditulis apa adanya di panel bawah halaman.
export const DATA_LIMITATIONS = [
  'Belum ada penulisan ke database: tidak ada tabel leads, tidak ada RPC, tidak ada migrasi baru.',
  'Lead baru hanya draf di memori halaman — hilang saat halaman dimuat ulang, dan itu disebutkan di setiap kartu draf.',
  'Kartu lead dari host bersifat baca saja; perubahan tidak bisa dikirim balik ke server.',
  'Tautan ke customer CRM hanya bisa diselesaikan kalau host mengirim data customer. Kalau tidak dikirim, modul menulis "tidak dikirim", bukan "tidak ditemukan".',
  'Lead dengan tahap yang tidak dikenali ditaruh di ember "Tahap tidak diketahui" — tidak dipaksa masuk New Lead.',
  'Tidak ada lead contoh: papan kosong berarti kosong.'
]

// Bentuk form tambah/edit lead (kontrak field UI).
export const LEAD_FIELDS = [
  { key: 'name', label: 'Nama lead', type: 'text', required: true, placeholder: 'Contoh: Ibu Sarah' },
  { key: 'stage', label: 'Tahap pipeline', type: 'select', required: false, placeholder: '' },
  { key: 'source', label: 'Sumber', type: 'text', required: false, placeholder: 'Contoh: Instagram, referral, walk-in' },
  { key: 'campaign', label: 'Kampanye / tag', type: 'text', required: false, placeholder: 'Contoh: Promo Lebaran 2026' },
  { key: 'next_action', label: 'Aksi berikutnya', type: 'text', required: false, placeholder: 'Contoh: Kirim penawaran' },
  { key: 'next_action_date', label: 'Tanggal aksi', type: 'date', required: false, placeholder: '' },
  { key: 'customer_id', label: 'ID customer CRM', type: 'text', required: false, placeholder: 'Kosongkan kalau belum ditautkan' },
  { key: 'notes', label: 'Catatan', type: 'textarea', required: false, placeholder: 'Kebutuhan, anggaran, atau hal penting lain' }
]

export function emptyForm() {
  return {
    name: '',
    stage: 'new_lead',
    source: '',
    campaign: '',
    next_action: '',
    next_action_date: '',
    customer_id: '',
    notes: ''
  }
}

// ============================================================
// PEMBACAAN DEFENSIF
// ============================================================

/**
 * Normalkan baris lead dari host. Menerima beberapa nama field yang
 * sudah dipakai di repo ini (name/lead_name/nama/customer_name,
 * stage/status/tahap, source/sumber/channel, campaign/kampanye,
 * next_action/aksi_berikutnya, next_action_date/tanggal_aksi,
 * customer_id/crm_customer_id). Baris tanpa nama dibuang — nama
 * adalah satu-satunya field yang benar-benar wajib.
 */
export function readLeads(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((l, i) => {
      const name = String(l?.name ?? l?.lead_name ?? l?.nama ?? l?.customer_name ?? '').trim()
      return {
        id: l?.id != null && String(l.id) !== '' ? String(l.id) : `mk-${i}`,
        name,
        stage: normalizeStage(l?.stage ?? l?.status ?? l?.tahap),
        source: String(l?.source ?? l?.sumber ?? l?.channel ?? '').trim(),
        campaign: String(l?.campaign ?? l?.kampanye ?? l?.utm_campaign ?? l?.tag ?? '').trim(),
        next_action: String(l?.next_action ?? l?.aksi_berikutnya ?? l?.next_step ?? '').trim(),
        next_action_date: String(l?.next_action_date ?? l?.tanggal_aksi ?? l?.due_date ?? '').trim(),
        customer_id: String(l?.customer_id ?? l?.crm_customer_id ?? l?.customer ?? '').trim(),
        notes: String(l?.notes ?? l?.note ?? l?.catatan ?? '').trim(),
        created_at: l?.created_at ?? null,
        origin: 'host'
      }
    })
    .filter(l => l.name !== '')
}

/** Gabung baris host (baca) + draf halaman. Satu daftar untuk UI. */
export function mergeLeads(host = [], drafts = []) {
  const hostRows = (host || []).map(l => ({ ...l, origin: 'host' }))
  const draftRows = (drafts || []).map((d, i) => ({
    ...d,
    stage: normalizeStage(d?.stage),
    id: d?.id != null ? String(d.id) : `draft-${i}`,
    origin: 'draft'
  }))
  return [...hostRows, ...draftRows]
}

// ============================================================
// NILAI TURUNAN (aman untuk data yang tidak lengkap)
// ============================================================

/** Key stabil untuk data-testid (aman untuk DOM). */
export function leadKey(l) {
  const slug = String(l?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug !== '') return slug
  const idSlug = String(l?.id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return idSlug !== '' ? idSlug : 'x'
}

/** Key unik per kartu (nama + id) untuk React key — aman walau nama kembar. */
export function leadRowKey(l) {
  return `${leadKey(l)}--${String(l?.id ?? '') || 'noid'}`
}

/**
 * true kalau leadKey(l) belum dipakai lead lain dalam daftar yang sama.
 * Dipakai view untuk membuat data-testid unik: dua baris boleh bernama
 * sama (draf yang mengulang nama lead host), tapi testid kembar membuat
 * test — dan manusia di DevTools — tidak bisa membedakannya.
 */
export function leadKeyIsUnique(l, list = []) {
  const key = leadKey(l)
  return (list || []).filter(x => leadKey(x) === key).length <= 1
}

/** Sumber lead; null = tidak ada (bukan string kosong). */
export function leadSource(l) {
  const s = String(l?.source ?? '').trim()
  return s === '' ? null : s
}

/** Kampanye / tag; null = tidak ada. */
export function leadCampaign(l) {
  const c = String(l?.campaign ?? '').trim()
  return c === '' ? null : c
}

/** Teks aksi berikutnya; null = belum ada (bukan string kosong). */
export function nextActionText(l) {
  const a = String(l?.next_action ?? '').trim()
  return a === '' ? null : a
}

// ------------------------------------------------------------
// Tanggal — parsing & tampilan deterministik (tanpa ICU).
// 'YYYY-MM-DD' dibaca sebagai tanggal LOKAL supaya tidak bergeser
// satu hari karena timezone.
// ------------------------------------------------------------
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** Nomor hari yang stabil untuk perbandingan (komponen lokal). */
function dayNumber(d) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Parse tanggal dari ISO/Date; tidak valid -> null (BUKAN epoch 0). */
export function parseDateOrNull(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const s = String(v ?? '').trim()
  if (s === '') return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

/** Tanggal aksi berikutnya; null = belum ditentukan. */
export function nextActionDate(l) {
  return parseDateOrNull(l?.next_action_date)
}

/** Format tanggal Indonesia singkat ("20 Okt 2026"); null = tidak ada. */
export function formatDateId(v) {
  const d = parseDateOrNull(v)
  if (!d) return null
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Status jatuh tempo aksi berikutnya relatif terhadap `today`.
 *   'none'    -> tidak ada tanggal aksi
 *   'overdue' -> tanggalnya sudah lewat
 *   'today'   -> hari ini
 *   'later'   -> masih di depan
 * `today` boleh Date atau 'YYYY-MM-DD' — deterministik untuk test.
 */
export function nextActionDue(l, today) {
  const d = nextActionDate(l)
  if (!d) return 'none'
  const ref = parseDateOrNull(today) ?? new Date()
  const a = dayNumber(d)
  const b = dayNumber(ref)
  if (a < b) return 'overdue'
  if (a === b) return 'today'
  return 'later'
}

// ------------------------------------------------------------
// TAUTAN KE CUSTOMER CRM
// ------------------------------------------------------------
export const LINK_STATE = {
  LINKED: 'linked',
  MISSING: 'missing',
  UNRESOLVED: 'unresolved',
  UNKNOWN: 'unknown'
}

/**
 * Selesaikan tautan lead -> customer CRM.
 * `customers` = data CRM yang DIKIRIM HOST (bukan array -> 'unknown').
 */
export function customerLink(lead, customers) {
  const id = String(lead?.customer_id ?? '').trim()
  if (id === '') {
    return { state: LINK_STATE.MISSING, text: 'Belum ditautkan ke CRM', customer: null }
  }
  if (!Array.isArray(customers)) {
    return { state: LINK_STATE.UNKNOWN, text: CRM_LINK_UNKNOWN, customer: null }
  }
  const found = customers.find(c => String(c?.id ?? '').trim() === id) || null
  if (!found) {
    return {
      state: LINK_STATE.UNRESOLVED,
      text: `Customer "${id}" tidak ditemukan di data CRM`,
      customer: null
    }
  }
  return { state: LINK_STATE.LINKED, text: `CRM: ${found.name}`, customer: found }
}

/** Ringkas teks tautan untuk satu kartu. */
export function customerLinkText(lead, customers) {
  return customerLink(lead, customers).text
}

// ============================================================
// HITUNGAN PIPELINE
// ============================================================

/** Hitungan lead per ember tahap (termasuk 'unknown'). */
export function stageCounts(leads) {
  const out = {}
  for (const b of STAGE_BUCKETS) out[b.key] = 0
  for (const l of leads || []) {
    const k = leadStage(l)
    if (k === null) out.unknown += 1
    else out[k] += 1
  }
  return out
}

/**
 * Ringkasan untuk kartu KPI. `today` dipakai untuk menghitung aksi
 * terlambat; boleh 'YYYY-MM-DD' supaya test deterministik.
 */
export function summarizeLeads(leads, today) {
  const list = leads || []
  const counts = stageCounts(list)
  const open = counts.new_lead + counts.qualified + counts.rab
  const closed = counts.won + counts.lost
  let overdue = 0
  let withNextAction = 0
  let noNextAction = 0
  for (const l of list) {
    if (nextActionText(l) === null) noNextAction += 1
    else withNextAction += 1
    if (nextActionDue(l, today) === 'overdue') overdue += 1
  }
  return {
    total: list.length,
    open,
    closed,
    won: counts.won,
    lost: counts.lost,
    unknown: counts.unknown,
    withNextAction,
    noNextAction,
    overdue
  }
}

/** Daftar sumber (unik, rapi) untuk filter. */
export function sourceOptions(leads) {
  const set = new Set()
  for (const l of leads || []) {
    const s = leadSource(l)
    if (s !== null) set.add(s)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Daftar kampanye/tag (unik, rapi) untuk filter. */
export function campaignOptions(leads) {
  const set = new Set()
  for (const l of leads || []) {
    const c = leadCampaign(l)
    if (c !== null) set.add(c)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter daftar lead. Pencarian menyentuh nama, sumber, kampanye,
 * aksi berikutnya, catatan, dan id customer CRM — case-insensitive.
 */
export function filterLeads({ leads, query, stage, source, campaign } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  const st = String(stage ?? 'all').trim().toLowerCase()
  const src = String(source ?? 'all').trim().toLowerCase()
  const cmp = String(campaign ?? 'all').trim().toLowerCase()
  return (leads || []).filter(l => {
    if (st !== '' && st !== 'all') {
      const k = leadStage(l)
      if (k === null) { if (st !== 'unknown') return false }
      else if (String(k).toLowerCase() !== st) return false
    }
    if (src !== '' && src !== 'all' && String(leadSource(l) ?? '').toLowerCase() !== src) return false
    if (cmp !== '' && cmp !== 'all' && String(leadCampaign(l) ?? '').toLowerCase() !== cmp) return false
    if (q === '') return true
    const hay = [l?.name, l?.source, l?.campaign, l?.next_action, l?.notes, l?.customer_id]
      .map(v => String(v ?? '').toLowerCase())
      .join(' ')
    return hay.includes(q)
  })
}

// ============================================================
// VALIDASI & DUPLIKAT (client-side, tidak menulis apa pun)
// ============================================================

/** Cari lead yang mirip (nama sama) di daftar. Peringatan, bukan penolakan. */
export function findDuplicateLead(existing, form, editingId) {
  const name = String(form?.name ?? '').trim().toLowerCase()
  return (existing || []).find(l => {
    if (editingId != null && String(l.id) === String(editingId)) return false
    return name !== '' && String(l.name).trim().toLowerCase() === name
  }) || null
}

/**
 * Validasi form. Mengembalikan { ok, errors, warnings, duplicate }.
 * errors memblokir submit; warnings hanya informasi.
 */
export function validateLead(form, { existing = [], editingId = null } = {}) {
  const errors = {}
  const name = String(form?.name ?? '').trim()
  if (name === '') errors.name = 'Nama lead wajib diisi.'
  else if (name.length < 2) errors.name = 'Nama lead minimal 2 karakter.'

  // Tahap: form hanya menawarkan tahap sah, tapi form bisa diisi
  // programatik — nilai asing DITOLAK, bukan dibuang diam-diam.
  const stage = String(form?.stage ?? '').trim()
  if (stage !== '' && !isKnownStage(stage)) {
    errors.stage = 'Tahap pipeline tidak dikenali — pilih dari daftar.'
  }

  const date = String(form?.next_action_date ?? '').trim()
  if (date !== '' && parseDateOrNull(date) === null) {
    errors.next_action_date = 'Tanggal aksi belum benar (format: tahun-bulan-tanggal).'
  }

  const duplicate = findDuplicateLead(existing, form, editingId)
  const warnings = duplicate
    ? [`Data mirip lead "${duplicate.name}" yang sudah ada. Periksa dulu sebelum menambah yang baru.`]
    : []

  return { ok: Object.keys(errors).length === 0, errors, warnings, duplicate }
}

// ============================================================
// EKSPOR CSV
// ============================================================

function csvEsc(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

/** Kolom eksplisit supaya file bisa dibuka di Excel tanpa tebak-tebak. */
export function toCsv(leads) {
  const head = ['Nama lead', 'Tahap', 'Sumber', 'Kampanye', 'Aksi berikutnya', 'Tanggal aksi', 'ID customer CRM', 'Catatan', 'Asal data']
  const body = (leads || []).map(l => [
    l.name,
    stageLabel(leadStage(l)),
    leadSource(l) ?? '',
    leadCampaign(l) ?? '',
    nextActionText(l) ?? '',
    formatDateId(l?.next_action_date) ?? '',
    String(l?.customer_id ?? ''),
    l.notes ?? '',
    l.origin === 'draft' ? 'draf memori halaman' : 'data yang dikirim host'
  ].map(csvEsc).join(','))
  return [head.map(csvEsc).join(','), ...body].join('\n')
}
