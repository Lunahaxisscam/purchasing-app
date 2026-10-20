// ============================================================
// lib/bakpau/resolve.js — PETAKAN DRAFT → IDENTITAS MASTER
// ============================================================
// Tugas: mengubah draft mentah (evidence.js) menjadi baris yang SIAP
// divalidasi boundary pembelian, dengan identitas master yang NYATA:
//   * proyek  -> projects.id (lewat projects.kode atau nama, master existing)
//   * vendor  -> vendors.id
//   * satuan  -> satuan baku yang dikenal
//   * PR item -> pr_items.id (OPSIONAL per baris/alokasi)
//
// ATURAN ANTI-TEBAK (ditegakkan di sini, bukan di UI):
//   1. Nama proyek/toko dicocokkan EXACT (setelah normalisasi ringan: huruf
//      kecil, spasi rapat, tanda baca dibuang). TIDAK ada fuzzy/"mirip".
//      Nama yang mirip TIDAK PERNAH dipakai untuk memilih.
//   2. Lebih dari satu kandidat = AMBIGU -> klarifikasi (bukan pilih pertama).
//   3. Tidak ada kandidat = TIDAK DIKENAL -> klarifikasi (bukan proyek null
//      yang diam-diam masuk sebagai biaya tanpa proyek).
//   4. Satu nota boleh memuat BEBERAPA proyek/PR (alokasi per baris).
//   5. Qty alokasi dibatasi sisa kebutuhan bila baris menaut PR; sisa tetap
//      terbuka (tidak ditutup diam-diam).
// ============================================================

import { normalizeUnit } from './evidence.js'
import { REASON } from './constants.js'

