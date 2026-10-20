// ============================================================
// REPRO REVIEW (t_7bc6246b run 188) — BUG antrean nota per vendor
// ============================================================
// BUG: setelah nota vendor #1 tersimpan, `finishPurchase` memanggil
// `setFormRows(rest[0])` (vendor #2) dan UI MENYATAT "Lanjut nota vendor
// berikutnya: …", TETAPI <PurchaseForm> tidak punya `key`, jadi `useState`
// di dalamnya tidak pernah diinisialisasi ulang. Form tetap memuat barang &
// vendor nota #1.
//
// Akibat nyata: admin menekan Simpan lagi → nota KEDUA untuk vendor yang SAMA
// (bukan vendor #2), dan barang vendor #2 tidak pernah dibuatkan nota.
//
// Jalankan dari root sandbox purchase-flow-verify:
//   node repro_vendor_queue_advance.mjs
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const PurchasePage = (await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/page.mjs')).href)).default

const tick = () => new Promise(r => setTimeout(r, 0))
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const toggleCheck = (el) => flushSync(() => el.click())
const realClick = (el) => flushSync(() => el.click()) // aktivasi nyata (submit form)
const typeInto = (doc, el, val) => {
  const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLInputElement.prototype, 'value').set
  flushSync(() => { setter.call(el, val); el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })) })
}

let pass = 0, fail = 0
const check = (n, c, extra = '') => { if (c) { pass++; console.log(`  ✓ ${n}`) } else { fail++; console.log(`  ✗ ${n}  ${extra}`) } }

const rows = {
  projects: [{ id: 'p1', kode: '99', name: 'Baroni', status: 'ON_GOING' }, { id: 'p2', kode: '83', name: 'Mabes', status: 'ON_GOING' }],
  vendors: [{ id: 'v1', name: 'TB Sumber Jaya' }, { id: 'v2', name: 'Toko Mitra Fitting' }],
  materials: [
    { id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 120000 },
    { id: 'm2', kode: 'HWF-0001', name: 'Sekrup 3cm', category: 'Hardware & Fitting', satuan: 'Box', harga_acuan: null }
  ],
  purchase_requests: [
    { id: 'pr1', pr_number: 'PR-001', title: 'Material dinding', project_id: 'p1', status: 'APPROVED' },
    { id: 'pr2', pr_number: 'PR-002', title: 'Fitting kabinet', project_id: 'p2', status: 'APPROVED' }
  ],
  pr_items: [
    { id: 'pi1', pr_id: 'pr1', material_id: 'm1', item_name: 'Triplek 9mm', kode: 'PLY-0001', unit: 'Lembar', quantity: 4, estimated_price: 120000, status: 'APPROVED', vendor_id: 'v1', sort_order: 0 },
    { id: 'pi3', pr_id: 'pr2', material_id: 'm2', item_name: 'Sekrup 3cm (Mabes)', kode: 'HWF-0001', unit: 'Box', quantity: 5, estimated_price: 34000, status: 'APPROVED', vendor_id: 'v2', sort_order: 0 }
  ],
  receivings: [], receiving_items: [], handovers: [], approval_steps: []
}

const said = []
dom0.window.document.body.innerHTML = ''
const host = dom0.window.document.createElement('div')
dom0.window.document.body.appendChild(host)
flushSync(() => createRoot(host).render(
  React.createElement(PurchasePage, { rows, refresh: () => {}, say: (m) => said.push(m) })
))
await tick()
const doc = dom0.window.document

console.log('E1. Pilih 2 barang dari 2 vendor berbeda')
toggleCheck(tid(doc, 'check-pi1')); await tick()
toggleCheck(tid(doc, 'check-pi3')); await tick()
check('E1a petunjuk menyebut 2 nota terpisah', /2 nota terpisah/i.test(tid(doc, 'hint-multi-vendor')?.textContent || ''))

console.log('\nE2. Nota #1 dibuka untuk SATU vendor')
flushSync(() => tid(doc, 'btn-process-purchase').click()); await tick()
const itemsOf = () => [...doc.querySelectorAll('[data-testid^="form-item-"]')].map(e => e.getAttribute('data-testid').replace('form-item-', ''))
check('E2a vendor nota #1 = v1', tid(doc, 'form-vendor')?.value === 'v1', tid(doc, 'form-vendor')?.value)
check('E2b nota #1 hanya berisi barang v1', JSON.stringify(itemsOf()) === JSON.stringify(['pi1']), JSON.stringify(itemsOf()))

console.log('\nE3. Simpan nota #1 (jalur simpan nyata)')
typeInto(doc, tid(doc, 'form-invoice'), 'INV-A'); await tick()
typeInto(doc, tid(doc, 'harga-pi1'), '120000'); await tick()
check('E3a tombol simpan aktif', tid(doc, 'purchase-submit')?.disabled === false)
realClick(tid(doc, 'purchase-submit'))
for (let i = 0; i < 25; i++) await tick()
check('E3b nota #1 tersimpan (pesan sukses)', said.some(m => /INV-A.*tersimpan/i.test(m)), JSON.stringify(said.slice(-2)))

console.log('\nE4. ANTREAN harus maju ke vendor #2 — INI YANG GAGAL')
check('E4a UI mengklaim lanjut ke vendor berikutnya', said.some(m => /Lanjut nota vendor berikutnya/i.test(m)), JSON.stringify(said.slice(-2)))
check('E4b form benar-benar pindah ke vendor v2', tid(doc, 'form-vendor')?.value === 'v2', `vendor=${tid(doc, 'form-vendor')?.value}`)
check('E4c form berisi barang vendor v2 (pi3)', JSON.stringify(itemsOf()) === JSON.stringify(['pi3']), JSON.stringify(itemsOf()))
check('E4d nomor nota nota #1 tidak terbawa ke nota #2', !String(tid(doc, 'form-invoice')?.value || '').includes('INV-A'), JSON.stringify(tid(doc, 'form-invoice')?.value))

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`)

console.log('\nE5. Admin menekan Simpan lagi (form masih tampak siap untuk vendor v1)')
realClick(tid(doc, 'purchase-submit'))
for (let i = 0; i < 25; i++) await tick()
console.log('  error :', JSON.stringify((tid(doc, 'purchase-error')?.textContent || '').slice(0, 200)))
console.log('  notice:', JSON.stringify(said.slice(-2)))
console.log('  vendor sekarang:', tid(doc, 'form-vendor')?.value, '| items:', JSON.stringify(itemsOf()))
console.log('  → barang vendor v2 (pi3) tidak pernah dibuatkan nota.')
