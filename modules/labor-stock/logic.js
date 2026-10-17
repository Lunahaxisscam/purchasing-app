// ============================================================
// modules/labor-stock/logic.js — LOGIKA MURNI (t_62e41e91)
// ============================================================
// Dashboard "Actual Labor & Workshop Stock" — READ-ONLY.
//
// ATURAN UTAMA (arahan task S5): BEDAKAN ESTIMASI vs AKTUAL.
//   ESTIMASI = rencana yang bisa berubah (project_plans.labor_cost).
//   AKTUAL   = uang yang benar-benar sudah tercatat keluar untuk upah
//              (tukang_projects.total_upah, hasil sync Google Sheets
//              milik tim finance lewat daemon Drive sync).
// Keduanya TIDAK pernah dijumlahkan, tidak saling ditukar, dan tidak
// ada angka aktual yang dirampas dari estimasi.
//
// KEJUJURAN ANGKA:
//   - Sumber tidak dikirim host (undefined/null) -> capability
//     'unavailable'. Halaman BILANG itu; BUKAN daftar kosong.
//   - Sumber dikirim tapi kosong ([]) -> capability 'empty'.
//   - Nilai tidak ada di baris -> null / UNAVAILABLE_LABEL,
//     BUKAN 0 (0 terbaca "aktual nol rupiah").
//   - Selisih hanya dihitung bila KEDUA angka ada.
//
// TIDAK ADA penulisan DB, tidak ada schema baru, tidak ada jaringan.
// ============================================================

export const UNAVAILABLE_LABEL = 'Tidak tersedia'
export const ESTIMATE_LABEL = 'Estimasi'
export const ACTUAL_LABEL = 'Aktual'

// ------------------------------------------------------------
// Normalisasi angka: '' / null / undefined / teks acak -> null
// (BUKAN 0 yang menyesatkan).
//
// Menerima dua gaya penulisan yang benar-benar muncul di data
// finance perusahaan:
//   - pemisah ribuan titik + desimal koma : "3.000.000,50"
//   - pemisah ribuan koma + desimal titik : "3,000,000.50"
// Angka desimal polos "12,5" tetap dihitung 12,5 (konvensi ID).
// Teks berisi satuan ("12 pcs") atau campuran tetap -> null.
// ------------------------------------------------------------
export function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  let s = String(v).trim()
  if (s === '') return null
  // Buang awalan mata uang / spasi yang ikut terbawa dari sheet.
  s = s.replace(/^(rp\.?|idr)\s*/i, '').replace(/\s/g, '')
  if (!/^-?\d[\d.,]*$/.test(s)) return null
  const neg = s.startsWith('-')
  const digits = neg ? s.slice(1) : s
  const commas = (digits.match(/,/g) || []).length
  const dots = (digits.match(/\./g) || []).length
  let n
  if (commas && dots) {
    // Dua pemisah berbeda: yang paling BELAKANG adalah desimal.
    if (digits.lastIndexOf(',') > digits.lastIndexOf('.')) {
      // gaya Indonesia: "1.500.000,50"
      n = Number(digits.split('.').join('').replace(',', '.'))
    } else {
      // gaya internasional: "1,500,000.50"
      n = Number(digits.split(',').join(''))
    }
  } else if (commas || dots) {
    const sep = commas ? ',' : '.'
    const parts = digits.split(sep)
    if (parts.length > 2) {
      // lebih dari satu pemisah sama -> pasti pemisah ribuan.
      n = Number(digits.split(sep).join(''))
    } else if (sep === '.') {
      // "12.5" = desimal, tapi "1.500" = ribuan (data rupiah).
      n = parts[1].length === 3 && parts[0].length > 0
        ? Number(digits.split('.').join(''))
        : Number(digits)
    } else {
      // "12,5" = desimal; "1,500" = ribuan.
      n = parts[1].length === 3
        ? Number(digits.split(',').join(''))
        : Number(digits.replace(',', '.'))
    }
  } else {
    n = Number(digits)
  }
  if (!isFinite(n)) return null
  return neg ? -n : n
}
export function hasNumber(v) {
  return toNumberOrNull(v) !== null
}

// Teks aman: kosong -> null (biar UI memilih label "Tidak tersedia").
export function textOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// ------------------------------------------------------------
// CAPABILITY SUMBER DATA
//   'unavailable' : host tidak mengirim array (tabel/RLS belum ada)
//   'empty'       : array dikirim, isinya kosong
//   'ready'       : array dikirim dan ada baris
// ------------------------------------------------------------
export function sourceCapability(raw) {
  if (raw === null || raw === undefined) return 'unavailable'
  if (!Array.isArray(raw)) return 'unavailable'
  return raw.length === 0 ? 'empty' : 'ready'
}

