// ============================================================
// public/upah-kasbon-sync.js — LAPISAN SYNC localStorage -> Supabase
// ============================================================
// Dimuat prototipe via <script src> biasa (bukan module) supaya bisa
// diuji langsung dari Node (require). Dual export:
//   Browser : window.UpahSync
//   Node    : module.exports
//
// Prinsip (keputusan DAT, 24 Okt 2026): Supabase = database master,
// TANPA sync Google Sheets. Klien Supabase DIINJEKSI dari parent
// (view.jsx menaruh window.__UPAH_SUPABASE__), jadi file ini:
//   - tidak menyimpan kredensial apa pun
//   - memakai sesi login yang sama dengan aplikasi (RLS admin-only)
//
// Murni & bisa diuji: planPersist / executeOps / stateFromDb /
// applyIdMap tidak menyentuh localStorage dan tidak membuat klien.
//
// TAUTAN MASTER PROJECT (25 Okt 2026):
//   upah_projects.project_id  <->  state.projects[].projectId
//   - `project_id` = RELASI utama ke public.projects(id) (UUID master).
//   - `project_name` / state.projects[].name = snapshot historis, TIDAK
//     dipakai untuk mencocokkan proyek.
//   - Data lama tanpa project_id -> projectId null = "Belum terhubung".
//     Tidak ada penebakan otomatis dari nama.
//   - Daftar pilihan dibaca read-only lewat fetchMasterProjects().
// ============================================================
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  root.UpahSync = api
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ---------- util ----------
  // STATUS PROYEK: DB memakai SELESAI/ON_GOING, sedangkan logic.js memakai
  // 'Selesai'/'On Going' (isProjectTotalable: status === 'Selesai'). Tanpa
  // normalisasi dua arah, semua proyek terbaca "belum selesai" -> checkbox
  // totalan mati dan Total Upah selalu Rp0.
  function statusToState(v) {
    const u = String(v || '').trim().toUpperCase()
    return (u === 'SELESAI' || u === 'DONE' || u === 'LUNAS' || u === 'ARSIP') ? 'Selesai' : 'On Going'
  }
  function statusToDb(v) {
    const s = String(v || '').trim().toLowerCase()
    return (s === 'selesai' || s === 'done' || s === 'lunas' || s === 'arsip') ? 'SELESAI' : 'ON_GOING'
  }
  function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
  function nOr(v) { const n = toNum(v); return n === null ? null : n }
  function clone(v) { return JSON.parse(JSON.stringify(v)) }
  function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) }

  // ---------- 1. BARIS DB -> STATE v2 ----------
  function stateFromDb(db) {
    db = db || {}
    const tukangById = {}
    // NAMA TUKANG: `nama` di DB bisa kosong / hanya spasi -> daftar tukang
    // tampil sebagai baris tanpa nama. Pakai `kode` sebagai fallback yang
    // manusiawi ("pujon" -> "Pujon"), dan "Tukang" bila kode juga kosong.
    // `key` TETAP `t.kode` apa adanya: itu identitas data untuk pencocokan
    // dataset lama <-> baru, jadi TIDAK di-trim dan TIDAK diubah.
    function displayName(t) {
      const nama = String(t.nama == null ? '' : t.nama).trim()
      if (nama) return nama
      const kode = String(t.kode == null ? '' : t.kode).trim()
      if (!kode) return 'Tukang'
      return kode.charAt(0).toUpperCase() + kode.slice(1)
    }
    const tukangs = (db.tukangs || []).map(t => {
      tukangById[t.id] = t
      return {
        key: t.kode, dbId: t.id, name: displayName(t), unit: t.unit_bisnis || 'Noir Living',
        projects: [], upahItems: [], kasbon: [], totalans: [], adjustments: [], projectOverrides: {},
        seq: 0, idCounter: 0
      }
    })
    const dsByTukangId = {}
    tukangs.forEach(d => { dsByTukangId[d.dbId] = d })

    const projName = {}, projStatus = {}
    ;(db.projects || []).forEach(p => {
      const d = dsByTukangId[p.tukang_id]; if (!d) return
      projName[p.id] = p.project_name
      projStatus[p.id] = p.status
      // projectId = RELASI ke master public.projects(id). `name` tetap snapshot
      // historis (project_name). Kolom project_id boleh belum ada (database
      // yang belum menjalankan migrasi draft) -> undefined -> null = "Belum
      // terhubung"; TIDAK ada penebakan dari nama.
      d.projects.push({ id: p.id, name: p.project_name, projectId: p.project_id || null, status: statusToState(p.status), arsipManual: p.arsip_manual === null ? undefined : !!p.arsip_manual, dbId: p.id })
      if (p.total_manual !== null && p.total_manual !== undefined) d.projectOverrides[p.id] = Number(p.total_manual)
      d.idCounter = Math.max(d.idCounter, 0)
    })
    ;(db.items || []).forEach(i => {
      const proj = (db.projects || []).find(p => p.id === i.project_id); if (!proj) return
      const d = dsByTukangId[proj.tukang_id]; if (!d) return
      d.upahItems.push({
        id: i.id, projectId: i.project_id, pekerjaan: i.pekerjaan, ukuran: i.ukuran,
        satuanUkuran: i.satuan_ukuran || '', hargaSatuan: i.harga_satuan,
        upahRincian: i.upah_rincian, catatan: i.catatan || ''
      })
    })
    ;(db.kasbon || []).forEach(k => {
      const d = dsByTukangId[k.tukang_id]; if (!d) return
      d.kasbon.push({ id: k.id, tanggal: k.tanggal, jenis: k.jenis === 'PELUNASAN' ? 'Pelunasan' : 'Kasbon', deskripsi: k.deskripsi || '', metode: k.metode || '', nominal: Number(k.nominal), bukti: k.bukti || '' })
    })
    const jpByTotalan = {}, jkByTotalan = {}
    ;(db.totalanProjects || []).forEach(j => { (jpByTotalan[j.totalan_id] = jpByTotalan[j.totalan_id] || []).push(j) })
    ;(db.totalanKasbon || []).forEach(j => { (jkByTotalan[j.totalan_id] = jkByTotalan[j.totalan_id] || []).push(j) })
    ;(db.totalans || []).forEach(t => {
      const d = dsByTukangId[t.tukang_id]; if (!d) return
      d.totalans.push({
        id: t.id, no: t.no_totalan, tanggal: t.tanggal, seq: t.seq || 0,
        projectIds: (jpByTotalan[t.id] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(j => j.project_id),
        pembayaranAktual: Number(t.pembayaran_aktual || 0),
        openingAdjustment: Number(t.opening_adjustment || 0),
        carriedResidual: Number(t.carried_residual || 0),
        residualBeforeCarry: t.residual_before_carry == null ? null : Number(t.residual_before_carry),
        kasbonIds: (jkByTotalan[t.id] || []).map(j => j.kasbon_id),
        // KUNCI HISTORIS (keputusan DAT 24 Okt 2026): totalan ber-`final` adalah
        // dokumen tutup buku — angkanya diambil apa adanya dari DB (hasil sheet),
        // tidak dihitung ulang dari kasbon/proyek yang bisa berubah.
        final: !!t.final,
        snapshot: t.final ? {
          total_upah: Number(t.total_upah || 0),
          kasbon_dipotong: Number(t.kasbon_dipotong || 0),
          hak_bersih: Number(t.hak_bersih || 0),
          saldo_akhir: Number(t.saldo_akhir || 0),
          status: t.status || null
        } : null
      })
      d.seq = Math.max(d.seq, t.seq || 0)
    })
    ;(db.adjustments || []).forEach(a => {
      const d=dsByTukangId[a.tukang_id]; if(d) d.adjustments.push(a)
    })
    if (!tukangs.length) {
      // RLS menolak / belum login / DB kosong -> dataset kosong, jangan crash
      tukangs.push({ key: 'asep', dbId: null, name: 'Asep', unit: 'Noir Living',
        projects: [], upahItems: [], kasbon: [], totalans: [], projectOverrides: {}, seq: 0, idCounter: 0 })
    }
    return { version: 2, activeKey: tukangs[0].key, tukangs }
  }

  // ---------- 2. PLAN: diff prev -> next = daftar operasi berurutan ----------
  // Urutan penting: parent dulu baru anak; hapus anak dulu baru parent.
  //   tukang -> project(ins/upd) -> item/kasbon(ins/upd) -> item/kasbon(del)
  //   -> project(del) -> totalan(ins/upd) -> junction -> totalan(del)
  // Op: {kind:'insert'|'update'|'delete', table, row?, id?, provId?}
  // FK field berakhiran '_id' di-resolve saat eksekusi (provisional -> UUID).
  const DS_TABLES = [
    { arr: 'projects', table: 'upah_projects' },
    { arr: 'upahItems', table: 'upah_items' },
    { arr: 'kasbon', table: 'upah_kasbon' },
    { arr: 'totalans', table: 'upah_totalan' }
  ]

  function rowProject(p, tukangId) {
    const row = {
      tukang_id: tukangId, project_name: p.name, status: statusToDb(p.status),
      arsip_manual: p.arsipManual === undefined ? null : !!p.arsipManual,
      total_manual: null, sort_order: 0
    }
    // project_id hanya dikirim bila ada tautan. Baris lama tanpa tautan tetap
    // bisa disimpan pada database yang belum menjalankan migrasi draft
    // (kolom project_id belum ada) — perilaku lama tidak berubah.
    if (p.projectId) row.project_id = p.projectId
    return row
  }
  function rowItem(u, projectId) {
    return {
      project_id: projectId, pekerjaan: u.pekerjaan, ukuran: nOr(u.ukuran),
      satuan_ukuran: u.satuanUkuran || null, harga_satuan: nOr(u.hargaSatuan),
      upah_rincian: nOr(u.upahRincian) || 0, catatan: u.catatan || null, sort_order: 0
    }
  }
  function rowKasbon(k, tukangId) {
    return {
      tukang_id: tukangId, tanggal: k.tanggal, jenis: k.jenis === 'Pelunasan' ? 'PELUNASAN' : 'KASBON',
      deskripsi: k.deskripsi || null, metode: k.metode || null,
      nominal: nOr(k.nominal) || 0, bukti: k.bukti || null, sort_order: 0
    }
  }
  function rowTotalan(t, tukangId, snap) {
    const s = snap || {}
    return {
      tukang_id: tukangId, no_totalan: t.no, tanggal: t.tanggal, seq: t.seq || 0,
      kasbon_dipotong: s.kasbon_dipotong || 0, total_upah: s.total_upah || 0,
      hak_bersih: s.hak_bersih || 0, pembayaran_aktual: nOr(t.pembayaranAktual) || 0,
      saldo_akhir: s.saldo_akhir || 0, status: s.status || null,
      opening_adjustment: Number(t.openingAdjustment || 0),
      carried_residual: Number(t.carriedResidual || 0),
      residual_before_carry: Number(t.residualBeforeCarry || 0)
    }
  }

  // Dokumen tutup buku bukan hanya tampilan read-only: validasi dilakukan di
  // seam diff->persist agar event langsung, DevTools, dan write tertunda semua
  // tetap gagal tertutup. Proyek/rincian/kasbon di luar final tetap editable.
  function assertFinalHistoryImmutable(prevState, nextState) {
    const nextByKey = {}
    ;((nextState && nextState.tukangs) || []).forEach(d => { nextByKey[d.key] = d })
    const projectFields = ['id', 'name', 'status', 'arsipManual', 'projectId']
    const itemFields = ['id', 'projectId', 'pekerjaan', 'ukuran', 'satuanUkuran', 'hargaSatuan', 'upahRincian', 'catatan']
    const kasbonFields = ['id', 'tanggal', 'jenis', 'deskripsi', 'metode', 'nominal', 'bukti']
    const totalanFields = ['id', 'no', 'tanggal', 'seq', 'projectIds', 'kasbonIds', 'pembayaranAktual', 'final', 'snapshot', 'openingAdjustment', 'carriedResidual', 'residualBeforeCarry']
    const sameRows = (before, after, fields) => {
      if (before.length !== after.length) return false
      const afterById = new Map(after.map(r => [r.id, r]))
      return before.every(r => {
        const n = afterById.get(r.id)
        return n && fields.every(k => same(r[k], n[k]))
      })
    }

    for (const pd of (prevState && prevState.tukangs) || []) {
      const finalRows = (pd.totalans || []).filter(t => t.final === true)
      if (!finalRows.length) continue
      const nd = nextByKey[pd.key]
      const fail = (label) => { throw new Error('Totalan final ' + label + ' — data historis terkunci dan tidak dapat diubah.') }
      if (!nd) fail('tidak boleh dihapus bersama tukang')
      const nextTotalans = nd.totalans || []
      const nextProjects = nd.projects || []
      const nextItems = nd.upahItems || []
      const nextKasbon = nd.kasbon || []
      const lockedProjects = new Set(), lockedKasbon = new Set()
      for (const t of finalRows) {
        const n = nextTotalans.find(x => x.id === t.id)
        if (!n || !totalanFields.every(k => same(t[k], n[k]))) fail((t.no || t.id) + ' tidak boleh diubah/dihapus')
        ;(t.projectIds || []).forEach(id => lockedProjects.add(id))
        ;(t.kasbonIds || []).forEach(id => lockedKasbon.add(id))
      }
      const oldProjects = (pd.projects || []).filter(p => lockedProjects.has(p.id))
      const newProjects = nextProjects.filter(p => lockedProjects.has(p.id))
      if (!sameRows(oldProjects, newProjects, projectFields)) fail('tidak boleh mengubah/menghapus proyek sumber')
      for (const id of lockedProjects) {
        const beforeHas = Object.prototype.hasOwnProperty.call(pd.projectOverrides || {}, id)
        const afterHas = Object.prototype.hasOwnProperty.call(nd.projectOverrides || {}, id)
        if (beforeHas !== afterHas || (beforeHas && !same(pd.projectOverrides[id], nd.projectOverrides[id]))) fail('tidak boleh mengubah total manual proyek sumber')
      }
      const oldItems = (pd.upahItems || []).filter(i => lockedProjects.has(i.projectId))
      const newItems = nextItems.filter(i => lockedProjects.has(i.projectId))
      if (!sameRows(oldItems, newItems, itemFields)) fail('tidak boleh mengubah/menambah/menghapus rincian upah proyek sumber')
      const oldKasbon = (pd.kasbon || []).filter(k => lockedKasbon.has(k.id))
      const newKasbon = nextKasbon.filter(k => lockedKasbon.has(k.id))
      if (!sameRows(oldKasbon, newKasbon, kasbonFields)) fail('tidak boleh mengubah/menghapus kasbon yang sudah dipotong')

      // Junction rows live in their own tables; protect membership too, not just
      // the totalan header and the project/kasbon source records.
      for (const t of finalRows) {
        const n = nextTotalans.find(x => x.id === t.id)
        if (!same(t.projectIds || [], n.projectIds || []) || !same(t.kasbonIds || [], n.kasbonIds || [])) {
          fail((t.no || t.id) + ' tidak boleh mengubah alokasi proyek/kasbon historis')
        }
      }
    }
  }

  function planPersist(prevState, nextState, opts) {
    if (same(prevState,nextState)) return []
    opts = opts || {}
    const snap = opts.snapshotTotalan || function () { return {} }
    assertFinalHistoryImmutable(prevState, nextState)
    const prevBy = {}
    ;((prevState && prevState.tukangs) || []).forEach(d => { prevBy[d.key] = d })
    const ops = []

    ;((nextState && nextState.tukangs) || []).forEach(nd => {
      const pd = prevBy[nd.key]
      if (pd && same(pd,nd)) return // Never rewrite another worker's accounting on a UI navigation.
      const tid = nd.dbId || (pd && pd.dbId)
      if (!pd) {
        // tukang baru (dbId akan terisi setelah insert via idMap)
        ops.push({ kind: 'insert', table: 'upah_tukang', row: { kode: nd.key, nama: nd.name, unit_bisnis: nd.unit || 'Noir Living', aktif: true }, provId: nd.key, provField: 'kode' })
      } else if (!same(nd.name, pd.name) || !same(nd.unit, pd.unit)) {
        ops.push({ kind: 'update', table: 'upah_tukang', row: { nama: nd.name, unit_bisnis: nd.unit || 'Noir Living' }, id: tid })
      }

      DS_TABLES.forEach(spec => {
        const prevArr = (pd && pd[spec.arr]) || []
        const nextArr = nd[spec.arr] || []
        const prevMap = {}; prevArr.forEach(r => { prevMap[r.id] = r })
        const nextMap = {}; nextArr.forEach(r => { nextMap[r.id] = r })

        // inserts + updates
        nextArr.forEach(r => {
          const o = prevMap[r.id]
          if (spec.table === 'upah_totalan' && o && o.final) return
          if (!o) {
            if (spec.table === 'upah_projects') ops.push({ kind: 'insert', table: spec.table, row: rowProject(r, tid), provId: r.id })
            else if (spec.table === 'upah_items') ops.push({ kind: 'insert', table: spec.table, row: rowItem(r, r.projectId), provId: r.id })
            else if (spec.table === 'upah_kasbon') ops.push({ kind: 'insert', table: spec.table, row: rowKasbon(r, tid), provId: r.id })
            else if (spec.table === 'upah_totalan') {
              ops.push({ kind: 'insert', table: spec.table, row: rowTotalan(r, tid, snap(r, nd)), provId: r.id })
              pushJunctions(ops, r, nd)
            }
          } else {
            let row = null
            if (spec.table === 'upah_projects') {
              row = rowProject(r, tid)
              row.total_manual = Object.prototype.hasOwnProperty.call(nd.projectOverrides || {}, r.id)
                ? nOr(nd.projectOverrides[r.id]) : null
              // Tautan dilepas secara eksplisit (ada -> kosong): tulis NULL.
              // Tanpa ini, rowProject menghilangkan project_id dan tautan lama
              // akan tetap tertinggal di database.
              if (o.projectId && !r.projectId) row.project_id = null
            } else if (spec.table === 'upah_items') row = rowItem(r, r.projectId)
            else if (spec.table === 'upah_kasbon') row = rowKasbon(r, tid)
            else if (spec.table === 'upah_totalan') {
              row = rowTotalan(r, tid, snap(r, nd))
              pushJunctions(ops, r, nd, true) // junction totalan di-rebuild
            }
            // FK yang masih berupa id SEMENTARA tidak boleh dibandingkan
            // (baru di-resolve saat executeOps). `upah_projects.project_id`
            // BUKAN id sementara — ia UUID master projects — jadi WAJIB
            // dibandingkan, kalau tidak perubahan tautan tidak pernah tersimpan.
            const changed = Object.keys(row).filter(k => !PROVISIONAL_FK.has(spec.table + ':' + k))
              .some(k => !same(row[k], mappedOld(spec.table, k, o, pd)))
            if (changed) ops.push({ kind: 'update', table: spec.table, row, id: r.id })
          }
        })

        // deletes (anak dulu baru parent di level luar)
        prevArr.forEach(r => {
          if (!nextMap[r.id]) ops.push({ kind: 'delete', table: spec.table, id: r.id })
        })
      })
    })

    // urutkan: gabungkan antar-dataset sesuai fase
    const phase = (o) => {
      switch (o.table) {
        case 'upah_tukang': return o.kind === 'delete' ? 9 : 0
        case 'upah_projects': return o.kind === 'delete' ? 8 : 1
        case 'upah_items': case 'upah_kasbon': return o.kind === 'delete' ? 7 : 2
        case 'upah_totalan': return o.kind === 'delete' ? 10 : 3
        default: return 4 // junction
      }
    }
    return ops.map((o, i) => [o, i])
      .sort((a, b) => (phase(a[0]) - phase(b[0])) || (a[1] - b[1]))
      .map(x => x[0])
  }

  function mappedOld(table, k, o, pd) {
    switch (table + ':' + k) {
      case 'upah_projects:project_name': return o.name
      // pembanding memakai nilai DB (row baru juga nilai DB) -> normalisasi ke DB
      case 'upah_projects:status': return statusToDb(o.status)
      case 'upah_projects:project_id': return o.projectId || null
      case 'upah_projects:arsip_manual': return o.arsipManual === undefined ? null : !!o.arsipManual
      case 'upah_projects:total_manual': return Object.prototype.hasOwnProperty.call((pd && pd.projectOverrides) || {}, o.id) ? nOr(pd.projectOverrides[o.id]) : null
      case 'upah_projects:sort_order': return 0
      case 'upah_items:pekerjaan': return o.pekerjaan
      case 'upah_items:ukuran': return nOr(o.ukuran)
      case 'upah_items:satuan_ukuran': return o.satuanUkuran || null
      case 'upah_items:harga_satuan': return nOr(o.hargaSatuan)
      case 'upah_items:upah_rincian': return nOr(o.upahRincian) || 0
      case 'upah_items:catatan': return o.catatan || null
      case 'upah_kasbon:tanggal': return o.tanggal
      case 'upah_kasbon:jenis': return o.jenis === 'Pelunasan' ? 'PELUNASAN' : 'KASBON'
      case 'upah_kasbon:deskripsi': return o.deskripsi || null
      case 'upah_kasbon:metode': return o.metode || null
      case 'upah_kasbon:nominal': return nOr(o.nominal) || 0
      case 'upah_kasbon:bukti': return o.bukti || null
      case 'upah_totalan:no_totalan': return o.no
      case 'upah_totalan:tanggal': return o.tanggal
      case 'upah_totalan:seq': return o.seq || 0
      case 'upah_totalan:pembayaran_aktual': return nOr(o.pembayaranAktual) || 0
      case 'upah_totalan:opening_adjustment': return Number(o.openingAdjustment || 0)
      case 'upah_totalan:carried_residual': return Number(o.carriedResidual || 0)
      case 'upah_totalan:residual_before_carry': return Number(o.residualBeforeCarry || 0)
      case 'upah_tukang:nama': return o.name
      case 'upah_tukang:unit_bisnis': return o.unit || 'Noir Living'
      default: return undefined // snapshot & FK tidak dibandingkan (snapshot dari callback)
    }
  }

  function pushJunctions(ops, totalan, dataset, isUpdate) {
    if (isUpdate) ops.push({ kind: 'deleteJunction', table: 'upah_totalan_projects', totalanProv: totalan.id })
    ;(totalan.projectIds || []).forEach((pid, i) => {
      const p = (dataset.projects || []).find(x => x.id === pid)
      ops.push({
        kind: 'insert', table: 'upah_totalan_projects',
        row: { totalan_id: totalan.id, project_id: pid, nama_snapshot: p ? p.name : null, total_upah: 0, sort_order: i }
      })
    })
    if (isUpdate) ops.push({ kind: 'deleteJunction', table: 'upah_totalan_kasbon', totalanProv: totalan.id })
    ;(totalan.kasbonIds || []).forEach(kid => {
      const k = (dataset.kasbon || []).find(x => x.id === kid)
      ops.push({ kind: 'insert', table: 'upah_totalan_kasbon', row: { totalan_id: totalan.id, kasbon_id: kid, nominal: k ? (nOr(k.nominal) || 0) : 0 } })
    })
  }

  // ---------- 3. EKSEKUSI operasi terhadap klien supabase ----------
  const FK = /_id$/
  // FK yang nilainya masih id SEMENTARA di state (proyek/tukang baru) dan baru
  // di-resolve lewat idMap saat eksekusi. Selain ini, kolom ber-akhiran _id
  // (mis. upah_projects.project_id -> master projects) berisi UUID asli dan
  // TIDAK boleh di-resolve/dibandingkan sebagai id sementara.
  const PROVISIONAL_FK = new Set([
    'upah_projects:tukang_id',
    'upah_items:project_id',
    'upah_kasbon:tukang_id',
    'upah_totalan:tukang_id'
  ])
  const MASTER_LINK = 'upah_projects:project_id'
  async function executeOps(ops, client, opts) {
    opts = opts || {}
    const idMap = opts.idMap || {}
    const resolve = opts.resolve || (id => idMap[id] || id)
    try {
      for (const op of ops) {
        const t = client.from(op.table)
        if (op.kind === 'insert') {
          const row = Object.assign({}, op.row)
          Object.keys(row).forEach(k => { if (FK.test(k) && (op.table + ':' + k) !== MASTER_LINK) row[k] = resolve(row[k]) })
          if (op.provId) {
            const { data, error } = await t.insert(row).select('id')
            if (error) return { ok: false, error, op }
            if (data && data[0] && data[0].id) idMap[op.provId] = data[0].id
          } else {
            const { error } = await t.insert(row)
            if (error) return { ok: false, error, op }
          }
        } else if (op.kind === 'update') {
          const row = Object.assign({}, op.row)
          Object.keys(row).forEach(k => { if (FK.test(k) && (op.table + ':' + k) !== MASTER_LINK) row[k] = resolve(row[k]) })
          const { error } = await t.update(row).eq('id', resolve(op.id))
          if (error) return { ok: false, error, op }
        } else if (op.kind === 'delete') {
          const { error } = await t.delete().eq('id', resolve(op.id))
          if (error) return { ok: false, error, op }
        } else if (op.kind === 'deleteJunction') {
          const { error } = await t.delete().in('totalan_id', [resolve(op.totalanProv)])
          if (error) return { ok: false, error, op }
        }
      }
      return { ok: true, idMap }
    } catch (e) { return { ok: false, error: e } }
  }

  // ---------- 4. UUID -> id sementara di state ----------
  function applyIdMap(dataset, idMap) {
    const rep = id => idMap[id] || id
    ;(dataset.projects || []).forEach(p => { p.id = rep(p.id) })
    ;(dataset.upahItems || []).forEach(u => { u.id = rep(u.id); u.projectId = rep(u.projectId) })
    ;(dataset.kasbon || []).forEach(k => { k.id = rep(k.id) })
    ;(dataset.totalans || []).forEach(t => {
      t.id = rep(t.id)
      t.projectIds = (t.projectIds || []).map(rep)
      t.kasbonIds = (t.kasbonIds || []).map(rep)
    })
    const po = {}
    Object.keys(dataset.projectOverrides || {}).forEach(k => { po[rep(k)] = dataset.projectOverrides[k] })
    dataset.projectOverrides = po
  }

  // ---------- 5. FETCH semua tabel (pemanggilan nyata via klien) ----------
  async function fetchAll(client) {
    const tables = ['upah_tukang', 'upah_projects', 'upah_items', 'upah_kasbon', 'upah_totalan', 'upah_totalan_projects', 'upah_totalan_kasbon', 'upah_penyesuaian']
    const results = await Promise.all(tables.map(t => client.from(t).select('*')))
    for (let i = 0; i < results.length; i++) {
      if (results[i].error) {
        const e = new Error((results[i].error.message || 'gagal membaca') + ' [' + tables[i] + ']')
        e.code = results[i].error.code
        throw e
      }
    }
    return {
      tukangs: results[0].data || [], projects: results[1].data || [], items: results[2].data || [],
      kasbon: results[3].data || [], totalans: results[4].data || [],
      totalanProjects: results[5].data || [], totalanKasbon: results[6].data || [], adjustments: results[7].data || []
    }
  }

  // ---------- 6. MASTER PROJECTS (read-only, untuk selector Project ID) ----------
  // Sumber: tabel `projects` milik aplikasi (bukan upah_*). Hanya membaca —
  // modul Upah & Kasbon TIDAK pernah menulis ke master Projects.
  // Gagal membaca (RLS/tabel belum ada) TIDAK melempar: modul tetap jalan dan
  // tautan lama ditampilkan apa adanya (fail-soft untuk daftar pilihan,
  // fail-closed untuk penyimpanan data modul).
  async function fetchMasterProjects(client) {
    if (!client || typeof client.from !== 'function') {
      return { ok: false, projects: [], error: new Error('klien database tidak tersedia') }
    }
    try {
      const { data, error } = await client.from('projects').select('*')
      if (error) return { ok: false, projects: [], error }
      const projects = (data || [])
        .filter(p => p && p.id)
        .map(p => ({
          id: p.id,
          kode: p.kode == null ? '' : String(p.kode),
          code: p.code == null ? '' : String(p.code),
          name: p.name == null ? '' : String(p.name),
          status: p.status == null ? '' : String(p.status)
        }))
      // urut nomor proyek (83 < 100), lalu kode teks, lalu nama
      projects.sort((a, b) => {
        const na = parseInt(a.kode, 10), nb = parseInt(b.kode, 10)
        if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
        const k = (a.kode || '').localeCompare(b.kode || '')
        return k !== 0 ? k : (a.name || '').localeCompare(b.name || '')
      })
      return { ok: true, projects, error: null }
    } catch (e) {
      return { ok: false, projects: [], error: e }
    }
  }

  return { stateFromDb, planPersist, executeOps, applyIdMap, fetchAll, fetchMasterProjects, statusToState, statusToDb, toNum, clone }
})
