// ============================================================
// lib/laborSource.js — SATU SUMBER KEBENARAN LABEL UPAH (FN-EST_LABEL)
// ============================================================
// Temuan audit FN-EST_LABEL (REVIEW-03, MEDIUM):
//   project_plans.labor_cost adalah ESTIMASI upah dari WBS Budgeting —
//   rencana yang bisa berubah, BUKAN uang yang sudah dibayar. Namun di
//   beberapa layar angka itu dilabeli "Pengeluaran Riil" / "Actual
//   Tukang", sehingga eksekutif membaca rencana sebagai realisasi.
//
//   Sebaliknya tukang_projects.total_upah (hasil sync Google Sheets tim
//   finance lewat daemon Drive) adalah AKTUAL. Angka itu TIDAK boleh
//   dilabeli estimasi.
//
// Aturan modul ini:
//   1. Dua sumber TIDAK PERNAH dijumlahkan dan tidak saling menggantikan.
//   2. Setiap layar memakai label yang sesuai sumber angkanya.
//   3. Bila aktual belum ada, ditulis "belum ada" — bukan Rp 0.
//
// Modul ini SENGAJA tanpa import (murni, tanpa React/DB/jaringan) supaya
// bisa dipakai komponen Finance/ProjectFinance DAN harness render yang
// mengompilasi komponen itu satu per satu.
//
// CATATAN KESETARAAN: projectKey di sini WAJIB sama dengan projectKey di
// modules/labor-stock/logic.js (huruf kecil, spasi ganda dirapatkan) —
// kalau berbeda, angka aktual "hilang" hanya karena beda kapitalisasi
// nama proyek di sheet. Kesetaraan itu diuji langsung oleh
// scripts/fn-repro/est_label_test.mjs terhadap modul aslinya.
// ============================================================

// Label pendek untuk kartu/kolom.
// FN-EST_LABEL (REVIEW-03): label AKTUAL wajib menyebut sumbernya
// (tukang_projects, tersinkron dari Google Sheets) supaya tidak tertukar
// dengan estimasi WBS yang bentuknya mirip di layar.
export const WBS_ESTIMATE_LABEL = 'Estimasi Upah WBS'
export const ACTUAL_WAGE_LABEL = 'Aktual Upah Tukang (tersinkron)'

// Label panjang untuk kolom tabel / baris dokumen cetak.
export const WBS_ESTIMATE_LONG = 'Estimasi Upah Tukang (WBS Budgeting)'
export const ACTUAL_WAGE_LONG = 'Aktual Upah Tukang (tukang_projects, tersinkron)'

// Keterangan tooltip — dipakai bersama supaya tidak ada layar yang
// menjelaskan sumber angka secara berbeda.
export const WBS_ESTIMATE_NOTE =
  'ESTIMASI rencana dari WBS Budgeting (project_plans.labor_cost). Bukan upah yang sudah dibayar; ' +
  'upah terbayar berasal dari tukang_projects (modul Tukang Upah / Actual Labor & Stok).'
export const ACTUAL_WAGE_NOTE =
  'AKTUAL hasil sync Google Sheets tim finance (tukang_projects.total_upah). Ini uang upah yang ' +
  'sudah tercatat keluar, bukan rencana WBS.'

// Kunci pencocokan project: huruf kecil, tanpa spasi ganda.
// (Setara modules/labor-stock/logic.js#projectKey.)
export function projectKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Normalisasi angka: '' / null / undefined / teks acak -> null.
// null berarti "tidak ada angka", BUKAN 0.
export function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = String(v).trim().replace(/^(rp\.?|idr)\s*/i, '').replace(/\s/g, '')
  if (!/^-?\d[\d.,]*$/.test(s)) return null
  const neg = s.startsWith('-')
  const digits = neg ? s.slice(1) : s
  const commas = (digits.match(/,/g) || []).length
  const dots = (digits.match(/\./g) || []).length
  let n
  if (commas && dots) {
    n = digits.lastIndexOf(',') > digits.lastIndexOf('.')
      ? Number(digits.split('.').join('').replace(',', '.'))
      : Number(digits.split(',').join(''))
  } else if (commas === 1) {
    n = Number(digits.replace(',', '.'))
  } else {
    n = Number(digits.split(',').join(''))
  }
  if (!isFinite(n)) return null
  return neg ? -n : n
}

// Nilai aktual upah untuk satu proyek dari baris tukang_projects.
//
// Mengembalikan null bila TIDAK ADA baris berangka untuk proyek itu —
// "belum ada catatan aktual" bukan "aktual nol rupiah". Hanya baris yang
// benar-benar punya angka total_upah yang dihitung, sama seperti
// actualLaborByProject di modul labor-stock.
export function actualLaborForProject(tukangRows, projectName) {
  const key = projectKey(projectName)
  if (!key) return null
  let actual = 0
  let rows = 0
  for (const r of tukangRows || []) {
    const name = r?.project_name || r?.project
    if (!name || projectKey(name) !== key) continue
    const n = toNumberOrNull(r?.total_upah)
    if (n === null) continue
    actual += n
    rows += 1
  }
  if (rows === 0) return null
  return { actual, rows }
}

// Ringkasan dua sumber untuk satu proyek — dipakai layar yang ingin
// menampilkan estimasi DAN aktual berdampingan tanpa mencampurnya.
export function laborSourcesForProject({ tukangRows, projectName, estimate }) {
  const est = toNumberOrNull(estimate)
  const act = actualLaborForProject(tukangRows, projectName)
  return {
    estimate: est,                    // number | null
    estimateLabel: WBS_ESTIMATE_LABEL,
    actual: act ? act.actual : null,  // number | null (null = belum ada)
    actualLabel: ACTUAL_WAGE_LABEL,
    actualRows: act ? act.rows : 0,
    // Selisih hanya bermakna bila KEDUANYA ada — kalau tidak, null.
    variance: (est !== null && act) ? act.actual - est : null
  }
}
