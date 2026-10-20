// ============================================================
// modules/receivings/receiptEventLogic.js — logika MURNI ledger penerimaan
// ============================================================
// TANPA React / TANPA query DB. Diuji VERBATIM oleh
// scripts/receiving-events-test (sandbox, tanpa DB).
//
// KONTRAK SEMANTIK QTY (WAJIB, lihat COMPATIBILITY_CUTOVER.md milik
// t_03b41644 — jangan diubah tanpa schema owner):
//   receiving_items.quantity_received = QTY BELI   (ditulis modul Pembelian)
//   receiving_items.qty_arrived       = QTY DATANG (Σ receiving_events.qty_datang,
//                                       penulis tunggal RPC receipt_apply_events)
//   receiving_items.qty_handed_over   = QTY DISERAHKAN (Σ handover_items)
// Tiga angka TERPISAH. Fungsi di file ini TIDAK PERNAH membaca
// `quantity_received` sebagai "sudah datang" — itu bug yang sudah terbukti
// (nota dibeli 10 tapi belum datang akan tampil diterima 10).
//
// Idempotensi deterministik:
//   client_event_id dibentuk dari (receiving, item, kumulatif-sebelum,
//   qty_datang) — submit ulang dengan isian SAMA menghasilkan id yang SAMA,
//   sehingga RPC `ON CONFLICT DO NOTHING` tidak menggandakan qty.
// ============================================================

export const RETUR_NONE = 'NONE'
export const RETUR_PENDING = 'PENDING'     // menunggu dikembalikan ke supplier
export const RETUR_DISCARDED = 'DISCARDED' // dibuang (butuh konfirmasi admin)

const EPS = 1e-9

const num = (v) => {
  if (v === '' || v === null || v === undefined) return 0
  const n = Number(v)
  return isFinite(n) ? n : NaN
}

// Idempotency key deterministik. TIDAK memakai waktu / Math.random supaya
// retry dengan isian sama tidak pernah membuat event kedua.
export function clientEventId(receivingId, itemId, prevCum, datang) {
  const p = Number(prevCum) || 0
  const d = Number(datang) || 0
  return `rcpt:${receivingId}:${itemId}:${p}->${p + d}`
}

// Terjemahan pilihan retur di form → status ledger.
// 'NANTI' = belum diputuskan (NONE, bukan PENDING: belum ada komitmen retur).
export function returStatusFromChoice(choice) {
  const c = String(choice || '').toUpperCase()
  if (c === 'SUPPLIER') return RETUR_PENDING
  if (c === 'DIBUANG') return RETUR_DISCARDED
  return RETUR_NONE
}

// ⚠️ DUPLIKAT yang sudah dihapus (defect run 199). Fungsi ini dulu menyalin
// aturan `receiptLogic.buildRows` dan menjadi SALINAN KEDUA yang bisa
// menyimpang: ia masih menghitung `sisa` dari qty pesanan PR (bukan qty BELI)
// dan tidak menandai baris yang belum dibeli. Sekarang satu sumber aturan:
// `receiptLogic.buildRows`. Ekspor dipertahankan supaya pemanggil lama tidak
// pecah, tetapi TIDAK boleh menyalin logika lagi.
export { buildRows } from './receiptLogic'

// State awal satu item di form.
export function emptyEntry() {
  return { datang: '', rusak: '0', ws: '', tukang: '', penerima: '', retur: 'NANTI', foto: null, konfirmasiBuang: false }
}

// Nilai terhitung satu item (tanpa validasi).
export function computeItem(row, entry) {
  const d = num(entry?.datang)
  const r = num(entry?.rusak)
  const ws = num(entry?.ws)
  const tk = num(entry?.tukang)
  const baik = (isFinite(d) && isFinite(r) && r <= d + EPS) ? d - r : NaN
  const datangN = isFinite(d) ? d : 0
  const belum = row.ordered === null ? null : Math.max(0, row.ordered - row.prevCum - datangN)
  const tujuan = (isFinite(ws) ? ws : 0) + (isFinite(tk) ? tk : 0)
  return { d, r, ws, tk, baik, belum, tujuan }
}

