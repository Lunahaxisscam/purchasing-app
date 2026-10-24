# Modul Upah & Kasbon (`upah-kasbon`)

Form input upah borongan, kasbon, dan totalan/slip pembayaran tukang —
port dari file `*_Simple_Upah_Kasbon.xlsx`. Dibangun sebagai modul
**terpisah dulu**; digabung ke Purchasing App belakangan.

**v8 (2026-10-22): kunci anti-dobel totalan.** Proyek/kasbon yang sudah
pernah ditotal tidak bisa masuk totalan lagi (nonaktif di form + penjaga
submit); dua catatan teks di tab Totalan dihapus atas arahan user.

**v7 (2026-10-22): kontrol kasbon per entri.** Koreksi logika totalan:
potongan kasbon dipilih eksplisit per entri (`kasbonIds` di record
totalan, `alokasiKasbon`/`statusKasbon` di logic.js), bukan menyapu
semua kasbon s/d tanggal totalan. Totalan lama tanpa `kasbonIds`
dialokasikan FIFO agar angkanya tidak berubah.

**v6 (2026-10-22): logika bisnis kasbon/totalan.** `sisaHakPeriodeBerjalan`
(proyek aktif − kasbon belum terpotong) sebagai kartu dashboard periode
terbuka; `proyekSiapTotalan` — totalan hanya untuk proyek Selesai.

**v5 (2026-10-22): dua tab terpisah + rincian menyamping.** Koreksi atas
v4: UI TIDAK satu panel — List Proyek & Rincian Upah kembali dua tab
terpisah; klik proyek di list berpindah ke tab Rincian Upah; di tab itu
tampilan menyamping (data rincian kiri, form kanan).

**v4 (2026-10-22): dua modul satu layar + bar tukang ringkas.** List
Proyek & Rincian Upah tetap modul terpisah (folder sendiri-sendiri),
UI-nya satu panel; rincian kosong sampai proyek diklik dari list; bar
tukang hanya pemilih tukang aktif (nama/unit/key tidak ditampilkan).

**v3 (2026-10-22): tambah rincian simpel + arsip lunas.** Tab Rincian Upah
hanya menampilkan ringkasan pendek per proyek (rincian lama terlipat);
proyek yang ditotal & lunas otomatis masuk Arsip di List Proyek dan hilang
dari pilihan totalan berikutnya (logika `proyekLunasSet` / `isProyekArsip`
di `logic.js`, dengan override manual `arsipManual` per proyek).

**v2 (2026-10-22): multi-tukang + List Proyek.** Satu dataset per tukang
(`tukang_key`), pemilih tukang di header. Tab pertama = **List Proyek**:
klik baris proyek membuka rincian upah proyek itu (drill-down), lengkap
dengan edit item dan Total Manual per proyek.

## File
| File | Isi |
|---|---|
| `logic.js` | Perhitungan murni (tanpa UI/DB): total proyek, potongan kasbon kumulatif per totalan, hak bersih, saldo, status, rekap bulanan, nomor totalan. **Tidak berubah saat integrasi.** |
| `store.js` | Penyimpanan: sekarang localStorage; saat integrasi diganti Supabase (pemetaan tabel ada di header file). |
| `../../SPEC.md` | Spesifikasi lengkap: daftar input, rumus asal Excel, model data, risiko integrasi. |
| `../../migrations/2026-10-22_tukang_totalan.DRAFT.sql` | Skema 2 tabel baru (totalan) — DRAFT, belum dieksekusi. |

Prototipe form yang bisa langsung dicoba: satu file HTML mandiri
(`modul-upah-kasbon.html` di paket rilis) yang menyisipkan `logic.js`
apa adanya ke dalam halamannya — hitungan prototipe = hitungan modul.