export const CAPABILITY_COPY = {
  unavailable: {
    title: 'Sumber data belum dikirim ke halaman ini',
    body:
      'Tabel yang dipakai dashboard ini belum dimuat oleh aplikasi. ' +
      'Tidak ada angka yang ditampilkan sebagai gantinya — bukan daftar kosong yang terlihat seperti bug.'
  },
  empty: {
    title: 'Belum ada data tercatat',
    body:
      'Sumber data sudah tersedia, tetapi belum ada satu pun baris yang tercatat. ' +
      'Angka tetap kosong sampai ada catatan upah aktual.'
  },
  ready: {
    title: '',
    body: ''
  }
}

// ------------------------------------------------------------
// BARIS AKTUAL LABOR — dari tukang_projects (List Proyek per tukang).
//   tukang_key, project_name, total_upah, status, batch
// ESTIMASI LABOR — dari project_plans (WBS/penugasan).
//   project_id, item_name, labor_cost, status, worker_name
// Keduanya dikunci lewat nama project (project_name vs project.name).
// ------------------------------------------------------------
export function laborTukangName(t) {
  return textOrNull(t?.tukang_key) || textOrNull(t?.tukang) || UNAVAILABLE_LABEL
}

export function laborProjectName(r) {
  return textOrNull(r?.project_name) || textOrNull(r?.project) || UNAVAILABLE_LABEL
}

// Kunci pencocokan project: huruf kecil, tanpa spasi ganda.
export function projectKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Jumlah aktual per project dari baris tukang_projects.
// Hanya baris yang BENAR-BENAR punya angka total_upah yang menghasilkan
// entri. Baris tanpa angka TIDAK membuat project bernilai 0 — "belum ada
// catatan angka" bukan "aktual nol rupiah", jadi project hanya masuk peta
// bila minimal satu barisnya punya angka.
export function actualLaborByProject(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const n = toNumberOrNull(r?.total_upah)
    if (n === null) continue
    const key = projectKey(laborProjectName(r))
    if (key === '') continue
    const prev = map.get(key) || { project: laborProjectName(r), rows: 0, actual: 0, adaAngka: 0 }
    prev.rows += 1
    prev.actual += n
    prev.adaAngka += 1
    map.set(key, prev)
  }
  return map
}

// Jumlah estimasi per project dari baris project_plans.
//
// CATATAN SKEMA (jangan diubah tanpa migrasi): project_plans memakai
// `project_id` (FK ke projects), BUKAN `project_name`. Baris mentah dari
// Supabase tidak punya nama project, jadi pencocokan dengan aktual
// (tukang_projects.project_name) memerlukan peta id -> nama yang
// dikirim host lewat `projectNames`. Kalau peta tidak dikirim, estimasi
// dianggap TIDAK DIKIRIM (null) — tidak dikarang dan tidak dipaksa
// cocok dengan nama yang keliru.
export function estimateLaborByProject(rows, projectNames = null) {
  if (!projectNames || typeof projectNames.get !== 'function') return null
  const map = new Map()
  for (const r of rows || []) {
    const name = projectNames.get(r?.project_id)
    if (!name) continue
    const key = projectKey(name)
    if (key === '') continue
    const n = toNumberOrNull(r?.labor_cost)
    const prev = map.get(key) || { project: name, rows: 0, estimate: 0, adaAngka: 0 }
    prev.rows += 1
    if (n !== null) { prev.estimate += n; prev.adaAngka += 1 }
    map.set(key, prev)
  }
  return map
}

// Peta id -> nama project untuk join estimasi.
export function projectNameMap(projects) {
  const m = new Map()
  for (const p of projects || []) {
    if (p?.id && p?.name) m.set(p.id, p.name)
  }
  return m
}

// ------------------------------------------------------------
// STATUS KELENGKAPAN per project — inti "status kelengkapan".
//   'LENGKAP'        : ada estimasi DAN ada aktual -> bisa dibandingkan
//   'AKTUAL_SAJA'    : ada aktual, estimasi tidak dikirim
//   'ESTIMASI_SAJA'  : ada estimasi, aktual belum tercatat
//   'KOSONG'         : keduanya tidak ada
// ------------------------------------------------------------
export function laborCompleteness({ estimate, actual, estimateSent, actualSent }) {
  const hasEstimate = hasNumber(estimate)
  const hasActual = hasNumber(actual)
  if (hasEstimate && hasActual) {
    const e = toNumberOrNull(estimate)
    const a = toNumberOrNull(actual)
    const diff = a - e
    return {
      state: 'LENGKAP',
      label: 'Estimasi & aktual lengkap',
      estimate: e,
      actual: a,
      diff,
      diffPct: e !== 0 ? (diff / e) * 100 : null
    }
  }
  if (hasActual) {
    return {
      state: 'AKTUAL_SAJA',
      label: 'Aktual saja — estimasi belum dikirim',
      estimate: null,
      actual: toNumberOrNull(actual),
      diff: null,
      diffPct: null
    }
  }
  if (hasEstimate) {
    return {
      state: 'ESTIMASI_SAJA',
      label: 'Estimasi saja — aktual belum tercatat',
      estimate: toNumberOrNull(estimate),
      actual: null,
      diff: null,
      diffPct: null
    }
  }
  if (!estimateSent && !actualSent) {
    return { state: 'KOSONG', label: 'Sumber belum dikirim', estimate: null, actual: null, diff: null, diffPct: null }
  }
  return { state: 'KOSONG', label: 'Angka belum tercatat', estimate: null, actual: null, diff: null, diffPct: null }
}

