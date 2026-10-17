# Laporan Integrasi 8 Jam — t_35cd0354

**Integrator:** Bamboo (bamboo-tech) · **Tanggal:** 18 Oktober 2026 WIB
**Status kartu:** implementasi + verifikasi SELESAI, **RILIS STAGING DITAHAN** menunggu approval independen Brooklyn atas commit ini.
**Bukan** klaim "modul operasional lengkap": tabel DB baru belum ada, dan dua suite gaya masih merah karena sebab yang sudah terbukti di baseline.

---

## 1. Identitas pekerjaan (angka yang bisa dibaca ulang)

| Hal | Nilai |
|---|---|
| Branch integrasi | `feat/integration-8h-18okt` |
| Commit HEAD (kode + uji + laporan) | `ddf0c892a11ff053b5e8e9d96789b06ace2a86da` (`ddf0c89`) |
| Commit kode terakhir sebelum laporan | `3d6b0a6` (isi kode identik; `ddf0c89` hanya menambah dokumen + bukti) |
| Base | `main` @ `18fb594` (tidak diubah, tidak di-push) |
| Worktree integrasi | `/home/ubuntu/dev-workspaces/purchasing-8h-integration` |
| Worktree artefak rilis | `/home/ubuntu/dev-workspaces/purchasing-8h-integration-release` |
| BUILD_ID artefak rilis | dibaca dari `state/release-manifest.json` di worktree rilis (BUILD_ID Next di-generate ulang tiap build, jadi tidak ditulis mati di laporan) |
| `origin/main` | tetap `3870ef7` — **tidak ada push** |
| Staging 3001 sekarang | `purchasing-staging-3001`, cwd `purchasing-staging-3001`, BUILD_ID `A7HPMJyVcpqYZEuyRHkjd` (**belum dialihkan**) |

Bukti mentah: `docs/integration-evidence-20261018-050817.json` dan seluruh log per suite di `docs/integration-logs/20261018-050817/`.

---

## 2. Apa yang digabung, apa yang sengaja TIDAK

### Digabung (serial, satu per satu)
| Sumber | Isi | Cara |
|---|---|---|
| `feat/ops-workflow-t_cde1b8ad` @ `fcaaa3e` | S1…S7 Bamboo + koreksi Brooklyn P0 (`ce4ef3a`,`8171d0c`) dan P1 (`fcaaa3e`) | `merge --no-ff` bersih, tanpa konflik |
| `feat/rap-compare-ui` @ `71e08dc` | Bit: Stok Workshop, Perbandingan RAB/RAP/Aktual, Customer CRM, Sprint-1 label/navigasi | merge dengan konflik CORE (diselesaikan manual) |
| `feat/mobile-responsive/t_eebe4678` @ `40d4441` | Perbaikan mobile Blossom/Bit | **port terpilih** (lihat §3), bukan merge penuh |
| `feat/rap-compare-ui` @ `d1553a1` (menyusul saat integrasi berjalan) | Bit S5: Actual Labor & Stok (`t_62e41e91`) | merge dengan konflik CORE (diselesaikan manual) |

### Sengaja TIDAK digabung
- `feat/receiving-simplify/t_7bc6246b` — **ditolak**. Branch ini memodifikasi `modules/receivings/*` dan menghidupkan lagi alur penerimaan fisik di Purchase, yang sudah resmi dibuang DAT (`t_9109cf5e`). Diverifikasi: `git merge-base --is-ancestor feat/receiving-simplify/t_7bc6246b HEAD` → **tidak** ancestor.
- `feat/approvals-s1-audit` — **belum ada commit** (`18fb594`, sama dengan main). Tidak ada yang bisa digabung; sesuai mandat, non-blocking.
- `feat/finance-tukang`, `feat/ops-workflow` — branch lama (base `99d6afc`, sebelum main sekarang); tidak membawa perubahan yang belum ada di jalur integrasi.

---

## 3. Keputusan resolusi file CORE (constants / registry / pages/index / ModuleView)

Tiga konflik "both-add" terjadi persis seperti yang diprediksi REVIEW-07. Semua diselesaikan dengan **mempertahankan kedua sisi**:

1. `lib/constants.js`
   - `labels`: `rap` (Bamboo) **dan** `stock`, `crm`, `labor_stock` (Bit) semuanya ada; `rap_compare` **ditambahkan** (sebelumnya hanya ada di `pages/index.js`, jadi judul halaman akan `undefined` — ini lubang yang saya tutup).
   - `navSections` Admin Suite: `rap_compare` **ditambahkan ke menu**. Tanpa ini, halaman Perbandingan RAB/RAP/Aktual hanya bisa dibuka dengan memanipulasi state — persis "stub yang tidak terhubung" yang dilarang mandat.
   - Semua rute lama tetap: `projects, vendors, materials, requests, approvals, receivings, handovers, past_projects, rab_boq, sales_invoice, planning, project_finance, finance, tukang_upah, settings`.

