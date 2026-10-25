# Paket Pra-review DAT — laporan implementasi (t_7634fa92)

Worker: Bamboo (`bamboo-tech`). Tanggal: 18 Oktober 2026 WIB.
Branch: `feat/review-prep-20261018` — worktree `/home/ubuntu/dev-workspaces/purchasing-review-prep-20261018`.
Basis: `1d364e7` (HEAD integrasi `feat/integration-8h-18okt`).
HEAD paket: lihat `git rev-parse HEAD` saat review (commit terakhir di branch ini).

**Status dokumen ini: BUKTI IMPLEMENTASI, bukan sertifikasi kesiapan produksi.**
Kesiapan bisnis & verifikasi akhir adalah wewenang Brooklyn (gate independen).
Tidak ada klaim "siap produksi" di sini.

---

## 1. Ringkasan

| Item | Status |
|---|---|
| FN-EST_LABEL (MEDIUM) | **TERTUTUP** — estimasi WBS tidak lagi disebut riil/actual; aktual `tukang_projects` dipisah & tidak dijumlahkan |
| FN-TARGET70 (LOW) | **TERTUTUP** — target 70% selalu rupiah utuh; cacat sebenarnya (pecahan sen pada revenue desimal) diperbaiki |
| FN-PRINTREF (LOW) | **TERTUTUP** — rujukan `(1 − 5)` ke baris yang tidak ada diganti rujukan baris nyata |
| Integrasi Approval `8148465` | **DIPORT** + **2 regresi diperbaiki** (aksi per-item hilang, geometri 6 vs 9 kolom) |
| Integrasi Bit `7ce9414` (Marketing) | **DIPORT** — draft-only, tanpa DB, tanpa outbound |
| Integrasi Bit `21bf216` (mobile) | **DIPORT SEBAGIAN** — hanya perbaikan `.mobile-kode-sub`; dedup CSS **sengaja tidak** (lihat §6) |
| Regression suite | **27/30 hijau**, 2.243 assertion terbaca; 3 merah = **pre-existing terbukti** |
| `next build` terisolasi | **exit 0**, `BUILD_ID=vy5uNR6BUAU2AfmJPMp_U`, 0 warning, 14 rute |
| DB / migrasi / staging switch | **TIDAK ADA** (sesuai larangan) |

---

## 2. Commit di branch ini

```
081d11e test(integrasi): daftarkan approval-item-action-test di runner regresi
5f2f38a fix(approvals): pulihkan aksi per-item + perbaiki geometri baris compact
33a5054 merge(marketing,mobile): port 7ce9414 modul Marketing + 21bf216 perbaikan mobile
05ae7eb chore(gitignore): jangan commit artefak kompilasi harness (*.compiled.mjs)
c1890fb fix(finance): tutup FN-EST_LABEL, FN-TARGET70, FN-PRINTREF (REVIEW-03)
1548edd merge(approvals): port S1 compact + drawer detail 8148465 (label estimasi jujur)
1d364e7 (basis) docs(integrasi): catat Bit S6 lead-UI belum di-commit
```

Berkas yang berubah per commit terlihat dengan `git show --stat <hash>`.

---

## 3. FN-EST_LABEL — estimasi vs aktual (MEDIUM)

**Masalah.** `project_plans.labor_cost` adalah ESTIMASI upah dari WBS Budgeting,
tetapi dilabeli "Pengeluaran Riil (WBS)" (Planning) dan "Actual Tukang"
(ProjectFinance, Finance). Eksekutif membaca rencana sebagai realisasi.

**Perbaikan.**
- `lib/laborSource.js` (baru) — satu sumber kebenaran label:
  - `WBS_ESTIMATE_LABEL` = "Estimasi Upah WBS" (menyebut WBS)
  - `ACTUAL_WAGE_LABEL` = "Aktual Upah Tukang (tersinkron)" (menyebut sumber)
  - `actualLaborForProject()` membaca `tukang_projects.total_upah`; **null**
    bila tidak ada baris berangka (bukan 0)
  - dua sumber **tidak pernah** dijumlahkan; `variance` hanya bila keduanya ada
  - `projectKey` **setara** `modules/labor-stock/logic.js` (diuji langsung
    terhadap modul aslinya, 5 varian nama)
