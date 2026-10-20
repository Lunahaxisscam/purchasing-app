# Kontrak API Bakpau → Purchasing (v1)

Status: **kandidat revisi 2**, belum aktif di produksi. Semua klaim di bawah
merujuk bukti yang disebut di §9.

> **Revisi 2 (2026-10-21) menutup dua blocker review Brooklyn:**
> 1. Kredensial baca **tidak lagi** bisa jatuh ke `SUPABASE_SERVICE_ROLE_KEY`.
>    Rantai kunci baca sekarang hanya kunci ber-RLS; kunci privileged ditolak
>    (fail closed) — lihat §2.1.
> 2. Jalur create **bukan lagi tulisan multipart**. Seluruh penulisan
>    (klaim idempotensi + header + baris + alokasi) berada dalam **satu fungsi
>    SQL transaksional**; bila fungsi belum di-apply, create `503` dan nol
>    baris ditulis — lihat §4.1 dan §4.2.

## 1. Dua arah integrasi

| Arah | Endpoint | Scope | Status |
|---|---|---|---|
| Bakpau **menarik** data purchasing | `POST /api/bakpau/v1/read` | `purchasing:read` | **READ LIVE TERUJI** (kandidat 3001, data produksi nyata) |
| Bakpau **mengirim** pembelian hasil ekstraksi file | `POST /api/bakpau/v1/purchases` | `purchasing:create` | **WRITE LIVE UNVERIFIED** — teruji pada PostgreSQL 16 nyata; live produksi menunggu RPC+ledger di-apply dan nota nyata DAT |
| Telegram/WA intake (existing) | `POST /api/bakpau/telegram`, `POST /api/bakpau/whatsapp` | HMAC/secret token | tidak berubah, hanya urutan gerbang diperbaiki |

Bukan migrasi GSheets, bukan poller baru, bukan webhook baru.

## 2. Identitas & token

Format token: `bpk.<keyId>.<secret>`

* `keyId` — 8–32 karakter `[a-z0-9]`, bukan rahasia.
* `secret` — ≥32 byte acak (base64url). **Hanya hash SHA-256 yang disimpan di server.**

Konfigurasi server (nama env, nilai tidak pernah dicetak):

```
BAKPAU_API_TOKENS=<keyId>:<sha256hex>:<scope>[+<scope>][,<keyId>:<hash>:<scope>…]
BAKPAU_API_REVOKED=<keyId>[,<keyId>…]
BAKPAU_API_RATE_PER_MIN=120
BAKPAU_API_MAX_BODY_BYTES=262144
```

Scope yang ada **hanya dua**:

* `purchasing:read` — baca master/PR/pembelian/status fisik.
* `purchasing:create` — catat satu nota pembelian.

Tidak ada scope admin, user-listing, role/password, DDL, delete, invoice,
payment, atau handover otomatis. Scope ditegakkan **server-side** dari hash
token, bukan dari label/nama token.

**Verifikasi constant-time**: perbandingan hash memakai `crypto.timingSafeEqual`
atas digest SHA-256, sehingga panjang secret tidak bocor. `keyId` tak dikenal
tetap menghitung hash (waktu respons tidak membedakan).

**Fail closed**:
* env kosong/rusak → `503 api_not_configured` (bukan 200 kosong)
* entri rusak dibuang, bukan dianggap wildcard
* `keyId` di `BAKPAU_API_REVOKED` → `401 token_revoked`

**Revoke/rotate**: tambahkan `keyId` ke `BAKPAU_API_REVOKED` (revoke instan,
tanpa deploy kode), atau ganti baris hash untuk rotasi. Tidak ada data yang
dihapus. Diuji live pada kandidat: token sah `200` → set revoked → `401
token_revoked` → restore → `200` (`REVOKE_LIVE_PROOF.json`).

### 2.1 Kredensial BACA — hanya kunci ber-RLS

Review Brooklyn menemukan versi pertama rantai kunci baca berakhir di
`SUPABASE_SERVICE_ROLE_KEY`. Itu keliru: service role **melewati RLS**,
sehingga `purchasing:read` hanya menjadi label di aplikasi, bukan batas izin
database.

Aturan sekarang (`lib/bakpau/apiAuth.js` + `readCredential()`):

