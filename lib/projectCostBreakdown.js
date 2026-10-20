// ============================================================
// lib/projectCostBreakdown.js — BREAKDOWN COST PER PROYEK (Tahap B, t_da4a9ef8)
// ============================================================
// Satu modul murni (tanpa React/DB/jaringan) yang menyusun rincian biaya per
// proyek dari DATA YANG SUDAH ADA di aplikasi, memakai kontrak Tahap A:
//
//   * identitas proyek = NOMOR (projects.kode). Nama hanya alias terkonfirmasi.
//     Baris upah yang tidak punya nomor dan tidak punya alias konfirmasi TIDAK
//     dipinjamkan ke proyek bernama mirip — masuk ember "belum terhubung".
//   * MATERIAL = nota penerimaan (receivings) + barisnya (receiving_items).
//     Satu nota lintas proyek dialokasikan PER BARIS (qty x harga), bukan total
//     header ke semua proyek. Baris tanpa proyek masuk ember unassigned.
//   * UPAH = tukang_projects.total_upah (hak upah tercatat = basis biaya).
//     Kasbon/pelunasan adalah PEMBAYARAN atas hak yang sama: tidak dijumlahkan
//     sebagai biaya kedua. Pembayaran per proyek hanya bisa dilaporkan bila
//     sumbernya benar-benar membawa proyek; kalau tidak -> `payments.available
//     = false` + alasan, BUKAN 0.
//   * Nilai kosong = null (tidak tercatat), bukan 0.
//   * Ringkasan agregat (PROJECT SUMMARY) bukan event biaya baru: kalau
//     diberikan, ia hanya dipakai untuk MEMBANDINGKAN, tidak ditambahkan.
//
// Yang TIDAK dilakukan modul ini: revenue, rasio cost/revenue, margin final,
// atau perubahan aturan closing (masih HOLD sesuai BRIEF Tahap B).
// ============================================================
import {
  buildProjectIndex,
  buildAliasIndex,
  resolveProject,
  allocateNoteByItems,
  laborSettlement,
  parseSourceAmount,
  noteIdentity
} from './projectCrosswalk.js'
import { parseItemPrice, isPurchasedNota } from './purchaseNote.js'

const MATERIAL_ITEM_PREFIX = 'material_item:'

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  return parseSourceAmount(v).amount
}

// Harga satuan baris nota: penanda [Harga: n] yang ditulis modul Pembelian.
// Tidak ada penanda -> null (tidak dikarang dari total header).
function itemPrice(row) {
  const direct = toNum(row?.harga ?? row?.unit_price ?? row?.price)
  if (direct !== null) return direct
  const parsed = parseItemPrice(row?.note)
  return parsed === null || parsed === undefined ? null : toNum(parsed)
}

function projectNoOfId(projectsById, projectId) {
  if (!projectId) return null
  const p = projectsById.get(projectId)
  return p && p.kode !== null && p.kode !== undefined ? String(p.kode) : null
}

/**
 * buildCostBreakdown
 * @param {object} input
 * @param {Array}  input.projects        rows.projects (id, name, status, kode, code)
 * @param {Array}  input.laborRows       rows.tukang_projects
 * @param {Array}  input.receivings      rows.receivings
 * @param {Array}  input.receivingItems  rows.receiving_items
 * @param {Array}  input.vendors         rows.vendors
 * @param {Array}  input.summaryRows     rows.project_cost_summary (pembanding saja)
 * @param {Array}  input.aliasRows       baris alias terkonfirmasi (PROJECT MASTER)
 */
