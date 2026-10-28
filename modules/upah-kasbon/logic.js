// ============================================================
// modules/upah-kasbon/logic.js — PERHITUNGAN MURNI UPAH & KASBON
// ============================================================
// Port dari rumus `*_Simple_Upah_Kasbon.xlsx` (lihat SPEC.md di root paket).
// File ini SENGAJA tanpa import (tanpa React/DB/jaringan) — pola yang sama
// dengan lib/laborSource.js di purchasing app — supaya:
//   1. bisa diuji langsung di Node tanpa UI,
//   2. TIDAK berubah saat modul digabung ke purchasing app;
//      yang diganti saat integrasi hanya store.js (lokal -> Supabase).
//
// Semua nominal dalam RUPIAH PENUH. (File Excel menyimpan dalam ribuan
// dengan format sel #,##0"000" — jangan tiru itu di data modul.)
//
// Dua penyimpangan sadar dari rumus Excel (didokumentasikan, bukan diam-diam):
//   A. Total kasbon dashboard & rekap hanya menghitung Jenis = 'Kasbon'.
//      Rumus Excel menjumlah SEMUA baris Total Kasbon tanpa filter jenis,
//      padahal sheet yang sama menyimpan baris 'Pelunasan' lama sebagai
//      riwayat — menjumlahkannya akan menghitung pelunasan dua kali.
//   B. Urutan potongan kasbon antar-totalan mengikuti urutan kronologis
//      (tanggal, lalu urutan input). Rumus Excel memakai tanggal "<"
//      secara ketat, jadi dua totalan di tanggal yang sama bisa memotong
//      kasbon yang sama dua kali. Di sini totalan kedua di hari yang sama
//      melanjutkan potongan totalan pertama.
// ============================================================

/** Angka aman: null/''/teks acak -> 0. */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  return isFinite(n) ? n : 0
}

/** Usulan Upah Rincian = Ukuran x Harga Satuan (dibulatkan ke rupiah penuh).
 *  HANYA usulan: nilai final di form boleh diubah manual — di data asli
 *  memang ada baris yang tidak sama dengan hasil kali ini. */
export function saranUpahRincian(ukuran, hargaSatuan) {
  return Math.round(toNum(ukuran) * toNum(hargaSatuan))
}

/** Total satu proyek.
 *  Aturan file: bila subtotal manual (override) terisi -> pakai override;
 *  bila kosong -> jumlahkan Upah Rincian proyek tsb. */
export function totalUpahProyek(items, projectId, override) {
  if (override !== null && override !== undefined && override !== '') {
    return toNum(override)
  }
  return (items || [])
    .filter((it) => it.projectId === projectId)
    .reduce((s, it) => s + toNum(it.upahRincian), 0)
}

/** Ringkasan per proyek: [{ projectId, jumlahItem, sumRincian, override, total }] */
export function ringkasanProyek(projects, items, overrides) {
  const ov = overrides || {}
  return (projects || []).map((p) => {
    const rows = (items || []).filter((it) => it.projectId === p.id)
    const sumRincian = rows.reduce((s, it) => s + toNum(it.upahRincian), 0)
    const hasOverride = ov[p.id] !== null && ov[p.id] !== undefined && ov[p.id] !== ''
    return {
      projectId: p.id,
      jumlahItem: rows.length,
      sumRincian,
      override: hasOverride ? toNum(ov[p.id]) : null,
      total: hasOverride ? toNum(ov[p.id]) : sumRincian
    }
  })
}

/** Total kasbon (Jenis = 'Kasbon') dengan tanggal <= tanggalBatas (inklusif).
 *  tanggalBatas kosong -> semua kasbon. Tanggal format 'YYYY-MM-DD'. */
export function totalKasbonSampai(kasbon, tanggalBatas) {
  return (kasbon || [])
    .filter((k) => String(k.jenis || 'Kasbon') === 'Kasbon')
    .filter((k) => !tanggalBatas || !k.tanggal || k.tanggal <= tanggalBatas)
    .reduce((s, k) => s + toNum(k.nominal), 0)
}

/** Urutan kronologis totalan: tanggal naik, lalu urutan input (seq). */
export function urutkanTotalan(totalans) {
  return [...(totalans || [])].sort((a, b) => {
    const d = String(a.tanggal || '').localeCompare(String(b.tanggal || ''))
    return d !== 0 ? d : toNum(a.seq) - toNum(b.seq)
  })
}

/** Hitung semua totalan (SEKALIGUS, karena potongan kasbon bersifat
 *  kumulatif antar-totalan). Mengembalikan array sesuai urutan kronologis,
 *  tiap elemen = totalan asli + field hitungan:
 *    totalUpah, kasbonDipotong, hakBersih, saldoAkhir, status
 *  Rumus (dari sheet Slip Pembayaran Upah):
 *    kasbonDipotong = max(0, kasbon s/d tanggal totalan - kasbon yang
 *                     sudah terpotong di totalan-totalan sebelumnya)
 *    totalUpah      = Σ total proyek-proyek di detail totalan
 *    hakBersih      = totalUpah - kasbonDipotong
 *    saldoAkhir     = hakBersih - pembayaranAktual
 *    status         = 'Nomor duplikat' | 'Lunas' (saldo 0) | 'Perlu cek'  */
