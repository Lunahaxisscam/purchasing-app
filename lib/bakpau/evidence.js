// ============================================================
// lib/bakpau/evidence.js — PARSER BUKTI TEKS MENJADI DRAFT PEMBELIAN
// ============================================================
// Tugas: mengubah teks pesan (Telegram/WhatsApp) menjadi DRAFT transaksi
// pembelian yang masih MENTAH (belum tahu id master). Semua keputusan
// "boleh/tidak" ada di resolve.js + connector.js; di sini hanya pembacaan.
//
// GRAMMAR (dokumen kontrak: docs/bakpau-connector-contract.md §3)
// ---------------------------------------------------------------
// Baris header:  `kunci: nilai`  (kunci tidak case-sensitive)
//   toko | vendor          -> nama toko (WAJIB untuk simpan)
//   nota | no nota | invoice -> nomor nota vendor (opsional; tanpa nomor =
//                              referensi internal dibuat saat simpan)
//   tanggal | tgl          -> YYYY-MM-DD atau DD/MM/YYYY (WAJIB; TIDAK
//                              ditebak dari jam pesan)
//   proyek | project       -> proyek default seluruh nota (kode atau nama)
//   total                  -> total yang TERTULIS di nota (untuk rekonsiliasi)
//   ongkir | biaya lain    -> biaya tambahan toko
//   diskon                 -> potongan toko
//   catatan                -> catatan bebas
//
// Baris barang (pilih salah satu bentuk, keduanya deterministik):
//   A. PIPE (disarankan, tidak ambigu):
//        - <nama> | <qty> | <satuan> | <harga> [| spek=<spek>]
//                 [| proyek=<kode/nama>] [| pr=<no PR>]
//   B. INLINE (dari kanan): <nama…> <qty> <satuan> <harga>
//        contoh: "Triplek 12mm 5 lembar 125.000"
//
// ATURAN ANTI-TEBAK (ditegakkan di sini):
//   * Baris barang yang tidak bisa dibaca TIDAK dibuang diam-diam — masuk
//     `unparsedLines` dan memicu klarifikasi.
//   * Harga 0 / kosong TIDAK pernah dianggap gratis: baris tanpa harga sah
//     masuk `unparsedLines`.
//   * Tidak ada qty/SKU yang dikarang dari nominal total. Bukti yang hanya
//     berisi nominal (transfer global) -> `monetaryOnly: true`.
//   * Teks bebas yang tidak dikenali tetap disimpan apa adanya di `catatan`.
// ============================================================

import { LIMITS } from './constants.js'

// Satuan yang dikenali. Diambil dari master materials (satuan/unit) yang
// benar-benar dipakai: pcs, lembar, batang, dus, box, roll, kg, m, m2, m3,
// liter, set, unit, sak, lonjor, kaleng, tube, pack, rim, galon, ikat, pasang.
// Satuan di luar daftar ini TIDAK ditebak — jadi klarifikasi.
export const KNOWN_UNITS = Object.freeze([
  'pcs', 'pc', 'buah', 'unit', 'set', 'pasang',
  'lembar', 'lbr', 'batang', 'lonjor', 'roll', 'rol',
  'dus', 'box', 'pack', 'pak', 'sak', 'karung', 'kaleng', 'tube',
  'kg', 'gram', 'gr', 'ton',
  'm', 'm1', 'm2', 'm3', 'meter', 'liter', 'ltr',
  'rim', 'galon', 'ikat', 'kodi', 'lusin'
])

const UNIT_ALIAS = Object.freeze({
  pc: 'pcs', buah: 'pcs', lbr: 'lembar', rol: 'roll', pak: 'pack',
  karung: 'sak', gr: 'gram', meter: 'm', m1: 'm', ltr: 'liter'
})

// Normalisasi satuan ke bentuk baku; null bila tidak dikenal.
export function normalizeUnit(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\.$/, '')
  if (!s) return null
  if (KNOWN_UNITS.includes(s)) return UNIT_ALIAS[s] || s
  return null
}

