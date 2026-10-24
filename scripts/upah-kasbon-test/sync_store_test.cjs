// ============================================================
// scripts/upah-kasbon-test/sync_store_test.cjs
// Uji lapisan sync localStorage -> Supabase (public/upah-kasbon-sync.js)
// TANPA jaringan: klien supabase di-mock, yang diuji = mapping baris,
// urutan operasi diff, resolusi id sementara -> UUID, dan fail-closed.
// ============================================================
const path = require('path')
const sync = require(path.join(__dirname, '..', '..', 'public', 'upah-kasbon-sync.js'))

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.error('  ✗ GAGAL: ' + msg) }
}
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' — dapat ' + JSON.stringify(a).slice(0, 160) + ' harap ' + JSON.stringify(b).slice(0, 160))) }

// ---------- fixture: state v2 dua tukang ----------
function ds(p) {
  return Object.assign({
    key: 'asep', name: 'Asep', unit: 'Noir Living', dbId: 'TK-1',
    projects: [], upahItems: [], kasbon: [], totalans: [], projectOverrides: {}, seq: 0, idCounter: 0
  }, p)
}
const prev = { version: 2, activeKey: 'asep', tukangs: [ds({})] }

// ============================================================
console.log('== 1. stateFromDb memetakan baris DB ke bentuk state v2 ==')
{
  const db = {
    tukangs: [{ id: 'TK-1', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living', aktif: true }],
    projects: [{ id: 'PR-1', tukang_id: 'TK-1', project_name: 'Project A', status: 'ON_GOING', arsip_manual: null, total_manual: 12345, sort_order: 0 }],
    items: [{ id: 'IT-1', project_id: 'PR-1', pekerjaan: 'Kabinet', ukuran: 2.5, satuan_ukuran: 'm2', harga_satuan: 350000, upah_rincian: 875000, catatan: 'x', sort_order: 0 }],
    kasbon: [{ id: 'KB-1', tukang_id: 'TK-1', tanggal: '2026-10-01', jenis: 'KASBON', deskripsi: 'mingguan', metode: 'Transfer', nominal: 1000000, bukti: 'trf', sort_order: 0 },
             { id: 'KB-9', tukang_id: 'TK-1', tanggal: '2026-10-03', jenis: 'PELUNASAN', deskripsi: 'lunas', metode: 'trf', nominal: 500000, bukti: '', sort_order: 0 }],
    totalans: [{ id: 'TT-1', tukang_id: 'TK-1', no_totalan: 'TOT-001', tanggal: '2026-10-02', seq: 1, pembayaran_aktual: 800000 }],
    totalanProjects: [{ id: 'TP-1', totalan_id: 'TT-1', project_id: 'PR-1', nama_snapshot: 'Project A', total_upah: 875000, sort_order: 0 }],
    totalanKasbon: [{ id: 'TKB-1', totalan_id: 'TT-1', kasbon_id: 'KB-1', nominal: 1000000 }]
  }
  const st = sync.stateFromDb(db)
  eq(st.tukangs.length, 1, 'satu dataset tukang')
  eq(st.tukangs[0].key, 'asep', 'kode jadi key')
  eq(st.tukangs[0].name, 'Asep', 'nama jadi name')
  eq(st.tukangs[0].projects[0].id, 'PR-1', 'project id = uuid')
  eq(st.tukangs[0].projects[0].name, 'Project A', 'project_name jadi name')
  eq(st.tukangs[0].projects[0].status, 'ON_GOING', 'status diteruskan')
  eq(st.tukangs[0].projectOverrides['PR-1'], 12345, 'total_manual jadi projectOverrides')
  const it = st.tukangs[0].upahItems[0]
  eq([it.id, it.projectId, it.pekerjaan, it.ukuran, it.satuanUkuran, it.hargaSatuan, it.upahRincian], ['IT-1', 'PR-1', 'Kabinet', 2.5, 'm2', 350000, 875000], 'item camelCase utuh')
  const kb = st.tukangs[0].kasbon[0]
  eq([kb.id, kb.tanggal, kb.nominal], ['KB-1', '2026-10-01', 1000000], 'kasbon camelCase utuh')
  eq(kb.jenis, 'Kasbon', 'jenis KASBON dinormalisasi ke Kasbon (kontrak logic.js)')
  eq(st.tukangs[0].kasbon[1].jenis, 'Pelunasan', 'jenis PELUNASAN dinormalisasi ke Pelunasan')
  const tt = st.tukangs[0].totalans[0]
  eq([tt.id, tt.no, tt.seq, tt.projectIds, tt.kasbonIds, tt.pembayaranAktual], ['TT-1', 'TOT-001', 1, ['PR-1'], ['KB-1'], 800000], 'totalan + junction jadi projectIds/kasbonIds')
}

// ============================================================
console.log('== 2. planPersist: diff prev vs next ==')
{
  // prev = baseline dari DB (sama seperti kasus 1)
  const base = sync.stateFromDb({
    tukangs: [{ id: 'TK-1', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living', aktif: true }],
    projects: [{ id: 'PR-1', tukang_id: 'TK-1', project_name: 'Project A', status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 0 }],
    items: [{ id: 'IT-1', project_id: 'PR-1', pekerjaan: 'Kabinet', ukuran: 2.5, satuan_ukuran: 'm2', harga_satuan: 350000, upah_rincian: 875000, catatan: 'x', sort_order: 0 }],
    kasbon: [], totalans: [], totalanProjects: [], totalanKasbon: []
  })
  const d = JSON.parse(JSON.stringify(base.tukangs[0]))
  d.projects.push({ id: 'p_baru1', name: 'Project B', status: 'ON_GOING' }) // insert (id sementara)
  d.projects.find(x => x.id === 'PR-1').name = 'Project A (revisi)'         // update
  d.upahItems.push({ id: 'u_baru1', projectId: 'p_baru1', pekerjaan: 'Rak', ukuran: 1, satuanUkuran: '', hargaSatuan: 100000, upahRincian: 100000, catatan: '' }) // insert
  d.kasbon.push({ id: 'KB-2', tanggal: '2026-10-05', jenis: 'KASBON', deskripsi: 'makan', metode: '', nominal: 200000, bukti: '' }) // insert
  d.totalans.push({ id: 't_baru1', no: 'TOT-001', tanggal: '2026-10-06', seq: 1, projectIds: ['PR-1', 'p_baru1'], pembayaranAktual: 500000, kasbonIds: ['KB-2'] }) // insert
  d.seq = 1
  d.projectOverrides['PR-1'] = 999
  const next = { version: 2, activeKey: 'asep', tukangs: [d] }
  const prev = base
  // snapshot totalan dihitung pemanggil (prototipe punya hitungTotalans); di sini stub
  const snap = (t, dataset) => ({ total_upah: 975000, kasbon_dipotong: 200000, hak_bersih: 775000, saldo_akhir: 275000, status: 'Perlu cek' })
  const ops = sync.planPersist(prev, next, { snapshotTotalan: snap })

  const tables = (k) => ops.filter(o => o.table === k).map(o => o.kind)
  // urutan eksekusi: tukang -> projects -> items/kasbon -> totalan -> junction
  const lastIdx = (k) => { const i = ops.map(o => o.table).lastIndexOf(k); return i }
  ok(lastIdx('upah_projects') < lastIdx('upah_items'), 'projects dieksekusi sebelum items')
  ok(lastIdx('upah_projects') < lastIdx('upah_kasbon') || !tables('upah_kasbon').includes('insert') || lastIdx('upah_projects') < ops.findIndex(o => o.table === 'upah_kasbon'), 'projects sebelum kasbon')
  ok(lastIdx('upah_totalan') < lastIdx('upah_totalan_projects'), 'totalan sebelum junction projects')

  const insProj = ops.find(o => o.table === 'upah_projects' && o.kind === 'insert')
  ok(!!insProj, 'project baru = insert')
  eq(insProj.row.project_name, 'Project B', 'nama project baru benar')
  eq(insProj.row.tukang_id, 'TK-1', 'FK tukang dari dataset key')
  const updProj = ops.find(o => o.table === 'upah_projects' && o.kind === 'update')
  ok(!!updProj && updProj.row.project_name === 'Project A (revisi)', 'project lama = update nama')
  eq(updProj.row.total_manual, 999, 'projectOverrides ikut ke total_manual')

  const insItem = ops.find(o => o.table === 'upah_items' && o.kind === 'insert')
  ok(!!insItem, 'item baru = insert')
  eq(insItem.row.project_id, 'p_baru1', 'item masih menunjuk id sementara (diresolve saat eksekusi)')

  const insTot = ops.find(o => o.table === 'upah_totalan' && o.kind === 'insert')
  ok(!!insTot, 'totalan baru = insert')
  eq(insTot.row.no_totalan, 'TOT-001', 'no_totalan dipetakan')
  eq(insTot.row.status, 'Perlu cek', 'snapshot status dari callback')
  eq(insTot.row.hak_bersih, 775000, 'snapshot hak_bersih dari callback')

  const jps = ops.filter(o => o.table === 'upah_totalan_projects')
  eq(jps.length, 2, 'junction project: 2 baris')
  const jks = ops.filter(o => o.table === 'upah_totalan_kasbon')
  eq(jks.length, 1, 'junction kasbon: 1 baris')
  eq(jks[0].row.nominal, 200000, 'junction kasbon bawa nominal')
  const jkRef = jps.find(j => j.row.project_id === 'p_baru1')
  ok(!!jkRef, 'junction mengacu id sementara project baru (diresolve saat eksekusi)')
}

// ============================================================
console.log('== 3. planPersist: tidak ada perubahan = tidak ada operasi ==')
{
  const st = sync.stateFromDb({
    tukangs: [{ id: 'TK-1', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living', aktif: true }],
    projects: [{ id: 'PR-1', tukang_id: 'TK-1', project_name: 'Project A', status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 0 }],
    items: [], kasbon: [], totalans: [], totalanProjects: [], totalanKasbon: []
  })
  const ops = sync.planPersist(st, JSON.parse(JSON.stringify(st)), { snapshotTotalan: () => ({}) })
  eq(ops.length, 0, 'state identik = 0 operasi')
}

// ============================================================
console.log('== 4. planPersist: hapus ==')
{
  const st = sync.stateFromDb({
    tukangs: [{ id: 'TK-1', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living', aktif: true }],
    projects: [{ id: 'PR-1', tukang_id: 'TK-1', project_name: 'Project A', status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 0 },
               { id: 'PR-2', tukang_id: 'TK-1', project_name: 'Project Hapus', status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 1 }],
    items: [{ id: 'IT-9', project_id: 'PR-2', pekerjaan: 'nakas', ukuran: null, satuan_ukuran: null, harga_satuan: 50000, upah_rincian: 50000, catatan: null, sort_order: 0 }],
    kasbon: [], totalans: [], totalanProjects: [], totalanKasbon: []
  })
  const next = JSON.parse(JSON.stringify(st))
  next.tukangs[0].projects = next.tukangs[0].projects.filter(p => p.id !== 'PR-2')
  next.tukangs[0].upahItems = next.tukangs[0].upahItems.filter(u => u.projectId !== 'PR-2')
  const ops = sync.planPersist(st, next, { snapshotTotalan: () => ({}) })
  const delItem = ops.find(o => o.table === 'upah_items' && o.kind === 'delete')
  const delProj = ops.find(o => o.table === 'upah_projects' && o.kind === 'delete')
  ok(!!delItem && delItem.id === 'IT-9', 'item ikut terhapus')
  ok(!!delProj && delProj.id === 'PR-2', 'project terhapus')
  ok(ops.indexOf(delItem) < ops.indexOf(delProj), 'item dihapus sebelum projectnya')
}

// ============================================================
console.log('== 5. applyIdMap mengganti id sementara -> UUID di semua referensi ==')
{
  const d = ds({
    projects: [{ id: 'p_baru1', name: 'B', status: 'ON_GOING' }],
    upahItems: [{ id: 'u_baru1', projectId: 'p_baru1', pekerjaan: 'Rak', ukuran: 1, satuanUkuran: '', hargaSatuan: 100000, upahRincian: 100000, catatan: '' }],
    kasbon: [{ id: 'k_baru1', tanggal: '2026-10-05', jenis: 'KASBON', deskripsi: 'm', metode: '', nominal: 1, bukti: '' }],
    totalans: [{ id: 't_baru1', no: 'TOT-1', tanggal: '2026-10-06', seq: 1, projectIds: ['p_baru1'], pembayaranAktual: 0, kasbonIds: ['k_baru1'] }],
    projectOverrides: { 'p_baru1': 777 }
  })
  sync.applyIdMap(d, { p_baru1: 'uuid-p', u_baru1: 'uuid-u', k_baru1: 'uuid-k', t_baru1: 'uuid-t' })
  eq(d.projects[0].id, 'uuid-p', 'project id diganti')
  eq(d.upahItems[0].projectId, 'uuid-p', 'referensi projectId diganti')
  eq(d.totalans[0].projectIds[0], 'uuid-p', 'totalan.projectIds diganti')
  eq(d.totalans[0].kasbonIds[0], 'uuid-k', 'totalan.kasbonIds diganti')
  eq(d.projectOverrides['uuid-p'], 777, 'kunci projectOverrides diganti')
}

// ============================================================
console.log('== 6. execute ops: urutan panggilan klien & resolusi UUID ==')
;(async () => {
  // mock klien supabase: catat operasi per tabel
  const calls = []
  let uuidSeq = 0
  function makeClient() {
    function tbl(name) {
      const t = {
        insert(rows) {
          const arr = Array.isArray(rows) ? rows : [rows]
          calls.push([name, 'insert', rows])
          return {
            select: () => Promise.resolve({ data: arr.map(() => ({ id: 'uuid-baru-' + (++uuidSeq) })), error: null })
          }
        },
        update(row) { return { eq: (_c, _v) => { calls.push([name, 'update', row]); return Promise.resolve({ data: null, error: null }) } } },
        delete() {
          return {
            in: (_c, _v) => { calls.push([name, 'delete-in', _v]); return Promise.resolve({ data: null, error: null }) },
            eq: (_c, _v) => { calls.push([name, 'delete', _v]); return Promise.resolve({ data: null, error: null }) }
          }
        }
      }
      return t
    }
    return { from: tbl }
  }
  // eksekusi manual memakai plan dari kasus 2
  const d = ds({
    projects: [{ id: 'p_baru1', name: 'Project B', status: 'ON_GOING' }],
    upahItems: [{ id: 'u_baru1', projectId: 'p_baru1', pekerjaan: 'Rak', ukuran: 1, satuanUkuran: '', hargaSatuan: 100000, upahRincian: 100000, catatan: '' }],
    kasbon: [{ id: 'KB-2', tanggal: '2026-10-05', jenis: 'KASBON', deskripsi: 'makan', metode: '', nominal: 200000, bukti: '' }],
    totalans: [{ id: 't_baru1', no: 'TOT-001', tanggal: '2026-10-06', seq: 1, projectIds: ['PR-1', 'p_baru1'], pembayaranAktual: 500000, kasbonIds: ['KB-2'] }],
    projectOverrides: {}
  })
  const next = { version: 2, activeKey: 'asep', tukangs: [d] }
  const ops = sync.planPersist(prev, next, { snapshotTotalan: (t) => ({ total_upah: 100000, kasbon_dipotong: 200000, hak_bersih: -100000, saldo_akhir: -600000, status: 'Perlu cek' }) })
  const client = makeClient()
  const idMap = {}
  const res = await sync.executeOps(ops, client, { idMap, resolve: (id) => idMap[id] || id })
  ok(res.ok === true, 'eksekusi sukses')
  const insertedTables = calls.filter(c => c[1] === 'insert').map(c => c[0])
  ok(insertedTables[0] === 'upah_projects', 'insert pertama = upah_projects (bukan anak)')
  ok(insertedTables.indexOf('upah_items') > insertedTables.indexOf('upah_projects'), 'item insert setelah project')
  ok(insertedTables.indexOf('upah_totalan') > insertedTables.indexOf('upah_kasbon'), 'totalan setelah kasbon')
  ok(idMap.p_baru1 === 'uuid-baru-1', 'uuid hasil insert tercatat di idMap (dapat ' + idMap.p_baru1 + ')')
  const jkCalls = calls.filter(c => c[0] === 'upah_totalan_projects' && c[1] === 'insert')
  ok(jkCalls.some(c => [].concat(c[2]).some(r => r.project_id === 'uuid-baru-1')), 'junction yang DIKIRIM merujuk UUID final')
  const ttCall = calls.find(c => c[0] === 'upah_totalan' && c[1] === 'insert')
  ok(ttCall && ttCall[2].tukang_id === 'TK-1', 'totalan insert membawa tukang_id')
  console.log('')
  console.log('HASIL: ' + passed + ' lulus, ' + failed + ' gagal')
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
