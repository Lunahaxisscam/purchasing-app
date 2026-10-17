// ============================================================
// UJI FUNGSI MURNI — modules/crm/logic.js (t_7253b859)
// Fokus: kejujuran data. Yang tidak ada harus null/"Tidak tersedia",
// BUKAN 0 atau string kosong yang terbaca seperti "tidak ada masalah".
// ============================================================
import {
  readCustomers,
  mergeCustomers,
  filterCustomers,
  summarizeCustomers,
  customerCapability,
  customerContact,
  customerSource,
  customerKey,
  customerLabel,
  normalizePhone,
  sourceOptions,
  relationCount,
  relationText,
  validateCustomer,
  findDuplicate,
  emptyForm,
  toCsv,
  UNAVAILABLE_LABEL,
  DRAFT_LABEL,
  SELECTOR_EMPTY_LABEL,
  RELATION_UNKNOWN
} from './modules/crm/logic.mjs'

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

console.log('\n[1] Capability sumber data — "tidak ada" bukan "kosong"')
check('undefined -> unavailable (tabel/RLS belum ada)', customerCapability(undefined) === 'unavailable')
check('null -> unavailable', customerCapability(null) === 'unavailable')
check('string -> unavailable (bukan array)', customerCapability('x') === 'unavailable')
check('[] -> empty (tabel terbaca, kosong)', customerCapability([]) === 'empty')
check('[{name}] -> ready', customerCapability([{ name: 'A' }]) === 'ready')
check('label "Belum ada customer terdata" ada', SELECTOR_EMPTY_LABEL === 'Belum ada customer terdata')

console.log('\n[2] Baca baris customer — beberapa bentuk field')
const rows = readCustomers([
  { id: 'c1', name: 'Ibu Sarah', phone: '0812-3456-789', email: 's@x.id', address: 'Jl. A 1', source: 'Instagram', notes: 'Butuh 3 lemari' },
  { id: 'c2', customer_name: 'Pak Budi', whatsapp: '6281234567890', alamat: 'Jl. B 2', sumber: 'Referral' },
  { id: 'c3', name: 'No Kontak' },
  { qty: 1, phone: '0800' },   // tanpa nama -> dibuang
  { name: '   ' }               // nama kosong -> dibuang
])
check('3 baris bernama (tanpa nama dibuang)', rows.length === 3, String(rows.length))
check('field alternatif customer_name/nama dibaca', rows[1].name === 'Pak Budi')
check('whatsapp -> phone', rows[1].phone === '6281234567890')
check('alamat -> address', rows[1].address === 'Jl. B 2')
check('sumber -> source', rows[1].source === 'Referral')
check('id string', rows[0].id === 'c1')
check('baris host ditandai origin host', rows.every(c => c.origin === 'host'))
check('non-array -> []', readCustomers(null).length === 0)
check('id kosong dapat id turunan', readCustomers([{ name: 'X' }])[0].id === 'crm-0')

console.log('\n[3] Kontak & sumber — "Tidak tersedia", bukan string kosong')
check('kontak WA dipakai dulu', customerContact(rows[0]) === '0812-3456-789')
check('kontak kosong -> null (BUKAN "")', customerContact(rows[2]) === null)
check('kontak email cadangan', customerContact({ email: 'a@b.c' }) === 'a@b.c')
check('kontak null -> null (bukan "0")', customerContact({}) === null)
check('sumber kosong -> null (bukan "")', customerSource(rows[2]) === null)
check('sumber ada -> string', customerSource(rows[1]) === 'Referral')
check('label kontak kosong menyebut Tidak tersedia',
  /kontak tidak tersedia/.test(customerLabel(rows[2])), customerLabel(rows[2]))
check('label kontak ada menyebut nomor', customerLabel(rows[0]) === 'Ibu Sarah — 0812-3456-789')
check('customerKey stabil & aman DOM', customerKey(rows[0]) === 'ibu-sarah', customerKey(rows[0]))
check('customerKey tanpa nama pakai id', customerKey({ id: 'c9' }) === 'c9')

