// ============================================================
// LOGIC TEST — receiptLogic.js + receiptSave.js (verbatim hasil SWC)
// Bagian A (logika murni) & B (simpan idempoten dengan mock CAS).
// Dijalankan oleh run.py di sandbox (tanpa DB / jaringan).
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const L = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptLogic.mjs')).href)
const S = await import(pathToFileURL(path.join(SB, 'dist/modules/receivings/receiptSave.mjs')).href)
const { makeItemHelpers } = await import(pathToFileURL(path.join(SB, 'dist/modules/shared/itemHelpers.mjs')).href)
// PENTING: mock harus dari dist/ — modul terkompilasi mengimpor dist/lib/…,
// jadi instance yang sama harus dipakai test (bukan salinan di root sandbox).
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

// ---------- Fixture PR & receiving items ----------
const PR_ITEMS = [
  { id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar' },
  { id: 'pi2', pr_id: 'pr1', item_name: 'Cat Duco', quantity: 4, unit: 'Kaleng' },
  { id: 'pi3', pr_id: 'pr1', item_name: 'Paku 2in', quantity: 2, unit: 'Kg' }
]
const prItemById = new Map(PR_ITEMS.map(p => [p.id, p]))
const orderedFor = (it) => prItemById.get(it.pr_item_id)?.quantity ?? null

const items = [
  { id: 'ri1', receiving_id: 'recA', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 0 },
  { id: 'ri2', receiving_id: 'recA', pr_item_id: 'pi2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 2 },
  { id: 'ri3', receiving_id: 'recA', pr_item_id: 'pi3', item_name: 'Paku 2in', unit: 'Kg', quantity_received: null }
]

console.log('=== A. LOGIKA FORM TERIMA BARANG (receiptLogic.js verbatim) ===\n')
const rows = L.buildRows(items, orderedFor)

// ---------- A1: kuantitas ----------
console.log('A1. Kuantitas: rusak<=datang, non-negatif, over-receipt, baik, belum datang')
{
  check('A1a ordered/sisa item1', rows[0].ordered === 10 && rows[0].sisa === 10)
  check('A1b prevCum item2 (2 sudah diterima)', rows[1].prevCum === 2 && rows[1].sisa === 2)
  check('A1c prevCum NULL dianggap 0', rows[2].prevCum === 0 && rows[2].sisa === 2)

  // sebagian baik sebagian rusak: datang 6, rusak 2 -> baik 4
  const v1 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '6', rusak: '2' })
  check('A1d baik = datang - rusak (6-2=4)', v1.valid && v1.computed.baik === 4)
  check('A1e belum datang = sisa - datang (10-6=4)', v1.computed.belum === 4)

  // rusak > datang ditolak
  const v2 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '3', rusak: '5' })
  check('A1f rusak>datang ditolak', !v2.valid && !!v2.errors.rusak)

  // non-negatif
  const v3 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '-1' })
  check('A1g datang negatif ditolak', !v3.valid && !!v3.errors.datang)
  const v4 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '3', rusak: '-2' })
  check('A1h rusak negatif ditolak', !v4.valid && !!v4.errors.rusak)
  const v5 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: 'abc' })
  check('A1i datang non-angka ditolak', !v5.valid && !!v5.errors.datang)

  // over-receipt: item2 sisa 2, isi 3 -> ditolak; isi 2 -> boleh
  const v6 = L.validateItem(rows[1], { ...L.emptyEntry(), datang: '3' })
  check('A1j over-receipt (3 > sisa 2) ditolak', !v6.valid && /[Ss]isa/.test(v6.errors.datang || ''))
  const v7 = L.validateItem(rows[1], { ...L.emptyEntry(), datang: '2' })
  check('A1k tepat sisa (2) boleh', v7.valid && v7.computed.belum === 0)
}