- `components/Planning.js` — kartu Manpower: "Pengeluaran Riil (WBS)" →
  "Estimasi Upah WBS". Material & Petty Cash **tetap** "Pengeluaran Riil"
  (keduanya memang realisasi Drive).
- `components/ProjectFinance.js` — kartu "Actual Tukang" → "Estimasi Upah WBS"
  + baris aktual tersinkron terpisah ("Rp X (N baris tukang_projects)" atau
  "belum ada catatan tersinkron"); banner dua-sumber di tab Tukang; kolom
  "Estimasi Upah (WBS)"; tooltip margin menyatakan komponennya estimasi.
- `components/Finance.js` — header tabel, kartu mobile, rincian cost, komentar
  OPSI C, modal closing, dan dokumen cetak memakai label estimasi.
- Arah sebaliknya juga dijaga: aktual **tidak** dilabeli estimasi.

**Bukti.** `scripts/fn-repro/run.py` → 46 ok / 0 FAIL.
`scripts/fn-repro/verify_baseline_red.py` → di baseline `1d364e7` **28 FAIL**,
membuktikan asersi bukan tautologi.

---

## 4. FN-TARGET70 — pembulatan (LOW), termasuk koreksi klaim audit

**Reproduksi jujur** (`scripts/fn-repro/repro_target70.mjs`):

| revenue | `round(rev*70)/100` (kode lama) | `rev*0.7` |
|---|---|---|
| 43.300.000 | **30.310.000** (tepat) | 30309999.999999996 |
| 99.999.999,99 | 69.999.999,99 (pecahan sen) | 69999999.99299999 |

Klaim REVIEW-03 bahwa revenue **bulat** 43.300.000 menghasilkan
`30309999.999999996` **TIDAK ter-reproduksi** — angka itu berasal dari
`revenue * 0.7`, bukan dari formula yang dipakai kode. Ini dicatat sebagai
koreksi, bukan diulang sebagai fakta.

**Cacat yang NYATA:** pembagian `/100` menyisakan pecahan sen untuk revenue
desimal. Nilai itu dipakai membandingkan HEMAT/OVER **dan** dikirim ke RPC
`close_project` sebagai `target_budget` (NUMERIC), sementara layar menampilkan
rupiah bulat → layar, keputusan, dan snapshot memakai angka berbeda.

**Perbaikan.** `lib/money.js` (baru): `targetBudget70(r) = Math.round(r*7/10)`
— selalu rupiah utuh (43.300.000*7 eksak). Dipakai di `Finance.js`
(closingRows) & `ProjectFinance.js` (summary). `costVsTarget70()` mengembalikan
`null` bila revenue belum ada (bukan "hemat").

**Bukti.** 9 asersi di `scripts/fn-repro/run.py` + 8 di
`scripts/opsi-c-test/render_test.mjs` bagian H.

---

## 5. FN-PRINTREF — rujukan baris dokumen cetak (LOW)

Dokumen cetak closing merujuk `(1 − 5)` padahal tabel hanya punya baris
1..4 + total tanpa nomor. Diganti `(1 − TOTAL BIAYA TERCATAT)`.

Sekalian dikoreksi (masih satu keluarga temuan EST_LABEL):
- baris 3 "Realisasi Biaya Tukang" → "Estimasi Biaya Tukang (WBS Budgeting)"
- "TOTAL HPP RIIL" → "TOTAL BIAYA TERCATAT" (komposisinya masih memuat
  estimasi, jadi klaim "riil" penuh tidak benar)

**Bukti.** Harness membuka dokumen cetak nyata lewat klik, lalu memeriksa:
tidak ada `(1 − 5)`, rujukan baru cocok, baris bernomor tercetak tepat
`["1","2","3","4"]` (tidak ada nomor 5), dan angka snapshot tetap apa adanya
(40jt / 20,8jt / 19,2jt).

---

## 6. Integrasi 8148465 / 7ce9414 / 21bf216

