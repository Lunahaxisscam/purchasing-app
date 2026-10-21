// ============================================================
// modules/handovers/logic.js — LOGIKA MURNI ANTREAN DISTRIBUSI FISIK
// ============================================================
// Tanpa React, tanpa query DB. Dipakai oleh page.jsx / view.jsx dan diuji
// VERBATIM oleh scripts/handover-flow-test/logic_test.mjs (sandbox, tanpa DB).
//
// TANGGUNG JAWAB MODUL HANDOVER (arahan DAT):
//   Purchase = admin belanja kantor (berhenti saat barang dibeli).
//   Handover = DISTRIBUSI FISIK barang yang sudah dibeli:
//     a) kirim ke GUDANG  -> barang masuk stok
//     b) kirim ke TUKANG  -> barang keluar ke tukang/proyek
//     c) tandai DITERIMA  -> bukti fisik penyerahan diterima (diserahkan_at)
//
// KOLOM DB YANG DIPAKAI (dibekukan — tidak ada kolom baru):
//   handovers.diserahkan_at        : timestamp penyerahan diterima (NOT NULL = sudah)
//   receivings.alokasi             : 'KE_GUDANG' | 'KE_TUKANG' | 'LANGSUNG_LAPANGAN' | null
//   receivings.masuk_gudang        : boolean, sudah masuk gudang?
//   receivings.tukang_at           : timestamp dikirim ke tukang (NOT NULL = sudah)
//   pr_items.status                : 'ORDERED' | 'APPROVED' | 'RECEIVED' | 'DI_GUDANG' | 'DI_TUKANG'
// ============================================================

// Tiga aksi distribusi fisik. Kunci dipakai sebagai id & suffix testid.
export const ACT_GUDANG = 'gudang'
export const ACT_TUKANG = 'tukang'
export const ACT_TERIMA = 'terima'

export const ACTIONS = [
  // Label "Tandai Masuk Gudang" — BUKAN "Masuk Stok Gudang" (run 212 / BUG-R3):
  // aksi ini hanya menulis `receivings.masuk_gudang` + status `pr_items`
  // (DI_GUDANG). Ia TIDAK memanggil RPC `receive_to_warehouse`, satu-satunya
  // penulis `materials.current_stock`, jadi stok material TIDAK bertambah.
  // Label lama menjanjikan efek yang tidak terjadi.
  { key: ACT_GUDANG, label: 'Tandai Masuk Gudang', icon: '📦', testid: 'act-gudang' },
  { key: ACT_TUKANG, label: 'Serah Terima ke Tukang', icon: '👷', testid: 'act-tukang' },
  { key: ACT_TERIMA, label: 'Tandai Diserahkan', icon: '✅', testid: 'act-terima' }
]

// Status pr_items yang dianggap "sudah dibeli" (punya nota belanja) sehingga
// barangnya layak masuk antrean distribusi fisik.
const BOUGHT_STATUSES = ['RECEIVED', 'DI_GUDANG', 'DI_TUKANG']

// Status item yang berarti sudah masuk gudang.
// CATATAN: DI_TUKANG TIDAK dihitung "di gudang" lagi di sini — item yang
// dikirim ke tukang SUDAH keluar dari gudang, jadi menghitungnya dua kali
// akan membuat `done` melebihi total dan ringkasan "semua selesai" muncul
// padahal masih ada barang yang belum bergerak.
const IN_WAREHOUSE_STATUSES = ['DI_GUDANG']

// Alokasi nota yang berarti barang diarahkan ke tukang/lapangan.
const TUKANG_ALOKASI = ['KE_TUKANG', 'LANGSUNG_LAPANGAN']

function normStatus(s) {
  return String(s || '').trim().toUpperCase()
}

// ------------------------------------------------------------
// 1) ANTREAN — baris mana yang masuk daftar distribusi fisik
// ------------------------------------------------------------
// Baris antrean = handover DRAFT (belum diserahkan) yang nota pembeliannya
// sudah lengkap/tercatat. Handover yang sudah punya diserahkan_at TIDAK
// diantre (sudah selesai; tetap terlihat di daftar utama modul).
export function isDistributionQueued(handover) {
  return !!(handover && handover.id && !handover.diserahkan_at)
}

// Sumber data tunggal untuk daftar antrean: urut berdasarkan tanggal
// handover terbaru supaya pekerjaan paling akhir terlihat di atas.
export function buildDistributionQueue(handovers) {
  const rows = (handovers || []).filter(isDistributionQueued)
  return rows.sort((a, b) => String(b.handover_date || '').localeCompare(String(a.handover_date || '')))
}

// ------------------------------------------------------------
// 2) STATUS ITIS — ringkasan progres distribusi satu handover
// ------------------------------------------------------------
// Menghitung berapa item yang sudah masuk gudang / sudah ke tukang dari
// receiving_items milik nota terkait, supaya banner bisa bilang
// "3 dari 8 barang sudah masuk gudang".
export function summarizeDistribution(handover, receivingItems = [], prItems = []) {
  const items = receivingItems || []
  const prById = new Map((prItems || []).map(p => [p.id, p]))
  let total = 0
  let inWarehouse = 0
  let sentToTukang = 0

  for (const it of items) {
    const prItem = prById.get(it.pr_item_id)
    const ordered = Number(prItem?.quantity)
    const qty = isFinite(ordered) && ordered > 0 ? ordered : 0
    total += qty

    const st = normStatus(prItem?.status)
    if (IN_WAREHOUSE_STATUSES.includes(st)) inWarehouse += qty
    if (st === 'DI_TUKANG') sentToTukang += qty
  }

  const done = inWarehouse + sentToTukang
  return {
    total,
    inWarehouse,
    sentToTukang,
    done,
    remaining: Math.max(0, total - done),
    allDone: total > 0 && done >= total
  }
}

