// ============================================================
// TEMPORARY SMOKE TEST — Fase 1 modularisasi (hapus setelah verifikasi)
// Merender SEMUA halaman modul dengan data mock supaya error render
// (referensi hilang, dsb.) tertangkap saat build/SSR.
// ============================================================
import React from 'react'
import Module from '../components/ModuleView'
import Create from '../components/CreateModal'

// ------------------------------------------------------------
// GUARD PRODUKSI (temuan audit Brooklyn #A.2):
// Halaman ini HANYA dirender bila ENABLE_SMOKE=1. Tanpa env var itu
// (termasuk build Vercel produksi), rute /__smoke menjadi 404 statis —
// mock data & struktur internal TIDAK pernah ter-deploy sebagai rute publik.
// Regression harness lokal: `ENABLE_SMOKE=1 npm run build`
// ------------------------------------------------------------
export async function getStaticProps() {
  if (process.env.ENABLE_SMOKE !== '1') {
    return { notFound: true }
  }
  return { props: {} }
}

const noop = () => {}

const mock = {
  projects: [
    { id: 'p1', kode: '99', code: '99', name: 'Baroni', status: 'ON_GOING', created_at: '2026-10-01T00:00:00Z' },
    { id: 'p2', kode: '83', name: 'Mabes', status: 'DONE', created_at: '2026-09-01T00:00:00Z' }
  ],
  vendors: [
    { id: 'v1', name: 'TB Sumber Jaya', phone: '08123456789', store_link: 'https://tokopedia.com/x', supplier_category: 'Plywood & Board', contact: 'a@b.c' }
  ],
  materials: [
    { id: 'm1', kode: 'PLY-0001', code: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', qty: 10, satuan: 'Lembar', current_stock: 2, min_stock: 5, harga_acuan: 120000 },
    { id: 'm2', kode: 'BHP-0001', name: 'Lem Fox', category: 'Bahan Habis Pakai', qty: 3, satuan: 'Kaleng', current_stock: 1, min_stock: 2, harga_acuan: 45000 }
  ],
  requests: [
    { id: 'r1', pr_number: 'PR-001', project_name: '[99] Baroni', title: 'Material dinding', status: 'DRAFT', priority: 'URGENT', notes: 'catatan', materials_summary: '4 Lembar Triplek', created_at: '2026-10-02T00:00:00Z' },
    { id: 'r2', pr_number: 'PR-002', project_name: '[83] Mabes', title: 'Finishing', status: 'SUBMITTED', priority: 'NORMAL', notes: '', materials_summary: '', created_at: '2026-10-03T00:00:00Z' }
  ],
  approvals: [
    { id: 'a1', pr_number: 'PR-001', project_name: '[99] Baroni', title: 'Material dinding', purchase_request_id: 'r1', step_number: 1, status: 'PENDING', note: 'note', decided_at: null }
  ],
  receivings: [
    { id: 'rc1', invoice_no: 'INV-1', project_name: '[99] Baroni', status: 'NORMAL', received_date: '2026-10-04', note: 'nominal: 450.000 | nota: https://drive.google.com/x | extra', purchase_request_id: 'r1' },
    { id: 'rc2', invoice_no: 'INV-2', project_name: '[83] Mabes', status: 'RETUR', received_date: '2026-10-05', note: '', purchase_request_id: 'r2' }
  ],
  handovers: [
    { id: 'h1', project_name: '[99] Baroni', received_by: 'Mandor Joko', status: 'CONFIRMED', handover_date: '2026-10-06', note: '' },
    { id: 'h2', project_name: '[83] Mabes', received_by: 'Mandor Tono', status: 'DRAFT', handover_date: '2026-10-07', note: 'x' }
  ],
  pr_items: [
    { id: 'pi1', pr_id: 'r1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 },
    { id: 'pi2', pr_id: 'r1', material_id: 'm2', item_name: 'Lem Fox', kode: 'BHP-0001', unit: 'Kaleng', quantity: 2, status: 'APPROVED', supplier_category: '', vendor_id: '', estimated_price: 45000, sort_order: 1 }
  ],
  receiving_items: [
    { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 3 },
    { id: 'ri2', receiving_id: 'rc2', pr_item_id: 'pi2', item_name: 'Lem Fox', unit: 'Kaleng', quantity_received: 2 }
  ]
}

const PAGES = ['projects', 'past_projects', 'vendors', 'materials', 'requests', 'approvals', 'receivings', 'handovers']

export default function SmokePage() {
  return (
    <main>
      {PAGES.map(p => {
        const rows = p === 'past_projects'
          ? mock.projects.filter(x => x.status === 'DONE')
          : (mock[p] || [])
        return (
          <section key={p} id={`mod-${p}`}>
            <Module
              page={p}
              rows={rows}
              allProjects={mock.projects}
              allMaterials={mock.materials}
              allPrItems={mock.pr_items}
              allReceivingItems={mock.receiving_items}
              allRequests={mock.requests}
              allReceivings={mock.receivings}
              allVendors={mock.vendors}
              refresh={noop}
              say={noop}
              onStatusChange={noop}
              onReceivingStatusChange={noop}
              onMoveToWarehouse={noop}
              onSendToTukang={noop}
              onMarkHandoverDelivered={noop}
              onDecideApproval={noop}
              onReviseApproval={noop}
              onApproveItem={noop}
              onFinishPr={noop}
              onMarkPrItemOrdered={noop}
              onDelete={noop}
              setPage={noop}
            />
          </section>
        )
      })}
      {/* Form tambah/edit per modul (data mock) */}
      {PAGES.map(p => (
        <section key={`form-${p}`} id={`form-${p}`}>
          <Create
            page={p}
            allProjects={mock.projects}
            allMaterials={mock.materials}
            allVendors={mock.vendors}
            existingRequests={mock.requests}
            allRequestsFull={mock.requests}
            editRow={p === 'materials' ? mock.materials[0] : (p === 'requests' ? mock.requests[0] : null)}
            editItems={p === 'requests' ? mock.pr_items : []}
            allReceivings={mock.receivings}
            close={noop}
            refresh={noop}
            say={noop}
          />
        </section>
      ))}
    </main>
  )
}
