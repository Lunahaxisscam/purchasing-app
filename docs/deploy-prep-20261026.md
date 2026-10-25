# Persiapan Deploy — Git + Vercel + Supabase (26 Okt 2026)

| | |
|---|---|
| Tiket | `t_393fd288` — persiapan deploy (snapshot + runbook) |
| Status | **PERSIAPAN SAJA.** Tidak ada push, tidak ada deploy, tidak ada DDL yang dijalankan. |
| Branch snapshot | `deploy/snapshot-20261026` |
| Commit snapshot | `16a9d5d` — "snapshot staging 26 Okt utk deploy" |
| Commit dokumen | `a34352d` — paket SQL + runbook ini (di atas snapshot) |
| Basis | `master` @ `d855c8e` (baseline PLAYFIELD 25 Okt + Project ID Upah & Kasbon) |
| Sumber isi | `/home/ubuntu/dev-workspaces/purchasing-api_t_dd743609_playfield` (staging live, **tidak diubah**) |
| Supabase project ref | `wuurovgjflrhczlsbixm` |
| MCP untuk eksekusi | `windows_mcp` → `http://100.97.211.5:8080/win/mcp` (streamable_http, bearer) — **hidup, 20 tools** |

> **Aturan dokumen ini:** hanya **nama** variabel dan **asal nilainya**. Tidak ada satu pun nilai
> kredensial (URL, anon key, service_role, token) yang ditulis di sini. Semua ditandai `[REDACTED]`.

---

## 0. Ringkasan — apa yang sudah siap, apa yang menunggu DAT

**Sudah selesai di tiket ini**

1. Snapshot source deploy: branch `deploy/snapshot-20261026`, commit `16a9d5d`.
   - 662 file terlacak; commit berisi **15 file berubah** (+501 / −299).
   - Isi = staging live apa adanya. `diff -r` staging vs working tree = **0 selisih**
     (kecuali 3 dokumen paket SQL yang sengaja ditambahkan, lihat §5).
   - `.env.local` **tidak** ikut ter-commit (lihat §9 untuk bukti perintahnya).
2. Bundle git siap kirim ke PC Windows: `/home/ubuntu/deploy-artifacts/purchasing-deploy-20261026.bundle`
   (4,3 MB, sha256 `432f048ebb653287b1f1ab3692a8eacd38efb744dd3e83e83420b2abec2c497f`, riwayat lengkap).
3. Probe `windows_mcp` ulang dengan handshake MCP yang benar: **initialize 200 → session → tools/list 200,
   20 tools** (hipotesis "session header tidak dikirim" terbukti, lihat §6).
4. Inventarisasi env aplikasi dari kode (`grep process.env`) → tabel di §2.
5. Urutan SQL deploy + status tiap objek → tabel di §5.
6. Rollback deploy (Vercel / Git / DB) → §7.

**Menunggu jawaban DAT (maks 5)** — detail di §1:

| # | Yang ditunggu | Kenapa menghambat |
|---|---|---|
| 1 | **Repo Git**: provider (GitHub/GitLab), owner/org, nama repo, private/public, URL | tanpa URL tidak ada `git remote add origin` |
| 2 | **Vercel**: akun/tim + cara deploy (dashboard import vs CLI) | menentukan langkah §4 A atau B |
| 3 | **Supabase**: `service_role` key (belum ada di `.env.local` staging) + keputusan manual SQL vs `supabase` CLI | env wajib untuk fitur tulis; keputusan menentukan §5 |
| 4 | **Domain produksi**: apakah `purchasing.noirliving.app` (hardcoded di `lib/bakpau/constants.js`) dipakai, dan siapa pegang DNS | menentukan custom domain + verifikasi |
| 5 | **Identitas git di PC Windows** (`user.name`, `user.email` masih kosong) + kredensial push (PAT) | commit/tag di PC Windows akan gagal tanpa identitas |

---

## 1. Prasyarat dari DAT

### 1.1 Akun & repo Git

| Item | Nilai yang dibutuhkan | Rekomendasi |
|---|---|---|
| Provider | GitHub **atau** GitLab | **GitHub** — integrasi Vercel paling mulus, `git push` memicu deploy otomatis |
| Owner | akun pribadi atau organisasi | org bila nanti ada tim |
| Nama repo | — | `purchasing-app` |
| Visibility | private / public | **private** (repo berisi kontrak & dokumen internal) |
| URL | `https://github.com/<owner>/purchasing-app.git` | dipakai di §3 |
| Kredensial push | PAT (fine-grained, scope `contents: write`) atau SSH key | PAT + Git Credential Manager di PC Windows; **DAT yang memasukkan token**, bukan agen |

Catatan: `gh` CLI **tidak terpasang** di PC Windows (hasil probe §6.3). Pembuatan repo dilakukan DAT
di browser, atau agen membuka halaman GitHub lewat `windows_mcp` **tanpa** menekan tombol final.

### 1.2 Vercel

