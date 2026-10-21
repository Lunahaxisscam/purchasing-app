// ============================================================
// modules/receivings/allocationLogic.js — PEMBAGIAN SATU BARIS KE BEBERAPA PROYEK
// ============================================================
// Acceptance Paket 1 butir 4 (OPERATIONAL_BATCH_1.md):
//   "...termasuk nota lintas proyek dan pembagian satu baris ke beberapa
//    proyek. Jangan hanya menyimpan alokasi pada header atau state UI."
//
// Kontrak schema owner (t_2b8dcab3, OPERATIONAL_CONTRACT_v1) yang menjadi
// tujuan data ini:
//   items[i].project_id  XOR  items[i].allocations:[{project_id, qty}]
//   - split WAJIB >= 2 proyek BERBEDA
//   - SUM(qty) HARUS sama dengan quantity_received baris itu
//   - amount dihitung DB = qty * unit_price (bukan dibagi rata)
//   - header proyek NULL untuk split/mixed (tanpa tebakan)
//
// Modul ini MURNI (tanpa React/DB) supaya aturan yang sama dipakai form,
// validasi, payload, dan probe — bukan tiga salinan yang bisa menyimpang.
// ============================================================

export const SPLIT_MIN_PROJECTS = 2
const EPS = 0.001

function toQty(v) {
  if (v === '' || v === null || v === undefined) return NaN
  if (typeof v === 'number') return isFinite(v) ? v : NaN
  const s = String(v).trim().replace(',', '.')
  if (!/^\d*\.?\d+$/.test(s)) return NaN
  const n = Number(s)
  return isFinite(n) ? n : NaN
}

// Baris alokasi baru untuk form. `key` hanya identitas render (bukan data DB).
let seq = 0
export function newAllocationRow({ projectId = '', qty = '' } = {}) {
  seq += 1
  return { key: `al-${seq}`, projectId: projectId || '', qty: qty === null || qty === undefined ? '' : String(qty) }
}

// Ringkasan pembagian: jumlah porsi, total qty, daftar proyek unik.
export function splitSummary(allocations) {
  const list = Array.isArray(allocations) ? allocations : []
  const filled = list.filter(a => a && (a.projectId || String(a.qty ?? '').trim() !== ''))
  const total = filled.reduce((s, a) => {
    const q = toQty(a.qty)
    return s + (isFinite(q) ? q : 0)
  }, 0)
  const projects = [...new Set(filled.map(a => String(a.projectId || '')).filter(Boolean))]
  return {
    count: filled.length,
    // Jumlah proyek BERBEDA — bukan jumlah baris. Dua porsi untuk proyek yang
    // sama BUKAN pembagian (kontrak DB menolak: `allocation_not_exact`).
    distinct: projects.length,
    total: Math.round(total * 1000) / 1000,
    projects
  }
}

// Apakah baris ini memakai jalur split? (ada minimal satu porsi terisi)
export function isSplitRow(item) {
  return !!(item && Array.isArray(item.allocations) && splitSummary(item.allocations).count > 0)
}

// Normalisasi untuk PAYLOAD: hanya porsi sah (proyek + qty > 0).
// Mengembalikan null bila tidak ada porsi sah (berarti baris tunggal).
export function normalizeAllocations(allocations) {
  const list = Array.isArray(allocations) ? allocations : []
  const clean = []
  for (const a of list) {
    const pid = String(a?.projectId || '').trim()
    const q = toQty(a?.qty)
    if (!pid || !isFinite(q) || q <= 0) continue
    clean.push({ projectId: pid, qty: Math.round(q * 1000) / 1000 })
  }
  return clean.length ? clean : null
}

// Validasi pembagian terhadap qty beli baris.
// Mengembalikan { ok, reason, message } — `reason` memakai nama yang SAMA
// dengan yang dikembalikan DB (`allocation_not_exact`,
// `allocation_needs_two_projects`, `allocation_over_bought`) supaya pesan UI
// dan pesan server tidak saling bertentangan.
export function validateSplit({ qty, allocations } = {}) {
  const clean = normalizeAllocations(allocations)
  if (!clean) return { ok: true, reason: '', message: '', allocations: null }
  const q = toQty(qty)
  if (!isFinite(q) || q <= 0) {
    return { ok: false, reason: 'item_qty', message: 'Isi qty beli dulu sebelum membagi ke proyek.', allocations: clean }
  }
  const projects = new Set(clean.map(a => a.projectId))
  if (projects.size < SPLIT_MIN_PROJECTS) {
    return {
      ok: false,
      reason: 'allocation_needs_two_projects',
      message: `Pembagian baris butuh minimal ${SPLIT_MIN_PROJECTS} proyek BERBEDA. Untuk satu proyek, gunakan pilihan proyek biasa (bukan pembagian).`,
      allocations: clean
    }
  }
  const sum = Math.round(clean.reduce((s, a) => s + a.qty, 0) * 1000) / 1000
  if (Math.abs(sum - q) > EPS) {
    return {
      ok: false,
      reason: 'allocation_not_exact',
      message: `Jumlah pembagian (${sum}) harus SAMA dengan qty beli (${q}). Sisa ${Math.round((q - sum) * 1000) / 1000} belum dibagikan.`,
      allocations: clean,
      sum,
      qty: q
    }
  }
  if (sum > q + EPS) {
    return {
      ok: false,
      reason: 'allocation_over_bought',
      message: `Jumlah pembagian (${sum}) melebihi qty beli (${q}).`,
      allocations: clean,
      sum,
      qty: q
    }
  }
  return { ok: true, reason: '', message: '', allocations: clean, sum, qty: q }
}

// Bagi qty secara proporsional untuk tombol "isi otomatis" — HANYA usulan,
// admin tetap bisa mengubah. Pembulatan sisa ditaruh di porsi terakhir supaya
// totalnya PERSIS sama dengan qty (bukan sisa 0.001 yang membuat DB menolak).
export function suggestSplit(qty, projectIds = []) {
  const q = toQty(qty)
  const ids = [...new Set((projectIds || []).map(String).filter(Boolean))]
  if (!isFinite(q) || q <= 0 || ids.length < 2) return []
  const base = Math.floor((q / ids.length) * 1000) / 1000
  const rows = ids.map((pid, i) => ({
    projectId: pid,
    qty: i === ids.length - 1 ? Math.round((q - base * (ids.length - 1)) * 1000) / 1000 : base
  }))
  return rows
}
