# Technical Release Checklist — Operational Branch (S1…S6)

**Kartu:** `t_dbf7dbb1` (S7/7) — Final technical integration audit
**Branch:** `feat/ops-workflow-t_cde1b8ad` — audit atas `7a64e76` (tip S6); deliverable = dokumen ini + `docs/report-t_dbf7dbb1.md`
**Base:** `main@18fb594` (merge-base = `18fb594`, jadi branch ini **tidak** ketinggalan main)
**Peran:** peninjau integrasi teknis. **Bukan** pemilik deploy.
**Status:** build hijau, integrasi terverifikasi, **BELUM siap rilis** karena 3 blocker di §6.

> Kartu ini **tidak** men-deploy produksi, **tidak** menjalankan migrasi, dan **tidak**
> mengklaim skema siap. Semua pemeriksaan di bawah **read-only**.

---

## 1. Verdict ringkas

| Area | Hasil | Bukti |
|---|---|---|
| Build produksi (`next build`) | **HIJAU** | 10 rute API + 4 halaman, 0 error |
| Build smoke (`ENABLE_SMOKE=1`) | **HIJAU** | `/__smoke` merender 9 modul termasuk RAP & Invoice Penjualan |
| Harness regresi | **19 suite hijau**, 3 suite merah **pre-existing** | §3 |
| Konflik merge di working tree | **TIDAK ADA** | `git diff --diff-filter=U` kosong, 0 marker `<<<<<<<` |
| Konflik lintas branch (simulasi) | 3 konflik "both-add" di file CORE | §4, sudah dibuktikan bisa diselesaikan |
| Kontrak bersama (auth) | **1 implementasi**, 3 pemakai | §5 |
| API health (build branch) | 401/403/405 sesuai desain | §7 |
| PM2 preview readback | **online, tapi menyajikan `main`, BUKAN branch ini** | §8 |
| Kesiapan skema DB | **TIDAK SIAP** — 6 tabel belum ada | §6, §9 |

---

## 2. Build

```
npx next build            -> ✓ Compiled successfully
ENABLE_SMOKE=1 next build -> ✓ 4/4 static pages, /__smoke ter-render
```

Rute API yang terdaftar di build branch ini (10):

```
/api/alerts/telegram     /api/check-columns      /api/columns
/api/inspect             /api/marketing-contract (S6, baru)
/api/reminders           (S5, baru)              /api/sales-invoices
/api/schema              /api/seed-simulation    /api/sync-materials
```

`package.json`, `vercel.json`, `next.config.js`: **tidak berubah** vs `main`
(tidak ada dependensi baru — `scripts/marketing/package.json` dan
`scripts/reminders/package.json` hanya menandai folder sebagai ESM).

---

## 3. Harness regresi — 2.550 assertion hijau, 3 suite merah pre-existing

Dijalankan **seluruhnya** dari working tree branch ini:

| Suite | Assertion | Status |
|---|---|---|
| `flow-logic-test` | 29 | hijau |
| `fase2-save-test` | 56 | hijau |
| `approval-queue-test` | 56 | hijau |
| `purchase-flow-test` | 178 + 90 | hijau |
| `pr-purchase-compact-test` | 20 + 130 | hijau |
| `handover-compact-test` | 87 + 52 | hijau |
| `handover-flow-test` | 61 + 66 + 73 | hijau |
| `material-acuan-test` | 93 | hijau |
| `material-export-test` | 46 | hijau |
| `pr-estimator-test` | 48 + 47 + 14 | hijau |
| `pr-group-test` | 31 + 54 | hijau |
| `pr-print-template-test` | 20 | hijau |
| `showmore-list-test` | 49 | hijau |
| `vendors-toolbar-test` | 25 | hijau |
| `manual-input-staging-test` | 73 | hijau |
| `rap-test` (S3) | 115 + 66 + 44 | hijau |
| `sales-invoice-test` (S4) | 72 + 74 + 71 + 77 | hijau |
| `reminders-test` (S5) | 123 + 95 + 25 | hijau |
| `marketing-test` (S6) | 121 + 109 + 33 | hijau |
| **e2e HTTP (server Next nyata)** | 39 + 36 + 52 = **127** | hijau |
| **TOTAL** | **2.550** | **0 gagal** |

