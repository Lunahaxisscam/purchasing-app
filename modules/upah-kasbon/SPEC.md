# SPEC — Modul Upah & Kasbon (terpisah, calon gabung ke Purchasing App)

Sumber acuan: `Asep_Simple_Upah_Kasbon.xlsx` (5 sheet: Dashboard, List Proyek,
Rincian Upah, Total Kasbon, Slip Pembayaran Upah).
Status: RANCANGAN — belum digabung ke purchasing app, belum menyentuh source staging.

## Temuan kunci dari file

1. File ini adalah versi Excel dari pola Google Sheets `*_Simple_Upah_Kasbon`
   per tukang yang SUDAH disync read-only ke purchasing app
   (`scripts/drive_sync/tukang_upah_sync.py` → tabel `tukang_dashboards`,
   `tukang_projects`, `tukang_upah_items`, `tukang_kasbon`).
   Modul `TukangUpah.js` di app saat ini 100% tampilan — tidak ada form input.
2. Sync hanya membaca 4 tab. Sheet **Slip Pembayaran Upah (totalan) TIDAK
   disync dan TIDAK ada di app** — ini bagian baru yang perlu dibangun.
3. Angka di file tersimpan dalam RIBUAN rupiah (format sel `#,##0"000"`).
   Contoh: Harga Satuan 450 = Rp450.000; Total Proyek Josh–Mabes 9.230 = Rp9.230.000.
   Di modul, semua nominal disimpan rupiah penuh.
4. `Upah Rincian` diisi MANUAL dan tidak selalu = Ukuran × Harga Satuan
   (contoh nyata: Panel samping divan 2,1 × Rp350rb = Rp735rb, tertulis Rp500rb).
   Form harus memberi usulan hitungan, tapi nilai final tetap bisa diedit.
5. Aturan Total Proyek: bila subtotal manual (kolom F) terisi → pakai itu;
   bila kosong → jumlahkan Upah Rincian proyek tsb. (Rumus SUMIF di List Proyek.)
6. Kasbon tidak punya status manual. Kasbon "sudah terpotong" dihitung dari
   riwayat totalan (kolom Kasbon Dipotong di Slip), bukan ditandai per transaksi.

## INPUT MANUAL (yang diisi user di form)

### A. Data induk
| Field | Wajib | Catatan |
|---|---|---|
| Tukang / subkon | ✓ | Di file = 1 file per tukang; di modul jadi pilihan `tukang_key` (mis. asep) + nama + unit bisnis |
| Proyek | ✓ | Di file teks bebas; di modul dropdown dari master proyek purchasing app |

### B. Upah kerja (per baris pekerjaan) — dari `Rincian Upah!A5:G5`
| Field | Wajib | Catatan |
|---|---|---|
| Proyek | ✓ | penghubung ke List Proyek & totalan |
| Pekerjaan | ✓ | teks bebas: "Wardrobe", "Instalasi LED + saklar", dll |
| Ukuran | ✓ | angka desimal (3,2 / 1,7 / 1,0). File TIDAK punya kolom satuan ukuran — usulan: tambah `satuan_ukuran` opsional (m / m² / unit / ls) |
| Harga Satuan (Rp) | ✓ | tarif borongan per ukuran |
| Upah Rincian (Rp) | ✓ | nilai final dibayar per baris; default usulan = Ukuran × Harga Satuan, BOLEH diubah (lihat temuan 4) |
| Total Proyek / subtotal (Rp) | – | override opsional per proyek (lihat temuan 5) |
| Catatan | – | |

### C. Kasbon (per transaksi) — dari `Total Kasbon!A5:G5`
| Field | Wajib | Catatan |
|---|---|---|
| Tanggal | ✓ | menentukan urutan potongan di totalan & rekap bulanan |
| Jenis | ✓ | pilihan: `Kasbon` / `Pelunasan` (lama). Hanya Jenis=`Kasbon` yang dihitung sebagai kasbon terpotong di totalan |
| Deskripsi | – | keperluan kasbon |
| Metode | – | Tunai / Transfer / dll (di file teks bebas) |
| Nominal (Rp) | ✓ | |
| Bukti | – | link/file bukti (kolom G di sheet asli; di file ini header-nya masih "Column 2") |
| Dibuat oleh | auto | di sheet asli kolom F; di modul = user login |

