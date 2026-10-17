// ============================================================
// MODUL CRM CUSTOMER (t_7253b859) — logika murni
// ============================================================
// TANPA React, TANPA DOM, TANPA DB. Semua fungsi deterministik dan
// bisa diuji headless. Tampilan ada di modules/crm/view.jsx, selector
// yang bisa dipakai ulang ada di modules/crm/selector.jsx.
//
// KEPUTUSAN YANG DIJAGA (kontrak modul):
//
// 1. TIDAK ADA PERSISTENSI PALSU. Modul ini tidak membuat tabel, tidak
//    memanggil RPC, tidak menulis Supabase, tidak memakai localStorage.
//    Customer yang ditambahkan lewat form hidup sebagai DRAF di state
//    React halaman dan diberi label "Draf halaman" — itu ditulis jelas
//    di layar, bukan disamarkan sebagai "tersimpan".
//
// 2. TIDAK ADA CUSTOMER CONTOH. Kalau host tidak mengirim data, daftar
//    kosong dan halaman mengatakan kosong. Tidak ada data demo yang
//    disuntikkan supaya tampilan terlihat "hidup".
//
// 3. STATUS KEMAMPUAN (capability) JUJUR:
//      'unavailable' : host TIDAK mengirim prop customers sama sekali
//                       (tabel/RLS belum dipasang) -> panel penjelasan,
//                       bukan daftar kosong yang terlihat seperti bug.
//      'empty'       : host mengirim array kosong (tabel terbaca, masih
//                       kosong) -> "Belum ada customer terdata".
//      'ready'       : ada baris customer -> daftar baca.
//
// 4. ANGKA KOSONG = "Tidak tersedia", BUKAN 0 dan BUKAN string kosong
//    yang terbaca seperti "tidak ada masalah". Kontak yang hilang
//    ditandai, hitungan relasi yang tidak dikirim host ditulis
//    "tidak dikirim" — tidak pernah dihitung 0.
//
// 5. BARIS DARI HOST BACA SAJA. Form edit tetap bisa dibuka (shell),
//    tapi perubahan untuk baris host tidak dikirim ke mana pun dan
//    halaman mengatakan itu terus terang.
//
// 6. PENCARIAN aman untuk data lama: nama/telepon/email/alamat/sumber
//    dicocokkan case-insensitive; nomor WA dinormalkan (62 -> 0,
//    tanda baca dibuang) supaya "0812-345" tetap menemukan "62812345".
// ============================================================

// Label yang dipakai berkali-kali — satu tempat supaya tidak drift.
export const UNAVAILABLE_LABEL = 'Tidak tersedia'
export const DRAFT_LABEL = 'Draf halaman'
export const SELECTOR_EMPTY_LABEL = 'Belum ada customer terdata'
export const RELATION_UNKNOWN = 'Relasi invoice tidak dikirim ke halaman ini'

// Bentuk form tambah/edit customer (kontrak field UI).
export const CUSTOMER_FIELDS = [
  { key: 'name', label: 'Nama customer', type: 'text', required: true, placeholder: 'Contoh: Ibu Sarah' },
  { key: 'phone', label: 'Kontak WA', type: 'tel', required: false, placeholder: '08xxxxxxxxxx' },
  { key: 'email', label: 'Email', type: 'email', required: false, placeholder: 'nama@email.com' },
  { key: 'address', label: 'Alamat proyek', type: 'textarea', required: false, placeholder: 'Alamat lengkap lokasi pekerjaan' },
  { key: 'source', label: 'Sumber customer', type: 'text', required: false, placeholder: 'Contoh: Instagram, referral, walk-in' },
  { key: 'notes', label: 'Catatan', type: 'textarea', required: false, placeholder: 'Preferensi, kebutuhan, atau hal penting lain' }
]

