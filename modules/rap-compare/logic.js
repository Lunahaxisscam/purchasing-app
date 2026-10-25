// ============================================================
// MODUL PERBANDINGAN RAB vs RAP vs AKTUAL (t_a5ba5f73)
// ============================================================
// Logika murni — TANPA React, TANPA DOM, TANPA DB. Semua fungsi di
// sini deterministik dan bisa diuji headless (node --test / harness
// render). Tampilan ada di modules/rap-compare/view.jsx.
//
// KEPUTUSAN YANG DIJAGA (kontrak data):
//
// 1. AKTUAL hanya berasal dari nota pembelian yang SUDAH terjadi:
//    receivings/receiving_items (modules/receivings). Tidak ada angka
//    "aktual" dikarang dari RAP atau dari status PR — yang belum punya
//    nota WAJIB ditandai "Belum ada aktual" (actualAmount = null), bukan 0.
//
// 2. BARIS dibandingkan pada nilai dasar baris (qty x harga satuan),
//    BUKAN grand total quotation yang sudah kena markup/PPN. Harga jual
//    dan biaya pelaksanaan adalah dua hal berbeda; mencampurnya akan
//    membuat "selisih" terlihat lebih kecil dari kenyataan.
//
// 3. SATU tempat konversi harga ribuan -> rupiah (toRupiah). Nilai
//    negatif atau bukan-angka ditolak eksplisit (null), tidak dipaksa 0.
//
// 4. RAP bersifat DRAFT: modul ini TIDAK menulis ke DB, tidak membuat
//    tabel, tidak memakai localStorage. Angka RAP hanya hidup di state
//    React induk (sama seperti modules/rap di agent-1-ops).
//
// 5. Nama baris dicocokkan case-insensitive dan di-trim. Nama kosong
//    tidak dicocokkan ke apa pun (harus jadi baris RAB yang "belum
//    masuk RAP" atau baris RAP baru, jangan diarahkan ke baris lain).
//
// 6. Baris AKTUAL yang tidak punya pasangan RAB/RAP TIDAK disembunyikan:
//    ia masuk daftar "aktual tanpa acuan" supaya pembaca bisa bertanya
//    ke pembeli, bukan diam-diam terbuang.
// ============================================================

