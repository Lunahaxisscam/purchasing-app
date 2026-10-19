// ============================================================
// render_test.mjs — ACCEPTANCE UI jalur lean (t_a5a73034)
// ============================================================
// Yang dibuktikan:
//   R1. Label status jujur: SUBMITTED+penanda -> "Siap Ditindaklanjuti";
//       SUBMITTED tanpa penanda -> "Submitted lama" (BUKAN lean).
//   R2. Tombol aksi: "✓ Selesai & Kirim" (bukan "ke modul Approval"),
//       tidak ada kata "Approval" pada tombol kirim.
//   R3. Tutup sisa: dialog alasan wajib; submit kosong ditolak tanpa memanggil
//       service; isi alasan -> memanggil onCloseRemaining(pr, alasan).
//   R4. Catatan: penanda teknis [Jalur: LEAN]/[Tutup:] TIDAK tampil sebagai
//       catatan manusia (note popover & kartu mobile).
//   R5. Saran vendor & estimasi di form PR: estimasi terisi dari master,
//       "Belum ada acuan" muncul untuk item tanpa acuan, chip saran vendor
//       eligible muncul, dan vendor TIDAK dipilih otomatis.
//   R6. Pemenuhan tampil di kartu mobile (dari nota DIBELI, bukan status).
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')

const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const reqView = await load('modules/requests/view.mjs')
const CreateModal = (await load('components/CreateModal.mjs')).default
const { makeItemHelpers } = await load('modules/shared/itemHelpers.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// SATU JSDOM + SATU React root dipakai ulang untuk semua mount. Membuat root
// baru pada container yang sama (atau JSDOM baru) membuat React melepas event
// system dan render berikutnya tidak ter-commit — gejalanya "kadang kosong".
const SHARED_DOM = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true })
global.window = SHARED_DOM.window
global.document = SHARED_DOM.window.document
const SHARED_ROOT = createRoot(SHARED_DOM.window.document.getElementById('app'))

function mount(el) {
  flushSync(() => SHARED_ROOT.render(el))
  return { dom: SHARED_DOM, doc: SHARED_DOM.window.document, root: SHARED_ROOT }
}

const MATERIALS = [
  { id: 'm1', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm2', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: null }
]
const PROJECTS = [{ id: 'p1', kode: '99', name: 'Baroni Living', status: 'ON_GOING' }]
const VENDORS = [
  { id: 'v1', name: 'Toko Kayu Jaya', supplier_category: 'Plywood & Board' },
  { id: 'v2', name: 'Toko Bangunan Makmur', supplier_category: 'Bahan Habis Pakai' }
]

function makeCtx(overrides = {}) {
  const prItems = overrides.prItems || []
  const H = makeItemHelpers({
    allPrItems: prItems,
    allVendors: VENDORS,
    allMaterials: MATERIALS,
    allReceivingItems: overrides.allReceivingItems || [],
    allRequests: []
  })
  return {
    H,
    title: 'Purchase Request',
    page: 'requests',
    setEditRow: () => {},
    onFinishPr: () => {},
    onCloseRemaining: async () => ({ ok: true }),
    onDelete: () => {},
    openNoteId: null,
    setOpenNoteId: () => {},
    allMaterials: MATERIALS,
    allVendors: VENDORS,
    allReceivings: overrides.allReceivings || [],
    allReceivingItems: overrides.allReceivingItems || [],
    ...overrides
  }
}

const DRAFT_PR = { id: 'pr-d', pr_number: 'PR-201', title: 'Kebutuhan Dapur', status: 'DRAFT', priority: 'NORMAL', project_name: '[99] Baroni', notes: 'Catatan tukang', materials_summary: '' }
const LEAN_PR = { id: 'pr-l', pr_number: 'PR-202', title: 'Kebutuhan Finishing', status: 'SUBMITTED', priority: 'NORMAL', project_name: '[99] Baroni', notes: 'Catatan asli\n[Jalur: LEAN]', materials_summary: '' }
const LEGACY_PR = { id: 'pr-x', pr_number: 'PR-203', title: 'PR Lama', status: 'SUBMITTED', priority: 'NORMAL', project_name: '[99] Baroni', notes: 'Catatan lama', materials_summary: '' }

const PR_ITEMS = [
  { id: 'i1', pr_id: 'pr-l', item_name: 'Triplek Polos 18mm', quantity: 4, unit: 'Lembar', status: 'PENDING_APPROVAL', material_id: 'm1', estimated_price: 250000, sort_order: 0 }
]

// ------------------------------------------------------------
console.log('R1. Label status jujur (lean vs legacy)')
{
  const ctx = makeCtx({ prItems: PR_ITEMS })
  const { doc } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(LEAN_PR, ctx))))
  const badges = [...doc.querySelectorAll('.badge')].map(b => b.textContent.trim())
  check('lean: badge "Siap Ditindaklanjuti"', badges.includes('Siap Ditindaklanjuti'), JSON.stringify(badges))
  check('lean: badge berkelas badge-lean', doc.querySelector('.badge.badge-lean') !== null)
  check('lean: TIDAK menampilkan teks mentah "SUBMITTED"', !badges.includes('SUBMITTED'), JSON.stringify(badges))

  const { doc: d2 } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(LEGACY_PR, makeCtx()))))
  const b2 = [...d2.querySelectorAll('.badge')].map(b => b.textContent.trim())
  check('legacy: badge "Submitted lama"', b2.includes('Submitted lama'), JSON.stringify(b2))
  check('legacy: TIDAK berlabel "Siap Ditindaklanjuti"', !b2.includes('Siap Ditindaklanjuti'))
  check('legacy: badge berkelas badge-legacy', d2.querySelector('.badge.badge-legacy') !== null)
}

