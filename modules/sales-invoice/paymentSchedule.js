// ============================================================
// modules/sales-invoice/paymentSchedule.js — JADWAL TERMIN INVOICE
// ============================================================
// Helper MURNI (tanpa import Supabase, tanpa fetch, tanpa DOM) untuk
// menghitung termin pembayaran dari GRAND TOTAL lokal yang sudah
// ditampilkan di modal (nominal + PPN).
//
// ATURAN BISNIS (arahan DAT / kontrak t_13d8e9d6):
//   * default 3 termin: 50% / 40% / 10%
//   * nominal otomatis dihitung dari grand_total LOKAL
//   * TERMIN TERAKHIR menampung SISA pembulatan, sehingga
//     sum(termin) === grand_total tepat (bukan meleset beberapa rupiah)
//   * input manual admin TIDAK ditimpa: hanya term yang masih kosong
//     yang diisi otomatis (snapshot perilaku applyDefaultTermSchedule
//     dari noir-invoice-generator/src/lib/model.js)
//
// File ini sengaja TIDAK mengimpor apa pun dari lib/supabaseClient,
// apiClient, store.js, atau contract.js: modul sales_invoice tidak
// membaca/menulis data purchasing, jadi tidak ada jalur DB di sini.
// ============================================================

// Preset default. Angka sama dengan noir-invoice-generator (50/40/10).
export const DEFAULT_TERM_PERCENTS = Object.freeze([50, 40, 10])

// Batas panjang teks yang dikirim ke server: kolom payment_terms
// diatur 120 karakter oleh contract.js (LIMITS.payment_terms).
export const PAYMENT_TERMS_LIMIT = 120

// Toleransi validasi: Rp 1 (pembulatan rupiah bulat).
export const SUM_TOLERANCE = 1

// ---------- parsing & format angka (Indonesia) ----------

/**
 * Ubah teks berformat Indonesia menjadi angka bulat.
 * '1.500.000' -> 1500000 ; '1,5' -> 1 (ribuan dipisah titik) ;
 * '' -> 0 ; '-abc' -> 0.
 */