console.log('\n[4] Normalisasi nomor WA')
check('62 -> 0', normalizePhone('6281234567890') === '081234567890')
check('tanda baca dibuang', normalizePhone('0812-3456-789') === '08123456789')
check('spasi dibuang', normalizePhone('0812 3456 789') === '08123456789')
check('kosong -> ""', normalizePhone('') === '')
check('null -> ""', normalizePhone(null) === '')
check('konsonisten: 62 & 0 hasil sama', normalizePhone('081234567890') === normalizePhone('6281234567890'))

console.log('\n[5] Pencarian — termasuk lewat nomor WA')
const pool = [
  { id: 'a', name: 'Sarah Wijaya', phone: '0812-3456-789', email: 's@x.id', address: 'Jl. Melati 3', source: 'Instagram' },
  { id: 'b', name: 'Budi Santoso', phone: '6281298765432', email: 'b@y.id', address: 'Jl. Kenanga', source: 'Referral' }
]
check('cari nama (case-insensitive)', filterCustomers({ customers: pool, query: 'SARAH' }).length === 1)
check('cari email', filterCustomers({ customers: pool, query: 'b@y.id' }).length === 1)
check('cari alamat', filterCustomers({ customers: pool, query: 'kenanga' }).length === 1)
check('cari nomor format pendek 0812-3456', filterCustomers({ customers: pool, query: '0812-3456' }).length === 1)
check('cari nomor format 62 menemukan baris 0', filterCustomers({ customers: pool, query: '6281298765432' }).length === 1,
  String(filterCustomers({ customers: pool, query: '6281298765432' }).length))
check('cari < 3 digit tidak cocok lewat nomor', filterCustomers({ customers: pool, query: '99' }).length === 0,
  String(filterCustomers({ customers: pool, query: '99' }).length))
check('cari >= 3 digit cocok lewat nomor 628', filterCustomers({ customers: pool, query: '6281298765432' }).length === 1,
  String(filterCustomers({ customers: pool, query: '6281298765432' }).length))
check('cari nomor format 62 ditemukan walau tak sama di teks',
  filterCustomers({ customers: pool, query: '62812987' }).length === 1)
check('cari format 0 & 62 hasil sama',
  filterCustomers({ customers: pool, query: '0812-3456' }).map(c => c.id).join() ===
  filterCustomers({ customers: pool, query: '628123456' }).map(c => c.id).join())
check('cari tanpa hasil -> []', filterCustomers({ customers: pool, query: 'zzz' }).length === 0)
check('filter sumber', filterCustomers({ customers: pool, source: 'Referral' }).map(c => c.id).join(',') === 'b')
check('filter sumber all -> semua', filterCustomers({ customers: pool, source: 'all' }).length === 2)
check('query kosong -> semua', filterCustomers({ customers: pool, query: '' }).length === 2)
check('sourceOptions unik & urut', JSON.stringify(sourceOptions(pool)) === JSON.stringify(['Instagram', 'Referral']))

console.log('\n[6] Ringkasan — hitungan jujur')
const sum = summarizeCustomers([
  { name: 'A', phone: '0812' },
  { name: 'B', email: 'b@x.id' },
  { name: 'C' },
  { name: 'D', source: 'Instagram' }
])
check('total = 4', sum.total === 4)
check('punya kontak = 2', sum.withContact === 2, String(sum.withContact))
check('tanpa kontak = 2 (tidak disembunyikan)', sum.withoutContact === 2)
check('jumlah sumber = 1', sum.sources === 1)
check('punya alamat = 0', sum.withAddress === 0)
check('ringkasan array kosong = semua 0', summarizeCustomers([]).total === 0)