// Validasi satu item (mirror constraint DB supaya pesan jelas sebelum RPC).
export function validateItem(row, entry) {
  const c = computeItem(row, entry)
  const errs = {}
  const d = c.d
  const r = c.r
  if (!isFinite(d) || d < 0) errs.datang = 'Jumlah datang harus angka ≥ 0.'
  if (!isFinite(r) || r < 0) errs.rusak = 'Jumlah rusak harus angka ≥ 0.'
  if (!errs.datang && !errs.rusak && r > d + EPS) {
    errs.rusak = `Jumlah rusak tidak boleh lebih dari jumlah datang (${r} > ${d}).`
  }
  if (!errs.datang && row.sisa !== null && isFinite(d) && d > row.sisa + EPS) {
    errs.datang = `Melebihi sisa pesanan (sisa ${row.sisa}${row.unit ? ' ' + row.unit : ''}). Over-receipt belum diizinkan — periksa jumlah.`
  }
  if (!isFinite(c.ws) || c.ws < 0) errs.ws = 'Jumlah ke Workshop harus angka ≥ 0.'
  if (!isFinite(c.tk) || c.tk < 0) errs.tukang = 'Jumlah ke Tukang harus angka ≥ 0.'
  if (!errs.ws && !errs.tukang && isFinite(c.baik) && (c.ws + c.tk) > c.baik + EPS) {
    errs.tujuan = `Total tujuan (${c.ws + c.tk}) melebihi jumlah baik (${c.baik}).`
  }
  if (!errs.tukang && isFinite(c.tk) && c.tk > EPS && !String(entry?.penerima || '').trim()) {
    errs.penerima = 'Nama penerima tukang wajib diisi jika ada barang yang diserahkan ke Tukang.'
  }
  if (isFinite(r) && r > EPS) {
    const retur = entry?.retur || 'NANTI'
    if (!['NANTI', 'SUPPLIER', 'DIBUANG'].includes(retur)) {
      errs.retur = 'Pilihan penanganan barang rusak tidak dikenal.'
    }
    if (retur === 'DIBUANG' && !entry?.konfirmasiBuang) {
      errs.konfirmasiBuang = 'Centang konfirmasi bahwa barang benar-benar dibuang.'
    }
  }
  return { errors: errs, computed: c, valid: Object.keys(errs).length === 0 }
}

// Validasi SELURUH form.
export function validateForm(rows, entries) {
  const itemErrors = {}
  const globalErrors = []
  let hasQty = false
  for (const row of rows || []) {
    const entry = entries?.[row.id] || emptyEntry()
    const v = validateItem(row, entry)
    if (Object.keys(v.errors).length) itemErrors[row.id] = v.errors
    if (num(entry.datang) > EPS) hasQty = true
  }
  if (!hasQty) globalErrors.push('Isi minimal satu jumlah datang pada item yang benar-benar diterima.')
  return { itemErrors, globalErrors, valid: globalErrors.length === 0 && Object.keys(itemErrors).length === 0 }
}