// Angka rupiah/qty gaya Indonesia: "1.250.000" -> 1250000, "12,5" -> 12.5.
export function toNumberID(raw) {
  const s = String(raw ?? '').trim().replace(/^(rp\.?|idr)\s*/i, '').replace(/\s/g, '')
  if (!s) return null
  if (!/^-?\d[\d.,]*$/.test(s)) return null
  const commas = (s.match(/,/g) || []).length
  const dots = (s.match(/\./g) || []).length
  let n
  if (commas && dots) {
    n = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? Number(s.split('.').join('').replace(',', '.'))
      : Number(s.split(',').join(''))
  } else if (dots) {
    n = /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.split('.').join('')) : Number(s)
  } else if (commas) {
    n = commas === 1 ? Number(s.replace(',', '.')) : Number(s.split(',').join(''))
  } else {
    n = Number(s)
  }
  return isFinite(n) ? n : null
}

// Tanggal: YYYY-MM-DD atau DD/MM/YYYY (juga DD-MM-YYYY). Selain itu null —
// tanggal TIDAK ditebak dari jam pesan (SOP: jangan mengarang tanggal vendor).
export function parseDateID(raw) {
  const s = String(raw || '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const [, y, mo, d] = m
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
    const ok = dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d)
    return ok ? `${y}-${mo}-${d}` : null
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3])
    const dt = new Date(Date.UTC(y, mo - 1, d))
    const ok = dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
    if (!ok) return null
    return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

const HEADER_KEYS = {
  toko: 'vendorName', vendor: 'vendorName', 'nama toko': 'vendorName', supplier: 'vendorName',
  nota: 'invoiceNo', 'no nota': 'invoiceNo', 'nomor nota': 'invoiceNo',
  invoice: 'invoiceNo', 'no invoice': 'invoiceNo', 'no. nota': 'invoiceNo',
  tanggal: 'dateRaw', tgl: 'dateRaw', date: 'dateRaw',
  proyek: 'projectRef', project: 'projectRef',
  total: 'statedTotalRaw',
  ongkir: 'biayaLainRaw', 'biaya lain': 'biayaLainRaw', 'biaya kirim': 'biayaLainRaw', kirim: 'biayaLainRaw',
  diskon: 'diskonRaw', potongan: 'diskonRaw',
  catatan: 'catatan'
}

function isItemLine(line) {
  return /^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) || line.includes('|')
}

