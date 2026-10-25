// ============================================================
// scripts/marketing-test/contract_test.mjs — A. KONTRAK MURNI
// ============================================================
// Membuktikan (tanpa DB, tanpa jaringan):
//   A1. taksonomi sumber lead tetap & tertutup;
//   A2. mesin status: transisi yang diizinkan/ditolak, status final;
//   A3. gerbang bukti kualifikasi: status tanpa bukti DITOLAK (bukan diloloskan);
//   A4. normalisasi kontak & kunci dedupe (nama tidak pernah cukup);
//   A5. rencana handoff: CREATE / LINK / BLOCKED, dan SELALU would_write=false;
//   A6. atribusi: UTM, model, pembekuan saat WON;
//   A7. contoh dry-run: fixture sesuai maksud (valid/gate/invalid);
//   A8. input TIDAK dimutasi (kontrak murni, read-only);
//   A9. kepemilikan tabel & invarian purchasing tercantum lengkap;
//   A10. ringkasan kontrak konsisten dengan katalog (tidak ada drift).
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const DIR = path.resolve(HERE, '..', 'marketing')
const C = await import(pathToFileURL(path.join(DIR, 'contract.js')).href)
const S = await import(pathToFileURL(path.join(DIR, 'samples.js')).href)

let pass = 0
let fail = 0
const failures = []
function ok(no, name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok ${no} ${name}`) }
  else { fail++; failures.push(`${no} ${name}`); console.log(`  FAIL ${no} ${name} ${extra}`) }
}
function eq(no, name, expected, actual) {
  const a = JSON.stringify(expected)
  const b = JSON.stringify(actual)
  ok(no, name, a === b, `| expected=${a} actual=${b}`)
}
const clone = v => JSON.parse(JSON.stringify(v))

function baseLead(over = {}) {
  return {
    lead_id: 'lead-uji',
    source: 'INSTAGRAM',
    status: 'NEW',
    contact_name: 'Uji Klien',
    contact_phone: '0812-0000-0001',
    created_at: '2026-10-01T00:00:00Z',
    ...over
  }
}

console.log('\n=== A. KONTRAK MURNI (MARKETING → CRM/PROJECT) ===')

// ---------- A1. Taksonomi sumber lead ----------
{
  ok('A1a', 'ada taksonomi sumber lead', Array.isArray(C.LEAD_SOURCES) && C.LEAD_SOURCES.length >= 8, String(C.LEAD_SOURCES.length))
  ok('A1b', 'semua sumber berupa string KAPITAL (enum, bukan teks bebas)',
    C.LEAD_SOURCES.every(s => typeof s === 'string' && s === s.toUpperCase() && /^[A-Z_]+$/.test(s)))
  ok('A1c', 'tidak ada duplikat sumber', new Set(C.LEAD_SOURCES).size === C.LEAD_SOURCES.length)
  ok('A1d', 'sumber walk-in & referral ada (jalur tanpa kampanye tetap sah)',
    C.LEAD_SOURCES.includes('WALK_IN') && C.LEAD_SOURCES.includes('REFERRAL'))
  ok('A1e', 'sumber "instagram ads" TIDAK ada di taksonomi', !C.LEAD_SOURCES.includes('INSTAGRAM ADS'))
  const v = C.validateLead(baseLead({ source: 'instagram ads' }))
  ok('A1f', 'sumber di luar taksonomi ditolak', v.ok === false && v.errors.some(e => e.code === 'UNKNOWN_SOURCE'))
  ok('A1g', 'pesan penolakan menyebut pilihan yang sah', /WALK_IN/.test(JSON.stringify(v.errors)))
}

// ---------- A2. Mesin status ----------
{
  ok('A2a', 'status lead memuat NEW..WON..LOST', ['NEW', 'WON', 'LOST'].every(s => C.LEAD_STATUSES.includes(s)))
  eq('A2b', 'NEW → CONTACTED diizinkan', true, C.canTransition('NEW', 'CONTACTED').ok)
  eq('A2c', 'NEW → WON DITOLAK (tidak boleh lompat)', false, C.canTransition('NEW', 'WON').ok)
  eq('A2d', 'alasan penolakan berkode', 'TRANSITION_NOT_ALLOWED', C.canTransition('NEW', 'WON').code)
  eq('A2e', 'WON final (tidak ada transisi keluar)', 0, C.LEAD_STATUS_TRANSITIONS.WON.length)
  eq('A2f', 'LOST final', 0, C.LEAD_STATUS_TRANSITIONS.LOST.length)
  eq('A2g', 'QUOTED → WON diizinkan', true, C.canTransition('QUOTED', 'WON').ok)
  eq('A2h', 'DORMANT → WON DITOLAK (harus lewat CONTACTED)', false, C.canTransition('DORMANT', 'WON').ok)
  eq('A2i', 'status asal tidak dikenal ditolak', 'UNKNOWN_FROM', C.canTransition('ENTAH', 'NEW').code)
  eq('A2j', 'status tujuan tidak dikenal ditolak', 'UNKNOWN_TO', C.canTransition('NEW', 'ENTAH').code)
  ok('A2k', 'semua transisi menunjuk status yang ada',
    Object.entries(C.LEAD_STATUS_TRANSITIONS).every(([, list]) => list.every(t => C.LEAD_STATUSES.includes(t))))
  ok('A2l', 'setiap status punya definisi gerbang', C.LEAD_STATUSES.every(s => !!C.QUALIFICATION_GATES[s]))
}

// ---------- A3. Gerbang bukti kualifikasi ----------
{
  const newLead = C.validateLead(baseLead())
  ok('A3a', 'NEW dengan kontak valid → LULUS', newLead.ok === true, JSON.stringify(newLead.errors))

  const contactedNoTp = C.validateLead(baseLead({ status: 'CONTACTED' }), { touchpointCount: 0 })
  ok('A3b', 'CONTACTED tanpa touchpoint → GAGAL', contactedNoTp.ok === false)
  ok('A3c', 'kode GATE_TOUCHPOINT_MISSING', contactedNoTp.errors.some(e => e.code === 'GATE_TOUCHPOINT_MISSING'))

  const contactedWithTp = C.validateLead(baseLead({ status: 'CONTACTED' }), { touchpointCount: 1 })
  ok('A3d', 'CONTACTED dengan 1 touchpoint → LULUS', contactedWithTp.ok === true, JSON.stringify(contactedWithTp.errors))

  const q = C.validateLead(baseLead({ status: 'QUALIFIED' }), { touchpointCount: 2 })
  ok('A3e', 'QUALIFIED tanpa need_summary/basis → GAGAL', q.ok === false)
  ok('A3f', 'kedua field dilaporkan kurang', q.errors.filter(e => e.code === 'GATE_FIELD_MISSING').length === 2)

  const qOk = C.validateLead(baseLead({
    status: 'QUALIFIED', need_summary: 'Kitchen set', qualification_basis: 'SITE_VISIT'
  }), { touchpointCount: 2 })
  ok('A3g', 'QUALIFIED lengkap → LULUS', qOk.ok === true, JSON.stringify(qOk.errors))

  const qBad = C.validateLead(baseLead({
    status: 'QUALIFIED', need_summary: 'Kitchen set', qualification_basis: 'KATANYA_ORANG'
  }), { touchpointCount: 1 })
  ok('A3h', 'dasar kualifikasi di luar enum ditolak', qBad.errors.some(e => e.code === 'QUALIFICATION_BASIS_INVALID'))

  const quotedZero = C.validateLead(baseLead({
    status: 'QUOTED', need_summary: 'x', qualification_basis: 'PHONE_CALL',
    quote_ref: 'RAB/1', quote_value: 0, quote_date: '2026-10-10'
  }), { touchpointCount: 1 })
  ok('A3i', 'QUOTED dengan nilai 0 → GAGAL', quotedZero.ok === false && quotedZero.errors.some(e => e.code === 'QUOTE_VALUE_INVALID'))

  const wonNoProj = C.validateLead(baseLead({
    status: 'WON', quote_ref: 'RAB/1', quote_value: 1000, quote_date: '2026-10-10',
    customer_id: 'c1', won_at: '2026-10-11T00:00:00Z', confirmed_by: 'u1'
  }), { touchpointCount: 1 })
  ok('A3j', 'WON tanpa project_id → GAGAL', wonNoProj.errors.some(e => e.code === 'GATE_FIELD_MISSING' && e.field === 'project_id'))

  const wonFull = C.validateLead(baseLead({
    status: 'WON', quote_ref: 'RAB/1', quote_value: 1000, quote_date: '2026-10-10',
    customer_id: 'c1', project_id: 'p1', won_at: '2026-10-11T00:00:00Z', confirmed_by: 'u1'
  }), { touchpointCount: 1 })
  ok('A3k', 'WON lengkap → LULUS', wonFull.ok === true, JSON.stringify(wonFull.errors))
  eq('A3l', 'WON menandai atribusi dibekukan', true, wonFull.attribution_frozen)

  const lostNoReason = C.validateLead(baseLead({ status: 'LOST', lost_at: '2026-10-11T00:00:00Z' }))
  ok('A3m', 'LOST tanpa kode alasan → GAGAL', lostNoReason.errors.some(e => e.code === 'GATE_FIELD_MISSING' && e.field === 'lost_reason_code'))

  const lostBadReason = C.validateLead(baseLead({ status: 'LOST', lost_at: '2026-10-11T00:00:00Z', lost_reason_code: 'MALES' }))
  ok('A3n', 'kode alasan di luar enum ditolak', lostBadReason.errors.some(e => e.code === 'LOST_REASON_INVALID'))

  const surveyedNoRef = C.validateLead(baseLead({ status: 'SURVEYED', survey_date: '2026-10-05' }), { touchpointCount: 1 })
  ok('A3o', 'SURVEYED tanpa survey_ref → GAGAL (tanggal saja tidak cukup)',
    surveyedNoRef.errors.some(e => e.code === 'GATE_FIELD_MISSING' && e.field === 'survey_ref'))

  const dormant = C.validateLead(baseLead({ status: 'DORMANT' }))
  ok('A3p', 'DORMANT tanpa last_contact_at → GAGAL', dormant.errors.some(e => e.code === 'GATE_FIELD_MISSING' && e.field === 'last_contact_at'))

  const badDate = C.validateLead(baseLead({
    status: 'SURVEYED', survey_date: '5 Oktober', survey_ref: 'S/1'
  }), { touchpointCount: 1 })
  ok('A3q', 'tanggal tidak ISO ditolak', badDate.errors.some(e => e.code === 'DATE_INVALID'))
}

// ---------- A4. Normalisasi kontak & dedupe ----------
{
  eq('A4a', '0812… → 62812…', '6281200000001', C.normalizePhone('0812-0000-0001'))
  eq('A4b', '+62 812 0000 0001 → 62812…', '6281200000001', C.normalizePhone('+62 812 0000 0001'))
  eq('A4c', '812… → 62812…', '6281200000001', C.normalizePhone('812 0000 0001'))
  eq('A4d', 'nomor terlalu pendek ditolak', null, C.normalizePhone('12345'))
  eq('A4e', 'kosong → null', null, C.normalizePhone(''))
  eq('A4f', 'email dinormalisasi lowercase', 'a@contoh.invalid', C.normalizeEmail('  A@Contoh.invalid '))
  eq('A4g', 'email tidak valid → null', null, C.normalizeEmail('bukan-email'))
  eq('A4h', 'kunci dedupe memakai telepon lebih dulu', 'phone:6281200000001',
    C.customerKey({ phone: '0812-0000-0001', email: 'a@contoh.invalid' }))
  eq('A4i', 'tanpa telepon → email', 'email:a@contoh.invalid', C.customerKey({ email: 'A@contoh.invalid' }))
  eq('A4j', 'tanpa kontak → null (tidak mengarang kunci)', null, C.customerKey({}))
  ok('A4k', 'nama tidak pernah dipakai sebagai kunci dedupe',
    !JSON.stringify(C.customerKey({ phone: '08120000001', email: 'a@contoh.invalid' })).includes('Uji Klien'))

  const noContact = C.validateLead(baseLead({ contact_phone: null, contact_email: null }))
  ok('A4l', 'lead tanpa kontak ditolak', noContact.errors.some(e => e.code === 'CONTACT_CHANNEL_REQUIRED'))
  const badPhoneGoodEmail = C.validateLead(baseLead({ contact_phone: '12', contact_email: 'ok@contoh.invalid' }))
  ok('A4m', 'telepon rusak tapi email sah → tetap LULUS (satu kanal cukup)',
    badPhoneGoodEmail.ok === false ? false : true, JSON.stringify(badPhoneGoodEmail.errors))
}

// ---------- A5. Rencana handoff ----------
{
  const lead = baseLead({ status: 'NEW' })
  const plan = C.handoffPlan({ lead, touchpointCount: 0 })
  eq('A5a', 'action CREATE_CUSTOMER bila belum ada di CRM', 'CREATE_CUSTOMER', plan.action)
  eq('A5b', 'would_write SELALU false', false, plan.would_write)
  eq('A5c', 'executed SELALU false', false, plan.executed)
  eq('A5d', 'target tabel = customers (milik CRM)', 'customers', plan.target_table)
  eq('A5e', 'target owner = crm', 'crm', plan.target_owner)
  ok('A5f', 'idempotency_key deterministik', plan.idempotency_key === `handoff:lead-uji:${plan.customer_key}`)
  eq('A5g', 'project request TIDAK dieksekusi marketing', false, plan.project_request.executed_by === 'marketing')
  eq('A5h', 'project request hanya untuk WON', false, plan.project_request.requested)

  const link = C.handoffPlan({ lead, existingCustomer: { customer_id: 'cust-1', customer_key: plan.customer_key } })
  eq('A5i', 'LINK_EXISTING bila CRM sudah punya kunci itu', 'LINK_EXISTING', link.action)

  const noKey = C.handoffPlan({ lead: baseLead({ contact_phone: '12', contact_email: null }) })
  eq('A5j', 'BLOCKED bila tidak ada kunci dedupe', 'BLOCKED', noKey.action)
  ok('A5k', 'alasan BLOCKED berkode', noKey.blocked_reasons.some(b => b.code === 'NO_DEDUPE_KEY'))

  const invalid = C.handoffPlan({ lead: baseLead({ source: 'ngawur' }) })
  eq('A5l', 'BLOCKED bila lead tidak sah', 'BLOCKED', invalid.action)

  const won = C.handoffPlan({
    lead: baseLead({
      status: 'WON', quote_ref: 'RAB/1', quote_value: 1000, quote_date: '2026-10-10',
      customer_id: 'c1', project_id: 'p1', won_at: '2026-10-11T00:00:00Z', confirmed_by: 'u1'
    }),
    touchpointCount: 1
  })
  eq('A5m', 'WON meminta project dibuat (oleh modul projects)', true, won.project_request.requested)
  eq('A5n', 'tetapi tetap tidak menulis', false, won.would_write)
  ok('A5o', 'larangan tertulis: tidak menyentuh tabel purchasing',
    won.forbidden.some(f => /purchase_requests/.test(f)))
  ok('A5p', 'larangan tertulis: tidak mengirim pesan',
    won.forbidden.some(f => /mengirim pesan/i.test(f)))
  ok('A5q', 'larangan tertulis: tidak membeli iklan',
    won.forbidden.some(f => /iklan|audience|pixel/i.test(f)))
}

// ---------- A6. Atribusi ----------
{
  eq('A6a', 'dua model atribusi', ['FIRST_TOUCH', 'LAST_TOUCH'], [...C.ATTRIBUTION_MODELS])
  ok('A6b', 'kunci UTM standar lengkap', ['utm_source', 'utm_medium', 'utm_campaign'].every(k => C.UTM_KEYS.includes(k)))
  eq('A6c', 'dibekukan saat WON', 'WON', C.ATTRIBUTION_FROZEN_AT)
  eq('A6d', 'UTM dinormalisasi lowercase', { utm_source: 'instagram' }, C.normalizeUtm({ utm_source: ' Instagram ' }))
  eq('A6e', 'kunci UTM asing dibuang', {}, C.normalizeUtm({ utm_foo: 'x' }))
  const v = C.validateLead(baseLead({ attribution: { model: 'LAST_TOUCH', utm: { utm_source: 'ig', utm_budget: '999' } } }))
  ok('A6f', 'kunci UTM tak dikenal → peringatan (bukan lolos diam-diam)',
    v.warnings.some(w => w.code === 'UTM_UNKNOWN_KEY'))
  const bad = C.validateLead(baseLead({ attribution: { model: 'MIDDLE' } }))
  ok('A6g', 'model atribusi tak dikenal ditolak', bad.errors.some(e => e.code === 'ATTRIBUTION_MODEL_INVALID'))
  const noAttr = C.validateLead(baseLead())
  ok('A6h', 'lead tanpa kampanye tetap sah, tetapi diberi peringatan atribusi',
    noAttr.ok === true && noAttr.warnings.some(w => w.code === 'ATTRIBUTION_MISSING'))
}

// ---------- A7. Contoh dry-run ----------
{
  ok('A7a', 'ada contoh dry-run', S.SAMPLES.length >= 8, String(S.SAMPLES.length))
  ok('A7b', 'semua contoh punya id unik', new Set(S.SAMPLES.map(s => s.id)).size === S.SAMPLES.length)
  ok('A7c', 'semua contoh ber-intent jelas', S.SAMPLES.every(s => ['valid', 'gate', 'invalid'].includes(s.intent)))
  ok('A7d', 'semua contoh berjudul', S.SAMPLES.every(s => typeof s.title === 'string' && s.title.length > 10))

  // Fixture harus berperilaku SESUAI maksudnya (kalau tidak, fixture menipu).
  for (const s of S.SAMPLES) {
    const v = C.validateLead(s.lead, { touchpointCount: s.touchpoint_count || 0 })
    if (s.intent === 'valid') ok(`A7-${s.id}`, `contoh valid benar-benar lulus`, v.ok === true, JSON.stringify(v.errors))
    else if (s.intent === 'gate') {
      ok(`A7-${s.id}`, 'contoh gate benar-benar gagal karena gerbang bukti',
        v.ok === false && v.errors.some(e => e.code.startsWith('GATE_') || e.code === 'QUOTE_VALUE_INVALID'),
        JSON.stringify(v.errors))
    } else {
      ok(`A7-${s.id}`, 'contoh invalid benar-benar bermasalah',
        v.ok === false || v.warnings.some(w => w.code === 'UNKNOWN_FIELD'),
        JSON.stringify({ e: v.errors, w: v.warnings }))
    }
  }

  // Nomor fiktif: semua nomor contoh yang VALID harus menormalisasi ke
  // 6281200000xxx (rentang karangan). Nomor yang sengaja rusak (fixture
  // invalid-no-contact) tidak bisa dinormalisasi — itu memang maksudnya.
  const normPhones = S.SAMPLES.map(s => C.normalizePhone(s.lead.contact_phone)).filter(Boolean)
  ok('A7e', 'semua nomor contoh yang valid berasal dari rentang fiktif 6281200000xxx',
    normPhones.length >= 6 && normPhones.every(p => p.startsWith('6281200000')),
    JSON.stringify(normPhones))
  ok('A7f', 'semua email contoh valid memakai TLD .invalid (tidak bisa ada)',
    S.SAMPLES.map(s => s.lead.contact_email).filter(Boolean).every(e => !C.normalizeEmail(e) || e.endsWith('.invalid')),
    JSON.stringify(S.SAMPLES.map(s => s.lead.contact_email).filter(Boolean)))
  eq('A7g', 'sampleById tidak peka huruf besar', 'valid-won-full', (S.sampleById('VALID-WON-FULL') || {}).id)
  eq('A7h', 'sampleById tidak dikenal → null', null, S.sampleById('tidak-ada'))
}

// ---------- A8. Kemurnian: input tidak dimutasi ----------
{
  const lead = baseLead({ attribution: { model: 'FIRST_TOUCH', utm: { utm_source: 'ig' } } })
  const before = clone(lead)
  C.validateLead(lead, { touchpointCount: 2 })
  C.handoffPlan({ lead, touchpointCount: 2 })
  eq('A8a', 'validateLead tidak mengubah input', before, lead)

  const sample = clone(S.SAMPLES[0])
  const beforeS = clone(sample)
  C.validateLead(sample.lead, { touchpointCount: sample.touchpoint_count })
  eq('A8b', 'validasi contoh tidak mengubah fixture', beforeS, sample)

  const summary = C.contractSummary()
  const summary2 = C.contractSummary()
  eq('A8c', 'contractSummary deterministik', summary, summary2)
  ok('A8d', 'contractSummary menandai dry_run & read_only', summary.dry_run === true && summary.read_only === true)
  eq('A8e', 'contractSummary menyatakan nol tulis', 0, summary.writes_in_this_layer)
  eq('A8f', 'contractSummary menyatakan no_public_send', true, summary.no_public_send)
  eq('A8g', 'contractSummary menyatakan no_paid_ads', true, summary.no_paid_ads)
  eq('A8h', 'contractSummary menyatakan no_cron', true, summary.no_cron)
}

// ---------- A9. Kepemilikan tabel & invarian purchasing ----------
{
  const t = Object.fromEntries(C.TABLE_OWNERSHIP.map(x => [x.table, x]))
  ok('A9a', 'projects hanya boleh DIBACA marketing', t.projects && t.projects.marketing === 'read')
  for (const table of ['purchase_requests', 'pr_items', 'approval_steps', 'receivings', 'receiving_items', 'handovers', 'sales_invoices']) {
    ok(`A9-${table}`, `${table} ditandai HARAM disentuh marketing`, t[table] && t[table].marketing === 'none', JSON.stringify(t[table]))
  }
  ok('A9b', 'customers dimiliki CRM, marketing hanya baca', t.customers && t.customers.owner === 'crm' && t.customers.marketing === 'read')
  ok('A9c', 'invarian purchasing ada 8 butir', C.PURCHASING_INVARIANTS.length === 8, String(C.PURCHASING_INVARIANTS.length))
  ok('A9d', 'setiap invarian punya id & cara pembuktian',
    C.PURCHASING_INVARIANTS.every(i => i.id && i.rule && i.enforced_by))
  ok('A9e', 'invarian P1 menyebut larangan tulis purchasing', /tidak menulis/i.test(C.PURCHASING_INVARIANTS[0].rule))
}

// ---------- A10. Konsistensi ringkasan vs katalog ----------
{
  const s = C.contractSummary()
  eq('A10a', 'jumlah sumber di ringkasan = katalog', C.LEAD_SOURCES.length, s.lead_sources.length)
  eq('A10b', 'jumlah status di ringkasan = katalog', C.LEAD_STATUSES.length, s.lead_statuses.length)
  eq('A10c', 'jumlah gerbang = jumlah status', C.LEAD_STATUSES.length, Object.keys(s.qualification_gates).length)
  eq('A10d', 'jumlah tabel = katalog kepemilikan', C.TABLE_OWNERSHIP.length, s.table_ownership.length)
  eq('A10e', 'skema lead memuat customer_id & project_id',
    true, ['customer_id', 'project_id'].every(n => s.entities.lead.some(f => f.name === n)))
  ok('A10f', 'skema lead tidak memuat field iklan berbayar',
    !s.entities.lead.some(f => /ad_spend|pixel|audience/i.test(f.name)),
    JSON.stringify(s.entities.lead.map(f => f.name)))
  ok('A10g', 'skema campaign menandai is_paid_media sebagai boolean',
    (s.entities.campaign.find(f => f.name === 'is_paid_media') || {}).type === 'boolean')
  eq('A10h', 'kontrak punya versi', 1, s.contract_version)
}

console.log(`\n  HASIL A: ${pass} LULUS, ${fail} GAGAL`)
if (fail) console.log('  gagal: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
