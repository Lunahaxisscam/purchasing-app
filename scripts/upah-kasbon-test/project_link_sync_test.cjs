// ============================================================
// scripts/upah-kasbon-test/project_link_sync_test.cjs
// Uji KONTRAK Project ID (tautan upah_projects.project_id -> master
// public.projects) pada lapisan sync. TANPA jaringan: klien di-mock.
//
// Yang dikunci di sini:
//   1) stateFromDb membaca project_id -> projectId (null = Belum terhubung)
//   2) planPersist MENULIS project_id saat tautan dipilih / dilepas
//   3) perubahan HANYA project_id tetap menghasilkan operasi update
//      (dulu semua kolom ber-akhiran _id dilewati dari perbandingan)
//   4) proyek tanpa tautan tetap bisa disimpan di DB yang belum migrasi
//   5) totalan final mengunci projectId (historis tidak bisa diubah)
//   6) project_id TIDAK di-resolve sebagai id sementara
//   7) fetchMasterProjects: urut kode, gagal baca = fail-soft
// ============================================================
const path = require('path')
const sync = require(path.join(__dirname, '..', '..', 'public', 'upah-kasbon-sync.js'))

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.error('  ✗ GAGAL: ' + msg) }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' — dapat ' + JSON.stringify(a).slice(0, 200) + ' harap ' + JSON.stringify(b).slice(0, 200))) }

