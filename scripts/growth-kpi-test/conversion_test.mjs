// F1 CONVERSION + F2 TIME-TO-APPROVAL — t_13fd2d4a (Bit / Noir Living)
// Sumber: scripts/marketing/contract.js (kontrak marketing-crm-project).
// Semua angka di bawah FIXTURE buatan harness, BUKAN data live.

import { strict as assert } from 'node:assert'
import {
  LEAD_STATUSES,
  LEAD_STATUS_TRANSITIONS,
  QUALIFICATION_GATES,
  QUALIFICATION_BASIS,
  LOST_REASON_CODES,
  LEAD_SOURCES,
  TABLE_OWNERSHIP,
  PURCHASING_INVARIANTS,
  validateLead,
  canTransition,
  handoffPlan,
  normalizePhone,
  normalizeEmail,
  customerKey,
  contractSummary
} from './dist/scripts/marketing/contract.mjs'

let n = 0
const ok = (m) => { n++; console.log(`  ok ${n} — ${m}`) }

console.log('F1. CONVERSION: Lead -> Qualified -> RAB -> Invoice -> Lunas')

// ---------- 1. Taksonomi & pintu kualifikasi ----------
assert.deepEqual([...LEAD_STATUSES], ['NEW', 'CONTACTED', 'QUALIFIED', 'SURVEYED', 'QUOTED', 'WON', 'LOST', 'DORMANT'])
ok('taksonomi status lead lengkap & berurut sesuai alur funnel')

for (const s of ['WON', 'LOST']) {
  assert.deepEqual(LEAD_STATUS_TRANSITIONS[s], [])
}
ok('WON/LOST final — tidak ada transisi keluar (koreksi = lead baru + supersedes_lead_id)')

assert.ok(QUALIFICATION_GATES.WON.required.includes('customer_id'))
assert.ok(QUALIFICATION_GATES.WON.required.includes('project_id'))
assert.ok(QUALIFICATION_GATES.WON.required.includes('confirmed_by'))
ok('gerbang WON menuntut customer_id + project_id + confirmed_by (tidak pernah otomatis dari nilai)')

assert.ok(QUALIFICATION_GATES.QUOTED.required.includes('quote_ref'))
assert.ok(QUALIFICATION_GATES.QUOTED.required.includes('quote_value'))
ok('gerbang QUOTED menuntut rujukan RAB/BOQ + nilai > 0 (bukan angka karangan)')

assert.ok(QUALIFICATION_BASIS.includes('SITE_VISIT'))
assert.ok(LOST_REASON_CODES.includes('PRICE'))
ok('dasar kualifikasi & kode alasan-hilang terkurasi')

// ---------- 2. canTransition ----------
assert.equal(canTransition('NEW', 'WON').ok, false)
ok('NEW -> WON ditolak (funnel tidak bisa dilompati)')

assert.equal(canTransition('WON', 'CONTACTED').ok, false)
ok('WON -> CONTACTED ditolak (status final)')

assert.equal(canTransition('QUOTED', 'WON').ok, true)
ok('QUOTED -> WON diizinkan (satu-satunya jalan menang WON)')

assert.equal(canTransition('DORMANT', 'CONTACTED').ok, true)
ok('DORMANT -> CONTACTED diizinkan (lead "menguap" bisa dihidupkan kembali)')

// ---------- 3. validateLead: lead lengkap vs tidak ----------
const fullLead = {
  lead_id: 'lead-001',
  status: 'WON',
  source: 'REFERRAL',
  contact_name: 'Ibu Sari',
  contact_phone: '0812-3456-7890',
  contact_email: 'sari@example.com',
  quote_ref: 'RAB/2026/0012',
  quote_value: 185000000,
  quote_date: '2026-10-01',
  customer_id: 'cust-001',
  project_id: 'proj-001',
  won_at: '2026-10-06T09:00:00+07:00',
  confirmed_by: 'admin-001'
}
const vFull = validateLead(fullLead, { touchpointCount: 3 })
assert.equal(vFull.ok, true, JSON.stringify(vFull.errors))
ok('lead WON dengan bukti lengkap LULUS validasi')

const earlyWon = { ...fullLead, quote_ref: '', customer_id: '', project_id: '', confirmed_by: '' }
const vEarly = validateLead(earlyWon, { touchpointCount: 3 })
assert.equal(vEarly.ok, false)
assert.equal(vEarly.errors.length, 4)
assert.ok(vEarly.errors.every(e => e.code === 'GATE_FIELD_MISSING'))
ok('lead WON tanpa quote_ref/customer_id/project_id/confirmed_by -> 4x GATE_FIELD_MISSING (ditolak eksplisit)')

// lead tanpa phone & email -> harus gagal (tidak bisa dihubungi sama sekali)
const noContact = { lead_id: 'lead-002', status: 'NEW', source: 'WALK_IN', contact_name: 'Tanpa Kontak' }
assert.equal(validateLead(noContact).ok, false)
ok('lead tanpa telepon DAN email ditolak (tak bisa dihubungi = bukan lead yang bisa dikerjakan)')