| Kondisi | Hasil |
|---|---|
| `BAKPAU_API_READ_SUPABASE_KEY` berisi kunci anon/publishable | dipakai |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` tersedia | dipakai |
| hanya `SUPABASE_SERVICE_ROLE_KEY` | **`503 read_credential_missing`** — TIDAK dipakai |
| kunci ber-role `service_role` / berawalan `sb_secret_` dipasang sebagai kunci baca | **`503 read_credential_privileged`** |
| tidak ada kunci ber-RLS | `503 read_credential_missing` |

Tidak ada fallback ke kunci privileged dalam kondisi apa pun. Nama env yang
terlarang dilaporkan sebagai **nama** saja (`forbiddenEnvPresent`), bukan nilai.

**Temuan penting yang dilaporkan apa adanya** (`RLS_BOUNDARY_PROBE.json`):
probe PostgREST langsung dengan kunci anon menunjukkan `profiles` **dapat**
dibaca (4 baris) — jadi RLS proyek ini **tidak** menutup semua tabel sensitif.
Karena itu batas izin API Bakpau yang sebenarnya adalah **daftar putih
resource/kolom di kode** + scope token server-side, bukan RLS. Daftar putih itu
diuji menolak `users`/`profiles`/`private_secrets`/`invoices` **sebelum satu
query DB pun** (C15.*, B19). Ini bukan klaim "RLS-protected"; ini laporan
kondisi nyata + batas yang benar-benar ditegakkan.

Konsekuensi untuk operator: **jangan** memasang service role sebagai kunci baca
API ini. Bila kelak RLS diperbaiki (keputusan Bandeng/DAT), kunci baca khusus
dengan role terbatas bisa dipakai tanpa perubahan kode.


## 3. `POST /api/bakpau/v1/read`

Body:

```json
{ "resource": "masters/projects", "query": { "limit": 50, "offset": 0, "order": "kode.asc", "kode": "83" } }
```

Resource (daftar putih, **tidak ada nama tabel bebas**):

| resource | tabel | filter yang sah |
|---|---|---|
| `masters/projects` | projects | id, kode, code, status |
| `masters/materials` | materials | id, kode, code, category |
| `masters/vendors` | vendors | id, name, supplier_category |
| `purchase-requests` | purchase_requests | id, pr_number, project_id, status, priority |
| `purchase-request-items` | pr_items | id, pr_id, material_id, status, kode |
| `purchases` | receivings | id, vendor_id, project_id, purchase_request_id, invoice_no, status |
| `purchase-items` | receiving_items | id, receiving_id, pr_item_id |
| `physical-status` | handovers | id, receiving_id, project_id, status |

Kolom yang dikembalikan juga daftar putih (`columns` di respons menyebut
persis kolom yang dipakai). Tidak ada `select('*')` di jalur baca API.

* `limit` default 50, maksimum 200 (dipotong, bukan error).
* `offset` maksimum 100000.
* `order` hanya boleh kolom yang ada di daftar putih, `asc`/`desc`.
* **Pemecah seri wajib**: setiap urutan selalu ditambah `id ASC` sebagai kunci
  akhir. Kolom urutan bisnis tidak unik (`sort_order` di
  `purchase-request-items` dipakai 12 baris; `created_at` bisa kembar), dan
  Postgres bebas memilih urutan untuk nilai kembar. Tanpa pemecah seri,
  pagination offset **kehilangan dan menggandakan baris**: terbukti di data
  produksi nyata — 60 baris `purchase-request-items` diambil 3-per-halaman
  hanya menghasilkan **52 id unik** (8 hilang, 8 dobel). Setelah perbaikan:
  60/60 unik (`PROBE_PAGINATION.json`).
* Parameter tak dikenal → `400 unknown_parameter` (**tidak diabaikan** supaya
  pemanggil tidak mengira filter sudah diterapkan).
* Filter teks memakai pencocokan **literal** (`ilike` dengan `%`/`_` di-escape),
  bukan substring/fuzzy. `A-12` ≠ `A12`. Nilai `%` tidak menjadi wildcard.
* Nilai filter yang memuat `*` **ditolak** `400 bad_query`. Alasannya empiris:
  PostgREST menerjemahkan `*` menjadi `%` di dalam `ilike` dan escape backslash
  tidak menolongnya, sehingga `kode:"*"` mengembalikan seluruh tabel
  (probe live: 344/344 baris). Menolak lebih jujur daripada diam-diam
  mengubah arti filter.
* Filter pada kolom ID (`id`, `*_id`) **wajib UUID** → selain itu
  `400 bad_query` tanpa query DB (sebelumnya berubah menjadi 502 karena
  Postgres menolak cast-nya; itu salah menyalahkan server).
* Respons: `{ ok, resource, data[], page:{limit,offset,returned,total}, order, filters, columns }`.

Resource sensitif (`users`, `profiles`, `private_secrets`, `invoices`,
`purchase_payments`, `bakpau_events`) **tidak ada** di daftar putih dan
ditolak `400 unknown_resource`.

## 4. `POST /api/bakpau/v1/purchases`

Menerima **hasil ekstraksi terstruktur**, bukan gambar mentah dan bukan OCR
pipeline baru. Agen Bakpau yang membaca file wajib mengisi field eksplisit dan
menandai baris ambigu.

```json
{
  "idempotencyKey": "nota-2026-10-20-toko-x-001",
  "provenance": { "sourceType": "foto_nota", "sourceRef": "wa/2026-10-20/abc.jpg", "extractedBy": "bakpau-agen-v1", "extractedAt": "2026-10-20T10:00:00Z" },
  "purchase": {
    "vendorId": "…" , "vendorName": "…",
    "date": "2026-10-20", "invoiceNo": "…",
    "projectId": "…" , "projectRef": "83",
    "biayaLain": 0, "diskon": 0, "statedTotal": 240000,
    "catatan": "…",
    "items": [
      { "itemName": "Triplek 9mm", "qty": 2, "harga": 120000, "unit": "Lembar",
        "projectId": "…", "prItemId": "…", "prNumber": "PR-2026-0001",
        "ambiguous": false, "ambiguousFields": [] }
    ]
  }
}
```

Aturan validasi (semua **sebelum** DB disentuh):

| kondisi | hasil |
|---|---|
| `provenance` tidak lengkap | `422 invalid_payload` |
| `idempotencyKey` kosong | `422 invalid_payload` |
| `qty`/`harga` tidak ada atau ≤0 | `422 invalid_payload` (tidak ada default 1/0) |
| `date` bukan `YYYY-MM-DD` | `422 invalid_payload` (tidak ditebak dari jam) |
| baris `ambiguous:true` / `ambiguousFields` terisi | `422 ambiguous_extraction` |
| `statedTotal` ≠ rincian | `422 ambiguous_extraction` |
| vendor/proyek/PR tidak ada di master | `422 unknown_reference` |
| >80 baris | `422 invalid_payload` |
| **RPC atomik belum di-apply** | **`503 atomic_rpc_unavailable`** (nol tulisan) |
| nota sudah tercatat (bukti sama) | `200 duplicate` (nol tulisan) |
| nota vendor+nomor sama sudah DIBELI (termasuk oleh admin) | `200 duplicate` (nol tulisan) |
| `idempotencyKey` sama diproses ulang | `200 ignored_duplicate_event` (nol tulisan) |

### 4.1 SATU transaksi, bukan tulisan multipart

Review Brooklyn menolak versi pertama karena urutannya:

```
claim ledger (2 INSERT) → INSERT header → INSERT baris (loop) → UPDATE ledger
                          ↳ bila gagal non-partial: releaseBoth() → retry bisa menulis nota kedua