/** Alokasi potongan kasbon per totalan — DASAR KONTROL kasbon.
 *  Setiap entri kasbon (jenis 'Kasbon') dialokasikan ke TEPAT SATU totalan
 *  yang memotongnya, jadi kasbon tanggal berapa pun bisa dilacak:
 *  "kasbon ini sudah dibayarkan lewat totalan yang mana".
 *  Cara alokasi per totalan (diproses urut tanggal totalan):
 *   - Totalan BARU menyimpan pilihan eksplisit `kasbonIds` (entri kasbon
 *     yang dicentang operator di form totalan). Hanya entri itu yang
 *     dipotong oleh totalan tsb — TIDAK menyapu semua kasbon.
 *   - Totalan LAMA (belum punya kasbonIds — dibuat sebelum fitur ini)
 *     dialokasikan FIFO: kasbon belum teralokasi bertanggal <= tanggal
 *     totalan, supaya angka totalan lama tidak berubah.
 *  Return: { perTotalan: Map totalanId -> [{kasbonId, tanggal, deskripsi, nominal}],
 *            perKasbon:  Map kasbonId -> { totalanId, no, tanggal, mode } } */
export function alokasiKasbon(state) {
  const { kasbon = [], totalans = [] } = state || {}
  const perTotalan = new Map(), perKasbon = new Map()
  const byId = new Map(kasbon.map((k) => [k.id, k]))
  const urutKasbon = kasbon.map((k, i) => ({ k, i }))
    .filter((x) => x.k.jenis === 'Kasbon')
    .sort((a, b) => String(a.k.tanggal).localeCompare(String(b.k.tanggal)) || a.i - b.i)
    .map((x) => x.k)
  for (const t of urutkanTotalan(totalans)) {
    const daftar = []
    const alokasi = (k, mode) => {
      if (perKasbon.has(k.id)) return
      perKasbon.set(k.id, { totalanId: t.id, no: t.no, tanggal: t.tanggal, mode })
      daftar.push({ kasbonId: k.id, tanggal: k.tanggal, deskripsi: k.deskripsi || '', nominal: toNum(k.nominal) })
    }
    if (Array.isArray(t.kasbonIds)) {
      for (const id of t.kasbonIds) { const k = byId.get(id); if (k && k.jenis === 'Kasbon') alokasi(k, 'pilihan') }
    } else {
      for (const k of urutKasbon) { if (String(k.tanggal) <= String(t.tanggal)) alokasi(k, 'otomatis') }
    }
    perTotalan.set(t.id, daftar)
  }
  return { perTotalan, perKasbon }
}

/** Status potongan SETIAP entri kasbon — bahan kontrol & tampilan:
 *  [{ ...kasbon, terpotong, totalanNo, totalanTanggal, modeAlokasi }] */
export function statusKasbon(state) {
  const { kasbon = [] } = state || {}
  const { perKasbon } = alokasiKasbon(state)
  return kasbon.map((k) => {
    const a = perKasbon.get(k.id)
    return { ...k, terpotong: !!a, totalanNo: a ? a.no : null, totalanTanggal: a ? a.tanggal : null, modeAlokasi: a ? a.mode : null }
  })
}

export function hitungTotalans(state) {
  const { projects = [], upahItems = [], kasbon = [], totalans = [], projectOverrides = {} } = state || {}
  const totals = {}
  for (const r of ringkasanProyek(projects, upahItems, projectOverrides)) {
    totals[r.projectId] = r.total
  }
  const { perTotalan } = alokasiKasbon(state)
  const seen = new Set()
  return urutkanTotalan(totalans).map((t) => {
    const totalUpah = (t.projectIds || []).reduce((s, pid) => s + toNum(totals[pid]), 0)
    const potonganDetail = perTotalan.get(t.id) || []
    const kasbonDipotong = potonganDetail.reduce((s, x) => s + x.nominal, 0)
    const hakBersih = totalUpah - kasbonDipotong + toNum(t.openingAdjustment)
    const saldoAkhir = hakBersih - toNum(t.pembayaranAktual) - toNum(t.carriedResidual)
    const duplikat = seen.has(String(t.no || '').trim())
    if (t.no) seen.add(String(t.no).trim())
    const status = duplikat ? 'Nomor duplikat' : saldoAkhir === 0 ? 'Lunas' : 'Perlu cek'
    return { ...t, totalUpah, kasbonDipotong, potonganDetail, hakBersih, saldoAkhir, status }
  })
}

/** Angka kartu Dashboard:
 *    totalHakUpah   = Σ total semua proyek
 *    totalKasbon    = Σ kasbon Jenis 'Kasbon' (semua tanggal)
 *    totalPelunasan = Σ pembayaran aktual semua totalan
 *    sisaSaldo      = totalHakUpah - totalKasbon - totalPelunasan
 *    kasbonBelumTerpotong = totalKasbon - Σ kasbonDipotong semua totalan  */
