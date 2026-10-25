// ============================================================
// UJI FUNGSI MURNI — modules/marketing/logic.js (t_31a1a9f9)
// Fokus: kejujuran data. Yang tidak ada harus null / label jujur,
// BUKAN 0 atau string kosong yang terbaca seperti "tidak masalah".
// ============================================================
import {
  readLeads,
  mergeLeads,
  filterLeads,
  summarizeLeads,
  leadCapability,
  leadSource,
  leadCampaign,
  nextActionText,
  nextActionDate,
  nextActionDue,
  parseDateOrNull,
  formatDateId,
  customerLink,
  customerLinkText,
  leadKey,
  leadRowKey,
  leadStage,
  stageLabel,
  stageSelectOptions,
  normalizeStage,
  isKnownStage,
  stageCounts,
  sourceOptions,
  campaignOptions,
  validateLead,
  findDuplicateLead,
  emptyForm,
  LEAD_FIELDS,
  STAGE_BUCKETS,
  DATA_LIMITATIONS,
  CAPABILITY,
  LINK_STATE,
  toCsv,
  UNAVAILABLE_LABEL,
  DRAFT_LABEL,
  EMPTY_LABEL,
  NEXT_ACTION_UNKNOWN,
  CRM_LINK_UNKNOWN,
  STAGE_UNKNOWN_LABEL
} from './modules/marketing/logic.mjs'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

console.log('\n[1] Capability sumber data — "tidak ada" bukan "kosong"')
check('undefined -> unavailable (tabel/RLS belum ada)', leadCapability(undefined) === CAPABILITY.UNAVAILABLE)
check('null -> unavailable', leadCapability(null) === CAPABILITY.UNAVAILABLE)
check('string -> unavailable (bukan array)', leadCapability('x') === CAPABILITY.UNAVAILABLE)
check('{} -> unavailable', leadCapability({}) === CAPABILITY.UNAVAILABLE)
check('[] -> empty (tabel terbaca, kosong)', leadCapability([]) === CAPABILITY.EMPTY)
check('[{name}] -> ready', leadCapability([{ name: 'A' }]) === CAPABILITY.READY)
check('label kosong menyebut "Belum ada lead terdata"', EMPTY_LABEL === 'Belum ada lead terdata')
check('label nilai kosong menyebut "Tidak tersedia"', UNAVAILABLE_LABEL === 'Tidak tersedia')
check('label draf memakai "Draf halaman"', DRAFT_LABEL === 'Draf halaman')

console.log('\n[2] Normalisasi tahap — yang asing TIDAK dipaksa New Lead')
check('new_lead dikenal', normalizeStage('new_lead') === 'new_lead')
check('"New Lead" (spasi/kapital) dikenal', normalizeStage('New Lead') === 'new_lead')
check('"Qualified" dikenal', normalizeStage('Qualified') === 'qualified')
check('"RAB" dikenal', normalizeStage('rab') === 'rab')
check('alias quotation -> rab', normalizeStage('quotation') === 'rab')
check('alias deal -> won', normalizeStage('deal') === 'won')
check('alias closed_lost -> lost', normalizeStage('closed_lost') === 'lost')
check('alias kualifikasi -> qualified', normalizeStage('kualifikasi') === 'qualified')
check('tahap asing -> null (BUKAN new_lead)', normalizeStage('negoriasi') === null, String(normalizeStage('negoriasi')))
check('tahap kosong -> null', normalizeStage('') === null)
check('tahap null -> null', normalizeStage(null) === null)
check('isKnownStage true untuk tahap sah', isKnownStage('qualified') === true)
check('isKnownStage false untuk asing', isKnownStage('negoriasi') === false)
check('label tahap sah', stageLabel('qualified') === 'Qualified')
check('label tahap asing = "Tahap tidak diketahui"', stageLabel(null) === STAGE_UNKNOWN_LABEL)
check('label tahap kosong sama dengan asing', stageLabel('') === STAGE_UNKNOWN_LABEL)
check('opsi select hanya tahap sah', stageSelectOptions().length === 5 && stageSelectOptions().every(o => isKnownStage(o.value)))
check('ember papan = 5 tahap sah + 1 ember asing', STAGE_BUCKETS.length === 6)
check('ember asing bukan tahap sah', isKnownStage('unknown') === false)
check('tahap penutupan ditandai closed', STAGE_BUCKETS.filter(s => s.closed).map(s => s.key).join() === 'won,lost')