Suite ke-23, `flow-gap-repro-test`, bukan pass/fail: ia **membuktikan adanya gap**
dan melaporkan `14/25 gap terbukti` terhadap kode verbatim. Dijalankan, tidak
gagal, dan tidak dihitung sebagai assertion hijau.

### 3.0 E2E alur penuh invoice dijalankan sungguhan (39 assertion)

`e2e_runtime_test.mjs` punya blok **H4** (draft → terbit → terkirim → lunas
lewat HTTP) yang hanya aktif bila server dijalankan dengan token pratinjau.
Saya jalankan sungguhan pada `next start -p 3013` dengan
`SALES_INVOICE_PREVIEW_TOKEN` + `SALES_INVOICE_STORE=file` (mode pratinjau
non-produksi):

```
=== HASIL RUNTIME: 39 LULUS, 0 GAGAL ===
```

Termasuk: lahir DRAFT tanpa nomor, retry `Idempotency-Key` mengembalikan
invoice yang sama (`replayed:true`), `status:TERKIRIM` di POST ditolak
`INITIAL_STATUS_MUST_BE_DRAFT`, terbit dua kali ditolak 409, `TERKIRIM` tanpa
kanal ditolak `EVIDENCE_REQUIRED`, `LUNAS` nominal kurang ditolak 409,
`LUNAS` lengkap mengisi verifikator dari sesi, dan invoice kedua dapat nomor
berbeda.

Dua catatan jujur:
- 3 assertion `/__smoke` **gagal** di run pertama karena build saat itu
  `next build` biasa (tanpa `ENABLE_SMOKE=1`). Setelah build smoke dibuat
  ulang, ketiganya lulus — jadi angka 39 adalah hasil build smoke yang benar.
- Alur penuh ini **menulis** ke `data/sales_invoices.json` (store pratinjau,
  bukan Supabase). File itu saya **kembalikan ke isi semula** (`[]`,
  md5 `58e0494c…` identik) dan `git status data/` bersih. Tidak ada tulisan ke
  Supabase.

### 3.1 Tiga suite merah — dibuktikan pre-existing, bukan akibat branch ini

Ketiganya dijalankan ulang di **worktree bersih `18fb594`** (baseline `main`)
dan **gagal dengan assertion yang sama persis**:

| Suite | Assertion gagal | Sebab | Bukti pre-existing |
|---|---|---|---|
| `rab-boq-test` | E7 (1 dari 20) | assertion mencari `pages/index.js` tanpa `rap` di daftar exclude tombol refresh | gagal identik di `18fb594` |
| `rab-boq-render-test` | F1, F2 (2 dari 70) | heading sidebar harus `font-weight >= 800` + `var(--ivory)` | gagal identik di `18fb594` |
| `ui-olive-tokens-test` | C (1 dari 35) | `font-weight: 750` ×2 di `styles/globals.css` | gagal identik di `18fb594`; baris itu milik `e53e83f` & `de55d034`, **bukan** S1…S6 |

Catatan penting: **E7 `rab-boq-test` sekarang "benar secara desain"** — S3
menambahkan `'rap'` ke daftar halaman yang punya tombol refresh sendiri, jadi
string yang dicari assertion memang berubah. Assertion itu perlu diperbarui
oleh pemilik RAB/BOQ, bukan dilonggarkan di sini (kartu ini tidak boleh
menyentuh file modul lain). `ui-olive-tokens-test` gagal karena `750` yang
**sudah ada di main** — bukan nilai baru.

---

## 4. Integrasi & konflik merge

### 4.1 Working tree
`git diff --diff-filter=U` → kosong. Pemindaian `<<<<<<<` / `=======` / `>>>>>>>`
di seluruh file sumber → **0 temuan**. Branch ini bersih.

### 4.2 Simulasi merge lintas branch (read-only, di worktree sekali pakai)

| Branch tujuan | Hasil merge ke `7a64e76` | Konflik |
|---|---|---|
| `feat/approvals-s1-audit` | bersih | — |
| `feat/finance-tukang` | bersih | — |
| `feat/material-catalog` / `feat/rap-compare-ui` (commit sama, `f76cff3`) | **3 konflik** | `lib/constants.js`, `modules/registry.js`, `pages/index.js` |
| `feat/receiving-simplify/t_7bc6246b` | **8 konflik** | termasuk **modify/delete** 4 file yang sudah dihapus `t_9109cf5e` |
| `feat/mobile-responsive/t_eebe4678` | **tidak bisa merge** | branch itu meng-commit **symlink `node_modules`** (blob `120000`) |

