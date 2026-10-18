# PURCHASING — READY FOR DAT REVIEW (paket akhir, 18 Oktober 2026)

**Kartu:** `t_2e5ef03c` — [Pra-review DAT] Paket akhir setelah seluruh audit, regresi dan artefak preview
**Pekerja:** bamboo-tech (implementasi/paket). **BUKAN** gatekeeper independen.
**Gate akhir:** Brooklyn `t_987f2c96` — belum dijalankan. Dokumen ini **tidak** menyatakan semua bisnis siap.
**Waktu paket:** 18 Okt 2026 ~21:15 WIB/CST.

| Item | Nilai |
|---|---|
| Branch paket | `feat/final-package-20261018` |
| Worktree | `/home/ubuntu/dev-workspaces/purchasing-final-package-20261018` |
| HEAD (dokumen ini) | lihat `git log -1` di worktree; commit sesudah `bdddd7d` **hanya docs/log uji** |
| Kode aplikasi yang dibangun | `bdddd7d` (diverifikasi: `git diff bdddd7d..HEAD -- components modules lib pages styles migrations public package.json next.config.js` = **kosong**) |
| Basis | `1d364e7` (integrasi 8h) |
| BUILD_ID | `IcSFkquFW77CZf0zQ3JeV` |
| Artefak rilis (immutable) | `/home/ubuntu/dev-workspaces/purchasing-final-package-release-20261018` |
| Manifest | `state/release-manifest.json` + `state/next-files-sha256.txt` (sha256 manifest `8ee4289c…`, 96 file) |
| Bukti regresi+E2E | `docs/integration-evidence-20261018-200440.json` |
| Staging 3001 | **BELUM diswitch** — masih `GyzaWYEcq009kHRu9esvy` (rilis 8h) |

---

## 1. Ringkasan satu paragraf

Paket ini mengumpulkan seluruh artefak audit S3/S4/S5/S6/S7 ke dalam satu worktree, **mereproduksi** temuan yang memang nyata, memperbaiki **7 cacat** di kode aplikasi (semua dengan bukti "sebelum" tersimpan), lalu menjalankan regresi penuh + E2E terhadap build yang benar-benar disajikan: **46 suite/entry, 43 hijau, 2.887 assertion lulus, 4 gagal yang semuanya berada di 3 suite yang sudah merah sejak baseline**. Build terisolasi exit 0 tanpa warning. Tidak ada migrasi, tidak ada route API baru, tidak ada DB write/DDL, tidak ada push, tidak ada switch preview. Yang **belum** dan tidak bisa dikerjakan dari sini: seluruh persistence DB (ledger/CRM/invoice/RAP), perbaikan snapshot 70% di server, dan aktivasi receiving/retur per barang — semuanya terhalang kredensial database.

---

## 2. Kriteria — READY / BLOCKED / PENDING

### 2.1 Temuan audit FN-* (REVIEW-03)

