# Kontrak Integrasi Marketing → CRM & Project — t_1fd27ad9 (S6)

Tanggal: 18 Okt 2026 · Owner: **bamboo-tech** · Tahap: **S6** (setelah S5 Reminder)
Status DB: **TIDAK ADA SQL DIJALANKAN.** Nol file migrasi, `data/` tidak disentuh,
tidak ada push/deploy, tidak ada pesan terkirim, tidak ada iklan dibeli.

---

## 0. Satu kalimat

Dokumen ini **mendefinisikan** bagaimana Marketing (yang belum dibangun) akan
menyerahkan lead ke CRM dan Project **tanpa mengubah apa pun di purchasing** —
dan menyertakan lapisan kode **dry-run / read-only** yang menegakkan definisi itu
(hari ini: validasi contoh + rencana handoff + pemeriksa ketersediaan tabel).

| Yang DIMINTA kartu | Di mana dijawab |
|---|---|
| Lead source | §2 taksonomi 11 enum tetap |
| Qualification status | §3 mesin status + gerbang bukti per status |
| Customer handoff ke CRM | §4 rencana handoff + kunci dedupe + idempotensi |
| Campaign attribution | §5 first/last touch, UTM, dibekukan saat WON |
| Tanpa public send / paid ads | §7 + ditegakkan harness C2 |
| Dry-run sample schema | §9 + `scripts/marketing/samples.js` (11 fixture) |
| Route guard | §6 (405 method, 403 aksi terlarang, 401/403/503 auth) |
| Tidak mengarang data marketing | §10 (tabel belum ada → BLOCKED, bukan 0) |
| Tidak mengganggu purchasing | §8 delapan invarian, masing-masing dengan bukti |

## 1. Realita hari ini (diverifikasi, bukan asumsi)

Dibaca read-only lewat PostgREST dengan kredensial repo (`.env.local`):

| Tabel | Hasil | Arti untuk kartu ini |
|---|---|---|
| `leads` | `PGRST205` | belum ada |
| `lead_touchpoints` | `PGRST205` | belum ada |
| `campaigns` | `PGRST205` | belum ada |
| `lead_handoffs` | `PGRST205` | belum ada |
| `customers` | `PGRST205` | **CRM belum ada** |
| `sales_invoices` | `PGRST205` | belum ada (warisan S4) |
| `projects` | **206, 11 baris** | ada; marketing hanya **baca** |

Konsekuensi yang dinyatakan terang-terangan: **tidak ada satu pun angka marketing
di dokumen ini.** Semua contoh adalah data karangan yang ditandai (§9), dan
endpoint melaporkan `blocked_capabilities` alih-alih "0 lead".

## 2. Lead source — 11 enum tetap

```js
WALK_IN · REFERRAL · INSTAGRAM · TIKTOK · WHATSAPP · WEBSITE
MARKETPLACE · EVENT · PARTNER · OUTBOUND · OTHER
```

Aturan:

1. **Tertutup.** Nilai di luar daftar ditolak (`UNKNOWN_SOURCE`), bukan disimpan
   sebagai teks bebas. Tanpa ini laporan atribusi pecah jadi ratusan ejaan
   ("ig", "Instagram", "INSTAGRAM ads") dan tidak bisa dijumlahkan.
2. **Detail bebas terpisah.** "Instagram DM dari akun arsitek X" → `source:
   INSTAGRAM`, `source_detail: "DM akun arsitek X"`. `source_detail` **tidak**
   dipakai agregasi.
3. **`OUTBOUND` bukan iklan.** Itu pencarian aktif oleh tim (cold call, canvassing).
   Tidak ada nilai `ADS`/`PAID` di taksonomi — media berbayar memang di luar lingkup
   (arahan kartu: *no paid ads*).
4. **Kanal touchpoint ≠ sumber lead.** `TOUCHPOINT_CHANNELS` (WHATSAPP, PHONE,
   EMAIL, INSTAGRAM_DM, WALK_IN, MARKETPLACE_CHAT, REFERRAL_INTRO, OTHER) adalah
   **label percakapan yang sudah terjadi**, bukan kemampuan mengirim.

## 3. Qualification status — status tanpa bukti ditolak

```
NEW ──▶ CONTACTED ──▶ QUALIFIED ──┬──▶ SURVEYED ──▶ QUOTED ──▶ WON
                                   └──▶ QUOTED
   (semua tahap bisa ──▶ LOST / DORMANT; DORMANT ──▶ CONTACTED / LOST)
```