## Kontrak integrasi (mengikuti `modules/registry.js` Purchasing App)
Saat penggabungan nanti:
1. Salin folder ini ke `modules/upah-kasbon/` di source app.
2. Tambah entri registry:
   `{ id:'upah_kasbon', label:'Upah & Kasbon', adminOnly:true, source:'core',
      files:['modules/upah-kasbon/logic.js','modules/upah-kasbon/store.js','modules/upah-kasbon/view.jsx'] }`
   (id terpisah dari `tukang_upah` yang lama supaya modul sync read-only
   lama tetap utuh sampai keputusan sumber data diambil.)
3. Tambah menu di `lib/constants.js` (grup Admin Suite, pola flag terpusat
   seperti modul lain — bisa dihidup/matikan satu baris).
4. Buat `view.jsx` dari prototipe HTML (struktur tab & form sama persis).
5. Ganti isi `store.js` ke Supabase + jalankan migration totalan (setelah
   keputusan konflik sync di SPEC.md diambil).

## Verifikasi (2026-10-22)
- `logic.js`: 17 assertion Node lulus, termasuk mereproduksi total asli
  file Excel: Proyek Josh–Mabes 19 baris = **Rp9.230.000**, potongan kasbon
  kumulatif, status Lunas/Perlu cek/Nomor duplikat.
- Prototipe HTML: syntax JS lulus (`node --check`); simulasi alur di Node
  dengan DOM shim 14 pemeriksaan lulus (demo → buat totalan → Lunas →
  sisa saldo Rp0 → slip ter-render). Belum diuji klik di browser sungguhan.
- v8: simulasi aplikasi 29/29 — totalan Perlu cek membuat proyeknya
  nonaktif di form ("tidak bisa masuk totalan lagi") dan submit paksa
  proyek yang sama ditolak; seluruh uji v7 tetap lulus.
- v7: logic 41/41 (termasuk: totalan memilih 1 dari 3 kasbon -> potongan
  hanya entri itu; alokasi ganda menyumbang Rp0; status per entri tepat);
  simulasi aplikasi 26/26 — totalan hanya memotong kasbon tercentang,
  slip & tabel kasbon menunjukkan totalan pemotongnya, kasbon sisa tetap
  ditawarkan di totalan berikutnya.
- v6: logic 31/31 (termasuk siap-totalan & sisa periode: fixture campuran
  selesai/berjalan/terpotong sebagian = 8.500 persis); simulasi aplikasi
  20/20 — kartu periode Pujon Rp16.274.500, proyek On Going nonaktif di
  form totalan, setelah Asep lunas kartu periode Rp0.
- v5: simulasi aplikasi 16/16 — default rincian kosong, klik proyek
  berpindah tab & layout menyamping (grid) aktif, tambah item dari form
  samping menaikkan total proyek terbuka, proyek arsip tetap bisa dibuka
  rinciannya, regresi totalan-lunas-arsip lulus; audit elemen bersih.
- v4: simulasi aplikasi 19/19 — rincian kosong secara default & setelah
  ganti tukang, klik proyek membuka rincian + form konteks proyek,
  tambah item dari panel menaikkan total proyek yang terbuka, regresi
  totalan-lunas-arsip & aktifkan-lagi tetap lulus; audit getElementById:
  tidak ada elemen hilang.
- v3: logic 25/25 (termasuk 8 assertion arsip/lunas); simulasi aplikasi
  21/21 — rincian terlipat membuka/menutup, totalan Lunas memindahkan
  proyek ke Arsip & menghilangkannya dari pilihan totalan, "Aktifkan
  Lagi" mengembalikannya, tambah item mempertahankan pilihan proyek.
- v2: simulasi 20 pemeriksaan lulus — demo memuat 2 tukang (Asep +
  Pujon asli: total hak live Rp407.535.500, kasbon Rp391.261.000),
  ganti tukang memisahkan angka, klik Project Intercon di List Proyek
  membuka rinciannya (Rp37.415.000), tambah tukang baru = dataset kosong
  terpisah, totalan Asep tetap Lunas (regresi v1 aman).
