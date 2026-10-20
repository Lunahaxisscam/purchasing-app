# Kontrak API Bakpau → Purchasing (v1)

Status: **kandidat**, belum aktif di produksi. Semua klaim di bawah ini
merujuk bukti yang disebut di §9.

## 1. Dua arah integrasi

| Arah | Endpoint | Scope | Status |
|---|---|---|---|
| Bakpau **menarik** data purchasing | `POST /api/bakpau/v1/read` | `purchasing:read` | **READ LIVE TERUJI** (kandidat lokal, data produksi nyata) |
| Bakpau **mengirim** pembelian hasil ekstraksi file | `POST /api/bakpau/v1/purchases` | `purchasing:create` | **WRITE LIVE UNVERIFIED** (fail-closed; lihat §7) |
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
dihapus.

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
* Parameter tak dikenal → `400 unknown_parameter` (**tidak diabaikan** supaya
  pemanggil tidak mengira filter sudah diterapkan).
* Filter teks memakai pencocokan **literal** (`ilike` dengan `%`/`_` di-escape),
  bukan substring/fuzzy. `A-12` ≠ `A12`. Nilai `%` tidak menjadi wildcard.
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
| ledger belum ada | `503 ledger_unavailable` (nol tulisan) |
| nota sudah tercatat (bukti sama) | `200 duplicate` (nol tulisan) |
| `idempotencyKey` sama diproses ulang | `200 ignored_duplicate_event` (nol tulisan) |

Jaminan tambahan:

* Validasi memakai `validatePurchaseBoundary` yang **sama** dengan form admin.
* Tulis memakai `savePurchaseWithClient` — **satu** boundary tulis, tidak ada
  writer kedua dan tidak ada JSON fallback.
* `prItemId` hanya diisi bila cocok literal; tidak ada PR fiktif
  (`purchase_requests`/`pr_items` tidak pernah ditulis).
* `queueHandover: false` → nota **bukan** penerimaan fisik; tidak ada baris
  handover dibuat.
* Status `tercatat` hanya setelah **readback exact** dari DB.
* Notifikasi hanya ke Telegram DM DAT (`1320969465`); kegagalan kirim tidak
  mengulang tulisan.
* Retry: client **tidak pernah** mengulang create otomatis. Timeout → status
  `unknown`, ulangi dengan `idempotencyKey` yang sama.

## 5. Kode & kepemilikan file

File baru (disjoint dari file milik task lain):

```
lib/bakpau/apiAuth.js      identitas token, scope, rate limit
lib/bakpau/apiRead.js      daftar putih resource/kolom/filter + eksekusi baca
lib/bakpau/apiCreate.js    validasi payload, resolusi, tulis, readback, notifikasi
lib/bakpau/apiHandler.js   gerbang berurutan + dua handler
pages/api/bakpau/v1/read.js
pages/api/bakpau/v1/purchases.js
scripts/bakpau-api-client/client.mjs
scripts/bakpau-api-test/{run.py,api_test.mjs,api_fixtures.mjs,mock-supabaseClient.mjs}
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
| Read live (8 resource, data produksi nyata) | **AKTIF di kandidat** | `LIVE_PROBE_RESULT.json` (19/19 PASS; materials 344, projects 11, vendors 22, PR 16, pr_items 60, purchases 6, items 6, handovers 1) |
| Auth ditolak sebelum DB | **TERBUKTI** | 133 assertion `api_test.mjs` (B1–B26) + probe live |
| Create validasi/ambigu/idempotensi | **TERBUKTI di harness** | E1–E31 |
| Create **live** (nota nyata) | **WRITE_LIVE_UNVERIFIED** | butuh transaksi nyata yang DAT minta; ledger `bakpau_events` belum ada (DDL milik Bandeng) |
| DDL / applied | **tidak ada** (0) | schema owner Bandeng, gate backup belum terpenuhi |
| Transport Telegram | tidak diuji live dari API (memakai RPC existing) | — |
| File extraction | **di luar API** — agen Bakpau yang mengekstrak; API hanya menerima payload terstruktur | §4 |
| Deploy produksi | **BELUM** — tidak ada akses deployment dari VPS | §8 |

## 8. Blocker deployment (persis)

1. `vercel` CLI **logged out** di VPS; `VERCEL_TOKEN` tidak ada di
   `~/.hermes/.env`, `.hermes/profiles/bamboo-tech/.env`, maupun
   `purchasing-app/.env.local`. `.vercel/anonymous.json` yang ada sudah
   kedaluwarsa (`expiresAt` 1792070805740 ≈ 2026-10-15).
2. `origin/main` saat ini `ac7117b`; route v1 belum ada di sana. Produksi
   mengembalikan **404** untuk `/api/bakpau/v1/read` dan
   `/api/bakpau/v1/purchases` — jadi tidak bisa diklaim aktif.
3. Env produksi untuk `BAKPAU_API_TOKENS` belum bisa diset dari VPS (butuh
   dashboard/CLI berizin). Tanpa env itu, endpoint akan menjawab
   `503 api_not_configured` — perilaku fail-closed yang disengaja.

Jalur input aman: setelah review Brooklyn, set env di dashboard Vercel
(Production) dengan nilai dari `~/.hermes/secure/bakpau/` (file 600), lalu
deploy commit yang disetujui. Jangan pernah menempelkan token di chat/commit.

## 9. Bukti

| Berkas | Isi |
|---|---|
| `scripts/bakpau-api-test/run.py` | harness 133 assertion (log di `BAKPAU_API_TEST.log`) |
| `LIVE_PROBE_RESULT.json` | 19/19 PASS terhadap Supabase produksi (read-only) |
| `LIVE_CREATE_GUARD.json` | token Bakpau saja tidak cukup menulis (503 `no_service_credentials`) |
| `CAPABILITY_AUDIT.json` | nama env + boolean, git/worktree |
| `scripts/bakpau-connector-test/run.py` | 321 + 48 assertion lama tetap hijau |
