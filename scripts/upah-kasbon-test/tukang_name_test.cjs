// ============================================================
// scripts/upah-kasbon-test/tukang_name_test.cjs
// ============================================================
// Uji NAMA TUKANG yang ditampilkan dari stateFromDb()
// (public/upah-kasbon-sync.js, mapping baris `upah_tukang` -> dataset v2).
//
// MASALAH: `name: t.nama` dipakai apa adanya. Baris tukang yang `nama`-nya
// kosong / hanya spasi membuat daftar tukang tampil tanpa nama (baris kosong
// yang tidak bisa diklik dengan yakin). Kode tukang (`kode`, mis. "pujon")
// selalu ada dan cukup untuk ditampilkan sebagai fallback yang manusiawi.
//
// KONTRAK:
//   - name  = trim(t.nama) bila tidak kosong
//           | prettify(trim(t.kode)) bila nama kosong dan kode ada  ("pujon" -> "Pujon")
//           | 'Tukang' bila nama DAN kode kosong/null
//   - key   = t.kode APA ADANYA (identitas data; TIDAK di-trim, TIDAK diubah).
//             key dipakai untuk mencocokkan dataset lama <-> baru saat sync,
//             jadi mengubahnya akan memutus identitas tukang.
//
// Tanpa jaringan & tanpa Supabase: yang diuji murni fungsi mapping.
// ============================================================
const path = require('path')
const sync = require(path.join(__dirname, '..', '..', 'public', 'upah-kasbon-sync.js'))

let passed = 0, failed = 0
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ✓ ' + msg) }
  else { failed++; console.error('  ✗ GAGAL: ' + msg) }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b)
  ok(same, msg + (same ? '' : ' — dapat ' + JSON.stringify(a) + ' harap ' + JSON.stringify(b)))
}

// fixture: satu/lebih baris upah_tukang, tabel lain kosong
function dbOf(rows) {
  return { tukangs: rows, projects: [], items: [], kasbon: [], totalans: [], totalanProjects: [], totalanKasbon: [] }
}
function nameOf(row) {
  const st = sync.stateFromDb(dbOf([row]))
  return { name: st.tukangs[0].name, key: st.tukangs[0].key, dbId: st.tukangs[0].dbId }
}

// ============================================================
console.log('== 1. nama tersimpan dipakai apa adanya (setelah trim) ==')
{
  const a = nameOf({ id: 'TK-1', kode: 'pujon', nama: 'Pujon', unit_bisnis: 'Noir Living' })
  eq(a.name, 'Pujon', 'nama "Pujon" -> name "Pujon"')
  eq(a.key, 'pujon', 'key tetap kode asli "pujon"')
  eq(a.dbId, 'TK-1', 'dbId tetap id baris')

  // spasi di tepi nama tidak boleh ikut tampil
  const b = nameOf({ id: 'TK-2', kode: 'asep', nama: '  Asep  ' })
  eq(b.name, 'Asep', 'nama "  Asep  " -> name "Asep" (trim)')
  eq(b.key, 'asep', 'key tetap kode asli "asep"')
}

// ============================================================
console.log('== 2. nama kosong/spasi -> kode di-prettify ==')
{
  const spasi = nameOf({ id: 'TK-3', kode: 'pujon', nama: '   ' })
  eq(spasi.name, 'Pujon', 'nama spasi + kode "pujon" -> name "Pujon"')
  eq(spasi.key, 'pujon', 'key tetap kode asli "pujon"')

  const kosong = nameOf({ id: 'TK-4', kode: 'pujon', nama: '' })
  eq(kosong.name, 'Pujon', 'nama "" + kode "pujon" -> name "Pujon"')

  const nol = nameOf({ id: 'TK-5', kode: 'pujon', nama: null })
  eq(nol.name, 'Pujon', 'nama null + kode "pujon" -> name "Pujon"')

  // kode ber-spasi: name di-trim, key TETAP apa adanya (identitas data)
  const kodeSpasi = nameOf({ id: 'TK-6', kode: ' pujon ', nama: '  ' })
  eq(kodeSpasi.name, 'Pujon', 'kode " pujon " -> name "Pujon" (trim sebelum prettify)')
  eq(kodeSpasi.key, ' pujon ', 'key TETAP " pujon " apa adanya (bukan hasil trim)')
}

