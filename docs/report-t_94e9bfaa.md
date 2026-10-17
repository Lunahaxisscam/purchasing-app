# Laporan S5 — Reminder Operasional & Readiness Control (t_94e9bfaa)

Tanggal: 18 Okt 2026 · Agent: **bamboo-tech** · Branch: `feat/ops-workflow-t_cde1b8ad`
Base: `main@18fb594` (lewat S4 `ab55d39`)
Migrasi DB: **nol** · `data/` tidak disentuh · tidak ada push/deploy.

---

## 1. Yang dibangun

Lapisan **reminder + readiness control** yang bersifat **dry-run / read-only**:

| File | Peran |
|---|---|
| `pages/api/reminders.js` | Endpoint tipis (re-export). **GET saja.** |
| `scripts/reminders/handler.js` | Logika endpoint (diuji harness apa adanya — tidak ada salinan kedua). |
| `scripts/reminders/collect.js` | Pembaca data **read-only** (satu-satunya file yang menyentuh jaringan; hanya `select()`). |
| `scripts/reminders/rules.js` | Mesin aturan **murni** (tanpa I/O) + render teks. |
| `scripts/reminders/auth.js` | Guard admin — **memakai ulang** guard S4 (`modules/sales-invoice/auth.js`), bukan salinan baru. |
| `scripts/reminders/cli.mjs` | Laporan terminal (`--offline`, `--json`, `--as-of`, `--kinds`). |
| `scripts/reminders/sample-data.json` | Data contoh untuk mode offline (bentuknya sama dengan keluaran `collect.js`). |
| `scripts/reminders-test/` | Harness A/B/C/D + `fake_supabase.mjs` + runner. |
| `docs/reminders-contract.md` | Kontrak lengkap (jenis, ambang, arti "tidak tersedia", bentuk JSON). |

**Tidak ada file milik agent lain yang diubah** (`git status` → nol file tracked berubah; hanya file
baru). Tidak ada entri menu/UI baru: kartu ini melarang menyentuh UI agent lain.

## 2. Empat jenis reminder yang diminta + tiga tambahan

Diminta: *overdue PR, pending delivery, invoice due, missing evidence* → semuanya ada.

| Diminta | Jenis | Ambang default |
|---|---|---|
| Overdue PR | `pr_overdue_approval` (+ `pr_draft_stale` untuk draft yang mandek) | 3 hari |
| Pending delivery | `purchase_pending_delivery` (item belum dibeli **dan** cangkang nota kosong) | 7 hari |
| Invoice due | `invoice_due` (+ `invoice_draft_stale`) | 7 hari |
| Missing evidence | `missing_evidence` — 8 pemeriksaan bukti | — |
| *(tambahan)* | `handover_pending` — barang dibeli tapi belum diserahkan | 3 hari |

## 3. Bukti "tidak ada kirim / bayar / cron"

Bukan klaim — diuji:

- **Tidak ada jalur tulis di kode:** harness memeriksa seluruh file lapisan (komentar dibuang) dan
  gagal bila ada `.insert(`/`.update(`/`.delete(`/`.upsert(`/`.rpc(` → **0 ditemukan**.
- **Nol tulis ke DB pada runtime nyata:** E2E menyalakan server Next sungguhan dengan "Supabase"
  palsu yang mencatat setiap POST/PATCH/DELETE → **0 tulis** (`D7a`).
- **Tidak ada cron:** tidak ada `vercel.json` dengan `crons`, tidak ada paket penjadwal di
  `package.json`, tidak ada `setInterval`/`schedule` di kode, tidak ada script npm otomatis.
- **Tidak ada pengiriman keluar:** tidak ada Telegram/WA/email/webhook. Laporan justru mencetak
  *"Tidak ada pesan yang dikirim, tidak ada pembayaran, tidak ada jadwal/cron yang diubah."*
- **Method tulis ditolak:** POST/PATCH/PUT/DELETE → **405** dan pembacaan data tidak dijalankan
  sama sekali (diuji di unit + HTTP nyata).

## 4. Data availability & thresholds (permintaan eksplisit kartu)

Setiap respons memuat blok `readiness`:

- `sources_available` / `sources_unavailable` — tabel mana yang terbaca, dengan kode error.
- `thresholds_used` + `threshold_defaults` + `threshold_sources` (`default`/`env`/`query`).
- `kinds_blocked` — jenis yang **TIDAK bisa dinilai**, dengan alasan eksplisit
  *"… TIDAK dievaluasi (bukan berarti bersih)"*.
- `data_ready`, `status` (`ok`/`degraded`/`unavailable`), `items_total`/`items_shown`/`items_truncated`.

Ambang yang tidak valid (di luar 0..365 / bukan angka) **ditolak dan dilaporkan** di
`rejected_thresholds`, tidak dipakai diam-diam.

## 5. Kondisi data nyata saat kartu ini dikerjakan

Diverifikasi read-only lewat PostgREST (bukan asumsi):

