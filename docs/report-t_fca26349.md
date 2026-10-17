# Laporan P0 Brooklyn — Invoice Penjualan (`t_fca26349`)

**Branch:** `feat/ops-workflow-t_cde1b8ad`
**Base review:** `097e918` (S7/7)
**Commit perbaikan:** `ce4ef3a` — *P0 Brooklyn: validasi sebelum mutasi, RLS
sesi user, CAS dan anti-proyek-yatim* (kode + seluruh uji). Commit berikutnya di
branch ini hanya menambah dokumen ini + satu baris registry.
**Lingkup:** implementasi kode + uji + staging port 3001. **Tanpa DDL, tanpa
migrasi, tanpa tulisan ke DB live, tanpa push ke `main`.**
**Status:** perbaikan **terimplementasi & teruji** untuk 7 butir temuan. Ini
**bukan** klaim seluruh bisnis VERIFIED — blocker skema/RPC masih terbuka (§6).

---

## 1. Temuan P0 dan buktinya sekarang

### 1.1 Mutasi invoice beku sebelum validasi (P0 utama)

Temuan Brooklyn (terbukti di `097e918`): `normalizeTransition({id,to:'TERBIT',
fields:{nominal:999}})` pada record `TERKIRIM` nominal `100` → `patchInvoice`
menjalankan `store.update({nominal:999})` **lebih dulu**, lalu `issueInvoice`
melempar `NOT_A_DRAFT`. Respons gagal, nominal beku sudah berubah.

Sekarang urutan di `modules/sales-invoice/store.js` → `patchInvoice()`:

```
getById
 → assertTransitionAllowed(current, to)     # NOT_A_DRAFT / INVALID_TRANSITION / TERMINAL_STATUS
 → normalizeFieldPatch(patch, current)      # FIELD_NOT_PATCHABLE / INVALID_AMOUNT / ...
   └─ bila status bukan DRAFT → ISSUED_INVOICE_FROZEN
 → validasi bukti (TERKIRIM / LUNAS)        # EVIDENCE_REQUIRED / PAYMENT_AMOUNT_MISMATCH
 → bila to === TERBIT: preflightIssue(...)  # format nomor, gate RPC, kode proyek, klaim ganda
                        baru koreksi draf (CAS) → issueInvoice
   selain itu:          updateIf(id, {status: current.status}, patch)  # CAS
```

Langkah 2–4 murni: tidak ada `update`/`insert` sama sekali. `fields` juga
dibatasi daftar putih (`PATCHABLE_FIELDS`), sehingga `status`, `invoice_no`,
`tax_amount`, `grand_total` tidak bisa ditulis klien lewat jalur koreksi.

Bukti uji (semua hijau):

| Uji | Isi | Hasil |
|---|---|---|
| `B13-TERBIT`, `B13-TERKIRIM`, `B13-LUNAS`, `B13-BATAL` (6 assertion × 4) | `{to:'TERBIT', patch:{nominal:999}}` pada tiap status → ditolak, **0 penulisan** ke `sales_invoices`, snapshot **identik**, nominal tetap 100 | ok |
| `B13x1–x3` | `TERBIT → TERKIRIM + patch{nominal:5}` → `ISSUED_INVOICE_FROZEN`, 0 write, data identik | ok |
| `B13y1–y3` | `LUNAS` nominal kurang pada `TERKIRIM` → 0 write, data identik | ok |
| `B13z1–z2` | `patch:{invoice_no}` dari klien → `FIELD_NOT_PATCHABLE`, nomor tidak berubah | ok |
| `D7a–D7g` | Jalur **HTTP handler**: respons 409 `NOT_A_DRAFT`, file store **identik byte-per-byte**, nominal 85.000.000 tetap | ok |
| `H5a–H5e` | Jalur **HTTP nyata** (server Next): 409, baris invoice identik via GET, status tetap `TERKIRIM` | ok |

### 1.2 RLS: klien anon tanpa JWT untuk role & store

Temuan: `auth.js` membuat `roleClient` dari anon **tanpa** JWT (hanya verifier
yang memakai JWT); `pages/api/sales-invoices.js` `defaultBuildStore` juga anon
tanpa JWT. Di bawah RLS `profiles` (admin-only) klien anon melihat **0 baris**
→ peran admin tidak pernah terbaca (403 palsu), dan store anon tidak bisa
menulis.

Perbaikan:

