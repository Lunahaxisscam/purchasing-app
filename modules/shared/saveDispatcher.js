// ============================================================
// modules/shared/saveDispatcher.js — DISPATCHER SIMPAN
// ============================================================
// Shell CreateModal HANYA memanggil dispatchSave(page, ctx); tiap modul
// menyediakan save(ctx) di modules/<modul>/save.js. Menambah modul baru =
// tambah 1 entri di SAVES + file save.js modul — tanpa menyentuh shell.
// ============================================================
import { save as requestsSave } from '../requests/save'
import { save as materialsSave } from '../materials/save'
import { save as vendorsSave } from '../vendors/save'
import { save as projectsSave } from '../projects/save'
import { save as handoversSave } from '../handovers/save'

// CATATAN (t_9109cf5e): Purchase tidak lagi memakai CreateModal.save().
// Nota belanja disimpan lewat modules/receivings/purchaseSave.js
// (dipanggil dialog "Proses Pembelian"). save.js lama DIHAPUS.
const SAVES = {
  requests: requestsSave,
  materials: materialsSave,
  vendors: vendorsSave,
  projects: projectsSave,
  handovers: handoversSave
}

// Halaman yang mendukung penyimpanan (dipakai shell untuk validasi awal).
export const SAVE_PAGES = Object.keys(SAVES)

export async function dispatchSave(page, ctx) {
  const fn = SAVES[page]
  if (!fn) return { handled: false }
  await fn(ctx)
  return { handled: true }
}