// ------------------------------------------------------------
// 3) AKSI YANG BOLEH DIJALANKAN — penjaga state tiap tombol
// ------------------------------------------------------------
// Tiap aksi mengembalikan { ok, reason }. reason '' = boleh jalan.
// Aturan:
//   GUDANG : handover belum diserahkan, nota BELUM bertanda masuk gudang,
//            dan item belum ada yang sudah DI_GUDANG (idempoten).
//   TUKANG : handover belum diserahkan, item punya alokasi ke tukang,
//            dan belum ada yang DI_TUKANG.
//   TERIMA : handover belum diserahkan, dan minimal ada 1 barang yang sudah
//            didistribusikan (gudang atau tukang) — tidak boleh menandai
//            serah terima atas barang yang belum bergerak sama sekali.
export function canActGudang(handover, summary, receiving) {
  if (handover?.diserahkan_at) return { ok: false, reason: 'Sudah diserahkan.' }
  // masuk_gudang ada di baris RECEIVING (nota), bukan handover.
  if (receiving?.masuk_gudang) return { ok: false, reason: 'Nota sudah ditandai masuk gudang.' }
  if (summary && summary.inWarehouse > 0) return { ok: false, reason: 'Sebagian/semua barang sudah masuk gudang.' }
  return { ok: true, reason: '' }
}

export function canActTukang(handover, summary, alokasi, receiving) {
  if (handover?.diserahkan_at) return { ok: false, reason: 'Sudah diserahkan.' }
  // tukang_at ada di baris RECEIVING (nota), bukan handover.
  if (receiving?.tukang_at) return { ok: false, reason: 'Nota sudah ditandai dikirim ke tukang.' }
  if (alokasi && !TUKANG_ALOKASI.includes(normStatus(alokasi))) {
    return { ok: false, reason: 'Nota ini dialokasikan ke gudang, bukan ke tukang.' }
  }
  if (summary && summary.sentToTukang > 0) return { ok: false, reason: 'Sebagian/semua barang sudah dikirim ke tukang.' }
  return { ok: true, reason: '' }
}

export function canActTerima(handover, summary) {
  if (handover?.diserahkan_at) return { ok: false, reason: 'Sudah diserahkan.' }
  if (summary && summary.done <= 0) {
    return { ok: false, reason: 'Belum ada barang yang didistribusikan (gudang/tukang).' }
  }
  return { ok: true, reason: '' }
}

// Daftar aksi + status izin untuk satu baris. Dipakai UI (banner/tombol)
// agar aturan ada di SATU tempat saja.
// alokasi = receivings.alokasi; receiving = baris nota lengkap (dipakai utk
// penjaga masuk_gudang/tukang_at yang hidup di baris RECEIVING, bukan handover).
export function actionPlan(handover, summary, alokasi, receiving) {
  return ACTIONS.map(a => {
    let gate
    if (a.key === ACT_GUDANG) gate = canActGudang(handover, summary, receiving)
    else if (a.key === ACT_TUKANG) gate = canActTukang(handover, summary, alokasi, receiving)
    else gate = canActTerima(handover, summary)
    return { ...a, ok: gate.ok, reason: gate.reason }
  })
}

// ------------------------------------------------------------
// 3b) Keterangan serah-terima dari ledger — lihat
//     `deliverabilityOf` di modules/receivings/receiptEventLogic.js
//     (fungsi murni, dipakai antrean & modal konfirmasi).
// ------------------------------------------------------------

// ------------------------------------------------------------
// 4) LABEL RINGKAS untuk satu baris antrean
// ------------------------------------------------------------
export function distributionLabel(summary) {
  if (!summary || !summary.total) return 'Belum ada barang tercatat'
  // Turunkan allDone dari angka (bukan hanya dari field) supaya ringkasan
  // tidak pernah menyatakan "semua selesai" saat done < total.
  const allDone = summary.allDone || (summary.done >= summary.total)
  if (allDone) return 'Semua barang sudah didistribusikan'
  return `${summary.done} dari ${summary.total} barang didistribusikan`
}

// Status pr_items yang menjadi target tiap aksi.
export function targetStatusForAction(actionKey) {
  if (actionKey === ACT_GUDANG) return 'DI_GUDANG'
  if (actionKey === ACT_TUKANG) return 'DI_TUKANG'
  return null
}

// Apakah status item sudah mencerminkan aksi tersebut (untuk idempotensi
// dan agar tidak menulis ulang DB tanpa perubahan).
export function statusMatchesAction(status, actionKey) {
  const target = targetStatusForAction(actionKey)
  if (!target) return false
  return normStatus(status) === target
}

// Status lama yang boleh ditulis/dianggap sudah beli.
export function isBoughtStatus(status) {
  return BOUGHT_STATUSES.includes(normStatus(status))
}
