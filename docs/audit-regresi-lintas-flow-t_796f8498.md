# Audit regresi lintas flow & anti-double-cost — t_796f8498

- **Pekerja:** bit-dev (Bit, Software Engineer Noir Living)
- **Tanggal:** 18 Oktober 2026
- **Branch:** `feat/regression-crossflow/t_796f8498` (commit f7df35c)
- **Baseline:** integration HEAD `1d364e7` (bukan finance `99d6afc`)
- **Worktree:** `/home/ubuntu/dev-workspaces/wt-s5-regression` (terisolasi)
- **Lingkup:** S5/7 — regression suite lintas flow + anti-double-cost

## Metode

Murni fixture/mock, **tanpa DB, tanpa jaringan, tanpa tulis data hidup**.
Modul ASLI (hasil transform SWC, bukan salinan logika) diuji terhadap mock
`supabaseClient` yang merekam semua operasi. Tidak ada satu pun file
aplikasi yang diubah — hanya harness + laporan.

```
python3 scripts/crossflow-regression-test/run.py
```

Jalankan dari root repo. Sandbox otomatis dibuat di
`/tmp/crossflow-regression-verify` (salin verbatim `modules/**` + `lib/**`,
rewrite specifier relatif, transform SWC, jalankan 3 suite).

## Hasil

**124 assertion, 124 lulus, 0 gagal** (exit 0).

| Suite | Fokus | Assertion |
|---|---|---|
| A | Alur penuh PR→Approval→Purchase→Handover | 35 |
| B | Anti-double-cost (nota/baris/handover/konfirmasi ganda) | 25 |
| C | Partial quantity | 9 |
| D | Laporan & KPI (RAB/RAP, labor, invoice, piutang) | 45 |
| E | Return/refund readiness | 10 |

Catatan: B, C, E berbagi satu counter di `guard_test.mjs` (B+C+E = 44);
angka B, C, E di atas adalah hitungan manual per blok.

## Apa yang TERBUKTI BENAR

**A. Alur penuh.** Cangkang nota dari Approval (RPC `ensure_item_in_purchase`)
dipakai ulang saat pembelian — header tidak diduplikasi, baris item tidak
diduplikasi, qty tertatat tepat. Barang yang sudah dibeli penuh hilang dari
antrean belanja. Handover DRAFT dibuat sekali per nota. Aksi gudang/tukang/
terima idempoten, dan `diserahkan_at` tidak bisa ditimpa.

**B. Anti-double-cost.** Nota sama (vendor + no nota) ditolak dengan pesan
yang menyuruh buka nota lama, bukan simpan ulang — nol insert kedua, nol
baris baru, nol handover baru. Nota kedua (hari berbeda, no nota beda)
menjadi dokumen terpisah tanpa menimpa nota lama. Shell nota yang sudah
jadi nota tidak dipakai ulang untuk pembelian berikutnya. Konfirmasi
handover ditulis sekali (CAS).

**C. Partial qty.** Beli sebagian → sisa tetap di antrean dengan qty sisa,
draft form memakai sisa (bukan qty PR penuh). Beli penuh → item hilang dari
antrean dan tidak muncul lagi meski status PR di-set ulang APPROVED.

**D. Laporan.** Aktual hanya dihitung dari baris bernilai; tanpa harga =
`null` (bukan 0), tertulis sebagai "—" dengan label jujur "bukan nol".
Aktual labor (`tukang_projects`) tidak dijumlahkan dengan estimasi WBS
(`project_plans`) — dua sumber dilaporkan terpisah. Pagu RAP hanya
dinilai bila nilainya diketahui. KPI invoice tidak menjumlah draft/batal.
Piutang dikurangi `paid_amount` parsial.

**E. Return/refund.** Retur sebagian menurunkan qty bersih (30→28) sambil
membiarkan nota utuh (uang sudah keluar). Sisa kebutuhan setelah retur
kembali muncul di antrean belanja — benar secara bisnis.

## TEMUAN (untuk Bamboo, dengan reproducer)

### T1 — Handover DRAFT bisa ganda saat balapan double-click

**Reproducer:** `scripts/crossflow-regression-test/guard_test.mjs` bagian B2.
Dua `savePurchase` dijalankan bersamaan (`Promise.all`) pada DB kosong.