- `auth.js` → `createSessionClient(url, anonKey, token)`: klien membawa
  `global.headers.Authorization = Bearer <JWT user>`.
- `verifyAdmin()`: bila `SUPABASE_SERVICE_ROLE_KEY` **tidak** ada, SELECT
  `profiles` memakai sesi user (bukan anon). Bila ada, service role dipakai dan
  mode dilaporkan (`sessionClientMode`).
- `verifyAdmin()` mengembalikan `sessionToken` → diteruskan handler ke
  `buildStore(plan, { actor })`.
- `defaultBuildStore`: service role → pakai; tanpa service role tapi ada token
  → `createSessionClient`; tanpa keduanya → `STORE_SESSION_REQUIRED` (503, fail
  closed) — **tidak pernah** jatuh ke klien anon.
- `GET` mengembalikan `auth.session_mode` supaya operator tahu jalur mana yang
  dipakai.

Bukti uji `D6a–D6m` (mocked client **options headers** direkam):

- `D6a/D6b/D6c`: peran admin terbaca dari `profiles` dengan `anon-key` +
  `Authorization: Bearer token-admin`.
- `D6f/D6g/D6h/D6i`: klien **store** juga membawa JWT; tidak ada satu pun klien
  tanpa Authorization (`seen.every(s => !!s.auth)`).
- `D6j/D6k/D6l`: bila service role ada → `service-key`, mode `service-role`.
- `D6m`: tanpa JWT & tanpa service role → 401, bukan klien anon.

### 1.3 Concurrency: tanpa CAS, dua issue, proyek ganda

Perbaikan:

- Store Supabase & file store kini punya `updateIf(id, expected, patch)` =
  **compare-and-set** pada kolom yang dibaca (`status`). `null` = kalah balapan
  (bukan error) → `ISSUE_CONFLICT` / `CONCURRENT_MODIFICATION` (409).
- `issueInvoice()` mengalokasikan nomor lalu menulis dengan
  `updateIf(id, {status: current.status})`. Dua permintaan bersamaan: satu
  menang, satu kalah **tanpa** nomor dan **tanpa** proyek baru.
- Alokasi nomor tetap memakai unique index + retry yang melewati nomor yang
  sudah ditolak (tidak bergantung pembacaan ulang yang basi).

Bukti uji:

| Uji | Isi | Hasil |
|---|---|---|
| `B14a–B14g` | `Promise.allSettled` dua `issueInvoice` pada draf yang sama: tepat 1 sukses, 1 gagal `NOT_A_DRAFT`/`ISSUE_CONFLICT`, **1 proyek**, 1 baris, nomor tidak terganti | ok |
| `B14h–B14j` | `updateIf` dengan status lama → `null`, **0 write**, nomor tidak terpakai | ok |
| `B9a–B9b` | Balapan nomor dengan pembacaan periode "buta" → nomor berikutnya, tanpa duplikat | ok |

### 1.4 Proyek yatim: insert sukses, tautan gagal

Perbaikan (`attachProject()`):

1. **Klaim slot** `project_claim {code, invoice_id, requested_at}` ditulis dengan
   CAS `updateIf(id, {status:'TERBIT', project_issued:false})` — hanya satu
   permintaan boleh mengklaim.
2. Kode proyek deterministik dari klaim; kode yang sudah tertaut ke invoice lain
   → `PROJECT_ALREADY_CLAIMED` (proyek kedua **tidak** dibuat).
3. Insert proyek; bila `DUPLICATE_PROJECT_CODE` → **tautkan** proyek yang sudah
   ada (bukan insert kedua).
4. Tautan ditulis dengan retry singkat. Bila tetap gagal → **kompensasi
   best-effort** `deleteProject(created.id)`.
5. Bila kompensasi juga gagal → peringatan **PERBAIKAN MANUAL** + id proyek, dan
   `project_issue_error` disimpan di invoice untuk audit.

Bukti uji:

| Uji | Isi | Hasil |
|---|---|---|
| `B4y1–B4y7` | insert proyek sukses + link gagal → proyek **dihapus** (`projectDeletes=1`), invoice tetap terbit bernomor, `project_issued=false`, peringatan menyebut "kompensasi … bukan transaksi", `capabilities.transactional=false` | ok |
| `B4z1–B4z3` | kompensasi gagal → proyek tetap ada, peringatan **PERBAIKAN MANUAL** + id, tidak mengklaim sukses | ok |
| `B14k–B14o` | invoice kedua meminta kode proyek yang sudah diklaim → ditolak, tetap draf, tetap **satu** proyek | ok |
| `B4a–B4i`, `B4x1–B4x4`, `B5a–B5d` | tidak ada proyek yatim saat invoice gagal; kode bentrok 409 + saran | ok |

