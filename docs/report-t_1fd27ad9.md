# Laporan S6 — Blueprint Integrasi Marketing ke CRM & Project (t_1fd27ad9)

Tanggal: 18 Okt 2026 · Agent: **bamboo-tech** · Branch: `feat/ops-workflow-t_cde1b8ad`
Base: `d04d5df` (S5, lewat S4/S3/S2/S1)
Migrasi DB: **nol** · `data/` tidak disentuh · tidak ada push/deploy · tidak ada pesan terkirim · tidak ada iklan dibeli.

---

## 1. Apa yang diminta vs apa yang dikerjakan

Kartu: *"define lead-to-project integration contract for future Marketing without
disrupting purchasing. Own docs/API read-only contract only: lead source,
qualification status, customer handoff to CRM, campaign attribution, no public
send/paid ads. Add dry-run sample schema and route guard; do not invent live
marketing data or send messages."*

| Permintaan | Hasil |
|---|---|
| Lead source | 11 enum tetap + `source_detail` terpisah (taksonomi tertutup) |
| Qualification status | 8 status, 6 transisi beraturan, **gerbang bukti per status** |
| Customer handoff ke CRM | Rencana deterministik `LINK_EXISTING`/`CREATE_CUSTOMER`/`BLOCKED` + kunci dedupe telepon/email + idempotensi |
| Campaign attribution | First-touch & last-touch berdampingan, UTM 5 kunci, **dibekukan saat WON** |
| No public send / paid ads | Ditegakkan kode: 48 aksi terlarang → 403; nol transport; nol API iklan |
| Dry-run sample schema | 11 fixture ber-`intent` + DDL usulan bertanda **BELUM DIJALANKAN** |
| Route guard | 405 (method) → 403 (aksi) → 401/403/503 (auth), berurutan |
| Tidak mengarang data marketing | Tabel belum ada → `blocked_capabilities`, bukan "0 lead" |
| Tanpa mengganggu purchasing | 8 invarian, tiap satu punya bukti otomatis |

## 2. File yang dibuat

| File | Peran |
|---|---|
| `pages/api/marketing-contract.js` | Endpoint tipis (re-export). **GET saja.** |
| `scripts/marketing/contract.js` | Kontrak **murni**: enum, mesin status, gerbang bukti, validator, rencana handoff, ringkasan |
| `scripts/marketing/probe.js` | Pemeriksa ketersediaan tabel — **satu-satunya** file yang menyentuh jaringan (hanya `select`) |
| `scripts/marketing/handler.js` | Logika endpoint + route guard (diuji harness apa adanya, tidak ada salinan kedua) |
| `scripts/marketing/auth.js` | Guard admin — **memakai ulang** `modules/sales-invoice/auth.js` (S4), bukan salinan |
| `scripts/marketing/samples.js` | 11 fixture dry-run, data karangan yang ditandai |
| `scripts/marketing/cli.mjs` | Alat terminal: ringkasan / `--readiness` / `--samples` / `--validate` / `--plan` |
| `scripts/marketing/package.json` | Penanda ESM saja; **nol dependensi baru** |
| `scripts/marketing-test/contract_test.mjs` | Harness A (121 assertion) |
| `scripts/marketing-test/api_test.mjs` | Harness B (109 assertion) |
| `scripts/marketing-test/safety_test.mjs` | Harness C (33 assertion) |
| `scripts/marketing-test/fake_supabase.mjs` | Supabase palsu: mencatat tulis **dan** pembacaan tabel purchasing |
| `scripts/marketing-test/e2e_runtime_test.mjs` | Harness D (52 assertion, HTTP nyata) |
| `scripts/marketing-test/run.py` / `run_e2e.py` | Runner A+B+C / D |
| `docs/marketing-crm-integration-contract.md` | **Deliverable utama**: kontrak lengkap + DDL usulan |
| `docs/report-t_1fd27ad9.md` | Dokumen ini |

Satu file di luar folder kartu berubah: `scripts/pr-purchase-compact-test/render_test.mjs`
(+8 baris). Assertion kepemilikan harness S1/S2 memakai daftar **enumeratif**, jadi
endpoint baru harus didaftarkan — persis seperti kartu S4 (`ab55d39`) dan S5
(`d04d5df`). Tidak ada assertion yang dilonggarkan.

