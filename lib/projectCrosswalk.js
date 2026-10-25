// ============================================================
// lib/projectCrosswalk.js — KONTRAK IDENTITAS PROYEK & ANGKA (Tahap A)
// ============================================================
// Sumber kebenaran audit: /home/ubuntu/agents/bamboo/purchasing-project-data-map/
//   (snapshot privat; tidak masuk git) + docs/project-cost/DATA_MAP.md.
//
// Modul ini MURNI: tanpa import, tanpa jaringan, tanpa DB, tanpa DOM.
// Tujuannya menyatukan cara membaca nomor proyek, satuan rupiah, dan arti
// hak upah/kasbon/pelunasan SEBELUM modul UI menyentuh data.
//
// ATURAN YANG DIKUNCI DI SINI (semua terbukti dari sumber, lihat DATA_MAP.md):
//   1. Relasi proyek memakai NOMOR (projects.kode -> projects.id).
//      Nama hanya kandidat review; tidak pernah menjadi relasi final.
//   2. Ambigu / nomor tidak dikenal / format aneh TIDAK dipilih otomatis dan
//      tidak diterbitkan nomor baru.
//   3. Angka kosong / "-" = tidak tercatat (null), BUKAN 0.
//   4. Satuan rupiah hanya dikonversi bila buktinya terdaftar di UNIT_CONTRACT.
//      Tidak ada perkalian 1000 berdasarkan dugaan.
//   5. total_upah = hak upah tercatat (basis biaya upah). Kasbon + pelunasan =
//      pembayaran atas hak yang sama -> tidak dijumlahkan lagi sebagai biaya.
//   6. Satu nota lintas proyek dialokasikan per item/qty, bukan total header.
//   7. Ringkasan agregat (PROJECT SUMMARY / cumulative) bukan event biaya baru.
// ============================================================

export const BLANK = 'blank'
export const NUMBER = 'number'
export const NON_PROJECT = 'non_project'
export const FORMAT_INVALID = 'format_invalid'

// Label baku supaya semua layar menulis hal yang sama.
export const STATE_LABEL = {
  matched: 'Cocok (nomor proyek)',
  ambiguous: 'Ambigu — perlu keputusan manusia',
  not_found: 'Nomor belum ada di master proyek',
  non_project: 'Bukan proyek (biaya operasional)',
  format_invalid: 'Format nomor tidak valid',
  blank: 'Tidak ada nomor/nama'
}

// ------------------------------------------------------------
// 1. NOMOR PROYEK
// ------------------------------------------------------------
// Menerima "83", 83, "083", " 83 ", "operasional ws", "", null.
// canonical = digit tanpa leading zero (dipakai untuk relasi).
// formatIssues = catatan kualitas sumber, TIDAK menghalangi match.
export function normalizeProjectNo(value) {
  const raw = value === null || value === undefined ? '' : String(value)
  const text = raw.trim()
  if (text === '') {
    return { raw, text: '', kind: BLANK, canonical: null, formatIssues: [] }
  }
  const formatIssues = []
  if (raw !== text) formatIssues.push('whitespace')
  if (typeof value === 'number') formatIssues.push('numeric_not_text')

  if (/^\d+$/.test(text)) {
    let canonical = text.replace(/^0+(?=\d)/, '')
    if (canonical === '' ) canonical = '0'
    if (canonical !== text) formatIssues.push('leading_zero')
    return { raw, text, kind: NUMBER, canonical, formatIssues }
  }
  const hasDigit = /\d/.test(text)
  if (!hasDigit) {
    return { raw, text, kind: NON_PROJECT, canonical: null, formatIssues }
  }
  // Ada angka tetapi bercampur teks (mis. "#83", "83a") -> JANGAN ditebak.
  return { raw, text, kind: FORMAT_INVALID, canonical: null, formatIssues: ['mixed_text'] }
}