// Satu event draft per item yang benar-benar menerima barang (datang > 0).
export function buildEventDrafts(rows, entries, { receivingId, createdBy = null } = {}) {
  const out = []
  for (const row of rows || []) {
    const e = entries?.[row.id] || {}
    const datang = num(e.datang)
    if (!isFinite(datang) || datang <= EPS) continue
    const rusakRaw = num(e.rusak)
    const rusak = isFinite(rusakRaw) ? rusakRaw : 0
    const wsRaw = num(e.ws)
    const tkRaw = num(e.tukang)
    const ws = isFinite(wsRaw) ? wsRaw : 0
    const tk = isFinite(tkRaw) ? tkRaw : 0
    const retur = returStatusFromChoice(e.retur)
    const baik = Math.max(0, datang - rusak)
    // Tidak ada barang rusak → tidak ada yang bisa diretur/dibuang. Status
    // retur dinormalkan ke NONE supaya event tidak pernah membawa
    // `retur_status PENDING/DISCARDED` dengan `retur_qty 0` (ditolak RPC
    // `retur_without_qty` — defect run 199). Pilihan dropdown tetap disimpan
    // di UI; yang dinormalkan hanya nilai yang tidak bermakna.
    const returEff = rusak > EPS ? retur : RETUR_NONE
    out.push({
      client_event_id: clientEventId(receivingId, row.id, row.prevCum, datang),
      receiving_item_id: row.id,
      pr_item_id: row.prItemId || null,
      item_name: row.item_name,
      unit: row.unit || null,
      qty_datang: datang,
      // rusak 0 pada input berarti "tidak ada rusak" (dinyatakan user) —
      // berbeda dengan data historis yang qty_rusak-nya NULL (tidak diketahui).
      qty_rusak: rusak,
      tujuan_ws: ws,
      tujuan_tukang: tk,
      penerima_tukang: tk > EPS ? String(e.penerima || '').trim() : null,
      retur_status: returEff,
      retur_qty: returEff === RETUR_NONE ? 0 : rusak,
      discard_confirmed: returEff === RETUR_DISCARDED ? !!e.konfirmasiBuang : false,
      // ⚠️ JANGAN mengarang referensi foto (defect run 206). `foto_ref` di
      // kontrak schema = path/ID arsip (Drive/Storage), BUKAN nama berkas di
      // perangkat admin. Sebelum ini yang dikirim hanya `file.name`
      // ("IMG_20261021_0912.jpg") — baris DB lalu tampak punya bukti foto
      // padahal berkasnya tidak pernah diunggah ke mana pun. Unggah berkas
      // belum aktif (lihat modules/receivings/attachments.js), jadi satu-
      // satunya nilai jujur adalah null sampai ada referensi nyata.
      foto_ref: e.foto && e.foto.ref ? String(e.foto.ref) : null,
      created_by: createdBy,
      _computed: { baik }
    })
  }
  return out
}

// Validasi draft terhadap aturan server (mirror constraint DB).
export function validateEventDrafts(drafts, { sisaById = {} } = {}) {
  const errors = []
  for (const d of drafts) {
    const tag = d.item_name || d.receiving_item_id
    const dq = num(d.qty_datang)
    const rq = d.qty_rusak === null ? null : num(d.qty_rusak)
    if (!isFinite(dq) || dq <= EPS) errors.push(`"${tag}": jumlah datang harus > 0.`)
    if (rq !== null && (!isFinite(rq) || rq < 0)) errors.push(`"${tag}": jumlah rusak tidak valid.`)
    if (rq !== null && isFinite(dq) && rq > dq + EPS) errors.push(`"${tag}": rusak (${rq}) tidak boleh lebih dari datang (${dq}).`)
    const baik = isFinite(dq) && rq !== null ? dq - rq : NaN
    const tujuan = num(d.tujuan_ws) + num(d.tujuan_tukang)
    if (isFinite(baik) && tujuan > baik + EPS) errors.push(`"${tag}": total tujuan (${tujuan}) melebihi jumlah baik (${baik}).`)
    if (num(d.tujuan_tukang) > EPS && !String(d.penerima_tukang || '').trim()) {
      errors.push(`"${tag}": nama penerima tukang wajib bila ada barang ke tukang.`)
    }
    if (d.retur_status === RETUR_DISCARDED && !d.discard_confirmed) {
      errors.push(`"${tag}": konfirmasi barang dibuang wajib dicentang.`)
    }
    // DEFECT run 199: RPC menolak `retur_status PENDING/DISCARDED` dengan
    // `retur_qty <= 0` (reason `retur_without_qty`). Validasi ini mencerminkan
    // aturan server supaya admin tidak menekan Simpan lalu pasti gagal.
    if (d.retur_status !== RETUR_NONE && (!isFinite(num(d.retur_qty)) || num(d.retur_qty) <= EPS)) {
      errors.push(`"${tag}": tidak ada jumlah rusak yang diisi, jadi tidak ada yang bisa diretur/dibuang.`)
    }
    if (d.retur_status !== RETUR_NONE && rq !== null && d.retur_qty !== rq) {
      errors.push(`"${tag}": qty retur harus sama dengan qty rusak.`)
    }
    const sisa = sisaById[d.receiving_item_id]
    if (sisa !== undefined && sisa !== null && isFinite(dq) && dq > sisa + EPS) {
      errors.push(`"${tag}": melebihi sisa pesanan (sisa ${sisa}).`)
    }
  }
  const ids = drafts.map(d => d.client_event_id)
  if (new Set(ids).size !== ids.length) errors.push('Ada dua baris dengan idempotency key sama — periksa isian ganda.')
  return { ok: errors.length === 0, errors }
}