```

Itu bukan transaksi, dan jalur admin tidak memakai ledger itu sama sekali
sehingga idempotensi lintas kanal tidak pernah berlaku.

Sekarang seluruh penulisan ada di **satu fungsi SQL**
`public.bakpau_save_purchase_atomic(p_payload jsonb)`:

1. validasi bentuk payload (termasuk: subtotal baris harus menjumlah ke
   `material`, dan `total = material + biaya − diskon`);
2. `INSERT … ON CONFLICT DO NOTHING` klaim event → `duplicate_event` bila kalah;
3. klaim bukti lintas kanal → `RAISE` `BK002` (rollback total) bila sudah ada;
4. tolak nota vendor+nomor yang sudah DIBELI (termasuk buatan admin) → `BK001`;
5. `INSERT` header + semua baris (satu statement);
6. `UPDATE` kedua baris ledger → `recorded` + `receiving_id`;
7. kembalikan JSON berisi `receiving_id`, `item_count`, `total`, `items[]`.

Semua atau tidak sama sekali: `RAISE` apa pun me-rollback **klaim ledger juga**,
sehingga kunci tidak "terbakar" dan retry sah tetap bisa jalan.

Kode aplikasi (`lib/bakpau/atomicPurchase.js`) hanya: menyusun argumen,
memanggil RPC, memverifikasi balasan secara **semantik** (UUID sah, jumlah baris
sama, hash bukti/event sama, total sama), lalu readback ketat dari DB.

**Fail closed**: bila fungsi belum ada / signature tidak cocok (`PGRST202`,
`42883`, …) → `503 atomic_rpc_unavailable`, nol baris, nol klaim.
Tidak ada fallback multipart, tidak ada ledger kedua, tidak ada JSON fallback.

**Hak akses fungsi**: `SECURITY INVOKER`, `REVOKE ALL FROM PUBLIC`, `anon` dan
`authenticated` **tidak** boleh `EXECUTE`; hanya `service_role`. Diuji dengan
`has_function_privilege` pada PostgreSQL nyata (Y1–Y3).

### 4.2 Readback ketat (tanpa `candidates[0]`)

Review Brooklyn juga menemukan `readbackPurchase` lama memakai `candidates[0]`
bila tidak ada baris yang cocok proyeknya. Sekarang `readbackPurchaseStrict`:

* setiap baris yang diharapkan harus cocok **tepat satu** baris DB pada
  identitas lengkap: nama + satuan + qty + `pr_item_id` + proyek;
* 0 kandidat → `item_hilang`; >1 kandidat → `item_ganda`; **tidak ada fallback**;
* jumlah baris DB harus sama persis (tidak boleh ada baris ekstra);
* proyek header diperiksa; bila nota lintas proyek, header **harus** kosong
  (`project_id_should_be_empty`), bukan dipilih salah satu.

### 4.3 Jaminan lain

* Validasi memakai `validatePurchaseBoundary` yang **sama** dengan form admin.
* `prItemId` hanya diisi bila cocok literal; tidak ada PR fiktif
  (`purchase_requests`/`pr_items` tidak pernah ditulis).
* `queueHandover: false` → nota **bukan** penerimaan fisik; tidak ada baris
  handover dibuat (fungsi SQL tidak menyentuh `handovers`).
* Status `tercatat` hanya setelah **readback ketat** dari DB.
* Notifikasi hanya ke Telegram DM DAT (`1320969465`); kegagalan kirim tidak
  mengulang tulisan (transaksi sudah commit sebelum notifikasi).
* Retry: client **tidak pernah** mengulang create otomatis. Timeout → status
  `unknown`, ulangi dengan `idempotencyKey` yang sama.
* Pesan error DB internal tidak pernah keluar ke respons (`sanitizeLogMessage`
  untuk log, kode stabil untuk body).

## 5. Kode & kepemilikan file

File baru (disjoint dari file milik task lain):

```
lib/bakpau/apiAuth.js        identitas token, scope, klasifikasi kredensial baca
lib/bakpau/apiRead.js        daftar putih resource/kolom/filter + eksekusi baca
lib/bakpau/apiCreate.js      validasi payload, resolusi, teks nota, orkestrasi create
lib/bakpau/atomicPurchase.js SATU RPC transaksional + verifikasi + readback ketat
lib/bakpau/apiHandler.js     gerbang berurutan + dua handler + sanitasi log
pages/api/bakpau/v1/read.js
pages/api/bakpau/v1/purchases.js
migrations/2026-10-21_bakpau_atomic_purchase_rpc.DRAFT.sql   (handoff Bandeng)
scripts/bakpau-api-client/client.mjs
scripts/bakpau-api-test/{run.py,api_test.mjs,api_fixtures.mjs,mock-supabaseClient.mjs,
                         run_real_db.py,real_db_test.mjs,pgSupabaseShim.mjs}
