// ============================================================
// modules/receivings/receiptEventLogic.js — logika MURNI ledger penerimaan
// ============================================================
// TANPA React / TANPA query DB. Diuji VERBATIM oleh
// scripts/receiving-events-test (sandbox, tanpa DB).
//
// Kontrak: docs/receiving-events-contract.md (t_7bc6246b). Ringkas:
//   satu baris `receiving_events` = satu kejadian terima untuk SATU item.
//   dimensi terpisah: datang ≠ rusak ≠ tujuan(ws/tukang) ≠ retur.
//   `receiving_items.quantity_received` = Σ qty_datang (dijaga RPC, bukan UI).
//
// Semua fungsi di sini deterministik supaya idempotensi bisa dibuktikan:
//   client_event_id dibentuk dari (receiving, item, kumulatif-sebelum,
//   qty_datang) — submit ulang dengan isian SAMA menghasilkan id yang SAMA,
//   sehingga RPC `ON CONFLICT DO NOTHING` tidak menggandakan qty.
// ============================================================

export const RETUR_NONE = 'NONE'
export const RETUR_PENDING = 'PENDING'     // menunggu dikembalikan ke supplier
export const RETUR_DISCARDED = 'DISCARDED' // dibuang (butuh konfirmasi)

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

// Terjemahan pilihan retur di form (receiptLogic) → status ledger.
// 'NANTI' = belum diputuskan (NONE, bukan PENDING: belum ada komitmen retur).
export function returStatusFromChoice(choice) {
  const c = String(choice || '').toUpperCase()
  if (c === 'SUPPLIER') return RETUR_PENDING
  if (c === 'DIBUANG') return RETUR_DISCARDED
  return RETUR_NONE
}

// Satu event draft per item yang benar-benar menerima barang (datang > 0).
// `rows` = hasil buildRows (receiptLogic), `entries` = state form.
// Baris yang datang 0 TIDAK menghasilkan event (tidak ada barang = tidak ada
// kejadian; jangan bikin baris nol yang mengaburkan histori).
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
    const baik = isFinite(datang) && isFinite(rusak) ? Math.max(0, datang - rusak) : NaN
    const draft = {
      client_event_id: clientEventId(receivingId, row.id, row.prevCum, datang),
      receiving_item_id: row.id,
      pr_item_id: row.prItemId || null,
      item_name: row.item_name,
      unit: row.unit || null,
      qty_datang: datang,
      // rusak 0 pada input berarti "tidak ada rusak" (dinyatakan user) —
      // berbeda dengan data historis yang qty_rusak-nya NULL (tidak diketahui).
      qty_rusak: isFinite(rusak) ? rusak : null,
      tujuan_ws: ws,
      tujuan_tukang: tk,
      penerima_tukang: tk > EPS ? String(e.penerima || '').trim() : null,
      retur_status: retur,
      retur_qty: retur === RETUR_NONE ? 0 : rusak,
      discard_confirmed: retur === RETUR_DISCARDED ? !!e.konfirmasiBuang : false,
      foto_ref: e.foto ? String(e.foto.nama || 'foto-lokal') : null,
      created_by: createdBy,
      _computed: { baik }
    }
    out.push(draft)
  }
  return out
}

// Validasi draft terhadap aturan server (mirror constraint DB) — dipakai
// sebelum memanggil RPC supaya pesan error jelas & tidak ada tulisan gagal
// setengah jalan. `sisa` = sisa pesanan item (ordered - sudah diterima).
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
// qty_rusak NULL (historis/tidak diketahui) dihitung 0 untuk aritmetika tapi
// ditandai `rusakUnknown` supaya UI tidak mengklaim "0 rusak".
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
// statusnya masih PENDING. qty & satuan ikut event; user hanya memilih aksi.
export function returLinesFromEvents(events, { alreadyReturned = {} } = {}) {
  const out = []
  for (const ev of events || []) {
    const rusak = num(ev.qty_rusak) || 0
    if (rusak <= EPS) continue
    const used = num(alreadyReturned[ev.id]) || 0
    const sisa = Math.max(0, rusak - used)
    if (sisa <= EPS) continue
    out.push({
      receiving_event_id: ev.id,
      receiving_item_id: ev.receiving_item_id || null,
      pr_item_id: ev.pr_item_id || null,
      item_name: ev.item_name || '—',
      satuan: ev.unit || '',
      qty_rusak: rusak,
      qty_sudah_retur: used,
      qty: sisa,
      retur_status: ev.retur_status || RETUR_NONE
    })
  }
  return out
}