// ------------------------------------------------------------
// 2. INDEX MASTER PROYEK (dari tabel projects)
// ------------------------------------------------------------
// projects: [{ id, name, status, kode, code }]
// Return: { byKode: Map<canonical, row[]>, byId: Map<id, row>, issues: [] }
export function buildProjectIndex(projects) {
  const byKode = new Map()
  const byId = new Map()
  const issues = []
  const list = []
  // REGRESI VERIFICATION_A #3: konflik identitas harus bisa DITANYAKAN oleh
  // resolver (fail closed), bukan hanya jadi catatan di daftar issues.
  const conflictsByKode = new Map()
  const conflictsById = new Map()
  const addConflict = (issue) => {
    issues.push(issue)
    if (issue.kode) {
      const a = conflictsByKode.get(issue.kode) || []
      a.push(issue)
      conflictsByKode.set(issue.kode, a)
    }
    const ids = issue.projectIds || (issue.projectId ? [issue.projectId] : [])
    for (const id of ids) {
      const b = conflictsById.get(id) || []
      b.push(issue)
      conflictsById.set(id, b)
    }
  }

  for (const p of projects || []) {
    if (!p || !p.id) continue
    list.push(p)
    byId.set(p.id, p)
    const k = normalizeProjectNo(p.kode)

    if (k.kind === BLANK) {
      addConflict({ type: 'missing_kode', projectId: p.id, name: p.name || null })
      continue
    }
    if (k.kind !== NUMBER) {
      addConflict({ type: 'unparseable_kode', projectId: p.id, raw: k.text })
      continue
    }
    // Konflik kode vs code (kolom legacy) harus dilaporkan, bukan dipilih diam-diam.
    const c = normalizeProjectNo(p.code)
    if (c.kind === NUMBER && c.canonical !== k.canonical) {
      addConflict({ type: 'kode_code_conflict', projectId: p.id, kode: k.canonical, code: c.canonical })
    }
    const arr = byKode.get(k.canonical) || []
    arr.push(p)
    byKode.set(k.canonical, arr)
  }

  for (const [kode, rows] of byKode.entries()) {
    if (rows.length > 1) {
      addConflict({ type: 'duplicate_kode', kode, projectIds: rows.map(r => r.id) })
    }
  }
  return { byKode, byId, issues, list, conflictsByKode, conflictsById }
}

// Daftar konflik identitas yang membuat relasi TIDAK boleh dipakai untuk
// menulis/menggabungkan biaya. `missing_kode` sengaja tidak dihitung: baris
// tanpa nomor memang tidak pernah matched lewat nomor.
export const IDENTITY_BLOCKING = Object.freeze([
  'kode_code_conflict',
  'duplicate_kode',
  'unparseable_kode'
])

export function identityConflictsFor({ index, kode, projectId }) {
  const out = []
  if (!index) return out
  const byKode = (kode && index.conflictsByKode && index.conflictsByKode.get(kode)) || []
  const byId = (projectId && index.conflictsById && index.conflictsById.get(projectId)) || []
  for (const issue of [...byKode, ...byId]) {
    if (!IDENTITY_BLOCKING.includes(issue.type)) continue
    if (!out.includes(issue)) out.push(issue)
  }
  return out
}