export function emptyForm() {
  return { name: '', phone: '', email: '', address: '', source: '', notes: '' }
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
 * Menilai sumber data customer yang dikirim host.
 * Menerima prop mentah (bukan hasil readCustomers) supaya bisa membedakan
 * "tabel belum dipasang" (undefined/null) dari "tabel kosong" ([]).
 */
export function customerCapability(raw) {
  if (!Array.isArray(raw)) return CAPABILITY.UNAVAILABLE
  return raw.length > 0 ? CAPABILITY.READY : CAPABILITY.EMPTY
}

export const CAPABILITY_COPY = {
  unavailable: {
    title: 'Tabel CRM belum tersedia di aplikasi ini',
    body: 'Halaman customer sudah siap dipakai, tapi sumber datanya (tabel + RLS) belum dipasang. Tidak ada customer contoh yang ditampilkan — daftar di bawah hanya berisi data yang benar-benar dikirim ke halaman ini, dan draf yang kamu buat sendiri.'
  },
  empty: {
    title: 'Belum ada customer terdata',
    body: 'Sumber customer sudah terbaca, tapi masih kosong. Customer yang ditambahkan dari form di halaman ini hidup sebagai draf di memori halaman sampai penyimpanan server aktif.'
  },
  ready: {
    title: 'Daftar customer',
    body: 'Baris di bawah dibaca dari data yang dikirim host ke halaman ini. Halaman ini tidak menulis ke database.'
  }
}

// Keterbatasan yang ditulis apa adanya di panel bawah halaman.
export const DATA_LIMITATIONS = [
  'Belum ada penulisan ke database: tidak ada tabel customers, tidak ada RPC, tidak ada migrasi baru.',
  'Customer baru hanya draf di memori halaman — hilang saat halaman dimuat ulang, dan itu disebutkan di setiap baris draf.',
  'Baris customer dari host bersifat baca saja; perubahan tidak bisa dikirim balik ke server.',
  'Relasi ke Invoice Penjualan / RAB hanya tampil bila host mengirim hitungan rujukan. Kalau tidak dikirim, modul menulis "tidak dikirim", bukan 0.',
  'Tidak ada customer contoh: daftar kosong berarti kosong.'
]

// ============================================================
// PEMBACAAN DEFENSIF
// ============================================================

/**
 * Normalkan baris customer dari host. Menerima beberapa nama field yang
 * sudah dipakai di repo ini (name/customer_name/nama, phone/whatsapp/
 * customer_phone, address/project_address/alamat, source/sumber,
 * notes/note/catatan). Baris tanpa nama dibuang — nama adalah satu-satunya
 * field yang benar-benar wajib.
 */
export function readCustomers(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c, i) => {
      const name = String(c?.name ?? c?.customer_name ?? c?.nama ?? '').trim()
      return {
        id: c?.id != null && String(c.id) !== '' ? String(c.id) : `crm-${i}`,
        name,
        phone: String(c?.phone ?? c?.whatsapp ?? c?.customer_phone ?? c?.telp ?? '').trim(),
        email: String(c?.email ?? c?.mail ?? '').trim(),
        address: String(c?.address ?? c?.project_address ?? c?.alamat ?? '').trim(),
        source: String(c?.source ?? c?.sumber ?? '').trim(),
        notes: String(c?.notes ?? c?.note ?? c?.catatan ?? '').trim(),
        created_at: c?.created_at ?? null,
        origin: 'host'
      }
    })
    .filter(c => c.name !== '')
}

/** Gabung baris host (baca) + draf halaman. Satu daftar untuk UI. */
export function mergeCustomers(host = [], drafts = []) {
  const hostRows = (host || []).map(c => ({ ...c, origin: 'host' }))
  const draftRows = (drafts || []).map((d, i) => ({
    ...d,
    id: d?.id != null ? String(d.id) : `draft-${i}`,
    origin: 'draft'
  }))
  return [...hostRows, ...draftRows]
}

// ============================================================
// NILAI TURUNAN (aman untuk data yang tidak lengkap)
// ============================================================

/** Nomor WA kanonik untuk pencocokan: 62xxx -> 0xxx, tanda baca dibuang. */
export function normalizePhone(s) {
  let d = String(s ?? '').replace(/\D/g, '')
  if (d === '') return ''
  if (d.startsWith('62')) d = `0${d.slice(2)}`
  return d
}

/** Kontak utama: WA dulu, lalu email. null = tidak ada (bukan string kosong). */
export function customerContact(c) {
  const phone = String(c?.phone ?? '').trim()
  if (phone !== '') return phone
  const email = String(c?.email ?? '').trim()
  return email !== '' ? email : null
}

export function customerSource(c) {
  const s = String(c?.source ?? '').trim()
  return s === '' ? null : s
}

/** Kunci stabil untuk data-testid (aman untuk DOM). */
/**
 * Key stabil untuk React dan testid. Nama dipakai sebagai slug utama
 * (testid baris = crm-row-ibu-sarah), TAPI kalau dua baris punya nama
 * sama (mis. draft menyalin nama host), id digabungkan supaya key
 * tetap unik dan React tidak salah merge baris.
 */