### D. Totalan / Slip pembayaran (per totalan) — dari `Slip Pembayaran Upah`
Input manual hanya 3 + daftar proyek (di file: sel kuning):
| Field | Wajib | Catatan |
|---|---|---|
| No. Totalan | ✓ | unik; file memberi status "Nomor duplikat" bila ganda. Di modul: auto-number, bisa diedit |
| Tanggal totalan | ✓ | HARUS urut tanggal — hitungan kasbon bersifat kumulatif per tanggal |
| Proyek yang ikut totalan | ✓ | tabel detail: 1 baris per proyek per totalan |
| Pembayaran Aktual (Rp) | ✓ | yang benar-benar ditransfer/dibayar saat totalan |

### E. Batch cut-off Dashboard (opsional, warisan file)
Nama batch/periode, Pelunasan Dibayar, Metode Pelunasan, Status.
CATATAN: tumpang tindih dengan Pembayaran Aktual di totalan — usulan modul:
Dashboard dibuat OTOMATIS dari totalan; batch hanya pengelompokan periode.

## OTOMATIS (tidak diinput, dihitung sistem)
- Total Upah per proyek (aturan temuan 5)
- Rekap kasbon bulanan: jumlah transaksi + total per bulan (COUNTIFS/SUMIFS)
- Kasbon Dipotong per totalan = total Kasbon (Jenis=Kasbon, tanggal ≤ tgl totalan)
  − total Kasbon Dipotong di semua totalan bertanggal lebih awal; minimum 0
- Total Upah totalan = Σ Total Upah proyek-proyek di detail totalan
- Hak Bersih = Total Upah totalan − Kasbon Dipotong
- Saldo Akhir = Hak Bersih − Pembayaran Aktual
- Status totalan = `Lunas` bila Saldo Akhir = 0, selain itu `Perlu cek`
- Dashboard: Total Hak Upah, Total Kasbon, Total Pelunasan,
  Sisa Saldo Berjalan = Hak Upah − Kasbon − Pelunasan
- Cetak slip: pilih No. Totalan → slip Noir Living (Penerima / Disetujui)

## Model data calon (nama diselaraskan dengan tabel app yang sudah ada)
- `tukang_dashboards` (sudah ada) — identitas tukang + rekap
- `tukang_projects` (sudah ada) — proyek per tukang + total upah + status
- `tukang_upah_items` (sudah ada) — field identik dengan input B
- `tukang_kasbon` (sudah ada) — field identik dengan input C (+ bukti)
- `tukang_totalan` (BARU) — no_totalan, tukang_key, tanggal, kasbon_dipotong,
  total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status
- `tukang_totalan_items` (BARU) — totalan_id, project (nama/id), total_upah snapshot

## Risiko integrasi yang harus diputuskan SEBELUM gabung
1. **Konflik sumber data:** tabel `tukang_*` saat ini diisi sync dari Google
   Sheets (sync menimpa per siklus). Kalau form app menulis ke tabel yang sama,
   data form bisa tertimpa sync. Pilihan: (a) form menggantikan Sheets sebagai
   sumber untuk tukang tertentu, sync untuk tukang itu dimatikan; atau
   (b) tahap awal form hanya untuk totalan/slip, upah & kasbon tetap dari sync.
2. Nama proyek di file/sync = teks bebas; app mencocokkan proyek dengan kunci
   nama ternormalisasi (huruf kecil, spasi dirapatkan — `lib/laborSource.js`).
   Form sebaiknya memakai `project_id` + simpan nama snapshot.
3. Satuan ukuran tidak ada di file — perlu keputusan mau ditambah atau tidak.

## Struktur modul terpisah (mengikuti kontrak modules/registry.js app)
```
modul-upah-kasbon/
  SPEC.md            <- file ini
  modules/upah-kasbon/
    README.md        <- kontrak modul & cara gabung
    logic.js         <- perhitungan murni (total proyek, kasbon dipotong, saldo) — tanpa UI/DB
    view.jsx         <- dashboard + tabel (calon)
    form.jsx         <- form upah & kasbon (calon)
    slip.jsx         <- totalan + cetak slip (calon)
    store.js         <- penyimpanan lokal dulu; adapter diganti Supabase saat gabung
  migrations/
    tukang_totalan.DRAFT.sql  <- skema 2 tabel baru (draft, belum dieksekusi)
```
Prinsip: `logic.js` tidak berubah saat integrasi; yang diganti hanya `store.js`
(lokal → Supabase) + registrasi 1 baris di `modules/registry.js` + menu di
`lib/constants.js` saat penggabungan nanti.