console.log('\n[3] Baca baris lead — beberapa bentuk field')
const rows = readLeads([
  { id: 'l1', name: 'Ibu Sarah', stage: 'new_lead', source: 'Instagram', campaign: 'Promo Lebaran', next_action: 'Kirim penawaran', next_action_date: '2026-10-20', customer_id: 'c1', notes: 'Butuh 3 lemari' },
  { id: 'l2', customer_name: 'Pak Budi', tahap: 'qualified', sumber: 'Referral', kampanye: '', aksi_berikutnya: 'Telpon', tanggal_aksi: '2026-10-01' },
  { id: 'l3', lead_name: 'Ani', status: 'negoriasi' },
  { stage: 'won' },                // tanpa nama sama sekali -> dibuang
  { name: '   ' },                 // nama kosong -> dibuang
  { name: 'Draf Sendiri', id: 'd1', origin: 'draft' }  // draf: ikut terhitung
])
check('4 baris bernama (tanpa nama dibuang)', rows.length === 4, String(rows.length))
check('draf ikut terbaca host-lead test', rows.some(l => l.name === 'Draf Sendiri'))
check('field alternatif customer_name dibaca', rows[1].name === 'Pak Budi')
check('field alternatif tahap/sumber/kampanye dibaca', rows[1].stage === 'qualified' && rows[1].source === 'Referral' && rows[1].campaign === '')
check('tahap asing dipertahankan sebagai null (tidak jadi new_lead)', rows[2].stage === null, String(rows[2].stage))
check('lead bertahap asing tetap tampil (tidak dibuang)', rows.some(l => l.name === 'Ani'))
check('id string', rows[0].id === 'l1')
check('baris host ditandai origin host', rows.every(l => l.origin === 'host'))
check('non-array -> []', readLeads(null).length === 0)
check('id kosong dapat id turunan', readLeads([{ name: 'X' }])[0].id === 'mk-0')

console.log('\n[4] Nilai kosong — null/label, BUKAN string kosong / 0')
check('sumber kosong -> null (bukan "")', leadSource({ name: 'X', source: '   ' }) === null, JSON.stringify(leadSource({ name: 'X', source: '   ' })))
check('sumber rows[1] Referal terbaca', leadSource(rows[1]) === 'Referral')
check('sumber ada -> string', leadSource(rows[0]) === 'Instagram')
check('sumber null -> null', leadSource({}) === null)
check('kampanye kosong -> null (bukan "")', leadCampaign(rows[1]) === null)
check('kampanye ada -> string', leadCampaign(rows[0]) === 'Promo Lebaran')
check('aksi berikutnya kosong -> null (bukan "")', nextActionText({ name: 'X' }) === null)
check('aksi berikutnya ada -> string', nextActionText(rows[0]) === 'Kirim penawaran')
check('label aksi kosong menyebut "Belum ada aksi berikutnya"', NEXT_ACTION_UNKNOWN === 'Belum ada aksi berikutnya')
check('tanggal aksi kosong -> null (bukan 1970)', nextActionDate({ name: 'X' }) === null)
check('parseDateOrNull kosong -> null', parseDateOrNull('') === null)
check('parseDateOrNull sampah -> null (bukan Invalid Date)', parseDateOrNull('bukan tanggal') === null)
check('format tanggal kosong -> null', formatDateId('') === null)
check('format tanggal ISO -> "20 Okt 2026"', formatDateId('2026-10-20') === '20 Okt 2026', String(formatDateId('2026-10-20')))

