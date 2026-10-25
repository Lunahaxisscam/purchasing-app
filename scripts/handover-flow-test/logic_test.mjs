// ============================================================
// LOGIC TEST — modules/handovers/display.js + confirm.js + save.js (verbatim)
// t_b418827b: semantik bukti fisik, rincian/legacy label, prototype per-item
// (parsial/sisa/beberapa penerima), konfirmasi idempoten (CAS), edit terkunci.
// Dijalankan oleh run.py di sandbox (tanpa DB / jaringan).
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const D = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/display.mjs')).href)
const C = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/confirm.mjs')).href)
const S = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/save.mjs')).href)
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
// check(name, expected, actual=true) — bandingkan nilai secara ketat
// (mendukung gaya boolean `check('x', cond)` maupun expected/actual).
function check(name, expected, actual = true) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}

console.log('=== H1. SEMANTIK BUKTI FISIK (display.js verbatim) ===\n')
{
  // Data live c14802de: CONFIRMED tapi diserahkan_at NULL -> BUKAN bukti fisik.
  const legacy = { id: 'hL', status: 'CONFIRMED', diserahkan_at: null, note: 'Barang fitting diterima mandor' }
  const st = D.statusInfo(legacy)
  check('H1a CONFIRMED tanpa diserahkan_at -> Belum Diserahkan', 'Belum Diserahkan', st.label)
  check('H1b delivered=false', st.delivered === false)
  check('H1c catatan status lama tampil apa adanya', true, /Status lama "CONFIRMED"/.test(st.legacyNote))

  const done = { id: 'hD', status: 'CONFIRMED', diserahkan_at: '2026-10-15T08:00:00Z' }
  const st2 = D.statusInfo(done)
  check('H1d diserahkan_at ada -> Sudah Diserahkan', 'Sudah Diserahkan', st2.label)
  check('H1e tanpa catatan legacy', st2.legacyNote === '')

  const draft = { id: 'hX', status: 'DRAFT', diserahkan_at: null }
  const st3 = D.statusInfo(draft)
  check('H1f DRAFT -> Belum Diserahkan tanpa catatan legacy', 'Belum Diserahkan', st3.label)
  check('H1g DRAFT bukan legacy note', st3.legacyNote === '')

  // SELESAI lama tanpa diserahkan_at juga bukan bukti fisik
  const old = { id: 'hS', status: 'SELESAI', diserahkan_at: null }
  check('H1h SELESAI tanpa diserahkan_at -> Belum', 'Belum Diserahkan', D.statusInfo(old).label)
}

console.log('\n=== H2. RINCIAN BARANG (label jujur, tanpa menebak) ===\n')
{
  // Data lama tanpa item rows & tanpa tabel handover_items.
  const h = { id: 'h2', receiving_id: 'rec1' }
  const r = D.rincianInfo(h)
  check('H2a available=false utk data tanpa rincian', r.available === false)
  check('H2b label "Rincian barang belum tersedia"', 'Rincian barang belum tersedia', r.label)
  check('H2c TIDAK ada baris angka tebakan', r.rows.length === 0)
  check('H2d notice menyebut skema belum aktif', true, /belum aktif/.test(r.notice))

  const hNoRec = { id: 'h3', receiving_id: null }
  check('H2e tanpa receiving_id -> label sama', 'Rincian barang belum tersedia', D.rincianInfo(hNoRec).label)

  // Setelah skema disetujui: handover.items terisi -> rincian ditampilkan.
  const hItems = { id: 'h4', receiving_id: 'rec1', items: [
    { item_name: 'Triplek 9mm', qty_diserahkan: 3, satuan: 'Lembar' },
    { item_name: 'Lem Fox', qty_diserahkan: 1, satuan: 'Kaleng' }
  ] }
  const r2 = D.rincianInfo(hItems)
  check('H2f items terstruktur -> available', true, r2.available)
  check('H2g 2 baris item', 2, r2.rows.length)
  check('H2h qty & satuan per baris', true, r2.rows[0].qty === 3 && r2.rows[0].unit === 'Lembar' && r2.rows[0].qtyLabel === 'diserahkan')

  // Sel daftar
  const cell = D.rincianCell(h)
  check('H2i sel daftar: unavailable + label', true, cell.unavailable && cell.text === 'Rincian barang belum tersedia')
  const cell2 = D.rincianCell(hItems)
  check('H2j sel daftar terstruktur: "2 item — ..."', true, !cell2.unavailable && /2 item — Triplek 9mm, Lem Fox/.test(cell2.text))
}

