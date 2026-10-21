// ============================================================
// probe_r248_split_ui.mjs — UI PEMBAGIAN 1 BARIS → BEBERAPA PROYEK
// ============================================================
// Acceptance 4 (OPERATIONAL_BATCH_1.md): pembagian satu baris ke beberapa
// proyek harus bisa DIISI admin dan tersimpan terstruktur — bukan hanya
// "payload-nya siap". Run 246 menyatakan gap ini terbuka: "Belum ada UI untuk
// mengisi allocations split". Probe ini menguji UI itu di jsdom dengan modul
// produksi VERBATIM.
//
// Yang diuji:
//   S1  panel pembagian bisa dibuka dari SETIAP baris (termasuk baris PR)
//   S2  isi 2 proyek + qty → ringkasan "pas" dan form dinyatakan valid
//   S3  qty tidak pas → ringkasan menyatakan sisa + tombol Simpan DIMATIKAN
//   S4  satu proyek saja → ditolak (butuh >= 2 proyek berbeda)
//   S5  "Isi otomatis" membagi rata dan totalnya PERSIS qty
//   S6  payload yang dikirim ke savePurchase memuat allocations (bukan dibuang)
//   S7  skema belum aktif (capability LEGACY) → pembagian DIBLOKIR dengan
//       sebab terbaca; Simpan mati; NOL tulisan (tidak ada fake persistence)
//   S8  batalkan pembagian → kembali ke satu proyek, Simpan hidup lagi
//   S9  baris belanja langsung WAJIB pilih material saat jalur atomik aktif
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()

// ---------- DOM dulu (sebelum react-dom) ----------
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const PurchaseForm = (await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/purchaseForm.mjs')).href)).default
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const { __state, __reset, __callsOf } = mock

let pass = 0, fail = 0
const failures = []
function ck(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)
const tick = () => new Promise(r => setTimeout(r, 0))
const click = (el) => { if (!el) throw new Error('elemen tidak ada'); flushSync(() => el.dispatchEvent(new window.Event('click', { bubbles: true }))) }
const typeInto = (el, val) => {
  if (!el) throw new Error('input tidak ada')
  const proto = el.tagName === 'TEXTAREA' ? dom0.window.HTMLTextAreaElement.prototype : dom0.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new dom0.window.Event('input', { bubbles: true }))
  })
}
const selectValue = (el, val) => {
  if (!el) throw new Error('select tidak ada')
  const setter = Object.getOwnPropertyDescriptor(dom0.window.HTMLSelectElement.prototype, 'value').set
  flushSync(() => {
    setter.call(el, val)
    el.dispatchEvent(new dom0.window.Event('change', { bubbles: true }))
  })
}
const tid = (doc, id) => doc.querySelector(`[data-testid="${id}"]`)
const byTidPrefix = (doc, p) => [...doc.querySelectorAll(`[data-testid^="${p}"]`)]
// Submit NYATA: klik sintetis pada <button type=submit> tidak menjalankan
// activation behavior di jsdom, jadi form harus di-submit lewat requestSubmit()
// (sama seperti harness purchase-flow-test). Ini menguji onSubmit produksi.
const submitForm = (doc) => { flushSync(() => tid(doc, 'purchase-form').requestSubmit()) }

const PROJECTS = [
  { id: 'p1', kode: '83', name: 'Mabes', status: 'ON_GOING' },
  { id: 'p2', kode: 'PS 1', name: 'Cendana Breeze', status: 'ON_GOING' }
]
const VENDORS = [{ id: 'v1', name: 'TB Sumber Jaya' }]
const MATERIALS = [{ id: 'm1', kode: 'PLY-0001', name: 'Triplek 9mm', satuan: 'Lembar', harga_acuan: 120000 }]
const ROWS = [{
  key: 'pi1', prItemId: 'pi1', prId: 'pr1', prNumber: 'PR-001', prTitle: 'Lemari',
  itemName: 'Triplek 9mm', unit: 'Lembar', qtyPr: 10, qtyBought: 0, qtySisa: 10,
  estimasi: 140000, materialId: 'm1', materialName: 'Triplek 9mm', hargaAcuan: 120000,
  kategori: 'Plywood', projectId: 'p1', projectName: '[83] Mabes', vendorId: 'v1',
  vendorName: 'TB Sumber Jaya', vendorKnown: true, isDirect: false
}]
const DIRECT_ROWS = [{
  key: 'direct-1', prItemId: null, prId: null, prNumber: '', prTitle: '',
  itemName: '', unit: '', qtyPr: null, qtyBought: 0, qtySisa: null, estimasi: null,
  materialId: null, materialName: '', hargaAcuan: null, kategori: '',
  projectId: null, projectName: 'Belanja langsung', vendorId: '', vendorName: '',
  vendorKnown: false, isDirect: true
}]