console.log('\n[5] Tanggal — parsing lokal, tidak bergeser hari')
{
  const d = parseDateOrNull('2026-10-20')
  check('YYYY-MM-DD dibaca sebagai tanggal lokal (hari 20, bukan 19/21)', d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 20, String(d))
}
check('tanggal sudah lewat -> overdue', nextActionDue({ next_action_date: '2026-10-01' }, '2026-10-18') === 'overdue')
check('tanggal hari ini -> today', nextActionDue({ next_action_date: '2026-10-18' }, '2026-10-18') === 'today')
check('tanggal mendatang -> later', nextActionDue({ next_action_date: '2026-10-25' }, '2026-10-18') === 'later')
check('tanpa tanggal -> none (bukan overdue)', nextActionDue({ name: 'X' }, '2026-10-18') === 'none')
check('perbandingan hari memakai hari lokal, bukan jam', nextActionDue({ next_action_date: '2026-10-18' }, new Date(2026, 9, 18, 23, 59)) === 'today')

console.log('\n[6] Tautan CRM — 4 keadaan berbeda maknanya')
const CRM = [{ id: 'c1', name: 'Ibu Sarah' }, { id: 'c2', name: 'Pak Budi' }]
check('linked: customer_id ada & ditemukan', customerLink({ customer_id: 'c1' }, CRM).state === LINK_STATE.LINKED)
check('linked: teks memakai nama customer', customerLink({ customer_id: 'c1' }, CRM).text === 'CRM: Ibu Sarah')
check('missing: customer_id kosong', customerLink({ customer_id: 'c1'.slice(0, 0) }, CRM).state === LINK_STATE.MISSING)
check('missing: teks "Belum ditautkan ke CRM"', customerLink({}, CRM).text === 'Belum ditautkan ke CRM')
check('unresolved: customer_id ada tapi tak ada di data CRM', customerLink({ customer_id: 'c9' }, CRM).state === LINK_STATE.UNRESOLVED)
check('unresolved: teks menyebut tidak ditemukan di data CRM', /tidak ditemukan di data CRM/.test(customerLink({ customer_id: 'c9' }, CRM).text))
check('unknown: host TIDAK mengirim data CRM', customerLink({ customer_id: 'c1' }, undefined).state === LINK_STATE.UNKNOWN)
check('unknown: teks = "data customer CRM tidak dikirim" (BUKAN "tidak ditemukan")',
  customerLink({ customer_id: 'c1' }, undefined).text === CRM_LINK_UNKNOWN, customerLink({ customer_id: 'c1' }, undefined).text)
check('unknown: host mengirim null juga unknown', customerLink({ customer_id: 'c1' }, null).state === LINK_STATE.UNKNOWN)
check('unknown: id kosong tetap missing (lebih spesifik)', customerLink({ customer_id: '' }, undefined).state === LINK_STATE.MISSING)
check('customerLinkText konsisten dengan customerLink', customerLinkText({ customer_id: 'c2' }, CRM) === 'CRM: Pak Budi')
check('teks unknown tidak memuat kata "tidak ditemukan"', !/tidak ditemukan/.test(CRM_LINK_UNKNOWN))