// ------------------------------------------------------------
// 3. INDEX ALIAS TERKONFIRMASI (kolom "Confirmed Aliases" di PROJECT MASTER)
// ------------------------------------------------------------
// aliasRows: [{ project_no, aliases: 'Baroni' | 'pangjay mabes, Mabes' }]
// Alias yang sah HANYA yang terdaftar di sumber. Bukan tebakan kemiripan.
export function buildAliasIndex(aliasRows) {
  const map = new Map()
  for (const row of aliasRows || []) {
    if (!row) continue
    const no = normalizeProjectNo(row.project_no)
    if (no.kind !== NUMBER) continue
    const parts = String(row.aliases || '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean)
    for (const a of parts) {
      const key = a.toLowerCase().replace(/\s+/g, ' ')
      const prev = map.get(key)
      if (!prev) {
        map.set(key, { projectNo: no.canonical, projectNos: [no.canonical], raw: a })
      } else if (!prev.projectNos.includes(no.canonical)) {
        prev.projectNos.push(no.canonical)
      }
    }
  }
  return map
}

// ------------------------------------------------------------
// 4. RESOLVER — nomor proyek sumber -> projects.id
// ------------------------------------------------------------
// sourceRow: { project_no, project_name }
// Urutan: nomor (final) -> alias terkonfirmasi (final bila tunggal) -> tidak ada.
// Nama mirip TIDAK dipakai di sini (lihat suggestCandidates).
export function resolveProject({ sourceRow, index, aliases, allowAlias = true }) {
  const no = normalizeProjectNo(sourceRow && sourceRow.project_no)
  const evidence = { method: 'none', projectNo: no.canonical, formatIssues: no.formatIssues.slice() }

  if (no.kind === NON_PROJECT) {
    return { state: 'non_project', projectId: null, kode: null, projectStatus: null,
      reason: 'baris biaya operasional/non-proyek', evidence }
  }
  if (no.kind === FORMAT_INVALID) {
    return { state: 'format_invalid', projectId: null, kode: null, projectStatus: null,
      reason: `nomor tidak bisa dibaca: ${no.text}`, evidence }
  }

  if (no.kind === NUMBER) {
    const rows = (index && index.byKode.get(no.canonical)) || []
    if (rows.length === 1) {
      const p = rows[0]
      // REGRESI VERIFICATION_A #3: identitas konflik (kode vs code) TIDAK
      // boleh matched untuk dipakai menulis/menggabungkan biaya. Fail closed.
      const conflicts = identityConflictsFor({ index, kode: no.canonical, projectId: p.id })
      if (conflicts.length) {
        return { state: 'identity_conflict', projectId: null, kode: no.canonical, projectStatus: null,
          candidates: [{ projectId: p.id, name: p.name, status: p.status }],
          conflicts,
          reason: 'identitas proyek konflik di master (kode vs code) — tahan untuk rekonsiliasi',
          evidence }
      }
      return { state: 'matched', projectId: p.id, kode: no.canonical,
        projectStatus: p.status || null, projectName: p.name || null,
        reason: 'nomor proyek cocok', evidence: { ...evidence, method: 'project_no' } }
    }
    if (rows.length > 1) {
      return { state: 'ambiguous', projectId: null, kode: no.canonical, projectStatus: null,
        candidates: rows.map(p => ({ projectId: p.id, name: p.name, status: p.status })),
        reason: 'nomor proyek dipakai lebih dari satu baris master', evidence }
    }
    return { state: 'not_found', projectId: null, kode: no.canonical, projectStatus: null,
      reason: 'nomor belum ada di master proyek (legacy?)', evidence }
  }

  // Tidak ada nomor -> hanya alias terkonfirmasi yang boleh menutup relasi.
  if (allowAlias && aliases && sourceRow && sourceRow.project_name) {
    const key = String(sourceRow.project_name).trim().toLowerCase().replace(/\s+/g, ' ')
    const hit = aliases.get(key)
    if (hit) {
      if (hit.projectNos.length > 1) {
        return { state: 'ambiguous', projectId: null, kode: null, projectStatus: null,
          candidates: hit.projectNos.map(k => ({ kode: k })), reason: 'alias menunjuk lebih dari satu nomor', evidence }
      }
      const rows = (index && index.byKode.get(hit.projectNo)) || []
      if (rows.length === 1) {
        const p = rows[0]
        const conflicts = identityConflictsFor({ index, kode: hit.projectNo, projectId: p.id })
        if (conflicts.length) {
          return { state: 'identity_conflict', projectId: null, kode: hit.projectNo, projectStatus: null,
            candidates: [{ projectId: p.id, name: p.name, status: p.status }],
            conflicts,
            reason: 'alias menunjuk nomor dengan identitas konflik — tahan untuk rekonsiliasi',
            evidence: { ...evidence, method: 'alias', alias: hit.raw } }
        }
        return { state: 'matched', projectId: p.id, kode: hit.projectNo,
          projectStatus: p.status || null, projectName: p.name || null,
          reason: 'alias terkonfirmasi di PROJECT MASTER',
          evidence: { ...evidence, method: 'alias', alias: hit.raw } }
      }
      return { state: 'not_found', projectId: null, kode: hit.projectNo, projectStatus: null,
        reason: 'alias menunjuk nomor yang belum ada di master proyek',
        evidence: { ...evidence, method: 'alias', alias: hit.raw } }
    }
  }

  return { state: 'not_found', projectId: null, kode: null, projectStatus: null,
    reason: 'tanpa nomor dan tanpa alias terkonfirmasi', evidence }
}

// ------------------------------------------------------------
// 5. KANDIDAT NAMA — untuk REVIEW MANUSIA saja
// ------------------------------------------------------------
// Tidak pernah mengembalikan state 'matched'. Tujuannya hanya membantu admin
// mengisi nomor/alias di sumber, bukan membuat relasi otomatis.
export function suggestCandidates(name, projects) {
  const norm = s => String(s || '')
    .toLowerCase()
    .replace(/^\s*(proyek|project)\s+/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const target = norm(name)
  if (!target) return []
  const targetTokens = new Set(target.split(' ').filter(Boolean))
  const out = []
  for (const p of projects || []) {
    if (!p || !p.id) continue
    const cand = norm(p.name)
    if (!cand) continue
    const candTokens = new Set(cand.split(' ').filter(Boolean))
    let shared = 0
    for (const tk of targetTokens) if (candTokens.has(tk)) shared += 1
    if (shared === 0) continue
    const score = shared / Math.max(targetTokens.size, candTokens.size)
    if (score >= 0.5) {
      out.push({ projectId: p.id, kode: p.kode ?? null, name: p.name, score: Number(score.toFixed(2)), reason: 'name_similarity' })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

// ------------------------------------------------------------
// 6. PARSER ANGKA SUMBER
// ------------------------------------------------------------
// Mengembalikan { raw, amount, format, ambiguous, blank } dan TIDAK pernah
// mengalikan 1000. Format yang didukung (terbukti ada di sumber):
//   'Rp 10,345,000'  -> 10345000 (id)
//   '15,000.76'      -> 15000.76 (us)
//   '15.000,76'      -> 15000.76 (id)
//   '(-Rp 9,500)'    -> -9500
//   '-' / ''         -> null (blank, bukan 0)
export function parseSourceAmount(value) {
  if (value === null || value === undefined) {
    return { raw: value, amount: null, format: 'blank', ambiguous: false, blank: true }
  }
  if (typeof value === 'number') {
    return { raw: value, amount: isFinite(value) ? value : null,
      format: isFinite(value) ? 'number' : 'unparseable', ambiguous: false, blank: false }
  }
  const raw = String(value)
  const text = raw.trim()
  if (text === '' || text === '-' || text === '–' || text === '—') {
    return { raw, amount: null, format: 'blank', ambiguous: false, blank: true }
  }
  const neg = text.startsWith('-') || text.startsWith('(') || text.includes('(-')
  const num = text.replace(/[^\d.,]/g, '')
  if (!num || !/\d/.test(num)) {
    return { raw, amount: null, format: 'unparseable', ambiguous: false, blank: false }
  }

  const lastDot = num.lastIndexOf('.')
  const lastComma = num.lastIndexOf(',')
  const dots = (num.match(/\./g) || []).length
  const commas = (num.match(/,/g) || []).length
  let amount = null
  let format = 'integer'
  let ambiguous = false

  const asDecimal = (sep) => {
    const head = num.slice(0, num.lastIndexOf(sep))
    const tail = num.slice(num.lastIndexOf(sep) + 1)
    const intPart = head.replace(/[.,]/g, '')
    const v = Number(intPart + '.' + tail)
    return isFinite(v) ? v : null
  }
  const stripAll = () => {
    const v = Number(num.replace(/[.,]/g, ''))
    return isFinite(v) ? v : null
  }

  if (dots && commas) {
    const decSep = lastDot > lastComma ? '.' : ','
    const tailLen = num.length - Math.max(lastDot, lastComma) - 1
    if (tailLen >= 1 && tailLen <= 2) {
      amount = asDecimal(decSep)
      format = decSep === ',' ? 'id' : 'us'
    } else {
      // Keduanya pemisah ribuan (jarang) -> perlakukan sebagai grup.
      amount = stripAll()
      format = 'id'
      ambiguous = true
    }
  } else if (dots || commas) {
    const sep = dots ? '.' : ','
    const parts = num.split(sep)
    if (parts.length > 2) {
      amount = stripAll()
      // '10,345,000' / '1.500.000' = grup ribuan -> konvensi rupiah.
      format = 'id'
    } else {
      const tailLen = parts[1].length
      if (tailLen === 3 && parts[0].length > 0) {
        // Satu pemisah + 3 digit: di data rupiah = ribuan, tetapi secara
        // literal bisa juga desimal (1.500 = 1,5). Tandai ambigu, JANGAN
        // menambah skala apa pun.
        amount = stripAll()
        format = 'id'
        ambiguous = true
      } else if (tailLen >= 1 && tailLen <= 2) {
        amount = Number(parts[0] + '.' + parts[1])
        format = sep === ',' ? 'id' : 'us'
        if (!isFinite(amount)) amount = null
      } else {
        amount = stripAll()
        format = 'id'
      }
    }
  } else {
    amount = Number(num)
    format = 'integer'
    if (!isFinite(amount)) amount = null
  }

  if (amount !== null && neg) amount = -amount
  return { raw, amount, format, ambiguous, blank: false, negative: neg }
}

// ------------------------------------------------------------
// 7. KONTRAK SATUAN (RUPIAH) — hanya yang berbukti
// ------------------------------------------------------------
// Setiap entri WAJIB punya evidence. Sumber yang tidak terdaftar tetap
// null (belum terverifikasi) — bukan dikali 1000.
export const UNIT_CONTRACT = {
  'upah_list_proyek.total_upah': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: [
      'Header tab List Proyek Pujon: "Total Upah (Rp)"',
      'Nilai identik dengan CLOSING B7 untuk proyek 83 (9,230,000) dan 61 (123,729,000)'
    ]
  },
  'upah_dashboard.hak_upah': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: [
      'Baris 4-5 tab Dashboard diformat mata uang (formatted value "Rp 10,345,000")',
      'Header Pujon: "TOTAL HAK UPAH PEKERJAAN (Rp)"'
    ]
  },
  'upah_dashboard.kasbon': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Header Dashboard "TOTAL KASBON DIAMBIL (Rp)" + nilai diformat Rp']
  },
  'upah_dashboard.pelunasan': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Header Dashboard "TOTAL PELUNASAN DIBAYAR (Rp)" + nilai diformat Rp']
  },
  'upah_rincian.total_proyek': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Header tab Rincian Upah: "Total Proyek (Rp)" (subtotal, bukan event biaya baru)']
  },
  'rekap_cost.cost_items.total_biaya': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Number format sel: CURRENCY [$Rp-421] #,##0 di tab COST ITEMS']
  },
  'rekap_cost.project_summary.cumulative_cost': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: [
      'Nilai diformat "Rp ..." di PROJECT SUMMARY',
      'Sama persis dengan SUM(COST ITEMS) per proyek pada 12 baris (selisih 0)'
    ]
  },
  'rekap_cost.petty_cash.nominal': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Nilai diformat "Rp ..." di tab PETTY CASH; cocok dengan CLOSING B6 proyek 99 (250,000)']
  },
  'closing.biaya_tukang': {
    scale: 1, currency: 'IDR', verified: true,
    evidence: ['Sel CLOSING sudah berformat Rp; nilai sama dengan hak upah sumber (83, 61)']
  }
}