2. `modules/registry.js` — entri `rap` + `stock` + `rap_compare` + `crm` + `labor_stock` berdampingan, semuanya `adminOnly: true`, `source: 'core'`.

3. `pages/index.js`
   - Daftar exclude tombol "Perbarui" global = gabungan: `rap`, `rap_compare`, `crm`, `labor_stock` (dan yang lama).
   - Cabang render berurutan: `rap` → `rap_compare` → `stock` → `crm` → `labor_stock` → `settings`, semuanya **di-guard `role === 'admin'`** dengan fallback "Halaman ini khusus administrator."
   - **Temuan saya:** cabang `stock` dari Bit **tidak punya guard admin** (menu disembunyikan, tapi state bisa dipaksa). Saya tambahkan guard render-nya agar konsisten dengan modul admin lain. Dikunci oleh assertion wiring.

4. `components/ModuleView.js` — tidak ada konflik; tidak saya ubah.

### Port mobile terpilih (bukan merge penuh)
Branch mobile membawa objek symlink `node_modules` yang **tracked** → merge/cherry-pick penuh gagal (`untracked working tree file 'node_modules' would be overwritten`). Jadi:
- `git cherry-pick -n 6fe0908` (Sidebar drawer + `__mobile` harness + probe) — bersih.
- `1da59de` **tidak** di-cherry-pick; hanya diff `styles/globals.css`-nya yang di-`git apply -3` (tanpa `audit/` 21.000 baris dan tanpa symlink).
- `3b5ac94` (viewport tunggal) di-`git apply` bersih.
- Verifikasi: `git ls-files | grep -c '^node_modules'` → **0**; tidak ada blob `120000` yang terbawa.

**Bug nyata yang baru muncul setelah merge** (dan sudah diperbaiki): perbaikan mobile di awal `globals.css` **kalah cascade** oleh blok mobile lama yang datang dari sisi `main` di baris ~4187 (`aside, aside.app-sidebar` + `z-index: 100`). Akibatnya, setelah merge, tombol ☰/✕ **kembali ter-intercept scrim** dan `<aside class="boq-side">` **kembali** dijadikan drawer fixed/off-screen. Saya samakan perbaikannya di blok yang menang, lalu membuktikannya di Chrome nyata (lihat §6).

---

## 4. Perubahan yang saya buat sebagai integrator (bukan sekadar merge)

| # | Perubahan | Alasan (temuan) |
|---|---|---|
| 1 | `problemPlan` + `view.jsx`: semua teks "catat lewat modul Purchase" diganti instruksi rekonsiliasi jujur (`RECON_NOTE`) | REVIEW-02 P1: form fisik Purchase sudah dibuang; mengarahkan user ke sana = jalan buntu |
| 2 | Nama penerima serah terima **WAJIB** (tombol nonaktif + `submitTerima` menolak sebelum request) | REVIEW-02 P1: bukti serah terima tanpa nama tidak bisa dipertanggungjawabkan |
| 3 | Guard admin cabang `stock` | celah guard render (lihat §3.3) |
| 4 | `rap_compare` masuk `navSections` + `labels` + kartu dashboard | modul tidak boleh jadi stub tak terhubung |
| 5 | Kartu dashboard untuk `rap`, `rap_compare`, `stock`, `crm`, `labor_stock` | pintu masuk UI, bukan rute tersembunyi |
| 6 | `pages/__smoke.js` merender `RapCompareModule`, `StockModule`, `CrmModule`, `LaborStockModule` | supaya "bisa dibuka" dibuktikan oleh build, bukan oleh entri nav |
| 7 | Perbaikan cascade drawer mobile (blok duplikat) | regresi mobile nyata setelah merge (§3) |
| 8 | 3 assertion enumeratif diperbarui (RAP C6, marketing C7, RAB E7) + assertion e2e handover pakai label terlihat | assertion usang; **tidak** ada pengecualian yang dilonggarkan (§5.3) |
| 9 | Harness baru: `scripts/integration-test/{run_all.py,total_assertions.py,wiring_test.mjs,security_http_check.mjs,mobile_unified_check.mjs,switch_staging_3001.sh}` | bukti bisa diulang, bukan narasi |

Tidak ada perubahan schema, tidak ada migrasi, tidak ada RPC baru, tidak ada operasi tulis DB.

---

## 5. Hasil uji (dijalankan BERURUTAN, satu per satu)

Alasan berurutan: mesin ini hanya menyisakan < 1 GB RAM; dua `next build` paralel = OOM dan hasil tak bisa dipercaya.

