# Env API Bakpau — NAMA SAJA

Tidak ada nilai di dokumen ini. Nilai hanya ada di
`~/.hermes/secure/bakpau/` (file 600) dan di dashboard Vercel (Production).

## Wajib di server (Vercel / proses Next)

| Nama | Isi | Status saat ini |
|---|---|---|
| `BAKPAU_API_TOKENS` | `<keyId>:<sha256hex>:<scope>[+<scope>]` dipisah koma | **belum diset di produksi**; diset di kandidat lokal 3001 |
| `BAKPAU_API_CREATE_ENABLED` | **hanya** `true` (huruf kecil, tanpa spasi) yang mengaktifkan tulis; nilai lain/absen = tulis ditahan | **tidak diset** — tulis sengaja MATI |
| `BAKPAU_API_REVOKED` | daftar `keyId` dicabut | opsional (kosong = tidak ada yang dicabut) |
| `BAKPAU_API_RATE_PER_MIN` | bilangan bulat, default 120 | opsional |
| `BAKPAU_API_MAX_BODY_BYTES` | default 262144, maksimum 262144 | opsional |

### `BAKPAU_API_CREATE_ENABLED` — kenapa ada

Review Brooklyn menahan create sampai transaksi bersama terbukti. Kalau
saklar ini tidak ada, create akan **otomatis hidup** begitu Bandeng
meng-apply `bakpau_save_purchase_atomic` — gate review jadi tidak bisa
ditegakkan dari sisi deployment. Dengan saklar ini:

* default (env absen) → `503 create_disabled`, nol aktivitas DB;
* `false`, `1`, `yes`, string lain → tetap `503`;
* hanya `true` → create berjalan (masih harus lolos RPC + readback).

Rollback fitur tulis = hapus/ubah env ini. Tidak menghapus data.

## Kredensial baca (hanya kunci ber-RLS)

| Nama | Peran |
|---|---|
| `BAKPAU_API_READ_SUPABASE_URL` | opsional; kalau kosong → `SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` |
| `BAKPAU_API_READ_SUPABASE_KEY` | opsional; kalau kosong → `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

**`SUPABASE_SERVICE_ROLE_KEY` TIDAK ADA di rantai baca** (revisi 2). Kunci itu
melewati RLS, sehingga tidak boleh menjadi kredensial baca API sempit ini.
Bila hanya kunci privileged yang tersedia → `503 read_credential_missing`.
Bila kunci privileged dipasang sebagai kunci baca → `503 read_credential_privileged`.

Deployment existing sudah punya `NEXT_PUBLIC_SUPABASE_URL` dan
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, sehingga **baca tidak memerlukan env baru**.

Catatan operator: kunci anon pada proyek ini masih bisa membaca `profiles`
(fakta di `RLS_BOUNDARY_PROBE.json`), jadi batas izin API adalah daftar putih
resource/kolom di kode — bukan RLS. Jangan memasang service role "supaya bisa
baca semua"; itu justru menghapus satu-satunya batas yang tersisa.

## Kredensial tulis (sudah ada, tidak berubah)

| Nama | Peran |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | hanya server, hanya jalur tulis, **tidak pernah** dikirim ke Bakpau |
| `SUPABASE_URL` | URL proyek |

## Wajib untuk CREATE (baru, revisi 2)

| Objek | Status di produksi |
|---|---|
| tabel `public.bakpau_events` | **belum ada** (PGRST205) — draft milik Bandeng |
| fungsi `public.bakpau_save_purchase_atomic(jsonb)` | **belum ada** — draft `migrations/2026-10-21_bakpau_atomic_purchase_rpc.DRAFT.sql` |

Tanpa keduanya, create menjawab `503 atomic_rpc_unavailable` dan **nol baris
ditulis**. Tidak ada fallback multipart.

## Klien (profil bakpau-finance)

| Nama | Isi |
|---|---|
| `BAKPAU_API_BASE_URL` | `https://<host>` (wajib https; token tidak boleh di URL) |
| `BAKPAU_API_TOKEN` | `bpk.<keyId>.<secret>` |
| `BAKPAU_API_TIMEOUT_MS` | opsional, default 15000 |
| `BAKPAU_API_ALLOW_LOOPBACK` | **hanya untuk harness lokal** (`1` = izinkan `http://127.0.0.1`); tidak boleh dipakai di produksi |

Sudah terpasang di `/home/ubuntu/.hermes/profiles/bakpau-finance/.env`
(mode 600, dua kunci saja yang ditambahkan; skills/plugins/memories/cron/model
tidak disentuh). Verifikasi tanpa membocorkan nilai:
`node scripts/bakpau-api-client/client.mjs doctor`.

## Yang TIDAK boleh dipasang ke Bakpau

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`/`DATABASE_URL`/`PGPASSWORD`,
password akun Novi, token bot Telegram/WhatsApp, kredensial profil lain.
Key Supabase privileged **bukan** token Bakpau.