// Konversi ke IDR dengan bukti. `alreadyIdr` mencegah konversi dua kali.
export function toIdr({ amount, sourceKey, alreadyIdr = false }) {
  const entry = UNIT_CONTRACT[sourceKey]
  const n = typeof amount === 'number' ? amount : parseSourceAmount(amount).amount
  if (n === null || !isFinite(n)) {
    return { idr: null, scale: null, reason: 'NO_AMOUNT', evidence: entry ? entry.evidence : [] }
  }
  if (alreadyIdr) {
    return { idr: n, scale: 1, reason: 'ALREADY_IDR', evidence: entry ? entry.evidence : [] }
  }
  if (!entry || entry.verified !== true) {
    return { idr: null, scale: null, reason: 'UNIT_UNVERIFIED', evidence: [] }
  }
  return { idr: n * entry.scale, scale: entry.scale, reason: 'VERIFIED', evidence: entry.evidence }
}

// ------------------------------------------------------------
// 8. UPAH: HAK vs PEMBAYARAN
// ------------------------------------------------------------
// Formula sumber (tab Dashboard, terbukti di formula sel):
//   SISA SALDO BERJALAN = hak - kasbon - pelunasan
// Basis biaya upah yang diakui = HAK (entitlement). Kasbon dan pelunasan
// adalah penyelesaian pembayaran atas hak yang sama -> bukan biaya tambahan.
export const SALDO_FORMULA = 'hak - kasbon - pelunasan'