// Prefill Handover: alokasi tukang dari event penerimaan dikurangi yang SUDAH
// diserahkan (handover_items). Penerima tinggal memverifikasi jumlah fisik —
// bukan mengetik ulang barang. `delivered` = { [receiving_event_id]: qty }.
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

// Validasi konfirmasi fisik: setiap baris ≤ sisa alokasi, qty > 0, penerima
// wajib bila qty > 0. Mengembalikan { ok, errors, lines }.
export function validateHandoverLines(lines, prefill) {
  const ref = new Map((prefill || []).map(p => [p.receiving_event_id, p]))
  const errors = []
  const out = []
  for (const l of lines || []) {
    const p = ref.get(l.receiving_event_id)
    const q = num(l.qty_diserahkan)
    if (!p) { errors.push(`Baris "${l.item_name || l.receiving_event_id}" tidak berasal dari penerimaan ini.`); continue }
    if (!isFinite(q) || q <= EPS) { errors.push(`"${p.item_name}": jumlah diserahkan harus > 0.`); continue }
    const sisa = Math.max(0, p.qty_alokasi - p.qty_sudah_diserahkan)
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
  }
  if (!out.length && !errors.length) errors.push('Tidak ada baris yang diserahkan — isi minimal satu jumlah.')
  return { ok: errors.length === 0, errors, lines: out }
}

// ------------------------------------------------------------------
// Pemecahan PR multi-vendor → pembelian per vendor/nota (tanpa skema baru).
// ------------------------------------------------------------------
// Satu PR bisa berisi barang dari beberapa vendor; satu nota vendor TIDAK
// boleh menampung vendor lain. Fungsi ini mengelompokkan item PR per vendor
// dan memberi label nota yang jelas + jejak ke PR asal.
// `vendorOf(prItem)` → id vendor atau null (belum ditentukan).
export function groupItemsByVendor(prItems, vendorOf) {
  const groups = new Map()
  for (const it of prItems || []) {
    const vid = (vendorOf ? vendorOf(it) : it.vendor_id) || null
    const key = vid || '__TANPA_VENDOR__'
    let g = groups.get(key)
    if (!g) {
      g = { vendorId: vid, items: [], qty: 0 }
      groups.set(key, g)
    }
    g.items.push(it)
    g.qty += num(it.quantity) || 0
  }
  const list = [...groups.values()]
  // Vendor yang jelas lebih dulu; "belum ditentukan" paling akhir supaya
  // tidak tampak seperti nota pembelian nyata.
  list.sort((a, b) => {
    if (!a.vendorId && b.vendorId) return 1
    if (a.vendorId && !b.vendorId) return -1
    return 0
  })
  return list
}

// Apakah nota perlu dipecah? Butuh ≥2 vendor nyata pada item-itemnya.
export function needsVendorSplit(vendorIds) {
  const real = [...new Set((vendorIds || []).filter(Boolean))]
  return real.length >= 2
}

// Alasan nota tidak boleh dipecah (histori sudah bergerak). Ditampilkan apa
// adanya — bukan disembunyikan.
export function splitBlockReason(receiving, items) {
  if (!receiving?.id) return 'Nota tidak dikenal.'
  if (receiving.masuk_gudang) return 'Barang nota ini sudah masuk stok gudang — pemecahan nota tidak boleh mengubah histori.'
  if (receiving.tukang_at || String(receiving.alokasi || '').toUpperCase() === 'KE_TUKANG') {
    return 'Nota ini sudah dialokasikan ke tukang — pemecahan nota tidak boleh mengubah histori serah terima.'
  }
  const received = (items || []).filter(it => num(it.quantity_received) > 0)
  if (received.length) {
    return 'Sudah ada jumlah diterima pada nota ini — pemecahan hanya untuk nota yang belum menerima barang (histori penerimaan tidak boleh dipindah).'
  }
  return ''
}