// Agregat per item dari event yang tersimpan (sumber kebenaran tampilan).
export function eventTotals(events) {
  const byItem = new Map()
  for (const ev of events || []) {
    const key = ev.receiving_item_id || ev.id
    const cur = byItem.get(key) || {
      receiving_item_id: key, item_name: ev.item_name || '—', unit: ev.unit || '',
      datang: 0, rusak: 0, rusakUnknown: false, ws: 0, tukang: 0,
      returPending: 0, returDiscarded: 0, events: 0
    }
    cur.datang += num(ev.qty_datang) || 0
    if (ev.qty_rusak === null || ev.qty_rusak === undefined) cur.rusakUnknown = true
    else cur.rusak += num(ev.qty_rusak) || 0
    cur.ws += num(ev.tujuan_ws) || 0
    cur.tukang += num(ev.tujuan_tukang) || 0
    if (ev.retur_status === RETUR_PENDING) cur.returPending += num(ev.retur_qty) || 0
    if (ev.retur_status === RETUR_DISCARDED) cur.returDiscarded += num(ev.retur_qty) || 0
    cur.events += 1
    byItem.set(key, cur)
  }
  for (const v of byItem.values()) v.baik = Math.max(0, v.datang - v.rusak)
  return [...byItem.values()]
}

// Retur TANPA KETIK ULANG: baris retur diambil langsung dari event rusak yang
// BELUM pernah diretur.
//
// ⚠️ SALDO RETUR = `retur_qty`, BUKAN `qty_rusak` (defect run 190).
// Kontrak schema owner (DATA_DICTIONARY_v2 §B.4) menyebut `retur_qty` sebagai
// "saldo yang boleh diretur", dan RPC `return_create` MENOLAK event dengan
// `retur_qty <= 0` (reason `no_retur_balance`) walaupun `qty_rusak > 0`.
// Menawarkan `qty_rusak` membuat admin menekan Simpan lalu ditolak server.
//
// `retur_qty` 0 berarti "belum ada komitmen retur" (pilihan default
// 'Tentukan nanti' di form Terima Barang) — baris seperti itu TIDAK
// ditawarkan, tetapi dikembalikan di `blocked` supaya UI bisa menjelaskan
// apa yang harus dilakukan, bukan diam-diam menyembunyikan barang rusak.
//
// ANTI DOUBLE-RETUR: `alreadyReturned` = { [receiving_event_id]: qty } dari
// `return_lines`. Bila riwayat retur tidak bisa dibaca, form MENOLAK membuka
// (lihat returnForm.jsx) — bukan menganggap 0.
export function returPlan(events, { alreadyReturned = {} } = {}) {
  const lines = []
  const blocked = []
  for (const ev of events || []) {
    const rusak = num(ev.qty_rusak) || 0
    if (rusak <= EPS) continue
    // `retur_qty` absen (bentuk data lama / hasil backfill) → pakai qty_rusak
    // supaya data yang belum punya kolom itu tidak otomatis hilang. Nilai 0
    // TIDAK di-fallback: 0 adalah pernyataan "belum ada saldo retur".
    const punyaSaldo = ev.retur_qty !== undefined && ev.retur_qty !== null && ev.retur_qty !== ''
    const saldo = punyaSaldo ? (num(ev.retur_qty) || 0) : rusak
    const used = num(alreadyReturned[ev.id]) || 0
    if (saldo <= EPS) {
      blocked.push({
        receiving_event_id: ev.id,
        item_name: ev.item_name || '—',
        satuan: ev.unit || '',
        qty_rusak: rusak,
        retur_status: ev.retur_status || RETUR_NONE,
        reason: 'belum_ditandai_retur'
      })
      continue
    }
    const sisa = Math.max(0, saldo - used)
    if (sisa <= EPS) continue
    lines.push({
      receiving_event_id: ev.id,
      receiving_item_id: ev.receiving_item_id || null,
      pr_item_id: ev.pr_item_id || null,
      item_name: ev.item_name || '—',
      satuan: ev.unit || '',
      qty_rusak: rusak,
      qty_saldo: saldo,
      qty_sudah_retur: used,
      qty: sisa,
      retur_status: ev.retur_status || RETUR_NONE,
      discard_confirmed: !!ev.discard_confirmed,
      // Tindakan yang MASUK AKAL untuk baris ini (defect run 195).
      allowed_resolutions: allowedResolutionsFor(ev)
    })
  }
  return { lines, blocked }
}

