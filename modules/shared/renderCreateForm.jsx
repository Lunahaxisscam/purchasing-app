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
import { formBody as receivingsForm } from '../receivings/form'
import { formBody as handoversForm } from '../handovers/form'

const FORMS = {
  requests: requestsForm,
  materials: materialsForm,
  vendors: vendorsForm,
  projects: projectsForm,
  receivings: receivingsForm,
  handovers: handoversForm
}

export function renderCreateForm(page, ctx) {
  const fn = FORMS[page]
  return fn ? fn(ctx) : null
}