---

## Update v2 (2026-10-22) — Multi-tukang + List Proyek

Arahan user: modul harus menyesuaikan bila tukang lebih dari satu, dan
perlu modul **List Proyek** — proyek diklik → rincian upah proyek itu tampil.

Perubahan:
1. **State v2 multi-tukang**: `state = { activeKey, tukangs: [dataset per tukang] }`.
   Semua proyek/upah/kasbon/totalan terpisah per `tukang_key` — persis cara
   tabel `tukang_*` di purchasing app berkelompok. Pemilih tukang di header;
   tambah/hapus tukang dari UI; nama bisa diubah tanpa mengganti key.
   Data v1 otomatis dimigrasi jadi dataset tukang pertama.
2. **Tab pertama sekarang List Proyek** (menggantikan posisi tab gabungan
   "Proyek & Rekap"): tabel proyek per tukang aktif (status, jumlah item,
   total, penanda sudah ditotal / total manual) — baris diklik membuka panel
   rincian upah proyek tsb (item per item + edit/hapus + tambah pekerjaan
   langsung ke proyek itu + Total Manual). Nama proyek BOLEH berulang di
   tukang yang sama (di file asli memang ada: "Project Cove 2 - 27" muncul
   2x sebagai grup terpisah) — form memberi konfirmasi, bukan memblokir.

Data contoh v2 = data asli dua file:
- Asep: Proyek Josh - Mabes (19 item, Rp9.230.000) + 2 kasbon contoh.
- Pujon: 54 proyek (53 baris List Proyek + Taman Cosmos yang ada di rincian
  tapi tidak ada di list), 524 baris rincian, 92 kasbon.
  Di file rincian, subtotal per proyek SELALU = jumlah rinciannya (53/53 grup
  cocok), jadi tidak ada Total Manual yang dipasang untuk Pujon.

### Temuan ketidakcocokan angka DI DALAM file Pujon (penting)
Angka Dashboard file Pujon adalah nilai cache lama dan TIDAK sinkron
dengan rinciannya sendiri:
- Dashboard "Total Hak Upah" Rp361.479.600 vs jumlah rincian Rp407.535.500
  dan jumlah List Proyek Rp407.035.500 (selisih list vs rincian persis
  Rp500.000 = Taman Cosmos).
- Dashboard "Total Kasbon" Rp312.850.000 vs jumlah sheet Total Kasbon
  Rp391.261.000 — selisihnya persis Rp78.411.000 = total pelunasan batch.
- Sheet Slip di file Pujon KOSONG: pelunasan historis Pujon (Rp78.411.000)
  tercatat di tabel batch Dashboard, bukan di totalan/slip.
Modul menghitung live dari rincian, jadi angka modul akan berbeda dari
Dashboard file — itu disengaja dan terdokumentasi di footer aplikasi.
Konsekuensi integrasi: batch Dashboard lama (dengan kolom Pelunasan Dibayar
manual) belum dimodelkan di modul v2; totalan/slip adalah jalur pelunasan
ke depan.

---

## Update v3 (2026-10-22) — Tambah rincian lebih simpel + arsip proyek lunas

Arahan user: (1) menambah rincian upah harus lebih simpel — rincian proyek
sebelumnya dibuat pendek, tidak ditampilkan semua; (2) proyek yang sudah
ditotal masuk arsip / diberi tanda sudah lunas di List Proyek, supaya tidak
di-carry over ke periode berikutnya.

Perubahan:
1. **Tab Rincian Upah bentuk pendek**: di bawah form hanya ada ringkasan
   satu baris per proyek (nama, jumlah item, total). Item proyek lama
   TERLIPAT; tombol "Lihat Rincian" membuka item proyek itu saja, tombol
   "+ Tambah Item" melompat ke form dengan proyek tsb terpilih. Setelah
   menyimpan baris, pilihan proyek TIDAK reset — lanjut mengisi proyek
   yang sama tinggal ketik pekerjaan berikutnya, dan fokus kembali ke
   kolom Pekerjaan.