// Tindakan retur yang boleh dipilih untuk SATU event.
//
// Kenapa dibatasi di UI, bukan hanya di server:
//   - `return_create` MENOLAK `DISCARD` bila event belum `discard_confirmed`
//     (reason `discard_not_confirmed`). Menampilkan "Dibuang" untuk barang
//     yang di form Terima Barang dipilih "Kembalikan ke supplier" membuat
//     admin menekan Simpan lalu PASTI gagal — persis pola defect run 190.
//   - Sebaliknya, barang yang sudah DIBUANG tidak mungkin dikembalikan ke
//     supplier; menawarkan RETURN/REPLACE/REFUND untuk event DISCARDED
//     menghasilkan kontradiksi (RPC bahkan mengubah statusnya jadi PENDING,
//     seolah barang yang sudah dibuang kembali menunggu dikembalikan).
// Batas ini harus sama dengan aturan RPC; kalau schema owner mengubah RPC,
// ubah di sini juga (dikunci probe_retur_resolution.mjs).
export function allowedResolutionsFor(ev) {
  const status = String(ev?.retur_status || RETUR_NONE).toUpperCase()
  // Barang yang sudah DIBUANG tidak mungkin dikembalikan/diganti/direfund.
  // Status DISCARDED tanpa `discard_confirmed` adalah data tidak konsisten
  // (RPC menolak DISCARD untuk itu) → TIDAK ada tindakan yang sah; UI
  // melaporkannya, bukan menawarkan aksi yang pasti gagal.
  if (status === RETUR_DISCARDED) return ev?.discard_confirmed ? ['DISCARD'] : []
  // Selain itu RPC mengizinkan RETURN/REPLACE/REFUND; DISCARD hanya bila event
  // memang sudah dikonfirmasi dibuang (`discard_confirmed`) — kalau tidak,
  // RPC menolak `discard_not_confirmed`.
  const out = ['RETURN', 'REPLACE', 'REFUND']
  if (ev?.discard_confirmed) out.push('DISCARD')
  return out
}