console.log('\n[7] Hitungan pipeline — jujur, ember asing terpisah')
const pool = [
  { id: 'a', name: 'Sarah', stage: 'new_lead', source: 'Instagram' },
  { id: 'b', name: 'Budi', stage: 'qualified' },
  { id: 'c', name: 'Ani', stage: 'negoriasi' },
  { id: 'd', name: 'Dedi', stage: 'won' },
  { id: 'e', name: 'Eka', stage: 'lost' }
]
const c = stageCounts(pool)
check('5 tahap sah dihitung', c.new_lead === 1 && c.qualified === 1 && c.won === 1 && c.lost === 1)
check('tahap asing masuk ember unknown (bukan new_lead)', c.unknown === 1, String(c.unknown))
check('new_lead tidak terpengaruh tahap asing', c.new_lead === 1)
const sum = summarizeLeads(pool, '2026-10-18')
check('total = 5', sum.total === 5)
check('terbuka = 2 (new_lead + qualified)', sum.open === 2, String(sum.open))
check('tertutup = 2 (won + lost)', sum.closed === 2)
check('unknown = 1 (tidak disembunyikan)', sum.unknown === 1)
check('ringkasan array kosong = semua 0', summarizeLeads([]).total === 0)
check('ringkasan non-array tidak melempar', summarizeLeads(null).total === 0)

console.log('\n[8] Aksi berikutnya & keterlambatan di ringkasan')
const actPool = [
  { name: 'A', next_action: 'Telpon', next_action_date: '2026-10-01' },
  { name: 'B', next_action: 'Surat', next_action_date: '2026-10-30' },
  { name: 'C' },
  { name: 'D', next_action: 'Datang' }
]
const s2 = summarizeLeads(actPool, '2026-10-18')
check('punya aksi = 3', s2.withNextAction === 3, String(s2.withNextAction))
check('belum ada aksi = 1 (tidak disembunyikan)', s2.noNextAction === 1)
check('terlambat = 1', s2.overdue === 1, String(s2.overdue))

console.log('\n[9] Filter')
check('cari nama (case-insensitive)', filterLeads({ leads: pool, query: 'SARAH' }).length === 1)
check('cari menemukan lead tahap asing', filterLeads({ leads: pool, query: 'ani' }).length === 1)
check('filter tahap asing (unknown) menemukannya', filterLeads({ leads: pool, stage: 'unknown' }).map(l => l.id).join() === 'c')
check('filter tahap asing tidak mencampur new_lead', !filterLeads({ leads: pool, stage: 'unknown' }).some(l => l.id === 'a'))
check('filter sumber', filterLeads({ leads: pool, source: 'Instagram' }).map(l => l.id).join() === 'a')
check('filter sumber all -> semua', filterLeads({ leads: pool, source: 'all' }).length === 5)
check('query kosong -> semua', filterLeads({ leads: pool, query: '' }).length === 5)
check('tanpa hasil -> []', filterLeads({ leads: pool, query: 'zzz' }).length === 0)
check('sourceOptions unik & urut', JSON.stringify(sourceOptions(pool)) === JSON.stringify(['Instagram']))
check('campaignOptions unik & urut', JSON.stringify(campaignOptions([
  { name: 'A', campaign: 'Zeta' }, { name: 'B', campaign: 'Alpha' }, { name: 'C', campaign: 'Zeta' }
])) === JSON.stringify(['Alpha', 'Zeta']))

console.log('\n[10] Gabung host + draf')
const merged = mergeLeads(
  [{ id: 'h1', name: 'Host A' }],
  [{ id: 'd1', name: 'Draf A' }]
)
check('2 baris', merged.length === 2)
check('host tetap origin host', merged[0].origin === 'host')
check('draf ditandai origin draft', merged[1].origin === 'draft')
check('draf tanpa id dapat id turunan', mergeLeads([], [{ name: 'X' }])[0].id === 'draft-0')
check('mergeLeads tanpa argumen tidak melempar', mergeLeads().length === 0)

console.log('\n[11] Key kartu — aman DOM & unik')
check('leadKey slug dari nama', leadKey({ name: 'Ibu Sarah' }) === 'ibu-sarah', leadKey({ name: 'Ibu Sarah' }))
check('leadKey nama tanpa huruf -> pakai id', leadKey({ name: '***', id: 'L-9' }) === 'l-9')
check('leadRowKey unik walau nama kembar',
  leadRowKey({ name: 'Ani', id: 'a1' }) !== leadRowKey({ name: 'Ani', id: 'a2' }))
