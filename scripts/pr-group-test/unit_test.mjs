// ============================================================
// UNIT TEST HELPER PENGELOMPOKAN KATEGORI (t_48f6b336)
// Fungsi murni dari modules/requests/view.jsx — tanpa React/DOM.
// ============================================================
const viewMod = await import('./dist/modules/requests/view.mjs')
const {
  groupItemsByCategory, groupHeadingText, materialMapFrom,
  attachMaterialIds, UNCATEGORIZED_LABEL, prEstimateRows
} = viewMod

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}

const MATERIALS = [
  { id: 'mPLY', kode: 'PLY-0001', name: 'BB Blockboard', category: 'Plywood & Board' },
  { id: 'mHPL', kode: 'HPL-0001', name: 'HPL Woodgrain', category: 'HPL & Edging' },
  { id: 'mHWF', kode: 'HWF-0001', name: 'Engsel Lurus', category: 'Hardware & Fitting' },
  { id: 'mNOCAT', kode: 'MAT-0009', name: 'Material Tanpa Kategori', category: '' },
  { id: 'mWPC', kode: 'WPC-0001', name: 'WPC Panel', category: 'WPC & Panel' }
]
const mmap = materialMapFrom(MATERIALS)

console.log('=== UNIT: grouping helper (modules/requests/view.jsx) ===\n')

// ---------- 1. materialMapFrom ----------
console.log('1. materialMapFrom — peta master material')
{
  check('ukuran = 5', mmap.size === 5)
  check('lookup by id → objek material', mmap.get('mHPL')?.category === 'HPL & Edging')
  check('array kosong/null → map kosong (tanpa error)', materialMapFrom([]).size === 0 && materialMapFrom(null).size === 0)
}

// ---------- 2. attachMaterialIds ----------
console.log('\n2. attachMaterialIds — zip 1:1 pr_items → baris tampilan')
{
  const rows = [{ name: 'A' }, { name: 'B' }]
  const raw = [{ id: 'p1', material_id: 'mPLY' }, { id: 'p2', material_id: null }]
  const out = attachMaterialIds(rows, raw)
  check('material_id tertempel utk item dgn relasi', out[0].material_id === 'mPLY')
  check('tanpa relasi → material_id tidak disetel (bukan string kosong palsu)', !('material_id' in out[1]) || out[1].material_id == null)
  check('panjang beda (legacy ringkasan teks) → baris asli apa adanya', attachMaterialIds([{ name: 'X' }], raw)[0].material_id === undefined)
  check('TIDAK memutasi objek baris asli', rows[0].material_id === undefined)
  check('raw kosong → baris asli apa adanya', attachMaterialIds(rows, [])[0].material_id === undefined)
}

// ---------- 3. groupItemsByCategory — multi kategori ----------
console.log('\n3. groupItemsByCategory — multi-kategori (kasus PR-007)')
{
  const rows = [
    { name: 'Triplek Polos', material_id: 'mPLY', savedSubtotal: 10000 },
    { name: 'HPL Taco AC', material_id: 'mHPL', savedSubtotal: 20000 },
    { name: 'BB Blockboard 18', material_id: 'mPLY', savedSubtotal: 30000 },
    { name: 'Engsel Lurus Taco', material_id: 'mHWF', savedSubtotal: 40000 },
    { name: 'HPL Taco DP', material_id: 'mHPL', savedSubtotal: 50000 }
  ]
  const g = groupItemsByCategory(rows, mmap)
  check('3 grup (Plywood, HPL, Hardware) — kemunculan pertama', g.length === 3 && g.map(x => x.heading).join('|') === 'Plywood & Board|HPL & Edging|Hardware & Fitting', g.map(x => x.heading).join('|'))
  check('item Plywood = Triplek + Blockboard (urutan asli dipertahankan)', g[0].items.length === 2 && g[0].items[0].name === 'Triplek Polos' && g[0].items[1].name === 'BB Blockboard 18')
  check('item HPL = 2 (AC lalu DP — urutan asli)', g[1].items.length === 2 && g[1].items[0].name === 'HPL Taco AC')
  check('subtotal kategori = jumlah savedSubtotal item grup', g[0].estSubtotal === 40000 && g[1].estSubtotal === 70000 && g[2].estSubtotal === 40000)
  check('TIDAK ada grup tebakan dari nama/prefix vendor', !g.some(x => /taco/i.test(x.heading || '')))
}

// ---------- 4. satu kategori ----------
console.log('\n4. satu kategori — TANPA heading duplikat, tetap satu grup')
{
  const g = groupItemsByCategory([
    { name: 'A', material_id: 'mHPL' },
    { name: 'B', material_id: 'mHPL' },
    { name: 'C', material_id: 'mHPL' }
  ], mmap)
  check('tepat 1 grup HPL & Edging', g.length === 1 && g[0].heading === 'HPL & Edging')
  check('3 item utuh di dalamnya', g[0].items.length === 3)
}