// ---------- A2: tujuan baik ----------
console.log('\nA2. Tujuan: split WS/tukang <= baik; tukang wajib penerima')
{
  // baik 4: WS 1 + tukang 3 = 4 OK, wajib penerima
  const v1 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '6', rusak: '2', ws: '1', tukang: '3' })
  check('A2a split WS+tukang = baik: TIDAK ada error tujuan', !v1.errors.tujuan && !v1.errors.ws && !v1.errors.tukang)
  check('A2b tukang tanpa penerima ditolak', !v1.valid && !!v1.errors.penerima)
  const v2 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '6', rusak: '2', ws: '1', tukang: '3', penerima: 'Pak Joko' })
  check('A2c split + penerima valid', v2.valid)
  check('A2d total tujuan = 4', v2.computed.tujuan === 4)

  // total tujuan > baik ditolak
  const v3 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '6', rusak: '2', ws: '3', tukang: '3', penerima: 'Pak Joko' })
  check('A2e tujuan 6 > baik 4 ditolak', !v3.valid && !!v3.errors.tujuan)

  // tanpa tujuan sama sekali tetap boleh (belum ditentukan)
  const v4 = L.validateItem(rows[0], { ...L.emptyEntry(), datang: '6', rusak: '2' })
  check('A2f tanpa tujuan (belum ditentukan) boleh', v4.valid)
}

// ---------- A3: rusak / retur / buang ----------
console.log('\nA3. Rusak: nanti/supplier/dibuang; supplier=MENUNGGU; dibuang wajib konfirmasi (foto OPSIONAL)')
{
  const base = { ...L.emptyEntry(), datang: '8', rusak: '3' }
  check('A3a default retur = NANTI', L.emptyEntry().retur === L.RETUR_NANTI)
  check('A3b nanti valid tanpa bukti', L.validateItem(rows[0], base).valid)

  const vs = L.validateItem(rows[0], { ...base, retur: L.RETUR_SUPPLIER })
  check('A3c supplier valid tanpa foto', vs.valid)
  check('A3d konstanta supplier = MENUNGGU dikembalikan (bukan RETURNED)',
    L.RETUR_SUPPLIER === 'SUPPLIER' && !['RETURNED', 'DIKEMBALIKAN'].includes(L.RETUR_SUPPLIER))

  // KOREKSI DAT 16 Okt: foto OPSIONAL — dibuang tanpa foto tetap error HANYA karena konfirmasi
  const vd1 = L.validateItem(rows[0], { ...base, retur: L.RETUR_DIBUANG })
  check('A3e dibuang TANPA foto: hanya error konfirmasi (foto tidak memblokir)', !vd1.valid && !vd1.errors.foto && !!vd1.errors.konfirmasiBuang)
  const vd2 = L.validateItem(rows[0], { ...base, retur: L.RETUR_DIBUANG, konfirmasiBuang: true })
  check('A3f dibuang + konfirmasi TANPA foto = VALID', vd2.valid)
  const vd3 = L.validateItem(rows[0], { ...base, retur: L.RETUR_DIBUANG, foto: 'data:image/png;base64,AAA', konfirmasiBuang: true })
  check('A3g dibuang + foto + konfirmasi valid', vd3.valid)
  const vd4 = L.validateItem(rows[0], { ...base, retur: L.RETUR_DIBUANG, foto: 'data:image/png;base64,AAA' })
  check('A3h dibuang + foto tanpa konfirmasi tetap ditolak', !vd4.valid && !!vd4.errors.konfirmasiBuang)

  const vr = L.validateItem(rows[0], { ...base, retur: 'ENTAH' })
  check('A3i retur tak dikenal ditolak', !vr.valid && !!vr.errors.retur)
}