### 5.1 Build
| Build | Hasil |
|---|---|
| `next build` (normal) | **exit 0**, `Compiled successfully` |
| `ENABLE_SMOKE=1 next build` | **exit 0**, `Compiled successfully`, rute `/__smoke` + `/__mobile` terdaftar |
| `next build` baseline `18fb594` (pembanding) | exit 0 (jadi kegagalan uji di bawah **bukan** soal build) |

### 5.2 Regresi: 36/38 entri hijau, 3.989 assertion lulus
Angka dihitung ulang dari log oleh `scripts/integration-test/total_assertions.py` (bukan dari ingatan). Ringkas per suite ada di `docs/integration-evidence-20261018-050817.json`.

Yang perlu disebut eksplisit:
- `rap-test` 371 · `sales-invoice-test` 438 · `reminders-test` 243 · `marketing-test` 263 · `crm-test` 247 · `rap-compare-test` 230 · `labor-stock-test` 159 · `stock-view-test` 129 · `handover-compact-test` 141 · `handover-flow-test` 200 — **semua hijau**.
- e2e HTTP terhadap server Next nyata: RAP 50, invoice 45, reminders 36, marketing 52, purchase 45, handover-compact 35, handover-flow 43, pr-print 14, security 13, **mobile unified 20** — semua hijau.
- `flow-gap-repro-test` bukan pass/fail (melaporkan 14/25 gap terbukti pada kode verbatim); dijalankan, exit 0.

### 5.3 Yang masih MERAH — dan klasifikasinya (bukan asumsi)

| Suite | Assertion merah | Klarifikasi |
|---|---|---|
| `rab-boq-render-test` | F1, F2 (2 dari 70) | **Pre-existing, terbukti**: dijalankan ulang di worktree bersih `18fb594` → `RENDER_TOTAL 70, FAIL 2` dengan assertion **identik** (heading sidebar `font-weight >= 800` & `var(--ivory)`). Log: `docs/integration-logs/…/baseline-18fb594-rab-boq-render-test.log` |
| `ui-olive-tokens-test` | C (1 dari 35) | **Pre-existing, terbukti**: baseline `18fb594` → `34 LULUS, 1 GAGAL`, `font-weight 750 ×2`. Log: `…/baseline-18fb594-ui-olive-tokens-test.log` |
| `rab-boq-test` E7 | dulu 1 merah → kini hijau | **Bukan regresi baru, dan bukan "otomatis pre-existing"**: assertion lama mencari literal `"'rab_boq', 'settings']"` (dua entri bersebelahan). Literal itu **sudah hilang di `18fb594`** karena `sales_invoice` masuk daftar exclude — jadi merah di baseline (log `…/baseline-18fb594-rab-boq-test.log`), lalu RAP/S3 menambah `'rap'` sehingga tetap merah. Saya ubah pengujiannya menjadi **keanggotaan daftar exclude** (semantik sama, tidak lebih longgar) → hijau. Ini **assertion usang**, bukan bug aplikasi. |
| `e2e handover-flow-test` 3a–4e | dulu 14 merah → kini hijau | **Bukan bug aplikasi**: assertion mencari teks modal `"Edit Handover"` / `"Tambah Handover"`, sedangkan sejak Sprint-1 label terlihat sudah `"Serah Terima"`. Dibuktikan bukan bug: baseline `18fb594` (label masih `Handover`) → 43/43 lulus; integrasi (label `Serah Terima`) → modal **benar-benar terbuka** (diagnostik: `dialogTitles` berisi `"Edit Serah Terima"`) tapi assertion tidak menemukannya. Assertion saya ubah ke `/(Handover|Serah Terima)/`. |

Catatan kejujuran: **tidak ada** assertion aplikasi yang saya longgarkan; yang saya ubah hanya cara assertion enumeratif mengenali teks/daftar yang memang berubah karena modul baru masuk.

---

## 6. Bukti keamanan & "modul benar-benar terhubung"

`scripts/integration-test/security_http_check.mjs` terhadap server Next nyata (13/13 lulus):
- `GET /api/sales-invoices` **401**, `POST` **401**, `PATCH` **401** (tanpa sesi; body tidak membocorkan data invoice).
- Token pratinjau salah → **401**.
- `GET /api/reminders` **401**, `GET /api/marketing-contract` **401**, `POST /api/reminders` **405**.
- Jalur 403 non-admin tetap ada & `verifyAdmin` dipanggil **sebelum** cabang method mana pun.
- Jalur 403 untuk "user valid tapi bukan admin" diuji penuh di harness in-process `scripts/sales-invoice-test/auth_api_test.mjs` (C2b-*), karena JWT Supabase sah tidak bisa dikarang tanpa kredensial — saya **tidak** mengklaim sudah mengujinya lewat HTTP.