// ---------- 5. missing master / kategori kosong ----------
console.log('\n5. missing master / kategori kosong → Belum Berkategori (jujur)')
{
  const g = groupItemsByCategory([
    { name: 'Tanpa material_id', material_id: null },
    { name: 'Master hilang', material_id: 'mGONE' },
    { name: 'Kategori kosong', material_id: 'mNOCAT' },
    { name: 'HPL valid', material_id: 'mHPL' },
    { name: 'Legacy tanpa field', savedSubtotal: 5000 }
  ], mmap)
  check('2 grup: Belum Berkategori (pertama — kemunculan pertama) + kategori', g.length === 2, g.map(x => x.heading).join('|'))
  check('grup tanpa kategori heading null', g[0].heading === null)
  check('label tampilan = "Belum Berkategori" (tanpa mengarang)', groupHeadingText(g[0].heading) === 'Belum Berkategori')
  check('grup berkategori = HPL', g[1].heading === 'HPL & Edging' && g[1].items.length === 1)
  check('4 item masuk Belum Berkategori', g[0].items.length === 4)
  check('label UNCATEGORIZED_LABEL konsisten', UNCATEGORIZED_LABEL === 'Belum Berkategori')
  check('heading kategori utuh (TIDAK dipotong)', groupHeadingText('Plywood & Board') === 'Plywood & Board')
}

// ---------- 6. ordering stabil ----------
console.log('\n6. ordering stabil — grup & item ikut urutan input (sort_order)')
{
  const input = [
    { name: '3 HWF', material_id: 'mHWF' },
    { name: '1 HPL', material_id: 'mHPL' },
    { name: '2 WPC', material_id: 'mWPC' },
    { name: '4 HWF kedua', material_id: 'mHWF' },
    { name: '5 WPC kedua', material_id: 'mWPC' }
  ]
  const g = groupItemsByCategory(input, mmap)
  check('urutan grup = urutan kemunculan pertama (HWF→HPL→WPC)', g.map(x => x.heading).join('|') === 'Hardware & Fitting|HPL & Edging|WPC & Panel', g.map(x => x.heading).join('|'))
  check('item grup 1 = posisi 1 & 4 input', g[0].items[0].name === '3 HWF' && g[0].items[1].name === '4 HWF kedua')
  check('item grup 3 = posisi 3 & 5 input', g[2].items[0].name === '2 WPC' && g[2].items[1].name === '5 WPC kedua')
  const g2 = groupItemsByCategory([...input].reverse(), mmap)
  check('input dibalik → hasil dibalik (fungsinya tidak mengurutkan sendiri)', g2.map(x => x.heading).join('|') === 'WPC & Panel|Hardware & Fitting|HPL & Edging')
}

// ---------- 7. subtotal kategori hanya dari sumber valid ----------
console.log('\n7. subtotal kategori — hanya nominal valid, bukan jumlah qty')
{
  const g = groupItemsByCategory([
    { name: 'A', material_id: 'mPLY', savedSubtotal: 120000 },
    { name: 'B', material_id: 'mPLY', savedSubtotal: null },
    { name: 'C', material_id: 'mPLY', savedSubtotal: 0 }
  ], mmap)
  check('subtotal = 120.000 + 0 (item tanpa harga di-skip, bukan dianggap 0 palsu utk kelengkapan)', g[0].estSubtotal === 120000)
  check('grup tanpa satu pun harga → estSubtotal undefined (bukan 0 palsu)', groupItemsByCategory([{ name: 'X', material_id: 'mPLY', savedSubtotal: null }], mmap)[0].estSubtotal === undefined)
}

// ---------- 8. prEstimateRows tidak berubah ----------
console.log('\n8. Total Estimasi (t_ac0b39c0) — kontrak tidak berubah oleh grouping')
{
  const est = prEstimateRows([
    { quantity: 2, estimated_price: 120000 },
    { quantity: 1, estimated_price: null }
  ])
  check('total 240.000 + 1 item belum lengkap', est.total === 240000 && est.unknown === 1 && !est.complete)
  check('items kosong → hasItems false', prEstimateRows([]).hasItems === false)
}

// ---------- 9. nama kategori panjang / wrap ----------
console.log('\n9. nama kategori panjang & karakter khusus — utuh, tidak diubah')
{
  const long = 'Kelistrikan & Lampu (Bohlam · LED — Luar Ruang)'
  const mmap2 = materialMapFrom([{ id: 'mKEL', category: long }])
  const g = groupItemsByCategory([{ name: 'Kabel', material_id: 'mKEL' }], mmap2)
  check('nama kategori panjang dipertahankan apa adanya', g[0].heading === long && groupHeadingText(long) === long)
}

console.log(`\n=== HASIL UNIT: ${pass} LULUS, ${fail} GAGAL ===`)
if (fail) { console.log('GAGAL: ' + failures.join(' | ')); process.exit(1) }
console.log('SEMUA UNIT GROUPING LULUS')