// Normalisasi untuk PERBANDINGAN TAMPILAN saja. JANGAN dipakai sebagai
// identitas unik: 'A-12' dan 'A1-2' bisa bertabrakan pada skema longgar.
// Identitas (nomor nota, no PR, kode proyek) selalu dibandingkan LITERAL
// lewat `literalKey` di bawah, dan provenance/vendor namespace ikut disimpan.
export function normKey(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Identitas LITERAL: hanya trim + rapatkan spasi. Tanda baca & huruf besar
// DIPERTAHANKAN, sehingga 'A-12' !== 'A1-2'. Inilah kunci yang boleh dipakai
// untuk memutuskan "referensi yang sama", bukan normKey.
export function literalKey(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

// Apakah dua referensi literal sama? (case-insensitive HANYA untuk huruf,
// tanda baca tetap signifikan: 'A-12' vs 'a-12' sama; 'A-12' vs 'A1-2' beda.)
export function sameLiteralRef(a, b) {
  const x = literalKey(a).toLowerCase()
  const y = literalKey(b).toLowerCase()
  return !!x && x === y
}

// ------------------------------------------------------------
// INDEKS PROYEK + DETEKSI KONFLIK IDENTITAS (fail closed)
// ------------------------------------------------------------
// Temuan verifikasi A (VERIFICATION_A.md #3): master yang punya kode83 dan
// code99 yang bertabrakan TIDAK boleh tetap "matched". Resolver untuk jalur
// tulis harus MENOLAK, bukan memberi warning di indeks.
//
// Konflik yang dideteksi:
//   (a) dua proyek berbeda dengan kode (atau code) yang sama setelah
//       normalisasi -> seluruh referensi ke kode itu AMBIGU;
//   (b) satu proyek dengan `kode` dan `code` yang berbeda -> identitas proyek
//       itu sendiri tidak konsisten -> ditahan untuk rekonsiliasi.
export function buildProjectIndex(projects = []) {
  const conflicts = []
  const byKode = new Map() // key -> Set(projectId)
  const byName = new Map()
  const inconsistent = new Set()

  const add = (map, key, id) => {
    if (!key) return
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(String(id))
  }

  for (const p of (projects || [])) {
    const id = String(p?.id ?? '')
    if (!id) continue
    const kodeKey = normKey(p?.kode)
    const codeKey = normKey(p?.code)
    add(byKode, kodeKey, id)
    add(byKode, codeKey, id)
    add(byName, normKey(p?.name), id)
    if (kodeKey && codeKey && kodeKey !== codeKey) {
      inconsistent.add(id)
      conflicts.push({
        kind: 'project_identity_inconsistent',
        projectId: id,
        kode: String(p.kode || ''),
        code: String(p.code || ''),
        message: `Proyek ${String(p.kode || '')} punya kode="${String(p.kode || '')}" dan code="${String(p.code || '')}" yang berbeda.`
      })
    }
  }
  for (const [key, ids] of byKode.entries()) {
    if (ids.size > 1) {
      conflicts.push({
        kind: 'kode_code_conflict',
        key,
        projectIds: [...ids],
        message: `Kode proyek "${key}" dipakai oleh ${ids.size} proyek berbeda.`
      })
    }
  }
  return { byKode, byName, inconsistent, conflicts }
}


// Cari proyek berdasarkan kode ATAU nama. Return { ok, project } |
// { ok:false, reason, candidates }.
//
// FAIL CLOSED (temuan VERIFICATION_A.md #3):
//   * Bila kode yang dirujuk dipakai >1 proyek -> AMBIGU, tidak "matched".
//   * Bila proyek yang cocok punya kode/code tidak konsisten -> DITAHAN.
//   * Warning di indeks saja TIDAK cukup untuk jalur tulis.
export function resolveProject(ref, projects = []) {
  const key = normKey(ref)
  if (!key) return { ok: false, reason: REASON.PROJECT_MISSING, error: 'Referensi proyek kosong.' }

  const idx = buildProjectIndex(projects)

  // (1) Kode adalah identitas bisnis -> cek konflik lebih dulu.
  const kodeIds = idx.byKode.get(key)
  if (kodeIds && kodeIds.size > 1) {
    const cands = (projects || []).filter(p => kodeIds.has(String(p.id)))
    return {
      ok: false,
      reason: REASON.PROJECT_AMBIGUOUS,
      error: `Kode proyek "${ref}" dipakai oleh ${kodeIds.size} proyek berbeda (konflik identitas master) — ` +
        'ditahan untuk rekonsiliasi, tidak dipilih otomatis.',
      candidates: cands.map(p => ({ id: p.id, kode: p.kode || p.code || '', name: p.name || '' }))
    }
  }

  let pool = []
  if (kodeIds && kodeIds.size === 1) {
    pool = (projects || []).filter(p => String(p.id) === [...kodeIds][0])
  } else {
    const nameIds = idx.byName.get(key)
    if (nameIds && nameIds.size === 1) pool = (projects || []).filter(p => String(p.id) === [...nameIds][0])
    else if (nameIds && nameIds.size > 1) {
      const cands = (projects || []).filter(p => nameIds.has(String(p.id)))
      return {
        ok: false,
        reason: REASON.PROJECT_AMBIGUOUS,
        error: `Nama proyek "${ref}" cocok dengan ${cands.length} proyek — perlu dipilih manual.`,
        candidates: cands.map(p => ({ id: p.id, kode: p.kode || p.code || '', name: p.name || '' }))
      }
    }
  }

  if (!pool.length) {
    return { ok: false, reason: REASON.PROJECT_UNKNOWN, error: `Proyek "${ref}" tidak ada di master proyek.` }
  }
  const proj = pool[0]
  if (idx.inconsistent.has(String(proj.id))) {
    return {
      ok: false,
      reason: REASON.PROJECT_AMBIGUOUS,
      error: `Proyek "${ref}" punya kode="${String(proj.kode || '')}" dan code="${String(proj.code || '')}" yang berbeda — ` +
        'identitas proyek tidak konsisten, ditahan untuk rekonsiliasi.',
      candidates: [{ id: proj.id, kode: proj.kode || '', name: proj.name || '' }]
    }
  }
  return { ok: true, project: proj }
}

// Cari vendor berdasarkan nama. Exact setelah normalisasi.
export function resolveVendor(name, vendors = []) {
  const key = normKey(name)
  if (!key) return { ok: false, reason: REASON.VENDOR_MISSING, error: 'Nama toko/vendor kosong.' }
  const pool = (vendors || []).filter(v => normKey(v?.name) === key)
  const uniq = [...new Map(pool.map(v => [String(v.id), v])).values()]
  if (!uniq.length) {
    return { ok: false, reason: REASON.VENDOR_UNKNOWN, error: `Toko "${name}" tidak ada di master vendor.` }
  }
  if (uniq.length > 1) {
    return {
      ok: false,
      reason: REASON.VENDOR_UNKNOWN,
      error: `Toko "${name}" cocok dengan ${uniq.length} vendor — perlu dipilih manual.`,
      candidates: uniq.map(v => ({ id: v.id, name: v.name }))
    }
  }
  return { ok: true, vendor: uniq[0] }
}

// Sisa kebutuhan satu baris PR: qty PR − yang sudah dibeli (baris penerimaan).
export function remainingOfPrItem(prItemId, { prItems = [], receivingItems = [] } = {}) {
  const item = (prItems || []).find(it => String(it.id) === String(prItemId))
  if (!item) return null
  const bought = (receivingItems || [])
    .filter(ri => String(ri?.pr_item_id || '') === String(prItemId))
    .reduce((s, ri) => s + (Number(ri?.quantity_received) || 0), 0)
  const qty = Number(item.quantity)
  if (!isFinite(qty)) return null
  return { qtyPr: qty, bought, sisa: Math.max(0, qty - bought) }
}

// Cari baris PR kandidat untuk satu baris barang (OPSIONAL — tidak menaut
// apa pun bila tidak ada bukti yang cukup). Dipakai hanya bila pengirim
// menyebut `pr=<no PR>` eksplisit, atau bila tepat SATU baris PR dengan nama
// barang + satuan yang sama persis dan sisa > 0.
export function resolvePrItemFor(line, { requests = [], prItems = [], receivingItems = [] } = {}) {
  const byId = new Map((prItems || []).map(it => [String(it.id), it]))
  const reqById = new Map((requests || []).map(r => [String(r.id), r]))

  // (a) Referensi PR eksplisit: `pr=PR-2026-0007` -> cari baris di PR itu
  //     yang namanya cocok persis. Lebih dari satu baris cocok -> ambigu.
  if (line.prRef) {
    const reqKey = normKey(line.prRef)
    const req = (requests || []).find(r => normKey(r?.pr_number) === reqKey)
    if (!req) {
      return { ok: false, reason: 'pr_unknown', error: `PR "${line.prRef}" tidak ditemukan.` }
    }
    const inPr = (prItems || []).filter(it => String(it.pr_id) === String(req.id)
      && normKey(it.item_name) === normKey(line.itemName))
    if (!inPr.length) {
      return { ok: false, reason: 'pr_item_unknown', error: `Barang "${line.itemName}" tidak ada di PR ${req.pr_number}.` }
    }
    if (inPr.length > 1) {
      return { ok: false, reason: 'pr_item_ambiguous', error: `Barang "${line.itemName}" muncul ${inPr.length}× di PR ${req.pr_number}.` }
    }
    return { ok: true, prItem: byId.get(String(inPr[0].id)), pr: req, via: 'explicit_ref' }
  }

  // (b) Tanpa referensi eksplisit: JANGAN menaut apa pun. Pencocokan nama saja
  //     TIDAK membuktikan bahwa pembelian ini memenuhi kebutuhan PR itu —
  //     NOVI_BAKPAU_ACCEPTANCE #6: "jangan auto-block/auto-merge hanya karena
  //     proyek dan barang sama", #7: "jika referensi ambigu, tandai perlu
  //     rekonsiliasi, bukan tebak".
  //     Yang dikembalikan hanya KANDIDAT untuk ditampilkan ke manusia; tautan
  //     baru dibuat bila pengirim menulis `pr=<no PR>` eksplisit.
  const same = (prItems || []).filter(it => normKey(it.item_name) === normKey(line.itemName))
  const candidates = same
    .map(it => ({ prItem: it, pr: reqById.get(String(it.pr_id)) || null, rem: remainingOfPrItem(it.id, { prItems, receivingItems }) }))
    .filter(c => c.rem && c.rem.sisa > 0)
    .map(c => ({
      prItemId: c.prItem.id,
      prNumber: c.pr?.pr_number || '',
      projectId: c.pr?.project_id || null,
      qtyPr: c.rem.qtyPr,
      sisa: c.rem.sisa
    }))
  return { ok: true, prItem: null, pr: null, via: candidates.length ? 'candidates_only' : 'no_pr_match', candidates }
}

// ------------------------------------------------------------
// Resolusi satu draft penuh.
// ------------------------------------------------------------
// input: { draft, masters:{projects, vendors, materials, requests, prItems,
//          receivingItems} }
// output: { ok, status, reasons:[{code,message,line?}], lines:[…], header:{…} }
//
// Status awal: 'draft'. Bila ada masalah yang menghalangi penyimpanan yang
// jujur -> 'need_clarification' (BUKAN gagal teknis, BUKAN sukses).
// ------------------------------------------------------------
export function resolveDraft({ draft, masters = {} } = {}) {
  const reasons = []
  const push = (code, message, extra) => reasons.push({ code, message, ...(extra || {}) })

  const projects = masters.projects || []
  const vendors = masters.vendors || []

  // --- 1) Header ---
  let vendor = null
  if (!draft?.header?.vendorName) {
    push(REASON.VENDOR_MISSING, 'Nama toko/vendor belum ada di bukti — perlu dikonfirmasi.')
  } else {
    const rv = resolveVendor(draft.header.vendorName, vendors)
    if (!rv.ok) push(rv.reason, rv.error, rv.candidates ? { candidates: rv.candidates } : undefined)
    else vendor = rv.vendor
  }

  if (!draft?.header?.date) {
    push(REASON.DATE_MISSING,
      draft?.header?.dateRaw
        ? `Tanggal "${draft.header.dateRaw}" tidak bisa dibaca (pakai YYYY-MM-DD atau DD/MM/YYYY).`
        : 'Tanggal nota belum ada — tidak ditebak dari jam pesan.',
      draft?.header?.dateRaw ? { raw: draft.header.dateRaw } : undefined)
  }

  // Proyek default nota (opsional: boleh diisi per baris).
  let defaultProject = null
  if (draft?.header?.projectRef) {
    const rp = resolveProject(draft.header.projectRef, projects)
    if (!rp.ok) push(rp.reason, rp.error, rp.candidates ? { candidates: rp.candidates } : undefined)
    else defaultProject = rp.project
  }

  // --- 2) Baris barang ---
  if (!draft?.items?.length) {
    push(draft?.monetaryOnly ? REASON.MONETARY_ONLY : REASON.NO_ITEM_LINES,
      draft?.monetaryOnly
        ? 'Bukti hanya memuat nominal tanpa rincian barang — dicatat sebagai biaya tanpa mengarang qty/SKU.'
        : 'Belum ada baris barang yang bisa dibaca dari bukti.')
  }
  if (draft?.unparsedLines?.length) {
    push(REASON.UNPARSED_LINES,
      `${draft.unparsedLines.length} baris tidak bisa dibaca dan TIDAK diabaikan — perlu dikoreksi.`,
      { lines: draft.unparsedLines.slice(0, 10) })
  }

  const lines = []
  for (const [i, it] of (draft?.items || []).entries()) {
    const lineNo = i + 1
    const line = {
      lineNo,
      itemName: String(it.itemName || '').trim(),
      qty: Number(it.qty),
      unitRaw: String(it.unit || ''),
      unit: normalizeUnit(it.unit),
      harga: Number(it.harga),
      subtotal: Math.round(Number(it.qty) * Number(it.harga)),
      spec: String(it.spec || '').trim(),
      projectId: null,
      projectLabel: '',
      prItemId: null,
      prNumber: '',
      qtyPr: null,
      sisa: null,
      qtyCapped: false,
      specAwal: ''
    }

    if (!line.itemName) push(REASON.ITEM_INVALID, `Baris ${lineNo}: nama barang kosong.`, { line: lineNo })
    if (!isFinite(line.qty) || line.qty <= 0) push(REASON.ITEM_INVALID, `Baris ${lineNo}: qty harus > 0.`, { line: lineNo })
    if (!isFinite(line.harga) || line.harga <= 0) push(REASON.ITEM_INVALID, `Baris ${lineNo}: harga satuan harus > 0 (tidak ada harga 0/gratis).`, { line: lineNo })
    if (!line.unit) {
      push(REASON.UNIT_UNKNOWN, `Baris ${lineNo}: satuan "${line.unitRaw}" tidak dikenal — perlu dikonfirmasi.`, { line: lineNo })
    }

    // Proyek per baris menang atas proyek default nota.
    const refOfLine = String(it.projectRef || '').trim()
    if (refOfLine) {
      const rp = resolveProject(refOfLine, projects)
      if (!rp.ok) push(rp.reason, `Baris ${lineNo}: ${rp.error}`, { line: lineNo, ...(rp.candidates ? { candidates: rp.candidates } : {}) })
      else { line.projectId = rp.project.id; line.projectLabel = labelOf(rp.project) }
    } else if (defaultProject) {
      line.projectId = defaultProject.id
      line.projectLabel = labelOf(defaultProject)
    } else {
      push(REASON.PROJECT_MISSING, `Baris ${lineNo}: proyek belum ditentukan — tidak diisi otomatis.`, { line: lineNo })
    }

    // Tautan PR (opsional). Tidak pernah menebak: hanya dari `pr=` eksplisit.
    const rl = resolvePrItemFor({ ...it, itemName: line.itemName }, masters)
    line.prCandidates = rl.candidates || []
    if (!rl.ok) {
      push(REASON.ITEM_INVALID, `Baris ${lineNo}: ${rl.error}`, { line: lineNo })
    } else if (rl.prItem) {
      const rem = remainingOfPrItem(rl.prItem.id, masters)
      line.prItemId = rl.prItem.id
      line.prNumber = rl.pr?.pr_number || ''
      line.specAwal = String(rl.prItem.item_name || '') === line.itemName ? '' : ''
      if (rem) {
        line.qtyPr = rem.qtyPr
        line.sisa = rem.sisa
        // Cap alokasi: qty beli tidak boleh melebihi sisa kebutuhan baris PR.
        // Kelebihan TIDAK dibuang diam-diam dan TIDAK mengubah qty PR — baris
        // dilaporkan butuh klarifikasi alokasi (bisa jadi pembelian tambahan).
        if (line.qty > rem.sisa) {
          line.qtyCapped = true
          push(REASON.QTY_EXCEEDS_REMAINING,
            `Baris ${lineNo}: qty ${line.qty} melebihi sisa kebutuhan PR ${rl.pr?.pr_number || ''} (sisa ${rem.sisa}). ` +
            'Alokasi perlu dikonfirmasi — kebutuhan awal tidak ditimpa.',
            { line: lineNo, qty: line.qty, sisa: rem.sisa })
        }
      }
      if (!line.projectId) {
        const prProject = projects.find(p => String(p.id) === String(rl.pr?.project_id || ''))
        if (prProject) { line.projectId = prProject.id; line.projectLabel = labelOf(prProject) }
      }
    }

    lines.push(line)
  }

  // --- 3) Rekonsiliasi total tertulis vs rincian ---
  // Total nota yang tertulis di bukti HARUS cocok dengan rincian + ongkir −
  // diskon. Beda 1 rupiah pun dilaporkan (tidak dibulatkan diam-diam).
  const stated = draft?.header?.statedTotal
  const computed = Math.max(0, (draft?.material || 0) + (draft?.header?.biayaLain || 0) - (draft?.header?.diskon || 0))
  let totalMismatch = null
  if (stated !== null && stated !== undefined && isFinite(Number(stated))) {
    if (Math.round(Number(stated)) !== computed) {
      totalMismatch = { stated: Math.round(Number(stated)), computed }
      push(REASON.TOTAL_MISMATCH,
        `Total tertulis Rp ${fmt(stated)} berbeda dengan rincian Rp ${fmt(computed)} — perlu dikonfirmasi.`)
    }
  }

  const blocking = reasons.length > 0
  return {
    ok: !blocking,
    status: blocking ? 'need_clarification' : 'draft',
    reasons,
    lines,
    header: {
      vendorId: vendor?.id || null,
      vendorName: vendor?.name || String(draft?.header?.vendorName || ''),
      invoiceNo: String(draft?.header?.invoiceNo || '').trim(),
      date: draft?.header?.date || null,
      projectId: defaultProject?.id || null,
      biayaLain: draft?.header?.biayaLain || 0,
      diskon: draft?.header?.diskon || 0,
      catatan: String(draft?.header?.catatan || '').trim(),
      statedTotal: stated === null || stated === undefined ? null : Math.round(Number(stated)),
      computedTotal: computed,
      totalMismatch
    },
    material: draft?.material || 0,
    total: computed
  }
}

function labelOf(p) {
  if (!p) return ''
  return p.kode ? `[${p.kode}] ${p.name}` : String(p.name || '')
}

function fmt(n) {
  return new Intl.NumberFormat('id-ID').format(Math.round(Number(n) || 0))
}
