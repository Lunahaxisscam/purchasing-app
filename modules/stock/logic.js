// ============================================================
// modules/stock/logic.js — LOGIKA MURNI "Stok Workshop" (t_02e5f5fd)
// ============================================================
// Read-only. Tidak ada penulisan DB, tidak ada schema baru, tidak ada
// jaringan. File ini hanya menghitung apa yang BOLEH ditampilkan dari data
// yang SUDAH ada di halaman (rows.materials) — dan, yang paling penting,
// menandai jujur bagian mana yang TIDAK bisa dihitung.
//
// ATURAN KETAT (arahan Brooklyn review intake):
//   Stok TIDAK boleh dihitung dari status PR / header (mis. "PR sudah
//   APPROVED", "receiving MASUK_GUDANG", jumlah baris handover). Karena
//   itu modul ini TIDAK menurunkan angka stok dari dokumen; ia hanya
//   membaca materials.current_stock yang ditulis oleh RPC receive_to_warehouse
//   (migration 2026-10-12_sprint1_alerts_stock.sql) dan menandai sisanya
//   UNAVAILABLE.
//
// KETERBATASAN DATA (didokumentasikan, bukan disembunyikan):
//   1. Tidak ada tabel movement/ledger (kartu stok) di repo ini — tidak ada
//      riwayat masuk/keluar, tidak ada saldo berjalan per tanggal.
//   2. materials.current_stock hanya naik saat RPC receive_to_warehouse
//      dipanggil. Tidak ada RPC/pencatatan untuk pengurangan saat barang
//      keluar (ke tukang/handover). Jadi current_stock = "pernah masuk
//      gudang", BUKAN "stok fisik hari ini".
//   3. materials tidak punya project_id (katalog master global). Kaitannya
//      ke project hanya lewat pr_items/receiving_items.
// ============================================================

// Nilai tunggal yang dipakai UI + test supaya label tidak berbeda-beda.
export const UNAVAILABLE_LABEL = 'Tidak tersedia'
export const PREVIEW_LABEL = 'Pratinjau'

// ------------------------------------------------------------
// Normalisasi angka — aman utk '' / null / undefined / teks acak.
// Mengembalikan null bila BUKAN angka (agar UI bisa bilang "—"),
// bukan 0 yang menyesatkan.
// ------------------------------------------------------------
export function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '') return null
  // Tolak teks seperti "3 dus" / "12,5 pcs" — bukan angka stok yang sah.
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return null
  const n = Number(s.replace(',', '.'))
  return isFinite(n) ? n : null
}

export function hasNumber(v) {
  return toNumberOrNull(v) !== null
}

// Nama material: kolom `name` (fallback aman bila data lama memakai nama lain).
export function materialName(m) {
  return String(m?.name ?? m?.nama ?? '').trim()
}

// Kode material sebagai sublabel (S1: kode tidak lagi jadi kolom tersendiri).
export function materialKode(m) {
  return String(m?.kode ?? m?.code ?? '').trim()
}

// Kategori material (dipakai filter kategori).
export function materialCategory(m) {
  return String(m?.category ?? m?.kategori ?? '').trim()
}

export function isBhp(m) {
  const kat = materialCategory(m).toLowerCase()
  if (kat === 'bahan habis pakai') return true
  // Prefix BHP wajib diikuti '-' + digit (BHP-0013) — 'BHPX-1' bukan BHP.
  return /^BHP-\d/i.test(materialKode(m))
}

// Satuan material (untuk kartu stok). Boleh kosong.
export function materialSatuan(m) {
  return String(m?.satuan ?? m?.unit ?? m?.uom ?? '').trim()
}