### 1.5 Klaim transaksional & gate RPC

- `capabilities.transactional = hasIssueRpc` (bukan `true`), `atomicSequence =
  hasIssueRpc`, `projectCompensation: 'best-effort'`.
- `SALES_INVOICE_REQUIRE_RPC=1` → `preflightIssue` melempar
  `ISSUE_REQUIRES_RPC` (503) **sebelum** nomor dialokasikan. Ini pilihan
  fail-closed yang disarankan untuk produksi kanonik sampai RPC ada.

Bukti: `B15a–B15f` (503, 0 proyek, 0 nomor, pesan menyebut env), `B10i`,
`G32`, `G33`.

### 1.6 Format nomor: Buku authoritative vs INV/NL

- Authoritative: **Buku (Obsidian)** `NL<yy><mm><urut 3 digit>` — mis.
  `NL2610001`, **urut reset tahunan**.
- `INV/NL/<yyyy>/<mm>/<urut>` **belum disepakati** → hanya aktif bila
  `SALES_INVOICE_NO_FORMAT=inv-nl` **dan** `SALES_INVOICE_NO_FORMAT_ACK=1`.
  Tanpa ACK → `NUMBER_FORMAT_NOT_AGREED` (409) sebelum alokasi.
- **Tidak ada migrasi nomor existing**: `parseAnyInvoiceNo()` membaca dua
  format, alokasi hanya menghitung format yang sama, GET mengembalikan
  `number_formats_in_use`, UI menampilkan banner discrepancy
  (`data-testid="si-numbering-banner"`).

Bukti: `A9a–A9m`, `B16a–B16t` (termasuk reset tahunan & `NL`/`INV-NL` tidak
saling mempengaruhi), `G21–G24`.

### 1.7 PDF/form hanya data verified

- `issue_date` **wajib eksplisit** → `ISSUE_DATE_REQUIRED` (server tidak
  mengisi tanggal hari ini).
- PPN tanpa default 11% (kosong → 0, UI meminta tarif bila dicentang).
- Termin tidak dikarang (field opsional baru, kosong = tidak dicetak).
- Form tidak lagi mengisi tanggal hari ini / jatuh tempo +14 hari.

Bukti: `A8a–A8g`, `G25–G29`.

---

## 2. File yang diubah (`ce4ef3a`)

```
docs/sales-invoice-contract.md                  | 368 ++++++----
modules/sales-invoice/CreateInvoiceModal.jsx    |  57 ++-
modules/sales-invoice/README.md                 |  53 +-
modules/sales-invoice/auth.js                   |  38 +-
modules/sales-invoice/contract.js               | 153 +++++-
modules/sales-invoice/store.js                  | 654 +++++++++++++++++----
modules/sales-invoice/view.jsx                  |  36 ++
pages/api/sales-invoices.js                     |  52 +-
scripts/sales-invoice-test/auth_api_test.mjs    | 147 ++++-
scripts/sales-invoice-test/contract_test.mjs    |  47 ++
scripts/sales-invoice-test/e2e_runtime_test.mjs |  22 +-
scripts/sales-invoice-test/render_test.mjs      |  28 +
scripts/sales-invoice-test/store_test.mjs       | 352 +++++++++--
13 files changed, 1571 insertions(+), 436 deletions(-)
```

API publik yang berubah (aditif): `createSupabaseStore` opsi
`{numbering, requireRpc, env}`; store method `updateIf`, `deleteProject`,
`findByProjectCode`, `numbersInPeriod`; export baru `preflightIssue`,
`assertTransitionAllowed`, `normalizeFieldPatch`, `summarizeNumberFormats`;
contract export baru `resolveInvoiceNumberFormat`, `formatInvoiceNoFor`,
`numberingPeriod`, `invoiceNoPrefix`, `parseAnyInvoiceNo`,
`parseLegacyInvoiceNo`, `nextSequenceForFormat`.

---

## 3. Hasil uji (output apa adanya)

### 3.1 Harness modul — 438 assertion, 0 gagal