function dbFixture(projectPatch) {
  return {
    tukangs: [{ id: 'TK-1', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living', aktif: true }],
    projects: [Object.assign({
      id: 'PR-1', tukang_id: 'TK-1', project_name: 'Proyek Josh - Mabes',
      project_id: null, status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 0
    }, projectPatch || {})],
    items: [], kasbon: [], totalans: [], totalanProjects: [], totalanKasbon: []
  }
}
function emptyDataset(extra) {
  return Object.assign({ key: 'asep', name: 'Asep', unit: 'Noir Living', dbId: 'TK-1', projects: [], upahItems: [], kasbon: [], totalans: [], projectOverrides: {}, seq: 0, idCounter: 0 }, extra || {})
}

async function main() {
  // ============================================================
  console.log('== 1. stateFromDb: project_id -> projectId ==')
  {
    const linked = sync.stateFromDb(dbFixture({ project_id: 'PRJ-83' }))
    eq(linked.tukangs[0].projects[0].projectId, 'PRJ-83', 'project_id terisi -> projectId')
    eq(linked.tukangs[0].projects[0].name, 'Proyek Josh - Mabes', 'project_name tetap snapshot historis (name)')

    const unlinked = sync.stateFromDb(dbFixture({ project_id: null }))
    eq(unlinked.tukangs[0].projects[0].projectId, null, 'project_id NULL -> projectId null (Belum terhubung)')

    const legacyDb = dbFixture()
    delete legacyDb.projects[0].project_id // database belum menjalankan migrasi draft
    const legacy = sync.stateFromDb(legacyDb)
    eq(legacy.tukangs[0].projects[0].projectId, null, 'kolom project_id belum ada -> null, tidak crash')

    // Nama yang PERSIS sama dengan proyek master TIDAK boleh membuat tautan.
    const sameName = sync.stateFromDb(dbFixture({ project_name: 'Josh - Mabes', project_id: null }))
    eq(sameName.tukangs[0].projects[0].projectId, null, 'nama sama dengan master TIDAK ditebak otomatis')
  }

  // ============================================================
  console.log('== 2. planPersist: pilih / lepas tautan tersimpan ==')
  {
    const prev = sync.stateFromDb(dbFixture({ project_id: null }))
    const next = sync.clone(prev)
    next.tukangs[0].projects[0].projectId = 'PRJ-83'
    const ops = sync.planPersist(prev, next, {})
    eq(ops.length, 1, 'hanya 1 operasi (update proyek)')
    eq(ops[0].kind, 'update', 'operasi = update')
    eq(ops[0].table, 'upah_projects', 'tabel = upah_projects')
    eq(ops[0].row.project_id, 'PRJ-83', 'row membawa project_id tautan baru')
    eq(ops[0].id, 'PR-1', 'update memakai id proyek upah')

    const linkedPrev = sync.stateFromDb(dbFixture({ project_id: 'PRJ-83' }))
    const cleared = sync.clone(linkedPrev)
    cleared.tukangs[0].projects[0].projectId = null
    const opsClear = sync.planPersist(linkedPrev, cleared, {})
    eq(opsClear.length, 1, 'melepas tautan = 1 operasi')
    eq(opsClear[0].row.project_id, null, 'tautan dilepas ditulis NULL (bukan dihilangkan)')
  }

  // ============================================================
  console.log('== 3. planPersist: proyek tanpa tautan tetap kompatibel ==')
  {
    const prev = sync.stateFromDb(dbFixture({ project_id: null }))
    const next = sync.clone(prev)
    next.tukangs[0].projects[0].name = 'Proyek Josh - Mabes (revisi)'
    const ops = sync.planPersist(prev, next, {})
    eq(ops.length, 1, 'ganti nama = 1 operasi')
    eq(Object.prototype.hasOwnProperty.call(ops[0].row, 'project_id'), false,
      'proyek tanpa tautan TIDAK mengirim project_id (aman untuk DB pra-migrasi)')

    const ins = sync.planPersist(
      { version: 2, activeKey: 'asep', tukangs: [emptyDataset()] },
      { version: 2, activeKey: 'asep', tukangs: [emptyDataset({ projects: [{ id: 'p-new', name: 'Proyek Baru', status: 'On Going', projectId: 'PRJ-99' }] })] },
      {}
    )
    const insert = ins.find(o => o.kind === 'insert' && o.table === 'upah_projects')
    ok(!!insert, 'proyek baru menghasilkan insert')
    eq(insert.row.project_id, 'PRJ-99', 'insert proyek baru membawa project_id')
  }

  // ============================================================
  console.log('== 4. totalan final mengunci projectId ==')
  {
    const db = dbFixture({ project_id: 'PRJ-83' })
    db.totalans = [{ id: 'TT-1', tukang_id: 'TK-1', no_totalan: 'TOT-001', tanggal: '2026-10-02', seq: 1, pembayaran_aktual: 0, final: true, total_upah: 0, kasbon_dipotong: 0, hak_bersih: 0, saldo_akhir: 0, status: 'Lunas' }]
    db.totalanProjects = [{ id: 'TP-1', totalan_id: 'TT-1', project_id: 'PR-1', nama_snapshot: 'Proyek Josh - Mabes', total_upah: 0, sort_order: 0 }]
    const prev = sync.stateFromDb(db)
    const next = sync.clone(prev)
    next.tukangs[0].projects[0].projectId = 'PRJ-99'
    let err = null
    try { sync.planPersist(prev, next, {}) } catch (e) { err = e }
    ok(!!err && /terkunci/i.test(err.message), 'ubah projectId proyek di totalan final DITOLAK')
  }

  // ============================================================
  console.log('== 5. executeOps: project_id bukan id sementara ==')
  {
    const calls = []
    const client = {
      from(table) {
        return {
          insert(row) {
            calls.push({ table, row })
            return { select: async () => ({ data: [{ id: 'UUID-PROYEK-BARU' }], error: null }) }
          }
        }
      }
    }
    const idMap = { 'TK-PROV': 'UUID-TUKANG', 'PRJ-83': 'HARUSNYA-TIDAK-DIPAKAI' }
    const res = await sync.executeOps([
      { kind: 'insert', table: 'upah_projects', provId: 'p-new', row: { tukang_id: 'TK-PROV', project_name: 'X', project_id: 'PRJ-83' } }
    ], client, { idMap })
    ok(res.ok, 'eksekusi insert sukses')
    eq(calls[0].row.tukang_id, 'UUID-TUKANG', 'tukang_id (FK sementara) di-resolve')
    eq(calls[0].row.project_id, 'PRJ-83', 'project_id (UUID master) TIDAK di-resolve lewat idMap')
  }

  // ============================================================
  console.log('== 6. fetchMasterProjects: daftar pilihan read-only ==')
  {
    const rows = [
      { id: 'PRJ-100', kode: '100', code: '100', name: 'Citizen East', status: 'DONE' },
      { id: 'PRJ-83', kode: '83', code: '83', name: 'Josh - Mabes', status: 'ON_GOING' },
      { id: 'PRJ-99', kode: '99', code: '99', name: 'Baroni', status: 'NOT_START' }
    ]
    const client = { from: () => ({ select: async () => ({ data: rows, error: null }) }) }
    const res = await sync.fetchMasterProjects(client)
    ok(res.ok, 'fetch master sukses')
    eq(res.projects.map(p => p.kode), ['83', '99', '100'], 'urut nomor proyek (bukan string)')
    eq(res.projects[0].name, 'Josh - Mabes', 'nama master ikut terbawa')
    eq(res.projects[0].status, 'ON_GOING', 'status master ikut terbawa')

    const bad = await sync.fetchMasterProjects({ from: () => ({ select: async () => ({ data: null, error: { message: 'permission denied', code: '42501' } }) }) })
    eq(bad.ok, false, 'gagal baca master = ok:false (fail-soft, modul tetap jalan)')
    eq(bad.error.message, 'permission denied', 'pesan error diteruskan untuk ditampilkan')

    const none = await sync.fetchMasterProjects(null)
    eq(none.ok, false, 'tanpa klien = ok:false, tidak melempar')
  }

  console.log('')
  console.log('HASIL: ' + passed + ' lulus, ' + failed + ' gagal')
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('CRASH: ' + (e && e.stack || e)); process.exit(1) })