| Item | Nilai yang dibutuhkan | Rekomendasi |
|---|---|---|
| Akun/tim | email pemilik / nama team | team DAT |
| Cara deploy | **dashboard import** (Git integration) atau **CLI** | **Dashboard import** — auto-deploy tiap push ke `main`; CLI hanya untuk cek/rollback |
| Region function | pilih region terdekat DB | samakan dengan region project Supabase `wuurovgjflrhczlsbixm` (lihat dashboard Supabase → Project Settings) |
| Node.js version | 20.x | pin **20.x** di Project Settings (Next 14.1 mensyaratkan Node ≥ 18.17; 20.x LTS paling aman) |

`vercel` CLI **belum terpasang** di PC Windows. Kalau DAT memilih jalur CLI:
`npm i -g vercel` (prefix npm sudah user-writable — tidak perlu admin), lalu `vercel login` (interaktif,
DAT yang menyelesaikan login browser).

### 1.3 Supabase

| Item | Nilai | Catatan |
|---|---|---|
| Project ref | `wuurovgjflrhczlsbixm` | sudah dipakai aplikasi live |
| URL project | `[REDACTED]` | = `NEXT_PUBLIC_SUPABASE_URL` di `.env.local` staging |
| Anon key | `[REDACTED]` | = `NEXT_PUBLIC_SUPABASE_ANON_KEY` di `.env.local` staging |
| **Service role key** | `[REDACTED]` — **BELUM ADA di `.env.local`** | DAT ambil dari Supabase → Project Settings → API → `service_role`. Hanya untuk env server Vercel, **jangan** `NEXT_PUBLIC_*` |
| Cara deploy DB | **manual SQL** (SQL Editor) vs `supabase` CLI migration | **Rekomendasi: manual SQL.** Alasannya ada paket yang memang dijalankan tangan (PASTE per blok, dengan gerbang & angka kontrol): `docs/paket-terapkan-mapping-DAT.md` dan `docs/paket-hidupkan-sales-invoice-DAT.md`. CLI migration akan mengeksekusi berkas utuh tanpa gerbang, dan `*.DRAFT.sql` sengaja tidak boleh jalan otomatis |

`supabase` CLI juga belum terpasang di PC Windows — satu alasan lagi memilih manual SQL.

### 1.4 Domain

`lib/bakpau/constants.js` menulis `APP_LINK_BASE = 'https://purchasing.noirliving.app'` (dipakai untuk
link balasan notifikasi). Perlu keputusan DAT:

- Kalau domain itu yang dipakai: tambahkan custom domain di Vercel + CNAME DNS ke `cname.vercel-dns.com`.
- Kalau sementara pakai domain `*.vercel.app`: link di `APP_LINK_BASE` akan menunjuk domain lama —
  perlu tiket terpisah untuk menyamakan (bukan blocker deploy pertama).

### 1.5 Identitas & kredensial di PC Windows (hasil probe §6.3)

- `git config --global user.name` dan `user.email` **kosong** → harus diisi DAT (atau diizinkan agen
  mengisinya dengan nilai yang DAT tentukan).
- Tidak ada SSH key yang terverifikasi untuk GitHub. Jalur paling cepat: PAT + Git Credential Manager
  (popup kredensial diisi DAT).
- Windows tidak punya `gh`, `vercel`, `supabase` (bisa dipasang; `npm` tersedia).

---

## 2. ENV Vercel

### 2.1 Cara inventarisasi

```bash
# di root repo (tanpa node_modules/.next)
grep -rhoE "process\.env\.[A-Z0-9_]+" --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' . \
  | sort | uniq -c | sort -rn
```

Hasil mentah (26 nama) dibagi tiga: **dipakai aplikasi** (tabel 2.2), **hanya harness/scripts**
(`SI_REPO`, `RAP_REPO`, `INTEG_REPO`, `HARNESS_REPO`, `CW_LIB`, `S3_WT`, `PGURL`, `CDP_HTTP`,
`SANDBOX_DIR`, `TEST_ROLE`, `DEBUG_LABELS`, `BASE`, `PATH`, `PORT`), dan **build-time lokal**
(`ENABLE_SMOKE`). Yang di bawah ini hanya yang relevan untuk runtime Vercel.

### 2.2 Tabel variabel