function num(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const p = parseSourceAmount(v)
  return p.amount
}

export function laborSettlement({ hak, kasbon, pelunasan }) {
  const h = num(hak)
  const k = num(kasbon)
  const p = num(pelunasan)
  const known = [h, k, p].filter(x => x !== null).length
  const outstanding = (h !== null && k !== null && p !== null) ? h - k - p : null
  const paidToDate = (k === null && p === null) ? null : (k || 0) + (p || 0)
  const completeness = known === 3 ? 'complete' : (known === 0 ? 'empty' : 'partial')

  const components = [
    { field: 'hak', label: 'Hak upah tercatat', amount: h, countedAsSeparateCost: false, role: 'basis_biaya' },
    { field: 'kasbon', label: 'Kasbon diambil', amount: k, countedAsSeparateCost: false, role: 'pembayaran' },
    { field: 'pelunasan', label: 'Pelunasan dibayar', amount: p, countedAsSeparateCost: false, role: 'pembayaran' }
  ]

  return {
    entitlement: h,
    advances: k,
    settlements: p,
    costRecognized: h,
    paidToDate,
    outstanding,
    completeness,
    formula: SALDO_FORMULA,
    doubleCounted: false,
    components,
    reason: completeness === 'complete' ? null : 'sebagian angka belum tercatat di sumber'
  }
}

// Validator untuk formula saldo yang dipakai layar/aplikasi.
export function checkSaldoFormula({ hak, kasbon, pelunasan, saldo }) {
  const h = num(hak)
  const k = num(kasbon)
  const p = num(pelunasan)
  const s = num(saldo)
  if (h === null || k === null || p === null || s === null) {
    return { ok: false, expected: null, reason: 'angka belum lengkap' }
  }
  const expected = h - k - p
  return { ok: expected === s, expected, actual: s, formula: SALDO_FORMULA }
}