## 3. Realita data (diverifikasi read-only, bukan asumsi)

Dibaca lewat PostgREST dengan kredensial repo (`.env.local`):

| Tabel | HTTP | Hasil |
|---|---|---|
| `leads` | 404 | `PGRST205` — belum ada |
| `lead_touchpoints` | 404 | `PGRST205` |
| `campaigns` | 404 | `PGRST205` |
| `lead_handoffs` | 404 | `PGRST205` |
| `customers` | 404 | `PGRST205` — **CRM belum ada** |
| `sales_invoices` | 404 | `PGRST205` (warisan S4, belum dimigrasikan) |
| `projects` | **206** | **11 baris** — marketing hanya baca |

Karena itu **tidak ada satu angka marketing pun** di laporan ini. Semua contoh
adalah data karangan yang ditandai (nomor `6281200000xxx`, email `@contoh.invalid`).

## 4. Bukti "tidak ada kirim / iklan / tulis / cron"

Bukan klaim — diuji dari file di repo dan dari runtime nyata:

| Klaim | Bukti | Hasil |
|---|---|---|
| Nol jalur tulis | C1: pindai 7 file lapisan untuk `.insert/.update/.delete/.upsert/.rpc` | **0** |
| Nol transport pesan | C2a: telegram/WA/twilio/sendgrid/nodemailer/mailgun/webhook/axios/fetch | **0** |
| Nol API iklan | C2b: googleads/graph.facebook/meta-ads/tiktok-ads/pixel/audience-upload | **0** |
| Satu pintu jaringan | C2c/C2d: hanya `probe.js` yang impor `@supabase/supabase-js` | ✔ |
| Nol cron | C3: tidak ada `crons` di vercel.json, tidak ada paket penjadwal, tidak ada timer | **0** |
| Nol tulis saat runtime | D8a: server Next nyata + Supabase palsu yang mencatat POST/PATCH/DELETE | **0 tulis** |
| Nol baca tabel purchasing | D9a: server palsu menolak & mencatat pembacaan `purchase_requests`/… | **0 baca** |
| CLI tidak menulis berkas | C8: tidak ada `writeFile*/appendFile*/mkdir*` | **0** |
| Method tulis ditolak | B3/D4: POST/PUT/PATCH/DELETE → **405** tanpa membaca data | ✔ |
| Aksi keluar ditolak | B4/D5: 48 nama aksi, satu per satu → **403** sebelum auth | ✔ |

Catatan kejujuran: kata "whatsapp"/"ads"/"cron" memang ada di kode — di dalam
`FORBIDDEN_ACTIONS` dan pesan penolakan. Harness karena itu membuang komentar
**dan isi string** sebelum memeriksa, lalu memastikan kata-kata itu hanya hidup
di string. Ini justru pemeriksaan yang akan gagal bila nanti ada yang menambah
`fetch()` sungguhan.

## 5. Bukti "tidak mengganggu purchasing" (delapan invarian)

| # | Invarian | Bukti otomatis |
|---|---|---|
| P1 | Marketing tidak menulis tabel purchasing/keuangan | C1 (nol operasi tulis) |
| P2 | Tidak ada kolom/FK baru di tabel purchasing | C6a (nol migrasi) + C6c (DDL usulan tanpa `alter table` tabel itu) |
| P3 | Kode purchasing tidak membaca tabel marketing | C5: pindai `modules/{requests,approvals,receivings,handovers,materials,vendors,projects,rab-boq,rap,sales-invoice}`, `lib/`, `pages/api/*` → **0** |
| P4 | Pembuatan project tetap milik modul projects | `projects.marketing = 'read'`; target handoff hanya `customers` |
| P5 | Jembatan lead→project hanya `projects.id` | skema lead `project_id uuid`; tidak ada entitas project kedua |
| P6 | Nol kirim pesan, nol iklan berbayar | C2a/C2b |
| P7 | Nol cron/sinkronisasi | C3 |
| P8 | `sales_invoices.customer_id` tetap **nullable** | C6e (paritas `docs/sales-invoice-contract.md` §3) |