// ---------- A4: ringkasan ----------
console.log('\nA4. Ringkasan: total tidak menggandakan; rusak tidak masuk baik')
{
  const entries = {
    ri1: { ...L.emptyEntry(), datang: '6', rusak: '2' },          // baik 4
    ri2: { ...L.emptyEntry(), datang: '2' },                      // baik 2
    ri3: { ...L.emptyEntry() }                                    // kosong
  }
  const v = L.validateForm(rows, entries)
  check('A4a valid', v.valid)
  check('A4b itemTerisi = 2', v.summary.itemTerisi === 2)
  check('A4c totalDatang = 8', v.summary.totalDatang === 8)
  check('A4d totalRusak = 2', v.summary.totalRusak === 2)
  check('A4e totalBaik = 6 (bukan 8)', v.summary.totalBaik === 6)
  check('A4f belum datang item1 = 4', v.itemComputed.ri1.belum === 4)
  check('A4g totalBelum = (10-6)+(2-2)+2 = 6', v.summary.totalBelum === 6)
  check('A4h rusak>0 -> schemaBlocks terisi (bukan recordable)', !v.recordable && v.schemaBlocks.some(s => /[Rr]usak 2/.test(s)))

  // form TANPA dimensi rusak/tujuan -> recordable (aman disimpan skema kini)
  const clean = { ri1: { ...L.emptyEntry(), datang: '6' }, ri2: { ...L.emptyEntry(), datang: '2' }, ri3: { ...L.emptyEntry() } }
  const vClean = L.validateForm(rows, clean)
  check('A4h2 tanpa rusak/tujuan -> recordable true', vClean.valid && vClean.recordable && vClean.schemaBlocks.length === 0)

  // dengan rusak/tujuan -> schemaBlocks terisi, recordable false
  const v2 = L.validateForm(rows, { ...entries, ri1: { ...L.emptyEntry(), datang: '6', rusak: '2', ws: '4' } })
  check('A4i rusak/tujuan -> schemaBlocks', v2.schemaBlocks.length >= 2 && !v2.recordable)
  check('A4j pesan gap menyebut receiving_events di UI (blok teks form)', v2.schemaBlocks.some(s => /rusak/i.test(s)))

  // form kosong -> global error
  const v3 = L.validateForm(rows, {})
  check('A4k form kosong ditolak', !v3.valid && v3.globalErrors.length > 0)
}

// ---------- A5: buildSavePlan ----------
console.log('\nA5. Rencana simpan: hanya item terisi; prevCum = snapshot')
{
  const entries = {
    ri1: { ...L.emptyEntry(), datang: '6' },
    ri2: { ...L.emptyEntry(), datang: '2' },
    ri3: { ...L.emptyEntry() }
  }
  const plan = L.buildSavePlan(rows, entries)
  check('A5a hanya 2 item terisi', plan.length === 2)
  check('A5b item1 newCum = 0+6', plan[0].newCum === 6 && plan[0].prevCum === 0)
  check('A5c item2 newCum = 2+2 (kumulatif)', plan[1].newCum === 4 && plan[1].prevCum === 2)

  // itemRingkas (kolom daftar Purchase)
  const r = L.itemRingkas([
    { item_name: 'Triplek' }, { item_name: 'Cat' }, { item_name: 'Paku' }, { item_name: 'Lem' }
  ])
  check('A5d itemRingkas count', r.count === 4)
  check('A5e itemRingkas 2 nama + "lainnya"', r.ringkas === 'Triplek, Cat +2 lainnya')
  check('A5f itemRingkas kosong', L.itemRingkas([]).count === 0)
}

