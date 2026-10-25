// ============================================================
// QUEUE TEST — modules/handovers/logic.js + actions.js
// (distribusi fisik, 3 aksi: gudang / tukang / tandai diserahkan)
// Dijalankan oleh run.py di sandbox (tanpa DB / jaringan).
// ============================================================
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const SB = process.cwd()
const L = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/logic.mjs')).href)
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

let pass = 0, fail = 0
const failures = []
function check(name, expected, actual = true) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`) }
}

console.log('=== Q1. ANTREAN — baris mana yang masuk daftar ===\n')
{
  const queue = L.buildDistributionQueue([
    { id: 'h1', diserahkan_at: null, handover_date: '2026-10-10' },
    { id: 'h2', diserahkan_at: '2026-10-12T00:00:00Z', handover_date: '2026-10-11' },
    { id: 'h3', diserahkan_at: null, handover_date: '2026-10-15' },
    { id: '', diserahkan_at: null }
  ])
  check('Q1a hanya handover DRAFT (tanpa diserahkan_at) & punya id', ['h3', 'h1'], queue.map(h => h.id))
  check('Q1b urut tanggal terbaru dulu', 'h3', queue[0].id)
}

console.log('\n=== Q2. RINGKASAN DISTRIBUSI (qty dari pr_items) ===\n')
{
  const prItems = [
    { id: 'p1', quantity: 5, status: 'RECEIVED' },
    { id: 'p2', quantity: 3, status: 'DI_GUDANG' },
    { id: 'p3', quantity: 2, status: 'DI_TUKANG' }
  ]
  const items = [{ pr_item_id: 'p1' }, { pr_item_id: 'p2' }, { pr_item_id: 'p3' }]
  const s = L.summarizeDistribution({ id: 'h' }, items, prItems)
  check('Q2a total qty', 10, s.total)
  check('Q2b inWarehouse (DI_GUDANG saja)', 3, s.inWarehouse)
  check('Q2c sentToTukang', 2, s.sentToTukang)
  check('Q2d done = gudang + tukang', 5, s.done)
  check('Q2e remaining', 5, s.remaining)
  check('Q2f allDone=false', false, s.allDone)

  const s2 = L.summarizeDistribution({ id: 'h' }, [], [])
  check('Q2g tanpa item -> total 0, allDone false', [0, false], [s2.total, s2.allDone])

  const s3 = L.summarizeDistribution({ id: 'h' }, [{ pr_item_id: 'p9' }], prItems)
  check('Q2h pr_item tidak dikenal -> qty 0 (tidak menebak)', 0, s3.total)
}

console.log('\n=== Q3. PENJAGA STATE TIAP AKSI ===\n')
{
  const draft = { id: 'h', diserahkan_at: null, masuk_gudang: false, tukang_at: null }
  const done = { id: 'h', diserahkan_at: '2026-10-15T00:00:00Z' }
  const fresh = { total: 10, done: 0, inWarehouse: 0, sentToTukang: 0 }
  const partial = { total: 10, done: 4, inWarehouse: 4, sentToTukang: 0 }

  check('Q3a gudang boleh saat belum apa-apa', [true, ''], [L.canActGudang(draft, fresh).ok, L.canActGudang(draft, fresh).reason])
  check('Q3b gudang ditolak setelah diserahkan', false, L.canActGudang(done, fresh).ok)
  // masuk_gudang ada di baris RECEIVING (nota) — dulu salah dibaca dari handover.
  check('Q3c gudang ditolak bila nota sudah masuk_gudang', false, L.canActGudang(draft, fresh, { masuk_gudang: true }).ok)
  check('Q3d gudang ditolak bila sebagian sudah DI_GUDANG', false, L.canActGudang(draft, partial).ok)

  check('Q3e tukang ditolak bila alokasi gudang', false, L.canActTukang(draft, fresh, 'KE_GUDANG').ok)
  check('Q3f tukang boleh bila alokasi KE_TUKANG', true, L.canActTukang(draft, fresh, 'KE_TUKANG').ok)
  check('Q3g tukang boleh bila alokasi LANGSUNG_LAPANGAN', true, L.canActTukang(draft, fresh, 'LANGSUNG_LAPANGAN').ok)
  // tukang_at ada di baris RECEIVING (nota) — dulu salah dibaca dari handover.
  check('Q3h tukang ditolak bila nota sudah tukang_at', false, L.canActTukang(draft, fresh, 'KE_TUKANG', { tukang_at: '2026-10-14T00:00:00Z' }).ok)
  check('Q3i tukang ditolak bila sebagian sudah DI_TUKANG', false, L.canActTukang(draft, { total: 10, done: 2, inWarehouse: 0, sentToTukang: 2 }, 'KE_TUKANG').ok)

  check('Q3j terima ditolak bila belum ada distribusi', false, L.canActTerima(draft, fresh).ok)
  check('Q3k terima boleh bila ada yang didistribusikan', true, L.canActTerima(draft, partial).ok)
  check('Q3l terima ditolak setelah diserahkan', false, L.canActTerima(done, partial).ok)
}

console.log('\n=== Q4. actionPlan — 3 aksi, izin & alasan di satu tempat ===\n')
{
  const plan = L.actionPlan({ id: 'h', diserahkan_at: null }, { total: 10, done: 0, inWarehouse: 0, sentToTukang: 0 }, 'KE_TUKANG')
  check('Q4a tiga aksi', ['gudang', 'tukang', 'terima'], plan.map(a => a.key))
  check('Q4b gudang & tukang boleh, terima belum', [true, true, false], plan.map(a => a.ok))
  check('Q4c alasan terima jelas', true, /Belum ada barang/.test(plan[2].reason))
  check('Q4d testid lengkap', ['act-gudang', 'act-tukang', 'act-terima'], plan.map(a => a.testid))

  const plan2 = L.actionPlan({ id: 'h', diserahkan_at: '2026-10-15T00:00:00Z' }, { total: 10, done: 10 }, 'KE_GUDANG')
  check('Q4e setelah diserahkan semua ditolak', [false, false, false], plan2.map(a => a.ok))

  // penjaga yang hidup di baris RECEIVING harus ikut terangkat lewat actionPlan
  const plan3 = L.actionPlan({ id: 'h', diserahkan_at: null }, { total: 10, done: 0 }, 'KE_TUKANG', { tukang_at: '2026-10-14T00:00:00Z' })
  check('Q4f tukang_at nota menonaktifkan aksi tukang', false, plan3[1].ok)
  check('Q4f2 alasan tukang menyebut nota', /nota/i.test(plan3[1].reason))
  const plan4 = L.actionPlan({ id: 'h', diserahkan_at: null }, { total: 10, done: 0 }, 'KE_GUDANG', { masuk_gudang: true })
  check('Q4g masuk_gudang nota menonaktifkan aksi gudang', false, plan4[0].ok)
  check('Q4g2 alasan gudang menyebut nota', /nota/i.test(plan4[0].reason))
}

console.log('\n=== Q5. LABEL RINGKAS + TARGET STATUS ===\n')
{
  check('Q5a tanpa barang', 'Belum ada barang tercatat', L.distributionLabel(null))
  check('Q5a2 total 0', 'Belum ada barang tercatat', L.distributionLabel({ total: 0, done: 0 }))
  check('Q5b parsial', '4 dari 10 barang didistribusikan', L.distributionLabel({ total: 10, done: 4 }))
  check('Q5c semua', 'Semua barang sudah didistribusikan', L.distributionLabel({ total: 10, done: 10 }))
  check('Q5d target gudang', 'DI_GUDANG', L.targetStatusForAction(L.ACT_GUDANG))
  check('Q5e target tukang', 'DI_TUKANG', L.targetStatusForAction(L.ACT_TUKANG))
  check('Q5f target terima = null (bukan status item)', null, L.targetStatusForAction(L.ACT_TERIMA))
  check('Q5g status cocok (case-insensitive)', true, L.statusMatchesAction('di_gudang', L.ACT_GUDANG))
  check('Q5h status tidak cocok', false, L.statusMatchesAction('RECEIVED', L.ACT_GUDANG))
  check('Q5i isBoughtStatus', [true, false], [L.isBoughtStatus('RECEIVED'), L.isBoughtStatus('ORDERED')])
}

console.log('\n=== Q6. AKSI TULIS DB (actions.js, mock perekam) ===\n')
const HO = 'h1'
function seed() {
  mock.__reset({
    handovers: [{ id: HO, receiving_id: 'rec1', diserahkan_at: null, status: 'DRAFT' }],
    receivings: [{ id: 'rec1', masuk_gudang: false, tukang_at: null, alokasi: 'KE_GUDANG' }],
    prItems: [
      { id: 'p1', status: 'RECEIVED', quantity: 2 },
      { id: 'p2', status: 'RECEIVED', quantity: 3 }
    ],
    receivingItems: [
      { id: 'ri1', receiving_id: 'rec1', pr_item_id: 'p1' },
      { id: 'ri2', receiving_id: 'rec1', pr_item_id: 'p2' }
    ]
  })
}

// Q6 — kirim ke gudang
{
  seed()
  const { runHandoverAction } = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/actions.mjs')).href)
  const res = await runHandoverAction(L.ACT_GUDANG, HO)
  check('Q6a gudang ok', true, res.ok)
  check('Q6b receivings.masuk_gudang=true', true, mock.__state.receivings.get('rec1').masuk_gudang)
  check('Q6c p1 -> DI_GUDANG', 'DI_GUDANG', mock.__state.prItems.get('p1').status)
  check('Q6d p2 -> DI_GUDANG', 'DI_GUDANG', mock.__state.prItems.get('p2').status)
  check('Q6e handover TIDAK ikut diserahkan', null, mock.__state.handovers.get(HO).diserahkan_at)
  check('Q6f pesan menyebut jumlah barang', true, /2 barang/.test(res.message))

  // idempoten: jalankan lagi -> tidak menulis ulang status
  const before = mock.__callsOf('update', 'pr_items').length
  const res2 = await runHandoverAction(L.ACT_GUDANG, HO)
  check('Q6g idempoten: nol update pr_items kedua', before, mock.__callsOf('update', 'pr_items').length)
  check('Q6h idempoten: tetap ok', true, res2.ok)
}

// Q7 — kirim ke tukang
{
  seed()
  mock.__state.receivings.get('rec1').alokasi = 'KE_TUKANG'
  const { runHandoverAction } = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/actions.mjs')).href)
  const res = await runHandoverAction(L.ACT_TUKANG, HO)
  check('Q7a tukang ok', true, res.ok)
  check('Q7b receivings.tukang_at terisi', true, !!mock.__state.receivings.get('rec1').tukang_at)
  check('Q7c p1 -> DI_TUKANG', 'DI_TUKANG', mock.__state.prItems.get('p1').status)
  check('Q7d p2 -> DI_TUKANG', 'DI_TUKANG', mock.__state.prItems.get('p2').status)
  check('Q7e masuk_gudang TIDAK disentuh', false, mock.__state.receivings.get('rec1').masuk_gudang)
}

// Q8 — tandai diserahkan
{
  seed()
  const { runHandoverAction } = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/actions.mjs')).href)
  const res = await runHandoverAction(L.ACT_TERIMA, HO, { receivedBy: 'Mandor A' })
  check('Q8a terima ok', true, res.ok)
  check('Q8b diserahkan_at terisi', true, !!mock.__state.handovers.get(HO).diserahkan_at)
  check('Q8c status CONFIRMED', 'CONFIRMED', mock.__state.handovers.get(HO).status)
  check('Q8d received_by tersimpan', 'Mandor A', mock.__state.handovers.get(HO).received_by)
  check('Q8e tanpa nama -> received_by tidak ditimpa', true, mock.__state.handovers.get(HO).received_by === 'Mandor A')

  // ulangi -> no-op, tidak menulis kedua kali
  const before = mock.__callsOf('update', 'handovers').length
  const res2 = await runHandoverAction(L.ACT_TERIMA, HO)
  check('Q8f idempoten: nol update kedua', before, mock.__callsOf('update', 'handovers').length)
  check('Q8g pesan sudah diserahkan', true, /sudah ditandai/.test(res2.message))
}

// Q9 — tanpa nama penerima & aksi tak dikenal & handover hilang
{
  seed()
  const { runHandoverAction } = await import(pathToFileURL(path.join(SB, 'dist/modules/handovers/actions.mjs')).href)
  const res = await runHandoverAction(L.ACT_TERIMA, HO)
  check('Q9a terima tanpa nama tetap ok', true, res.ok)
  check('Q9b received_by lama (Belum ditentukan) tidak ditimpa', 'Belum ditentukan', mock.__state.handovers.get(HO).received_by || 'Belum ditentukan')

  const bad = await runHandoverAction('aksi-ngawur', HO)
  check('Q9c aksi tak dikenal ditolak', false, bad.ok)

  const missing = await runHandoverAction(L.ACT_GUDANG, 'tidak-ada')
  check('Q9d handover hilang ditolak', false, missing.ok)
  check('Q9e pesan handover hilang jelas', true, /tidak ditemukan/.test(missing.message))
}

console.log(`\nqueue_test: ${pass}/${pass + fail} lulus${fail ? ' — GAGAL: ' + failures.join(' | ') : ''}`)
process.exit(fail ? 1 : 0)