console.log('\n=== H3. REFERENSI SUMBER (PR/Purchase dari receiving_id) ===\n')
{
  const rec = { id: 'rec1', invoice_no: 'INV-1', delivery_note: 'SJ-1', purchase_request_id: 'pr1', alokasi: 'KE_TUKANG' }
  const pr = { id: 'pr1', pr_number: 'PR-003', title: 'Fitting' }
  const refs = D.sourceRefs({ receiving_id: 'rec1' }, { allReceivings: [rec], allRequests: [pr] })
  check('H3a receivingLabel = invoice', 'INV-1', refs.receivingLabel)
  check('H3b delivery note', 'SJ-1', refs.deliveryNote)
  check('H3c PR asal', 'PR-003', refs.prNumber)
  check('H3d alokasi tampil apa adanya', 'KE_TUKANG', refs.alokasi)
  const refs2 = D.sourceRefs({ receiving_id: 'missing' }, { allReceivings: [rec], allRequests: [pr] })
  check('H3e receiving hilang -> label kosong (bukan tebakan)', refs2.receivingLabel === '')
  check('H3f PR null bila tanpa receiving', refs2.prNumber === null)
}

console.log('\n=== H4. PROTOTYPE PER-ITEM: parsial, sisa, tanpa hitung ganda, beberapa penerima ===\n')
{
  const refs = [
    { id: 'ri1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 },
    { id: 'ri2', item_name: 'Cat Duco', unit: 'Kaleng', quantity_received: 4 }
  ]
  // Baris 1: 6 dari 10 (parsial)
  const v1 = D.validatePrototypeRow({ refItemId: 'ri1', qty: '6' }, refs, [])
  check('H4a baris parsial 6/10 valid', true, v1.ok)
  check('H4b sisa tersedia 10', 10, v1.available)

  // Entri tersimpan -> baris kedua 5 > sisa 4 -> ditolak (tanpa hitung ganda)
  const entries = [{ refItemId: 'ri1', qty: 6, penerima: 'Pak Joko' }]
  const v2 = D.validatePrototypeRow({ refItemId: 'ri1', qty: '5' }, refs, entries)
  check('H4c melebihi sisa (5 > 4) ditolak', v2.ok === false)
  check('H4d pesan menyebut sisa 4', true, /sisa 4/.test(v2.error))
  const v3 = D.validatePrototypeRow({ refItemId: 'ri1', qty: '4' }, refs, entries)
  check('H4e tepat sisa (4) diterima', true, v3.ok)

  // Beberapa penerima utk item yang sama (split antar tukang)
  const entries2 = [
    { refItemId: 'ri1', qty: 4, penerima: 'Pak Joko' },
    { refItemId: 'ri1', qty: 3, penerima: 'Pak Andi' }
  ]
  const totals = D.prototypeTotals(entries2, refs)
  const t1 = totals.find(t => t.refItemId === 'ri1')
  check('H4f total tercatat 7 (4+3)', 7, t1.used)
  check('H4g sisa belum diserahkan 3 (10-7)', 3, t1.sisa)
  check('H4h item lain tidak terpengaruh (Cat 0)', totals.find(t => t.refItemId === 'ri2').used === 0)

  // qty tidak valid
  check('H4i qty 0 ditolak', D.validatePrototypeRow({ refItemId: 'ri1', qty: '0' }, refs, []).ok === false)
  check('H4j qty negatif ditolak', D.validatePrototypeRow({ refItemId: 'ri1', qty: '-2' }, refs, []).ok === false)
  check('H4k qty non-angka ditolak', D.validatePrototypeRow({ refItemId: 'ri1', qty: 'abc' }, refs, []).ok === false)
  check('H4l item tak dikenal ditolak', D.validatePrototypeRow({ refItemId: 'x', qty: '1' }, refs, []).ok === false)
}

console.log('\n=== H5. KONFIRMASI FISIK IDEMPOTEN (confirm.js + mock CAS) ===\n')
{
  // Normal: menulis status + diserahkan_at
  mock.__reset({ handovers: [{ id: 'h1', status: 'DRAFT', diserahkan_at: null }] })
  const r1 = await C.markHandoverDelivered({ handover: { id: 'h1', status: 'DRAFT', diserahkan_at: null }, now: '2026-10-16T10:00:00Z' })
  check('H5a konfirmasi pertama sukses', true, r1.ok && r1.updated === true)
  check('H5b status jadi CONFIRMED', 'CONFIRMED', mock.__state.handovers.get('h1').status)
  check('H5c diserahkan_at tertulis', '2026-10-16T10:00:00Z', mock.__state.handovers.get('h1').diserahkan_at)

  // Re-confirm: row sudah punya diserahkan_at -> no-op (tidak menulis ulang)
  mock.__reset({ handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: '2026-10-16T10:00:00Z' }] })
  const r2 = await C.markHandoverDelivered({ handover: { id: 'h1', status: 'CONFIRMED', diserahkan_at: '2026-10-16T10:00:00Z' }, now: '2026-10-17T00:00:00Z' })
  check('H5d re-confirm -> already, tanpa tulisan', true, r2.ok && r2.already === true)
  check('H5e waktu lama TIDAK tertimpa', '2026-10-16T10:00:00Z', mock.__state.handovers.get('h1').diserahkan_at)
  check('H5f nol update terkirim saat already', mock.__callsOf('update', 'handovers').length === 0)

  // Balapan/retry: state DB sudah CONFIRMED (orang lain), handover lokal masih stale
  mock.__reset({ handovers: [{ id: 'h1', status: 'CONFIRMED', diserahkan_at: '2026-10-16T09:00:00Z' }] })
  const r3 = await C.markHandoverDelivered({ handover: { id: 'h1', status: 'DRAFT', diserahkan_at: null }, now: '2026-10-16T10:00:00Z' })
  check('H5g retry balapan -> CAS 0 baris = already', true, r3.ok && r3.already === true)
  check('H5h waktu pemenang pertama dipertahankan', '2026-10-16T09:00:00Z', mock.__state.handovers.get('h1').diserahkan_at)

  // Error DB -> dilaporkan, bukan diklaim sukses
  mock.__reset({ handovers: [{ id: 'h1', status: 'DRAFT', diserahkan_at: null }] })
  mock.__state.nextError = { message: 'db down' }
  const r4 = await C.markHandoverDelivered({ handover: { id: 'h1' } })
  check('H5i error DB -> ok:false + pesan', true, r4.ok === false && /db down/.test(r4.error))
  check('H5j tidak menulis apa pun saat error', mock.__state.handovers.get('h1').diserahkan_at === null)

  // Tanpa id -> error jelas
  const r5 = await C.markHandoverDelivered({ handover: null })
  check('H5k tanpa data -> error jelas', true, r5.ok === false)
}

