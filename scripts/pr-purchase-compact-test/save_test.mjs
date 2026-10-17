// ============================================================
// SAVE TEST — modules/requests/save.js (ASLI, dist hasil SWC)
// t_cde1b8ad: memastikan pemangkasan UI PR TIDAK mengubah kontrak simpan.
//   B1 payload pr_items tetap memuat vendor_id & supplier_category
//   B2 gate vendor tidak-eligible masih menolak
//   B3 notes tetap ditulis (fallback judul)
//   B4 edit PR: vendor tersimpan tidak dihapus diam-diam
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const saveMod = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/save.mjs')).href)
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const MATERIALS = [
  { id: 'mHPL', kode: 'HPL-0001', name: 'HPL Putih', category: 'HPL & Edging' },
  { id: 'mALM', kode: 'ALM-0001', name: 'Frame Baleno', category: 'Aluminium & Profil' }
]
const VENDORS = [
  { id: 'vHPL', name: 'Toko HPL Jaya', supplier_category: 'HPL & Edging' },
  { id: 'vALM', name: 'Toko Aluminium', supplier_category: 'Aluminium & Profil' }
]

function makeCtx(items, extra = {}) {
  const notices = []
  return {
    ctx: {
      form: { project_id: 'p1', title: 'PR uji ringkas', pr_number: 'PR-001', priority: 'NORMAL', notes: '', ...(extra.form || {}) },
      isEdit: !!extra.isEdit,
      editRow: extra.editRow || null,
      editItems: extra.editItems || [],
      prItemsList: items,
      nextPrNum: 'PR-001',
      allMaterials: MATERIALS,
      allVendors: VENDORS,
      allPrItems: [], allReceivingItems: [], allReceivings: [],
      say: m => notices.push(m),
      close: () => {},
      refresh: () => {},
      setSaving: () => {}
    },
    notices
  }
}

console.log('=== SAVE BOUNDARY: modules/requests/save.js (kontrak t_cde1b8ad) ===\n')

// ---------- B1: payload tetap memuat vendor_id & supplier_category ----------
console.log('B1. Payload pr_items tetap memuat vendor_id & supplier_category')
{
  mock.__reset()
  const items = [
    // Item BARU dari form ringkas: PR tidak lagi menanyakan toko → kosong.
    { material_id: 'mHPL', name: 'HPL Putih', kode: 'HPL-0001', satuan: 'Lembar', qty: 2, estimated_price: '150.000', vendor_id: '', supplier_category: '' },
    // Item LAMA yang masih menyimpan rencana toko → nilai dipertahankan.
    { material_id: 'mALM', name: 'Frame Baleno', kode: 'ALM-0001', satuan: 'Meter', qty: 1, estimated_price: '700.000', vendor_id: 'vALM', supplier_category: 'Aluminium & Profil' }
  ]
  const { ctx, notices } = makeCtx(items)
  await saveMod.save(ctx)
  const ins = mock.__callsOf('insert', 'pr_items')
  check('pr_items diinsert', ins.length === 1, String(ins.length))
  const rows = ins[0]?.data || []
  check('2 baris item tersimpan', Array.isArray(rows) && rows.length === 2, String(rows?.length))
  check('kolom vendor_id ADA di setiap baris (tidak dihapus dari payload)',
    rows.every(r => Object.prototype.hasOwnProperty.call(r, 'vendor_id')), JSON.stringify(rows.map(r => Object.keys(r))))
  check('kolom supplier_category ADA di setiap baris',
    rows.every(r => Object.prototype.hasOwnProperty.call(r, 'supplier_category')))
  check('item baru tanpa toko → vendor_id null (bukan string kosong / bukan kolom hilang)', rows[0].vendor_id === null, String(rows[0].vendor_id))
  check('item lama: vendor_id tersimpan apa adanya', rows[1].vendor_id === 'vALM', String(rows[1].vendor_id))
  check('item lama: supplier_category tersimpan apa adanya', rows[1].supplier_category === 'Aluminium & Profil', String(rows[1].supplier_category))
  check('harga integer rupiah (150000)', rows[0].estimated_price === 150000, String(rows[0].estimated_price))
  check('PR berhasil dibuat', notices.some(n => n.includes('berhasil dibuat')), notices.join(' | '))
}

