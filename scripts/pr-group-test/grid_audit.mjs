// ============================================================
// PENJAGA GEOMETRI GRID TABEL (t_48f6b336 — verifikasi run 93)
// ============================================================
// jsdom TIDAK menjalankan algoritma slot tabel HTML (ekstensi rowSpan ke
// baris bawah), jadi imbalance colSpan/rowSpan lolos dari harness biasa.
// Penjaga ini mensimulasikan algoritma slot di DOM jsdom: SETIAP baris
// tbody (setelah ekstensi rowSpan dari baris atas) harus menutup TEPAT
// gridMax kolom = jumlah kolom thead. Kasus nyata yang lolos test lama &
// tertangkap di sini:
//   - filler <td colSpan={2}> di ujung baris Total Estimasi → 2 kolom hantu
//   - kolom Aksi tanpa rowSpan di jalur master-detail → baris berlubang
//   - label total colSpan menumpang kolom parent (rowSpan) → nilai salah
//     kolom + kolom hantu
// Kasus sah yang TIDAK boleh dibangkang: baris perluasan (satu td colSpan
// penuh) — sel mencakup semua kolom; baris legacy tunggal.
// ============================================================
export function auditTableGrid(table) {
  const grid = []
  const rows = [...table.querySelectorAll('tr')]
  const offenders = []
  rows.forEach((tr, r) => {
    if (!grid[r]) grid[r] = []
    let c = 0
    for (const cell of tr.children) {
      while (grid[r][c]) c++
      const cs = cell.colSpan || 1
      const rs = cell.rowSpan || 1
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (!grid[r + dr]) grid[r + dr] = []
          grid[r + dr][c + dc] = 1
        }
      }
      c += cs
    }
  })
  let gridMax = 0
  grid.forEach(row => { if (row) gridMax = Math.max(gridMax, row.length) })
  const thCount = table.querySelectorAll('thead th').length
  // baris yang belum terisi penuh = lubang grid (kecuali baris perluasan:
  // satu sel colSpan penuh di luar tabel induk slot — di jsdom rowSpan tak
  // mengalir, jadi penjaga ini hanya untuk tabel INDUK per modul)
  const unbalanced = []
  grid.forEach((row, r) => {
    if (!row) return
    let width = 0
    for (let c = 0; c < row.length; c++) if (row[c]) width = c + 1
    if (width !== gridMax) unbalanced.push({ r, width, gridMax })
  })
  return { gridMax, thCount, unbalanced, rows: rows.length, consistent: unbalanced.length === 0 && gridMax === thCount }
}
