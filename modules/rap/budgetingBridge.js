// ============================================================
// modules/rap/budgetingBridge.js — JEMBATAN BACA-SAJA ke Budgeting & RAB
// ============================================================
// t_71d95cfe (S3/7). Satu-satunya file di modul RAP yang menyentuh modul
// lain, dan hanya untuk MEMBACA. Tidak ada tulisan ke tabel modul lain.
//
// Dua sumber acuan RAB yang benar-benar ada di aplikasi ini:
//
//  1) RAB & BOQ (modules/rab-boq) — payload JSON client-only (version 5,
//     harga dalam RIBUAN rupiah). Tidak ada tabel DB, jadi RAP hanya bisa
//     menerima payload ini bila user menempel/mengimpor JSON RAB. Fungsi:
//     `rabLinesFromBoqPayload`.
//
//  2) Budgeting (components/Planning.js) — tabel `project_plans` (WBS).
//     Yang tersimpan HANYA volume, satuan, dan `labor_cost` (estimasi UPAH
//     per baris) — TIDAK ada harga satuan material. Fungsi:
//     `rabLinesFromWbsPlans` memberi baris acuan dengan `price_source`
//     'WBS_UPAH' dan menandai bahwa nilai itu HANYA upah, bukan harga
//     pekerjaan penuh. UI wajib menyebutnya apa adanya.
//
// Aturan yang dijaga di sini:
//   * Tidak ada penulisan (insert/update/delete/rpc) ke `project_plans`.
//   * Tidak ada normalisasi angka yang mengarang nilai: field yang tidak
//     ada dibiarkan 0 + `price_source` jujur.
//   * RAB payload yang tidak dikenal DITOLAK dengan alasan, bukan ditebak.
// ============================================================
import { rabPriceToRupiah, roundRupiah, toNumber, lineKey } from './model'

// ------------------------------------------------------------
// 1) RAB & BOQ payload -> baris acuan RAB
// ------------------------------------------------------------
// Payload version 5 (lihat modules/rab-boq/README.md):
//   { version, priceUnit:'thousand IDR (000)', boqReff, revisionNumber,
//     projectName, items:[{ item, area, specs, qty, unit, price, breakdown }] }
// `price` bersatuan ribuan rupiah -> dikonversi ke rupiah penuh di sini
// (SATU tempat konversi, lihat model.rabPriceToRupiah).
export const SUPPORTED_BOQ_VERSIONS = [1, 5]

export function rabLinesFromBoqPayload(payload) {
  const problems = []
  const warnings = []
  if (!payload || typeof payload !== 'object') {
    return { ok: false, lines: [], ref: null, problems: ['Payload RAB kosong atau bukan objek JSON.'], warnings }
  }
  const version = toNumber(payload.version)
  if (version !== null && SUPPORTED_BOQ_VERSIONS.indexOf(version) < 0) {
    problems.push(`Versi payload RAB ${version} tidak dikenal (didukung: ${SUPPORTED_BOQ_VERSIONS.join(', ')}).`)
  }
  const rawItems = Array.isArray(payload.items) ? payload.items : null
  if (!rawItems) {
    return { ok: false, lines: [], ref: null, problems: problems.concat(['Payload RAB tidak punya daftar `items`.']), warnings }
  }

  // version 1 = harga masih rupiah penuh dibagi 1000 (legacy source line 1473)
  const legacy = version === 1
  const lines = []
  rawItems.forEach((raw, idx) => {
    const itemName = String(raw && (raw.item || raw.name) || '').trim()
    if (!itemName) return
    const qty = toNumber(raw.qty)
    const priceThousand = toNumber(raw.price)
    if (qty === null) warnings.push(`Baris RAB "${itemName}" tanpa qty — dianggap 0.`)
    if (priceThousand === null) warnings.push(`Baris RAB "${itemName}" tanpa harga — selisih vs RAP tidak bisa dihitung.`)
    const priceRupiah = priceThousand === null ? 0 : rabPriceToRupiah(priceThousand)
    lines.push({
      id: 'rab-' + idx,
      key: lineKey(itemName, raw.unit),
      item_name: itemName,
      unit: String(raw.unit || '').trim(),
      area: String(raw.area || '').trim(),
      specs: String(raw.specs || '').trim(),
      material_id: null,
      kode: '',
      rab_qty: qty === null ? 0 : qty,
      rab_unit_price: priceRupiah,
      planned_qty: qty === null ? 0 : qty,
      planned_unit_price: priceRupiah,
      price_source: priceRupiah > 0 ? 'RAB' : 'RAB_TANPA_HARGA'
    })
  })

  if (!lines.length) problems.push('Payload RAB tidak berisi satu pun baris pekerjaan yang bisa dipakai.')

  return {
    ok: problems.length === 0,
    lines,
    ref: {
      reff: String(payload.boqReff || '').trim(),
      revision: String(payload.revisionNumber || '').trim(),
      projectName: String(payload.projectName || '').trim(),
      priceUnit: legacy ? 'IDR (legacy v1)' : 'thousand IDR (000)',
      version: version === null ? null : version
    },
    problems,
    warnings
  }
}