**Konflik "both-add" (f76cff3) sudah dibuktikan bisa diselesaikan** — bukan
teoretis. Di worktree sekali pakai saya selesaikan dengan mempertahankan
**kedua sisi** (RAP + Stok Workshop), lalu:

```
ENABLE_SMOKE=1 next build -> HIJAU
pr-purchase-compact-test  -> 20 + 130, 0 gagal
rap-test                  -> 115 + 66 + 44, 0 gagal
stock-view-test           -> 76 + 53, 0 gagal
sales-invoice-test        -> 72+74+71+77, 0 gagal
```

Karena itu: **tidak ada kontrak bersama yang bertabrakan** — yang bertabrakan
hanya daftar enumeratif di 3 file CORE (satu entri menu/registry/import per
modul). Resolusinya mekanis, tapi **wajib lewat Tech Lead** karena file itu beku.

### 4.3 Dua temuan integrasi yang harus ditutup sebelum merge

1. **`feat/mobile-responsive/t_eebe4678` meng-commit symlink `node_modules`**
   (target `/home/ubuntu/purchasing-app/node_modules`, masuk di `1da59de`).
   `.gitignore` berisi `node_modules/` (dengan garis miring) sehingga **symlink
   tidak ikut ter-ignore**. Kalau branch itu di-merge, `node_modules` jadi file
   ter-track di repo dan setiap `git checkout` akan mencoba menimpanya.
   **Harus dibersihkan di branch itu dulu** (`git rm --cached node_modules`),
   bukan di branch ini.
2. **`feat/receiving-simplify/t_7bc6246b` sudah usang.** Ia masih memodifikasi
   `modules/receivings/view.jsx`, `receiptForm.jsx`, `receiptLogic.js` — tiga
   file yang **sudah dihapus** `t_9109cf5e` (arahan DAT: Purchase berhenti di
   "barang dibeli"). Merge akan menghidupkan kembali kode yang sengaja dibuang.
   Branch itu 6 ahead / 7 behind; sebaiknya **dibatalkan**, bukan di-rebase.

### 4.4 Status push

Branch ini **belum pernah di-push**: `origin` hanya punya `origin/main`.
`origin/main` = `3870ef7`, yaitu **7 commit di belakang `main` lokal
(`18fb594`)** — jadi commit Sales Invoice di main lokal pun belum ada di remote.
**17 commit** belum terkirim: 7 milik `main`, 9 milik kartu S1…S6, 1 milik S7.

---

## 5. Kontrak bersama (shared contracts)

| Kontrak | Pemilik | Pemakai | Status |
|---|---|---|---|
| `verifyAdmin` / `AuthError` / `authFailure` (`modules/sales-invoice/auth.js`) | S4 | `pages/api/sales-invoices.js`, `scripts/reminders/auth.js`, `scripts/marketing/auth.js` | **1 implementasi saja** — diverifikasi `grep "export async function verifyAdmin"` → tepat 1 hasil |
| `contract.js` marketing (enum + gerbang) | S6 | `pages/api/marketing-contract.js`, `scripts/marketing/cli.mjs` | tertutup (`Object.freeze`) |
| `rules.js` reminders (7 jenis + ambang) | S5 | `pages/api/reminders.js`, `scripts/reminders/cli.mjs` | tertutup |
| `lib/constants.js` `navSections`/`labels` | Tech Lead | semua | **file beku — disentuh S3** (2 entri aditif) |
| `modules/registry.js` | Tech Lead | semua | **file beku — disentuh S3** (1 modul baru) |
| `pages/index.js` | Tech Lead | semua | **file beku — disentuh S3** (import + 1 cabang render + 1 exclude refresh) |

Tidak ada modul yang menyalin logika otorisasi. Tidak ada dua kebenaran auth.
Itu klaim inti S4/S5/S6 dan **terbukti benar**.

### 5.1 Satu inkonsistensi urutan guard (perlu keputusan, bukan bug keamanan)

Tiga endpoint admin menaruh penolakan **method** di urutan berbeda:

| Endpoint | Urutan | `DELETE` tanpa sesi |
|---|---|---|
| `/api/sales-invoices` (S4) | **auth → 405** | **401** |
| `/api/reminders` (S5) | 405 → auth | **405** |
| `/api/marketing-contract` (S6) | 405 → 403 aksi → auth | **405** |