// ------------------------------------------------------------
// 9. ALOKASI NOTA LINTAS PROYEK
// ------------------------------------------------------------
// items: [{ project_no, qty, unitPrice, total }]
// Alokasi per item/qty. Total header tidak pernah ditempel ke semua proyek.
export function allocateNoteByItems({ headerTotal, items }) {
  const byProject = new Map()
  const issues = []
  let allocated = 0
  let unassigned = 0
  let unpriced = 0

  for (const it of items || []) {
    const q = num(it && it.qty)
    const up = num(it && it.unitPrice)
    let amount = num(it && it.total)
    if (amount === null) {
      if (q !== null && up !== null) amount = q * up
      else { unpriced += 1; issues.push({ type: 'unpriced_item', item: it }); continue }
    }
    const no = normalizeProjectNo(it && it.project_no)
    if (no.kind !== NUMBER) {
      unassigned += amount
      issues.push({ type: 'item_without_project', item: it, amount })
      continue
    }
    byProject.set(no.canonical, (byProject.get(no.canonical) || 0) + amount)
    allocated += amount
  }

  const head = num(headerTotal)
  const unallocated = head === null ? null : head - allocated
  if (unallocated !== null && unallocated !== 0) {
    issues.push({ type: 'unallocated_amount', amount: unallocated })
  }
  return {
    byProject,
    headerTotal: head,
    allocated,
    unallocated,
    unassigned,
    unpriced,
    balanced: unallocated === 0,
    issues
  }
}