### 6.1 Approval `8148465` — diport, tetapi 2 regresi nyata ditemukan & ditutup

Ancestry: bercabang dari `18fb594` (leluhur HEAD) → diff bersih. Yang diambil:
`headersFor('approvals')` 9→5 kolom compact, `detailDrawer.jsx`, jalur compact
`desktopRow`, state `approvalDetailId`, asersi H.3/H.4.

**REGRESI 1 — capability hilang (bukan kosmetik).**
Port mengganti panel perluasan tbody ("▼ Material (n)") dengan drawer
**baca-saja**. Akibatnya `expandedApproval` tidak pernah di-set lagi:
`rowExpand()` menjadi kode mati, dan tombol per-item **"✓ Setujui"**
(`onApproveItem`) serta **"🛒 Sudah Order"** (`onMarkPrItemOrdered`) tidak bisa
dijangkau dari UI mana pun. Keduanya menulis data: `pages/index.js`
`approveItem()` / `markPrItemOrdered()` memanggil `ensureItemInPurchase()` lalu
meng-update `pr_items.status` — jalur material masuk modul Purchase.
Perbaikan: drawer tetap satu-satunya jangkar, tetapi mengembalikan aksi
per-item dengan **gerbang izin sama persis** seperti `approvalItemTr`
(PENDING → Setujui; APPROVED & PR APPROVED → Sudah Order; ORDERED → status
saja). Tombol hanya dirender bila callback tersedia (fail-closed). Keputusan
tingkat PR tetap hanya di baris/kartu.

**REGRESI 2 — geometri kolom.**
Baris compact merender **9 `<td>` untuk 6 kolom header** (5 data + Aksi):
5 data + Total Estimasi + Waktu Putusan + tombol Rincian + `rowActions`.
Tiga kolom hantu, tabel bergeser, kolom Aksi menumpuk tombol; jangkar
"≡ Rincian" juga dirender **dua kali**. Perbaikan: baris kembali 6 sel; Total
Estimasi tetap tampil sebagai baris kecil di sel Judul (label "belum lengkap"
tetap jujur); satu kolom Aksi berisi keputusan PR + jangkar drawer.

### 6.2 Marketing `7ce9414` — diport utuh (draft-only)

`modules/marketing/{view.jsx,logic.js,README.md}`, harness 3 lapis, entri
registry + `navSections` + `labels`, cabang render `pages/index.js` dengan
guard admin, blok CSS ber-prefix `mk-` (113 aturan).

**Konflik 1** — `pages/index.js` daftar refresh: versi Bit menghapus `'rap'`
(branch-nya belum punya RAP). Diselesaikan dengan mempertahankan daftar HEAD
**utuh** + menambah `'marketing'`.

**Konflik 2** — `scripts/marketing-test/run.py` add/add: dua lapisan uji sah
dengan nama sama. `run.py` milik S6 (kontrak Marketing→CRM, **263 asersi**)
dipertahankan; runner UI Bit disimpan sebagai **`run_ui.py`** (**327 asersi**:
126 logika + 99 render + 102 responsif) dengan catatan integrasi di kepala
berkas. Tidak ada asersi dilonggarkan/dihapus; **keduanya hijau**.

Kontrak kejujuran yang diuji tetap utuh: tidak ada tabel leads/RPC/migrasi/
penulisan DB; host tidak mengirim leads → panel `unavailable` (bukan papan
kosong); host kirim `[]` → "Belum ada lead terdata"; lead dari form berlabel
**"Draf halaman"** (bukan klaim tersimpan); tahap asing → ember "Tahap tidak
diketahui". **Tidak ada pesan keluar / iklan / cron.**

### 6.3 Mobile `21bf216` — hanya perbaikan fungsional yang diport

Diambil: perbaikan kelas hantu `.mobile-kode-sub` (dipakai
`modules/materials/view.jsx`, tidak pernah didefinisikan di baseline) +
harness `scripts/s7-compact-test`.