// ------------------------------------------------------------
// 2) WBS Budgeting (project_plans) -> baris acuan RAB
// ------------------------------------------------------------
// project_plans kolom: area, item_name, volume, unit, spec, labor_cost,
// status, progress. TIDAK ada harga satuan material.
// `labor_cost` = estimasi TOTAL upah untuk baris itu (bukan harga satuan),
// jadi harga satuan turunan = labor_cost / volume — dan itu HANYA upah.
export function rabLinesFromWbsPlans(plans = []) {
  const warnings = []
  const lines = []
  ;(plans || []).forEach((pl, idx) => {
    const itemName = String(pl && pl.item_name || '').trim()
    if (!itemName) return
    const volume = toNumber(pl.volume)
    const labor = toNumber(pl.labor_cost)
    const unit = String(pl.unit || '').trim()
    const qty = volume === null || volume <= 0 ? 1 : volume
    const unitPrice = labor === null || labor <= 0 ? 0 : roundRupiah(labor / qty)
    lines.push({
      id: 'wbs-' + (pl.id || idx),
      key: lineKey(itemName, unit),
      item_name: itemName,
      unit,
      area: String(pl.area || '').trim(),
      specs: String(pl.spec || '').trim(),
      material_id: null,
      kode: '',
      rab_qty: qty,
      rab_unit_price: unitPrice,
      planned_qty: qty,
      planned_unit_price: unitPrice,
      // Nama sumber sengaja panjang & eksplisit supaya UI tidak bisa
      // menampilkannya sebagai "harga RAB" tanpa penjelasan.
      price_source: unitPrice > 0 ? 'WBS_UPAH' : 'WBS_TANPA_UPAH'
    })
  })
  if (lines.some(l => l.price_source === 'WBS_UPAH')) {
    warnings.push('Acuan dari Budgeting (WBS) hanya memuat estimasi UPAH per baris — belum termasuk material. Total RAB di bawah BUKAN nilai kontrak penuh.')
  }
  if (lines.some(l => l.price_source === 'WBS_TANPA_UPAH')) {
    warnings.push('Sebagian baris WBS belum punya estimasi upah — harga acuannya 0, bukan nol sesungguhnya.')
  }
  return { ok: lines.length > 0, lines, ref: { reff: 'WBS Budgeting', revision: '', projectName: '', priceUnit: 'IDR (upah)', version: null }, problems: lines.length ? [] : ['Proyek ini belum punya baris WBS di Budgeting.'], warnings }
}

// ------------------------------------------------------------
// 3) Baris RAP awal dari baris acuan
// ------------------------------------------------------------
// Rencana awal = RAB apa adanya. Tim lalu mengedit qty/harga rencana.
export function rapLinesFromRab(rabLines = []) {
  return (rabLines || []).map((line, idx) => ({
    ...line,
    id: 'rap-' + idx + '-' + Date.now().toString(36),
    planned_qty: line.rab_qty,
    planned_unit_price: line.rab_unit_price
  }))
}

// ------------------------------------------------------------
// 4) Baca-saja WBS dari Supabase
// ------------------------------------------------------------
// Dipisah dari view supaya mudah diuji dan supaya jelas ini READ-ONLY:
// satu `select` tanpa order kompleks, tanpa join, tanpa RPC.
// Kegagalan TIDAK diubah menjadi array kosong yang menyamar sebagai
// "proyek belum punya WBS" — pemanggil menerima error dan wajib
// menampilkannya.
export async function loadWbsPlans(supabase, projectId) {
  if (!supabase) return { ok: false, plans: [], error: 'Koneksi data belum tersedia.' }
  if (!projectId) return { ok: false, plans: [], error: 'Pilih proyek dulu.' }
  try {
    const { data, error } = await supabase
      .from('project_plans')
      .select('id, project_id, area, item_name, volume, unit, spec, labor_cost, status, progress')
      .eq('project_id', projectId)
    if (error) return { ok: false, plans: [], error: error.message }
    return { ok: true, plans: data || [], error: null }
  } catch (e) {
    return { ok: false, plans: [], error: e.message || 'Gagal membaca WBS Budgeting.' }
  }
}

// ------------------------------------------------------------
// 5) Status kapabilitas (jujur, dipakai UI)
// ------------------------------------------------------------
// Tidak ada tabel RAP di database. Fungsi ini yang membuat UI tidak bisa
// "lupa" menyebutnya.
export const RAP_CAPABILITY = {
  persistence: 'DRAFT_ONLY',
  table: null,
  canSave: false,
  canApprove: false,
  rabSource: 'JSON RAB & BOQ (impor/tempel) atau WBS Budgeting (read-only)',
  reason: 'Belum ada tabel `rap_versions`/RPC penyimpanan dan migrasi sedang dibekukan. Draft RAP hidup di sesi ini + backup JSON manual.'
}