2. **Arsip proyek lunas (turunan, di logic.js)**: proyek yang masuk ke
   minimal satu totalan berstatus Lunas otomatis berstatus arsip.
   - List Proyek: tabel utama hanya proyek aktif; proyek arsip tampil di
     bagian terpisah "Arsip — Proyek Lunas / Ditutup" dengan badge Lunas.
   - Pilihan proyek di form Totalan menyembunyikan proyek arsip (ada
     catatan jumlah yang disembunyikan) → tidak ter-carry over.
   - Dropdown tambah upah juga menyembunyikan proyek arsip (kecuali saat
     mengedit item milik proyek itu).
   - Dashboard tetap menghitung total historis semua proyek; kartu Total
     Hak Upah menampilkan sub-info jumlah proyek & nilai yang sudah arsip.
   - Status arsip ini TURUNAN: menghapus totalan lunasnya mengeluarkan
     proyek dari arsip secara otomatis.
   - Override manual per proyek (`arsipManual`): tombol "Arsipkan"
     memaksa arsip (mis. proyek ditutup tanpa totalan), tombol "Aktifkan
     Lagi" menahan proyek tetap aktif walau sudah lunas (badge
     "lunas — ditahan aktif").
   - Proyek yang ditotal tapi totalannya belum lunas ("Perlu cek") TIDAK
     diarsipkan; di List Proyek ia bertanda "sudah ditotal — belum lunas".

---

## Update v4 (2026-10-22) — Bar tukang ringkas + dua modul, satu layar

1. **Bar tukang disederhanakan**: hanya tersisa pemilih "Tukang aktif"
   (+ tambah/hapus tukang). Kolom Nama, Unit Bisnis, dan label key
   DIHAPUS dari UI — nama cukup dari pemilih; unit & key tetap tersimpan
   di dataset (dari data contoh / saat tukang dibuat), tidak ditampilkan.
2. **List Proyek & Rincian Upah = DUA modul berbeda, satu layar (UI)**:
   - Secara kode/paket keduanya modul tersendiri (`modules/list-proyek/`
     dan `modules/rincian-upah/`, inti bersama di `modules/upah-kasbon/`).
     Di prototipe HTML keduanya dipisahkan banner komentar MODUL 1 /
     MODUL 2 dengan fungsi render masing-masing.
   - Satu-satunya antarmuka di antara mereka: konteks proyek terpilih.
     Klik baris/tombol Rincian di List Proyek menetapkan konteks itu;
     Modul Rincian Upah lalu merender tabel rincian upah proyek tsb.
   - **Rincian Upah kosong secara default**: sebelum ada proyek yang
     diklik, panel rincian hanya menampilkan placeholder kosong dan form
     tambah rincian tersembunyi. Ganti tukang / Tutup Rincian mengembalikan
     ke keadaan kosong.
   - Form tambah/edit rincian kini menempel di panel rincian (tidak ada
     lagi tab Rincian Upah terpisah dan tidak ada dropdown pilihan proyek
     di form — proyeknya = proyek yang sedang dibuka). Tab aplikasi
     tinggal 3: List Proyek & Rincian Upah | Kasbon | Totalan & Slip.
   - Saat nanti digabung ke Purchasing App, keduanya masuk sebagai dua
     modul terpisah yang dirender dalam satu panel, sesuai struktur ini.

---

## Update v5 (2026-10-22) — Dua tab terpisah lagi; rincian menyamping

Koreksi user atas v4: UI tidak digabung satu panel. Yang benar:

1. **List Proyek dan Rincian Upah tetap dua modul dengan tab masing-masing**
   (kembali 4 tab: List Proyek | Rincian Upah | Kasbon | Totalan & Slip).
2. **Klik proyek di List Proyek → pindah ke tab Rincian Upah** proyek tsb
   (baris proyek maupun tombol Rincian; termasuk proyek di bagian Arsip —
   rinciannya tetap bisa dibuka).
3. **Tampilan rincian MENYAMPING, bukan ke bawah**: di tab Rincian Upah,
   layout dua kolom — kiri: data rincian (ringkasan proyek, Total Manual,
   tabel item, total); kanan: form Tambah/Edit Rincian (sticky, lebar
   350px). Layar sempit (<920px) otomatis menumpuk.