console.log('\nR2. Tombol aksi: kirim tanpa approval')
{
  const { doc } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(DRAFT_PR, makeCtx()))))
  const btns = [...doc.querySelectorAll('button')].map(b => b.textContent.trim())
  check('DRAFT: ada tombol "Selesai & Kirim"', btns.some(t => t.includes('Selesai') && t.includes('Kirim')), JSON.stringify(btns))
  check('DRAFT: tombol TIDAK menyebut "Approval"', !btns.some(t => /approval/i.test(t)))
  const sendBtn = [...doc.querySelectorAll('button')].find(b => /Selesai/.test(b.textContent))
  check('DRAFT: title tombol menjelaskan tanpa approval', /tanpa approval/i.test(sendBtn?.getAttribute('title') || ''), sendBtn?.getAttribute('title'))

  const { doc: d2 } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(LEAN_PR, makeCtx({ prItems: PR_ITEMS })))))
  const b2 = [...d2.querySelectorAll('button')].map(b => b.textContent.trim())
  check('lean: tidak ada tombol kirim lagi', !b2.some(t => /Selesai & Kirim/.test(t)), JSON.stringify(b2))
  check('lean: ada tombol "Tutup sisa"', b2.some(t => /Tutup sisa/.test(t)), JSON.stringify(b2))
}