// ---------- A6: ringkasan parent READ-ONLY + gate bulk (arahan DAT 16 Okt) ----------
console.log('\nA6. Ringkasan parent diturunkan dari item (bukan dropdown Normal); bulk dilarang multi-item')
{
  // Helper receivingProgress dari itemHelpers (dibangun di atas fixture yang sama)
  const H = makeItemHelpers({ allPrItems: PR_ITEMS, allReceivingItems: [
    { id: 'ri1', receiving_id: 'recA', pr_item_id: 'pi1', item_name: 'Triplek 9mm', quantity_received: 10, unit: 'Lembar' },
    { id: 'ri2', receiving_id: 'recA', pr_item_id: 'pi2', item_name: 'Cat Duco', quantity_received: 0, unit: 'Kaleng' },
    { id: 'ri3', receiving_id: 'recA', pr_item_id: 'pi3', item_name: 'Paku 2in', quantity_received: null, unit: 'Kg' }
  ] })

  // multi-item: sebagian sudah diterima, sebagian 0 -> "Sebagian", BUKAN "PARSIAL (0/2)"
  const prog = H.receivingProgress('recA')
  const s = L.parentSummary(prog)
  check('A6a multi-item sebagian -> key SEBAGIAN', s.key === 'SEBAGIAN', `key=${s.key}`)
  check('A6b teks tidak menyebut PARSIAL menyesatkan', !/PARSIAL/.test(s.text), s.text)
  check('A6c teks menyebut jumlah barang mulai diterima (1/3)', /Sebagian \(1\/3/.test(s.text), s.text)

  // semua 0 -> "Belum diterima (0/N)" — bukan "Parsial"
  const H0 = makeItemHelpers({ allPrItems: PR_ITEMS, allReceivingItems: [
    { id: 'x1', receiving_id: 'recB', pr_item_id: 'pi1', item_name: 'A', quantity_received: 0, unit: 'X' },
    { id: 'x2', receiving_id: 'recB', pr_item_id: 'pi2', item_name: 'B', quantity_received: 0, unit: 'X' }
  ] })
  const s0 = L.parentSummary(H0.receivingProgress('recB'))
  check('A6d qty 0 semua -> BELUM (0/2)', s0.key === 'BELUM', `key=${s0.key}`)
  check('A6e teks "Belum diterima (0/2)"', s0.text === 'Belum diterima (0/2)', s0.text)
  check('A6f TIDAK disebut Parsial', !/Parsial/i.test(s0.text), s0.text)

  // lengkap semua -> LENGKAP hijau
  const HL = makeItemHelpers({ allPrItems: PR_ITEMS, allReceivingItems: [
    { id: 'y1', receiving_id: 'recC', pr_item_id: 'pi1', item_name: 'A', quantity_received: 10, unit: 'X' },
    { id: 'y2', receiving_id: 'recC', pr_item_id: 'pi2', item_name: 'B', quantity_received: 4, unit: 'X' }
  ] })
  const sL = L.parentSummary(HL.receivingProgress('recC'))
  check('A6g lengkap semua -> LENGKAP', sL.key === 'LENGKAP', `key=${sL.key}`)

  // lengkap tapi nota kendala -> amber, bukan hijau (audit G9)
  const sK = L.parentSummary(HL.receivingProgress('recC', true), { kendalaLabel: 'nota Retur' })
  check('A6h lengkap + kendala -> amber', sK.key === 'KENDALA', `key=${sK.key}`)
  check('A6i teks kendala menyebut nota', /nota Retur/.test(sK.text), sK.text)

  // over-receipt -> merah
  const HO = makeItemHelpers({ allPrItems: PR_ITEMS, allReceivingItems: [
    { id: 'z1', receiving_id: 'recD', pr_item_id: 'pi1', item_name: 'A', quantity_received: 12, unit: 'X' }
  ] })
  const sO = L.parentSummary(HO.receivingProgress('recD'))
  check('A6j over-receipt -> OVER merah', sO.key === 'OVER', `key=${sO.key}`)

  // tanpa item -> KOSONG
  const sN = L.parentSummary(null)
  check('A6k tanpa item -> KOSONG', sN.key === 'KOSONG', `key=${sN.key}`)

  // ---- gate bulk ----
  const two = [
    { id: 'ri1', quantity_received: 10 },
    { id: 'ri2', quantity_received: 0 }
  ]
  const g2 = L.bulkActionState(two)
  check('A6l 2 item -> bulk DILARANG', g2.allowed === false, `allowed=${g2.allowed}`)
  check('A6m alasan multi-item jelas', /per barang|multi-item/i.test(g2.reason), g2.reason)

  const one0 = [{ id: 'ri1', quantity_received: 0 }]
  const g1a = L.bulkActionState(one0)
  check('A6n 1 item qty 0 -> bulk DILARANG (0 tidak masuk stok/handover)', g1a.allowed === false, `allowed=${g1a.allowed}`)

  const one1 = [{ id: 'ri1', quantity_received: 3 }]
  const g1b = L.bulkActionState(one1)
  check('A6o 1 item sudah diterima -> bulk boleh', g1b.allowed === true, `allowed=${g1b.allowed}`)

  const none = L.bulkActionState([])
  check('A6p tanpa item -> bulk DILARANG', none.allowed === false, `allowed=${none.allowed}`)

  // null dianggap 0 (data lama)
  const oneNull = [{ id: 'ri1', quantity_received: null }]
  check('A6q 1 item NULL -> bulk DILARANG', L.bulkActionState(oneNull).allowed === false)
}

// ---------- A7: EVIDENCE DAT — 2 triplek beda kondisi & tujuan + retry isolasi ----------
console.log('\nA7. Bukti kasus DAT: 2 Triplek beda kondisi/tujuan (parsial, rusak sebagian) + retry tidak mengubah item lain')
{
  // Nota: 2 item "Triplek" berbeda spesifikasi.
  //  - T1 (SF 9mm): dipesan 10. Datang 6, rusak 2 -> baik 4 (split: WS 1, Tukang 3 → Pak Joko)
  //  - T2 (Polos 9mm BBCC): dipesan 4. Datang 3, rusak 0 -> baik 3 (semua WS)
  const rows2 = L.buildRows([
    { id: 't1', receiving_id: 'rec2T', pr_item_id: 'pi1', item_name: 'Triplek (SF - 9mm)', unit: 'Lembar', quantity_received: 0 },
    { id: 't2', receiving_id: 'rec2T', pr_item_id: 'pi2', item_name: 'Triplek (Polos - 9mm - BBCC)', unit: 'Lembar', quantity_received: 0 }
  ], orderedFor)

  const e1 = { ...L.emptyEntry(), datang: '6', rusak: '2', ws: '1', tukang: '3', penerima: 'Pak Joko' }
  const e2 = { ...L.emptyEntry(), datang: '3', rusak: '0', ws: '3' }
  const v1 = L.validateItem(rows2[0], e1)
  const v2 = L.validateItem(rows2[1], e2)
  check('A7a T1 valid (parsial 6/10, rusak 2, split WS1+Tukang3)', v1.valid, JSON.stringify(v1.errors))
  check('A7b T1 baik = 6-2 = 4', v1.computed.baik === 4, `baik=${v1.computed.baik}`)
  check('A7c T1 tujuan = 4 (WS1+Tukang3, tidak melebihi baik)', v1.computed.tujuan === 4, `tujuan=${v1.computed.tujuan}`)
  check('A7d T2 valid (parsial 3/4, semua WS)', v2.valid, JSON.stringify(v2.errors))
  check('A7e T2 baik = 3', v2.computed.baik === 3, `baik=${v2.computed.baik}`)

  const form2 = L.validateForm(rows2, { t1: e1, t2: e2 })
  check('A7f form valid utk 2 item beda kondisi', form2.valid, JSON.stringify(form2.globalErrors))
  // Rusak & tujuan per item tetap diblok skema (jujur: tidak ada ilusi berhasil).
  check('A7g rusak T1 memblokir simpan (schemaBlock)', form2.schemaBlocks.some(b => /Rusak 2/.test(b)))
  check('A7h tujuan T1 memblokir simpan (schemaBlock)', form2.schemaBlocks.some(b => /Tujuan per item/.test(b) && /SF - 9mm/.test(b)))
  check('A7i recordable = false (bukan ilusi tersimpan)', form2.recordable === false, `recordable=${form2.recordable}`)

  // Tanpa rusak & tanpa tujuan (kasus paling sederhana): masih bisa disimpan
  // ke skema kini — hanya qty datang kumulatif.
  const e1s = { ...L.emptyEntry(), datang: '6' }
  const e2s = { ...L.emptyEntry(), datang: '3' }
  const form2s = L.validateForm(rows2, { t1: e1s, t2: e2s })
  check('A7j tanpa rusak/tujuan -> recordable (qty datang saja)', form2s.recordable === true, `recordable=${form2s.recordable}`)
  const plan = L.buildSavePlan(rows2, { t1: e1s, t2: e2s })
  check('A7k plan hanya 2 item terisi, T1 6 T2 3', plan.length === 2 && plan[0].newCum === 6 && plan[1].newCum === 3, JSON.stringify(plan))
  check('A7l retry: prevCum snapshot per item (isolasi)', plan[0].prevCum === 0 && plan[1].prevCum === 0)

  // Retry skenario: T1 sudah tersimpan 6; form lama masih snapshot 0.
  // CAS: update T1 dengan prevCum 0 TIDAK boleh menimpa (konflik), T2 tetap 0.
  mock.__reset({ rows: [{ id: 't1', receiving_id: 'rec2T', quantity_received: 6 }, { id: 't2', receiving_id: 'rec2T', quantity_received: 0 }] })
  const stalePlan = L.buildSavePlan(rows2, { t1: e1s, t2: e2s }) // prevCum dari rows2 = 0 (stale)
  const r1 = await S.saveReceipt({ receiving: { id: 'rec2T', received_date: '2026-10-16' }, plan: stalePlan })
  check('A7m retry dgn snapshot lama -> KONFLIK (tidak dobel)', r1.ok === false, `ok=${r1.ok} reason=${r1.reason}`)
  check('A7n T1 tetap 6 (tidak jadi 12)', mock.__state.rows.get('t1').quantity_received === 6, `t1=${mock.__state.rows.get('t1').quantity_received}`)
  check('A7o T2 tetap 0 (item lain TIDAK berubah)', mock.__state.rows.get('t2').quantity_received === 0, `t2=${mock.__state.rows.get('t2').quantity_received}`)
  check('A7p nol tulisan saat konflik', mock.__callsOf('update', 'receiving_items').length === 0, `updates=${mock.__callsOf('update', 'receiving_items').length}`)

  // Submit ulang dari form yang di-reload (snapshot baru 6): T2 saja yang berubah.
  const rows2b = L.buildRows([
    { id: 't1', receiving_id: 'rec2T', pr_item_id: 'pi1', item_name: 'Triplek (SF - 9mm)', unit: 'Lembar', quantity_received: 6 },
    { id: 't2', receiving_id: 'rec2T', pr_item_id: 'pi2', item_name: 'Triplek (Polos - 9mm - BBCC)', unit: 'Lembar', quantity_received: 0 }
  ], orderedFor)
  const plan2 = L.buildSavePlan(rows2b, { t1: { ...L.emptyEntry(), datang: '' }, t2: { ...L.emptyEntry(), datang: '3' } })
  check('A7q plan reload hanya T2 (T1 tidak disentuh)', plan2.length === 1 && plan2[0].itemId === 't2' && plan2[0].newCum === 3, JSON.stringify(plan2))
  const r2 = await S.saveReceipt({ receiving: { id: 'rec2T', received_date: '2026-10-16' }, plan: plan2 })
  check('A7r simpan T2 sukses', r2.ok === true, JSON.stringify(r2))
  check('A7s T1 tetap 6 (isolasi item lain)', mock.__state.rows.get('t1').quantity_received === 6)
  check('A7t T2 = 3', mock.__state.rows.get('t2').quantity_received === 3)
  check('A7u tepat SATU update (hanya T2)', mock.__callsOf('update', 'receiving_items').length === 1, `updates=${mock.__callsOf('update', 'receiving_items').length}`)
}

console.log('\n=== B. SIMPAN IDEMPOTEN (receiptSave.js + mock CAS) ===\n')

// ---------- B1: sukses ----------
console.log('B1. Simpan sukses: CAS kumulatif + tgl terima')
{
  mock.__reset({ rows: [
    { id: 'ri1', receiving_id: 'recA', quantity_received: 0 },
    { id: 'ri2', receiving_id: 'recA', quantity_received: 2 }
  ] })
  const res = await S.saveReceipt({
    receiving: { id: 'recA', received_date: null },
    plan: [
      { itemId: 'ri1', itemName: 'Triplek', prevCum: 0, datang: 6, newCum: 6 },
      { itemId: 'ri2', itemName: 'Cat', prevCum: 2, datang: 2, newCum: 4 }
    ]
  })
  check('B1a ok', res.ok === true)
  check('B1b dua baris ter-update', res.updated.length === 2)
  check('B1c tgl terima diisi', res.dateFilled === true)
  const row1 = mock.__state.rows.get('ri1')
  const row2 = mock.__state.rows.get('ri2')
  check('B1d DB ri1 = 6', row1.quantity_received === 6)
  check('B1e DB ri2 = 4', row2.quantity_received === 4)
  const dateCalls = mock.__callsOf('update', 'receivings')
  check('B1f receivings.received_date di-update sekali', dateCalls.length === 1)
}

// ---------- B2: retry/dobel ----------
console.log('B2. Retry / submit dobel: snapshot sama -> konflik, angka tidak dobel')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'recA', quantity_received: 0 }] })
  const plan = [{ itemId: 'ri1', itemName: 'Triplek', prevCum: 0, datang: 6, newCum: 6 }]
  const r1 = await S.saveReceipt({ receiving: { id: 'recA', received_date: '2026-10-16' }, plan })
  const r2 = await S.saveReceipt({ receiving: { id: 'recA', received_date: '2026-10-16' }, plan }) // retry dengan payload lama
  check('B2a submit pertama ok', r1.ok === true)
  check('B2b submit kedua ditolak (conflict)', r2.ok === false && r2.reason === 'conflict')
  check('B2c angka DB tetap 6 (TIDAK 12)', mock.__state.rows.get('ri1').quantity_received === 6)
  check('B2d pesan konflik jelas', /berubah sejak form dibuka/.test(r2.error || ''))
}

