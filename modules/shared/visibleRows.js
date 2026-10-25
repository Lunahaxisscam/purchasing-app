// ============================================================
// modules/shared/visibleRows.js — LIMIT DAFTAR + TOMBOL SHOW MORE
// ============================================================
// Arahan DAT (t_cf05c96f, screenshot Material 335 records): daftar modul
// jangan memanjang ke bawah — tampilkan 10 data pertama, sisanya dibuka
// lewat tombol "Show More" (+10 per klik), dengan indikator
// "Menampilkan X dari Y" dan opsional "Ringkas" untuk kembali ke 10.
//
// ATURAN YANG DIJAGA (sesuai body task):
//   1. Filter / search / sort tetap memproses SELURUH dataset — helper ini
//      hanya MEMOTONG tampilan di langkah paling akhir, jadi hitungan tab
//      filter, banner, dan hasil pencarian tetap memakai total sebenarnya.
//   2. Data TIDAK dihapus/diubah dan ini BUKAN server pagination — semua
//      baris tetap ada di memori, hanya yang terlihat yang dibatasi.
//   3. Default 10 untuk desktop & mobile; pindah modul / filter / search /
//      sort me-reset ke 10 (dilakukan shell lewat useEffect).
//   4. Tidak menyentuh modul finance/custom (Planning, Finance, dll) yang
//      punya layout sendiri di luar shell ModuleView.
// ============================================================

// Modul yang memakai pola daftar ringkas bersama.
export const PAGINATED_MODULE_PAGES = [
  'projects',
  'past_projects',
  'vendors',
  'materials',
  'requests',
  'approvals',
  'handovers'
]

// Jumlah data awal yang ditampilkan + langkah "Show More" (arahan DAT: 10)
export const PAGE_SIZE = 10

/**
 * Hitung potongan baris yang tampil + metadata tombol Show More.
 * Aman dipanggil untuk modul apa pun: di luar PAGINATED_MODULE_PAGES
 * seluruh daftar dikembalikan tanpa dipotong (perilaku lama).
 */
export function limitRows(rows, page, listLimit) {
  const total = rows.length
  const active = PAGINATED_MODULE_PAGES.includes(page) && total > PAGE_SIZE
  const limit = active
    ? Math.min(Math.max(Number(listLimit) || PAGE_SIZE, PAGE_SIZE), total)
    : total
  return {
    visible: active ? rows.slice(0, limit) : rows,
    total,
    shown: active ? limit : total,
    // Tombol "Show More" hanya muncul bila MASIH ada yang belum tampil.
    hasMore: active && limit < total
  }
}

/**
 * Label indikator "Menampilkan X dari Y" (format ribuan gaya Indonesia,
 * mis. 335 -> "335", 12345 -> "12.345") — konsisten dgn angka UI lain.
 */
export function shownLabel(shown, total) {
  const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `Menampilkan ${fmt(shown)} dari ${fmt(total)}`
}