| Kriteria | Status | Bukti |
|---|---|---|
| FN-EST_LABEL — estimasi WBS tidak disebut aktual, aktual `tukang_projects` dipisah | **READY** | `scripts/fn-repro/run.py` 46 ok/0 FAIL; baseline `verify_baseline_red.py` 18 ok/**28 FAIL** (harness terbukti tidak tautologis) |
| FN-TARGET70 — target 70% rupiah utuh di sisi klien | **READY (klien)** | `lib/money.js`; 46 ok. **Catatan koreksi:** klaim audit "43.300.000 → 30309999.999999996" TIDAK ter-reproduksi; cacat nyata = pecahan sen pada revenue desimal |
| FN-PRINTREF — rujukan baris fiktif `(1 − 5)` di dokumen cetak | **READY** | `scripts/fn-repro` + `rap-audit` 36/36 |
| FN-TARGET70 sisi SERVER (`close_project` RPC `revenue*0.7`) | **BLOCKED** | `migrations/2026-10-10_planning_closing.sql:141` masih `* 0.7`; butuh migrasi aditif → butuh kredensial DB |

### 2.2 Temuan audit S3 (RAP/pagu/variance/margin) — `t_18652eb1`

| Kriteria | Status | Bukti |
|---|---|---|
| Suite audit S3 diadopsi & dijalankan dari paket ini | **READY** | `scripts/rap-audit/run.py` (36/36 + probe Infinity/NaN + probe pagu/variance + verifikasi CSV) |
| Fixture negatif Infinity/locale | **READY (terdokumentasi)** | 22 probe, 14 cacat terkonfirmasi, 0 kapabilitas hilang. Reachability dari DB **belum terbukti** (numeric Postgres) — dinyatakan apa adanya |
| Fixture negatif pagu/variance `rap-compare` | **READY** | 19 probe, 0 cacat, 0 kapabilitas hilang |
| FN-RUPIAH_LOCALE (`toNum('1.250.000')`) | **READY (DIPERBAIKI)** | Lihat §3 no. 6 |

### 2.3 Temuan audit S4 (termin/pembayaran/piutang/cashflow) — `t_108ebc3e`

| Kriteria | Status | Bukti |
|---|---|---|
| Suite S4 diadopsi & dijalankan | **READY** | `scripts/sales-invoice-payment-test/run.py`: **51 lulus, 0 gagal**, 7 finding tersisa |
| B7/B8 `payment_ref` dipotong diam-diam | **READY (DIPERBAIKI)** | Sekarang ditolak `PAYMENT_REF_TOO_LONG`; assertion lama (yang mengunci pemotongan) diubah jadi mengunci penolakan. Bukti sebelum: `docs/final-package/pre-fix/s4-payment-PRE-FIX.log` |
| C7 hari dihitung UTC (WIB pagi bergeser −1 hari) | **READY (DIPERBAIKI)** | `todayISO`/`toDateOnly` → kalender `Asia/Jakarta`; C4/C5/C6/C7 kini mengunci perilaku benar |
| D4 label KPI "Total Invoice" terbaca sebagai omzet | **READY (DIPERBAIKI label)** | Kartu kini: "semua status termasuk draf & batal — bukan omzet" |
| D7 `LUNAS` tanpa `paid_amount` dihitung lunas penuh | **READY (DIPERBAIKI)** | Hanya `paid_amount` nyata dihitung; jumlah LUNAS tanpa bukti dilaporkan terpisah (`lunasTanpaBukti`) |
| A3 pembayaran sebagian (DP) ditolak `PAYMENT_AMOUNT_MISMATCH` | **BLOCKED** | Butuh skema termin/payment ledger → migrasi |
| A6/A6h satu invoice = satu proyek, invoice termin kedua tertahan DRAFT | **BLOCKED** | Butuh relasi induk/termin → migrasi |
| B1/B10 tidak ada ledger pembayaran (riwayat, koreksi, refund) | **BLOCKED** | Butuh tabel payment → migrasi |
| C3 piutang tidak dikurangi `paid_amount` | **BLOCKED (disengaja)** | Desain saat ini: outstanding dari status. Mengurangi tanpa ledger = mengarang sisa tagihan. Menunggu skema termin |
| C10 batas baca 1000 baris tanpa penanda "terpotong" | **PENDING** | Bukan regresi; perlu keputusan limit + penanda UI |

### 2.4 Temuan audit S5 (regresi lintas flow & anti-double-cost) — `t_796f8498`

| Kriteria | Status | Bukti |
|---|---|---|
| Suite S5 diadopsi & dijalankan | **READY** | `scripts/crossflow-regression-test/run.py`: A=35, B+C+E=44, D=**46** (naik dari 45), semua lulus |
| T2 `actualTanpaAngka` dead field (selalu 0) | **READY (DIPERBAIKI)** | Kini `rows − rowsAngka`; assertion D2 diperketat + assertion konsistensi baru |
| T1 handover DRAFT ganda saat double-click (select-then-insert) | **BLOCKED** | Butuh unique index `handovers(receiving_id)` atau RPC atomik → migrasi. **Tidak** ditambal dengan guard yang masih punya window balapan |
| T3 item tidak punya status retur sendiri | **BLOCKED** | Butuh kolom/enum baru di `pr_items` → migrasi |
| Anti-double-cost nota/handover/konfirmasi | **READY** | B1–B5 lulus (nota sama ditolak, nota kedua jadi dokumen terpisah, CAS `diserahkan_at`) |

### 2.5 Temuan audit S6 (KPI pertumbuhan/marketing/margin) — `t_13fd2d4a`

| Kriteria | Status | Bukti |
|---|---|---|
| Suite S6 diadopsi & dijalankan | **READY** | `scripts/growth-kpi-test/run.py`: F1/F2 26, F3/F5 30, F4/F6/F7 35, F8 35 = **126 assertion**, semua lulus |
| Gerbang kejujuran (null ≠ 0, estimasi ≠ aktual) | **READY** | F8 lulus; `toNum` diperbaiki (lihat §3 no. 6) |
| Angka KPI live (funnel, time-to-approval, margin leakage) | **BLOCKED** | Tabel `leads/touchpoints/campaigns/lead_handoffs` **belum ada**; suite memakai FIXTURE dan menyatakannya eksplisit |
| F6 stock turnover | **BLOCKED** | Tidak ada ledger movement; barang keluar tidak jadi pengurang; `materials` katalog global tanpa `project_id` |
| Repeat order dedupe | **READY (fixture)** | F4 lulus terhadap modul asli |

### 2.6 Temuan S7 (gate bisnis) — `t_ad749e3b`

| Kriteria | Status | Bukti |
|---|---|---|
| Enam deliverable S1–S6 diverifikasi ulang Bit | **READY (laporan)** | `docs/s7-audit-evidence/LAPORAN-TEMUAN-KRITIS-S7.md` |
| E1 snapshot `target_budget` 70% masih pecahan sen (server) | **BLOCKED** | Sama dengan FN-TARGET70 server |
| E2 restore gate G1–G7 | **BLOCKED** | backup konsisten ❌, restore drill ❌ (psql/pg_restore tidak terpasang), vault kosong ❌ |
| E5 `/api/marketing-contract` 503 `AUTH_NOT_CONFIGURED` | **READY (dinyatakan jujur)** | Fail-closed, **bukan** API fungsional; jangan dipresentasikan sebagai fitur jadi |
| E6 `project_closings.labor_cost` = estimasi WBS | **READY (dilabeli jujur)** | UI + dokumen cetak: "Aktual Upah Tukang (tukang_projects)" vs "Estimasi Upah Tukang (WBS Budgeting)" |

### 2.7 Integrasi Approval / Marketing / mobile

| Kriteria | Status | Bukti |
|---|---|---|
| Approval `8148465` diport + 2 regresi nyata ditutup (aksi per-item tak terjangkau, geometri baris 9 vs 6 sel + tombol Rincian kembar) | **READY** | `approval-item-action-test` **18 ok/0 FAIL**; `approval-queue-test` 60/60 |
| Marketing `7ce9414` diport utuh, draft-only, tanpa DB/outbound | **READY (draft-only)** | `marketing-test` 263/263 + `run_ui.py` 327/327 (dua lapisan, konflik nama runner diselesaikan) |
| Marketing persistence | **BLOCKED** | Tidak ada tabel; tidak diklaim tersimpan |
| Mobile `21bf216` (`.mobile-kode-sub`) | **READY** | 0 baris CSS dihapus |
| Target sentuh ≥44px & font input ≥16px (≤1024px) | **READY (diukur)** | `mobile_page_sweep.mjs`: 14 modul × 4 viewport = **56 kombinasi, 0 pelanggaran**; `mobile_ready_probe.mjs` 360/390/412/768/1024/1440 = 0 pelanggaran |
| Overflow BODY horizontal | **READY** | 0px di semua 56 kombinasi + desktop 1440 |
| Drawer: tombol tutup tidak ter-intercept scrim, Escape, scroll-lock, `inert`, BOQ `aside` tidak terhijack | **READY** | `mobile_unified_check` 20/20 pada build tersaji |
| `dvh` / `env(safe-area-inset-*)` di perangkat iOS nyata | **PENDING** | Hanya bisa divalidasi di Chromium emulation; dinyatakan sebagai batasan |

### 2.8 Keamanan & integritas (fixture negatif)

| Kriteria | Status | Bukti |
|---|---|---|
| 401 tanpa sesi pada `/api/sales-invoices` (GET/POST/PATCH), `/api/reminders`, `/api/marketing-contract` | **READY** | `security_http_check.mjs` **13 lulus / 0 gagal** pada build tersaji (port 3018) |
| Token pratinjau salah → 401 | **READY** | idem |
| Jalur 403 non-admin ada & `verifyAdmin` dipanggil sebelum baca/tulis | **READY** | idem (D1–D3) |
| Token pratinjau benar → tetap 503 `STORE_UNAVAILABLE` | **READY (fail-closed)** | Sengaja: produksi tanpa kredensial **tidak** boleh menulis file lokal |
| Invoice immutable (negatif): ubah nominal invoice terbit ditolak, nilai tidak berubah | **READY** | `sales-invoice-test` B7c `ISSUED_INVOICE_FROZEN`, B7d nominal utuh; B6j/B8e `TERMINAL_STATUS` |
| RAP BOM/negatif: handoff barang jadi ditolak, harga −100 ditolak (tidak dikoersi ke 0) | **READY** | `rap-test` G1/G2/G7/G8/G10 + G11–G22 positif |
| Anti-double-cost | **READY** | `crossflow-regression-test` B1–B5 |
| Runtime mobile pada viewport wajib | **READY** | §2.7 |

### 2.9 Build & artefak rilis

| Kriteria | Status | Bukti |
|---|---|---|
| Build terisolasi satu-per-satu (RAM cap 768MB) | **READY** | `ENABLE_SMOKE=1 … NODE_OPTIONS=--max-old-space-size=768 npx next build` → exit 0, 0 warning, 14 route |
| BUILD_ID & commit sumber tercatat | **READY** | `state/release-manifest.json` |
| Direktori rilis immutable | **READY** | `.next` + `state` di-`chmod a-w`; checksum 96 file |
| Readback build rilis di port terpisah (3018) | **READY** | `/` 200, `/__smoke` 200, `/api/sales-invoices` 401, HTML memuat `IcSFkquFW77CZf0zQ3JeV`, security 13/13, mobile 20/20 + sweep 56/56 |
| Switch preview 3001 | **PENDING (sengaja)** | Skrip `switch_preview_final_package.sh` default dry-run; `--apply` **menolak** bila manifest belum mencatat `approved_by`. Live 3001 tetap `GyzaWYEcq009kHRu9esvy` |
| Push produksi / ganti `.next` live | **TIDAK DILAKUKAN** | — |

---

## 3. Tujuh cacat yang diperbaiki di paket ini (dan cara membuktikannya)

Semua perbaikan mengikuti pola yang sama: assertion lama yang **mengunci perilaku cacat** dijalankan dulu (log tersimpan), lalu diubah menjadi assertion yang mengunci perilaku benar. Log "sebelum" ada di `docs/final-package/pre-fix/`.

| # | Cacat | Dampak bisnis | Perbaikan | Bukti sebelum → sesudah |
|---|---|---|---|---|
| 1 | `payment_ref` dipotong diam-diam ke 80 char | Nomor transfer/VA tidak cocok dengan bukti bank saat rekonsiliasi | Ditolak `PAYMENT_REF_TOO_LONG` (operator memendekkan sendiri) | S4 B7/B8: dulu "dipotong ke 80" ok → kini "DITOLAK"; ref wajar & tepat 80 char tetap utuh |
| 2 | `todayISO`/`toDateOnly` pakai UTC | Di WIB pagi, invoice jatuh tempo HARI INI masuk "due_soon" → penagihan telat 1 hari | Tanggal kalender `Asia/Jakarta` | S4 C4: `2026-10-17` → `2026-10-18`; C5: −1 → 0; C7 baru: kemarin = overdue 1 hari |
| 3 | KPI "Lunas Terverifikasi" pakai `paid_amount \|\| grand_total` | Invoice LUNAS tanpa bukti dihitung lunas penuh | Hanya `paid_amount` nyata; jumlah tanpa bukti dilaporkan | S4 D6: 30.000.000 → 0; D6b baru: `lunasTanpaBukti = 1` |
| 4 | Label KPI "Total Invoice" mudah dibaca sebagai omzet | Salah tafsir laporan keuangan | Subteks eksplisit "termasuk draf & batal — bukan omzet" | S4 D4: dari *finding* → assertion label |
| 5 | `actualTanpaAngka` selalu 0 (dead field) | Pesan "N baris belum ada angka" tidak pernah muncul | `rows − rowsAngka` | S5 D2: 0 → 1; + assertion konsistensi `Angka + TanpaAngka = Rows`; D total 45 → 46 |
| 6 | `toNum('1.250.000')` → `NaN`; `toNum('3 dus')` → `3` | **Baris nota dengan subtotal null DIBUANG diam-diam** oleh `buildSavePlan` → total nota & biaya proyek lebih kecil dari kenyataan; satuan hilang senyap | Pemisah ribuan id-ID dibaca benar; teks bersatuan DITOLAK (NaN) sehingga validasi menampilkan error | S6 F8: `NaN` → `1250000`; `3 dus` → `NaN`; `abc` → `NaN` (dulu 0 senyap) |
| 7 | Tombol "Export Semua Data (Excel)" 33px di 768px; `.boq-link-btn` 24px & `.boq-template-pill` 28px | Target sentuh di bawah 44px di tablet/ponsel | Kelas `.btn-export-all` per-breakpoint; prefix `.boq-root` di globals.css (tanpa `!important`) | Sweep 56 kombinasi: 9 pelanggaran → **0** |

Yang **sengaja tidak diubah**: tombol "Hapus Vendor" (34px). Itu aksi sekunder yang di-discourage menurut keputusan `t_e626b674`; probe mengecualikannya **secara eksplisit dan terdokumentasi**, bukan diam-diam.

---

## 4. Angka regresi (dibaca dari artefak, bukan ingatan)

`docs/integration-evidence-20261018-200440.json` (commit `bdddd7d`, E2E terhadap server 3017):

```
suite/entry        : 46   (36 suite lokal + 10 E2E HTTP)
hijau              : 43
merah              : 3   (semuanya pra-ada, lihat di bawah)
assertion terparse : 2.564 lulus / 4 gagal
+ dari log mentah  :   323 lulus / 0 gagal
TOTAL terbaca      : 2.887 lulus / 4 gagal
durasi             : 145 s
```

Suite yang masuk runner paket ini (tidak ada di runner lama): `rap-audit` (36), `sales-invoice-payment-test` (51), `crossflow-regression-test` (125), `growth-kpi-test` (126), `fn-repro` (46), `approval-item-action-test` (18).

### Tiga suite merah — semua terbukti pra-ada, bukan regresi paket ini

| Suite | Merah | Pembanding baseline | Kesimpulan |
|---|---|---|---|
| `rab-boq-render-test` | 2 (F1 `font-weight ≥ 800`, F2 kontras ivory) | identik di baseline `18fb594` | pra-ada |
| `ui-olive-tokens-test` | 1 (`font-weight: 750` ×2) | `git show 1d364e7:styles/globals.css` → **2** kemunculan; sekarang juga **2** | pra-ada |
| `s7-compact-test` | 1 (blok CSS duplikat) | `verify_dup_baseline.py`: baseline 315 = sekarang 315, **+0 selector baru**, 0 hilang | pra-ada; dedup CSS memang tidak dikerjakan |

**Tidak ada assertion yang dilonggarkan** untuk membuat suite hijau. Yang diubah hanya assertion yang mengunci perilaku cacat (7 cacat di §3), dan setiap perubahan disertai log "sebelum".

---

## 5. E2E pada build yang benar-benar disajikan (port 3018 = artefak rilis)

| Pemeriksaan | Hasil |
|---|---|
| `/` , `/__smoke` | 200, 200 |
| HTML memuat BUILD_ID | `IcSFkquFW77CZf0zQ3JeV` ✔ |
| `/api/sales-invoices` tanpa sesi | 401 |
| `security_http_check.mjs` | **13 lulus / 0 gagal** |
| `mobile_unified_check.mjs` | **20 lulus / 0 gagal** |
| `mobile_ready_probe.mjs` (360/390/412/768/1024/1440) | **0 pelanggaran** |
| `mobile_page_sweep.mjs` (14 modul × 4 viewport) | **56 kombinasi, 0 pelanggaran** |

---

## 6. Kartu lama yang diblokir — mana yang benar-benar terpenuhi?

| Kartu | Status board | Yang sudah terpenuhi | Yang masih kurang |
|---|---|---|---|
| `t_03b41644` DB master (bandeng) | **blocked** | Desain + `SCHEMA_INVENTORY.md` + data dictionary + 4 file migrasi aditif **draft** + runbook backup | Kredensial PostgreSQL (tidak ada di VPS/vault), `psql/pg_dump/pg_restore` tidak terpasang, backup konsisten + restore drill belum bisa dijalankan. **Gate G1–G7 belum terpenuhi** |
| `t_7bc6246b` receiving/retur bagian 2 | **todo** (dependency) | Bagian tanpa skema selesai & di-review (2 MAJOR diperbaiki: label vendor salah, retur ganda). Branch `feat/receiving-simplify/t_7bc6246b` **tidak** di-merge wholesale karena UI fisik kini hanya di Handover | Aktivasi path READY (RPC `receipt_apply_events`/`handover_confirm`/`return_create`, tabel `receiving_events`/`handover_items`/`return_cases`/`return_lines`, RLS SELECT `return_lines`) hanya teruji terhadap mock → butuh migrasi |
| `t_eebe4678` mobile | **blocked** | Navigasi/overlay diperbaiki & **diverifikasi ulang pada paket ini** (drawer 20/20, 56/56 sweep, 0 overflow); polish `.mobile-kode-sub` diport | Belum VERIFIED oleh Brooklyn; `dvh`/safe-area/soft-keyboard belum divalidasi di iOS nyata |

**Catatan penting:** `t_7bc6246b` di board berstatus `todo` dengan `unsatisfied_parents = [t_03b41644]`. Paket ini **tidak** mengubah status kartu-kartu itu dan **tidak** mengklaim DB siap.

---

## 7. Batasan yang harus dibaca DAT (jujur, tanpa diperhalus)

1. **Tidak ada persistence database.** Tidak ada satu pun tulis DB/DDL dijalankan. Ledger receiving, payment ledger, CRM customer, marketing tables, RAP persistence, dan stock movement **belum ada tabelnya**. Semua modul terkait berjalan **draft-only / read-only** dan menyatakannya di UI.
2. **`/api/marketing-contract` 503 `AUTH_NOT_CONFIGURED`** adalah *fail-closed*, **bukan** API fungsional. Jangan dipresentasikan sebagai fitur jalan.
3. **E1 belum tertutup**: `close_project` RPC masih `revenue * 0.7` di server. Perbaikan paket ini hanya di klien. Untuk revenue desimal, `project_closings.target_budget` **bisa** tersimpan berpecah sen dan perbandingan HEMAT/OVER membaca kolom snapshot itu. Belum ada snapshot salah tersimpan (tidak ada DB write), jadi belum merusak data.
4. **`project_closings.labor_cost` = estimasi WBS**, bukan upah terbayar; provenance per baris tidak ada. UI & dokumen cetak sudah dilabeli jujur.
5. **Angka KPI pertumbuhan = FIXTURE**, bukan angka live (tabel marketing belum ada; stock turnover tidak bisa dihitung tanpa ledger movement).
6. **`dvh`, `env(safe-area-inset-*)`, dan soft-keyboard** hanya diuji di Chromium emulation — butuh perangkat iOS nyata untuk konfirmasi visual.
7. **Pembayaran sebagian (DP) tidak bisa dicatat** (`PAYMENT_AMOUNT_MISMATCH`), dan satu invoice = satu proyek sehingga invoice termin kedua tertahan DRAFT. Ini **batasan skema**, bukan bug yang bisa ditambal di UI.
8. **Handover DRAFT ganda saat double-click** masih mungkin (select-then-insert tanpa unique index). Tidak ditambal dengan guard yang masih punya window balapan — menunggu migrasi.
9. **Dedup CSS (315 blok duplikat)** tidak dikerjakan. Terbukti tidak bertambah (+0 selector baru), tetapi tetap terbuka.
10. **`next start` wajib setelah `next build`.** Server yang hidup saat rebuild menyajikan `_buildManifest.js` lama → chunk 400 → halaman ter-SSR tapi React tidak hydrate. Ini sempat membuat satu verifikasi mobile saya gagal (52 "pelanggaran") sebelum server di-restart; angka final di §5 diambil setelah restart.

---

## 8. Yang belum boleh dilakukan sebelum Brooklyn (`t_987f2c96`)

- **Jangan** switch preview 3001 (skrip menolak `--apply` selama `approved_by` kosong di manifest).
- **Jangan** jalankan migrasi apa pun (gate backup/restore belum terpenuhi).
- **Jangan** menyatakan "semua bisnis siap", "database siap", atau "ledger aktif".

### Perintah switch (hanya setelah Brooklyn mengisi `approved_by`)

```bash
cd /home/ubuntu/dev-workspaces/purchasing-final-package-20261018
bash scripts/integration-test/switch_preview_final_package.sh            # dry-run
bash scripts/integration-test/switch_preview_final_package.sh --apply    # setelah approval
bash scripts/integration-test/switch_preview_final_package.sh --rollback # kembali ke rilis 8h
```

### Cara memverifikasi ulang sendiri (semua bisa dijalankan tanpa DB)

```bash
cd /home/ubuntu/dev-workspaces/purchasing-final-package-20261018
python3 scripts/integration-test/run_all.py            # 36 suite lokal
python3 scripts/fn-repro/run.py                        # 46 ok (temuan REVIEW-03)
python3 scripts/fn-repro/verify_baseline_red.py         # bukti harness MERAH di baseline
python3 scripts/rap-audit/run.py                        # S3
python3 scripts/sales-invoice-payment-test/run.py       # S4
python3 scripts/crossflow-regression-test/run.py        # S5
python3 scripts/growth-kpi-test/run.py                  # S6
python3 scripts/integration-test/summarize_evidence.py  # angka dari artefak
```

Untuk E2E: jalankan server dari **artefak rilis** (bukan worktree), lalu
`E2E_BASE=http://127.0.0.1:<port> python3 scripts/integration-test/run_all.py`.

---

## 9. Status kartu ini

**Paket disiapkan, menunggu verifikasi Brooklyn.** Bukan sertifikasi produksi, bukan klaim seluruh bisnis siap. Verifikasi independen dan keputusan switch preview ada di tangan Brooklyn (`t_987f2c96`).
