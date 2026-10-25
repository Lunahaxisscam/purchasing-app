// ============================================================
// modules/shared/renderCreateForm.jsx — DISPATCHER FORM TAMBAH/EDIT
// ============================================================
// Shell CreateModal memanggil renderCreateForm(page, ctx); tiap modul
// menyediakan formBody(ctx). Modul tanpa form (mis. approvals) -> null.
// ============================================================
import { formBody as requestsForm } from '../requests/form'
import { formBody as materialsForm } from '../materials/form'
import { formBody as vendorsForm } from '../vendors/form'
import { formBody as projectsForm } from '../projects/form'
import { formBody as handoversForm } from '../handovers/form'

// CATATAN (t_9109cf5e): modul Purchase TIDAK lagi punya form tambah/edit.
// Purchase kini halaman sendiri (modules/receivings/page.jsx) yang mencatat
// nota lewat dialog "Proses Pembelian" — bukan CreateModal. Form lama
// (dropdown Retur/Refund, tanggal terima, alokasi) DIHAPUS sesuai arahan DAT.
const FORMS = {
  requests: requestsForm,
  materials: materialsForm,
  vendors: vendorsForm,
  projects: projectsForm,
  handovers: handoversForm
}

export function renderCreateForm(page, ctx) {
  const fn = FORMS[page]
  return fn ? fn(ctx) : null
}