// ---------- B3: user lain mengubah ----------
console.log('B3. User lain mengubah angka -> konflik, tidak menimpa')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'recA', quantity_received: 0 }] })
  const plan = [{ itemId: 'ri1', itemName: 'Triplek', prevCum: 0, datang: 6, newCum: 6 }]
  // user lain sudah mengisi 4 lebih dulu
  mock.__state.rows.get('ri1').quantity_received = 4
  const r = await S.saveReceipt({ receiving: { id: 'recA', received_date: '2026-10-16' }, plan })
  check('B3a ditolak konflik', r.ok === false && r.reason === 'conflict')
  check('B3b angka user lain TIDAK tertimpa (tetap 4)', mock.__state.rows.get('ri1').quantity_received === 4)
}

// ---------- B4: baris NULL (data lama) ----------
console.log('B4. Data lama quantity_received NULL tetap bisa diisi dari 0')
{
  mock.__reset({ rows: [{ id: 'ri3', receiving_id: 'recA', quantity_received: null }] })
  const r = await S.saveReceipt({
    receiving: { id: 'recA', received_date: '2026-10-16' },
    plan: [{ itemId: 'ri3', itemName: 'Paku', prevCum: 0, datang: 2, newCum: 2 }]
  })
  check('B4a ok', r.ok === true)
  check('B4b NULL -> 2', mock.__state.rows.get('ri3').quantity_received === 2)
}