```
================ A. KONTRAK & VALIDASI ================
=== A. KONTRAK: 92 LULUS, 0 GAGAL ===
================ B. STORE / IDEMPOTENSI / NEGATIVE CASES ================
=== B. STORE: 160 LULUS, 0 GAGAL ===
================ C+D. OTORISASI SERVER & API HANDLER ================
=== C+D. AUTH & API: 93 LULUS, 0 GAGAL ===
================ E+F. PDF, RENDER, WIRING ================
=== E+F+G. PDF/RENDER/WIRING: 93 LULUS, 0 GAGAL ===
================ HASIL AKHIR ================
SEMUA HARNESS LULUS
```

Perubahan jumlah vs S4 (294): +144 assertion baru untuk P0/RLS/race/format
nomor/no-default.

### 3.2 E2E HTTP nyata — 45 assertion, 0 gagal

```
SI_PREVIEW_TOKEN=… node scripts/sales-invoice-test/e2e_runtime_test.mjs http://127.0.0.1:3185
  ✓ GET tanpa sesi → bukan 2xx            ✓ POST tanpa sesi ditolak sebelum validasi
  ✓ token pratinjau salah ditolak         ✓ /__smoke dapat dirender
  ✓ GET dengan token pratinjau = 200      ✓ POST sah = 201
  ✓ retry key sama = 200 (bukan 201)      ✓ nomor invoice format Buku NL<yymm><XXX>
  ✓ format nomor tercatat di record       ✓ PATCH TERBIT = 200
  ✓ menerbitkan dua kali ditolak (409)    ✓ TERKIRIM tanpa kanal = 400
  ✓ LUNAS tanpa bukti = 400               ✓ LUNAS nominal kurang = 409
  ✓ LUNAS lengkap = 200                   ✓ verifikator diisi dari sesi
  ✓ invoice kedua dapat nomor berbeda
  ✓ H5a TERKIRIM → TERBIT + fields = 409  ✓ H5b kode NOT_A_DRAFT
  ✓ H5c data identik setelah penolakan    ✓ H5d nominal beku tidak berubah
  ✓ H5e status tetap TERKIRIM
=== HASIL RUNTIME: 45 LULUS, 0 GAGAL ===
```

### 3.3 Build terisolasi

```
npx next build            → ✓ Compiled successfully (10 rute API + 4 halaman)
ENABLE_SMOKE=1 next build → ✓ Compiled successfully, /__smoke 2.53 kB
```

### 3.4 Regresi lintas suite — 12/13 hijau

```
GREEN  sales-invoice-test      92/160/93/93
GREEN  rap-test                GREEN  handover-compact-test   GREEN  handover-flow-test
GREEN  purchase-flow-test      GREEN  pr-purchase-compact-test
GREEN  pr-estimator-test       GREEN  pr-group-test
GREEN  approval-queue-test     GREEN  fase2-save-test
GREEN  showmore-list-test      GREEN  material-acuan-test
RED    rab-boq-test            E7 "exclude dari tombol refresh global" (1/20)
```

`rab-boq-test` E7 **pre-existing**: assertion mencari `pages/index.js` tanpa
`rap` di daftar exclude tombol refresh; gagal identik di `18fb594` karena desain
S3 (sudah dicatat di `docs/release-checklist-ops-branch.md` §3). Bukan regresi
kartu ini.

---

## 4. Deployment staging (port 3001) — BERJALAN

| Item | Nilai |
|---|---|
| Worktree | `/home/ubuntu/dev-workspaces/purchasing-staging-3001` (detached di tip branch `6fa8229`) |
| Proses PM2 | `purchasing-staging-3001` (id 9) — **online** |
| Perintah | `next start -p 3001` |
| BUILD_ID | `.next/BUILD_ID` di disk **cocok** dengan build yang disajikan (diverifikasi tiap redeploy) |
| Env | `.env.local` proyek (URL + anon key), `SALES_INVOICE_STORE=supabase`, `SALES_INVOICE_NO_FORMAT=legacy-buku`. **Tanpa** `SUPABASE_SERVICE_ROLE_KEY`, **tanpa** `SALES_INVOICE_PREVIEW_TOKEN` (jalur auth nyata, bukan pratinjau). |
| `purchasing-preview` (lama, `main`) | **di-stop**, bukan dihapus — `pm2 start purchasing-preview` untuk mengembalikan. Backup: `/home/ubuntu/.pm2-dump.backup.json`, `/home/ubuntu/.pm2-purchasing-preview.backup.txt` |

Readback langsung ke `http://127.0.0.1:3001`:

```
GET  /api/sales-invoices                  → 401 UNAUTHORIZED        (dulu di main: 200 + seluruh daftar invoice)
GET  /api/sales-invoices (Bearer palsu)   → 401 INVALID_SESSION     (JWT benar-benar diverifikasi ke Supabase)
GET  /api/reminders                       → 401                     (dulu 404 → membuktikan build branch, bukan main)
GET  /api/marketing-contract              → 401                     (dulu 404)
GET  /__smoke                             → 200                     (dulu 404)
```

E2E terhadap staging: `=== HASIL RUNTIME: 13 LULUS, 0 GAGAL ===`
(13 assertion non-token: semua method menolak tanpa sesi, token pratinjau salah
ditolak, DELETE ditolak, smoke ter-render). Alur penuh H4 tidak dijalankan di
staging karena `SALES_INVOICE_PREVIEW_TOKEN` sengaja tidak diset.

**Paparan:** `next start` bind ke `*:3001` (semua interface), sama seperti
preview sebelumnya — terjangkau dari loopback & tailnet, tanpa reverse proxy ke
internet.

**Risiko yang perlu diketahui pemilik:** port 3001 sekarang menyajikan branch
ini (belum di-review-merge), bukan `main`. Mengembalikan ke `main`:
`pm2 stop purchasing-staging-3001 && pm2 start purchasing-preview`.

---

## 5. Yang TIDAK dikerjakan (batas kartu)

- **Tidak ada DDL / migrasi** dijalankan. Tabel `sales_invoices` tetap belum
  ada → staging menjawab `503 SCHEMA_UNAVAILABLE` untuk operasi data nyata
  (bukan gagal diam-diam).
- **Tidak ada tulisan ke DB live** (hanya SELECT lewat auth nyata).
- **Tidak ada push / merge ke `main`**, tidak ada tag, tidak ada rilis.
  Branch `feat/ops-workflow-t_cde1b8ad` belum punya upstream.
- **Tidak ada migrasi nomor invoice existing.**
- File CORE yang disentuh **hanya satu baris aditif** di
  `modules/registry.js` (mendaftarkan `docs/report-t_fca26349.md` sebagai file
  modul). `lib/constants.js` dan `pages/index.js` tidak diubah.

---

## 6. Blocker & keputusan yang masih terbuka

1. **Skema `sales_invoices` belum ada** (PGRST205). Semua operasi data nyata
   akan 503 sampai migrasi §5 kontrak disetujui & dijalankan DAT.
2. **RPC transaksional `sales_invoice_issue` belum ada.** Tanpa itu penerbitan
   dilaporkan non-transaksional (CAS + unique index + kompensasi best-effort).
   Keputusan bisnis: aktifkan `SALES_INVOICE_REQUIRE_RPC=1` (fail closed) atau
   terima jalur non-transaksional dengan kompensasi.
3. **Format nomor**: default sekarang format Buku `NL<yymm><XXX>` (reset
   tahunan). Bila pemilik bisnis ingin `INV/NL`, harus set
   `SALES_INVOICE_NO_FORMAT=inv-nl` + `SALES_INVOICE_NO_FORMAT_ACK=1` — dan
   sadar nomor lama tidak dimigrasi.
4. **Data penerbit & rekening** belum tersimpan di mana pun → PDF masih
   menandai "BELUM DIISI"; invoice belum boleh dikirim ke klien.
5. **Termin/bertahap** belum ada tabelnya (`LUNAS` hanya pembayaran penuh).
6. **`rab-boq-test` E7** pre-existing merah (milik pemilik RAB/BOQ).
7. **Review Brooklyn** atas commit `ce4ef3a` belum dilakukan — kartu ini
   melaporkan implementasi, bukan persetujuan reviewer.

---

## 7. Cara memverifikasi ulang

```bash
cd /home/ubuntu/dev-workspaces/agent-1-ops
python3 scripts/sales-invoice-test/run.py                    # 438 assertion
python3 scripts/sales-invoice-test/run_regression.py         # 12/13 hijau (E7 pre-existing)
npx next build && ENABLE_SMOKE=1 npx next build              # build terisolasi
SI_PREVIEW_TOKEN=… node scripts/sales-invoice-test/e2e_runtime_test.mjs http://127.0.0.1:3185
node scripts/sales-invoice-test/e2e_runtime_test.mjs http://127.0.0.1:3001   # staging
```