| Tabel | Baris | Status |
|---|---|---|
| `purchase_requests` | 11 | tersedia |
| `pr_items` | 46 | tersedia |
| `approval_steps` | 2 | tersedia |
| `receivings` | 5 | tersedia |
| `receiving_items` | 4 | tersedia |
| `handovers` | 1 | tersedia |
| `projects` | 11 | tersedia |
| `sales_invoices` | — | **PGRST205** — tabel belum ada |

Karena itu `invoice_due` dan `invoice_draft_stale` dilaporkan **BLOCKED** — bukan "0 temuan".
Laporan nyata (as-of 18 Okt 2026) menghasilkan **13 reminder: 1 critical, 9 warning, 3 info**, dengan
temuan paling berat:

> Handover berstatus `CONFIRMED` tetapi `diserahkan_at` kosong — status dan bukti fisik
> bertentangan (1 baris di produksi).

Temuan lain yang nyata: 3 nota belanja tanpa baris barang, 4 PR `APPROVED` tanpa jejak
`approval_steps`, 1 PR `APPROVED` tanpa item sama sekali, 3 nota tanpa bukti nota/transfer,
1 handover belum diserahkan 3 hari.

## 6. Handoff S4 dipatuhi

S4 (t_22865fc4) berpesan: *reminder invoice WAJIB menyatakan bila data hanya ada di file pratinjau
lokal, dan outstanding harus dihitung dari status, bukan `paid_amount`.*

- `collect.js` **tidak pernah** membaca file pratinjau sebagai data kanonik; hanya melaporkan
  keberadaannya (`sources[].preview`, `readiness.invoice_preview_file`) dengan catatan
  *"tidak durable — JANGAN dipakai untuk keputusan penagihan nyata"*.
- `readiness.invoice_source_durable` memberi pemanggil cara menolak laporan untuk penagihan.
- Outstanding = `TERBIT`/`TERKIRIM`/`DISETUJUI` (bukan `grand_total − paid_amount`).
- Semua pembacaan memakai sesi/kredensial server; tidak ada jalur yang melewati otorisasi.

## 7. Verifikasi

| Harness | Cakupan | Hasil |
|---|---|---|
| A `rules_test.mjs` | 7 jenis, ambang (tepat di ambang vs di bawah), BLOCKED, dataset tidak dimutasi, urutan, render teks, paritas pola penanda | **123 lulus / 0 gagal** |
| B `api_test.mjs` | 401 tanpa sesi, 403 non-admin, 503 fail closed, token pratinjau, 405 semua method tulis, readiness, `format=text`, handoff S4, bukti tanpa jalur tulis | **95 lulus / 0 gagal** |
| C `parity_test.mjs` | paritas `readNoteMarkers` vs `parsePurchaseNote` (12 kasus + catatan nyata), bukti read-only seluruh lapisan, CLI offline & `--json` | **25 lulus / 0 gagal** |
| D `e2e_runtime_test.mjs` | HTTP nyata: server Next + Supabase palsu, alur admin/non-admin, nol tulis, regresi `/api/sales-invoices` | **36 lulus / 0 gagal** |
| — | **Total** | **279 lulus / 0 gagal** |

Build: `ENABLE_SMOKE=1 npx next build` **hijau**, rute `/api/reminders` terdaftar.

Regresi suite lama: `sales-invoice-test`, `rap-test`, `handover-compact-test`, `handover-flow-test`,
`purchase-flow-test`, `pr-purchase-compact-test`, `pr-estimator-test`, `pr-group-test`,
`approval-queue-test`, `fase2-save-test`, `showmore-list-test`, `material-acuan-test` → **semua exit 0**.

## 8. Blocker & catatan jujur

1. **`sales_invoices` belum ada di Supabase** (`PGRST205`, diverifikasi ulang hari ini). Reminder
   invoice berstatus **BLOCKED** sampai migrasi di `docs/sales-invoice-contract.md` §3 dijalankan
   dan disetujui DAT. Lapisan ini tidak akan "menghijau" palsu selama tabel itu tidak ada.
2. **`rab-boq-test` E7 gagal PRE-EXISTING** sejak `ac71191` (assertion mencari string di
   `pages/index.js` yang tidak disentuh kartu ini) — sudah dicatat di handoff S4, tidak berubah.
3. **Tidak ada UI & tidak ada pengiriman otomatis.** Disengaja: kartu ini melarang menyentuh UI
   agent lain dan melarang pengiriman keluar/cron. Bila DAT ingin tombol di Admin Suite atau
   pengiriman Telegram, itu kartu terpisah (menyentuh file CORE milik Tech Lead).
4. **Ambang masih tebakan konservatif** (3/7 hari) karena belum ada SLA resmi dari DAT. Semua
   ambang bisa diubah tanpa deploy dan laporan selalu mencetak sumbernya.
5. **Termin/pembayaran sebagian belum ada skemanya** → invoice due tidak menghitung sisa tagihan.

## 9. Cara menjalankan

```bash
python3 scripts/reminders-test/run.py        # A + B + C (tanpa DB/jaringan)
python3 scripts/reminders-test/run_e2e.py    # D (Next + Supabase palsu)
node scripts/reminders/cli.mjs --offline     # laporan contoh, tanpa jaringan
node scripts/reminders/cli.mjs --as-of 2026-10-18   # laporan data Supabase (read-only)
```