// Irisan tindakan yang boleh dipakai untuk SEMUA baris terpilih.
// Kosong = tidak ada satu tindakan pun yang sah untuk gabungan baris itu
// (mis. satu barang dibuang + satu menunggu dikembalikan) → UI harus meminta
// admin memisahkan prosesnya, bukan mengirim permintaan yang pasti ditolak.
export function commonResolutions(lines) {
  const list = Array.isArray(lines) ? lines.filter(Boolean) : []
  if (!list.length) return []
  let acc = null
  for (const l of list) {
    const allow = Array.isArray(l.allowed_resolutions) ? l.allowed_resolutions : allowedResolutionsFor(l)
    acc = acc === null ? [...allow] : acc.filter(r => allow.includes(r))
  }
  return acc || []
}


// Pembungkus kompatibel: hanya baris yang bisa disimpan.
export function returLinesFromEvents(events, { alreadyReturned = {} } = {}) {
  return returPlan(events, { alreadyReturned }).lines
}

// Prefill Handover: alokasi tukang dari event penerimaan dikurangi yang SUDAH
// diserahkan (handover_items). Penerima tinggal memverifikasi jumlah fisik.
export function handoverLinesFromEvents(events, delivered = {}) {
  const out = []
  for (const ev of events || []) {
    const alokasi = num(ev.tujuan_tukang) || 0
    if (alokasi <= EPS) continue
    const done = num(delivered[ev.id]) || 0
    const sisa = Math.max(0, alokasi - done)
    if (sisa <= EPS) continue
    out.push({
      receiving_event_id: ev.id,
      receiving_item_id: ev.receiving_item_id || null,
      pr_item_id: ev.pr_item_id || null,
      item_name: ev.item_name || '—',
      satuan: ev.unit || '',
      qty_alokasi: alokasi,
      qty_sudah_diserahkan: done,
      qty_diserahkan: sisa,      // prefill = sisa; user boleh koreksi ≤ sisa
      penerima: ev.penerima_tukang || ''
    })
  }
  return out
}

// Validasi konfirmasi fisik per baris.
//
// ⚠️ BARIS BOLEH DILEWATI (run 202). Sebelumnya qty kosong/0 = ERROR untuk
// SELURUH form, sehingga satu barang yang belum tiba memblokir pencatatan
// barang lain yang SUDAH diterima tukang. Itu bukan sekadar tidak nyaman:
// admin lalu menyerahkan semua baris "supaya bisa simpan", dan angka yang
// tidak benar masuk ke bukti serah terima.
//
// Sekarang:
//   - qty > 0  → baris DISERAHKAN (harus ≤ sisa alokasi, penerima wajib)
//   - qty kosong/0 → baris DILEWATI, dilaporkan di `skipped` (bukan error)
//   - minimal satu baris harus diserahkan
//
// Konsekuensi yang WAJIB dikatakan UI (bukan disembunyikan): RPC
// `handover_confirm` mengunci SATU dokumen (`diserahkan_at`). Baris yang
// dilewati / diserahkan sebagian TIDAK bisa ditambahkan ke dokumen yang sama
// setelah tersimpan — sisanya dicatat lewat dokumen Serah Terima BARU untuk
// penerimaan yang sama (skema mendukung: kuota dihitung per event lintas
// dokumen, dibuktikan probe_handover_partial.mjs H3).
export function validateHandoverLines(lines, prefill) {
  const ref = new Map((prefill || []).map(p => [p.receiving_event_id, p]))
  const errors = []
  const out = []
  const skipped = []
  for (const l of lines || []) {
    const p = ref.get(l.receiving_event_id)
    if (!p) { errors.push(`Baris "${l.item_name || l.receiving_event_id}" tidak berasal dari penerimaan ini.`); continue }
    const sisa = Math.max(0, p.qty_alokasi - p.qty_sudah_diserahkan)
    const raw = l.qty_diserahkan
    const kosong = raw === '' || raw === null || raw === undefined
    const q = num(raw)
    if (!isFinite(q)) { errors.push(`"${p.item_name}": jumlah diserahkan harus angka.`); continue }
    // Dilewati: tidak diisi atau diisi 0. Bukan error — dilaporkan sebagai sisa.
    if (kosong || q <= EPS) {
      if (sisa > EPS) {
        skipped.push({
          receiving_event_id: l.receiving_event_id,
          receiving_item_id: p.receiving_item_id,
          item_name: p.item_name,
          satuan: p.satuan,
          qty_sisa: sisa
        })
      }
      continue
    }
    if (q > sisa + EPS) { errors.push(`"${p.item_name}": melebihi sisa yang belum diserahkan (sisa ${sisa}${p.satuan ? ' ' + p.satuan : ''}).`); continue }
    const penerima = String(l.penerima || p.penerima || '').trim()
    if (!penerima) { errors.push(`"${p.item_name}": nama penerima wajib diisi.`); continue }
    out.push({
      receiving_event_id: l.receiving_event_id,
      receiving_item_id: p.receiving_item_id,
      pr_item_id: p.pr_item_id,
      item_name: p.item_name,
      satuan: p.satuan,
      qty_diserahkan: q,
      penerima,
      catatan: String(l.catatan || '').trim() || null
    })
    // Sebagian: sisa setelah baris ini juga harus dilaporkan supaya admin tahu
    // bahwa dokumen ini akan ditutup dengan kekurangan.
    if (sisa - q > EPS) {
      skipped.push({
        receiving_event_id: l.receiving_event_id,
        receiving_item_id: p.receiving_item_id,
        item_name: p.item_name,
        satuan: p.satuan,
        qty_sisa: sisa - q,
        partial: true
      })
    }
  }
  if (!out.length && !errors.length) {
    errors.push('Tidak ada baris yang diserahkan — isi minimal satu jumlah pada barang yang benar-benar diterima.')
  }
  const remainder = skipped.reduce((s, x) => s + (Number(x.qty_sisa) || 0), 0)
  return { ok: errors.length === 0, errors, lines: out, skipped, remainder }
}