// ---------- B5: invalid ----------
console.log('B5. Plan kosong / receiving kosong -> nol tulisan')
{
  mock.__reset({ rows: [{ id: 'ri1', receiving_id: 'recA', quantity_received: 0 }] })
  const r1 = await S.saveReceipt({ receiving: { id: 'recA' }, plan: [] })
  check('B5a plan kosong ditolak', r1.ok === false)
  const r2 = await S.saveReceipt({ receiving: null, plan: [{ itemId: 'ri1' }] })
  check('B5b receiving kosong ditolak', r2.ok === false)
  check('B5c nol tulisan DB', mock.__callsOf('update').length === 0 && mock.__state.rows.get('ri1').quantity_received === 0)
}

// ---------- B6: loadItemsFromPr ----------
console.log('B6. Nota lama tanpa item -> Muat item dari PR')
{
  mock.__reset({ rows: [] })
  const r = await S.loadItemsFromPr({
    receiving: { id: 'recOld', purchase_request_id: 'pr1' },
    prItems: PR_ITEMS,
    existingItems: []
  })
  check('B6a ok, 3 item dimuat', r.ok === true && r.added === 3)
  check('B6b baris tersimpan qty 0', [...mock.__state.rows.values()].every(x => x.quantity_received === 0))

  // muat ulang: semua sudah ada -> tidak dobel
  const existing = [...mock.__state.rows.values()]
  const r2 = await S.loadItemsFromPr({ receiving: { id: 'recOld', purchase_request_id: 'pr1' }, prItems: PR_ITEMS, existingItems: existing })
  check('B6c muat ulang tidak menduplikasi', r2.ok === true && r2.added === 0 && r2.already === true)
  check('B6d total baris tetap 3', mock.__state.rows.size === 3)

  // nota tanpa PR
  const r3 = await S.loadItemsFromPr({ receiving: { id: 'recX', purchase_request_id: null }, prItems: PR_ITEMS, existingItems: [] })
  check('B6e nota tanpa PR -> pesan jelas', r3.ok === false && /tidak terhubung ke PR/.test(r3.error || ''))

  // balapan: insert 23505 dilewati
  mock.__reset({ rows: [], failInsertOnce: true })
  const r4 = await S.loadItemsFromPr({ receiving: { id: 'recY', purchase_request_id: 'pr1' }, prItems: PR_ITEMS.slice(0, 2), existingItems: [] })
  check('B6f 23505 dilewati (added=1, tidak gagal)', r4.ok === true && r4.added === 1)
}

console.log(`\nlogic_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