console.log('\nR3. Tutup sisa: alasan wajib + memanggil service')
{
  const calls = []
  const ctx = makeCtx({ prItems: PR_ITEMS, onCloseRemaining: async (pr, reason) => { calls.push({ pr: pr.id, reason }); return { ok: true } } })
  const { dom, doc } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(LEAN_PR, ctx))))
  const openBtn = [...doc.querySelectorAll('button')].find(b => /Tutup sisa/.test(b.textContent))
  flushSync(() => openBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  const dlg = doc.querySelector('[role="dialog"]')
  check('dialog alasan terbuka', !!dlg)
  check('dialog punya textarea alasan', !!dlg?.querySelector('textarea'))
  check('dialog menyatakan qty tidak diubah', /tidak diubah/i.test(dlg?.textContent || ''))

  // Submit kosong -> tidak memanggil service
  flushSync(() => doc.querySelector('[role="dialog"] form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  await new Promise(r => setTimeout(r, 10))
  check('alasan kosong: service TIDAK dipanggil', calls.length === 0, JSON.stringify(calls))
  check('alasan kosong: pesan error tampil', /wajib diisi/i.test(doc.querySelector('[role="dialog"]')?.textContent || ''))

  // Isi alasan lewat props React (menghindari polyfill input-event react-dom
  // di jsdom yang memanggil activeElement.attachEvent).
  const ta = doc.querySelector('[role="dialog"] textarea')
  const propsKey = Object.keys(ta).find(k => k.startsWith('__reactProps'))
  check('textarea punya handler React', !!propsKey && typeof ta[propsKey].onChange === 'function', String(propsKey))
  if (propsKey) {
    flushSync(() => ta[propsKey].onChange({ target: { value: 'sisa diambil dari stok' } }))
  }
  flushSync(() => doc.querySelector('[role="dialog"] form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
  await new Promise(r => setTimeout(r, 30))
  check('alasan terisi: service dipanggil 1x', calls.length === 1, JSON.stringify(calls))
  check('alasan terisi: alasan dikirim apa adanya', calls[0]?.reason === 'sisa diambil dari stok', JSON.stringify(calls[0]))
}

console.log('\nR4. Penanda teknis tidak tampil sebagai catatan')
{
  const prWithClose = { ...LEAN_PR, notes: 'Catatan asli\n[Jalur: LEAN]\n[Tutup: stok workshop]' }
  const ctx = makeCtx({ prItems: PR_ITEMS, openNoteId: 'pr-l' })
  const { doc } = mount(React.createElement('table', null, React.createElement('tbody', null, reqView.desktopRow(prWithClose, ctx))))
  const notePop = doc.querySelector('.note-pop')
  check('note popover tidak memuat [Jalur: LEAN]', !/\[Jalur:/i.test(notePop?.textContent || ''), notePop?.textContent)
  check('note popover tidak memuat [Tutup:]', !/\[Tutup:/i.test(notePop?.textContent || ''), notePop?.textContent)
  check('note popover tetap memuat catatan manusia', /Catatan asli/.test(notePop?.textContent || ''))

  const { doc: dm } = mount(React.createElement('div', null, reqView.mobileCard(prWithClose, makeCtx({ prItems: PR_ITEMS }))))
  check('kartu mobile: catatan tanpa penanda', !/\[Jalur:|\[Tutup:/.test(dm.querySelector('.mobile-card-note')?.textContent || ''), dm.querySelector('.mobile-card-note')?.textContent)
}

console.log('\nR5. Pemenuhan di kartu mobile dari nota DIBELI')
{
  const receivings = [{ id: 'r1', status: 'DIBELI', received_date: '2026-10-19' }]
  const receivingItems = [{ id: 'ri1', receiving_id: 'r1', pr_item_id: 'i1', quantity_received: 1 }]
  const { doc } = mount(React.createElement('div', null, reqView.mobileCard(LEAN_PR, makeCtx({ prItems: PR_ITEMS, allReceivings: receivings, allReceivingItems: receivingItems }))))
  const txt = doc.body.textContent || ''
  check('kartu mobile menampilkan blok Pemenuhan', /Pemenuhan:/.test(txt), txt.slice(0, 500))
  check('pemenuhan sebagian + sisa 3 (1 dari 4 dibeli)', /sisa 3/.test(txt), txt.slice(0, 500))
  check('tidak mengklaim Selesai padahal baru sebagian', !/Pemenuhan:\s*Selesai/.test(txt))

  const { doc: d2 } = mount(React.createElement('div', null, reqView.mobileCard(LEAN_PR, makeCtx({ prItems: PR_ITEMS }))))
  check('tanpa nota: "Belum dibeli" (bukan Selesai)', /Belum dibeli/.test(d2.body.textContent || ''), (d2.body.textContent || '').slice(0, 400))
}

console.log('\nR6. Form PR: estimasi terisi + "Belum ada acuan" + saran vendor opsional')
{
  const doc = SHARED_DOM.window.document
  flushSync(() => SHARED_ROOT.render(React.createElement(CreateModal, {
    page: 'requests',
    allProjects: PROJECTS,
    allMaterials: MATERIALS,
    allVendors: VENDORS,
    existingRequests: [],
    allRequestsFull: [],
    allPrItems: [],
    allReceivingItems: [],
    allReceivings: [],
    close: () => {}, refresh: () => {}, say: () => {}
  })))
  // PENTING: select PERTAMA di .material-picker-box adalah filter Kategori;
  // dropdown material ada di baris pemilih (.pr-picker-row-3).
  const select = doc.querySelector('.pr-picker-row-3 select')
  check('dropdown material tersedia', !!select)
  // Set nilai lewat handler React langsung (jsdom tidak menjalankan polyfill
  // event react-dom dengan benar untuk <select>).
  const setReactValue = (el, value) => {
    const key = Object.keys(el).find(k => k.startsWith('__reactProps'))
    if (!key) return false
    flushSync(() => el[key].onChange({ target: { value } }))
    return true
  }
  const clickReact = (el) => {
    const key = Object.keys(el).find(k => k.startsWith('__reactProps'))
    if (!key) return false
    flushSync(() => el[key].onClick({ preventDefault() {}, stopPropagation() {} }))
    return true
  }
  check('select punya handler React', setReactValue(select, 'm1'))
  const addBtn = () => [...doc.querySelectorAll('.material-picker-box button')].find(b => /Tambah Item/.test(b.textContent))
  check('tombol Tambah Item ada', !!addBtn())
  check('klik Tambah Item via React', clickReact(addBtn()))

  const tableText = () => doc.querySelector('.pr-items-table')?.textContent || ''
  check('item masuk daftar', /Triplek Polos 18mm/.test(tableText()), tableText().slice(0, 300))
  check('estimasi terisi dari master (250.000)', /250\.000/.test(tableText()), tableText().slice(0, 300))
  const chip = doc.querySelector('.pr-vendor-suggest')
  check('blok saran vendor tampil', !!chip)
  check('chip vendor eligible muncul (Toko Kayu Jaya)', /Toko Kayu Jaya/.test(chip?.textContent || ''), chip?.textContent)
  check('vendor TIDAK terpilih otomatis', !doc.querySelector('.pr-vendor-suggest .pill.active'))

  // Material tanpa acuan -> "Belum ada acuan"
  const select2 = doc.querySelector('.pr-picker-row-3 select')
  setReactValue(select2, 'm2')
  clickReact(addBtn())
  check('material tanpa acuan: "Belum ada acuan" tampil', /Belum ada acuan/.test(tableText()), tableText().slice(0, 500))
  check('material tanpa acuan: TIDAK diisi Rp 0', !/Rp\s*0\b/.test(tableText()))
}

console.log(`\n================ HASIL RENDER ================`)
console.log(`LULUS: ${pass}   GAGAL: ${fail}`)
if (fail) { for (const f of failures) console.error(` - ${f}`); process.exit(1) }
console.log('SEMUA ACCEPTANCE UI JALUR LEAN LULUS')
