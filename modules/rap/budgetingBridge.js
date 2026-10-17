// ============================================================
// modules/rap/budgetingBridge.js — JEMBATAN BACA-SAJA ke Budgeting & RAB
// ============================================================
// t_71d95cfe (S3/7), diperkeras t_3b877fb5 (temuan Brooklyn P1). Satu-satunya
// file di modul RAP yang menyentuh modul lain, dan hanya untuk MEMBACA. Tidak
// ada tulisan ke tabel modul lain.
//
// Tiga sumber acuan yang benar-benar ada di aplikasi ini:
//
//  1) RAB & BOQ (modules/rab-boq) — payload JSON client-only (version 5,
//     harga dalam RIBUAN rupiah). Tidak ada tabel DB, jadi RAP hanya bisa
//     menerima payload ini bila user menempel/mengimpor JSON RAB. Fungsi:
//     `rabLinesFromBoqPayload`.
//     PENTING: harga di RAB & BOQ adalah HARGA JUAL penawaran (sudah
//     mengandung markup/PPN pada total), bukan biaya. Baris hasil konversi
//     ditandai `price_basis: 'RAB_SELL_PRICE'` dan `line_kind: 'WORK_ITEM'`
//     (baris BOQ = pekerjaan/barang jadi, BUKAN material baku).
//
//  2) Budgeting (components/Planning.js) — tabel `project_plans` (WBS).
//     Yang tersimpan HANYA volume, satuan, dan `labor_cost` (estimasi UPAH
//     per baris) — TIDAK ada harga satuan material. Fungsi:
//     `rabLinesFromWbsPlans` memberi baris acuan dengan `price_source`
//     'WBS_UPAH' dan `price_basis: 'WBS_LABOR_ONLY'` serta menandai bahwa
//     nilai itu HANYA upah, bukan harga pekerjaan penuh.
//
//  3) Master material (`materials`) — BACA-SAJA, dipakai untuk MEMVERIFIKASI
//     tautan material_id + satuan + skala harga pada handoff PR material.
//     Fungsi: `loadMaterialsCatalog`. Tanpa katalog ini handoff material
//     DIBLOKIR (tidak ada tebakan).
//
// Aturan yang dijaga di sini:
//   * Tidak ada penulisan (insert/update/delete/rpc) ke tabel mana pun.
//   * Tidak ada koersi angka yang mengarang nilai: harga negatif / bukan
//     angka DITOLAK dengan alasan (bukan di-clamp jadi 0, bukan NaN).
//   * RAB payload yang tidak dikenal DITOLAK dengan alasan, bukan ditebak.
//   * Tidak ada heuristik nama barang: jenis baris ditentukan payload/manusia.
// ============================================================
import {
  LINE_KIND,
  MONEY,
  PRICE_BASIS,
  inspectNumber,
  lineKey,
  normalizeLine,
  rabPriceToRupiah,
  roundRupiah,
  toNumber
} from './model'

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

  // version 1 = harga masih rupiah penuh (legacy source line 1473)
  const legacy = version === 1
  const lines = []
  const rejected = []
  rawItems.forEach((raw, idx) => {
    const itemName = String(raw && (raw.item || raw.name) || '').trim()
    if (!itemName) return

    const qtyCheck = inspectNumber(raw.qty)
    const priceCheck = inspectNumber(raw.price)
    const label = `Baris RAB "${itemName}"`

    // QTY: negatif / bukan angka DITOLAK (bukan dijadikan 0).
    if (qtyCheck.state === MONEY.NEGATIVE || qtyCheck.state === MONEY.NOT_NUMBER) {
      rejected.push(`${label}: qty tidak valid ("${String(raw.qty)}") — ditolak, bukan dijadikan 0.`)
      return
    }
    if (qtyCheck.state === MONEY.MISSING) {
      warnings.push(`${label} tanpa qty — dianggap belum diisi (0).`)
    }

    // HARGA: negatif / bukan angka DITOLAK. Ini inti temuan Brooklyn:
    // nilai negatif tidak boleh berubah menjadi 0 lalu lolos validasi.
    if (priceCheck.state === MONEY.NEGATIVE) {
      rejected.push(`${label}: harga negatif (${String(raw.price)}) — DITOLAK, tidak dijadikan 0.`)
      return
    }
    if (priceCheck.state === MONEY.NOT_NUMBER) {
      rejected.push(`${label}: harga bukan angka ("${String(raw.price)}") — DITOLAK.`)
      return
    }
    if (priceCheck.state === MONEY.MISSING) {
      warnings.push(`${label} tanpa harga — selisih vs RAP tidak bisa dihitung untuk baris ini.`)
    }

    const qty = qtyCheck.state === MONEY.MISSING ? null : qtyCheck.value
    const priceThousand = priceCheck.state === MONEY.MISSING ? null : priceCheck.value
    const priceRupiah = priceThousand === null ? null : rabPriceToRupiah(priceThousand)

    lines.push({
      id: 'rab-' + idx,
      key: lineKey(itemName, raw.unit),
      item_name: itemName,
      unit: String(raw.unit || '').trim(),
      area: String(raw.area || '').trim(),
      specs: String(raw.specs || '').trim(),
      // Baris BOQ adalah PEKERJAAN / barang jadi — bukan material baku.
      // Kalau suatu saat ada BOM, ia datang dari sumber lain yang eksplisit.
      line_kind: LINE_KIND.WORK_ITEM,
      material_id: null,
      kode: '',
      rab_qty: qty,
      rab_qty_state: qtyCheck.state,
      rab_unit_price: priceRupiah,
      rab_unit_price_state: priceRupiah === null ? MONEY.MISSING : (priceRupiah === 0 ? MONEY.ZERO : MONEY.OK),
      planned_qty: qty,
      planned_qty_state: qtyCheck.state,
      planned_unit_price: priceRupiah,
      planned_unit_price_state: priceRupiah === null ? MONEY.MISSING : (priceRupiah === 0 ? MONEY.ZERO : MONEY.OK),
      // Sumber angka: HARGA JUAL penawaran RAB (bukan biaya).
      price_source: priceRupiah === null ? 'RAB_TANPA_HARGA' : 'RAB',
      price_basis: PRICE_BASIS.RAB_SELL_PRICE
    })
  })

  if (rejected.length) problems.push(...rejected)
  if (!lines.length) problems.push('Payload RAB tidak berisi satu pun baris pekerjaan yang bisa dipakai.')
  if (lines.length) {
    warnings.push('Harga RAB & BOQ adalah HARGA JUAL penawaran (sudah mengandung margin), sedangkan RAP adalah biaya pelaksanaan. Perbandingan RAB vs RAP = indikasi margin, BUKAN perbandingan biaya-vs-biaya (bukan apel-vs-apel).')
    warnings.push('Baris RAB & BOQ adalah pekerjaan/barang jadi. Untuk PR material, pecah menjadi baris material baku (BOM) dengan material_id + satuan — RAP tidak memecah otomatis dan tidak menebak material dari nama barang.')
  }

  return {
    ok: problems.length === 0,
    lines,
    ref: {
      reff: String(payload.boqReff || '').trim(),
      revision: String(payload.revisionNumber || '').trim(),
      projectName: String(payload.projectName || '').trim(),
      priceUnit: legacy ? 'IDR (legacy v1)' : 'thousand IDR (000)',
      priceBasis: PRICE_BASIS.RAB_SELL_PRICE,
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
  const problems = []
  const lines = []
  ;(plans || []).forEach((pl, idx) => {
    const itemName = String(pl && pl.item_name || '').trim()
    if (!itemName) return
    const volumeCheck = inspectNumber(pl.volume)
    const laborCheck = inspectNumber(pl.labor_cost)
    const unit = String(pl.unit || '').trim()
    const label = `Baris WBS "${itemName}"`

    if (volumeCheck.state === MONEY.NEGATIVE || volumeCheck.state === MONEY.NOT_NUMBER) {
      problems.push(`${label}: volume tidak valid ("${String(pl.volume)}") — ditolak, bukan dijadikan 1.`)
      return
    }
    if (laborCheck.state === MONEY.NEGATIVE || laborCheck.state === MONEY.NOT_NUMBER) {
      problems.push(`${label}: labor_cost tidak valid ("${String(pl.labor_cost)}") — ditolak, bukan dijadikan 0.`)
      return
    }

    const volume = volumeCheck.state === MONEY.MISSING ? null : volumeCheck.value
    const labor = laborCheck.state === MONEY.MISSING ? null : laborCheck.value
    const qty = volume === null || volume <= 0 ? 1 : volume
    const unitPrice = labor === null || labor <= 0 ? null : roundRupiah(labor / qty)
    lines.push({
      id: 'wbs-' + (pl.id || idx),
      key: lineKey(itemName, unit),
      item_name: itemName,
      unit,
      area: String(pl.area || '').trim(),
      specs: String(pl.spec || '').trim(),
      // WBS adalah baris PEKERJAAN dengan estimasi upah — bukan material baku.
      line_kind: LINE_KIND.WORK_ITEM,
      material_id: null,
      kode: '',
      rab_qty: qty,
      rab_qty_state: MONEY.OK,
      rab_unit_price: unitPrice,
      rab_unit_price_state: unitPrice === null ? MONEY.MISSING : MONEY.OK,
      planned_qty: qty,
      planned_qty_state: MONEY.OK,
      planned_unit_price: unitPrice,
      planned_unit_price_state: unitPrice === null ? MONEY.MISSING : MONEY.OK,
      // Nama sumber sengaja panjang & eksplisit supaya UI tidak bisa
      // menampilkannya sebagai "harga RAB" tanpa penjelasan.
      price_source: unitPrice === null ? 'WBS_TANPA_UPAH' : 'WBS_UPAH',
      price_basis: PRICE_BASIS.WBS_LABOR_ONLY
    })
  })
  if (lines.some(l => l.price_source === 'WBS_UPAH')) {
    warnings.push('Acuan dari Budgeting (WBS) hanya memuat estimasi UPAH per baris — belum termasuk material. Total RAB di bawah BUKAN nilai kontrak penuh dan tidak sebanding dengan biaya material RAP.')
  }
  if (lines.some(l => l.price_source === 'WBS_TANPA_UPAH')) {
    warnings.push('Sebagian baris WBS belum punya estimasi upah — harga acuannya TIDAK TERSEDIA (bukan nol sesungguhnya).')
  }
  if (lines.length) {
    warnings.push('Baris WBS adalah pekerjaan, bukan material baku. Untuk PR material, tambahkan baris material (BOM) dengan material_id + satuan dari master material.')
  }
  return {
    ok: lines.length > 0 && problems.length === 0,
    lines,
    ref: { reff: 'WBS Budgeting', revision: '', projectName: '', priceUnit: 'IDR (upah)', priceBasis: PRICE_BASIS.WBS_LABOR_ONLY, version: null },
    problems: lines.length ? problems : problems.concat(['Proyek ini belum punya baris WBS di Budgeting.']),
    warnings
  }
}

// ------------------------------------------------------------
// 3) Baris RAP awal dari baris acuan
// ------------------------------------------------------------
// Rencana awal = RAB apa adanya. Tim lalu mengedit qty/harga rencana DAN
// menandai jenis baris (`line_kind`) — penandaan jenis TIDAK pernah otomatis.
export function rapLinesFromRab(rabLines = []) {
  return (rabLines || []).map((line, idx) => normalizeLine({
    ...line,
    id: 'rap-' + idx + '-' + Date.now().toString(36),
    planned_qty: line.rab_qty,
    planned_unit_price: line.rab_unit_price,
    planned_qty_state: line.rab_qty_state,
    planned_unit_price_state: line.rab_unit_price_state
  }))
}

// Baris material baku buatan manusia (BOM). Dipakai UI saat user menambah
// baris material secara eksplisit; TIDAK dipanggil otomatis dari baris RAB.
export function newMaterialLine(material, opts = {}) {
  const m = material || {}
  const unit = String((m.satuan == null ? m.unit : m.satuan) || '').trim()
  const price = toNumber(opts.unit_price)
  return normalizeLine({
    item_name: String(m.name || m.nama || opts.item_name || '').trim(),
    unit,
    line_kind: LINE_KIND.MATERIAL,
    material_id: m.id == null ? null : m.id,
    kode: String(m.kode || m.code || '').trim(),
    rab_qty: 0,
    rab_unit_price: 0,
    planned_qty: opts.qty == null ? 1 : opts.qty,
    planned_unit_price: price === null ? (toNumber(m.harga_acuan) === null ? 0 : toNumber(m.harga_acuan)) : price,
    price_source: 'MANUAL',
    price_basis: PRICE_BASIS.MANUAL
  })
}

// ------------------------------------------------------------
// 4) Baca-saja: WBS dari Supabase + katalog master material
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

// Katalog master material = SATU-SATUNYA sumber kebenaran untuk
// material_id / satuan / skala harga pada handoff PR material.
// Baca-saja: satu select, tanpa join, tanpa RPC, tanpa filter proyek
// (material master bersifat global). Kegagalan dikembalikan apa adanya —
// bukan array kosong yang menyamar sebagai "belum ada material".
export async function loadMaterialsCatalog(supabase) {
  if (!supabase) return { ok: false, materials: [], error: 'Koneksi data belum tersedia.' }
  try {
    const { data, error } = await supabase
      .from('materials')
      .select('id, kode, code, name, category, satuan, unit, harga_acuan')
    if (error) return { ok: false, materials: [], error: error.message }
    return { ok: true, materials: data || [], error: null }
  } catch (e) {
    return { ok: false, materials: [], error: e.message || 'Gagal membaca katalog material.' }
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
  bomGate: 'PR material hanya menerima baris MATERIAL BAKU dengan material_id + satuan + qty positif yang terverifikasi ke master material. Pekerjaan/upah/barang jadi DITOLAK dengan penjelasan — tidak ditebak dari nama barang, tidak dipecah otomatis.',
  reason: 'Belum ada tabel `rap_versions`/RPC penyimpanan dan migrasi sedang dibekukan. Draft RAP hidup di sesi ini + backup JSON manual.',
  warning: 'Harga RAB & BOQ adalah harga JUAL penawaran; RAP adalah biaya pelaksanaan. Selisih = indikasi margin, bukan perbandingan biaya-vs-biaya.'
}

// Label sumber acuan untuk ditampilkan UI (satu sumber, tidak diduplikasi
// di view supaya tidak ada dua versi klaim yang berbeda).
export function baselineBadgeText(baseline) {
  if (!baseline) return 'Sumber acuan tidak diketahui'
  return String(baseline.label || baseline.kind || 'Sumber acuan tidak diketahui')
}
