# Modul Perbandingan RAB vs RAP vs Aktual

Halaman admin (read-only) untuk membandingkan rencana biaya dengan kenyataan:
**RAB** (acuan) vs **RAP** (rencana) vs **Aktual** (belanja nyata).

Kanban: `t_a5ba5f73` — "[S3/7] UI perbandingan RAB vs RAP vs aktual"

## Kenapa modul ini ada

Datangnya barang ke workshop sering berbeda dari rencana: ada yang lebih murah
(karena cari supplier lain), ada yang lebih mahal (karena ukuran berubah),
ada yang belum datang sama sekali. Tanpa satu layar yang jujur, selisih ini
tidak kelihatan — dan laporan keuangan proyek jadi salah sejak awal.

## Prinsip kejujuran data (inti modul ini)

1. **Tidak ada aktual ≠ Rp 0.** Baris yang belum punya nota pembelian
   ditampilkan "Belum ada aktual", bukan angka nol. Nol terbaca sebagai
   "belanja nol rupiah" dan itu bohong.
2. **Pagu tidak diketahui ≠ aman.** Kalau nilai kontrak/pagu tidak dikirim ke
   halaman, statusnya "Pagu belum diketahui" — bukan "di bawah pagu" dan bukan
   "aman". Tidak ada angka yang dikarang dari quotation.
3. **Yang dibandingkan adalah nilai dasar baris** (qty × harga satuan), bukan
   grand total quotation yang sudah kena markup/PPN.
4. **Satu titik konversi uang** (`toRupiah`). Negatif / non-angka → `null`,
   bukan `0`.
5. **Selisih = RAP − RAB.** Positif = rencana melebihi acuan.
6. **Sumber setiap angka terlihat.** Drawer ringkas per baris menunjukkan dari
   mana tiap angka berasal, dan menulis "tidak ada data" bila memang tidak ada.

## Arsitektur

```
modules/rap-compare/
  logic.js   fungsi murni (tanpa React/DOM/DB) — bisa diuji langsung
  view.jsx   halaman React, admin-only, read-only
```

### `logic.js`

| Fungsi | Guna |
|---|---|
| `toRupiah(v)` | konversi aman ke angka; negatif/non-angka → `null` |
| `toQty(v)` | konversi qty; `0`/`''`/negatif → `null` |
| `lineValue(qty, price)` | nilai dasar baris; salah satu `null` → `null` |
| `readRabLines({ items })` | baca baris RAB dari beberapa bentuk field |
| `readRapLines({ items })` | baca baris draft RAP |
| `readActualLines({ items })` | baca baris aktual dari nota pembelian |
| `buildComparison({ rabJson, rapLines, actualRows, paguValue })` | inti perbandingan |
| `toCsv(comparison)` | ekspor CSV (angka utuh, tidak dibulatkan) |
| `detailFor(row)` | data drawer ringkas per baris |

`buildComparison` mengembalikan:

```
{
  rows: [{ key, name, unit, rab, rap, actual, diff, diffText, diffStatus,
           rabMissing, rapMissing, actualMissing }],
  totals: { rab, rap, actual, diff },
  coverage: { rabOnly, rapOnly, actualWithoutPlan, missingActual },
  ceiling: { level, label, message, pagu, used, pct, over, hasPagu },
  empty: bool
}
```

`ceiling.level`:

| level | arti |
|---|---|
| `none` | pagu tidak dikirim → "Pagu belum diketahui" (jujur) |
| `unknown` | pagu ada, RAP belum bernilai → "Pagu menunggu rencana" |
| `over` | rencana melewati pagu → peringatan (role=alert) |
| `near` | ≥ 85% pagu terpakai → peringatan dini |
| `within` | di bawah pagu |

### `view.jsx`

- Hanya untuk admin; dari DB hanya **membaca**.
- RAB diambil dari prop `rabItems` (fixture/JSON acuan) lalu jatuh ke
  `rows.boq_items` / `rows.rab_items` / `rows.quotation_items`.
- AKTUAL dari prop `actualRows` lalu jatuh ke `rows.receivings` +
  `rows.receiving_items`.
- Draft RAP hidup di **memori halaman** saja (React state). Tidak ada tabel,
  RPC, migrasi, atau localStorage baru. Tombol "Buat draft" menyalin acuan RAB
  supaya bisa langsung disesuaikan; ganti proyek → draft reset.
- Tabel bisa diurutkan lewat klik header; klik baris membuka drawer ringkas.
- Ekspor CSV dihitung dari data yang sama (tidak dibulatkan).

> Catatan repo: RAB/BOQ saat ini disimpan di memori halaman (modul rab-boq
> client-side), tidak ada tabel `boq_items`. Karena itu modul ini menerima
> acuan lewat prop — kalau prop kosong, halaman menampilkan empty state dan
> tidak mengarang baris.

## Harness verifikasi

```
python3 scripts/rap-compare-test/run.py
```

Tiga lapis, semuanya eksekusi nyata (tanpa jaringan, tanpa DB):

1. `logic_test.mjs` — fungsi murni (konversi, baca baris, buildComparison, CSV).
2. `render_test.mjs` — jsdom interaktif (`createRoot`): render komponen asli,
   klik impor, ganti proyek, status pagu, drawer.
3. `responsive_test.mjs` — kontrak responsif di **360 / 390 / 768 / 1440**:
   halaman tidak melebar melewati viewport, tabel yang scroll
   (bukan halaman), KPI 1→2→4 kolom, touch target, drawer tetap terbaca.

Hasil terakhir: 73 + 75 + 82 = 230 pemeriksaan lulus, 0 gagal.

## Terdaftar di aplikasi

`pages/index.js` — page key `rap_compare`, masuk daftar pengecualian tombol
"Perbarui" (halaman ini tidak punya data sendiri untuk dimuat ulang).
