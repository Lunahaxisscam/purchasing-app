# Laporan Audit — Termin, Pencatatan Pembayaran, Piutang & Cashflow

- Kartu: t_108ebc3e
- Branch: feat/payment-audit/t_108ebc3e (worktree wt-s4-payments, base commit 1d364e7)
- Tanggal: 2026-10-18
- Sifat: AUDIT ONLY — tidak ada file aplikasi yang diubah.
- Bukti: `python3 scripts/sales-invoice-payment-test/run.py`
  → SEMUA HARNESS LULUS, 46 assertion lulus, 0 assertion gagal, 10 finding terkonfirmasi.

---

## 1. Termin & jatuh tempo

### F-A1/F-A2 — Termin hanya teks bebas
Termin disimpan sebagai satu string bebas (batas 120 karakter) di field
`payment_terms`. Tidak ada skema terstruktur: tidak ada daftar termin, tidak ada
persentase per tahap, tidak ada tanggal per tahap. Konsekuensinya, termin
"DP 50% + pelunasan 50%" hanya teks — sistem tidak bisa menghitung apa pun
daripadanya.

### F-A3 — Pembayaran sebagian (DP) ditolak
LUNAS mewajibkan `paid_amount` sama persis dengan `grand_total`
(`PAYMENT_AMOUNT_MISMATCH`). Membayar DP Rp 50.000.000 dari tagihan
Rp 100.000.000 → ditolak, status tetap TERBIT, tidak ada konsep
"dibayar sebagian". Ini yang membuat termin DP pada proyek custom furniture
(NOIR LIVING menagih DP sebelum produksi) tidak bisa dicatat di sistem.

### F-A6/F-A6h — Pecah invoice termin bertabrakan dengan guard proyek
Workaround "pecah jadi 2 invoice" juga tertutup: 1 invoice = 1 proyek.
Invoice pelunasan untuk kode proyek yang sama ditolak guard klaim
(`DUPLICATE_PROJECT_CODE`, 409) saat TERBIT, sehingga invoice kedua tertahan di
DRAFT selamanya. Tidak ada relasi "invoice induk/termin" antar-invoice.

### F-A7 — Jatuh tempo opsional
`due_date` boleh kosong dan lolos validasi kontrak (hanya divalidasi
`DUE_BEFORE_ISSUE` bila diisi). Invoice tanpa jatuh tempo = tidak pernah masuk
daftar tagihan, tidak ada peringatan.

---

## 2. Pencatatan pembayaran (payment ledger)

### F-B1/F-B10 — Tidak ada ledger pembayaran
Bukti bayar hanya snapshot field tunggal di baris invoice:
`paid_amount`, `paid_at`, `payment_ref`, `payment_terms`,
`payment_verified_at`, `payment_verified_by`. Tidak ada tabel/entitas payment
terpisah, tidak ada riwayat. Artinya:
- tidak bisa merekam 2 pembayaran untuk 1 invoice (termasuk cicilan);
- salah input nominal tidak bisa dikoreksi — LUNAS bersifat final
  (`TERMINAL_STATUS`, sengaja menurut kontrak), satu-satunya jalan adalah
  batalkan seluruh invoice;
- refund/koreksi tidak terwakili sama sekali.

### F-B7/F-B8 — Referensi pembayaran dipotong diam-diam
`payment_ref` dipotong ke 80 karakter tanpa tanda truncation dan tanpa error
(ref 88 karakter → tersimpan 80 karakter). Nomor transfer/VA yang panjang jadi
tidak cocok dengan bukti bank asli — berisiko saat rekonsiliasi.

Catatan positif (bukan temuan): pembayaran ulang pada invoice yang sudah LUNAS
ditolak (`NOOP_TRANSITION`) sehingga `payment_ref` pertama tidak tertimpa, dan
`verified_by` tidak bisa dipalsukan dari body — diambil dari sesi admin.

---

## 3. Piutang & overdue

### F-C3 — Piutang tidak dikurangi pembayaran
`invoice_due` (reminders) mendefinisikan outstanding dari daftar status
(TERBIT/DISETUJUI/TERKIRIM) dan memakai `grand_total` penuh. Data dengan
`paid_amount` parsial (mis. hasil importer) tetap dihitung piutang 100%.
Detail reminder tidak menyebut "sisa setelah pembayaran".

### F-C7 — Hari dihitung UTC, bukan WIB
`todayISO` memakai UTC; nol penanganan Asia/Jakarta di seluruh
`scripts/reminders/*.js` maupun `modules/sales-invoice/*.js`, dan tidak ada
konfigurasi TZ di `vercel.json`/package.json. Pada WIB pagi (18 Okt 09:00 WIB)
`asOf` = 2026-10-17, sehingga invoice yang jatuh tempo 18 Okt masuk bucket
"due_soon" bukan "overdue" — penagihan terlambat satu hari. Bila DAT menjadwalkan
laporan pagi, seluruh angka hari overdue bergeser −1.