4. Default tab Rincian Upah tetap KOSONG (placeholder + tombol "Ke List
   Proyek") sampai ada proyek yang diklik; ganti tukang / "Tutup Rincian"
   mengosongkannya lagi. Form tidak punya dropdown proyek — konteksnya =
   proyek yang dibuka.

Catatan v5.1 (2026-10-22): opsi status proyek "Berjalan" dihapus dari form tambah proyek — redundan dengan "On Going". Pilihan status sekarang: On Going / Selesai (default On Going); fallback tampilan status kosong juga "On Going".

Catatan v5.2 (2026-10-22): gugus tombol di header panel Rincian Upah ("List Proyek", "Isi Rincian (kolom kanan)", "Tutup Rincian") dihapus atas arahan user — header rincian kini hanya judul proyek. Pindah tab cukup lewat tab di atas; ganti proyek lewat List Proyek.

---

## Update v6 (2026-10-22) — Logika bisnis: kasbon saat berjalan, totalan saat selesai

Penegasan user tentang logika bisnisnya:
- Tukang bekerja, proyek BELUM selesai, tapi kasbon sudah diambil saat
  proyek berjalan.
- TOTALAN dilakukan pada saat proyek SUDAH SELESAI.

Implementasi:
1. **Kartu dashboard baru "Sisa Hak Periode Berjalan — Belum Diarsipkan"**
   (fungsi murni `sisaHakPeriodeBerjalan` di logic.js): hitungan antara
   List Proyek dan Kasbon untuk periode terbuka saja =
   total proyek yang masih AKTIF di List Proyek (belum diarsipkan)
   DIKURANGI kasbon yang belum terpotong di totalan. Proyek arsip dan
   kasbon yang sudah terpotong adalah periode yang sudah ditutup dan
   tidak ikut hitungan. Kartu menampilkan rincian hitungannya
   (jumlah & total proyek aktif, kasbon belum terpotong).
   Contoh data contoh Pujon: 407.535.500 − 391.261.000 = Rp16.274.500.
2. **Totalan hanya untuk proyek Selesai** (fungsi `proyekSiapTotalan`):
   di form Buat Totalan, proyek yang masih On Going tampil NONAKTIF
   (checkbox disabled) dengan tanda "On Going — belum selesai, belum
   bisa ditotal". Proyek arsip tetap disembunyikan seperti sebelumnya.

---

## Update v7 (2026-10-22) — Kontrol kasbon per entri (koreksi logika totalan)

Kritik user (benar): logika totalan lama langsung menarik SEMUA kasbon
s/d tanggal totalan, jadi tidak bisa dikontrol kasbon tanggal xxx sudah
dibayarkan lewat totalan yang mana.

Perbaikan — potongan kasbon sekarang PER ENTRI dan EKSPLISIT:
1. Form Totalan punya checklist "Kasbon yang Dipotong di Totalan Ini"
   (semua kasbon yang belum terpotong, urut tanggal; default tercentang
   yang bertanggal <= tanggal totalan, boleh diubah operator). Hanya
   yang dicentang yang terpotong. Pilihan tersimpan di record totalan
   sebagai `kasbonIds`.
2. logic.js: `alokasiKasbon(state)` mengalokasikan setiap entri kasbon
   ke TEPAT SATU totalan; `hitungTotalans` menghitung potongan dari
   alokasi itu dan mengembalikan `potonganDetail` per totalan;
   `statusKasbon(state)` memberi status setiap entri kasbon.
3. Kontrol terlihat di UI:
   - Tab Kasbon: kolom "Status Potongan" per entri — "Terpotong —
     TOT-00X" atau "Belum terpotong".
   - Tabel totalan: baris detail di bawah tiap totalan menyebut kasbon
     apa saja yang dipotong di totalan itu (tanggal · deskripsi · nominal).
   - Slip: rincian kasbon terpotong dicetak per entri di bawah baris
     Kasbon Dipotong.
4. Kompatibilitas mundur: totalan lama yang belum punya `kasbonIds`
   dialokasikan FIFO (kasbon belum teralokasi bertanggal <= tanggal
   totalan, mode 'otomatis', ditandai badge "totalan lama") — angka
   totalan lama TIDAK berubah. Entri yang sudah dialokasikan tidak bisa
   dipotong dua kali: pilihan ganda di totalan lain menyumbang Rp0.

Catatan v8 (2026-10-22): (1) Proyek yang sudah pernah masuk totalan mana
pun TIDAK bisa masuk totalan lagi — di form totalan ia tampil nonaktif
dengan tanda "sudah ditotal — tidak bisa masuk totalan lagi", dan submit
dipaksa lewat form pun ditolak dengan pesan (penjaga di handler submit,
berlaku juga untuk kasbon yang sudah terpotong di totalan lain).
(2) Dua teks catatan di tab Totalan dihapus atas arahan user: catatan
"Alur bisnisnya..." di atas form dan catatan "KONTROL: ..." di bawah
checklist kasbon.
