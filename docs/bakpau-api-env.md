# Env API Bakpau — NAMA SAJA

Tidak ada nilai di dokumen ini. Nilai hanya ada di
`~/.hermes/secure/bakpau/` (file 600) dan di dashboard Vercel (Production).

## Wajib di server (Vercel / proses Next)

| Nama | Isi | Status saat ini |
|---|---|---|
| `BAKPAU_API_TOKENS` | `<keyId>:<sha256hex>:<scope>[+<scope>]` dipisah koma | **belum diset di produksi**; diset di kandidat lokal 3011 |
| `BAKPAU_API_REVOKED` | daftar `keyId` dicabut | opsional (kosong = tidak ada yang dicabut) |
| `BAKPAU_API_RATE_PER_MIN` | bilangan bulat, default 120 | opsional |
| `BAKPAU_API_MAX_BODY_BYTES` | default 262144, maksimum 262144 | opsional |

## Kredensial baca (rantai fallback, tidak wajib baru)

| Nama | Peran |
|---|---|
| `BAKPAU_API_READ_SUPABASE_URL` | opsional; kalau kosong → `SUPABASE_URL` → `NEXT_PUBLIC_SUPABASE_URL` |
| `BAKPAU_API_READ_SUPABASE_KEY` | opsional; kalau kosong → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS berlaku) → `SUPABASE_SERVICE_ROLE_KEY` |

Deployment existing sudah punya `NEXT_PUBLIC_SUPABASE_URL` dan
`NEXT_PUBLIC_SUPABASE_ANON_KEY` di `.env.local` (dan pada build Vercel),
sehingga **baca tidak memerlukan env baru**.

## Kredensial tulis (sudah ada, tidak berubah)

| Nama | Peran |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | hanya server, hanya jalur tulis, **tidak pernah** dikirim ke Bakpau |
| `SUPABASE_URL` | URL proyek |

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