**TIDAK diambil: dedup 3.099 baris `globals.css`.** Diff `21bf216` vs baseline
memuat **2.968 baris TERHAPUS**, termasuk perbaikan cascade yang sudah ada di
integrasi: `z-index: 160` top bar, selector `aside.app-sidebar` (agar
`<aside class="boq-side">` milik RAB & BOQ tidak ikut jadi drawer),
`100dvh`, `safe-area-inset-bottom`, scrollbar drawer. Menerapkannya =
**memundurkan** perbaikan mobile yang sudah terverifikasi. `.mobile-kode-sub`
ditempatkan **sekali** di blok yang menang cascade (tidak disalin dua kali,
karena menyalin justru menambah duplikasi).

---

## 7. Hasil uji

### 7.1 Regresi penuh (`scripts/integration-test/run_all.py`)

`27/30 hijau`, **2.243 assertion terbaca** (angka dari
`docs/integration-evidence-20261018-153342.json`, commit `081d11e`).

Suite yang naik status dibanding sebelum paket ini:

| suite | sebelum | sesudah |
|---|---|---|
| `pr-estimator-test` | RED (crash: tombol tak ada) | **OK** 14 |
| `pr-group-test` | RED 31 (+ crash) | **OK** 59 |
| `showmore-list-test` | RED (crash) | **OK** 50 |
| `approval-queue-test` | 59 + 2 gagal | **OK** 60 |
| `approval-item-action-test` | (baru) | **OK** 18 |
| `marketing-test/run_ui.py` | (tak terdaftar) | **OK** 102 |
| `s7-compact-test` | (baru) | 110 + 1 (pre-existing) |

### 7.2 Tiga merah yang tersisa — semuanya PRE-EXISTING, terbukti

| suite | gagal | bukti pre-existing |
|---|---|---|
| `rab-boq-render-test` | F1, F2 (2 dari 70) | Sama persis di baseline `1d364e7` **dan** di evidence `3d6b0a6` (`RENDER_TOTAL 70, FAIL 2`, heading sidebar `font-weight>=800` & `var(--ivory)`) |
| `ui-olive-tokens-test` | C (1 dari 35) | Baseline `1d364e7` → `34 LULUS, 1 GAGAL` (`font-weight 750 ×2`) — dijalankan ulang di worktree bersih |
| `s7-compact-test` | G (1 dari 110) | `verify_dup_baseline.py`: baseline **315** blok duplikat, worktree **315**, **0 selector duplikat baru** → bukan regresi paket ini |

Baseline dijalankan di worktree bersih `/tmp/baseline-1d364e7` (detached
`1d364e7`, `node_modules` symlink) — log di `/tmp/base_*.log`.

### 7.3 Bukti asersi tidak tautologis

`scripts/fn-repro/verify_baseline_red.py` menjalankan harness FN-* terhadap
`git show 1d364e7:<file>` dan menghasilkan **18 ok / 28 FAIL**. Setelah
perbaikan: **46 ok / 0 FAIL**.

---

## 8. Build terisolasi (satu build, RAM dibatasi)

```
worktree : /home/ubuntu/dev-workspaces/purchasing-review-prep-20261018
command  : NODE_OPTIONS=--max-old-space-size=768 NEXT_TELEMETRY_DISABLED=1 npx next build
hasil    : exit 0, "✓ Compiled successfully", 0 warning, 32 detik
BUILD_ID : vy5uNR6BUAU2AfmJPMp_U
rute     : 14 (/, /__mobile, /__smoke, /404, 10× /api/* termasuk /api/marketing-contract)
log      : /tmp/build_review_prep.log
```

Kunci satu-build (`/tmp/next-build.lock`) diambil sebelum build dan dilepas
setelah selesai; tidak ada `next build` lain berjalan (diperiksa via `ps`).
Build **tidak** dijalankan di direktori yang melayani trafik
(`purchasing-staging-3001`, `purchasing-8h-integration`, `.next` live tidak
disentuh).

---

## 9. Matriks kemampuan & blocker (jujur)

