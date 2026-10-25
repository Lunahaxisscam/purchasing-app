// ============================================================
// scripts/marketing/samples.js — CONTOH DRY-RUN (BUKAN DATA PELANGGAN)
// ============================================================
// Semua nilai di file ini KARANGAN YANG DISENGAJA untuk menguji skema dan
// aturan. Nama, nomor telepon, dan email di bawah adalah fiktif:
//   * nomor memakai rentang 62 812 0000 00xx (tidak pernah dipakai nyata),
//   * email memakai domain `contoh.invalid` (TLD yang dijamin tidak ada),
//   * nama memakai label generik ("Contoh Klien A").
//
// TIDAK ADA data marketing live di sini. Bila nanti marketing berjalan,
// contoh-contoh ini TETAP dipakai harness sebagai fixture, bukan diganti data
// pelanggan nyata (data pelanggan tidak boleh masuk repo).
//
// Setiap contoh punya `intent` supaya jelas APA yang dibuktikan:
//   valid-*    → harus LULUS validasi
//   gate-*     → harus GAGAL karena bukti status kurang
//   invalid-*  → harus GAGAL karena data tidak sah
// ============================================================

const T = (id, channel, occurred_at, direction, summary) => ({
  touchpoint_id: `tp-${id}`,
  lead_id: null, // diisi di bawah
  channel,
  occurred_at,
  direction,
  summary,
  recorded_by: 'u-contoh-admin'
})

function lead(over = {}) {
  return {
    lead_id: 'lead-contoh',
    source: 'INSTAGRAM',
    source_detail: null,
    status: 'NEW',
    contact_name: 'Contoh Klien A',
    contact_phone: null,
    contact_email: null,
    city: null,
    need_summary: null,
    qualification_basis: null,
    budget_min: null,
    budget_max: null,
    survey_date: null,
    survey_ref: null,
    quote_ref: null,
    quote_value: null,
    quote_date: null,
    campaign_id: null,
    attribution: null,
    customer_id: null,
    project_id: null,
    won_at: null,
    confirmed_by: null,
    lost_reason_code: null,
    lost_at: null,
    last_contact_at: null,
    supersedes_lead_id: null,
    created_at: '2026-10-01T02:00:00Z',
    ...over
  }
}