| Variabel | Wajib? | Dipakai di | Sumber nilai | Catatan |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **WAJIB** | `lib/supabaseClient.js`, `modules/sales-invoice/*`, `lib/bakpau/*`, 11 titik | `.env.local` staging (baris 1) / Supabase → Settings → API → Project URL | publik (ter-inline saat build) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **WAJIB** | idem, 11 titik | `.env.local` staging (baris 2) / Supabase → Settings → API → `anon` | publik, dilindungi RLS |
| `SUPABASE_URL` | **WAJIB (server)** | `pages/api/*` (7 titik) | nilai **sama** dengan `NEXT_PUBLIC_SUPABASE_URL` | ada fallback ke `NEXT_PUBLIC_*`, tapi isi eksplisit lebih aman |
| `SUPABASE_SERVICE_ROLE_KEY` | **WAJIB untuk fitur tulis** | `pages/api/sales-invoices.js`, `sync-materials.js`, `schema.js`, `inspect.js`, `check-columns.js`, `alerts/telegram.js` | Supabase → Settings → API → `service_role` `[REDACTED]` | **server-only**. Tanpa ini: modul sales-invoice `blocked: MISSING_CREDENTIALS` (fail-closed di produksi) |
| `MAINTENANCE_TOKEN` | Opsional | `pages/api/{schema,inspect,columns,check-columns,sync-materials}.js` | DAT membuat string acak ≥ 32 char | tanpa ini endpoint maintenance menjawab `403` (by design, bukan bug) |
| `POSTGRES_URL` | Opsional | `pages/api/columns.js` saja | Supabase → Settings → Database → Connection string (pooler, port 6543) | tanpa ini endpoint `columns` menjawab `500 No POSTGRES_URL` |
| `SALES_INVOICE_STORE` | Opsional | `modules/sales-invoice/store.js` | tetapkan `supabase` bila ingin eksplisit | **jangan** `file` di produksi — ditolak `FILE_STORE_FORBIDDEN_IN_PRODUCTION` |
| `SALES_INVOICE_NO_FORMAT_ACK` | Opsional | `modules/sales-invoice/store.js` | hanya bila DAT memutuskan format `INV/NL` | default `legacy-buku` (`NLyymm###`); tanpa ACK penerbitan ditolak `NUMBER_FORMAT_NOT_AGREED` |
| `BAKPAU_TELEGRAM_WEBHOOK_SECRET` | Opsional | `pages/api/bakpau/telegram.js` | DAT | hanya kalau konektor Bakpau diaktifkan (belum ter-wire di UI) |
| `BAKPAU_TELEGRAM_ALLOWED_USER_IDS` | Opsional | idem | DAT | allowlist user id |
| `BAKPAU_WA_WEBHOOK_SECRET` | Opsional | `pages/api/bakpau/whatsapp.js` | DAT | idem |
| `BAKPAU_WA_ALLOWED_JIDS` | Opsional | idem | DAT | idem |
| `BAKPAU_NOTIFY_ENABLED` | Opsional | `lib/bakpau/*` | `1` untuk aktif | default mati |
| `BAKPAU_LEDGER_MODE` | Opsional | `lib/bakpau/*` | DAT | default aman |
| `ENABLE_SMOKE` | **JANGAN diset** | `pages/__smoke.js` | — | kalau diset, rute `/__smoke` (mock data internal) jadi publik |

### 2.3 Aturan penting

1. **`NEXT_PUBLIC_*` di-inline saat build.** Mengubah nilainya **wajib redeploy**, bukan cukup save.
   Jadi isi env dulu, baru deploy pertama.
2. **`SUPABASE_SERVICE_ROLE_KEY` tidak boleh** diberi prefix `NEXT_PUBLIC_` — itu akan mengirim kunci
   super ke browser.
3. `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL` diisi otomatis oleh Vercel — jangan ditambahkan manual.
4. `.env.local` **tidak** di-commit dan **tidak** di-upload; Vercel hanya memakai env dari dashboard.
5. Untuk Preview environment, minimal isi 4 variabel wajib (boleh menunjuk project Supabase yang sama;
   kalau DAT ingin preview aman, pakai project Supabase terpisah — keputusan DAT).

### 2.4 Cara memasukkan

**Dashboard (rekomendasi untuk nilai rahasia):** Project → Settings → Environment Variables →
Add New → pilih environment (Production/Preview/Development) → paste nilai.

**CLI (kalau DAT memilih jalur CLI):**

```powershell
vercel env add NEXT_PUBLIC_SUPABASE_URL production      # lalu paste nilai saat diminta
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

> Nilai di-paste **oleh DAT** di terminal/dashboard. Agen tidak mengetik, tidak membaca, dan tidak
> mencatat nilai kredensial — sesuai aturan vault.

---

## 3. Git — langkah push via `windows_mcp`

### 3.1 Memindahkan source VPS → PC Windows

PC Windows belum punya source. Jalur yang dipakai: **git bundle** (satu file, riwayat lengkap, tanpa
perlu push dari VPS).

```powershell
# 1) di PC Windows: siapkan folder kerja di dalam playfield (satu-satunya area yang boleh disentuh)
New-Item -ItemType Directory -Force "$env:USERPROFILE\Documents\00 LOCAL HERMES PLAYFIELD\purchasing-app" | Out-Null

# 2) unduh bundle (VPS menyajikan file ini lewat tailnet, port sementara)
Invoke-WebRequest -Uri 'http://100.91.244.41:8090/purchasing-deploy-20261026.bundle' -OutFile "$env:TEMP\purchasing-deploy.bundle"

# 3) verifikasi integritas — HARUS sama dengan sha256 di §0
(Get-FileHash "$env:TEMP\purchasing-deploy.bundle" -Algorithm SHA256).Hash.ToLower()