console.log('\n=== H6. SIMPAN: edit terkunci, tambah antrean (save.js + mock) ===\n')
{
  function baseCtx(over = {}) {
    return {
      page: 'handovers',
      form: {},
      isEdit: false, editRow: null,
      say: (m) => mock.__state.calls.push({ op: 'say', msg: m }),
      close: () => mock.__state.calls.push({ op: 'close' }),
      refresh: () => mock.__state.calls.push({ op: 'refresh' }),
      setSaving: (v) => mock.__state.calls.push({ op: 'setSaving', v }),
      ...over
    }
  }

  // EDIT: payload metadata saja — FK/status/diserahkan_at tidak dikirim.
  mock.__reset({ handovers: [{ id: 'h9', receiving_id: 'rec-src', project_id: 'proj-src', status: 'CONFIRMED', diserahkan_at: '2026-10-01T00:00:00Z', note: 'teks lama' }] })
  await S.save(baseCtx({
    isEdit: true,
    editRow: { id: 'h9', receiving_id: 'rec-src', project_id: 'proj-src', status: 'CONFIRMED', diserahkan_at: '2026-10-01T00:00:00Z', note: 'teks lama' },
    form: { receiving_id: 'rec-LAIN', project_id: 'proj-LAIN', received_by: 'X', handover_status: 'DRAFT', handover_date: '2026-10-16', notes: 'catatan baru' }
  }))
  const upd = mock.__callsOf('update', 'handovers')[0]
  check('H6a edit -> UPDATE handovers', !!upd)
  check('H6b payload TANPA receiving_id', upd && !('receiving_id' in upd.data))
  check('H6c payload TANPA project_id', upd && !('project_id' in upd.data))
  check('H6d payload TANPA status', upd && !('status' in upd.data))
  check('H6e payload TANPA diserahkan_at', upd && !('diserahkan_at' in upd.data))
  check('H6f received_by tersimpan', 'X', upd?.data?.received_by)
  check('H6g FK di DB TIDAK berubah (tamper ditolak)', 'rec-src', mock.__state.handovers.get('h9').receiving_id)
  check('H6h status di DB TIDAK berubah', 'CONFIRMED', mock.__state.handovers.get('h9').status)
  check('H6i diserahkan_at di DB TIDAK berubah', '2026-10-01T00:00:00Z', mock.__state.handovers.get('h9').diserahkan_at)

  // TAMBAH: masuk antrean DRAFT (bukan CONFIRMED) walau form bilang CONFIRMED.
  mock.__reset({})
  await S.save(baseCtx({
    form: { receiving_id: 'rec1', project_id: 'p1', received_by: 'Mandor', handover_status: 'CONFIRMED', handover_date: '2026-10-16', notes: 'x' }
  }))
  const ins = mock.__callsOf('insert', 'handovers')[0]
  check('H6j tambah -> insert', !!ins)
  check('H6k status DRAFT (antrean Belum Diserahkan)', 'DRAFT', ins?.data?.status)
  check('H6l TANPA diserahkan_at', ins && !('diserahkan_at' in ins.data))

  // TAMBAH tanpa receiving -> ditolak, nol tulisan
  mock.__reset({})
  await S.save(baseCtx({ form: { receiving_id: '', project_id: 'p1', received_by: 'X' } }))
  check('H6m tanpa receiving -> nol insert', mock.__callsOf('insert', 'handovers').length === 0)
  check('H6n pesan jelas', true, mock.__state.calls.some(c => c.op === 'say' && /Pilih Penerimaan/.test(c.msg)))
}

console.log(`\nlogic_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