// ============================================================
console.log('== 3. nama DAN kode kosong -> "Tukang" ==')
{
  const a = nameOf({ id: 'TK-7', kode: '', nama: '' })
  eq(a.name, 'Tukang', 'kode "" + nama "" -> name "Tukang"')
  eq(a.key, '', 'key tetap kode asli "" (kosong)')

  const b = nameOf({ id: 'TK-8', kode: null, nama: null })
  eq(b.name, 'Tukang', 'kode null + nama null -> name "Tukang"')
  eq(b.key, null, 'key tetap kode asli null')

  const c = nameOf({ id: 'TK-9', kode: '   ', nama: '  ' })
  eq(c.name, 'Tukang', 'kode spasi + nama spasi -> name "Tukang"')
  eq(c.key, '   ', 'key tetap kode asli "   " apa adanya')
}

// ============================================================
console.log('== 4. beberapa tukang sekaligus + totalan tidak terpengaruh ==')
{
  // Mapping nama tidak boleh menyentuh totalan/kasbon. Catatan: hunk snapshot
  // totalan historis sengaja TIDAK diuji di sini (kepemilikan terpisah).
  const st = sync.stateFromDb({
    tukangs: [
      { id: 'TK-1', kode: 'pujon', nama: '', unit_bisnis: 'Noir Living' },
      { id: 'TK-2', kode: 'asep', nama: 'Asep', unit_bisnis: 'Noir Living' }
    ],
    projects: [{ id: 'PR-1', tukang_id: 'TK-1', project_name: 'Project A', status: 'ON_GOING', arsip_manual: null, total_manual: null, sort_order: 0 }],
    items: [],
    kasbon: [{ id: 'KB-1', tukang_id: 'TK-1', tanggal: '2026-10-01', jenis: 'KASBON', deskripsi: 'mingguan', metode: 'Transfer', nominal: 1000000, bukti: 'trf', sort_order: 0 }],
    totalans: [{ id: 'TT-1', tukang_id: 'TK-1', no_totalan: 'TOT-001', tanggal: '2026-10-02', seq: 1, pembayaran_aktual: 800000 }],
    totalanProjects: [{ id: 'TP-1', totalan_id: 'TT-1', project_id: 'PR-1', nama_snapshot: 'Project A', total_upah: 875000, sort_order: 0 }],
    totalanKasbon: [{ id: 'TKB-1', totalan_id: 'TT-1', kasbon_id: 'KB-1', nominal: 1000000 }]
  })
  eq(st.tukangs.length, 2, 'dua dataset tukang')
  eq(st.tukangs.map(d => d.name), ['Pujon', 'Asep'], 'nama tiap tukang di-fallback terpisah')
  eq(st.tukangs.map(d => d.key), ['pujon', 'asep'], 'key tiap tukang tetap kode asli')

  const tt = st.tukangs[0].totalans[0]
  eq([tt.id, tt.no, tt.seq, tt.projectIds, tt.kasbonIds, tt.pembayaranAktual],
    ['TT-1', 'TOT-001', 1, ['PR-1'], ['KB-1'], 800000],
    'totalan tetap dipetakan seperti sebelumnya')
  eq(st.tukangs[0].kasbon[0].nominal, 1000000, 'kasbon tidak berubah')
  eq(st.tukangs[0].projects[0].name, 'Project A', 'project tidak berubah')
}

// ============================================================
console.log('')
console.log('HASIL: ' + passed + ' lulus, ' + failed + ' gagal')
process.exit(failed ? 1 : 0)