# 4) clone dari bundle ke folder kerja
git clone "$env:TEMP\purchasing-deploy.bundle" "$env:USERPROFILE\Documents\00 LOCAL HERMES PLAYFIELD\purchasing-app"
cd "$env:USERPROFILE\Documents\00 LOCAL HERMES PLAYFIELD\purchasing-app"
git log --oneline -3      # harus: a34352d, 16a9d5d, d855c8e
```

Sisi VPS (dijalankan agen, bukan DAT):

```bash
python3 -m http.server 8090 --bind 100.91.244.41 --directory /home/ubuntu/deploy-artifacts
```

### 3.2 Perintah git (setelah repo DAT siap)

```powershell
cd "$env:USERPROFILE\Documents\00 LOCAL HERMES PLAYFIELD\purchasing-app"

# identitas (sekali saja; nilai ditentukan DAT)
git config --global user.name  "<nama DAT>"
git config --global user.email "<email DAT>"

# 1. arahkan origin ke repo DAT
git remote remove origin 2>$null
git remote add origin https://github.com/<owner>/purchasing-app.git

# 2. GUARD sebelum push: pastikan tidak ada file .env ikut terlacak
git ls-files | Select-String -Pattern '(^|/)\.env'    # harus KOSONG

# 3. push branch snapshot sebagai main
git push -u origin deploy/snapshot-20261026:main

# 4. push juga branch snapshot-nya (jejak audit)
git push origin deploy/snapshot-20261026