// --- normalisasi nama: case-insensitive, spasi rapat ---
// Dipakai untuk mencocokkan baris RAB <-> RAP <-> AKTUAL yang datanya
// datang dari tiga alur input berbeda (BOQ JSON, form RAP, nota).
function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// --- konversi harga ke rupiah (SATU tempat, lihat keputusan 3) ---
// Menerima 1500000, "1.500.000", "Rp 1.500.000", "1,500,000".
// Mengembalikan null bila kosong / negatif / bukan angka — pemanggil
// WAJIB memperlakukan null sebagai "tidak diketahui", bukan 0.
export function toRupiah(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  const digits = String(v).replace(/[^\d]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// --- qty: sama sikapnya dengan harga (keputusan 3) ---
// qty <= 0 tidak "dipaksa 1" — dikembalikan null supaya baris itu
// muncul sebagai tidak lengkap, bukan ikut merusak total.
export function toQty(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

// Nilai dasar baris = qty x harga. Salah satu null -> null.
export function lineValue(qty, price) {
  const q = toQty(qty)
  const p = toRupiah(price)
  if (q === null || p === null) return null
  return q * p
}

// ============================================================
// SUMBER DATA — pembacaan defensif
// ============================================================

// Baris RAB dari JSON acuan BOQ. Menerima beberapa bentuk field yang
// sudah dipakai di repo ini: item/item_name/name, qty/quantity,
// price/estimated_price/harga_satuan.
// Mengembalikan { key, name, qty, price, value } — value null bila data
// baris tidak lengkap (jujur "belum lengkap", bukan 0).
export function readRabLines(rabJson) {
  let items = []
  try {
    const parsed = typeof rabJson === 'string' ? JSON.parse(rabJson) : rabJson
    items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : [])
  } catch (e) {
    return [] // JSON rusak -> tidak ada acuan, jangan lempar ke layar
  }
  return items
    .map((it, i) => {
      const name = String(it?.item ?? it?.item_name ?? it?.name ?? '').trim()
      const qty = toQty(it?.qty ?? it?.quantity)
      const price = toRupiah(it?.price ?? it?.estimated_price ?? it?.harga_satuan)
      return {
        key: `rab-${i}`,
        name,
        qty,
        price,
        value: lineValue(it?.qty ?? it?.quantity, it?.price ?? it?.estimated_price ?? it?.harga_satuan),
        unit: String(it?.unit ?? it?.satuan ?? '').trim() || null
      }
    })
    .filter(l => l.name !== '')
}

// Baris RAP dari state draft (bukan DB). Bentuk sama dengan baris RAB
// supaya tabel perbandingan bisa memakai satu renderer.
export function readRapLines(rapLines) {
  if (!Array.isArray(rapLines)) return []
  return rapLines
    .map((it, i) => {
      const name = String(it?.name ?? it?.item ?? '').trim()
      const qty = toQty(it?.qty ?? it?.quantity)
      const price = toRupiah(it?.price ?? it?.harga_satuan)
      return {
        key: `rap-${it?.id ?? i}`,
        name,
        qty,
        price,
        value: lineValue(it?.qty ?? it?.quantity, it?.price ?? it?.harga_satuan),
        unit: String(it?.unit ?? it?.satuan ?? '').trim() || null
      }
    })
    .filter(l => l.name !== '')
}

// Baris AKTUAL dari nota pembelian yang sudah terjadi.
// Sumber: receiving_items (qty_received + harga dari note "[Harga: ...]"),
// atau bentuk langsung { item_name, quantity_received, price }.
// Catatan keputusan 1: yang tidak punya harga tidak dihitung 0 —
// actualAmount = null dan baris diberi label "harga belum tercatat".
export function readActualLines(actualRows) {
  if (!Array.isArray(actualRows)) return []
  return actualRows
    .map((it, i) => {
      const name = String(it?.item_name ?? it?.name ?? it?.item ?? '').trim()
      const qty = toQty(it?.qty_received ?? it?.quantity_received ?? it?.qty ?? it?.quantity)
      const rawPrice = it?.price ?? it?.harga ?? it?.unit_price ?? null
      let price = toRupiah(rawPrice)
      if (price === null) {
        // bentuk nota repo ini: harga tersimpan di note "[Harga: 118000]"
        const m = String(it?.note ?? '').match(/\[Harga:\s*([\d.,]+)\s*\]/i)
        if (m) price = toRupiah(m[1])
      }
      return {
        key: `act-${i}`,
        name,
        qty,
        price,
        value: price === null || qty === null ? null : qty * price,
        unit: String(it?.unit ?? it?.satuan ?? '').trim() || null
      }
    })
    .filter(l => l.name !== '')
}

// ============================================================
// INTI: susun tabel perbandingan
// ============================================================

// diff = RAP - RAB (positif = RAP lebih mahal dari acuan).
// Sengaja BUKAN RAB - RAP supaya angka di layar bisa dibaca langsung
// sebagai "rencana melebihi acuan sebesar ...".
export function diffOf(rap, rab) {
  if (rap === null || rab === null) return null
  return rap - rab
}

// Status selisih untuk pewarnaan baris. Ambang 0 -> 'match'.
export function diffStatus(diff) {
  if (diff === null) return 'unknown'
  if (diff === 0) return 'match'
  return diff > 0 ? 'over' : 'under'
}

/**
 * buildComparison({ rabJson, rapLines, actualRows }) -> {
 *   rows: [{ key, name, unit, rab, rap, actual, diff, diffStatus,
 *            rabMissing, rapMissing, actualMissing }],
 *   totals: { rab, rap, actual, diff },
 *   coverage: { rabOnly, rapOnly, actualWithoutPlan, missingActual },
 *   honesty: { hasActual, actualLabel }
 * }
 *
 * Setiap baris menampung ketiga sumber sekaligus (keputusan 2), plus
 * penanda mana yang tidak ada supaya UI bisa menulis "—" jujur.
 */
/**
 * MENYUSUN PERBANDINGAN (inti modul ini).
 *
 * @param rabJson    JSON acuan RAB/BOQ ({ items: [...] }).
 * @param rapLines   baris RAP draft ([{ id, name, qty, price }]).
 * @param actualRows baris nota penerimaan (receiving_items) atau
 *                   turunannya; hanya ambil harga bila ada catatan
 *                   harga nyata (dipakai readActualLines).
 * @param paguValue  angka pagu/nilai kontrak bila halaman mengirimnya.
 *                   BILA TIDAK DIKIRIM: ceiling.level = 'none' (belum
 *                   diketahui) — TIDAK dikarang dari quotation dan
 *                   TIDAK dianggap 0/"aman".
 */
export function buildComparison({ rabJson, rapLines, actualRows, paguValue } = {}) {
  const rab = readRabLines(rabJson)
  const rap = readRapLines(rapLines)
  const actual = readActualLines(actualRows)

  const byName = new Map() // normName -> row
  const ensure = (name) => {
    const k = normName(name)
    let row = byName.get(k)
    if (!row) {
      row = { key: k, name, unit: null, rab: null, rap: null, actual: null }
      byName.set(k, row)
    }
    return row
  }

  for (const l of rab) {
    const row = ensure(l.name)
    row.rab = row.rab === null ? l.value : row.rab + l.value
    row.unit = row.unit || l.unit
  }
  for (const l of rap) {
    const row = ensure(l.name)
    row.rap = row.rap === null ? l.value : row.rap + l.value
    row.unit = row.unit || l.unit
  }
  for (const l of actual) {
    const row = ensure(l.name)
    row.actual = row.actual === null ? l.value : row.actual + l.value
    row.unit = row.unit || l.unit
  }

  const rows = [...byName.values()]
    .map(r => {
      const diff = diffOf(r.rap, r.rab)
      return {
        ...r,
        diff,
        diffStatus: diffStatus(diff),
        rabMissing: r.rab === null,
        rapMissing: r.rap === null,
        actualMissing: r.actual === null
      }
    })
    // Urut: yang punya selisih paling besar dulu supaya yang butuh
    // perhatian ada di atas; baris tanpa angka di bawah.
    .sort((a, b) => {
      const am = a.rabMissing && a.rapMissing && a.actualMissing ? 1 : 0
      const bm = b.rabMissing && b.rapMissing && b.actualMissing ? 1 : 0
      if (am !== bm) return am - bm
      const ad = Math.abs(a.diff ?? 0)
      const bd = Math.abs(b.diff ?? 0)
      if (ad !== bd) return bd - ad
      return a.name.localeCompare(b.name)
    })

  const sum = (vals) => {
    const nums = vals.filter(v => v !== null)
    if (!nums.length) return null
    return nums.reduce((a, b) => a + b, 0)
  }

  const totals = {
    rab: sum(rows.map(r => r.rab)),
    rap: sum(rows.map(r => r.rap)),
    actual: sum(rows.map(r => r.actual)),
    diff: diffOf(sum(rows.map(r => r.rap)), sum(rows.map(r => r.rab)))
  }

  const coverage = {
    // baris RAB yang belum ada RAP-nya (rencana belum lengkap)
    rabOnly: rows.filter(r => !r.rabMissing && r.rapMissing).length,
    // baris RAP yang tidak punya acuan RAB (rencana di luar acuan)
    rapOnly: rows.filter(r => !r.rapMissing && r.rabMissing).length,
    // belanja nyata tanpa acuan RAB maupun RAP
    actualWithoutPlan: rows.filter(r => !r.actualMissing && r.rabMissing && r.rapMissing).length,
    // baris berencana tapi belum ada aktualnya
    missingActual: rows.filter(r => r.actualMissing && (!r.rabMissing || !r.rapMissing)).length
  }

  // ====================================================================
  // PAGU (BATAS ATAS BIAYA) — spesifikasi t_a5ba5f73: "warning when
  // planned amount exceeds contract/pagu".
  //
  // Aturan kejujuran yang dipakai di sini:
  //  - pagu HANYA dari angka pagu yang benar-benar dikirim sebagai prop
  //    (contractValue / pagu). Tidak ada nilai kontrak yang dikarang dari
  //    quotation atau grand total — kalau tidak dikirim, state-nya
  //    "belum diketahui", bukan 0 dan bukan "aman".
  //  - yang diperiksa adalah total RAP (rencana), karena rencana yang
  //    melampaui pagu harus terlihat SEBELUM uang keluar. Total aktual
  //    ikut dilaporkan sebagai info, tapi bukan pemicu peringatan.
  //  - batas mepet (>= 95% pagu) tetap dibedakan dari "melampaui",
  //    supaya peringatan tidak menangis sebelum waktunya.
  // ====================================================================
  const paguRaw = paguValue === undefined || paguValue === null ? null : toRupiah(paguValue)
  const rapTotal = totals.rap
  const pagu = paguRaw === null ? null : paguRaw
  const used = rapTotal === null ? null : rapTotal
  const over = (pagu !== null && used !== null && used > pagu) ? used - pagu : null
  const pct = (pagu !== null && used !== null && pagu > 0) ? Math.round((used / pagu) * 1000) / 10 : null
  const ceiling = {
    hasPagu: pagu !== null,
    pagu,
    used,
    over,
    pct,
    // 'none'    : belum ada pagu dikirim -> jangan bilang aman/melewati
    // 'over'    : rencana melampaui pagu
    // 'near'    : rencana >= 95% pagu
    // 'within'  : rencana di bawah pagu
    // 'unknown' : pagu ada tapi RAP belum ada -> belum bisa disimpulkan
    level: pagu === null
      ? 'none'
      : used === null
        ? 'unknown'
        : over !== null
          ? 'over'
          : (pct !== null && pct >= 95) ? 'near' : 'within',
    label: null,
    // pesan yang tampil di UI; ditulis eksplisit apa adanya
    message: ''
  }
  if (ceiling.level === 'none') {
    ceiling.label = 'Pagu belum diketahui'
    ceiling.message = 'Nilai kontrak/pagu proyek ini tidak dikirim ke halaman ini, jadi belum bisa dinilai cukup atau melebihi batas. Tidak ada angka yang dikarang.'
  } else if (ceiling.level === 'unknown') {
    ceiling.label = 'Pagu menunggu rencana'
    ceiling.message = 'Pagu proyek sudah diketahui, tapi RAP belum punya baris bernilai. Belum ada yang bisa dibandingkan.'
  } else if (ceiling.level === 'over') {
    ceiling.label = 'Rencana melewati pagu'
    ceiling.message = `Total rencana (RAP) melebihi pagu sebesar ${over}. Kurangi rencana atau ajukan perubahan pagu sebelum pekerjaan jalan.`
  } else if (ceiling.level === 'near') {
    ceiling.label = 'Rencana mendekati pagu'
    ceiling.message = `Total rencana (RAP) sudah memakai ${ceiling.pct}% pagu. Sisanya tipis untuk selisih harga dan pekerjaan tak terduga.`
  } else {
    ceiling.label = 'Rencana di bawah pagu'
    ceiling.message = `Total rencana (RAP) masih di bawah pagu (${ceiling.pct}% terpakai).`
  }

  return {
    rows,
    totals,
    coverage,
    ceiling,
    honesty: {
      hasActual: totals.actual !== null,
      actualLabel: totals.actual === null
        ? 'Belum ada aktual — belum ada nota pembelian tercatat'
        : 'Aktual dari nota pembelian yang sudah diterima'
    }
  }
}

/**
 * ISI DRAWER RINGKAS untuk satu baris (spesifikasi t_a5ba5f73:
 * "compact detail drawer").
 *
 * Dipisah dari view supaya bisa diuji tanpa DOM, dan supaya isi drawer
 * memakai aturan kejujuran yang SAMA dengan tabel: angka yang tidak ada
 * tetap null (UI menulis "—"), dan tiap nilai membawa sumber asalnya.
 * Ini yang baca orang saat butuh tahu "angka ini dari mana".
 */
export function detailFor(row) {
  if (!row) return null
  const src = (label, value, present) => ({
    label,
    value,
    present,
    text: present
      ? String(value)
      : 'Tidak ada data — bukan nol, dan belum dihitung dari mana pun'
  })
  return {
    key: row.key,
    name: row.name,
    unit: row.unit ?? null,
    sources: [
      src('RAB (acuan)', row.rab, !row.rabMissing),
      src('RAP (rencana)', row.rap, !row.rapMissing),
      src('Aktual (nota)', row.actual, !row.actualMissing)
    ],
    diff: row.diff ?? null,
    diffText: row.diff === null || row.diff === undefined
      ? 'Belum bisa dihitung — butuh RAB dan RAP'
      : String(row.diff),
    diffStatus: row.diffStatus ?? null,
    // catatan apa adanya supaya pembaca tidak perlu menebak
    notes: []
      .concat(row.rabMissing ? ['Baris ini tidak ada di acuan RAB.'] : [])
      .concat(row.rapMissing ? ['Baris ini belum masuk RAP (belum direncanakan).'] : [])
      .concat(row.actualMissing ? ['Belum ada nota pembelian untuk baris ini — bukan berarti belanja nol.'] : [])
  }
}

/**
 * Ringkasan satu baris untuk tabel ringkas / ekspor CSV.
 * Selalu pakai "—" untuk yang tidak ada, jangan 0 (keputusan 6).
 */
export function formatCell(n) {
  return n === null || n === undefined ? '—' : String(n)
}

/**
 * Baris CSV. Kolom eksplisit supaya file bisa dibuka di Excel tanpa
 * tebak-tebak kolom, dan urutannya stabil.
 */
export function toCsv(comparison) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['Pekerjaan', 'Satuan', 'RAB (acuan)', 'RAP (rencana)', 'Aktual (nota)', 'Selisih RAP-RAB', 'Status']
  const body = comparison.rows.map(r => [
    r.name,
    r.unit ?? '',
    r.rab,
    r.rap,
    r.actual,
    r.diff,
    r.rabMissing && r.rapMissing && r.actualMissing ? 'tidak lengkap' : r.diffStatus
  ].map(esc).join(','))
  return [head.map(esc).join(','), ...body].join('\n')
}
