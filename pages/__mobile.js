// ============================================================
// MOBILE HARNESS — FIXTURE/MOCK ONLY (t_eebe4678)
// Merender SHELL + Sidebar + Dashboard + Module + CreateModal dengan data mock
// supaya bug navigasi/overlay mobile bisa direproduksi di browser tanpa login
// dan TANPA menulis DB. Guard sama seperti /__smoke: hanya hidup bila
// ENABLE_SMOKE=1, selain itu 404 (tidak pernah jadi rute produksi).
// ============================================================
import React, { useState } from 'react'
import Sidebar from '../components/Sidebar'
import Dashboard from '../components/Dashboard'
import Module from '../components/ModuleView'
import Create from '../components/CreateModal'
import Planning from '../components/Planning'
import Finance from '../components/Finance'
import ProjectFinance from '../components/ProjectFinance'
import TukangUpah from '../components/TukangUpah'
import BoqModule from '../modules/rab-boq/view'
import { labels } from '../lib/constants'

export async function getStaticProps() {
  if (process.env.ENABLE_SMOKE !== '1') return { notFound: true }
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
    { id: 'rc1', invoice_no: 'INV-1', project_name: '[99] Baroni', status: 'NORMAL', received_date: '2026-10-04', note: 'nominal: 450.000 | nota: https://drive.google.com/x | extra', purchase_request_id: 'r1' }
  ],
  handovers: [
    { id: 'h1', project_name: '[99] Baroni', received_by: 'Mandor Joko', status: 'CONFIRMED', handover_date: '2026-10-06', diserahkan_at: '2026-10-06T09:00:00Z', note: '', receiving_id: 'rc1', items: [{ item_name: 'Triplek 9mm', qty_diserahkan: 3, satuan: 'Lembar' }] }
  ],
  pr_items: [
    { id: 'pi1', pr_id: 'r1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 }
  ],
  receiving_items: [
    { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 3 }
  ]
}

const MOCK_SESSION = { user: { email: 'mobile.harness@noirliving.test' } }

export default function MobileHarness() {
  const [page, setPage] = useState('dashboard')
  const [createOpen, setCreateOpen] = useState(false)
  const [noteModal, setNoteModal] = useState(null)

  const rows = page === 'projects'
    ? mock.projects.filter(x => x.status !== 'DONE')
    : page === 'past_projects'
      ? mock.projects.filter(x => x.status === 'DONE')
      : (mock[page] || [])

  return (
    <main className="shell">
      <Sidebar
        page={page}
        setPage={setPage}
        session={MOCK_SESSION}
        logout={noop}
        role="admin"
      />
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">OPERASIONAL INTERNAL</p>
            <h1>{page === 'dashboard' ? 'Dashboard' : labels[page]}</h1>
          </div>
          <button className="outline" onClick={noop}>↻ Perbarui</button>
        </header>
        {page === 'dashboard' ? (
          <Dashboard
            rows={mock}
            activeProjects={mock.projects.filter(x => x.status !== 'DONE')}
            pastProjects={mock.projects.filter(x => x.status === 'DONE')}
            setPage={setPage}
            role="admin"
          />
        ) : page === 'planning' ? (
          <Planning rows={mock} say={noop} setPage={setPage} refresh={noop} />
        ) : page === 'finance' ? (
          <Finance rows={mock} session={MOCK_SESSION} refresh={noop} />
        ) : page === 'project_finance' ? (
          <ProjectFinance rows={mock} />
        ) : page === 'tukang_upah' ? (
          <TukangUpah />
        ) : page === 'rab_boq' ? (
          <BoqModule projects={mock.projects} refresh={noop} />
        ) : (
          <Module
            page={page}
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
            onDecideApproval={(approval) => setNoteModal({ approval, decision: 'REJECTED' })}
            onReviseApproval={(approval) => setNoteModal({ approval, decision: 'REVISI' })}
            onApproveItem={noop}
            onFinishPr={noop}
            onMarkPrItemOrdered={noop}
            onDelete={noop}
            setPage={setPage}
          />
        )}
      </section>

      {createOpen && (
        <Create
          page={page}
          allProjects={mock.projects}
          allMaterials={mock.materials}
          allVendors={mock.vendors}
          existingRequests={mock.requests}
          allRequestsFull={mock.requests}
          editRow={null}
          editItems={[]}
          allReceivings={mock.receivings}
          close={() => setCreateOpen(false)}
          refresh={noop}
          say={noop}
        />
      )}

      {noteModal && (
        <div className="modal">
          <form className="dialog" onSubmit={e => { e.preventDefault(); setNoteModal(null) }}>
            <div className="dialoghead">
              <h2>Minta Revisi — {noteModal.approval.pr_number}</h2>
              <button type="button" className="icon" onClick={() => setNoteModal(null)}>×</button>
            </div>
            <label>Catatan<textarea rows={4} /></label>
            <div className="actions">
              <button type="button" className="outline" onClick={() => setNoteModal(null)}>Batal</button>
              <button>Kirim</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