# 5. tag rilis v1
git tag -a v1 -m "deploy produksi 26 Okt 2026 (snapshot staging)"
git push origin v1
```

### 3.3 Titik persetujuan DAT

| Gerbang | Kapan | Yang dilakukan agen |
|---|---|---|
| **G1** | sebelum `git remote add` + push pertama | tampilkan `git remote -v`, `git log --oneline -5`, `git status`, hasil guard `.env` → tunggu "push" dari DAT |
| **G2** | sebelum `git tag` + push tag | tampilkan commit yang akan di-tag |
| **G3** | setelah push | tampilkan `git ls-remote --heads origin` sebagai bukti |

Catatan: push ke `main` akan **memicu deploy otomatis** kalau integrasi Git Vercel sudah aktif. Jadi G1
sekaligus gerbang deploy — jangan pasang integrasi Vercel sebelum DAT menyetujui push pertama.

### 3.4 Guard tambahan (rekomendasi, belum diubah di snapshot)

`.gitignore` saat ini hanya menutup `.env*.local` — bukan `.env` atau `.env.production`. Untuk repo
deploy sebaiknya ditambah:

```gitignore
.env
.env.*
!.env.example
```

Ini sengaja **tidak** diubah di commit snapshot supaya snapshot tetap = staging. Kalau DAT setuju,
perubahan ini masuk sebagai commit terpisah sebelum push.

---

## 4. Vercel

### 4.1 Fakta build (dibaca dari repo)

| Item | Nilai | Sumber |
|---|---|---|
| Framework | Next.js `14.1.0` (pages router) | `package.json` |
| React | `18.2.0` | `package.json` |
| Build command | `next build` (auto-detected) | `package.json` → `scripts.build` |
| Install command | `npm install` (ada `package-lock.json` → bisa `npm ci`) | `package-lock.json` |
| Output | `.next` (default) | — |
| Start (lokal) | `next start` | `package.json` |
| Node | tanpa `engines` → **set 20.x di Vercel** | `package.json` |
| `vercel.json` | **TIDAK perlu** — tidak ada rewrite/redirect/`output: export`/monorepo. Header `Cache-Control: no-store` sudah ditangani `next.config.js` (`headers()`) | `next.config.js` |
| Middleware | tidak ada | — |
| Ukuran repo | 14 MB (tanpa `.git`), file terbesar 1,1 MB | `git ls-tree -r -l` |
| Rute API | 14 route di `pages/api/**` (termasuk `sales-invoices`, `bakpau/*`) | `pages/api` |

Catatan risiko serverless:

- `modules/sales-invoice/store.js` bisa menulis file JSON lokal (`fs.writeFileSync`) **hanya** di mode
  `file-preview`. Di produksi mode itu ditolak (`FILE_STORE_FORBIDDEN_IN_PRODUCTION`), jadi selama
  kredensial Supabase diset, tidak ada tulis filesystem — aman di Vercel.
- `pages/api/columns.js` memakai `pg` + `POSTGRES_URL`; tanpa env itu endpoint 500 (bukan blocker build).

### 4.2 Opsi A — Dashboard import (rekomendasi)

1. Vercel → **Add New → Project → Import Git Repository** → pilih repo DAT.
2. Framework Preset: **Next.js** (terdeteksi otomatis). Root Directory: `./`.
3. **Settings → Node.js Version: 20.x** (jangan biarkan default 22/24 tanpa uji).
4. **Environment Variables**: isi tabel §2.2 (minimal 4 variabel wajib) untuk Production (+ Preview).
5. **Deploy**. Build pertama akan memakai `main` = snapshot `16a9d5d`.
6. Setelah selesai: cek URL `https://<project>.vercel.app`.

### 4.3 Opsi B — CLI (kalau DAT memilih CLI)

```powershell
npm i -g vercel          # prefix npm user-writable, tidak perlu admin
vercel login             # interaktif — DAT yang menyelesaikan di browser
cd "$env:USERPROFILE\Documents\00 LOCAL HERMES PLAYFIELD\purchasing-app"
vercel link              # hubungkan folder ke project Vercel
vercel env add <NAMA> production   # ulangi untuk tiap variabel §2.2 (nilai di-paste DAT)
vercel --prod            # deploy produksi
```

### 4.4 Verifikasi setelah deploy (sebelum diserahkan ke user)

| # | Cek | Cara | Lulus bila |
|---|---|---|---|
| 1 | Build sukses | dashboard Vercel / output CLI | status `Ready` |
| 2 | Halaman utama | buka `/` | dashboard tampil, tidak ada error console |
| 3 | Env Supabase terbaca | buka modul yang membaca data (mis. Projects) | data muncul, bukan layar kosong |
| 4 | Modul Sales Invoice | buka modul | kalau tabel belum ada → banner `SCHEMA_UNAVAILABLE` (itu benar, lihat §5); kalau tabel ada → daftar invoice tampil |
| 5 | Endpoint maintenance | `GET /api/schema` tanpa token | `403` (menandakan `MAINTENANCE_TOKEN` bekerja) |
| 6 | `/__smoke` | buka `/__smoke` | **404** (kalau tampil, `ENABLE_SMOKE` salah diset) |

---

## 5. Supabase — urutan SQL saat deploy

### 5.1 Tabel urutan

| # | Objek | Berkas / sumber | Status saat deploy | Siapa | Jangan dobel dengan |
|---|---|---|---|---|---|
| 1 | 7 tabel upah: `upah_tukang`, `upah_projects`, `upah_items`, `upah_kasbon`, `upah_totalan`, `upah_totalan_projects`, `upah_totalan_kasbon` | `migrations/2026-10-24_upah_kasbon_master.sql` | **SKIP — sudah ada di live** (7 tabel ada; anon `401` = RLS aktif) | — | — |
| 2 | `upah_projects.project_id` + FK + index + view `v_upah_project_actual` / `v_upah_project_unlinked` | `migrations/2026-10-25_upah_projects_project_id.DRAFT.sql` | **LEWAT PAKET** → `docs/paket-terapkan-mapping-DAT.md` **PASTE 2** (tiket `t_d72b0ef7`) | **DAT** (SQL Editor) | jangan jalankan berkas DRAFT langsung — isinya identik, tapi paket yang punya gerbang & rollback |
| 3 | Backfill 45 tautan + 3 master `projects` baru + log audit | `docs/paket-terapkan-mapping-DAT.md` **PASTE 3–7** | **LEWAT PAKET** (sama, `t_d72b0ef7`) | **DAT** | — |
| 4 | Tabel `public.sales_invoices` (+ kolom `store`, RLS, index) | `docs/paket-hidupkan-sales-invoice-DAT.md` **PASTE 2–3** (tiket `t_4765d061`) | **LEWAT PAKET** | **DAT** | **jangan** jalankan DDL dari `docs/sales-invoice-contract.md` §5 — paket menambah kolom `store` yang tidak ada di kontrak; tanpa itu simpan draf gagal `502 PGRST204` |
| 5 | Format nomor invoice `INV/NL` | bukan SQL — env `SALES_INVOICE_NO_FORMAT_ACK` | **TIDAK dijalankan** (default `legacy-buku`) | DAT (keputusan) | — |
| 6 | Migrasi lama (`2026-10-10` … `2026-10-24_sales_customers*`) | `migrations/*.sql` | **SUDAH ADA** (aplikasi live berjalan di atasnya) — **tidak** dijalankan ulang saat deploy | — | — |
| 7 | `DATA-FIX` / `DATA_*` / `LOCK_*` pujon & asep-santi | `migrations/2026-10-24_DATA-*`, `2026-10-25_DATA-FIX_asep_santi_only.sql` | **JANGAN dijalankan** — koreksi data historis, bukan bagian deploy | — | — |

**Koreksi penomoran dokumen:** body tiket menyebut "`docs/sales-invoice-contract.md` §3". Di kontrak
versi snapshot ini, **§3 = format nomor invoice**, sedangkan **DDL ada di §5**
(`## 5. Handoff Supabase kanonik (BELUM dijalankan — jangan DDL dari kartu ini)`). Penomoran "§3" berasal
dari `docs/release-checklist-ops-branch.md` §11 butir 7 (penomoran lama). Yang mengikat tetap:
**paket `docs/paket-hidupkan-sales-invoice-DAT.md`**, bukan DDL mentah dari kontrak.

### 5.2 Urutan eksekusi yang disarankan

1. **Deploy aplikasi dulu** (§4). Semua gate aman: tanpa tabel `sales_invoices`, modul menampilkan
   `SCHEMA_UNAVAILABLE`; tanpa tautan `project_id`, halaman upah menampilkan "Belum terhubung".
2. **PASTE 1 (read-only)** paket mapping → cek verdict `LANJUT/STOP`.
3. **PASTE 2 → 7** paket mapping, satu PASTE = satu klik Run, berhenti bila ada error.
4. **PASTE 1 (read-only)** paket sales invoice → cek `LANJUT`.
5. **PASTE 2 → 4** paket sales invoice.
6. Verifikasi aplikasi: buka modul Sales Invoice & Upah, pastikan data tampil.

Alternatif (SQL dulu, app belakangan) juga aman karena semua DDL aditif — tapi verifikasi jadi lebih
lambat karena belum ada UI untuk mengecek.

### 5.3 Query verifikasi read-only (boleh dijalankan kapan saja, tidak menulis)

```sql
-- status tabel upah (harus 7 baris)
select table_name from information_schema.tables
where table_schema='public' and table_name like 'upah%' order by 1;

-- kolom relasi (harus ada 1 baris, uuid)
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='upah_projects' and column_name='project_id';

-- index & FK
select indexname from pg_indexes where tablename='upah_projects' and indexname='upah_projects_project_id_idx';
select conname, convalidated from pg_constraint where conname='upah_projects_project_id_fkey';

-- tabel sales invoice (null = belum ada → PASTE 2 paket sales invoice belum jalan)
select to_regclass('public.sales_invoices') as sales_invoices;

-- angka kontrol
select count(*) as jumlah_proyek from public.upah_projects;
select count(*) filter (where project_id is null) as belum_terhubung,
       count(*) filter (where project_id is not null) as terhubung from public.upah_projects;
```

### 5.4 Yang tidak berubah karena deploy

- Deploy aplikasi **tidak** membuat/mengubah tabel, policy, atau data apa pun.
- Tidak ada migration otomatis saat build/start (tidak ada `postinstall`/`prestart` yang menyentuh DB).

---

## 6. Windows MCP — hasil probe & panduan eksekusi

### 6.1 Hasil probe ulang (26 Okt 2026, dari VPS)

Endpoint: `http://100.97.211.5:8080/win/mcp` · transport `streamable_http` · `Authorization: Bearer [REDACTED]`
(dibaca dari `~/.hermes/profiles/bamboo-tech/config.yaml`, tidak pernah dicetak).

| Langkah | Request | Hasil |
|---|---|---|
| 1 | `initialize` (protocolVersion `2025-03-26`) | **HTTP 200** — `serverInfo: windows-mcp 4.1.0`, `protocolVersion 2025-03-26`, response membawa header **`Mcp-Session-Id`** |
| 2 | `notifications/initialized` + header `Mcp-Session-Id` | **HTTP 202** (diterima) |
| 3 | `tools/list` + header `Mcp-Session-Id` | **HTTP 200 — 20 tools** |
| 4 | kontrol: `tools/list` **tanpa** header session | **HTTP 400** — `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Bad Request: Missing session ID"}}` |

**Kesimpulan:** probe kemarin (initialize 200 tapi tools/list 400) **bukan** server rusak — penyebabnya
persis header `Mcp-Session-Id` tidak dikirim pada request berikutnya. Dengan session header, `tools/list`
lulus dan 20 tools tersedia. Server: `windows-mcp 4.1.0`.

### 6.2 Daftar tools (20, nama saja)

`App` · `Clipboard` · `Click` · `DisplayInventory` · `FileSystem` · `Move` · `MultiEdit` · `MultiSelect` ·
`Notification` · `PowerShell` · `Process` · `Registry` · `Scrape` · `Screenshot` · `Scroll` · `Shortcut` ·
`Snapshot` · `Type` · `Wait` · `WaitFor`

Untuk deploy, yang dipakai: **`PowerShell`** (git/npm/vercel), **`FileSystem`** (cek file di playfield),
**`Snapshot`/`Screenshot`** (verifikasi visual halaman Vercel). `Registry`, `Click`, `Type` tidak
diperlukan kecuali DAT minta interaksi UI.

### 6.3 Readiness PC Windows (dibaca lewat tool `PowerShell`, read-only)

| Item | Nilai | Arti |
|---|---|---|
| Host / user | `DESKTOP-F9A17I3` / `NL Admin` | sesuai catatan tailnet |
| Node.js | **v24.21.0** | cukup untuk `next build` lokal; Vercel tetap dipin 20.x |
| npm | 11.19.0 (prefix `C:\Users\NL Admin\AppData\Roaming\npm`, user-writable) | `npm i -g vercel` bisa tanpa admin |
| git | 2.56.0.windows.2 | siap |
| `git config user.name` / `user.email` | **kosong** | harus diisi DAT (§1.5) |
| `vercel` / `gh` / `supabase` CLI | **tidak terpasang** | pilih dashboard import (§4.2) atau pasang CLI |
| TCP 443 → `github.com`, `api.vercel.com`, `<ref>.supabase.co` | **OK** (semua `True`) | tidak ada blocker jaringan/firewall |
| Disk C: | 408,6 GB bebas | cukup |
| Folder playfield | `Documents\00 LOCAL HERMES PLAYFIELD` ada (isi: codecraft, gemini pro, ghidra, inception, museai, rea-bridge, social-auto-engine) | folder kerja baru: `purchasing-app` di dalamnya |

### 6.4 Panduan eksekusi deploy via tools (perintah yang akan dijalankan agen)

Semua perintah dijalankan lewat tool **`PowerShell`** (shell nyata di laptop, **non-elevated**).
Aturan teknis yang sudah terverifikasi: `npm`/`npx` harus lewat `cmd /c` (shim `.ps1` kena execution
policy); JSON argumen dikirim sebagai file; output `PowerShell` diakhiri baris `Status Code: 0` yang harus
dibuang saat parsing.

| Fase | Perintah (ringkas) | Gerbang DAT |
|---|---|---|
| F1 Siapkan folder + unduh bundle | `New-Item ... purchasing-app`, `Invoke-WebRequest http://100.91.244.41:8090/...bundle`, `Get-FileHash` | — (read-only, di dalam playfield) |
| F2 Clone + cek riwayat | `git clone`, `git log --oneline -3`, `git status` | — |
| F3 Set identitas git | `git config --global user.name/email` | **G0** — DAT menyebut nilainya |
| F4 Remote + guard `.env` | `git remote add origin <url>`, `git ls-files | Select-String '\.env'` | **G1** — tampilkan output, tunggu izin |
| F5 Push main + branch + tag | `git push -u origin deploy/snapshot-20261026:main`, `git push origin deploy/snapshot-20261026`, `git tag -a v1`, `git push origin v1` | **G1** (sebelum), **G2** (sebelum tag) |
| F6 Vercel import/env/deploy | dashboard (DAT) atau `vercel link` + `vercel env add` + `vercel --prod` | **G3** — DAT menekan Deploy / menjalankan `--prod` |
| F7 Verifikasi | buka URL produksi lewat Chrome, `Snapshot` halaman, cek §4.4 | laporan ke DAT |
| F8 SQL paket (kalau disetujui) | DAT jalankan PASTE di SQL Editor; agen hanya memandu urutan §5 | **G4** — per PASTE |

**Yang tidak dilakukan agen tanpa izin eksplisit:** push, membuat repo, import project Vercel, deploy
produksi, menjalankan SQL, mengubah DNS, menginstal software global.

### 6.5 Kalau `tools/list` gagal lagi (troubleshooting)

| Gejala | Arti | Tindakan |
|---|---|---|
| `initialize` 200 tapi `tools/list` **400** `Missing session ID` | header `Mcp-Session-Id` tidak dikirim | ulangi dengan menyimpan header dari response `initialize` (bukan dari `notifications/initialized`) |
| `401 Missing or invalid Authorization header` | bearer salah/kosong | ambil ulang `--auth-key` dari baris launch `START-COMPUTER-USE.bat`; jangan copy nilai yang ter-redaksi (`Bearer ***`) dari config |
| `{"ok":false,"error":"upstream_unreachable","target":"winmcp (127.0.0.1:8000)","detail":"ECONNREFUSED"}` | server Windows-MCP di laptop mati | DAT jalankan `START-COMPUTER-USE.bat`, biarkan jendelanya terbuka |
| `tools/list` 200 tapi 0 tool | server dijalankan dengan filter `--tools/--exclude-tools` | restart tanpa filter, atau minta DAT melonggarkan daftar tool |
| Semua timeout | laptop sleep/off | pastikan laptop menyala & tidak sleep (Tailscale tidak membangunkan laptop) |

---

## 7. Rollback deploy

### 7.1 Vercel (aplikasi)

| Skenario | Tindakan | Efek |
|---|---|---|
| Rilis baru bermasalah | Dashboard → Deployments → deployment sebelumnya → **⋯ → Promote to Production** (atau **Instant Rollback**) | alias produksi pindah seketika, tanpa build ulang |
| Lewat CLI | `vercel rollback` (pilih deployment) atau `vercel rollback <deployment-url>` | idem |
| Build gagal | tidak ada tindakan | Vercel **tetap** menyajikan deployment terakhir yang sukses — tidak ada downtime |

### 7.2 Git

| Skenario | Tindakan | Catatan |
|---|---|---|
| Commit buruk sudah ter-push | `git revert --no-edit <sha>` → `git push origin main` | aman, riwayat tetap; memicu deploy baru (bagus) |
| Harus kembali persis ke rilis v1 | `git push --force-with-lease origin <sha-v1>:main` | **menulis ulang riwayat** — hanya dengan persetujuan eksplisit DAT |
| Tag salah | `git tag -f v1 <sha>` + `git push --force origin v1` | idem, perlu persetujuan |
| Rollback ke snapshot awal | `git push --force-with-lease origin 16a9d5d:main` | snapshot murni tanpa dokumen paket |

### 7.3 Database — **tidak** ikut ter-rollback oleh deploy

Deploy Vercel **tidak menyentuh** database. Mengembalikan kode lama **tidak** mengembalikan data/SQL
yang sudah dijalankan. Rollback DB harus dilakukan terpisah:

| Paket | Rollback |
|---|---|
| `docs/paket-terapkan-mapping-DAT.md` | **PASTE R** — mengembalikan tautan dari log audit, tanpa menyentuh baris/angka modul |
| `docs/paket-hidupkan-sales-invoice-DAT.md` | **PASTE R** — `drop table` dengan guard: menolak jalan bila tabel sudah berisi baris |
| `migrations/2026-10-25_upah_projects_project_id.DRAFT.sql` | blok rollback di header berkas (drop 2 view, drop index, drop FK; **kolom `project_id` jangan di-drop** bila sudah berisi tautan) |

### 7.4 Urutan aman saat insiden

1. **Rollback aplikasi dulu** (Vercel promote/rollback) — menghentikan kerusakan yang dilihat user.
2. Kalau penyebabnya skema: jalankan PASTE R paket terkait (butuh persetujuan DAT).
3. Terakhir, rapikan git (`revert`, bukan `force-push`) supaya `main` mencerminkan produksi.
4. Catat di tiket: waktu, deployment URL yang dipromosikan, PASTE yang di-rollback.

---

## 8. Checklist eksekusi (untuk hari-H)

**Persiapan (sudah)**
- [x] Branch `deploy/snapshot-20261026` + commit snapshot `16a9d5d`
- [x] Verifikasi: `git status` bersih, 662 file, `.env.local` tidak ikut
- [x] Bundle siap + sha256
- [x] Probe `windows_mcp` benar → 20 tools
- [x] Runbook ini

**Menunggu DAT**
- [ ] Jawaban §1.1–1.5 (repo, Vercel, service_role, domain, identitas git)
- [ ] Repo dibuat + URL diberikan
- [ ] Vercel project dibuat / CLI terpasang
- [ ] Env Vercel diisi (minimal 4 wajib)
- [ ] Persetujuan push pertama (G1)
- [ ] Persetujuan deploy produksi (G3)
- [ ] Persetujuan SQL paket mapping (G4)
- [ ] Persetujuan SQL paket sales invoice (G4)

**Setelah deploy**
- [ ] Verifikasi §4.4 (6 cek)
- [ ] Tag `v1` ter-push
- [ ] Catat deployment URL + commit SHA di tiket
- [ ] Kabari DAT: modul mana yang masih menunggu SQL (sales invoice / mapping)

---

## 9. Lampiran — bukti verifikasi snapshot

```bash
# branch & commit
$ git log --oneline -3
a34352d docs: bawa paket SQL mapping + sales-invoice (feat/mapping-exec b03d74a) ke branch deploy
16a9d5d snapshot staging 26 Okt utk deploy
d855c8e feat(upah-kasbon): Project ID pada proyek (relasi ke master projects)

# status bersih + jumlah file
$ git status --short | wc -l
0
$ git ls-tree -r --name-only HEAD | wc -l
662

# isi commit snapshot
$ git show --stat --oneline 16a9d5d | tail -3
15 files changed, 501 insertions(+), 299 deletions(-)

# .env.local TIDAK ikut (satu-satunya hasil grep "env" adalah nama dokumen)
$ git ls-files | grep -i env
docs/bakpau-api-env.md
$ git ls-files | grep -E '(^|/)\.env' ; echo "exit=$?"
exit=1        # tidak ada file .env* yang terlacak

# staging tidak diubah: bandingkan isi
$ diff -r -q --exclude=.git --exclude=node_modules --exclude=.next --exclude=.env.local \
    /home/ubuntu/dev-workspaces/purchasing-api_t_dd743609_playfield \
    /home/ubuntu/dev-workspaces/purchasing-upah-kasbon-projectid/.worktrees/t_393fd288
# → hanya 3 dokumen tambahan (paket SQL), tidak ada perbedaan isi file
```

**Isi commit snapshot (15 file):**

| File | Perubahan |
|---|---|
| `modules/registry.js` | modul **RAP dihapus dari registry** (−22 baris) — halaman RAP tidak lagi terdaftar |
| `modules/rab-boq/view.jsx` | rework RAB/BOQ (+306/−…) |
| `modules/sales-invoice/view.jsx` | rework tampilan sales invoice |
| `components/Dashboard.js`, `lib/constants.js`, `pages/index.js` | penyesuaian navigasi/dashboard (RAP & modul nonaktif) |
| `pages/__smoke.js` | import modul disesuaikan |
| `public/noir-invoice/**` | aset build baru (hash baru) + 3 aset lama dihapus |
| `public/upah-kasbon-prototype.html` | penyesuaian prototipe |
| `scripts/upah-kasbon-test/totalan_kasbon_default_test.cjs` | test baru (125 baris) |

**Dokumen tambahan di branch deploy (bukan bagian staging):**

- `docs/paket-terapkan-mapping-DAT.md` — paket SQL mapping upah → Project ID (`feat/mapping-exec` `c4032d1`)
- `docs/paket-hidupkan-sales-invoice-DAT.md` — paket SQL sales invoice (`feat/mapping-exec` `b03d74a`)
- `docs/mapping-runbook-final.md` — runbook STEP 0–10 + rollback (`feat/mapping-exec` `b9ca327`)

Alasan dibawa ke branch deploy: agar saat push, paket SQL yang dirujuk §5 ikut berada di repo yang sama
(dokumen saja, tidak memengaruhi build).