| Status | Bukti yang WAJIB ada untuk masuk | Kenapa |
|---|---|---|
| `NEW` | identitas kontak + sumber | belum dikualifikasi; jangan pura-pura |
| `CONTACTED` | ≥ 1 `lead_touchpoints` (kanal + waktu + ringkasan) | percakapan tanpa jejak bukan "sudah dihubungi" |
| `QUALIFIED` | `need_summary` + `qualification_basis` (enum) | kebutuhan harus tertulis, dasar kualifikasi harus berkode |
| `SURVEYED` | `survey_date` + `survey_ref` | tanggal saja tanpa rujukan hasil ukur = tidak bisa diaudit |
| `QUOTED` | `quote_ref` + `quote_value > 0` + `quote_date` | penawaran Rp 0 bukan penawaran; rujukan wajib (RAB/BOQ) |
| `WON` | `quote_ref`, `customer_id`, `project_id`, `won_at`, `confirmed_by` | butuh customer CRM **dan** project nyata **dan** konfirmasi admin |
| `LOST` | `lost_reason_code` (enum) + `lost_at` | alasan harus bisa dianalisis |
| `DORMANT` | `last_contact_at` | tanpa ini lead "menguap" tanpa jejak |

Aturan tambahan:

- **`WON` tidak pernah otomatis** dari nilai penawaran. Ia butuh `confirmed_by`
  (admin terverifikasi) dan `project_id` yang **sudah ada** — marketing tidak
  boleh mengarang project (§8 P4/P5).
- **`WON` dan `LOST` final.** Koreksi = lead baru dengan `supersedes_lead_id`.
  Sejarah tidak ditimpa.
- Transisi yang tidak ada di tabel → ditolak `TRANSITION_NOT_ALLOWED`
  (`NEW → WON` tidak boleh lompat).
- `quote_value` dan `budget_*` divalidasi sebagai angka; `budget_min > budget_max`
  ditolak (`BUDGET_RANGE_INVERTED`).
- Field di luar skema → **peringatan** `UNKNOWN_FIELD`, bukan diterima diam-diam.
  Ini pertahanan terhadap "tambah kolom tanpa perubahan kontrak".

## 4. Customer handoff ke CRM — rencana, bukan eksekusi

### 4.1 Kunci dedupe: telepon/email, **tidak pernah** nama

```
customerKey = phone:62812… | email:…@… | null
```

Normalisasi telepon: `0812…`, `+62 812…`, `812…`, `620812…` → `62812…`
(9–15 digit; di luar itu `null`). Dua "Bu Rina" adalah dua orang sampai nomornya
sama. Nama tidak pernah menjadi kunci.

### 4.2 Tiga hasil rencana

| `action` | Kapan | Arti |
|---|---|---|
| `LINK_EXISTING` | CRM sudah punya `customer_key` itu | lead ditautkan, **tidak** membuat customer kedua |
| `CREATE_CUSTOMER` | kunci ada, CRM belum punya | usul satu baris `customers` (dieksekusi modul CRM, bukan di sini) |
| `BLOCKED` | lead belum sah **atau** tidak ada kunci dedupe | tidak boleh menebak; alasan berkode |

Setiap rencana memuat `would_write: false` dan `executed: false` — **selalu**,
di semua kondisi. Lapisan ini tidak punya jalur tulis (harness C1).

### 4.3 Idempotensi

`idempotency_key = "handoff:<lead_id>:<customer_key>"`. Handoff diulang tidak
membuat customer kedua; ia menemukan baris `lead_handoffs` yang sama.

### 4.4 Yang marketing **minta**, bukan lakukan

```jsonc
"project_request": {
  "requested": true,            // hanya bila lead WON
  "executed_by": "projects-module",
  "note": "Marketing TIDAK membuat project. Ia hanya menandai bahwa project perlu dibuat setelah WON.",
  "fields_proposed": { "name": null, "kode": null, "code": null, "status": "NOT_START" }
}
```

`fields_proposed` sengaja bernilai `null`: marketing tidak boleh mengarang nama/kode
project. Nilai riil diisi modul Project saat benar-benar membuatnya.

## 5. Campaign attribution

- **Dua model disimpan berdampingan**: `FIRST_TOUCH` (yang memperkenalkan) dan
  `LAST_TOUCH` (yang meyakinkan). Keduanya berguna; memilih salah satu di muka
  akan menghapus informasi.