### F-C10 — Batas baca 1000 baris
`collect.js` memakai `DEFAULT_ROW_LIMIT = 1000` (maks 5000). Piutang di atas
1000 invoice terpotong tanpa penanda "terpotong" — laporan terlihat lengkap
padahal sebagian invoice tidak pernah dibaca.

### F-C8/F-C12 — Tidak ada aging & pembeda status
Tidak ada aging bucket (0–30/31–60/61–90/>90 hari) untuk piutang, dan tidak ada
pembeda status antara TERKIRIM (dokumen sudah ke klien) dan TERBIT (belum
diserahkan) di reminder — keduanya identik. Piutang yang paling layak ditagih
(dokumen sudah diterima klien) tidak dibedakan dari yang belum dikirim.

---

## 4. Cashflow & KPI

### F-D4 — "Total Invoice" bukan omzet
KPI di `modules/sales-invoice/view.jsx` menjumlahkan SEMUA status termasuk
DRAFT, BATAL, dan DITOLAK ke dalam "Total Invoice". Contoh uji: 7 invoice
bernilai Rp 247.000.000 (termasuk draft Rp 7jt, batal Rp 10jt, ditolak
Rp 50jt) → label "Total Invoice Rp 247.000.000" mudah dibaca sebagai omzet,
padahal yang benar-benar tertagih baru Rp 30.000.000 dan piutang Rp 200.000.000.
DITOLAK klien ikut terhitung "total" tanpa filter.

### F-D7 — LUNAS tanpa paid_amount tetap dihitung lunas penuh
KPI memakai `inv.paid_amount || amount`. Bila `paid_amount` null/kosong, KPI
jatuh ke `grand_total` — data tidak konsisten tertutupi, bukan terdeteksi.
Mesin reminder punya rule `missing_evidence` untuk mendeteksi bukti bayar
tidak lengkap, tetapi rule itu tidak dipakai oleh UI.

### F-D8 — Tidak ada KPI kas masuk
Tidak ada metrik cashflow (kas masuk per periode/bulan), tidak ada perbandingan
periode. Laporan piutang berbasis reminder hanya list + ringkasan, bukan angka
kas.

---

## 5. Regresi (anti klaim palsu)

Section E memastikan temuan di atas adalah keterbatasan skema, bukan regresi
dari audit ini — dengan menguji apa adanya:
- kontrak S4 tetap utuh: DRAFT→LUNAS ditolak, LUNAS final, TERBIT→LUNAS
  diizinkan, bukti wajib, `verified_by` dari sesi;
- reminders tetap read-only/dry_run, side_effects nol, sumber tidak tersedia →
  BLOCKED (bukan "0 temuan"), overdue 8 hari → critical.

Baseline yang sudah lulus sebelumnya: `scripts/sales-invoice-test` 438
assertion, `scripts/reminders-test` 243 assertion — tidak diubah oleh audit ini
(nol file aplikasi dimodifikasi, `git diff` kosong).

---

## 6. Ringkasan prioritas (rekomendasi, bukan bagian audit)

| # | Temuan | Dampak | Arah perbaikan |
|---|--------|--------|----------------|
| 1 | Termin/DP tidak bisa dicatat (A3, A6h) | DP 50% proyek custom mustahil dicatat; workaround 2-invoice tertahan guard proyek | Skema termin (baris per termin) + pembayaran sebagian |
| 2 | Tidak ada payment ledger (B1, B10) | Salah input tak bisa dikoreksi; 2 pembayaran/invoice mustahil | Tabel `invoice_payments` (1..n) |
| 3 | Piutang = nominal penuh (C3) | Angka piutang terlalu besar jika ada pembayaran parsial | Kurangi `paid_amount`/sum pembayaran |
| 4 | Hari UTC vs WIB (C7) | Penagihan telat 1 hari di pagi hari | Pakai Asia/Jakarta untuk `asOf` |
| 5 | Batas 1000 baris (C10) | Piutang besar terpotong diam-diam | Tandai truncated + paginasi |
| 6 | KPI "Total Invoice" (D4, D7) | Omzet terbaca berlebihan (draft/batal/ditolak ikut) | Pisahkan label: total/omzet/piutang/lunas |
| 7 | payment_ref dipotong (B7) | Rekonsiliasi gagal cocok | Naikkan limit + tandai truncation |

Bukti eksekusi: /home/ubuntu/dev-workspaces/wt-s4-payments/scripts/sales-invoice-payment-test/run.py
(46 assertion, 10 finding; exit 0 = harness & temuan konsisten).