// ------------------------------------------------------------
// FILTER project / period (periode = label batch/tanggal cut-off).
// ------------------------------------------------------------
export function laborPeriodOptions(rows) {
  const seen = new Map()
  for (const r of rows || []) {
    const p = textOrNull(r?.batch) || textOrNull(r?.period) || textOrNull(r?.periode)
    if (p === null) continue
    const key = p.toLowerCase()
    if (!seen.has(key)) seen.set(key, p)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'))
}

export function filterLaborRows({ rows = [], project = 'all', period = 'all', query = '' }) {
  const q = String(query || '').trim().toLowerCase()
  return rows.filter(r => {
    if (project && project !== 'all') {
      if (projectKey(laborProjectName(r)) !== projectKey(project)) return false
    }
    if (period && period !== 'all') {
      const p = textOrNull(r?.batch) || textOrNull(r?.period) || textOrNull(r?.periode)
      if (p === null || p.toLowerCase() !== String(period).toLowerCase()) return false
    }
    if (q) {
      const hay = `${laborProjectName(r)} ${laborTukangName(r)} ${textOrNull(r?.status) || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ------------------------------------------------------------
// RINGKASAN (KPI). Sengaja TIDAK menjumlah estimasi + aktual.
// ------------------------------------------------------------
export function summarizeLabor({ actualRows = [], estimateRows = null, projectNames = null }) {
  const actualMap = actualLaborByProject(actualRows)
  const estMap = estimateRows === null || estimateRows === undefined
    ? null
    : estimateLaborByProject(estimateRows, projectNames)

  let actualTotal = 0
  let actualRowsAngka = 0
  let actualProjects = 0
  let actualTanpaAngka = 0
  for (const v of actualMap.values()) {
    if (v.adaAngka > 0) { actualProjects += 1; actualTotal += v.actual }
    else actualTanpaAngka += 1
  }
  for (const r of actualRows || []) if (hasNumber(r?.total_upah)) actualRowsAngka += 1

  let estimateTotal = null
  let estimateProjects = null
  if (estMap) {
    estimateTotal = 0
    estimateProjects = 0
    for (const v of estMap.values()) {
      if (v.adaAngka > 0) { estimateProjects += 1; estimateTotal += v.estimate }
    }
  }

  return {
    actualProjects,
    actualTotal,
    actualRows: (actualRows || []).length,
    actualRowsAngka,
    actualTanpaAngka,
    estimateProjects,
    estimateTotal,
    estimateSent: estMap !== null
  }
}

// ------------------------------------------------------------
// CSV — hanya baris & kolom yang sudah tampil. Nilai yang tidak
// ada diekspor sebagai string KOSONG, BUKAN 0.
// ------------------------------------------------------------
export function toCsv(rows) {
  const esc = v => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Tukang', 'Project', 'Total Upah Aktual', 'Status', 'Batch', 'Kelengkapan']
  const lines = [head.join(',')]
  for (const r of rows || []) {
    const c = laborCompleteness({
      estimate: null,
      actual: r?.total_upah,
      estimateSent: false,
      actualSent: true
    })
    lines.push([
      laborTukangName(r),
      laborProjectName(r),
      toNumberOrNull(r?.total_upah) === null ? '' : toNumberOrNull(r?.total_upah),
      textOrNull(r?.status) || '',
      textOrNull(r?.batch) || '',
      c.label
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

// Ringkasan keterbatasan data untuk ditampilkan di UI.
export const DATA_LIMITATIONS = [
  'Aktual labor berasal dari tukang_projects (sinkron Google Sheets milik tim finance), bukan dari perhitungan aplikasi ini.',
  'Estimasi labor berasal dari project_plans.labor_cost (rencana) — keduanya tidak pernah dijumlahkan.',
  'Tidak ada tabel kartu upah/ledger per tanggal: riwayat pembayaran bertahap dan saldo berjalan belum bisa ditampilkan.',
  'Nilai yang tidak tercatat dibiarkan kosong ("Tidak tersedia"), bukan 0, supaya tidak terbaca sebagai "aktual nol rupiah".'
]