`scripts/integration-test/wiring_test.mjs` (67/67 lulus): kelima modul baru ada di nav + labels + registry (`adminOnly`, `source:'core'`) + cabang `pages/index.js` dengan guard admin + dirender di `/__smoke`; modul lama tidak hilang; tidak ada penulisan DB di modul read-only.

`scripts/integration-test/mobile_unified_check.mjs` (20/20 lulus, Chrome nyata, sesudah merge): menu RAP/Perbandingan/Stok/CRM tampil; **tidak ada overflow horizontal** di 360/390/768/1024; drawer terbuka penuh; **tombol tutup tidak ter-intercept scrim**; scrim hilang saat ditutup; body tidak terkunci; kartu samping BOQ tidak dihidupkan sebagai drawer; **0 request tulis Supabase** selama audit.

---

## 7. Kesiapan staging & rollback (BELUM dieksekusi)

Artefak rilis sudah dibangun & diuji **di tempat terpisah**, bukan di `.next` yang aktif:
- `purchasing-8h-integration-release` = `.next` hasil build `ENABLE_SMOKE=1` + `package.json`/`next.config.js`/`.npmrc`/`public` + symlink `node_modules`. **BUILD_ID dan commit sumber dicatat di `state/release-manifest.json`** (satu-satunya sumber kebenaran; build sebelumnya diarsipkan di `state/prev-build-*/`).
- Dijalankan di **port 3016** (server bayangan) dengan env staging: `/` 200, `/__smoke` 200, `/api/sales-invoices` **401**, HTML memuat BUILD_ID yang sama, chunk `_app` **200**.
- `scripts/integration-test/switch_staging_3001.sh` siap: default **dry-run**, `--apply` hanya setelah approval, `--rollback` memulihkan snapshot (`state/before-*.json` + `pm2 jlist`), hanya menyentuh proses `purchasing-staging-3001`, dan **tidak** menjalankan `next build` di direktori aktif.
- Dry-run mencetak pasangan (cwd, BUILD_ID) sekarang → tujuan, dibaca langsung dari `state/release-manifest.json`.

**Kenapa belum saya switch:** mandat berbunyi "AFTER independent Brooklyn approval … switch PM2 preview 3001". Approval itu belum ada untuk commit `ddf0c89`. Menyajikan lebih dulu berarti klaim rilis tanpa izin.

---

## 8. Blocker & batasan yang tetap terbuka

1. **Skema DB belum ada** (PGRST205): `sales_invoices`, `customers`, `leads`, `lead_touchpoints`, `campaigns`, `lead_handoffs`. Tanpa itu modul terkait menampilkan capability `BLOCKED`/"belum tersedia" — bukan 0.
2. **Tidak ada RPC transaksional** untuk penerbitan invoice → masih CAS aplikasi + kompensasi best-effort; `SALES_INVOICE_REQUIRE_RPC=1` untuk fail-closed.
3. **RAP tetap DRAFT_ONLY** (tanpa tabel `rap_versions`); "Disetujui" adalah label lokal, bukan approval resmi.
4. **Stok belum dari movement ledger** — angka berasal dari `materials.current_stock`; yang tidak ada ditandai "Tidak tersedia".
5. **Retur per item belum mungkin** (butuh `handover_items`/retur schema); nota multi-item diblok dengan alasan jujur, bukan diklaim selesai.
6. **Format nomor invoice**: default `NL<yymm><XXX>` (Buku/Obsidian); `INV/NL` butuh gate ACK. Butuh keputusan DAT.
7. **Bandeng (S1–S7 audit bisnis) & Bit S6 lead pipeline & Bit S7 UX final** belum menyerahkan hasil — tahap bisnis belum lengkap.
8. **Mobile**: yang saya uji adalah `/__mobile` (harness) + `/__smoke`, bukan login produksi di perangkat nyata.

---

## 9. Permintaan untuk Brooklyn (gerbang rilis)

Mohon review commit **`ddf0c89`** (branch `feat/integration-8h-18okt`, worktree `purchasing-8h-integration`) dengan fokus:
1. Resolusi CORE (§3) — apakah semua rute & guard admin utuh.
2. Tiga perubahan perilaku (§4 no.1–3) — apakah instruksi rekonsiliasi & nama wajib sudah sesuai REVIEW-02.
3. Klasifikasi merah (§5.3) — apakah bukti baseline cukup untuk menyebut `rab-boq-render` F1/F2 & `ui-olive` C sebagai pre-existing, dan E7/e2e-handover sebagai assertion usang.
4. Apakah artefak `lVh3j-vT5c1tDFVbHfcAI` layak disajikan di port 3001.

Setelah approval tertulis, saya jalankan `switch_staging_3001.sh --apply` dan melaporkan readback (root 200, BUILD_ID disajikan, chunk 200, API 401) — **tanpa** push ke `origin/main`, tanpa DDL.
