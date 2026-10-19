// ============================================================
// logic_test.mjs — ACCEPTANCE TEST jalur lean (tanpa approval)
// ============================================================
// MENGUJI KONTRAK, bukan sekadar "fungsi jalan":
//   A. Penanda jalur: parse/tulis/idempotensi/preservasi catatan manusia.
//   B. Klasifikasi: legacy SUBMITTED tanpa approval_steps TIDAK dianggap lean.
//   C. submitLean: 0 insert approval_steps, 0 insert receivings, 0 perubahan
//      status pr_items, status existing, readback, klik ganda idempoten.
//   D. Tolak request kosong / qty invalid / status tidak eligible.
//   E. Tutup sisa: alasan wajib, qty asli TIDAK berubah, penanda tidak dobel.
//   F. Pemenuhan: realisasi dari nota DIBELI valid saja; estimasi tidak
//      dihitung; nota DRAFT/RETUR diabaikan; partial/over/closed benar.
//   G. Autofill estimasi & saran vendor: dikenal vs "Belum ada acuan",
//      tidak ada 0 palsu, vendor tidak wajib, tidak mengubah master.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { __reset, __ops, __setInjectedError, db, createMockSupabase, writesTo } from './mock.mjs'

const SB = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)

const lean = await load('modules/requests/leanRequest.mjs')
const submitMod = await load('modules/requests/submitLean.mjs')
const fulfill = await load('modules/requests/fulfillment.mjs')
const suggest = await load('modules/requests/suggest.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
function section(t) { console.log(`\n=== ${t} ===`) }

// ------------------------------------------------------------
section('A. Penanda jalur lean di purchase_requests.notes')
{
  check('notes kosong: bukan lean', lean.isLeanMarked('') === false)
  check('notes tanpa penanda: bukan lean', lean.isLeanMarked('Catatan biasa') === false)

  const m = lean.withLeanMarker('Catatan biasa')
  check('penanda ditulis', lean.isLeanMarked(m) === true, m)
  check('teks manusia dipertahankan', m.includes('Catatan biasa'), m)

  const m2 = lean.withLeanMarker(m)
  check('idempoten: tidak dobel', (m2.match(/\[Jalur:\s*LEAN\]/gi) || []).length === 1, m2)

  check('strip: penanda hilang, teks tinggal', lean.stripLeanMarkers(m) === 'Catatan biasa', lean.stripLeanMarkers(m))

  // Preservasi penanda lain saat kirim
  const closed = lean.withCloseMarker('Catatan', 'tidak jadi beli', new Date('2026-10-20T03:00:00Z'))
  check('penutupan: ok', closed.ok === true)
  const both = lean.withLeanMarker(closed.notes)
  check('kirim ulang tidak menghapus [Tutup:]', /\[Tutup:\s*tidak jadi beli\]/i.test(both), both)
  check('penutupan: alasan terbaca', lean.closeReasonOf(closed.notes) === 'tidak jadi beli')
  check('penutupan: timestamp terbaca', lean.closedAtOf(closed.notes) === '2026-10-20T03:00:00.000Z', lean.closedAtOf(closed.notes))

  // Penutupan ulang mengganti, bukan menumpuk
  const re = lean.withCloseMarker(closed.notes, 'alasan baru', new Date('2026-10-21T00:00:00Z'))
  check('penutupan ulang: hanya 1 penanda', (re.notes.match(/\[Tutup:/gi) || []).length === 1, re.notes)
  check('penutupan ulang: alasan terbaru', lean.closeReasonOf(re.notes) === 'alasan baru')

  // Alasan wajib / invalid
  check('alasan kosong ditolak', lean.withCloseMarker('x', '   ').ok === false)
  check('alasan dengan ] ditolak', lean.withCloseMarker('x', 'a]b').ok === false)
  check('alasan > 300 char ditolak', lean.withCloseMarker('x', 'a'.repeat(301)).ok === false)

  // Edit catatan: penanda tidak hilang
  const edited = lean.composeNotesWithMarkers('catatan baru', m)
  check('edit catatan: penanda tetap ada', lean.isLeanMarked(edited), edited)
  check('edit catatan: teks baru masuk', edited.includes('catatan baru'), edited)
  check('edit catatan: teks lama tidak diduplikasi jadi 2 baris', edited.split('\n').filter(Boolean).length <= 2, JSON.stringify(edited))
}

// ------------------------------------------------------------
section('B. Klasifikasi request: legacy TIDAK otomatis lean')
{
  const legacySubmitted = { status: 'SUBMITTED', notes: 'catatan lama' }
  const c1 = lean.classifyRequest(legacySubmitted, { approvalStepCount: 0 })
  check('SUBMITTED tanpa approval_steps -> LEGACY_UNKNOWN', c1.key === 'LEGACY_UNKNOWN', JSON.stringify(c1))
  check('legacy tidak dianggap lean', c1.lean === false)
  check('label legacy jujur (bukan Siap Ditindaklanjuti)', lean.requestStatusLabel(legacySubmitted, { approvalStepCount: 0 }) === 'Submitted lama (tanpa jejak approval)')

  const c2 = lean.classifyRequest({ status: 'SUBMITTED', notes: 'x' }, { approvalStepCount: 2 })
  check('SUBMITTED + approval_steps -> LEGACY_APPROVAL', c2.key === 'LEGACY_APPROVAL')

  const leanPr = { status: 'SUBMITTED', notes: 'x [Jalur: LEAN]' }
  const c3 = lean.classifyRequest(leanPr, { approvalStepCount: 0 })
  check('SUBMITTED + penanda -> LEAN', c3.key === 'LEAN')
  check('label lean: Siap Ditindaklanjuti', lean.requestStatusLabel(leanPr) === 'Siap Ditindaklanjuti')
  check('lean actionable', lean.isActionable(leanPr) === true)
  check('legacy unknown NOT actionable', lean.isActionable(legacySubmitted) === false)

  check('DRAFT -> DRAFT', lean.classifyRequest({ status: 'DRAFT', notes: '' }).key === 'DRAFT')
  check('APPROVED tetap APPROVED (riwayat)', lean.classifyRequest({ status: 'APPROVED', notes: '' }).key === 'APPROVED')
}

// ------------------------------------------------------------
section('C. submitLean: tidak membuat approval / nota / ubah item')
const supabase = createMockSupabase()
const basePr = { id: 'pr-1', pr_number: 'PR-101', title: 'Kebutuhan Tukang', status: 'DRAFT', notes: 'Catatan asli tukang', project_id: 'p1' }
const baseItems = [
  { id: 'pi-1', pr_id: 'pr-1', item_name: 'Triplek 18mm', quantity: 4, unit: 'Lembar', status: 'PENDING_APPROVAL' },
  { id: 'pi-2', pr_id: 'pr-1', item_name: 'Sekrup 3cm', quantity: 100, unit: 'Pcs', status: 'PENDING_APPROVAL' }
]
{
  __reset({ purchase_requests: [basePr], pr_items: baseItems })
  const res = await submitMod.submitLean(basePr, { supabase, confirmFn: () => true })
  check('submitLean ok', res.ok === true, JSON.stringify(res))
  check('status DB menjadi SUBMITTED (nilai existing)', db.purchase_requests[0].status === 'SUBMITTED', db.purchase_requests[0].status)
  check('penanda lean tersimpan', lean.isLeanMarked(db.purchase_requests[0].notes), db.purchase_requests[0].notes)
  check('catatan manusia asli dipertahankan', db.purchase_requests[0].notes.includes('Catatan asli tukang'), db.purchase_requests[0].notes)
  check('TIDAK insert approval_steps', writesTo('approval_steps').length === 0, JSON.stringify(writesTo('approval_steps')))
  check('TIDAK insert receivings (bukan cangkang nota)', writesTo('receivings').length === 0)
  check('TIDAK menulis pr_items', writesTo('pr_items').length === 0, JSON.stringify(writesTo('pr_items')))
  check('item tetap PENDING_APPROVAL (bukan APPROVED palsu)', db.pr_items.every(i => i.status === 'PENDING_APPROVAL'))
  check('tidak ada nilai APPROVED ditulis ke purchase_requests', !__ops.some(o => o.op === 'update' && o.table === 'purchase_requests' && String(o.payload?.status).toUpperCase() === 'APPROVED'))
  check('tidak ada approver_id ditulis', !__ops.some(o => o.op === 'insert' && o.payload?.approver_id))
  check('readback dilakukan', __ops.some(o => o.op === 'single' && o.table === 'purchase_requests'))

  // Klik ganda
  const opsBefore = __ops.length
  const res2 = await submitMod.submitLean(db.purchase_requests[0], { supabase, confirmFn: () => true })
  check('klik ganda: ok + alreadySubmitted', res2.ok === true && res2.alreadySubmitted === true, JSON.stringify(res2))
  check('klik ganda: 0 write tambahan', __ops.slice(opsBefore).filter(o => ['insert', 'update', 'delete'].includes(o.op)).length === 0)
  check('klik ganda: hanya 1 penanda', (db.purchase_requests[0].notes.match(/\[Jalur:\s*LEAN\]/gi) || []).length === 1)
}

{
  // Batal konfirmasi -> 0 write
  __reset({ purchase_requests: [basePr], pr_items: baseItems })
  const res = await submitMod.submitLean(basePr, { supabase, confirmFn: () => false })
  check('batal: reason cancelled', res.reason === 'cancelled')
  check('batal: 0 write', __ops.filter(o => ['insert', 'update', 'delete'].includes(o.op)).length === 0)
  check('batal: status tetap DRAFT', db.purchase_requests[0].status === 'DRAFT')
}

{
  // Request kosong ditolak
  __reset({ purchase_requests: [{ ...basePr, id: 'pr-empty' }], pr_items: [] })
  const res = await submitMod.submitLean({ ...basePr, id: 'pr-empty' }, { supabase, confirmFn: () => true })
  check('request tanpa item ditolak', res.ok === false && /belum punya item/i.test(res.error || ''), JSON.stringify(res))
  check('request tanpa item: status tetap DRAFT', db.purchase_requests[0].status === 'DRAFT')
}

{
  // Qty invalid ditolak
  __reset({ purchase_requests: [{ ...basePr, id: 'pr-bad' }], pr_items: [{ id: 'pi-x', pr_id: 'pr-bad', item_name: 'Triplek', quantity: 0, unit: 'Lembar', status: 'PENDING_APPROVAL' }] })
  const res = await submitMod.submitLean({ ...basePr, id: 'pr-bad' }, { supabase, confirmFn: () => true })
  check('qty 0 ditolak', res.ok === false && /tidak valid/i.test(res.error || ''), JSON.stringify(res))
  check('qty invalid: status tetap DRAFT', db.purchase_requests[0].status === 'DRAFT')
}

{
  // Status tidak eligible
  __reset({ purchase_requests: [{ ...basePr, id: 'pr-app', status: 'APPROVED' }], pr_items: [{ id: 'pi-a', pr_id: 'pr-app', item_name: 'X', quantity: 1, unit: 'Pcs', status: 'APPROVED' }] })
  const res = await submitMod.submitLean({ ...basePr, id: 'pr-app', status: 'APPROVED' }, { supabase, confirmFn: () => true })
  check('APPROVED tidak bisa disubmit lean', res.ok === false && /tidak dapat dikirim/i.test(res.error || ''), JSON.stringify(res))
  check('APPROVED tidak diubah', db.purchase_requests[0].status === 'APPROVED')
}

{
  // Error DB -> tidak ada sukses palsu
  __reset({ purchase_requests: [basePr], pr_items: baseItems })
  __setInjectedError('purchase_requests.update', 'Simulated write failure')
  const res = await submitMod.submitLean(basePr, { supabase, confirmFn: () => true })
  check('gagal tulis: ok=false', res.ok === false, JSON.stringify(res))
  check('gagal tulis: status tetap DRAFT', db.purchase_requests[0].status === 'DRAFT')
  check('gagal tulis: pesan error nyata', /Simulated write failure/.test(res.error || ''), res.error)
}

{
  // Readback gagal (update "sukses" tapi penanda tidak tersimpan)
  __reset({ purchase_requests: [basePr], pr_items: baseItems })
  let prSelect = 0
  const fake = {
    from(table) {
      if (table === 'pr_items') {
        return {
          select() { return this },
          eq: async () => ({ data: baseItems, error: null })
        }
      }
      return {
        select() { return this },
        eq() { return this },
        async single() {
          prSelect++
          // panggilan pertama (verifikasi status): DRAFT, belum lean
          if (prSelect === 1) return { data: { id: 'pr-1', pr_number: 'PR-101', status: 'DRAFT', notes: 'Catatan asli tukang' }, error: null }
          // panggilan kedua (readback setelah update): status berubah tapi penanda HILANG
          return { data: { id: 'pr-1', status: 'SUBMITTED', notes: 'Catatan asli tukang' }, error: null }
        },
        update() { return { eq: async () => ({ error: null }) } }
      }
    }
  }
  const res = await submitMod.submitLean(basePr, { supabase: fake, confirmFn: () => true })
  check('readback tanpa penanda -> gagal jujur', res.ok === false && /Verifikasi gagal/i.test(res.error || ''), JSON.stringify(res))
}

// ------------------------------------------------------------
section('D. Tutup sisa kebutuhan (qty asli tidak berubah)')
{
  const leanPr = { id: 'pr-2', pr_number: 'PR-102', title: 'Sisa', status: 'SUBMITTED', notes: 'Catatan\n[Jalur: LEAN]' }
  __reset({ purchase_requests: [leanPr], pr_items: [{ id: 'pi-1', pr_id: 'pr-2', item_name: 'Triplek', quantity: 10, unit: 'Lembar', status: 'PENDING_APPROVAL' }] })
  const res = await submitMod.closeRequestRemaining(leanPr, 'sisa tidak diperlukan', { supabase, confirmFn: () => true })
  check('tutup sisa ok', res.ok === true, JSON.stringify(res))
  check('penanda tutup tersimpan', lean.closeReasonOf(db.purchase_requests[0].notes) === 'sisa tidak diperlukan')
  check('penanda lean tetap ada', lean.isLeanMarked(db.purchase_requests[0].notes))
  check('catatan manusia tetap ada', db.purchase_requests[0].notes.includes('Catatan'))
  check('qty pr_items TIDAK berubah', db.pr_items[0].quantity === 10, String(db.pr_items[0].quantity))
  check('status request TIDAK diubah', db.purchase_requests[0].status === 'SUBMITTED')

  const before = __ops.length
  const res2 = await submitMod.closeRequestRemaining(db.purchase_requests[0], 'alasan kedua', { supabase, confirmFn: () => true })
  check('tutup ulang: hanya 1 penanda', (db.purchase_requests[0].notes.match(/\[Tutup:/gi) || []).length === 1, db.purchase_requests[0].notes)
  check('tutup ulang: alasan terbaru', lean.closeReasonOf(db.purchase_requests[0].notes) === 'alasan kedua')
  check('tutup ulang: tetap 1 penanda lean', (db.purchase_requests[0].notes.match(/\[Jalur:/gi) || []).length === 1)
  check('tutup ulang: menulis 1x', __ops.slice(before).filter(o => o.op === 'update').length === 1)
}

// ------------------------------------------------------------
section('E. Pemenuhan dari realisasi valid (bukan dari status kirim)')
{
  const pr = { id: 'pr-3', pr_number: 'PR-103', status: 'SUBMITTED', notes: '[Jalur: LEAN]' }
  const items = [
    { id: 'i1', pr_id: 'pr-3', item_name: 'Triplek', quantity: 10, unit: 'Lembar', status: 'PENDING_APPROVAL' },
    { id: 'i2', pr_id: 'pr-3', item_name: 'Sekrup', quantity: 100, unit: 'Pcs', status: 'PENDING_APPROVAL' },
    { id: 'i3', pr_id: 'pr-3', item_name: 'Lem', quantity: 5, unit: 'Kaleng', status: 'PENDING_APPROVAL' }
  ]
  const receivings = [
    { id: 'r1', status: 'DIBELI', received_date: '2026-10-19', invoice_no: 'INV-1' },
    { id: 'r2', status: 'DRAFT', received_date: null },                 // belum dibeli
    { id: 'r3', status: 'RETUR', received_date: '2026-10-18' }          // retur = bukan realisasi
  ]
  const receivingItems = [
    { id: 'ri1', receiving_id: 'r1', pr_item_id: 'i1', quantity_received: 4 },
    { id: 'ri2', receiving_id: 'r1', pr_item_id: 'i2', quantity_received: 100 },
    { id: 'ri3', receiving_id: 'r2', pr_item_id: 'i1', quantity_received: 6 },  // DRAFT -> diabaikan
    { id: 'ri4', receiving_id: 'r3', pr_item_id: 'i3', quantity_received: 5 }   // RETUR -> diabaikan
  ]
  const sum = fulfill.requestFulfillment(pr, { items, receivings, receivingItems })
  check('total item 3', sum.counts.total === 3, JSON.stringify(sum.counts))
  check('i1 sebagian (4 dari 10, nota DRAFT diabaikan)', sum.items[0].status === fulfill.FULFILL_PARTIAL && sum.items[0].realized === 4, JSON.stringify(sum.items[0]))
  check('i1 sisa 6', sum.items[0].remaining === 6)
  check('i2 selesai', sum.items[1].status === fulfill.FULFILL_DONE)
  check('i3 belum dibeli (nota RETUR diabaikan)', sum.items[2].status === fulfill.FULFILL_NONE, JSON.stringify(sum.items[2]))
  check('ringkasan SEBAGIAN', sum.status === fulfill.FULFILL_PARTIAL, sum.status)
  check('request dikirim != selesai', sum.status !== fulfill.FULFILL_DONE)
  check('estimasi tidak dipakai sbg realisasi', sum.realized === 104, String(sum.realized))

  const open = fulfill.openNeeds(pr, { items, receivings, receivingItems })
  check('openNeeds: hanya yang belum penuh', open.length === 2, JSON.stringify(open.map(o => o.prItemId)))
  check('openNeeds: sisa benar', open.find(o => o.prItemId === 'i1')?.remaining === 6)

  // over-receipt dilaporkan
  const over = fulfill.requestFulfillment(pr, {
    items: [{ id: 'i9', pr_id: 'pr-3', item_name: 'X', quantity: 5, unit: 'Pcs', status: 'PENDING_APPROVAL' }],
    receivings: [{ id: 'r9', status: 'DIBELI' }],
    receivingItems: [{ id: 'ri9', receiving_id: 'r9', pr_item_id: 'i9', quantity_received: 7 }]
  })
  check('over-receipt dilaporkan (bukan dipotong diam-diam)', over.items[0].over === 2 && over.items[0].status === fulfill.FULFILL_DONE, JSON.stringify(over.items[0]))

  // ditutup: status DITUTUP, sisa tidak hilang dari data
  const closedPr = { ...pr, notes: '[Jalur: LEAN] [Tutup: tidak jadi] [TutupPada: 2026-10-20T00:00:00Z]' }
  const closedSum = fulfill.requestFulfillment(closedPr, { items: [items[2]], receivings, receivingItems })
  check('item ditutup -> DITUTUP', closedSum.items[0].status === fulfill.FULFILL_CLOSED, JSON.stringify(closedSum.items[0]))
  check('alasan penutupan terbaca di ringkasan', closedSum.closedReason === 'tidak jadi')
  check('qty asli tetap 5', closedSum.items[0].requested === 5)

  // item tanpa realisasi sama sekali, request belum ditutup
  const noneSum = fulfill.requestFulfillment(pr, { items: [items[2]], receivings: [], receivingItems: [] })
  check('tanpa nota -> BELUM_DIBELI', noneSum.items[0].status === fulfill.FULFILL_NONE)
  check('tanpa nota: sisa = qty asli', noneSum.items[0].remaining === 5)
}

// ------------------------------------------------------------
section('F. Autofill estimasi & saran vendor')
{
  const allMaterials = [
    { id: 'm1', kode: 'PLY-1', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
    { id: 'm2', kode: 'BHP-1', name: 'Sekrup 3cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: null },
    { id: 'm3', kode: 'X-1', name: 'Material Tanpa Acuan', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: null }
  ]
  const allVendors = [
    { id: 'v1', name: 'Toko Kayu Jaya', supplier_category: 'Plywood & Board' },
    { id: 'v2', name: 'Toko Bangunan Makmur', supplier_category: 'Bahan Habis Pakai' },
    { id: 'v3', name: 'Toko Tanpa Kategori', supplier_category: '' }
  ]

  const e1 = suggest.estimateForMaterial(allMaterials[0], { allPrItems: [], allReceivingItems: [], allReceivings: [], allVendors })
  check('acuan master terisi', e1.status === 'OK' && e1.price === 250000, JSON.stringify(e1))
  check('label sumber master jujur', /master/i.test(e1.label), e1.label)

  const e2 = suggest.estimateForMaterial(allMaterials[2], { allPrItems: [], allReceivingItems: [], allReceivings: [], allVendors })
  check('tanpa acuan: status NO_ENTRY', e2.status === 'NO_ENTRY', JSON.stringify(e2))
  check('tanpa acuan: price NULL (bukan 0)', e2.price === null, String(e2.price))
  check('tanpa acuan: label "Belum ada acuan"', e2.label === 'Belum ada acuan', e2.label)

  const e3 = suggest.estimateForMaterial({ name: 'Tanpa ID' }, { allVendors })
  check('material tak dikenal: UNKNOWN_MATERIAL', e3.status === 'UNKNOWN_MATERIAL', JSON.stringify(e3))
  check('material tak dikenal: bukan 0', e3.price === null)

  // Saran vendor: hanya eligible, tidak memaksa
  const s1 = suggest.suggestVendorsFor(allMaterials[0], { allVendors })
  check('saran vendor eligible kategori plywood', s1.length === 1 && s1[0].id === 'v1', JSON.stringify(s1))
  check('vendor tanpa kategori TIDAK disarankan', !s1.some(v => v.id === 'v3'))
  check('saran punya alasan jelas', /Kategori vendor aktif/.test(s1[0].reason), s1[0].reason)
  check('saran BUKAN paksaan (tanpa flag wajib)', s1.every(v => !('required' in v)))

  const s2 = suggest.suggestVendorsFor(allMaterials[1], { allVendors })
  check('kategori BHP -> vendor BHP saja', s2.length === 1 && s2[0].id === 'v2', JSON.stringify(s2))

  const s3 = suggest.suggestVendorsFor({ id: 'mx', category: 'Kategori Tanpa Vendor' }, { allVendors })
  check('tanpa vendor eligible -> array kosong (bukan tebakan)', s3.length === 0, JSON.stringify(s3))

  const s4 = suggest.suggestVendorsForItem({ material_id: 'm1' }, { allMaterials, allVendors })
  check('saran per item memakai material_id', s4.length === 1 && s4[0].id === 'v1')

  const s5 = suggest.suggestVendorsForItem({ material_id: 'tidak-ada' }, { allMaterials, allVendors })
  check('material_id tak dikenal -> tidak menebak vendor', s5.length === 0)

  // Histori: vendor yang pernah beli diprioritaskan + harga historis
  const allPrItems = [{ id: 'h1', material_id: 'm1', unit: 'Lembar', estimated_price: 240000 }]
  const allReceivings = [{ id: 'hr1', vendor_id: 'v2', status: 'DIBELI', received_date: '2026-10-15' }]
  const allReceivingItems = [{ id: 'hri1', receiving_id: 'hr1', pr_item_id: 'h1', quantity_received: 3, note: '[Harga: 260000]' }]
  const eh = suggest.estimateForMaterial(allMaterials[0], { allPrItems, allReceivingItems, allReceivings, allVendors })
  check('harga historis aktual dipakai', eh.status === 'OK' && eh.price === 260000, JSON.stringify(eh))
  check('sumber historis berlabel aktual', eh.source === 'HISTORIS' && /Historis/i.test(eh.label), JSON.stringify(eh))
  const sh = suggest.suggestVendorsFor(allMaterials[0], { allVendors, allPrItems, allReceivingItems, allReceivings })
  check('vendor histori disarankan lebih dulu', sh[0]?.id === 'v2', JSON.stringify(sh))
  check('vendor histori ditandai alasan pembelian', /Pernah membeli/.test(sh[0].reason), sh[0]?.reason)

  // Tidak mengubah master
  const snapshot = JSON.stringify(allMaterials)
  suggest.estimateForMaterial(allMaterials[0], { allVendors })
  suggest.suggestVendorsFor(allMaterials[0], { allVendors })
  check('master TIDAK berubah', JSON.stringify(allMaterials) === snapshot)
}

// ------------------------------------------------------------
console.log(`\n================ HASIL ================`)
console.log(`LULUS: ${pass}   GAGAL: ${fail}`)
if (fail) {
  console.error('\nGagal:')
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
}
console.log('SEMUA ACCEPTANCE TEST JALUR LEAN LULUS')