// ------------------------------------------------------------
// DAFTAR KATEGORI (filter) — hanya kategori yang benar-benar ADA
// di data, diurutkan abjad. Tidak ada daftar hardcode supaya modul
// tidak mengarang pilihan yang kosong.
// ------------------------------------------------------------
export function buildCategoryOptions(materials) {
  const seen = new Map()
  for (const m of materials || []) {
    const c = materialCategory(m)
    if (c === '') continue
    const key = c.toLowerCase()
    if (!seen.has(key)) seen.set(key, c)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'))
}

// ------------------------------------------------------------
// FILTER: kategori + pencarian bebas (nama / kode).
// ------------------------------------------------------------
export function filterStockRows({ materials = [], category = 'all', query = '' }) {
  const q = String(query || '').trim().toLowerCase()
  return materials.filter(m => {
    if (category && category !== 'all') {
      const c = materialCategory(m).toLowerCase()
      if (c !== String(category).toLowerCase()) return false
    }
    if (q) {
      const hay = `${materialName(m)} ${materialKode(m)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ------------------------------------------------------------
// STATUS STOK per material — inti "jujur" modul ini.
//
// Mengembalikan objoh deskriptif (bukan langsung teks) supaya UI bebas
// memilih tampilan dan test bisa memeriksa keputusan logikanya.
//
//   state : 'UNAVAILABLE'  -> angka stok TIDAK ADA di data (jangan tampilkan 0)
//           'OK'            -> ada angka, tidak menipis
//           'MENIPIS'       -> BHP dan current_stock <= min_stock (min_stock > 0)
//           'TIDAK_DIPANTAU'-> ada angka tapi bukan BHP / min_stock tidak aktif
// ------------------------------------------------------------
export function stockStatus(m) {
  const cur = toNumberOrNull(m?.current_stock)
  if (cur === null) {
    return { state: 'UNAVAILABLE', current: null, min: null }
  }
  const min = toNumberOrNull(m?.min_stock)
  const bhp = isBhp(m)
  if (bhp && min !== null && min > 0 && cur <= min) {
    return { state: 'MENIPIS', current: cur, min, bhp }
  }
  return { state: 'TIDAK_DIPANTAU', current: cur, min, bhp }
}

// ------------------------------------------------------------
// RINGKASAN (KPI kartu). Sengaja TIDAK menghitung "total stok" /
// "nilai persediaan" karena tidak ada harga stok terkini yang
// tersedia secara konsisten (harga_acuan hanya acuan, bukan nilai buku).
// Yang dihitung hanya hitungan baris — aman dan bisa diverifikasi.
// ------------------------------------------------------------
export function summarizeStock(rows) {
  let total = 0
  let adaAngka = 0
  let menipis = 0
  let tidakDipantau = 0
  let tanpaAngka = 0
  let bhp = 0
  for (const m of rows || []) {
    total += 1
    if (isBhp(m)) bhp += 1
    const st = stockStatus(m)
    if (st.state === 'UNAVAILABLE') tanpaAngka += 1
    else {
      adaAngka += 1
      if (st.state === 'MENIPIS') menipis += 1
      else tidakDipantau += 1
    }
  }
  return { total, adaAngka, menipis, tidakDipantau, tanpaAngka, bhp }
}

// ------------------------------------------------------------
// CSV (client-side, aman): hanya baris & kolom yang sudah tampil.
// Mengutamakan transparansi — kolom angka kosong diekspor sebagai
// string kosong, BUKAN 0, agar tidak terbaca sebagai stok nol.
// ------------------------------------------------------------
export function toCsv(rows) {
  const esc = v => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Kode', 'Nama', 'Kategori', 'Satuan', 'Stok', 'Min Stok', 'Status']
  const lines = [head.join(',')]
  for (const m of rows || []) {
    const st = stockStatus(m)
    lines.push([
      materialKode(m),
      materialName(m),
      materialCategory(m),
      materialSatuan(m),
      st.current === null ? '' : st.current,
      st.min === null ? '' : st.min,
      st.state
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

// Ringkasan keterbatasan data untuk ditampilkan di UI (satu sumber kebenaran).
export const DATA_LIMITATIONS = [
  'Belum ada tabel movement/ledger: riwayat masuk-keluar dan saldo berjalan per tanggal belum bisa ditampilkan.',
  'Angka stok berasal dari materials.current_stock, yang hanya bertambah saat aksi "Ke Gudang" (receive_to_warehouse) dijalankan.',
  'Barang keluar (serah terima ke tukang) belum tercatat sebagai pengurang, jadi angka yang tampil adalah "pernah masuk gudang" — bukan stok fisik hari ini.',
  'Material adalah katalog master global (tanpa project_id); kaitan ke project hanya tersurat lewat PR / item pembelian.'
]