**Penyebab:** `modules/receivings/purchaseSave.js` baris 246-269 membuat
handover dengan pola *select-then-insert*: baca `handovers` dulu, kalau
kosong baru insert. Dua request yang membaca sebelum salah satu menulis akan
sama-sama melihat "kosong" dan sama-sama insert. Tabel `handovers` tidak
punya unique index pada `receiving_id` (dicari seluruh repo — 0 hasil), jadi
DB tidak menolak duplikat.

**Akibat:** satu nota bisa punya 2 dokumen handover. Aksi gudang/tukang/
terima bisa dijalankan pada dokumen yang berbeda untuk barang yang sama —
distribusi fisik tercatat ganda. Dampak uang tidak langsung (baris item
dijaga unique index), tapi integritas distribusi rusak.

**Opsi perbaikan (butuh keputusan Bamboo):**
1. Unique index `handovers(receiving_id)` — migrasi DDL, perlu kredensial DB
   yang terverifikasi. Perubahan skema: putuskan di luar audit ini.
2. RPC atomic `enqueue_handover_for_receiving(receiving_id)` dengan
   `ON CONFLICT DO NOTHING` — sama-sama butuh migrasi.
3. Guard `insert().select().single()` + tangani 23505 sebagai sukses —
   tidak butuh migrasi, tapi masih ada window balapan.

Tidak diubah di sini: T1 menyentuh file aplikasi milik Bamboo.

### T2 — `summarizeLabor.actualTanpaAngka` selalu 0 (dead field)

**Reproducer:** `reporting_test.mjs` bagian D2.
Fixture 3 baris aktual, 1 baris tanpa angka → `actualTanpaAngka` = 0.

**Penyebab:** `modules/labor-stock/logic.js` baris 297-300 menghitung
`actualTanpaAngka` dari peta hasil `actualLaborByProject`, padahal fungsi
itu (baris 152-166) `continue` untuk baris tanpa angka sehingga baris itu
tidak pernah masuk peta. Nilai jujur = `actualRows - actualRowsAngka`.

**Akibat:** field ini tidak pernah menampilkan apa pun. Bila UI
mengandalkannya untuk bilang "N project belum ada angka", pesannya selalu
kosong. Tidak merusak total (total hanya menjumlah baris berangka).

**Perbaikan (jika disetujui):** hitung dari `actualRows.length -
actualRowsAngka`, atau hapus field-nya.

### T3 — Item tidak punya status retur sendiri

**Reproducer:** `guard_test.mjs` bagian E1.
**Fakta:** `pr_items.status` = ORDERED|APPROVED|RECEIVED|DI_GUDANG|DI_TUKANG
(sumber: `modules/handovers/actions.js` CATATAN SKEMA). `receivings.status` =
NORMAL|RETUR|REFUND (sumber: `modules/handovers/queue.jsx`).

**Akibat:** retur hanya bisa dicatat di level nota. Kalau 2 dari 10 Box
diretur, nota utuh tapi tidak ada penanda item mana yang kembali — sisa
kebutuhan menghitung dari `quantity_received` yang dikoreksi manual. Ini
batasan skema yang dibekukan, bukan bug logika.

**Catatan:** skema dibekukan tanpa kolom baru (ditegaskan di
`actions.js`). Perubahan apa pun di sini butuh migrasi + keputusan Bamboo.

## Cakupan yang TIDAK diuji (jujur)

- **DB sungguhan:** tidak ada koneksi (kredensial tidak tersedia di sesi
  ini). Semua perilaku DB (unique index, CHECK constraint, CAS) diemulasi
  di mock — emulasi bisa berbeda dari Postgres nyata.
- **UI/browser:** tidak diuji; fokus di logika modul.
- **Mobile controls:** tercakup S7 (t_2b64c71a), tidak diulang di sini.
- **Sales invoice modul asli:** kontrak diambil dari temuan S4
  (t_108ebc3e), diuji sebagai assertion kontrak di bagian D — bukan uji
  ulang modul itu.

## Keputusan yang TIDAK diambil (perlu arahan)

- Skema `handovers` (unique index vs RPC) — T1.
- Kolom baru untuk retur per-item — T3.
- Perbaikan dead field T2 — kecil, tapi tetap file aplikasi.

Tidak ada tulis data hidup, tidak ada perubahan file aplikasi, tidak ada
push ke staging/produksi.