// ------------------------------------------------------------
// 10. KUNCI EKSTERNAL & REKONSILIASI MATERIAL
// ------------------------------------------------------------
// Kunci per item (Cost ID) BERBEDA dari kunci per nota (Document/Purchase).
// Satu nota bisa punya banyak item — dedupe item tidak boleh memakai kunci nota.
export function costEventKey(value) {
  return String(value === null || value === undefined ? '' : value)
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}
// ⚠️ KANDIDAT, BUKAN IDENTITAS. Fungsi ini membuang tanda baca & huruf besar,
// jadi 'A-12' dan 'A1-2' menghasilkan kunci yang sama ('A12'). Regresi
// VERIFICATION_A #1: kunci ini TIDAK boleh dipakai sebagai identitas unik
// lintas kanal/vendor. Untuk keputusan duplikat pakai `noteIdentity()`.
export function costNoteKey(value) {
  return String(value === null || value === undefined ? '' : value)
    .toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Literal referensi apa adanya (hanya spasi tepi dibuang). Huruf besar/kecil,
// tanda hubung, garis miring, dan titik TIDAK dinormalisasi.
export function noteRefExact(value) {
  return String(value === null || value === undefined ? '' : value).trim()
}

// Identitas nota yang aman dipakai untuk keputusan duplikat:
//   namespace kanal + sumber + vendor + (purchaseId ATAU literal mentah).
// Dua nota dari vendor/kanal berbeda TIDAK pernah punya exactKey sama hanya
// karena nomornya mirip setelah tanda baca dibuang.
export function noteIdentity({ rawRef, channel, source, vendorId, purchaseId } = {}) {
  const raw = noteRefExact(rawRef)
  const ns = String(channel || 'unknown').trim().toLowerCase() || 'unknown'
  const src = String(source || '').trim().toLowerCase()
  const vendor = vendorId === null || vendorId === undefined ? '' : String(vendorId).trim()
  const pid = purchaseId === null || purchaseId === undefined ? '' : String(purchaseId).trim()
  const hasReference = raw.length > 0 || pid.length > 0
  return {
    ok: hasReference,
    raw,
    namespace: ns,
    source: src,
    vendorId: vendor,
    purchaseId: pid || null,
    exactKey: hasReference ? [ns, src, vendor, pid ? `PID:${pid}` : `REF:${raw}`].join('|') : null,
    fuzzyKey: raw ? costNoteKey(raw) : null,
    reason: hasReference ? null : 'NO_REFERENCE'
  }
}

// Kandidat duplikat lintas kanal — HANYA laporan, tidak pernah auto-merge.
//   same:'identity'  -> literal + namespace + vendor sama (boleh dianggap nota sama)
//   same:'fuzzy_only'-> literal BEDA setelah normalisasi (mis. A-12 vs A1-2):
//                       butuh bukti tambahan, jangan digabung.
export function noteCandidateMatches(a, b) {
  const ia = noteIdentity(a || {})
  const ib = noteIdentity(b || {})
  if (ia.ok && ib.ok && ia.exactKey === ib.exactKey) {
    return { candidate: true, same: 'identity', exactKey: ia.exactKey }
  }
  if (ia.fuzzyKey && ia.fuzzyKey === ib.fuzzyKey) {
    if (ia.raw === ib.raw) return { candidate: true, same: 'same_raw_different_namespace', raw: ia.raw }
    return {
      candidate: true,
      same: 'fuzzy_only',
      rawA: ia.raw,
      rawB: ib.raw,
      reason: 'literal berbeda hanya karena tanda baca/huruf besar — butuh bukti tambahan'
    }
  }
  return { candidate: false }
}

// Alokasi per proyek milik SATU nota aplikasi. Sumber boleh memberi
// `allocations` (rincian per proyek) atau hanya project_no+total.
function appNoteAllocations(n) {
  const out = []
  const push = (rawNo, amount) => {
    const no = normalizeProjectNo(rawNo)
    const v = num(amount)
    if (no.kind !== NUMBER || v === null) return
    out.push({ projectNo: no.canonical, amount: v })
  }
  if (Array.isArray(n && n.allocations)) {
    for (const a of n.allocations) push(a && (a.project_no ?? a.projectNo), a && (a.total ?? a.amount))
  } else if (n && n.project_no !== undefined && n.project_no !== null) {
    push(n.project_no, n.total)
  }
  return out
}

// appNotes:   [{ key|rawKey, channel?, source?, vendorId?, purchaseId?,
//               project_no?, total?, allocations?: [{project_no,total}] }]
// sheetItems: [{ cost_id, doc_ref, project_no, total }] -> baris COST ITEMS (event)
// summaryRows:[{ project_no, cumulative_cost }]        -> PROJECT SUMMARY (agregat)
//
// Aturan:
//   * event dihitung per IDENTITAS nota (literal + namespace), bukan per kunci
//     fuzzy. Nomor mirip dari vendor/kanal berbeda TIDAK digabung.
//   * SEMUA alokasi proyek dipertahankan; konflik ditandai, tidak ditelan
//     (regresi VERIFICATION_A #2).
//   * ringkasan agregat TIDAK menambah event.
export function reconcileCostSources({ appNotes, sheetItems, summaryRows } = {}) {
  const warnings = []
  const app = []
  for (const n of appNotes || []) {
    if (!n) continue
    const ident = noteIdentity({
      rawRef: n.rawKey !== undefined ? n.rawKey : n.key,
      channel: n.channel || 'admin',
      source: n.source || 'app',
      vendorId: n.vendorId !== undefined ? n.vendorId : n.vendor_id,
      purchaseId: n.purchaseId !== undefined ? n.purchaseId : n.purchase_id
    })
    if (!ident.ok) {
      warnings.push({ type: 'app_note_without_reference', note: n })
      continue
    }
    const allocations = appNoteAllocations(n)
    app.push({ raw: ident.raw, ident, row: n, allocations })
  }

  // Baris sheet dikelompokkan per LITERAL doc_ref (spasi tepi dibuang).
  const sheet = new Map()
  const notesWithoutKey = []
  for (const it of sheetItems || []) {
    const rawNote = noteRefExact(it && (it.doc_ref || it.note_key))
    let key = rawNote
    if (!key) {
      // Baris tanpa referensi nota TIDAK boleh hilang dari hitungan event:
      // pakai kunci per item, dan laporkan supaya bisa dilengkapi di sumber.
      const itemKey = costEventKey(it && it.cost_id)
      if (!itemKey) continue
      key = 'ITEM:' + itemKey
      notesWithoutKey.push(itemKey)
    }
    const prev = sheet.get(key) || { key, items: [], total: 0 }
    prev.items.push(it)
    prev.total += num(it && it.total) || 0
    sheet.set(key, prev)
  }

  const sheetByRaw = new Map()
  for (const [key, group] of sheet.entries()) {
    if (key.startsWith('ITEM:')) continue
    sheetByRaw.set(key, group)
  }

  const matchedPairs = []
  const onlyApp = []
  const usedSheet = new Set()
  for (const a of app) {
    const hit = sheetByRaw.get(a.raw)
    if (hit) {
      matchedPairs.push({ app: a, sheet: hit })
      usedSheet.add(a.raw)
    } else {
      onlyApp.push(a)
    }
  }
  const onlySheet = [...sheetByRaw.entries()].filter(([k]) => !usedSheet.has(k)).map(([, g]) => g)
  const itemGroups = [...sheet.entries()].filter(([k]) => k.startsWith('ITEM:')).map(([, g]) => g)

  // Kandidat fuzzy yang TIDAK boleh digabung otomatis.
  for (const a of onlyApp) {
    for (const [rawSheet] of sheetByRaw.entries()) {
      if (usedSheet.has(rawSheet)) continue
      const m = noteCandidateMatches(
        { rawRef: a.raw, channel: 'app' },
        { rawRef: rawSheet, channel: 'sheet' }
      )
      if (m.candidate && m.same === 'fuzzy_only') {
        warnings.push({
          type: 'fuzzy_ref_only',
          appRaw: a.raw,
          sheetRaw: rawSheet,
          message: 'referensi hanya mirip setelah tanda baca dibuang — tidak digabung tanpa bukti'
        })
      }
    }
  }
  // Dua nota aplikasi dengan literal berbeda tapi kunci fuzzy sama.
  const appByFuzzy = new Map()
  for (const a of app) {
    const fk = a.ident.fuzzyKey
    if (!fk) continue
    const arr = appByFuzzy.get(fk) || []
    arr.push(a)
    appByFuzzy.set(fk, arr)
  }
  for (const [fk, rows] of appByFuzzy.entries()) {
    const raws = [...new Set(rows.map(r => r.raw))]
    if (raws.length > 1) {
      warnings.push({
        type: 'note_key_collision',
        fuzzyKey: fk,
        raws,
        message: 'literal berbeda menghasilkan kandidat kunci sama — simpan sebagai nota terpisah'
      })
    }
    if (rows.length > 1 && raws.length === 1) {
      warnings.push({ type: 'duplicate_app_note', raw: raws[0], count: rows.length })
    }
  }

  const byProject = new Map()
  const add = (rawNo, amount) => {
    const no = normalizeProjectNo(rawNo)
    const v = num(amount)
    if (no.kind !== NUMBER || v === null) return
    byProject.set(no.canonical, (byProject.get(no.canonical) || 0) + v)
  }
  const addAllocations = (allocations) => {
    for (const a of allocations) add(a.projectNo, a.amount)
  }
  // Nota yang ada di app & sheet: pakai SATU sumber nilai saja. Rincian app
  // (kalau ada) diutamakan karena itu alokasi yang disengaja; kalau tidak,
  // pakai rincian item sheet. Peringatan bila keduanya berbeda.
  for (const { app: a, sheet: g } of matchedPairs) {
    if (a.allocations.length) {
      addAllocations(a.allocations)
      const appSum = a.allocations.reduce((s, x) => s + x.amount, 0)
      if (Math.round(appSum) !== Math.round(g.total)) {
        warnings.push({
          type: 'source_total_mismatch',
          raw: a.raw,
          appAllocated: appSum,
          sheetTotal: g.total,
          message: 'total alokasi app ≠ total sheet untuk nota yang sama (tidak dirapatkan)'
        })
      }
      // Alokasi proyek yang hanya muncul di sheet tetap dipertahankan.
      const appProjects = new Set(a.allocations.map(x => x.projectNo))
      const sheetOnly = new Map()
      for (const it of g.items) {
        const no = normalizeProjectNo(it && it.project_no)
        if (no.kind !== NUMBER || appProjects.has(no.canonical)) continue
        sheetOnly.set(no.canonical, (sheetOnly.get(no.canonical) || 0) + (num(it && it.total) || 0))
      }
      for (const [projectNo, amount] of sheetOnly.entries()) {
        add(projectNo, amount)
        warnings.push({
          type: 'allocation_only_in_sheet',
          raw: a.raw,
          projectNo,
          amount,
          message: 'alokasi proyek hanya ada di sheet — dipertahankan, tidak dibuang'
        })
      }
    } else {
      for (const it of g.items) add(it && it.project_no, num(it && it.total) || 0)
    }
  }
  for (const a of onlyApp) {
    if (a.allocations.length) {
      addAllocations(a.allocations)
      const headerTotal = num(a.row && a.row.total)
      const appSum = a.allocations.reduce((s, x) => s + x.amount, 0)
      if (headerTotal !== null && Math.round(headerTotal) !== Math.round(appSum)) {
        warnings.push({
          type: 'app_note_allocation_mismatch',
          raw: a.raw,
          headerTotal,
          allocated: appSum,
          message: 'total header nota ≠ jumlah alokasi proyek — semua alokasi tetap disimpan'
        })
      }
    } else if (a.row && a.row.project_no !== undefined && a.row.project_no !== null) {
      add(a.row.project_no, num(a.row.total))
    }
  }
  for (const g of onlySheet) {
    for (const it of g.items) add(it && it.project_no, num(it && it.total) || 0)
  }
  for (const g of itemGroups) {
    for (const it of g.items) add(it && it.project_no, num(it && it.total) || 0)
  }

  const summaryByProject = new Map()
  for (const r of summaryRows || []) {
    const no = normalizeProjectNo(r && r.project_no)
    if (no.kind !== NUMBER) continue
    summaryByProject.set(no.canonical, num(r && r.cumulative_cost))
  }
  let equal = 0
  for (const [no, total] of summaryByProject.entries()) {
    const ev = byProject.get(no)
    if (Math.round(ev || 0) === Math.round(total || 0)) equal += 1
  }
  if (summaryByProject.size > 0 && equal === summaryByProject.size) {
    warnings.push({ type: 'summary_equals_events',
      message: 'Ringkasan agregat sama dengan jumlah event — jangan tambahkan ringkasan sebagai biaya baru.' })
  }

  return {
    events: matchedPairs.length + onlyApp.length + onlySheet.length + itemGroups.length,
    matched: matchedPairs.map(p => p.app.raw).sort(),
    onlyApp: onlyApp.map(a => a.raw).sort(),
    onlySheet: onlySheet.map(g => g.key).sort(),
    notesWithoutKey,
    byProject,
    aggregateCountedAsEvent: false,
    warnings,
    perNote: { app, sheet }
  }
}