export function customerKey(c) {
  const slug = String(c?.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug !== '') return slug
  const idSlug = String(c?.id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return idSlug !== '' ? idSlug : 'x'
}

/** Key unik per baris (nama + id) untuk React key — aman walau nama kembar. */
export function customerRowKey(c) {
  return `${customerKey(c)}--${String(c?.id ?? '') || 'noid'}`
}

/** Label satu baris untuk <option> selector. */
export function customerLabel(c) {
  const name = String(c?.name ?? '').trim() || 'Tanpa nama'
  const contact = customerContact(c)
  return contact === null
    ? `${name} — kontak ${UNAVAILABLE_LABEL.toLowerCase()}`
    : `${name} — ${contact}`
}

/** Daftar sumber (unik, rapi) untuk filter. */
export function sourceOptions(customers) {
  const set = new Set()
  for (const c of customers || []) {
    const s = String(c?.source ?? '').trim()
    if (s !== '') set.add(s)
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter daftar customer. Pencarian menyentuh nama, WA, email, alamat,
 * dan sumber; nomor WA dicocokkan lewat normalizePhone supaya format
 * "0812-3456" tetap menemukan "628123456".
 */
export function filterCustomers({ customers, query, source } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  const qDigits = q.replace(/\D/g, '')
  const src = String(source ?? 'all').trim().toLowerCase()
  return (customers || []).filter(c => {
    if (src !== '' && src !== 'all' && String(c?.source ?? '').trim().toLowerCase() !== src) return false
    if (q === '') return true
    const hay = [c?.name, c?.phone, c?.email, c?.address, c?.source]
      .map(v => String(v ?? '').toLowerCase())
      .join(' ')
    if (hay.includes(q)) return true
    if (qDigits.length >= 3) {
      // Query dinormalkan juga: "62812" -> "0812" supaya pengguna
      // boleh mengetik format 62 atau 0 dan dapat baris yang sama.
      const qNorm = normalizePhone(qDigits)
      if (qNorm !== '' && normalizePhone(c?.phone).includes(qNorm)) return true
    }
    return false
  })
}

/**
 * Ringkasan untuk kartu KPI. Yang tidak ada dihitung sebagai "tanpa
 * kontak" — tidak ditebak dari field lain.
 */
export function summarizeCustomers(customers) {
  const list = customers || []
  const withContact = list.filter(c => customerContact(c) !== null).length
  const sources = new Set(list.map(c => String(c?.source ?? '').trim()).filter(s => s !== ''))
  return {
    total: list.length,
    withContact,
    withoutContact: list.length - withContact,
    sources: sources.size,
    withAddress: list.filter(c => String(c?.address ?? '').trim() !== '').length
  }
}

// ============================================================
// VALIDASI & DUPLIKAT (client-side, tidak menulis apa pun)
// ============================================================

/**
 * Cari customer yang mirip (nama sama atau nomor WA sama) di daftar.
 * Dipakai sebagai PERINGATAN, bukan penolakan — dua customer boleh
 * saja bernama sama, tapi pengguna perlu tahu sebelum menambah baru.
 */
export function findDuplicate(existing, form, editingId) {
  const name = String(form?.name ?? '').trim().toLowerCase()
  const phone = normalizePhone(form?.phone)
  return (existing || []).find(c => {
    if (editingId != null && String(c.id) === String(editingId)) return false
    const cPhone = normalizePhone(c.phone)
    if (phone !== '' && cPhone !== '' && cPhone === phone) return true
    return name !== '' && String(c.name).trim().toLowerCase() === name
  }) || null
}

/**
 * Validasi form. Mengembalikan { ok, errors, warnings, duplicate }.
 * errors memblokir submit; warnings hanya informasi.
 */
export function validateCustomer(form, { existing = [], editingId = null } = {}) {
  const errors = {}
  const name = String(form?.name ?? '').trim()
  if (name === '') errors.name = 'Nama customer wajib diisi.'
  else if (name.length < 2) errors.name = 'Nama customer minimal 2 karakter.'

  const phone = String(form?.phone ?? '').trim()
  if (phone !== '' && normalizePhone(phone).length < 8) {
    errors.phone = 'Nomor WA terlalu pendek — periksa kembali.'
  }

  const email = String(form?.email ?? '').trim()
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Format email belum benar (contoh: nama@email.com).'
  }

  const duplicate = findDuplicate(existing, form, editingId)
  const warnings = duplicate
    ? [`Data mirip customer "${duplicate.name}" yang sudah ada. Periksa dulu sebelum menambah yang baru.`]
    : []

  return { ok: Object.keys(errors).length === 0, errors, warnings, duplicate }
}

// ============================================================
// RELASI KE MODUL LAIN (Invoice Penjualan / RAB)
// ============================================================

/**
 * Hitungan rujukan invoice untuk satu customer.
 * `counts` = { <customer_id>: <jumlah invoice> } yang DIKIRIM HOST.
 * Tidak dikirim / bukan angka -> null (modul menulis "tidak dikirim"),
 * TIDAK pernah 0 — 0 akan terbaca sebagai "tidak pernah dirujuk".
 */
export function relationCount(customerId, counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null
  const raw = counts[String(customerId)]
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

/** Teks relasi untuk satu baris (tabel & detail memakai teks yang sama). */
export function relationText(customerId, counts) {
  const n = relationCount(customerId, counts)
  return n === null ? RELATION_UNKNOWN : `Dirujuk di ${n} invoice`
}

// ============================================================
// EKSPOR CSV
// ============================================================

function csvEsc(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

/** Kolom eksplisit supaya file bisa dibuka di Excel tanpa tebak-tebak. */
export function toCsv(customers) {
  const head = ['Nama', 'Kontak WA', 'Email', 'Alamat proyek', 'Sumber', 'Catatan', 'Asal data']
  const body = (customers || []).map(c => [
    c.name,
    c.phone || '',
    c.email || '',
    c.address || '',
    c.source || '',
    c.notes || '',
    c.origin === 'draft' ? 'draf memori halaman' : 'data yang dikirim host'
  ].map(csvEsc).join(','))
  return [head.map(csvEsc).join(','), ...body].join('\n')
}