docs/bakpau-api-contract.md
docs/bakpau-api-env.md
```

File lama yang disentuh (minimal, terkoordinasi):

* `lib/bakpau/httpHandler.js` — **perbaikan defect**: normalisasi + verifikasi
  tanda tangan/allowlist/freshness dipindah ke **sebelum** klien DB dibuat dan
  sebelum `loadMasters`/`loadExistingNotas`. Sekarang permintaan tidak sah
  menghasilkan nol aktivitas DB. Respons error tidak membocorkan detail internal.
* `lib/bakpau/constants.js` — tambah nama env `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
* `scripts/bakpau-connector-test/http_test.mjs` — 4 assertion baru untuk
  membuktikan urutan gerbang (S6–S8).

Tidak ada perubahan pada `modules/receivings/purchaseSave.js` (boundary
bersama) — patch shared purchaseSave tetap harus lewat integrator.

## 6. Env

Lihat `docs/bakpau-api-env.md`. Ringkas: 4 env baru untuk token/limit, dan
kredensial baca memakai rantai fallback yang sudah ada di deployment
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`) sehingga **tidak perlu** menambah env baru
hanya untuk baca.

## 7. Status per jalur

| Jalur | Status | Bukti |
|---|---|---|
| Read live (8 resource, data produksi nyata) | **AKTIF di kandidat 3001** | `LIVE_PROBE_3001.json` (23/23 PASS; projects 11, materials 344, vendors 22, PR 16, purchases 6, physical 1) + `PROFILE_CLIENT_PROOF_3001.json` (11/11, memakai token milik profil `bakpau-finance`) |
| Auth ditolak sebelum DB | **TERBUKTI** | 216 assertion `api_test.mjs` (B1–B28, C22–C30) + probe live R1/R2 |
| Kredensial baca tidak privileged | **TERBUKTI** | C22–C27 (service role → 503), `read_key_classify.py` (kunci 3001 = `jwt_anon`, `SUPABASE_SERVICE_ROLE_KEY` ABSENT) |
| Revoke/rotate tanpa deploy | **TERBUKTI LIVE** | `REVOKE_LIVE_PROOF.json`: 200 → revoked → 401 `token_revoked` → restore → 200 |
| Create validasi/ambigu/idempotensi (mock) | **TERBUKTI di harness** | E1–E34, H1–H15 |
| **Create terhadap PostgreSQL 16 NYATA (DB terisolasi)** | **TERBUKTI — 103/103 PASS** | `scripts/bakpau-api-test/run_real_db.py`: satu transaksi, 1 nota benar tersimpan, **fault injection trigger → rollback total (0 header/0 baris/0 klaim) + retry berhasil**, race 2 paralel → tepat 1 nota, 8 payload invalid → 0 tulisan, RPC di-rename → 503 + 0 tulisan, nota admin nomor sama → duplicate, RPC langsung ditolak 5/5, ACL anon/authenticated tidak boleh EXECUTE, saklar `BAKPAU_API_CREATE_ENABLED` diuji di DB yang RPC-nya SUDAH ada (absen/`"1"` → 503 + 0 tulisan; `true` → 201) |
| Create **live di produksi** (nota nyata) | **WRITE_LIVE_UNVERIFIED** | butuh (a) `bakpau_events` + RPC di-apply Bandeng, (b) nota nyata yang DAT minta |
| DDL / applied produksi | **tidak ada (0)** | schema owner Bandeng; gate backup+restore+review belum terpenuhi |
| Transport Telegram | tidak diuji live dari API (memakai RPC existing) | — |
| File extraction | **di luar API** — agen Bakpau yang mengekstrak; API hanya menerima payload terstruktur | §4 |
| Deploy produksi | **BELUM** — tidak ada akses deployment dari VPS | §8 |

### 7.1 Peta commit ↔ build (WAJIB dipakai saat melaporkan status)

| Lingkungan | Commit | BUILD_ID | Status |
|---|---|---|---|
| **Produksi** `purchasing-app-dun.vercel.app` | `ac7117b` (origin/main) | `y030zEoDMPYjabZi0druQ` | tidak punya route `/api/bakpau/v1/*` → **404**, bukan kandidat ini |
| **Kandidat 3001** (PM2 `purchasing-staging-3001`) | `feat/bakpau-api-t_dd743609` @ `0e1363c` | `sOvJsANQ--709JRjr9jDg` | READ live nyata; create fail-closed |
| 3001 sebelum switch (rollback) | — | `KN37g9i7McKTJy6wFYiO0` | snapshot `3001-before-api-switch.json` |

Aturan pelaporan:

* **Jangan** menyebut kandidat 3001 sebagai "produksi" atau membagikannya ke
  DAT sebagai URL stabil. 3001 adalah preview yang di-pin ke build di atas;
  bila PM2 di-restart dengan kode lain, BUILD_ID berubah dan label ini tidak
  berlaku lagi.
* Setiap klaim "AKTIF" harus menyebut commit + BUILD_ID yang diuji. Tanpa
  keduanya, statusnya **tidak terverifikasi**.
* Rollback 3001: `bash switch_3001_api.sh rollback` (kembali ke build
  `KN37g9i7McKTJy6wFYiO0`), lalu verifikasi BUILD_ID di HTML = disk.

## 8. Blocker deployment (persis)

1. **Tidak ada kredensial deployment di VPS.** `vercel` CLI `whoami` →
   `Logged out`. `VERCEL_TOKEN` tidak ada di `~/.hermes/.env`, semua
   `.hermes/profiles/*/.env`, maupun `purchasing-app/.env.local`.
   `.vercel/anonymous.json` yang ada sudah kedaluwarsa
   (`expiresAt` 1792070805740 ≈ 2026-10-15).
2. **Deployment produksi dipicu oleh push ke `main`** (Vercel GitHub
   integration), bukan CLI: GitHub Deployments API menunjukkan deployment
   `Production` untuk `ac7117b` pada `2026-10-20T18:55:13Z`, tepat setelah
   push rilis. Artinya jalur deploy = push FF ke `main` setelah persetujuan,
   bukan `vercel deploy`.
3. **Env produksi `BAKPAU_API_TOKENS` belum bisa diset dari VPS.** Tanpa env
   itu, endpoint (walau ter-deploy) akan menjawab `503 api_not_configured` —
   fail-closed yang disengaja, bukan aktif.
4. Produksi saat ini mengembalikan **404** untuk `/api/bakpau/v1/read` dan
   `/api/bakpau/v1/purchases` (`origin/main` = `ac7117b`), jadi tidak bisa
   diklaim aktif.
5. **Revisi 2 — create produksi juga butuh schema**: tabel
   `public.bakpau_events` + fungsi `public.bakpau_save_purchase_atomic(jsonb)`.
   Keduanya **belum** ada di produksi (`bakpau_events` → `PGRST205` pada probe
   langsung). Tanpa itu create menjawab `503 atomic_rpc_unavailable` dan nol
   baris ditulis. Apply adalah milik Bandeng setelah backup + isolated restore
   + review.

### Jalur deploy yang disarankan (setelah review Brooklyn)

1. Set env di dashboard Vercel (Production) dari
   `~/.hermes/secure/bakpau/api-server.env` (mode 600) — hanya
   `BAKPAU_API_TOKENS` (+ opsional `BAKPAU_API_REVOKED`). Jangan pernah
   menempelkan nilai token di chat/commit/issue.
2. Merge `feat/bakpau-api-t_dd743609` ke `main` (fast-forward dari
   `ac7117b`, tanpa force/reset) → Vercel build otomatis.
3. Jalankan `post_deploy_verify.py` (sudah tersedia): route exact, GET 405,
   tanpa/salah token 401, 8 resource read dengan **jumlah = sumber**, tanpa
   kebocoran, create invalid 422.
4. Bila env belum bisa diset, deploy tetap aman: endpoint hanya menjawab
   503 dan tidak membuka data apa pun.

### Alternatif yang TIDAK dipakai (dan kenapa)

Hash token boleh saja ditulis di kode (SHA-256 dari 256-bit secret tidak
reversible), tetapi itu membuat **revoke/rotate butuh deploy** dan menaruh
materi kredensial di repo. Brief meminta vault/secure env deployment, jadi
opsi ini hanya dicatat sebagai keputusan pemilik deploy, bukan dilakukan.

## 9. Bukti

| Berkas | Isi |
|---|---|
| `scripts/bakpau-api-test/run.py` | harness 216 assertion (log di `BAKPAU_API_TEST_FINAL.log`) |
| `scripts/bakpau-api-test/run_real_db.py` | 103 assertion terhadap PostgreSQL 16 nyata (`BAKPAU_API_REALDB_TEST_FINAL.log`) |
| `LIVE_PROBE_3001.json` | 23/23 PASS terhadap kandidat 3001 (read-only, data produksi) |
| `PROFILE_CLIENT_PROOF_3001.json` | 11/11 — token milik profil `bakpau-finance` membaca data nyata |
| `REVOKE_LIVE_PROOF.json` | revoke/restore token live |
| `RLS_BOUNDARY_PROBE.json` | fakta batas RLS (`profiles` terbuka → batas nyata = daftar putih kode) |
| `read_key_classify.py` | klasifikasi kunci baca 3001 tanpa mencetak nilai |
| `CAPABILITY_AUDIT.json` | nama env + boolean, git/worktree |
| `scripts/bakpau-connector-test/run.py` | 321 + 48 assertion lama tetap hijau |