// ---------- B2: gate vendor tidak-eligible masih menolak ----------
console.log('\nB2. Gate vendor eligible tetap berlaku (service boundary tidak dilonggarkan)')
{
  mock.__reset()
  const items = [
    { material_id: 'mHPL', name: 'HPL Putih', kode: 'HPL-0001', satuan: 'Lembar', qty: 1, estimated_price: '100.000', vendor_id: 'vALM', supplier_category: 'HPL & Edging' }
  ]
  const { ctx, notices } = makeCtx(items)
  await saveMod.save(ctx)
  check('vendor tidak eligible DITOLAK', notices[0]?.includes('tidak aktif pada kategori'), notices[0])
  check('pesan menyebut kategori material (HPL & Edging)', notices[0]?.includes('HPL & Edging'), notices[0])
  check('TIDAK ada tulisan ke DB saat ditolak', mock.__state.calls.filter(c => c.op === 'insert' || c.op === 'update').length === 0)
}

// ---------- B3: notes tetap ditulis walau UI dilipat ----------
console.log('\nB3. purchase_requests.notes tetap ditulis (UI catatan hanya dilipat)')
{
  mock.__reset()
  const items = [{ material_id: 'mHPL', name: 'HPL Putih', kode: 'HPL-0001', satuan: 'Lembar', qty: 1, estimated_price: '100.000', vendor_id: '', supplier_category: '' }]
  const { ctx } = makeCtx(items, { form: { notes: 'catatan dari lapangan' } })
  await saveMod.save(ctx)
  const pr = mock.__callsOf('insert', 'purchase_requests')[0]?.data
  check('catatan terisi tersimpan apa adanya', pr?.notes === 'catatan dari lapangan', String(pr?.notes))
  check('title & priority tetap tersimpan', pr?.title === 'PR uji ringkas' && pr?.priority === 'NORMAL')

  // Catatan kosong → fallback judul (perilaku lama, tidak diubah)
  mock.__reset()
  const c2 = makeCtx(items, { form: { notes: '' } })
  await saveMod.save(c2.ctx)
  const pr2 = mock.__callsOf('insert', 'purchase_requests')[0]?.data
  check('catatan kosong → fallback judul PR (perilaku lama dipertahankan)', pr2?.notes === 'PR uji ringkas', String(pr2?.notes))
}

// ---------- B4: edit PR tidak menghapus vendor tersimpan diam-diam ----------
console.log('\nB4. Edit PR: vendor tersimpan tidak dihapus diam-diam')
{
  mock.__reset({
    tables: {
      purchase_requests: [{ id: 'prX', pr_number: 'PR-005', title: 'PR lama', status: 'DRAFT', priority: 'NORMAL' }],
      pr_items: [{ id: 'piX', pr_id: 'prX', material_id: 'mALM', item_name: 'Frame Baleno', kode: 'ALM-0001', unit: 'Meter', quantity: 3, estimated_price: 700000, vendor_id: 'vALM', supplier_category: 'Aluminium & Profil', sort_order: 0 }]
    }
  })
  const items = [
    { id: 'piX', material_id: 'mALM', name: 'Frame Baleno', kode: 'ALM-0001', satuan: 'Meter', qty: 3, estimated_price: '700.000', vendor_id: 'vALM', supplier_category: 'Aluminium & Profil' }
  ]
  const { ctx, notices } = makeCtx(items, {
    isEdit: true,
    editRow: { id: 'prX', pr_number: 'PR-005' },
    editItems: [{ id: 'piX', status: 'PENDING_APPROVAL' }]
  })
  await saveMod.save(ctx)
  const upd = mock.__callsOf('update', 'pr_items')
  check('pr_items diupdate (bukan dihapus+insert)', upd.length === 1, String(upd.length))
  check('vendor_id lama tetap dikirim di update', upd[0]?.data?.vendor_id === 'vALM', String(upd[0]?.data?.vendor_id))
  check('supplier_category lama tetap dikirim', upd[0]?.data?.supplier_category === 'Aluminium & Profil')
  check('tidak ada DELETE pr_items (vendor tidak dibuang)', mock.__callsOf('delete', 'pr_items').length === 0)
  check('PR diperbarui', notices.some(n => n.includes('berhasil diperbarui')), notices.join(' | '))
}

console.log(`\n=== HASIL SAVE: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('KONTRAK SIMPAN PR UTUH (t_cde1b8ad)')