**P8 adalah inti "tanpa mengganggu purchasing".** Skema invoice S4 sudah
menyiapkan `customer_id uuid` tanpa `not null` justru karena CRM belum ada. Jadi
handoff marketing bersifat **aditif & opsional**: invoice yang sudah terbit tetap
sah dengan `customer_id = null`, tanpa backfill yang dipaksakan.

## 6. Route guard (tiga lapis, berurutan)

| # | Guard | Respons | Bukti |
|---|---|---|---|
| 1 | Method ≠ GET | **405** `METHOD_NOT_ALLOWED` | B3 (4 method × 4 assertion), D4 |
| 2 | Aksi keluar (`?action=send`, `?ads=1`, `?sync=1`, …) | **403** `ACTION_FORBIDDEN` | B4 (48 aksi + flag), D5 |
| 3 | Otorisasi admin | **401/403/503** | B1/B2, D1/D2 |

Guard #2 sengaja jalan **sebelum** auth: tanpa sesi pun `?action=send` dijawab
**403**, bukan 401 — supaya jelas aksinya tidak ada, bukan cuma "belum login".
`?ads=0` dan `?action=summary` **tidak** diblokir (bukan aksi).

## 7. Kondisi nyata endpoint hari ini

```
$ node scripts/marketing/cli.mjs --readiness
  TIDAK    leads            SCHEMA_UNAVAILABLE — owner marketing
  TIDAK    lead_touchpoints SCHEMA_UNAVAILABLE — owner marketing
  TIDAK    campaigns        SCHEMA_UNAVAILABLE — owner marketing
  TIDAK    lead_handoffs    SCHEMA_UNAVAILABLE — owner marketing
  TIDAK    customers        SCHEMA_UNAVAILABLE — owner crm
  TERSEDIA projects         11 baris · owner projects

Tabel marketing siap : TIDAK — pipeline lead TIDAK dinilai (bukan berarti kosong)
Tabel CRM siap       : TIDAK — handoff hanya bisa DIRENCANAKAN, tidak dieksekusi
Tabel projects siap  : YA (baca saja)
```

```
$ node scripts/marketing/cli.mjs --samples
Total: 11 contoh · 5 lulus · 6 gagal
```

5 lulus = 4 fixture `valid` + 1 fixture `invalid` yang maksudnya justru
*peringatan* (field di luar kontrak), 6 gagal = 4 gerbang bukti + 2 data tidak sah.
Rinciannya di `docs/marketing-crm-integration-contract.md` §9.1.

## 8. Verifikasi

| Harness | Isi | Hasil |
|---|---|---|
| `contract_test.mjs` (A) | taksonomi, transisi, gerbang bukti, dedupe, rencana handoff, atribusi, perilaku fixture, kemurnian | **121 / 0** |
| `api_test.mjs` (B) | 401/403/503, 405, **403 untuk 48 aksi**, readiness BLOCKED, sample dry-run, bukti tanpa jalur tulis | **109 / 0** |
| `safety_test.mjs` (C) | nol tulis, nol transport/iklan/cron, probe bersih dari tabel purchasing, purchasing tidak baca tabel marketing, nol migrasi, nol file modul lain | **33 / 0** |
| `e2e_runtime_test.mjs` (D) | HTTP nyata ke `next start` + Supabase palsu | **52 / 0** |

**Total 315 assertion, 0 gagal.**

```bash
python3 scripts/marketing-test/run.py        # A + B + C (tanpa DB/jaringan) → 263/0
python3 scripts/marketing-test/run_e2e.py    # D (menyalakan Next + Supabase palsu) → 52/0
```

### Build & regresi

- `ENABLE_SMOKE=1 npx next build` → **hijau**, `/api/marketing-contract` terdaftar.
- `scripts/reminders-test/run_e2e.py` (S5) → **36/36**, tidak terganggu.
- 20 suite regresi lain dijalankan; **17 hijau**. Tiga merah:

| Suite | Status | Bukti pre-existing |
|---|---|---|
| `rab-boq-test` (E7) | merah | sudah merah sejak `ac71191`, tercatat di handoff S5 |
| `rab-boq-render-test` (F1/F2) | merah | **dijalankan ulang di worktree bersih HEAD `d04d5df`** → tetap merah, tanpa satu pun perubahan saya |
| `ui-olive-tokens-test` (font-weight 750) | merah | idem: worktree bersih HEAD → tetap 34/1 |

Ketiganya menyentuh `pages/index.js` / `styles/globals.css` — file yang **tidak
disentuh kartu ini** (`git diff HEAD -- styles/ pages/ modules/ lib/ components/`
→ kosong). Verifikasi silang dilakukan dengan `git worktree add ... HEAD` supaya
klaim "pre-existing" bisa diperiksa ulang, bukan hanya dipercaya.

## 9. Yang BELUM ada (jujur)

1. **Nol tabel marketing/CRM.** Semua `PGRST205`. DDL usulan §9.2 dokumen
   **belum dijalankan** — menunggu persetujuan DAT. Kartu ini sengaja tidak
   menyentuh DB.
2. **Belum ada modul Marketing maupun UI-nya.** Kontrak ini mendefinisikan
   antarmuka; implementasi = pekerjaan modul terpisah (butuh tabel dulu).
3. **Belum ada modul CRM.** `sales_invoices.customer_id` sudah disiapkan S4 tapi
   selalu `null` hari ini.
4. **Atribusi pendapatan belum tersambung.** Marketing **tidak** membaca
   `sales_invoices` (milik S4). Laporan "kampanye X → Rp Y" harus dibangun di atas
   lapisan read-only S5/CRM, bukan dengan menambah query di sini.
5. **Belum ada keputusan bisnis DAT** soal definisi `QUALIFIED` yang mengikat,
   lama maksimum `DORMANT`, dan apakah `REFERRAL` perlu komisi. Kontrak
   menetapkan **struktur** untuk menjawabnya, bukan jawabannya.
6. **Nol pengiriman pesan & nol iklan** — keputusan desain, bukan keterbatasan.
   Menambahkannya butuh kartu baru + persetujuan eksplisit, dan akan memerahkan
   harness C2a/C2b (itu memang disengaja).
7. **`lead_score` sengaja tidak ada.** Skoring otomatis akan mengarang prioritas
   dari data yang belum ada. Bila dibutuhkan, harus lewat perubahan kontrak
   dengan rumus yang bisa diaudit.

## 10. Catatan untuk worker berikutnya (S7)

- **Jangan menambahkan `insert/update/delete/upsert/rpc`, transport pesan,
  API iklan, atau timer ke `scripts/marketing/`** tanpa kartu baru: harness
  C1/C2/C3 akan gagal dan itu memang disengaja.
- Menambah tabel baca = tambah entri `READABLE_SOURCES` di `probe.js` **dan**
  `TABLE_OWNERSHIP` di `contract.js`; harness C4b mengunci jumlahnya di 6.
- Jangan menyebut tabel purchasing di `probe.js` — C4a memeriksa file itu
  **termasuk komentar** (itu satu-satunya file yang menyusun daftar query).
- `MARKETING_BASE` menimpa basis perbandingan harness C6/C7. Default-nya
  **otomatis**: commit yang pertama kali menambahkan `scripts/marketing/contract.js`
  lalu induknya (yaitu commit tempat kartu ini mulai). `MARKETING_BASE=main` akan
  menampilkan seluruh perubahan branch S1..S5 — berguna untuk audit branch, tetapi
  memang akan memerahkan C7 (bukan pelanggaran kartu ini).
- Endpoint baru di `pages/api/` akan memerahkan assertion F1 di
  `scripts/pr-purchase-compact-test/render_test.mjs` sampai didaftarkan —
  itu perilaku yang diharapkan, bukan bug.
- Blocker DB (kredensial migrasi) belum terselesaikan: `customers` dan
  `sales_invoices` sama-sama masih `PGRST205`. S7 sebaiknya melaporkannya
  sebagai blocker rilis, bukan mencoba menjalankan DDL.