Diuji langsung terhadap build branch (§7). Keduanya *fail closed*, jadi tidak
ada lubang keamanan — tapi `docs/sales-invoice-contract.md` §5 menulis
"`lain` → `405` + header `Allow`" tanpa menyebut bahwa auth diperiksa lebih
dulu, sehingga dokumentasi dan perilaku tidak cocok. Pilihan mana yang jadi
standar adalah keputusan Tech Lead; kartu ini **tidak mengubah** kode S4 karena
harness S4 mengunci perilaku itu.

---

## 6. BLOCKER — belum bisa rilis

### B1. Kredensial migrasi DB tidak tersedia (blocker utama)

| Yang dicari | Hasil |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **tidak ada** (env & `.env.local`) |
| `SUPABASE_DB_PASSWORD` / `DATABASE_URL` / `POSTGRES_URL` / `PGPASSWORD` / `SUPABASE_ACCESS_TOKEN` / `DIRECT_URL` | **tidak ada** |
| `psql` / `pg_dump` | **tidak terpasang** |
| `psycopg2` / `pg8000` (Python) | **tidak ada** |
| `node_modules/pg` | ada (dependency repo), tapi tanpa connection string |

`.env.local` hanya berisi `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
**Konsekuensi: DDL tidak bisa dijalankan dari sini — dengan alat apa pun.**
Ini bukan masalah izin, ini kredensial yang memang tidak diberikan ke agent.

### B2. File migrasi untuk 6 tabel itu **belum ada**

`migrations/` berisi 9 file; **tidak satu pun** membuat tabel S4/S5/S6.
DDL-nya masih berupa **usulan di dokumen**:

- `docs/sales-invoice-contract.md` §3 — `sales_invoices` (masih ditandai "USULAN, BELUM DIJALANKAN")
- `docs/marketing-crm-integration-contract.md` §9.2 — `leads`, `lead_touchpoints`, `campaigns`, `lead_handoffs`, `customers`

Jadi urutannya bukan "jalankan migrasi", tapi: **DAT setujui → tulis file
migrasi → jalankan**. Dua langkah pertama belum terjadi.

### B3. Persetujuan bisnis DAT belum ada

- Definisi `QUALIFIED` yang mengikat, batas umur `DORMANT`, perlu komisi `REFERRAL` (S6)
- SLA resmi untuk 6 ambang reminder (S5 memakai 3/7 hari sebagai tebakan konservatif)
- Termin/pembayaran sebagian belum punya skema → `invoice_due` tidak menghitung sisa tagihan

---

## 7. API health — build branch ini (port 3010, sudah dimatikan)

| Rute | Status | Badan |
|---|---|---|
| `GET /` | 200 | halaman utama ter-render |
| `GET /__smoke` | 200 | 9 modul termasuk `#mod-rap`, `#mod-sales-invoice` |
| `GET /api/sales-invoices` | **401** | `UNAUTHORIZED` |
| `GET /api/reminders` | **401** | `UNAUTHORIZED` |
| `GET /api/marketing-contract` | **401** | `UNAUTHORIZED` |
| `GET /api/columns`, `/api/schema` | 403 | `MAINTENANCE_TOKEN belum diset` (fail closed) |
| `POST/PUT/DELETE/PATCH /api/reminders` | **405** | `METHOD_NOT_ALLOWED` |
| `POST/PUT/DELETE/PATCH /api/marketing-contract` | **405** | `METHOD_NOT_ALLOWED` |

**Route guard S6 diuji satu per satu terhadap server nyata:** seluruh
**34** nama di `FORBIDDEN_ACTIONS` → **403 `ACTION_FORBIDDEN`** sebelum auth
(`?action=send|sync|ads|publish|…`). `?action=bogus` dan tanpa `action` → 401
(guard tidak menebak). `?ads=1`, `?send=true`, `?pixel=1` → 403.

**Fail-closed store S4 diuji terhadap Supabase LIVE (read-only):**
`resolveStorePlan(production)` → `supabase` (durable), lalu `store.list()`
melempar `StoreError{ code: 'SCHEMA_UNAVAILABLE', status: 503,
blocker: 'SCHEMA_UNAVAILABLE' }` — **bukan** daftar kosong. Persis perilaku
yang dijanjikan.

### 7.1 Laporan live (read-only) dari CLI S5 & S6