export function parseAmount(raw) {
  if (raw == null) return 0
  const s = String(raw).trim()
  if (!s) return 0
  // Buang semua kecuali digit, koma, titik, minus.
  const cleaned = s.replace(/[^0-9.,-]/g, '')
  if (!cleaned || !/[0-9]/.test(cleaned)) return 0
  // Format Indonesia: titik = ribuan, koma = desimal.
  const normalized = cleaned
    .replace(/\./g, '')          // 1.500.000 -> 1500000
    .replace(',', '.')           // 1,5 -> 1.5
  const n = Number(normalized)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** Format angka rupiah bulat: 1500000 -> '1.500.000'. */
export function formatAmount(n) {
  const v = Number.isFinite(n) ? Math.round(n) : 0
  return Math.abs(v).toLocaleString('id-ID')
}

/**
 * Parsing persentase. Menerima '50', '12,5', ' 10 %'.
 * Dibatasi 0..100 agar payload tetap masuk akal.
 */
export function parsePercent(raw, fallback = 0) {
  if (raw == null || raw === '') return fallback
  const s = String(raw).replace('%', '').replace(',', '.').trim()
  const n = Number(s)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

/** Persen -> nominal (pembulatan ke rupiah terdekat). */
export function percentToAmount(total, percent) {
  return Math.round((Number(total) || 0) * (Number(percent) || 0) / 100)
}

// ---------- perhitungan termin ----------

/**
 * Bangun daftar termin dari grand_total dan daftar persen.
 *
 * @param {number} grandTotal   total tagihan (sudah termasuk PPN)
 * @param {number[]} percents   persen per termin (default 50/40/10)
 * @param {string[]} manualAmounts nominal yang sudah diisi manual
 *        (index sejajar). '' = belum diisi -> otomatis.
 *
 * Term terakhir SELALU = grandTotal - sum(term sebelumnya), termasuk
 * ketika term sebelumnya diisi manual. Dengan begitu total jadwal
 * pembayaran selalu sama dengan total tagihan.
 *
 * @returns {{label:string, percent:number, amount:number, isAuto:boolean}[]}
 */
export function buildTermSchedule(grandTotal, percents = DEFAULT_TERM_PERCENTS, manualAmounts = []) {
  const total = Math.round(Number(grandTotal) || 0)
  const pctList = (Array.isArray(percents) ? percents : DEFAULT_TERM_PERCENTS)
    .map((p, i) => parsePercent(p, DEFAULT_TERM_PERCENTS[i] ?? 0))
  const manual = Array.isArray(manualAmounts) ? manualAmounts : []

  if (total <= 0 || pctList.length === 0) {
    return pctList.map((p, i) => ({ label: `Term ${i + 1}`, percent: p, amount: 0, isAuto: false }))
  }

  const terms = []
  let sum = 0
  for (let i = 0; i < pctList.length; i++) {
    const last = i === pctList.length - 1
    const rawManual = manual[i]
    const hasManual = rawManual != null && String(rawManual).trim() !== '' && Number.isFinite(parseAmount(rawManual))
    let amount
    if (hasManual) {
      amount = parseAmount(rawManual)
    } else if (last) {
      amount = total - sum
    } else {
      amount = percentToAmount(total, pctList[i])
    }
    sum += amount
    terms.push({ label: `Term ${i + 1}`, percent: pctList[i], amount, isAuto: !hasManual && last })
  }
  return terms
}

/**
 * Hitung ulang hanya term yang masih kosong dari grand_total baru.
 * Term yang sudah diisi manual (atau sudah pernah disetel admin)
 * TIDAK berubah nilainya — persis aturan "jangan menimpa input manual".
 *
 * @param {number} grandTotal
 * @param {{percent:number, amount:number|string}[]} terms
 * @returns {{percent:number, amount:number, isAuto:boolean}[]}
 */
export function recalcTerms(grandTotal, terms) {
  const total = Math.round(Number(grandTotal) || 0)
  const list = Array.isArray(terms) ? terms : []
  // Akumulator BERJALAN: nominal yang sudah pasti (manual ATAU hasil
  // hitung otomatis pada term sebelumnya) ikut dihitung, supaya term
  // terakhir benar-benar menampung sisa dari seluruh term di atasnya.
  // Menghitung sekali di awal adalah bug: term auto di tengah belum
  // punya nilai saat itu, sehingga sisa jadi terlalu besar.
  let committed = 0
  return list.map((t, i) => {
    const label = `Term ${i + 1}`
    const percent = parsePercent(t?.percent, 0)
    const raw = String(t?.amount ?? '').trim()
    if (raw !== '') {
      const amount = parseAmount(raw)
      committed += amount
      return { label, percent, amount, isAuto: false }
    }
    if (total <= 0) {
      // Belum ada nominal: term terakhir tetap ditandai sebagai sisa agar
      // UI memberi petunjuk konsisten sejak form masih kosong.
      return { label, percent, amount: 0, isAuto: i === list.length - 1 }
    }
    if (i === list.length - 1) {
      return { label, percent, amount: total - committed, isAuto: true }
    }
    const amount = percentToAmount(total, percent)
    committed += amount
    return { label, percent, amount, isAuto: false }
  })
}

// ---------- validasi ----------

/**
 * Validasi jadwal termin terhadap grand_total.
 * Toleransi Rp 1 (SUM_TOLERANCE) untuk selisih pembulatan.
 *
 * @returns {{ok:boolean, sum:number, diff:number, message:string}}
 */
export function validateTermSum(grandTotal, terms) {
  const total = Math.round(Number(grandTotal) || 0)
  const list = Array.isArray(terms) ? terms : []
  const sum = list.reduce((acc, t) => acc + parseAmount(t?.amount), 0)
  const diff = sum - total
  const ok = Math.abs(diff) <= SUM_TOLERANCE
  const message = ok
    ? `Jumlah termin Rp ${formatAmount(sum)} = total tagihan Rp ${formatAmount(total)}.`
    : `Jumlah termin Rp ${formatAmount(sum)} ${diff > 0 ? 'lebih' : 'kurang'} Rp ${formatAmount(Math.abs(diff))} dari total tagihan Rp ${formatAmount(total)}.`
  return { ok, sum, diff, message }
}

/**
 * Ringkasan siap kirim untuk kolom `payment_terms` (string, max 120).
 * Format: 'Term 1 50% Rp 21.650.000; Term 2 40% Rp 17.320.000; Term 3 10% Rp 4.330.000'
 * Dipotong aman bila melebihi batas (nominal term terakhir lebih dulu
 * daripada menolak simpan — lihat catatan di bawah).
 */
export function formatTermsForPayload(terms, limit = PAYMENT_TERMS_LIMIT) {
  const list = Array.isArray(terms) ? terms : []
  const parts = list
    .map((t, i) => {
      const pct = parsePercent(t?.percent, 0)
      const amt = parseAmount(t?.amount)
      return `Term ${i + 1} ${pct}% Rp ${formatAmount(amt)}`
    })
    .filter(s => !/Rp 0$/.test(s) || list.length === 1)
  const joined = parts.join('; ')
  return joined.length > limit ? joined.slice(0, limit) : joined
}

/**
 * True bila admin perlu diperingatkan sebelum menyimpan: sum termin
 * tidak sama dengan grand_total (mis. nominal diubah setelah termin
 * diisi manual).
 */
export function scheduleMismatch(grandTotal, terms) {
  return !validateTermSum(grandTotal, terms).ok
}