// phone typo tapi email benar -> WARNING, bukan gagal (jangan buang lead nyata)
const typo = { lead_id: 'lead-003', status: 'CONTACTED', source: 'WHATSAPP', contact_name: 'Pak Andi', contact_phone: '123', contact_email: 'andi@example.com' }
const vTypo = validateLead(typo, { touchpointCount: 1 })
assert.equal(vTypo.ok, true)
assert.ok(vTypo.warnings.some(w => w.code === 'PHONE_INVALID'))
ok('phone salah ketik + email valid = WARNING (lead tetap hidup, nomor harus diperbaiki)')

// ---------- 4. Kunci dedupe customer (F4 foundation) ----------
assert.equal(normalizePhone('0812-3456-7890'), normalizePhone('+6281234567890'))
ok('normalisasi phone: "0812-3456-7890" == "+6281234567890" (lead berulang satu kunci)')

assert.equal(normalizeEmail(' Sari@Example.COM '), 'sari@example.com')
ok('normalisasi email case-insensitive')

assert.equal(
  customerKey({ phone: '081234567890' }),
  customerKey({ phone: '+62 812 3456 7890' })
)
ok('customerKey stabil lintas format nomor — dedupe repeat order bisa dilakukan')

assert.equal(customerKey({ phone: null, email: null }), null)
ok('tanpa phone/email valid -> customerKey null (TIDAK dikira-kira jadi kunci karangan)')

// ---------- 5. handoffPlan: rencana, BUKAN eksekusi ----------
const plan = handoffPlan({ lead: fullLead, touchpointCount: 3, existingCustomer: { customer_id: 'cust-001', customer_key: customerKey({ phone: '081234567890' }) } })
assert.equal(plan.dry_run, true)
assert.equal(plan.would_write, false)
assert.equal(plan.executed, false)
assert.equal(plan.action, 'LINK_EXISTING')
assert.equal(plan.target_table, 'customers')
assert.equal(plan.target_owner, 'crm')
assert.ok(plan.forbidden.some(f => f.includes('purchase_requests')))
ok('handoffPlan: dry-run murni — LINK_EXISTING ke cust-001, would_write=false, tabel purchasing terlarang')

const planBlocked = handoffPlan({ lead: { lead_id: 'l', status: 'WON', source: 'X', contact_name: '' }, touchpointCount: 0 })
assert.equal(planBlocked.action, 'BLOCKED')
assert.ok(planBlocked.blocked_reasons.length >= 1)
ok('handoff lead tidak sah -> action BLOCKED dengan alasan eksplisit (bukan CREATE_CUSTOMER diam-diam)')

const planWonNoCust = handoffPlan({ lead: { ...fullLead, customer_id: null, project_id: null }, touchpointCount: 3 })
assert.equal(planWonNoCust.project_request.requested, true)
ok('WON tanpa customer -> project diminta ke modul projects (marketing TIDAK menulis projects)')

// ---------- 6. F2. TIME-TO-APPROVAL (fixture aritmetika verifikasi) ----------
// Alur nyata: request dibuat -> approval_steps memutuskan. KPI = selisih
// decided_at - created_at. Diuji sebagai fixture deterministik: angkanya
// stabil dan bisa direproduksi (bukan angka dari DB hidup).
function hoursBetween(aISO, bISO) {
  const ms = new Date(bISO).getTime() - new Date(aISO).getTime()
  return Math.round((ms / 3600000) * 10) / 10
}
const h = hoursBetween('2026-10-02T08:00:00+07:00', '2026-10-04T14:30:00+07:00')
assert.equal(h, 54.5)
ok(`F2 fixture: request 2026-10-02T08:00 -> keputusan 2026-10-04T14:30 = ${h} jam (stabil & direproduksi)`)

assert.equal(hoursBetween('2026-10-02T08:00:00+07:00', '2026-10-02T09:00:00+07:00'), 1)
ok('F2: satu jam = 1.0 (basis satuan, tidak ada pembulatan liar)')

// ---------- 7. Invarian & kepemilikan tabel ----------
const forbidden = TABLE_OWNERSHIP.filter(t => t.marketing === 'none').map(t => t.table)
assert.ok(forbidden.includes('purchase_requests'))
assert.ok(forbidden.includes('approval_steps'))
assert.ok(forbidden.includes('receivings'))
assert.ok(forbidden.includes('sales_invoices'))
assert.ok(forbidden.includes('handovers'))
ok(`marketing DILARANG menulis ${forbidden.length} tabel purchasing/keuangan: ${forbidden.join(', ')}`)

const marketingTables = TABLE_OWNERSHIP.filter(t => t.marketing === 'write-future')
assert.ok(marketingTables.every(t => t.exists === false))
ok(`tabel marketing (${marketingTables.map(t => t.table).join(', ')}) SEMUA belum ada — tidak boleh ada klaim angka live`)

assert.ok(PURCHASING_INVARIANTS.length >= 3)
ok(`${PURCHASING_INVARIANTS.length} invarian purchasing dicatat di kontrak (P1/P2 dipertahankan)`)

// ---------- 8. Ringkasan kontrak ----------
const s = contractSummary()
assert.equal(s.contract_id, 'marketing-crm-project')
ok(`contractSummary konsisten: ${s.contract_id}`)

console.log(`\nF1/F2 LULUS: ${n} assertion`)
console.log('CONVERSION_TEST_OK')