```
node scripts/reminders/cli.mjs --as-of 2026-10-18
  Status data: DEGRADED
  13 reminder — 1 critical, 9 warning, 3 info
  invoice_due / invoice_draft_stale -> BLOCKED (sales_invoices PGRST205)

node scripts/marketing/cli.mjs --readiness
  leads, lead_touchpoints, campaigns, lead_handoffs, customers -> SCHEMA_UNAVAILABLE
  projects -> 11 baris (baca saja)
  "Tabel marketing siap: TIDAK — pipeline lead TIDAK dinilai (bukan berarti kosong)"
```

Nol operasi tulis dari kedua CLI (hanya `SELECT`).

---

## 8. PM2 preview readback

```
name      : purchasing-preview        status : online
pid       : 1719173                   restarts: 23   uptime: 80 min
exec cwd  : /home/ubuntu/purchasing-app   (git worktree of main @ 18fb594)
args      : next start -p 3001
BUILD_ID  : kpdL4JDM7c6L03-GyOYkZ  ==  on-disk .next/BUILD_ID   (cocok)
```

**Preview ini menyajikan `main@18fb594`, bukan branch ini.** Buktinya:

| Rute | Preview (main) | Build branch (S7) |
|---|---|---|
| `/api/sales-invoices` | **200** `{"ok":true,"invoices":[]}` | 401 |
| `/api/reminders` | **404** | 401 |
| `/api/marketing-contract` | **404** | 401 |
| `/__smoke` | 404 | 200 |

### 8.1 TEMUAN KEAMANAN AKTIF di preview (milik `main`, bukan branch ini)

`pages/api/sales-invoices.js` **di `main`** tidak punya otorisasi sama sekali
(`grep verifyAdmin` → 0 hasil). Diuji langsung ke preview:

```
GET   /api/sales-invoices            -> 200  (membocorkan seluruh daftar invoice)
POST  /api/sales-invoices  {}        -> 400  ("Nomor invoice ... wajib")  <- lolos auth, masuk validasi
PATCH /api/sales-invoices  {}        -> 400  ("ID dan status wajib")      <- lolos auth
```

Artinya **siapa pun di jaringan bisa menulis ke endpoint invoice di preview**.
Ini **bukan** regresi branch ini — justru inilah yang diperbaiki S4. Tapi
karena branch belum di-push dan preview belum di-redeploy, **lubang itu masih
hidup sekarang**. Tindakan: redeploy preview dari branch, atau matikan preview,
sebelum apa pun yang lain.

Catatan paparan: preview **bind ke `*:3001`** (semua interface), bukan hanya
loopback. Terverifikasi bisa dijangkau dari `127.0.0.1:3001` dan
`100.91.244.41:3001` (tailnet) dan `10.11.0.15:3001` (eth0 privat), tapi **tidak**
dari IP publik `43.157.201.163:3001` (timeout — diblokir security group).
Jadi paparannya ke **seluruh tailnet**, yang berisi perangkat tim. Tidak ada
reverse proxy/Caddy yang mengeksposnya ke internet.

`error.log` preview: 12.014 byte, mtime **35,6 jam lalu** (`2026-10-16 16:28`)
— tidak ada error baru; entri `MissingStaticPage /404` di dalamnya berasal dari
siklus restart lama, bukan dari request S7.

---

## 9. Kesiapan skema DB (READ-ONLY, live)

### 9.1 Yang ADA

`projects` (11), `purchase_requests` (11), `pr_items` (46), `approval_steps` (2),
`vendors` (22), `materials` (343), `receivings` (5), `receiving_items` (4),
`handovers` (1), `project_plans` (0), `project_closings` (0),
`telegram_alerts_log` (0), `profiles` (4).
`tukang_*` dan `user_credentials` ada tapi RLS menolak anon (bukan drift).

### 9.2 Yang TIDAK ADA (`PGRST205`) — dibutuhkan S4/S5/S6

| Tabel | Dibutuhkan oleh | Status |
|---|---|---|
| `sales_invoices` | S4 (store kanonik), S5 (`invoice_due`, `invoice_draft_stale`) | **ABSEN** |
| `customers` | S6 (handoff CRM) | **ABSEN** |
| `leads` | S6 (pipeline) | **ABSEN** |
| `lead_touchpoints` | S6 (atribusi) | **ABSEN** |
| `campaigns` | S6 (atribusi) | **ABSEN** |
| `lead_handoffs` | S6 (idempotensi handoff) | **ABSEN** |