- **UTM** dinormalisasi lowercase dan dibatasi 5 kunci standar
  (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`).
  Kunci asing → peringatan `UTM_UNKNOWN_KEY` (tidak dipakai diam-diam).
- **Dibekukan saat `WON`** (`attribution_frozen: true`). Kampanye yang diedit
  belakangan tidak boleh mengubah angka historis. Snapshot disimpan di
  `lead_handoffs.attribution_snapshot`.
- **Lead tanpa kampanye tetap sah** (walk-in, referral) — hanya diberi peringatan
  `ATTRIBUTION_MISSING`, karena tidak bisa dilaporkan per kampanye.
- **`campaigns.is_paid_media` selalu `false`** di lapisan ini. Field-nya ada
  sebagai penanda eksplisit, bukan sebagai pintu masuk integrasi iklan.
  `budget_note` adalah catatan manual, bukan commitment belanja.

## 6. Route guard & otorisasi

### 6.1 Endpoint

```
GET /api/marketing-contract                        → ringkasan kontrak (tanpa jaringan)
GET /api/marketing-contract?view=readiness         → ketersediaan 6 tabel (SELECT)
GET /api/marketing-contract?view=sample            → validasi 11 contoh dry-run
GET /api/marketing-contract?view=sample&sample=valid-won-full
```

CLI setara: `node scripts/marketing/cli.mjs [--readiness|--samples|--validate f.json|--plan f.json] [--json]`.

### 6.2 Tiga lapis guard, berurutan

| # | Guard | Respons | Catatan |
|---|---|---|---|
| 1 | Method ≠ GET | **405** `METHOD_NOT_ALLOWED` | tidak membaca apa pun |
| 2 | Aksi keluar (`?action=send`, `?ads=1`, `?sync=1`, …) | **403** `ACTION_FORBIDDEN` | **sebelum** auth, supaya pemanggil tahu aksinya tidak ada — bukan "belum login" |
| 3 | Otorisasi admin | **401** tanpa sesi / **403** non-admin / **503** fail closed | guard yang **sama** dengan `/api/sales-invoices` (S4), bukan salinan |

Daftar aksi terlarang (34 nama, diuji satu per satu di harness B4):

```
send · send-message · broadcast · blast · publish · post · dm · email ·
whatsapp · wa · sms · call · ads · ad · advertise · campaign-launch ·
launch · boost · promote · spend · budget-commit · audience-upload · pixel ·
write · insert · update · delete · upsert · sync · cron · schedule ·
handoff-execute · execute · apply
```

Respons 403 selalu menyertakan
`side_effects: { outbound_send: false, paid_ads: false, writes: 0 }` — bukan
janji di dokumen, tapi nilai yang dikembalikan.

`?ads=0` / `?send=false` **tidak** diblokir (bukan aksi); `?action=summary`
juga lolos. Guard hanya menangkap aksi yang benar-benar diminta.

### 6.3 Kenapa endpoint ini tidak menerima payload lead

`POST` tidak ada. Validasi memakai `?sample=<id>` (data di repo) atau
`--validate <berkas>`. Alasannya: endpoint yang menerima lead lewat HTTP cepat
atau lambat akan butuh penyimpanan, lalu butuh tabel, lalu "cuma sementara"
menjadi jalur tulis kedua yang tidak tercatat. Kontrak ini sengaja berhenti
sebelum titik itu.

## 7. "Tanpa public send / paid ads" — apa yang ditegakkan kode

| Klaim | Bukti (harness `safety_test.mjs`) |
|---|---|
| Nol jalur tulis | C1: `insert/update/delete/upsert/rpc` di 7 file lapisan → **0** |
| Nol transport pesan | C2a: telegram/WA/twilio/sendgrid/nodemailer/mailgun/webhook/axios/fetch → **0** |
| Nol API iklan | C2b: googleads/graph.facebook/meta-ads/tiktok-ads/pixel/audience-upload → **0** |
| Satu pintu jaringan | C2c/C2d: hanya `probe.js` yang mengimpor `@supabase/supabase-js`; file lain tidak |
| Nol cron | C3: tidak ada `crons` di vercel.json, tidak ada paket penjadwal, tidak ada `setInterval`/`setTimeout` |
| CLI tidak menulis berkas | C8: tidak ada `writeFile*`/`appendFile*`/`mkdir*` di lapisan |

Catatan kejujuran: kata "whatsapp"/"ads"/"cron" **memang muncul** di kode — di
dalam `FORBIDDEN_ACTIONS` dan pesan penolakan. Harness karena itu membuang
komentar **dan isi string** sebelum memeriksa, lalu memastikan kata-kata itu
hanya hidup di string. (Ini persis jenis pemeriksaan yang gagal kalau nanti ada
yang menambahkan `fetch()` sungguhan.)

## 8. Delapan invarian "tidak mengganggu purchasing"

| # | Invarian | Bagaimana dibuktikan |
|---|---|---|
| **P1** | Marketing tidak menulis ke tabel purchasing/keuangan apa pun | C1: nol operasi tulis di seluruh lapisan |
| **P2** | Tidak ada kolom/FK baru pada `purchase_requests`, `pr_items`, `approval_steps`, `receivings`, `receiving_items`, `handovers`, `projects`, `sales_invoices` | C6a nol migrasi; C6c DDL usulan tidak `alter table` tabel itu |
| **P3** | Kode purchasing tidak membaca tabel marketing | C5: pindai `modules/{requests,approvals,receivings,handovers,materials,vendors,projects,rab-boq,rap,sales-invoice}`, `lib/`, dan `pages/api/*` → nol `from('leads'\|'campaigns'\|'customers'\|…)` |
| **P4** | Pembuatan project tetap milik modul projects | `TABLE_OWNERSHIP.projects.marketing = 'read'`; rencana handoff hanya menargetkan `customers` |
| **P5** | Jembatan lead→project **hanya** `projects.id` | skema lead punya `project_id uuid`; tidak ada entitas project kedua |
| **P6** | Nol kirim pesan, nol iklan berbayar | C2a/C2b |
| **P7** | Nol cron/sinkronisasi latar | C3 |
| **P8** | `sales_invoices.customer_id` tetap **nullable** | C6e: paritas dengan `docs/sales-invoice-contract.md` §3 — invoice lama tidak rusak |

**P8 adalah inti "tanpa mengganggu purchasing".** Skema invoice S4 sudah
menyiapkan `customer_id uuid` **tanpa** `not null`, justru karena modul CRM belum
ada. Handoff marketing karenanya **aditif dan opsional**: invoice yang sudah
terbit tetap sah dengan `customer_id = null`, dan tidak ada backfill yang
dipaksakan.

## 9. Skema contoh (dry-run) & DDL usulan

### 9.1 Contoh dry-run di repo

`scripts/marketing/samples.js` berisi **11 fixture** dengan `intent` eksplisit:

| `intent` | Jumlah | Maksud |
|---|---|---|
| `valid` | 4 | harus **lulus** (walk-in tanpa kampanye, referral, WON lengkap, WON untuk klien lama → `LINK_EXISTING`) |
| `gate` | 4 | harus **gagal karena bukti** (QUALIFIED tanpa need, CONTACTED tanpa touchpoint, QUOTED nilai 0, WON tanpa project) |
| `invalid` | 3 | data tidak sah (sumber di luar taksonomi, kontak tidak bisa dihubungi, field di luar kontrak) |

Harness A7 memvalidasi **perilaku** fixture: kalau suatu hari fixture `valid`
malah gagal, uji merah. Fixture yang menipu lebih buruk daripada tidak ada fixture.

Data karangan ditandai: nomor hanya dari rentang `6281200000xxx`, email hanya
`@contoh.invalid` (TLD yang dijamin tidak ada). **Tidak ada data pelanggan nyata
di repo**, dan tidak akan ditambahkan.

Contoh keluaran `--samples` (ringkas):

```
LULUS  valid-won-full          status=WON      key=phone:6281200000033  rencana=CREATE_CUSTOMER
LULUS  valid-won-existing…     status=WON      key=phone:6281200000044  rencana=LINK_EXISTING
GAGAL  gate-quoted-zero-value  ✗ QUOTE_VALUE_INVALID (quote_value)
GAGAL  gate-won-no-project     ✗ GATE_FIELD_MISSING (project_id)
```

### 9.2 DDL usulan — **BELUM DIJALANKAN**

Aditif, RLS admin-only, pola sama dengan modul lain. **Jangan jalankan sebelum
DAT menyetujui.** Tidak satu pun menyentuh tabel purchasing.

```sql
-- USULAN, BELUM DIJALANKAN. Hanya tabel marketing + CRM.
-- Tabel purchasing/keuangan TIDAK diubah (invarian P2).

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,           -- phone:628… | email:…
  name text not null,
  phone text,
  email text,
  city text,
  source_lead_id uuid,                          -- lead pertama yang memperkenalkan
  first_won_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null,                        -- = LEAD_SOURCES
  started_at date not null,
  ended_at date,
  budget_note text,                             -- catatan manual, BUKAN commitment
  is_paid_media boolean not null default false, -- selalu false di lapisan ini
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  schema_version int not null default 1,
  source text not null,                         -- LEAD_SOURCES
  source_detail text,
  status text not null default 'NEW',           -- LEAD_STATUSES
  contact_name text not null,
  contact_phone text,
  contact_email text,
  customer_key text,                            -- hasil normalisasi (§4.1)
  city text,
  need_summary text,
  qualification_basis text,
  budget_min numeric(16,2),
  budget_max numeric(16,2),
  survey_date date,
  survey_ref text,
  quote_ref text,
  quote_value numeric(16,2),
  quote_date date,
  campaign_id uuid references public.campaigns(id) on delete set null,
  attribution jsonb not null default '{}'::jsonb,
  attribution_frozen_at timestamptz,            -- diisi saat WON
  customer_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,  -- SATU-SATUNYA jembatan
  won_at timestamptz,
  confirmed_by uuid,
  lost_reason_code text,
  lost_at timestamptz,
  last_contact_at timestamptz,
  supersedes_lead_id uuid references public.leads(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- gerbang bukti di level DB (bukan hanya aplikasi)
  constraint won_needs_proof check (
    status <> 'WON' or (
      quote_ref is not null and quote_value is not null and quote_value > 0
      and customer_id is not null and project_id is not null
      and won_at is not null and confirmed_by is not null
    )
  ),
  constraint lost_needs_reason check (
    status <> 'LOST' or (lost_reason_code is not null and lost_at is not null)
  ),
  constraint quote_value_positive check (quote_value is null or quote_value > 0)
);

create table if not exists public.lead_touchpoints (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel text not null,                        -- TOUCHPOINT_CHANNELS
  direction text not null check (direction in ('INBOUND','OUTBOUND')),
  occurred_at timestamptz not null,             -- kapan TERJADI, bukan kapan dicatat
  summary text not null,
  recorded_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_key text not null,
  action text not null check (action in ('LINK_EXISTING','CREATE_CUSTOMER')),
  idempotency_key text not null unique,         -- handoff:<lead>:<key>
  attribution_snapshot jsonb not null default '{}'::jsonb,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  unique (lead_id, customer_key)
);

-- RLS: admin-only, pola sama dengan modul lain.
-- CATATAN: `projects` TIDAK diubah. Marketing hanya diberi SELECT.
```

Perhatikan: `projects` **tidak** muncul sebagai DDL. Marketing hanya butuh
`select` ke tabel yang sudah ada — dan itu pun belum dibutuhkan hari ini karena
belum ada baris lead.

## 10. Arti "tidak tersedia" (pola S5, dipertahankan)

`view=readiness` tidak pernah melaporkan "0 lead". Ia melaporkan:

```jsonc
{
  "data_ready": false,
  "status": "degraded",
  "readiness": {
    "marketing_tables_ready": false,
    "crm_table_ready": false,
    "project_table_ready": true,
    "sources_available": ["projects"],
    "sources_unavailable": [
      { "key": "leads", "table": "leads", "owner": "marketing",
        "error_code": "SCHEMA_UNAVAILABLE", "error_message": "Could not find the table 'public.leads' in the schema cache" }
    ],
    "blocked_capabilities": [
      { "capability": "lead_pipeline",
        "reason": "Tabel leads/campaigns belum ada — pipeline TIDAK dinilai (bukan berarti kosong)." },
      { "capability": "customer_handoff",
        "reason": "Tabel customers (CRM) belum ada — handoff hanya bisa DIRENCANAKAN, tidak dieksekusi." }
    ]
  }
}
```

Kalau pembacaan gagal total → **502** `PROBE_FAILED`, bukan laporan kosong yang
tampak aman.

## 11. Bentuk file & kepemilikan

```
pages/api/marketing-contract.js        # endpoint tipis (re-export) — GET saja
scripts/marketing/handler.js           # logika endpoint + route guard
scripts/marketing/contract.js          # kontrak MURNI: enum, transisi, gerbang, validator, rencana
scripts/marketing/probe.js             # pembaca ketersediaan tabel (satu-satunya yang menyentuh jaringan)
scripts/marketing/auth.js              # guard admin (memakai ulang guard S4, bukan salinan)
scripts/marketing/samples.js           # 11 fixture dry-run (data karangan, ditandai)
scripts/marketing/cli.mjs              # alat terminal: ringkasan/readiness/samples/validate/plan
scripts/marketing-test/contract_test.mjs  # A: kontrak murni (121 assertion)
scripts/marketing-test/api_test.mjs       # B: auth + route guard + endpoint (109 assertion)
scripts/marketing-test/safety_test.mjs    # C: bukti tidak mengganggu purchasing (29 assertion)
scripts/marketing-test/run.py             # runner A+B+C
docs/marketing-crm-integration-contract.md # dokumen ini
docs/report-t_1fd27ad9.md                  # laporan hasil kerja
```

**Tidak ada file milik modul/agent lain yang diubah** (harness C7). Tidak ada
entri menu/UI: kartu ini melarang menyentuh UI agent lain, dan kontrak marketing
belum punya halaman yang perlu ditampilkan. Bila nanti DAT ingin panel di Admin
Suite, itu pekerjaan terpisah yang menyentuh file CORE (`modules/registry.js`,
`pages/index.js`).

Satu pengecualian yang disengaja: `scripts/pr-purchase-compact-test/render_test.mjs`
(assertion kepemilikan harness S1/S2) memakai daftar **enumeratif** file yang
boleh berubah, jadi endpoint baru kartu ini harus didaftarkan di sana — persis
seperti yang dilakukan kartu S4 (`ab55d39`) dan S5 (`d04d5df`). Tidak ada
assertion yang dilonggarkan; larangan migrasi, `modules/materials`,
`modules/vendors`, dan kontrak `modules/handovers/actions.js`+`logic.js` tetap
terkunci.

## 12. Verifikasi

| Harness | Isi | Hasil |
|---|---|---|
| `contract_test.mjs` (A) | taksonomi, transisi, gerbang bukti, dedupe, rencana handoff, atribusi, perilaku fixture, kemurnian | **121 lulus / 0 gagal** |
| `api_test.mjs` (B) | 401/403/503, 405, **403 untuk 34 aksi terlarang**, readiness BLOCKED, sample dry-run, bukti tanpa jalur tulis | **109 lulus / 0 gagal** |
| `safety_test.mjs` (C) | nol tulis, nol transport/iklan/cron, probe tidak menyentuh tabel purchasing, purchasing tidak membaca tabel marketing, nol migrasi, nol file modul lain | **29 lulus / 0 gagal** |

```bash
python3 scripts/marketing-test/run.py          # A + B + C (tanpa DB/jaringan)
node scripts/marketing/cli.mjs --samples       # lihat validasi 11 contoh
node scripts/marketing/cli.mjs --readiness     # cek tabel (SELECT saja)
```

## 13. Yang BELUM ada (jujur)

1. **Belum ada satu pun tabel marketing/CRM.** `leads`, `lead_touchpoints`,
   `campaigns`, `lead_handoffs`, `customers` semuanya `PGRST205`. Karena itu
   pipeline lead dan handoff **BLOCKED** — bukan "0 lead", bukan "handoff selesai".
   DDL usulan §9.2 menunggu persetujuan DAT; kartu ini **tidak menjalankannya**.
2. **Belum ada modul Marketing maupun UI-nya.** Kontrak ini mendefinisikan
   antarmuka; implementasinya pekerjaan modul terpisah (dan butuh tabel dulu).
3. **Belum ada modul CRM.** `customers` belum ada; `sales_invoices.customer_id`
   sudah disiapkan S4 tetapi selalu `null` hari ini.
4. **Atribusi pendapatan belum tersambung.** Marketing **tidak** membaca
   `sales_invoices` (itu milik S4). Laporan "kampanye X menghasilkan Rp Y" harus
   dibangun di atas lapisan read-only S5/CRM, bukan dengan menambah query di sini.
5. **Belum ada keputusan bisnis DAT** soal: definisi `QUALIFIED` yang mengikat,
   lama maksimum lead di `DORMANT`, dan apakah `REFERRAL` perlu komisi. Kontrak
   ini menetapkan *struktur* untuk menjawabnya, bukan jawabannya.
6. **Tidak ada pengiriman pesan dan tidak ada iklan** — itu keputusan desain
   untuk kartu ini, bukan keterbatasan teknis. Menambahkannya butuh kartu baru
   dan persetujuan eksplisit (dan akan memerahkan harness C2a/C2b).
7. **`lead_score` dan sejenisnya sengaja tidak ada.** Skoring otomatis akan
   mengarang prioritas dari data yang belum ada. Bila nanti dibutuhkan, ia harus
   masuk lewat perubahan kontrak dengan rumus yang bisa diaudit.