// ------------------------------------------------------------------
// Pengelompokan per vendor (dipakai UI Pembelian).
// ------------------------------------------------------------------
// Satu nota toko TIDAK boleh memuat vendor lain. Fungsi ini hanya
// MENGELOMPOKKAN baris yang belum dibeli — tidak mengubah data tersimpan.
export function groupItemsByVendor(rows) {
  const groups = new Map()
  for (const it of rows || []) {
    const vid = it.vendorId || null
    const key = vid || '__TANPA_VENDOR__'
    let g = groups.get(key)
    if (!g) {
      g = { vendorId: vid, vendorName: it.vendorName || '', items: [], qty: 0 }
      groups.set(key, g)
    }
    g.items.push(it)
    g.qty += num(it.qty) || num(it.quantity) || 0
    if (!g.vendorName && it.vendorName) g.vendorName = it.vendorName
  }
  const list = [...groups.values()]
  // Vendor yang jelas lebih dulu; "belum ditentukan" paling akhir supaya
  // tidak tampak seperti nota pembelian nyata.
  list.sort((a, b) => {
    if (!a.vendorId && b.vendorId) return 1
    if (a.vendorId && !b.vendorId) return -1
    return String(a.vendorName).localeCompare(String(b.vendorName))
  })
  return list
}

// Rencana pembelian: satu nota per vendor, atau blokir bila ada barang yang
// vendornya belum ditentukan (tidak boleh menempelkan label vendor tebakan).
export function buildPurchaseGroups(rows) {
  const groups = groupItemsByVendor(rows)
  const tanpaVendor = groups.find(g => !g.vendorId)
  if (tanpaVendor) {
    return {
      ok: false,
      groups,
      reason: `${tanpaVendor.items.length} barang belum punya vendor (${tanpaVendor.items.map(it => it.itemName || it.item_name || '—').slice(0, 3).join(', ')}${tanpaVendor.items.length > 3 ? ', …' : ''}). Lengkapi vendor di PR dulu — nota tidak boleh diberi label vendor yang tidak tercatat pada barangnya.`
    }
  }
  return { ok: true, groups, needsSplit: groups.length >= 2, reason: '' }
}