function stripItemBullet(line) {
  return String(line || '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
}

// Bentuk A: pipe. `nama | qty | satuan | harga | k=v …`
// Satuan TIDAK harus dikenal di sini: satuan asing tetap dibaca apa adanya
// supaya resolve.js bisa melaporkan "satuan X tidak dikenal" secara SPESIFIK
// (bukan baris buram "tidak terbaca"). Yang ditolak di sini hanya bentuk yang
// benar-benar tidak bisa dipisah (qty/harga bukan angka, satuan kosong).
function parsePipeItem(line) {
  const parts = line.split('|').map(s => s.trim()).filter(s => s !== '')
  if (parts.length < 4) return null
  const [nama, qtyRaw, unitRaw, hargaRaw, ...rest] = parts
  const qty = toNumberID(qtyRaw)
  const harga = toNumberID(hargaRaw)
  if (!nama || qty === null || qty <= 0 || harga === null || harga <= 0) return null
  if (!unitRaw || /^[\d.,]+$/.test(unitRaw)) return null
  const extra = {}
  for (const r of rest) {
    const m = r.match(/^([a-zA-Z ]+)\s*[=:]\s*(.+)$/)
    if (!m) return null // bagian tambahan yang tidak dikenali -> jangan ditebak
    extra[m[1].trim().toLowerCase()] = m[2].trim()
  }
  return {
    itemName: nama,
    qty,
    unit: unitRaw,          // mentah; resolve.js yang menormalkan & menilai
    harga,
    spec: extra.spek || extra.spec || '',
    projectRef: extra.proyek || extra.project || '',
    prRef: extra.pr || ''
  }
}

// Bentuk B: inline dari kanan — `nama qty satuan harga`.
// Token satuan WAJIB berupa kata (bukan angka) supaya "3 dus" tidak salah
// dibaca sebagai qty=3 satuan="dus" pada posisi yang keliru.
function parseInlineItem(line) {
  const tokens = String(line || '').trim().split(/\s+/).filter(Boolean)
  if (tokens.length < 4) return null
  const harga = toNumberID(tokens[tokens.length - 1])
  const unitRaw = tokens[tokens.length - 2]
  const qty = toNumberID(tokens[tokens.length - 3])
  if (harga === null || harga <= 0 || qty === null || qty <= 0) return null
  if (!/^[A-Za-z.]+$/.test(unitRaw)) return null
  const nama = tokens.slice(0, tokens.length - 3).join(' ').trim()
  if (!nama) return null
  return { itemName: nama, qty, unit: unitRaw, harga, spec: '', projectRef: '', prRef: '' }
}

// ------------------------------------------------------------
// Parser utama.
// ------------------------------------------------------------
export function parseEvidenceText(text) {
  const raw = String(text ?? '')
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const header = {
    vendorName: '', invoiceNo: '', dateRaw: '', projectRef: '',
    statedTotalRaw: '', biayaLainRaw: '', diskonRaw: '', catatan: ''
  }
  const freeLines = []
  const itemLines = []

  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z. ]{1,20}?)\s*[:=]\s*(.*)$/)
    const key = m ? m[1].trim().toLowerCase().replace(/\.$/, '') : ''
    if (m && HEADER_KEYS[key] && !isItemLine(line)) {
      const field = HEADER_KEYS[key]
      const val = m[2].trim()
      if (field === 'catatan') header.catatan = header.catatan ? `${header.catatan} ${val}` : val
      else header[field] = val
      continue
    }
    if (isItemLine(line)) { itemLines.push(line); continue }
    freeLines.push(line)
  }

  const items = []
  const unparsedLines = []
  for (const line of itemLines) {
    const body = stripItemBullet(line)
    const parsed = line.includes('|') ? parsePipeItem(body) : parseInlineItem(body)
    if (!parsed) { unparsedLines.push(line); continue }
    if (items.length >= LIMITS.MAX_ITEMS) { unparsedLines.push(line); continue }
    items.push(parsed)
  }

  const date = parseDateID(header.dateRaw)
  const statedTotal = toNumberID(header.statedTotalRaw)
  const biayaLain = toNumberID(header.biayaLainRaw)
  const diskon = toNumberID(header.diskonRaw)

  const material = items.reduce((s, it) => s + Math.round(it.qty * it.harga), 0)

  // Bukti hanya nominal: ada total tertulis tapi NOL baris barang yang sah.
  // Ini bukan "belanja tanpa rincian yang boleh ditulis sebagai pembelian" —
  // tidak boleh mengarang qty/SKU. Ditandai untuk klarifikasi.
  const monetaryOnly = items.length === 0 && (statedTotal !== null && statedTotal > 0)

  return {
    header: {
      vendorName: header.vendorName.trim(),
      invoiceNo: header.invoiceNo.trim(),
      date,
      dateRaw: header.dateRaw.trim(),
      projectRef: header.projectRef.trim(),
      statedTotal,
      biayaLain: biayaLain !== null && biayaLain > 0 ? Math.round(biayaLain) : 0,
      diskon: diskon !== null && diskon > 0 ? Math.round(diskon) : 0,
      catatan: [header.catatan, ...freeLines].filter(Boolean).join(' ').trim()
    },
    items,
    unparsedLines,
    monetaryOnly,
    material,
    total: Math.max(0, material + (biayaLain > 0 ? Math.round(biayaLain) : 0) - (diskon > 0 ? Math.round(diskon) : 0)),
    hasAnyContent: lines.length > 0
  }
}