export function ringkasanDashboard(state) {
  const { projects = [], upahItems = [], kasbon = [], projectOverrides = {} } = state || {}
  const totalHakUpah = ringkasanProyek(projects, upahItems, projectOverrides)
    .reduce((s, r) => s + r.total, 0)
  const totalKasbon = totalKasbonSampai(kasbon, null)
  const computed = hitungTotalans(state)
  const totalPelunasan = computed.reduce((s, t) => s + toNum(t.pembayaranAktual), 0)
  const kasbonTerpotong = computed.reduce((s, t) => s + t.kasbonDipotong, 0)
  return {
    totalHakUpah,
    totalKasbon,
    totalPelunasan,
    sisaSaldo: totalHakUpah - totalKasbon - totalPelunasan,
    kasbonTerpotong,
    kasbonBelumTerpotong: totalKasbon - kasbonTerpotong
  }
}

/** Rekap kasbon bulanan: [{ bulan: 'YYYY-MM', jumlah, total }] terurut.
 *  Hanya Jenis = 'Kasbon' (lihat penyimpangan A di header). */
export function rekapKasbonBulanan(kasbon) {
  const map = new Map()
  for (const k of kasbon || []) {
    if (String(k.jenis || 'Kasbon') !== 'Kasbon' || !k.tanggal) continue
    const bulan = String(k.tanggal).slice(0, 7)
    const cur = map.get(bulan) || { bulan, jumlah: 0, total: 0 }
    cur.jumlah += 1
    cur.total += toNum(k.nominal)
    map.set(bulan, cur)
  }
  return [...map.values()].sort((a, b) => a.bulan.localeCompare(b.bulan))
}

/** Himpunan projectId yang sudah LUNAS: proyek yang masuk ke minimal satu
 *  totalan berstatus 'Lunas'. Proyek di totalan 'Perlu cek' / duplikat
 *  TIDAK dianggap lunas. */
export function proyekLunasSet(state) {
  const set = new Set()
  for (const t of hitungTotalans(state)) {
    if (t.status === 'Lunas') (t.projectIds || []).forEach((id) => set.add(id))
  }
  return set
}

/** Apakah proyek masuk ARSIP (tidak di-carry over ke periode berikutnya)?
 *  Aturan:
 *    project.arsipManual === true  -> arsip (dipaksa manual)
 *    project.arsipManual === false -> TIDAK arsip (ditahan aktif manual,
 *                                     walau sudah lunas)
 *    selain itu (null/undefined)   -> arsip bila proyek sudah lunas
 *  Menghapus totalan lunasnya otomatis mengeluarkan proyek dari arsip
 *  (karena status ini turunan, bukan label sekali tulis). */
export function isProyekArsip(project, lunasSet) {
  if (!project) return false
  if (project.arsipManual === true) return true
  if (project.arsipManual === false) return false
  return lunasSet ? lunasSet.has(project.id) : false
}

/** Ringkasan arsip: { jumlah, total } untuk proyek-proyek arsip. */
export function ringkasanArsip(state) {
  const { projects = [], upahItems = [], projectOverrides = {} } = state || {}
  const lunas = proyekLunasSet(state)
  const ring = ringkasanProyek(projects, upahItems, projectOverrides)
  let jumlah = 0, total = 0
  for (const p of projects) {
    if (isProyekArsip(p, lunas)) {
      jumlah += 1
      const r = ring.find((x) => x.projectId === p.id)
      if (r) total += r.total
    }
  }
  return { jumlah, total }
}

/** Logika bisnis: kasbon diambil tukang SAAT proyek masih berjalan;
 *  TOTALAN baru dilakukan SAAT PROYEK SUDAH SELESAI. Jadi proyek boleh
 *  masuk totalan hanya bila statusnya 'Selesai'. */
export function proyekSiapTotalan(project) {
  return !!project && project.status === 'Selesai'
}

/** Sisa hak PERIODE BERJALAN — hitungan antara List Proyek dan Kasbon
 *  untuk periode yang BELUM diarsipkan:
 *    total proyek yang masih AKTIF di List Proyek (belum masuk arsip)
 *    DIKURANGI kasbon yang belum terpotong di totalan.
 *  Proyek yang sudah diarsipkan dan kasbon yang sudah terpotong adalah
 *  urusan periode yang sudah ditutup — tidak ikut hitungan ini. */
export function sisaHakPeriodeBerjalan(state) {
  const dash = ringkasanDashboard(state)
  const ra = ringkasanArsip(state)
  const totalAktif = dash.totalHakUpah - ra.total
  const kasbonBelum = dash.kasbonBelumTerpotong
  const jumlahProyek = state && Array.isArray(state.projects) ? state.projects.length : 0
  return { totalAktif, kasbonBelum, sisa: totalAktif - kasbonBelum, jumlahAktif: jumlahProyek - ra.jumlah }
}

/** Nomor totalan berikutnya: 'TOT-001', 'TOT-002', ... dari nomor terbesar
 *  berformat sama yang sudah ada. */
export function nomorTotalanBerikut(totalans) {
  let max = 0
  for (const t of totalans || []) {
    const m = String(t.no || '').match(/(\d+)\s*$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return 'TOT-' + String(max + 1).padStart(3, '0')
}