| Area | Kemampuan nyata sekarang | Blocker |
|---|---|---|
| Finance / Project Finance | Baca estimasi WBS + aktual `tukang_projects` terpisah, label jujur | Aktual bergantung sync Drive; tanpa baris tersinkron UI menulis "belum ada" |
| Closing proyek | Hitung & kunci snapshot (`close_project` RPC) | `labor_cost` snapshot masih **estimasi WBS**, bukan upah terbayar — dinyatakan di dokumen cetak |
| Approval | Compact + drawer; keputusan PR & aksi per-item terjangkau | Menulis `pr_items.status` → butuh DB live untuk uji end-to-end |
| Marketing | Modul UI + lapisan kontrak; draft memori halaman | **DRAFT-ONLY: tidak ada tabel `leads`, tidak ada persistensi.** Tidak boleh disebut "tersimpan" |
| Marketing API `/api/marketing-contract` | 503 `AUTH_NOT_CONFIGURED` untuk akses tanpa auth (fail-closed) | **BUKAN API fungsional terautentikasi.** Harus tetap terdaftar sebagai blocker sampai dikonfigurasi & alur nyata diverifikasi. 503 fail-closed **tidak boleh** disebut sukses operasional |
| Database (master `t_03b41644`) | — | **BLOCKED**: vault kredensial kosong, `DATABASE_URL`/`SUPABASE_DB_URL`/`PGHOST`/`PGPASSWORD` absen, `psql`/`pg_dump`/`pg_restore` tidak terpasang. Tidak ada DDL/migrasi/backup/restore |
| Receiving (`t_7bc6246b`) | — | Menunggu skema; tetap Handover-only, foto OPTIONAL |
| Mobile (`t_eebe4678`) | Perbaikan kelas hantu masuk; harness S7 110/111 | Butuh verifikasi runtime terintegrasi, bukan auto-DONE |
| Staging switch | **TIDAK dilakukan** | Menunggu verifikasi akhir Brooklyn |

---

## 10. Batasan & hal yang TIDAK dikerjakan

1. **Tidak ada** DB write / DDL / migration / `git push` / staging switch.
2. **Tidak ada** outbound marketing (pesan, iklan, cron).
3. **Dedup CSS tidak dikerjakan** — 315 blok duplikat pra-ada tetap ada;
   sengaja tidak diambil dari `21bf216` karena diff itu menghapus perbaikan
   cascade yang lebih penting. Ini pekerjaan terpisah.
4. **Tidak merge** `feat/receiving-simplify` (kode Purchase fisik obsolete).
5. `docs/integration-evidence-*` dan `docs/integration-logs/*` yang dihasilkan
   run ini **tidak di-commit** (artefak, bukan sumber); angka di laporan ini
   bisa direproduksi dengan menjalankan `run_all.py`.
6. Asersi yang diubah pada `pr-group`/`pr-estimator`/`showmore`/`approval-queue`
   mengikuti kontrak compact+drawer yang **sudah disetujui DAT**; isi yang
   diperiksa dipertahankan atau diperketat (geometri kolom, aksi per-item,
   tidak ada tombol kembar). Tidak ada assertion yang dilonggarkan untuk
   membuat merah jadi hijau.

---

## 11. Checklist review untuk Brooklyn

- [ ] `git log --oneline 1d364e7..HEAD` — 6 commit, semua pesannya menjelaskan *mengapa*.
- [ ] `python3 scripts/fn-repro/run.py` → 46/0 ; `verify_baseline_red.py` → merah di baseline.
- [ ] `python3 scripts/approval-item-action-test/run.py` → 18/0 (kunci regresi capability).
- [ ] `python3 scripts/integration-test/run_all.py` → 27/30; cocokkan 3 merah dengan §7.2.
- [ ] `python3 scripts/s7-compact-test/verify_dup_baseline.py` → 0 selector duplikat baru.
- [ ] `python3 scripts/marketing-test/run.py` (263) **dan** `run_ui.py` (327) — dua lapisan, keduanya hijau.
- [ ] Periksa `git diff 1d364e7..HEAD -- styles/globals.css`: hanya penambahan, **nol penghapusan**.
- [ ] Konfirmasi tidak ada `migrations/`, tidak ada perubahan `pages/api/` selain yang sudah ada.
- [ ] Konfirmasi `/api/marketing-contract` tetap dicatat sebagai blocker API (503 fail-closed ≠ API fungsional).