export const SAMPLES = Object.freeze([
  {
    id: 'valid-new-walkin',
    title: 'Lead baru walk-in, tanpa kampanye (jalur referral/walk-in harus tetap sah)',
    intent: 'valid',
    touchpoint_count: 0,
    lead: lead({
      lead_id: 'lead-contoh-walkin',
      source: 'WALK_IN',
      status: 'NEW',
      contact_name: 'Contoh Klien Walkin',
      contact_phone: '0812-0000-0011'
    }),
    touchpoints: []
  },
  {
    id: 'valid-qualified-referral',
    title: 'Lead QUALIFIED dari referral, ada atribusi referral (tanpa kampanye berbayar)',
    intent: 'valid',
    touchpoint_count: 2,
    lead: lead({
      lead_id: 'lead-contoh-referral',
      source: 'REFERRAL',
      source_detail: 'rekomendasi arsitek rekanan',
      status: 'QUALIFIED',
      contact_name: 'Contoh Klien Referral',
      contact_phone: '+62 812 0000 0022',
      city: 'Jakarta',
      need_summary: 'Kitchen set + wardrobe 3 kamar, rumah 120 m2',
      qualification_basis: 'REFERRAL_TRUST',
      budget_min: 80000000,
      budget_max: 120000000,
      attribution: {
        model: 'FIRST_TOUCH',
        first_touch: { source: 'REFERRAL', channel: 'REFERRAL_INTRO', at: '2026-10-02T03:00:00Z' },
        last_touch: { source: 'WHATSAPP', channel: 'WHATSAPP', at: '2026-10-05T09:00:00Z' },
        utm: {}
      }
    }),
    touchpoints: [
      T('r1', 'REFERRAL_INTRO', '2026-10-02T03:00:00Z', 'INBOUND', 'Dikenalkan arsitek rekanan'),
      T('r2', 'WHATSAPP', '2026-10-05T09:00:00Z', 'INBOUND', 'Kirim foto denah + daftar kebutuhan')
    ]
  },
  {
    id: 'valid-won-full',
    title: 'Lead WON lengkap (customer + project + bukti konfirmasi) → rencana handoff',
    intent: 'valid',
    touchpoint_count: 4,
    lead: lead({
      lead_id: 'lead-contoh-won',
      source: 'INSTAGRAM',
      status: 'WON',
      contact_name: 'Contoh Klien Menang',
      contact_phone: '081200000033',
      contact_email: 'klien-menang@contoh.invalid',
      city: 'Bekasi',
      need_summary: 'Renovasi dapur + ruang makan',
      qualification_basis: 'SITE_VISIT',
      survey_date: '2026-10-08',
      survey_ref: 'SURVEY/CONTOH/001',
      quote_ref: 'RAB/CONTOH/014',
      quote_value: 95500000,
      quote_date: '2026-10-12',
      campaign_id: 'campaign-contoh-ig',
      attribution: {
        model: 'LAST_TOUCH',
        first_touch: { source: 'INSTAGRAM', channel: 'INSTAGRAM_DM', at: '2026-10-03T04:00:00Z', utm: { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'contoh-dapur' } },
        last_touch: { source: 'WHATSAPP', channel: 'WHATSAPP', at: '2026-10-12T08:30:00Z', utm: {} }
      },
      customer_id: 'cust-contoh-0001',
      project_id: 'proj-contoh-0001',
      won_at: '2026-10-13T10:00:00Z',
      confirmed_by: 'u-contoh-admin'
    }),
    existing_customer: null,
    touchpoints: [
      T('w1', 'INSTAGRAM_DM', '2026-10-03T04:00:00Z', 'INBOUND', 'DM tanya renovasi dapur'),
      T('w2', 'WHATSAPP', '2026-10-06T02:00:00Z', 'OUTBOUND', 'Jadwalkan survey'),
      T('w3', 'WALK_IN', '2026-10-08T05:00:00Z', 'OUTBOUND', 'Survey lokasi, ukur dapur'),
      T('w4', 'WHATSAPP', '2026-10-12T08:30:00Z', 'OUTBOUND', 'Kirim penawaran RAB/CONTOH/014')
    ]
  },
  {
    id: 'valid-won-existing-customer',
    title: 'Lead WON untuk klien yang SUDAH ada di CRM → LINK_EXISTING (bukan duplikat)',
    intent: 'valid',
    touchpoint_count: 1,
    lead: lead({
      lead_id: 'lead-contoh-repeat',
      source: 'WHATSAPP',
      status: 'WON',
      contact_name: 'Contoh Klien Repeat',
      contact_phone: '0812-0000-0044',
      need_summary: 'Tambah lemari kamar anak',
      qualification_basis: 'WHATSAPP_CHAT',
      quote_ref: 'RAB/CONTOH/021',
      quote_value: 18500000,
      quote_date: '2026-10-14',
      customer_id: 'cust-contoh-0002',
      project_id: 'proj-contoh-0002',
      won_at: '2026-10-15T03:00:00Z',
      confirmed_by: 'u-contoh-admin'
    }),
    // Hasil pencarian CRM (read-only) yang dilakukan pemanggil: sudah ada.
    existing_customer: { customer_id: 'cust-contoh-0002', customer_key: 'phone:6281200000044' },
    touchpoints: [
      T('x1', 'WHATSAPP', '2026-10-14T01:00:00Z', 'INBOUND', 'Minta tambah lemari, klien lama')
    ]
  },
  {
    id: 'gate-qualified-no-need',
    title: 'GAGAL: status QUALIFIED tetapi need_summary kosong (status tanpa bukti)',
    intent: 'gate',
    touchpoint_count: 1,
    lead: lead({
      lead_id: 'lead-contoh-gate1',
      source: 'TIKTOK',
      status: 'QUALIFIED',
      contact_name: 'Contoh Klien Gate 1',
      contact_phone: '081200000055',
      need_summary: null,
      qualification_basis: null
    }),
    touchpoints: [T('g1', 'INSTAGRAM_DM', '2026-10-04T02:00:00Z', 'INBOUND', 'Tanya harga')]
  },
  {
    id: 'gate-contacted-no-touchpoint',
    title: 'GAGAL: status CONTACTED tanpa satu pun touchpoint (percakapan tanpa jejak)',
    intent: 'gate',
    touchpoint_count: 0,
    lead: lead({
      lead_id: 'lead-contoh-gate2',
      source: 'WEBSITE',
      status: 'CONTACTED',
      contact_name: 'Contoh Klien Gate 2',
      contact_email: 'gate2@contoh.invalid'
    }),
    touchpoints: []
  },
  {
    id: 'gate-quoted-zero-value',
    title: 'GAGAL: status QUOTED dengan quote_value 0 (penawaran Rp 0 bukan penawaran)',
    intent: 'gate',
    touchpoint_count: 2,
    lead: lead({
      lead_id: 'lead-contoh-gate3',
      source: 'MARKETPLACE',
      status: 'QUOTED',
      contact_name: 'Contoh Klien Gate 3',
      contact_phone: '081200000066',
      need_summary: 'Bikin meja rapat',
      qualification_basis: 'MARKETPLACE_INQUIRY',
      quote_ref: 'RAB/CONTOH/099',
      quote_value: 0,
      quote_date: '2026-10-10'
    }),
    touchpoints: [
      T('q1', 'MARKETPLACE_CHAT', '2026-10-06T02:00:00Z', 'INBOUND', 'Tanya meja rapat'),
      T('q2', 'MARKETPLACE_CHAT', '2026-10-10T04:00:00Z', 'OUTBOUND', 'Kirim penawaran')
    ]
  },
  {
    id: 'gate-won-no-project',
    title: 'GAGAL: status WON tanpa project_id (tidak boleh jadi project karangan)',
    intent: 'gate',
    touchpoint_count: 2,
    lead: lead({
      lead_id: 'lead-contoh-gate4',
      source: 'PARTNER',
      status: 'WON',
      contact_name: 'Contoh Klien Gate 4',
      contact_phone: '081200000077',
      need_summary: 'Fit out kantor kecil',
      qualification_basis: 'PHONE_CALL',
      quote_ref: 'RAB/CONTOH/055',
      quote_value: 42000000,
      quote_date: '2026-10-09',
      customer_id: 'cust-contoh-0003',
      project_id: null,
      won_at: '2026-10-11T02:00:00Z',
      confirmed_by: 'u-contoh-admin'
    }),
    touchpoints: [
      T('n1', 'PHONE', '2026-10-07T02:00:00Z', 'INBOUND', 'Telepon minta penawaran'),
      T('n2', 'EMAIL', '2026-10-09T03:00:00Z', 'OUTBOUND', 'Kirim penawaran')
    ]
  },
  {
    id: 'invalid-source',
    title: 'GAGAL: sumber lead di luar taksonomi ("instagram ads")',
    intent: 'invalid',
    touchpoint_count: 0,
    lead: lead({
      lead_id: 'lead-contoh-bad1',
      source: 'instagram ads',
      status: 'NEW',
      contact_name: 'Contoh Klien Bad 1',
      contact_phone: '081200000088'
    }),
    touchpoints: []
  },
  {
    id: 'invalid-no-contact',
    title: 'GAGAL: tidak ada telepon maupun email yang valid (lead tidak bisa dihubungi)',
    intent: 'invalid',
    touchpoint_count: 0,
    lead: lead({
      lead_id: 'lead-contoh-bad2',
      source: 'EVENT',
      status: 'NEW',
      contact_name: 'Contoh Klien Bad 2',
      contact_phone: '12',
      contact_email: 'bukan-email'
    }),
    touchpoints: []
  },
  {
    id: 'invalid-unknown-field',
    title: 'PERINGATAN: field di luar kontrak (mencegah "tambah kolom diam-diam")',
    intent: 'invalid',
    touchpoint_count: 1,
    lead: lead({
      lead_id: 'lead-contoh-warn1',
      source: 'OUTBOUND',
      status: 'CONTACTED',
      contact_name: 'Contoh Klien Warn',
      contact_phone: '081200000099',
      // Field yang TIDAK ada di kontrak — hanya boleh lewat perubahan kontrak.
      lead_score: 87,
      komisi_persen: 2.5
    }),
    touchpoints: [T('u1', 'PHONE', '2026-10-05T02:00:00Z', 'OUTBOUND', 'Cold call (pencarian aktif, bukan iklan)')]
  }
])

export const SAMPLE_IDS = Object.freeze(SAMPLES.map(s => s.id))

export function sampleIds() { return [...SAMPLE_IDS] }

export function sampleById(id) {
  const key = String(id || '').trim().toLowerCase()
  if (!key) return null
  return SAMPLES.find(s => s.id === key) || null
}

// Rangkuman untuk CLI/endpoint: tidak pernah memuat data pelanggan nyata.
export function samplesMeta() {
  return SAMPLES.map(s => ({ id: s.id, title: s.title, intent: s.intent, touchpoint_count: s.touchpoint_count || 0 }))
}