check('leadRowKey tanpa id tetap unik beda nama',
  leadRowKey({ name: 'Ani' }) !== leadRowKey({ name: 'Budi' }))

console.log('\n[12] Validasi form')
check('nama kosong -> error', validateLead(emptyForm()).ok === false)
check('nama 1 karakter -> error', validateLead({ name: 'A' }).ok === false)
check('nama valid -> ok', validateLead({ name: 'Sarah' }).ok === true)
check('tahap asing -> DITOLAK (tidak dibuang diam-diam)', validateLead({ name: 'Sarah', stage: 'negoriasi' }).ok === false)
check('tahap sah -> ok', validateLead({ name: 'Sarah', stage: 'qualified' }).ok === true)
check('tahap kosong -> ok (dipakai default new_lead)', validateLead({ name: 'Sarah', stage: '' }).ok === true)
check('tanggal aksi salah format -> error', validateLead({ name: 'Sarah', next_action_date: 'bukan' }).ok === false)
check('tanggal aksi benar -> ok', validateLead({ name: 'Sarah', next_action_date: '2026-10-20' }).ok === true)
check('nama duplikat -> WARNING (bukan error/blokir)',
  validateLead({ name: 'Sarah' }, { existing: [{ id: 'z', name: 'sarah' }] }).warnings.length === 1)
check('nama duplikat tetap lolos submit', validateLead({ name: 'Sarah' }, { existing: [{ id: 'z', name: 'sarah' }] }).ok === true)
check('findDuplicateLead case-insensitive', !!findDuplicateLead([{ id: 'z', name: 'Sarah' }], { name: 'sarah' }))
check('edit baris sendiri bukan duplikat', findDuplicateLead([{ id: 'z', name: 'Sarah' }], { name: 'Sarah' }, 'z') === null)
check('emptyForm punya tahap default new_lead', emptyForm().stage === 'new_lead')
check('LEAD_FIELDS punya nama & tahap', LEAD_FIELDS.some(f => f.key === 'name' && f.required) && LEAD_FIELDS.some(f => f.key === 'stage'))
check('LEAD_FIELDS tidak ada field id palsu', !LEAD_FIELDS.some(f => f.key === 'id'))
check('DATA_LIMITATIONS menyebut tidak ada penulisan DB',
  DATA_LIMITATIONS.some(l => /penulisan ke database/i.test(l)))

console.log('\n[13] Ekspor CSV')
const csv = toCsv([
  { name: 'Sarah "Ibu"', stage: 'new_lead', source: 'IG', campaign: 'Promo', next_action: 'Telpon', next_action_date: '2026-10-20', customer_id: 'c1', notes: 'Cat, "cepat"', origin: 'host' },
  { name: 'Draf', stage: null, origin: 'draft' }
])
const lines = csv.split('\n')
check('header + 2 baris', lines.length === 3, String(lines.length))
check('header memuat kolom yang dijanjikan',
  /"Nama lead","Tahap","Sumber","Kampanye","Aksi berikutnya","Tanggal aksi","ID customer CRM","Catatan","Asal data"/.test(csv))
check('kutip ganda di-escape', csv.includes('"Sarah ""Ibu"""'))
check('baris draft ditandai draf memori halaman', csv.includes('"draf memori halaman"'))
check('baris host ditandai data yang dikirim host', csv.includes('"data yang dikirim host"'))
check('tahap asing ditulis "Tahap tidak diketahui" (bukan sel kosong)', csv.includes('"Tahap tidak diketahui"'))
check('field kosong tetap kolom (tidak melipat baris)',
  lines[2].split('","').length === 9, lines[2])
check('CSV tidak menambah tanda kutip liar', csv.split('\n').every(l => (l.match(/"/g) || []).length % 2 === 0))

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