export function buildCostBreakdown({
  projects = [],
  laborRows = [],
  receivings = [],
  receivingItems = [],
  vendors = [],
  summaryRows = [],
  aliasRows = []
} = {}) {
  const index = buildProjectIndex(projects)
  const aliases = buildAliasIndex(aliasRows)
  const projectsById = new Map((projects || []).filter(p => p && p.id).map(p => [p.id, p]))
  const resolve = (sourceRow) => resolveProject({ sourceRow, index, aliases })

  const perProject = new Map()
  const ensure = (kode, extra = {}) => {
    const key = String(kode)
    if (!perProject.has(key)) {
      const p = (index.byKode.get(key) || [])[0] || null
      perProject.set(key, {
        kode: key,
        projectId: p ? p.id : null,
        name: p ? p.name : (extra.name || null),
        status: p ? (p.status || null) : null,
        material: { total: null, notes: [], items: 0, withoutPrice: 0 },
        labor: { entitlement: null, rows: 0, outstanding: null, completeness: 'empty', settlement: null },
        summaryCost: null,
        notes: []
      })
    }
    return perProject.get(key)
  }

  // ----------------------------------------------------------
  // 1) MATERIAL — per nota, per baris, per proyek
  // ----------------------------------------------------------
  const notesById = new Map()
  for (const r of receivings || []) {
    if (!r || !r.id) continue
    if (!isPurchasedNota(r)) continue
    notesById.set(String(r.id), r)
  }
  const vendorName = new Map((vendors || []).filter(v => v && v.id).map(v => [String(v.id), v.name || null]))

  const itemsByNote = new Map()
  const unassignedMaterial = { total: 0, items: 0, rows: [] }
  const noPriceItems = []
  for (const it of receivingItems || []) {
    if (!it) continue
    const noteId = it.receiving_id ? String(it.receiving_id) : null
    if (!noteId || !notesById.has(noteId)) continue
    const price = itemPrice(it)
    const qty = toNum(it.quantity_received)
    if (price === null || qty === null || qty <= 0) {
      noPriceItems.push({ noteId, item: it.item_name || null, qty, price })
      // Tetap dilaporkan per nota, tapi TIDAK dihitung sebagai biaya.
      const arr = itemsByNote.get(noteId) || []
      arr.push({ itemName: it.item_name || null, unit: it.unit || null, qty, price, subtotal: null, kode: null })
      itemsByNote.set(noteId, arr)
      continue
    }
    const subtotal = Math.round(qty * price)
    const note = notesById.get(noteId)
    // Proyek baris: project_id baris dulu, lalu project_id header notа.
    const kode = projectNoOfId(projectsById, it.project_id) || projectNoOfId(projectsById, note.project_id)
    const arr = itemsByNote.get(noteId) || []
    arr.push({
      itemName: it.item_name || null,
      unit: it.unit || null,
      qty,
      price,
      subtotal,
      kode: kode ? String(kode) : null
    })
    itemsByNote.set(noteId, arr)
    if (!kode) {
      unassignedMaterial.total += subtotal
      unassignedMaterial.items += 1
      unassignedMaterial.rows.push({ noteId, itemName: it.item_name || null, subtotal })
    }
  }

  for (const [noteId, rows] of itemsByNote.entries()) {
    const note = notesById.get(noteId)
    const priced = rows.filter(r => r.subtotal !== null)
    // Alokasi resmi memakai helper Tahap A (per item/qty, bukan total header).
    const allocation = allocateNoteByItems({
      headerTotal: priced.reduce((s, r) => s + r.subtotal, 0),
      items: priced.map(r => ({ project_no: r.kode, qty: r.qty, unitPrice: r.price, total: r.subtotal }))
    })
    const total = priced.reduce((s, r) => s + r.subtotal, 0)
    for (const [kode, amount] of allocation.byProject.entries()) {
      const proj = ensure(kode)
      proj.material.total = (proj.material.total || 0) + amount
      proj.material.items += priced.filter(r => r.kode === kode).length
      proj.material.notes.push({
        noteId,
        invoiceNo: note.invoice_no || null,
        vendorId: note.vendor_id || null,
        vendorName: vendorName.get(String(note.vendor_id)) || null,
        date: note.received_date || null,
        allocated: amount,
        noteTotal: total,
        itemCount: priced.filter(r => r.kode === kode).length,
        allocationKind: 'per_item',
        identityRaw: noteIdentity({ rawRef: note.invoice_no }).raw || null
      })
    }
    // Baris tanpa proyek sudah dicatat di ember `unassignedMaterial` pada loop
    // baris di atas (sekali saja). `allocation.unassigned` hanyalah konfirmasi
    // dari helper Tahap A — JANGAN ditambahkan lagi (itu menggandakan biaya).
  }
  for (const p of perProject.values()) {
    p.material.withoutPrice = noPriceItems.filter(x => p.material.notes.some(n => n.noteId === x.noteId)).length
  }

  // ----------------------------------------------------------
  // 2) UPAH — hak tercatat per proyek (nomor/alias terkonfirmasi)
  // ----------------------------------------------------------
  const unmappedLabor = { total: 0, rows: [], ambiguous: [], identityConflict: [] }
  for (const row of laborRows || []) {
    if (!row) continue
    const entitlement = toNum(row.total_upah)
    const sourceRow = {
      project_no: row.project_no !== undefined ? row.project_no : row.kode,
      project_name: row.project_name || row.project
    }
    const res = resolve(sourceRow)
    if (res.state === 'matched') {
      const proj = ensure(res.kode)
      proj.labor.rows += 1
      if (entitlement !== null) {
        proj.labor.entitlement = (proj.labor.entitlement || 0) + entitlement
      }
    } else if (res.state === 'non_project') {
      // Biaya operasional WS: bukan proyek, tidak dipaksakan masuk proyek.
      unmappedLabor.rows.push({ reason: 'non_project', label: sourceRow.project_name || sourceRow.project_no || null, amount: entitlement })
      if (entitlement !== null) unmappedLabor.total += entitlement
    } else {
      const bucket = res.state === 'ambiguous'
        ? 'ambiguous'
        : (res.state === 'identity_conflict' ? 'identityConflict' : 'rows')
      const entry = {
        reason: res.state,
        label: sourceRow.project_name || sourceRow.project_no || null,
        projectNo: res.kode || null,
        amount: entitlement
      }
      if (bucket === 'rows') {
        unmappedLabor.rows.push(entry)
        if (entitlement !== null) unmappedLabor.total += entitlement
      } else {
        unmappedLabor[bucket].push(entry)
      }
    }
  }

  // Settlement per proyek: hak vs kasbon/pelunasan. Sumber kasbon yang dipakai
  // di aplikasi bersifat per TUKANG (tukang_kasbon), bukan per proyek — jadi
  // di tingkat proyek pembayaran TIDAK dikarang: statusnya tidak tersedia.
  for (const proj of perProject.values()) {
    const s = laborSettlement({ hak: proj.labor.entitlement, kasbon: null, pelunasan: null })
    proj.labor.settlement = s
    proj.labor.outstanding = s.outstanding
    proj.labor.completeness = proj.labor.entitlement === null ? 'empty' : 'entitlement_only'
  }

  // ----------------------------------------------------------
  // 3) PEMBANDING agregat (PROJECT SUMMARY) — TIDAK ditambahkan
  // ----------------------------------------------------------
  for (const s of summaryRows || []) {
    const no = s && s.project_no !== undefined ? String(s.project_no).trim() : ''
    if (!no) continue
    const proj = perProject.get(no)
    if (proj) proj.summaryCost = toNum(s.cumulative_cost)
  }

  // ----------------------------------------------------------
  // 4) GAP yang harus terlihat di UI (bukan disembunyikan)
  // ----------------------------------------------------------
  const gaps = []
  if (unmappedLabor.rows.length) {
    gaps.push({
      code: 'labor_rows_without_project_number',
      count: unmappedLabor.rows.length,
      amount: unmappedLabor.total,
      message: 'Baris upah tanpa nomor/alias proyek terkonfirmasi — tidak dibebankan ke proyek mana pun.'
    })
  }
  if (unmappedLabor.ambiguous.length) {
    gaps.push({ code: 'labor_ambiguous', count: unmappedLabor.ambiguous.length, message: 'Nomor upah dipakai lebih dari satu proyek.' })
  }
  if (unmappedLabor.identityConflict.length) {
    gaps.push({ code: 'labor_identity_conflict', count: unmappedLabor.identityConflict.length, message: 'Identitas proyek konflik (kode vs code) — ditahan.' })
  }
  if (unassignedMaterial.total > 0) {
    gaps.push({
      code: 'material_unassigned',
      amount: unassignedMaterial.total,
      message: 'Baris nota tanpa proyek — tidak dibebankan ke proyek mana pun.'
    })
  }
  if (noPriceItems.length) {
    gaps.push({ code: 'material_without_price', count: noPriceItems.length, message: 'Baris nota tanpa harga/qty valid — tidak dihitung sebagai biaya.' })
  }
  if (index.issues.length) {
    gaps.push({ code: 'project_master_issues', count: index.issues.length, message: 'Master proyek punya baris tanpa nomor/duplikat/konflik.' })
  }
  gaps.push({
    code: 'labor_payments_not_per_project',
    message: 'Kasbon/pelunasan di sumber bersifat per tukang; alokasi pembayaran per proyek belum tersedia (null, bukan 0).'
  })
  gaps.push({
    code: 'revenue_ratio_hold',
    message: 'Revenue, rasio cost/revenue, dan margin final masih HOLD — tidak dihitung di breakdown ini.'
  })

  return {
    index,
    perProject,
    list: [...perProject.values()].sort((a, b) => String(a.kode).localeCompare(String(b.kode), 'id', { numeric: true })),
    unmappedLabor,
    unassignedMaterial,
    gaps,
    forProject(kode) {
      const key = kode === null || kode === undefined ? '' : String(kode).trim()
      return perProject.get(key) || null
    }
  }
}

export { MATERIAL_ITEM_PREFIX }