**Drift repo→DB: 0.** Setiap tabel yang dideklarasikan di `migrations/*.sql`
(8 tabel) memang ada di DB. Yang kurang adalah tabel yang **belum punya file
migrasi** (§6 B2).

### 9.3 Yang TIDAK diklaim

Kartu ini **tidak** menyatakan skema siap, **tidak** menyatakan pipeline lead
"kosong", dan **tidak** menyatakan invoice "0". Ketidakhadiran tabel dilaporkan
sebagai **BLOCKED** oleh S5 & S6, dan itu benar.

---

## 10. Kebersihan workspace (hanya artefak generated)

| Tindakan | Detail |
|---|---|
| Worktree sementara dibuat & dihapus | `/tmp/s7-baseline`, `/tmp/s7-merge`, `/tmp/s7-mx` — `git worktree list` kembali ke 9 entri semula |
| Server uji `next start` (port 3010, 3011, 3012, 3013) | dijalankan lalu **dimatikan**; keempat port bebas |
| `.next/` di workspace | dibangun ulang (generated, gitignored) — **tidak** dihapus, sudah ada sebelum kartu ini |
| File tracked berubah | **tidak ada** (`git status` bersih dari perubahan tracked) |
| `data/` | `git diff main..HEAD -- data/` kosong (tidak ada perubahan ter-commit). E2E H4 sempat menulis `data/sales_invoices.json`, lalu **dikembalikan identik** — md5 `58e0494c…`, `git status data/` bersih |
| `migrations/` | **tidak disentuh** (0 file berubah) |
| `node_modules` | symlink pra-ada (10月15), **tidak** dihapus |

Sisa `git status`: `?? WORKSPACE_ROLE.md` dan `?? node_modules` — keduanya
**sudah ada sebelum** kartu ini dan bukan milik saya.

---

## 11. Urutan rilis yang disarankan

1. **Tutup paparan preview** — redeploy dari branch atau matikan `purchasing-preview` (§8.1).
2. **Bersihkan `node_modules` di `feat/mobile-responsive/t_eebe4678`** (§4.3) — atau jangan merge branch itu.
3. **Batalkan `feat/receiving-simplify/t_7bc6246b`** (§4.3) — sudah digantikan `t_9109cf5e`.
4. **Tech Lead** selesaikan 3 konflik CORE dengan `feat/material-catalog` (§4.2 — resepnya sudah terbukti).
5. **Perbaiki dokumentasi**: "48 aksi terlarang" → **34** di `docs/marketing-crm-integration-contract.md` (§181, §451) dan `docs/report-t_1fd27ad9.md` (4 tempat). Kode dan harness sudah benar (34); hanya teksnya yang berlebih.
6. **Putuskan urutan guard** yang jadi standar (§5.1) lalu samakan dokumen S4.
7. **DAT setujui** DDL §9.2 marketing + §3 sales-invoice.
8. **Tulis file migrasi** di `migrations/` (belum ada), lalu jalankan **dengan kredensial yang diberikan eksplisit**.
9. **Update assertion E7** `rab-boq-test` (pemilik RAB/BOQ) — sekarang gagal karena desain, bukan bug.
10. **Push & buka PR** — 17 commit belum terkirim; `origin/main` 7 commit di belakang `main` lokal.

---

## 12. Ringkasan satu paragraf

Branch operasional S1…S6 **secara teknis koheren dan bisa dibangun**: build
hijau (normal & smoke), 2.550 assertion hijau di 19 suite + 127 e2e HTTP
terhadap server Next nyata, nol konflik di working tree, satu implementasi
otorisasi yang dipakai tiga endpoint, dan tiga suite merah yang terbukti
pre-existing di `18fb594`. Yang menghalangi rilis **bukan kode**, melainkan
(a) kredensial migrasi yang tidak pernah diberikan, (b) file migrasi untuk enam
tabel yang belum ditulis karena DDL-nya masih usulan, dan (c) tiga keputusan
bisnis DAT. Di luar itu ada dua hal yang harus segera ditangani dan **bukan**
milik kartu ini: preview PM2 masih menyajikan `main` yang endpoint invoice-nya
tanpa otorisasi, dan satu branch lain meng-commit symlink `node_modules`.