// Capability palsu: hanya untuk menguji CABANG UI. Nilai `ready` di sini
// berarti "DB punya kolom typed + tabel alokasi + RPC" — dibuktikan terpisah
// di probe APP→PG (39/0) terhadap PostgreSQL nyata.
function installCapability(state) {
  mock.supabase.rpc = async (fn, args) => {
    __state.calls.push({ op: 'rpc', fn, args })
    if (fn === 'purchase_save_atomic') {
      if (state === 'ready') return { data: { ok: false, reason: 'request_key_required' }, error: null }
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.purchase_save_atomic' } }
    }
    if (fn === 'handover_create_atomic') {
      return { data: { ok: false, reason: 'receiving_not_found' }, error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function ${fn}` } }
  }
}

let container = null
let root = null
function mount(props = {}) {
  if (root) { flushSync(() => root.unmount()) }
  container = dom0.window.document.createElement('div')
  dom0.window.document.body.innerHTML = ''
  dom0.window.document.body.appendChild(container)
  root = createRoot(container)
  flushSync(() => root.render(React.createElement(PurchaseForm, {
    rows: ROWS, vendorId: 'v1', vendors: VENDORS, projects: PROJECTS, materials: MATERIALS,
    receivings: [], receivingItems: [], close: () => {}, onDone: () => {}, say: () => {},
    ...props
  })))
  return dom0.window.document
}
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick() }

// ===========================================================================
head('S0. Persiapan: capability READY (cabang atomik)')
installCapability('ready')
__reset({ tables: {} })
let doc = mount()
await settle()
ck('S0a banner kesiapan menyatakan aktif', !!tid(doc, 'purchase-cap-banner') &&
  tid(doc, 'purchase-cap-banner').getAttribute('data-cap-state') === 'ready',
  tid(doc, 'purchase-cap-banner')?.getAttribute('data-cap-state'))

// Isi harga supaya validasi qty/harga tidak menutupi uji pembagian.
typeInto(tid(doc, 'harga-pi1'), '95000')
await settle()

head('S1. Tombol pembagian ADA di setiap baris (termasuk baris dari PR)')
ck('S1a tombol "Bagi ke proyek" ada di baris PR', !!tid(doc, 'split-open-pi1'))
ck('S1b panel belum terbuka', !tid(doc, 'split-panel-pi1'))
click(tid(doc, 'split-open-pi1'))
await settle()
ck('S1c panel terbuka setelah diklik', !!tid(doc, 'split-panel-pi1'))
ck('S1d dua porsi awal disediakan', !!tid(doc, 'split-proj-pi1-0') && !!tid(doc, 'split-proj-pi1-1'))
ck('S1e porsi pertama terisi proyek asal baris (tanpa ketik ulang)',
  tid(doc, 'split-proj-pi1-0')?.value === 'p1', tid(doc, 'split-proj-pi1-0')?.value)
ck('S1f ringkasan menyatakan belum pas', tid(doc, 'split-summary-pi1')?.getAttribute('data-split-ok') === 'no')

head('S2. Isi 2 proyek + qty pas (12/8 dari 20) → valid & Simpan hidup')
typeInto(tid(doc, 'qty-pi1'), '20')
await settle()
selectValue(tid(doc, 'split-proj-pi1-0'), 'p1')
await settle()
typeInto(tid(doc, 'split-qty-pi1-0'), '12')
await settle()
selectValue(tid(doc, 'split-proj-pi1-1'), 'p2')
await settle()
typeInto(tid(doc, 'split-qty-pi1-1'), '8')
await settle()
ck('S2a ringkasan "pas"', tid(doc, 'split-summary-pi1')?.getAttribute('data-split-ok') === 'yes',
  tid(doc, 'split-summary-pi1')?.textContent)
ck('S2b label baris menyatakan dibagi 2 proyek', /dibagi 2 proyek/.test(tid(doc, 'split-active-pi1')?.textContent || ''),
  tid(doc, 'split-active-pi1')?.textContent)
typeInto(tid(doc, 'form-invoice'), 'R248-UI-1')
await settle()
ck('S2c tombol Simpan AKTIF saat pembagian pas', tid(doc, 'purchase-submit')?.disabled === false,
  String(tid(doc, 'purchase-submit')?.disabled))
ck('S2d TIDAK ada banner blokir', !tid(doc, 'purchase-split-blocked'))

head('S3. Qty tidak pas (12/7) → sisa terbaca, Simpan DIMATIKAN')
typeInto(tid(doc, 'split-qty-pi1-1'), '7')
await settle()
ck('S3a ringkasan tidak pas', tid(doc, 'split-summary-pi1')?.getAttribute('data-split-ok') === 'no')
ck('S3b ringkasan menyebut sisa 1', /sisa 1\b/.test(tid(doc, 'split-summary-pi1')?.textContent || ''),
  tid(doc, 'split-summary-pi1')?.textContent)
ck('S3c tombol Simpan DIMATIKAN', tid(doc, 'purchase-submit')?.disabled === true)
ck('S3d tombol Simpan DIMATIKAN saat tidak pas (klik tidak mengirim)', tid(doc, 'purchase-submit')?.disabled === true)
// Paksa onSubmit lewat requestSubmit untuk membaca pesan validasi produksi.
submitForm(doc)
await settle()
ck('S3e pesan error menyebut jumlah pembagian', /Jumlah pembagian/.test(tid(doc, 'purchase-error')?.textContent || ''),
  tid(doc, 'purchase-error')?.textContent)

head('S4. Satu proyek saja → DITOLAK (butuh >= 2 proyek berbeda)')
selectValue(tid(doc, 'split-proj-pi1-1'), 'p1')
await settle()
typeInto(tid(doc, 'split-qty-pi1-1'), '8')
await settle()
ck('S4a ringkasan tidak pas', tid(doc, 'split-summary-pi1')?.getAttribute('data-split-ok') === 'no')
ck('S4b Simpan DIMATIKAN', tid(doc, 'purchase-submit')?.disabled === true)

head('S5. "Isi otomatis" membagi rata dengan total PERSIS qty')
selectValue(tid(doc, 'split-proj-pi1-1'), 'p2')
await settle()
click(tid(doc, 'split-suggest-pi1'))
await settle()
const autoA = Number(tid(doc, 'split-qty-pi1-0')?.value)
const autoB = Number(tid(doc, 'split-qty-pi1-1')?.value)
ck('S5a dua porsi terisi', autoA > 0 && autoB > 0, `${autoA}/${autoB}`)
ck('S5b total PERSIS = qty beli (20)', Math.abs((autoA + autoB) - 20) < 0.001, `${autoA + autoB}`)
ck('S5c ringkasan "pas"', tid(doc, 'split-summary-pi1')?.getAttribute('data-split-ok') === 'yes')

head('S6. Payload ke savePurchase memuat allocations (bukan dibuang)')
// Kembalikan ke 12/8 supaya angka mudah dibaca di assertion.
typeInto(tid(doc, 'split-qty-pi1-0'), '12')
await settle()
typeInto(tid(doc, 'split-qty-pi1-1'), '8')
await settle()
__state.calls.length = 0
submitForm(doc)
await settle(14)
const rpcCall = __state.calls.find(c => c.op === 'rpc' && c.fn === 'purchase_save_atomic')
const payload = rpcCall?.args?.p_payload
ck('S6a RPC purchase_save_atomic dipanggil', !!rpcCall)
ck('S6b payload memuat allocations 2 porsi', Array.isArray(payload?.items?.[0]?.allocations) &&
  payload.items[0].allocations.length === 2, JSON.stringify(payload?.items?.[0]?.allocations))
ck('S6c qty porsi LITERAL 12/8 (bukan dibagi rata)', (() => {
  const a = payload?.items?.[0]?.allocations || []
  const got = a.map(x => Number(x.qty)).sort((x, y) => y - x)
  return got[0] === 12 && got[1] === 8
})(), JSON.stringify(payload?.items?.[0]?.allocations))
ck('S6d baris split TIDAK membawa project_id tunggal (XOR kontrak)',
  payload?.items?.[0]?.project_id === null || payload?.items?.[0]?.project_id === undefined,
  String(payload?.items?.[0]?.project_id))
ck('S6e material_id ikut terkirim', payload?.items?.[0]?.material_id === 'm1')

head('S7. Skema BELUM aktif → pembagian DIBLOKIR, nol tulisan')
installCapability('legacy')
__reset({ tables: {} })
doc = mount()
await settle()
typeInto(tid(doc, 'harga-pi1'), '95000')
await settle()
click(tid(doc, 'split-open-pi1'))
await settle()
selectValue(tid(doc, 'split-proj-pi1-1'), 'p2')
await settle()
typeInto(tid(doc, 'split-qty-pi1-0'), '12')
await settle()
typeInto(tid(doc, 'split-qty-pi1-1'), '8')
await settle()
typeInto(tid(doc, 'qty-pi1'), '20')
await settle()
typeInto(tid(doc, 'form-invoice'), 'R248-UI-2')
await settle()
ck('S7a banner blokir muncul', !!tid(doc, 'purchase-split-blocked'))
ck('S7b banner menyebut pembagian tidak akan disimpan', /tidak hilang tanpa jejak|BELUM aktif/i.test(
  tid(doc, 'purchase-split-blocked')?.textContent || ''), tid(doc, 'purchase-split-blocked')?.textContent)
ck('S7c tombol Simpan DIMATIKAN', tid(doc, 'purchase-submit')?.disabled === true)
__state.calls.length = 0
click(tid(doc, 'purchase-submit'))
await settle(6)
ck('S7d NOL panggilan RPC/tulis', __state.calls.filter(c => c.op === 'rpc' || c.op === 'insert').length === 0,
  JSON.stringify(__state.calls.map(c => `${c.op}:${c.fn || c.table}`)))

head('S8. Batalkan pembagian → kembali satu proyek, Simpan hidup lagi')
click(tid(doc, 'split-cancel-pi1'))
await settle()
ck('S8a panel tertutup', !tid(doc, 'split-panel-pi1'))
ck('S8b label pembagian hilang', !tid(doc, 'split-active-pi1'))
ck('S8c banner blokir hilang', !tid(doc, 'purchase-split-blocked'))
ck('S8d tombol Simpan AKTIF lagi', tid(doc, 'purchase-submit')?.disabled === false,
  String(tid(doc, 'purchase-submit')?.disabled))

head('S9. Belanja langsung: material WAJIB saat jalur atomik aktif')
installCapability('ready')
__reset({ tables: {} })
doc = mount({ rows: DIRECT_ROWS, vendorId: '' })
await settle()
ck('S9a pemilih material ada di baris langsung', !!tid(doc, 'material-direct-1'))
selectValue(tid(doc, 'form-vendor'), 'v1')
await settle()
typeInto(tid(doc, 'nama-direct-1'), 'Semen 50kg')
await settle()
typeInto(tid(doc, 'qty-direct-1'), '3')
await settle()
typeInto(tid(doc, 'harga-direct-1'), '65000')
await settle()
typeInto(tid(doc, 'form-invoice'), 'R248-UI-3')
await settle()
ck('S9b tanpa material → Simpan DIMATIKAN', tid(doc, 'purchase-submit')?.disabled === true)
selectValue(tid(doc, 'material-direct-1'), 'm1')
await settle()
ck('S9c setelah material dipilih → Simpan AKTIF', tid(doc, 'purchase-submit')?.disabled === false,
  String(tid(doc, 'purchase-submit')?.disabled))
__state.calls.length = 0
submitForm(doc)
await settle(14)
const rpc2 = __state.calls.find(c => c.op === 'rpc' && c.fn === 'purchase_save_atomic')
ck('S9d payload membawa material_id hasil pilihan admin', rpc2?.args?.p_payload?.items?.[0]?.material_id === 'm1',
  String(rpc2?.args?.p_payload?.items?.[0]?.material_id))

// ===========================================================================
console.log(`\n=== HASIL PROBE 248 UI: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
