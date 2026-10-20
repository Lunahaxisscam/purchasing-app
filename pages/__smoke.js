// ============================================================
// TEMPORARY SMOKE TEST — Fase 1 modularisasi (hapus setelah verifikasi)
// Merender SEMUA halaman modul dengan data mock supaya error render
// (referensi hilang, dsb.) tertangkap saat build/SSR.
// ============================================================
import React from 'react'
import Module from '../components/ModuleView'
import Create from '../components/CreateModal'
import PurchasePage from '../modules/receivings/page'
import RapModule from '../modules/rap/view'
import SalesInvoiceModule from '../modules/sales-invoice/view'
// t_35cd0354 (integrasi): modul Bit Dev yang kini ter-wire — dirender di
// smoke build supaya error render tertangkap saat build, bukan saat dibuka
// user. Semua read-only dan tanpa query Supabase tambahan.
import RapCompareModule from '../modules/rap-compare/view'
import StockModule from '../modules/stock/view'
import CrmModule from '../modules/crm/view'
import LaborStockModule from '../modules/labor-stock/view'

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
    { id: 'v1', name: 'TB Sumber Jaya', phone: '08123456789', store_link: 'https://tokopedia.com/x', supplier_category: 'Plywood & Board', contact: 'a@b.c' },
    // t_e626b674: vendor MULTI-KATEGORI (string koma) + vendor TANPA kategori
    // — jalur chips multi & empty-chip harus ter-render di smoke build.
    { id: 'v2', name: 'TB Multi Kategori', phone: '085999', store_link: '', supplier_category: 'Plywood & Board, HPL & Edging', contact: '' },
    { id: 'v3', name: 'TB Tanpa Kategori', phone: '', store_link: '', supplier_category: '', contact: '' }
  ],
  materials: [
    { id: 'm1', kode: 'PLY-0001', code: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', qty: 10, satuan: 'Lembar', current_stock: 2, min_stock: 5, harga_acuan: 120000 },
    { id: 'm2', kode: 'BHP-0001', name: 'Lem Fox', category: 'Bahan Habis Pakai', qty: 3, satuan: 'Kaleng', current_stock: 1, min_stock: 2, harga_acuan: 45000 }
  ],
  requests: [
    { id: 'r1', pr_number: 'PR-001', project_name: '[99] Baroni', project_id: 'p1', title: 'Material dinding', status: 'DRAFT', priority: 'URGENT', notes: 'catatan', materials_summary: '4 Lembar Triplek', created_at: '2026-10-02T00:00:00Z' },
    { id: 'r2', pr_number: 'PR-002', project_name: '[83] Mabes', project_id: 'p2', title: 'Finishing', status: 'SUBMITTED', priority: 'NORMAL', notes: '', materials_summary: '', created_at: '2026-10-03T00:00:00Z' },
    // t_a5a73034: request jalur LEAN (penanda eksplisit) — smoke harus
    // membuktikan label "Siap Ditindaklanjuti", tombol Tutup sisa, dan baris
    // pemenuhan ter-render di SSR tanpa error. r2 di atas (SUBMITTED tanpa
    // penanda) adalah legacy dan HARUS tetap tampil sebagai "Submitted lama".
    { id: 'r3', pr_number: 'PR-003', project_name: '[99] Baroni', project_id: 'p1', title: 'Kebutuhan Tukang', status: 'SUBMITTED', priority: 'NORMAL', notes: 'Kebutuhan rangka\n[Jalur: LEAN]', materials_summary: '2 Lembar Triplek', created_at: '2026-10-04T00:00:00Z' }
  ],
  approvals: [
    { id: 'a1', pr_number: 'PR-001', project_name: '[99] Baroni', title: 'Material dinding', purchase_request_id: 'r1', step_number: 1, status: 'PENDING', note: 'note', decided_at: null }
  ],
  receivings: [
    // t_9109cf5e: nota DIBELI dari alur belanja baru (tab Riwayat Pembelian).
    // Bukti nota & bukti transfer ditulis sebagai penanda di kolom catatan
    // (data-URL 1×1 px supaya payload smoke tetap kecil).
    { id: 'rc1', invoice_no: 'TB-88912', vendor_id: 'v1', project_name: '[99] Baroni', status: 'DIBELI', received_date: '2026-10-16',
      note: '[Nominal: Rp 542.000] [BiayaLain: Rp 25.000] [BuktiNota: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==] [BuktiTransfer: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==] [Tahap: DIBELI] diambil sendiri',
      purchase_request_id: 'r1', project_id: 'p1' },
    // nota lama (sebelum rombak) — tampil di Riwayat dengan label "nota lama"
    { id: 'rc2', invoice_no: 'INV-LAMA-2', vendor_id: 'v2', project_name: '[83] Mabes', status: 'NORMAL', received_date: '2026-10-05', note: '[Nominal: Rp 865.000] Nota lama TB Makmur', purchase_request_id: 'r2', project_id: 'p2' },
    // t_a5a73034: nota DIBELI untuk request jalur lean r3 (realisasi parsial).
    { id: 'rc-lean', invoice_no: 'TB-LEAN-1', vendor_id: 'v1', project_name: '[99] Baroni', status: 'DIBELI', received_date: '2026-10-19', note: '[Nominal: Rp 120.000] [Tahap: DIBELI] beli 1 lembar dulu', purchase_request_id: 'r3', project_id: 'p1' },
    // cangkang otomatis dari Approval (belum dibeli) — TIDAK boleh tampil di
    // tab mana pun; barangnya tetap muncul di tab Siap Dibeli.
    { id: 'rc3', invoice_no: null, project_name: '[99] Baroni', status: 'NORMAL', received_date: null, note: 'Dibuat otomatis dari PR (barang disetujui).', purchase_request_id: 'r1', project_id: 'p1' }
  ],
  // Invoice Penjualan (t_22865fc4) — dipakai HANYA oleh rute /__smoke.
  // Satu draf (tanpa nomor) + satu terbit + satu terkirim + satu lunas,
  // supaya semua cabang aksi status ikut ter-render saat build.
  sales_invoices: [
    { id: 'si_d', status: 'DRAFT', invoice_no: null, customer_name: 'Draf Co', project_name: 'Fit-Out Draf', nominal: 1000000, tax_rate: 0, tax_amount: 0, grand_total: 1000000, issue_date: '2026-10-17', due_date: '', project_issued: false, project_code: null, sent_at: null, sent_channel: '', paid_amount: null, payment_ref: '' },
    { id: 'si_t', status: 'TERBIT', invoice_no: 'INV/NL/2026/10/001', customer_name: 'Terbit Co', project_name: 'Fit-Out Terbit', project_code: '106', project_issued: true, nominal: 2000000, tax_rate: 11, tax_amount: 220000, grand_total: 2220000, issue_date: '2026-10-17', due_date: '2026-10-31', sent_at: null, sent_channel: '', paid_amount: null, payment_ref: '' },
    { id: 'si_k', status: 'TERKIRIM', invoice_no: 'INV/NL/2026/10/002', customer_name: 'Kirim Co', project_name: 'Fit-Out Kirim', project_code: '107', project_issued: true, nominal: 3000000, tax_rate: 0, tax_amount: 0, grand_total: 3000000, issue_date: '2026-10-17', due_date: '2026-10-31', sent_at: '2026-10-18T02:00:00Z', sent_channel: 'WhatsApp', paid_amount: null, payment_ref: '' },
    { id: 'si_l', status: 'LUNAS', invoice_no: 'INV/NL/2026/10/003', customer_name: 'Lunas Co', project_name: 'Fit-Out Lunas', project_code: '108', project_issued: true, nominal: 4000000, tax_rate: 0, tax_amount: 0, grand_total: 4000000, issue_date: '2026-10-17', due_date: '2026-10-31', sent_at: '2026-10-18T02:00:00Z', sent_channel: 'Email', paid_amount: 4000000, paid_at: '2026-10-20', payment_ref: 'TRF-1', payment_verified_by: 'admin-mock' }
  ],
  handovers: [
    // h1: bukti fisik ada (diserahkan_at) -> "Sudah Diserahkan" + rincian terstruktur.
    { id: 'h1', project_name: '[99] Baroni', received_by: 'Mandor Joko', status: 'CONFIRMED', handover_date: '2026-10-06', diserahkan_at: '2026-10-06T09:00:00Z', note: '',
      receiving_id: 'rc1', items: [
        { item_name: 'Triplek 9mm', qty_diserahkan: 3, satuan: 'Lembar' },
        { item_name: 'Lem Fox', qty_diserahkan: 1, satuan: 'Kaleng' }
      ] },
    // h2: status lama CONFIRMED TANPA diserahkan_at + tanpa rincian -> label
    // "Rincian barang belum tersedia" + catatan status lama (data live A3).
    { id: 'h2', project_name: '[83] Mabes', received_by: 'Mandor Tono', status: 'CONFIRMED', handover_date: '2026-10-07', diserahkan_at: null, note: 'x', receiving_id: 'rc2' },
    // h3: antrean belum diserahkan (DRAFT) dari alur Ke Tukang.
    { id: 'h3', project_name: '[99] Baroni', received_by: 'Tukang', status: 'DRAFT', handover_date: '2026-10-08', diserahkan_at: null, note: 'Barang dari penerimaan rc1 dikirim langsung ke tukang. Menunggu konfirmasi serah terima fisik.', receiving_id: 'rc1' }
  ],
  pr_items: [
    { id: 'pi1', pr_id: 'r1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: 'v1', estimated_price: 120000, sort_order: 0 },
    // t_9109cf5e: barang APPROVED yang BELUM dibeli -> muncul di tab
    // "Siap Dibeli" modul Purchase (dengan vendor berbeda utk uji filter).
    { id: 'pi2', pr_id: 'r1', material_id: 'm2', item_name: 'Lem Fox', kode: 'BHP-0001', unit: 'Kaleng', quantity: 2, status: 'APPROVED', supplier_category: '', vendor_id: 'v1', estimated_price: 45000, sort_order: 1 },
    { id: 'pi5', pr_id: 'r2', material_id: 'm1', item_name: 'Triplek 12mm', kode: 'PLY-0002', unit: 'Lembar', quantity: 6, status: 'APPROVED', supplier_category: 'Plywood & Board', vendor_id: 'v2', estimated_price: 185000, sort_order: 2 },
    // t_a5a73034: item request jalur lean — sebagian sudah dibeli (lihat
    // receiving_items rc-lean) supaya baris "Pemenuhan: sebagian" ikut SSR.
    { id: 'pi6', pr_id: 'r3', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 2, status: 'PENDING_APPROVAL', supplier_category: 'Plywood & Board', vendor_id: null, estimated_price: 120000, sort_order: 3 }
  ],
  receiving_items: [
    // Nota DIBELI (rc1): dua barang yang SUDAH dibeli — pr_item_id sengaja
    // tidak menunjuk pi1/pi2/pi5 supaya ketiganya tetap tampil di Siap Dibeli.
    { id: 'ri1', receiving_id: 'rc1', pr_item_id: 'piLama1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 118000]' },
    { id: 'ri2', receiving_id: 'rc1', pr_item_id: 'piLama2', item_name: 'Sekrup 3cm', unit: 'Box', quantity_received: 2, note: '[Harga: 35000]' },
    // Nota lama (rc2): tanpa harga satuan (data sebelum rombak — jujur "—")
    { id: 'ri3', receiving_id: 'rc2', pr_item_id: 'piLama3', item_name: 'HPL Putih', unit: 'Lembar', quantity_received: 8, note: null },
    // t_a5a73034: realisasi untuk request lean r3 — 1 dari 2 lembar sudah
    // dibeli (nota DIBELI rc-lean). Baris pemenuhan desktop harus menampilkan
    // "sebagian — sisa 1" dan TIDAK mengklaim selesai.
    { id: 'ri4', receiving_id: 'rc-lean', pr_item_id: 'pi6', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 1, note: '[Harga: 120000]' }
  ]
}

// t_9109cf5e: 'receivings' TIDAK lagi dirender lewat ModuleView (Purchase kini
// halaman sendiri: dua tab + dialog Proses Pembelian) — diuji terpisah di
// bawah lewat PurchasePage.
// t_50b783de: section 'approvals' tetap ada di smoke, tetapi shell ModuleView
// kini merender FALLBACK saat Approval OFF (dibuktikan di build & uji runtime).
const PAGES = ['projects', 'past_projects', 'vendors', 'materials', 'requests', 'approvals', 'handovers']

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
              onCloseRemaining={async () => ({ ok: true })}
              onMarkPrItemOrdered={noop}
              onDelete={noop}
              setPage={noop}
            />
          </section>
        )
      })}
      {/* Modul Purchase (t_9109cf5e): halaman sendiri dengan dua tab + dialog
          Proses Pembelian. Dirender di smoke build supaya error render
          tertangkap saat build (termasuk tabel riwayat & kartu mobile). */}
      <section id="mod-receivings">
        <PurchasePage
          rows={{
            receivings: mock.receivings,
            receiving_items: mock.receiving_items,
            pr_items: mock.pr_items,
            requests: mock.requests,
            projects: mock.projects,
            vendors: mock.vendors,
            materials: mock.materials
          }}
          refresh={noop}
          say={noop}
        />
      </section>
      {/* Modul RAP (t_71d95cfe): halaman sendiri, DRAFT_ONLY (tanpa tabel DB).
          Dirender di smoke build supaya error render tertangkap saat build. */}
      <section id="mod-rap">
        <RapModule
          projects={mock.projects}
          say={noop}
          setPage={noop}
          session={null}
        />
      </section>
      {/* Modul Invoice Penjualan (t_22865fc4): halaman sendiri. Dirender dengan
          props invoices (mode props) supaya tidak memanggil API saat SSR —
          data mock ini HANYA hidup di rute /__smoke (ENABLE_SMOKE=1). */}
      <section id="mod-sales-invoice">
        <SalesInvoiceModule
          invoices={mock.sales_invoices}
          projects={mock.projects}
          allProjects={mock.projects}
          say={noop}
        />
      </section>
      {/* t_35cd0354 (integrasi): tiga modul Bit Dev yang sudah ter-wire ke
          pages/index.js juga dirender di sini — supaya "bisa dibuka" dibuktikan
          oleh build, bukan hanya oleh entri nav. Semua read-only: data dari
          mock/rows, tanpa query Supabase, tanpa penulisan. */}
      <section id="mod-rap-compare">
        <RapCompareModule rows={mock} allProjects={mock.projects} say={noop} />
      </section>
      <section id="mod-stock">
        <StockModule allMaterials={mock.materials} />
      </section>
      <section id="mod-crm">
        <CrmModule rows={mock} customers={mock.customers} invoiceCounts={null} say={noop} />
      </section>
      {/* t_62e41e91 (S5, Bit): Actual Labor & Stok — sumber sengaja null
          supaya jalur "belum tersedia" (bukan 0) ikut ter-render saat build. */}
      <section id="mod-labor-stock">
        <LaborStockModule
          rows={mock}
          laborRows={null}
          estimateRows={null}
          materials={mock.materials}
          say={noop}
        />
      </section>
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