console.log('\n[7] Validasi form')
check('nama kosong -> error', validateCustomer(emptyForm()).ok === false)
check('nama 1 karakter -> error', validateCustomer({ name: 'A' }).ok === false)
check('nama valid -> ok', validateCustomer({ name: 'Sarah' }).ok === true)
check('telepon terlalu pendek -> error', validateCustomer({ name: 'A B', phone: '0812' }).ok === false)
check('telepon panjang -> ok', validateCustomer({ name: 'A B', phone: '081234567890' }).ok === true)
check('telepon dengan tanda baca -> ok', validateCustomer({ name: 'A B', phone: '0812-3456-789' }).ok === true)
check('email salah format -> error', validateCustomer({ name: 'A B', email: 'bukan-email' }).ok === false)
check('email benar -> ok', validateCustomer({ name: 'A B', email: 'a@b.co' }).ok === true)
check('nama duplikat -> WARNING (bukan error/blokir)',
  validateCustomer({ name: 'Sarah' }, { existing: [{ id: 'z', name: 'sarah' }] }).warnings.length === 1)
check('nama duplikat tetap lolos submit', validateCustomer({ name: 'Sarah' }, { existing: [{ id: 'z', name: 'sarah' }] }).ok === true)
check('duplikat WA terdeteksi', !!findDuplicate([{ id: 'z', name: 'Lain', phone: '628123456789' }], { phone: '0812-3456-789' }))
check('edit baris sendiri bukan duplikat', findDuplicate([{ id: 'z', name: 'Sarah' }], { name: 'Sarah' }, 'z') === null)

console.log('\n[8] Relasi invoice — "tidak dikirim", BUKAN 0')
const COUNTS = { c1: 3, c2: 0 }
check('counts dikirim -> angka', relationCount('c1', COUNTS) === 3)
check('counts 0 (benar-benar 0 rujukan)', relationCount('c2', COUNTS) === 0)
check('customer tidak ada di counts -> null (bukan 0)', relationCount('c9', COUNTS) === null)
check('counts tidak dikirim -> null (BUKAN 0)', relationCount('c1', null) === null)
check('counts bukan object -> null', relationCount('c1', 'x') === null)
check('nilai non-angka -> null', relationCount('c1', { c1: 'abc' }) === null)
check('teks relasi: 3 invoice', relationText('c1', COUNTS) === 'Dirujuk di 3 invoice')
check('teks relasi: tidak dikirim', relationText('c1', null) === RELATION_UNKNOWN)
check('teks relasi: 0 rujukan tetap 0 (dikirim)', relationText('c2', COUNTS) === 'Dirujuk di 0 invoice')

console.log('\n[9] Gabung host + draf')
const merged = mergeCustomers(
  [{ id: 'h1', name: 'Host A' }],
  [{ id: 'd1', name: 'Draf A' }]
)
check('2 baris', merged.length === 2)
check('host tetap origin host', merged[0].origin === 'host')
check('draf ditandai origin draft', merged[1].origin === 'draft')
check('draf tanpa id dapat id turunan', mergeCustomers([], [{ name: 'X' }])[0].id === 'draft-0')
check('label draf dipakai', DRAFT_LABEL === 'Draf halaman')

console.log('\n[10] Ekspor CSV')
const csv = toCsv([
  { name: 'Sarah "Ibu"', phone: '0812', email: 's@x.id', address: 'Jl. A', source: 'IG', notes: 'Cat, "cepat"', origin: 'host' },
  { name: 'Draf', origin: 'draft' }
])
const lines = csv.split('\n')
check('header + 2 baris', lines.length === 3, String(lines.length))
check('header memuat Nama/Kontak WA/Email/Alamat', /"Nama","Kontak WA","Email","Alamat proyek","Sumber","Catatan","Asal data"/.test(csv))
check('kutip ganda di-escape', csv.includes('"Sarah ""Ibu"""'))
check('baris draft ditandai draf memori halaman', csv.includes('"draf memori halaman"'))
check('baris host ditandai data yang dikirim host', csv.includes('"data yang dikirim host"'))
check('field kosong tetap kolom', /"Draf","","","","","","draf memori halaman"/.test(csv))
check('CSV tidak menambah tanda kutip liar', csv.split('\n').every(l => (l.match(/"/g) || []).length % 2 === 0))

console.log(`\n${fail === 0 ? 'LULUS' : 'GAGAL'}: ${pass} lulus, ${fail} gagal`)
if (fail > 0) { console.log('Yang gagal:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
