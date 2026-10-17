# Laporan S7/7 — Final Technical Integration Audit

**Kartu:** `t_dbf7dbb1` · **Assignee:** bamboo-tech
**Branch:** `feat/ops-workflow-t_cde1b8ad` — audit atas `7a64e76` (tip S6)
**Base:** `main@18fb594` (merge-base = `18fb594`; branch **tidak** ketinggalan main)
**Deliverable utama:** `docs/release-checklist-ops-branch.md`
**Sifat pekerjaan:** audit read-only. **Tidak** deploy produksi, **tidak**
menjalankan migrasi, **tidak** mengklaim skema siap.

---

## 1. Apa yang dikerjakan

1. Build produksi + build smoke dari working tree branch ini.
2. Menjalankan **seluruh** harness regresi yang ada (23 skrip `run.py` + 3 e2e
   HTTP) dan memisahkan kegagalan nyata dari yang pre-existing.
3. Memeriksa konflik merge & kontrak bersama, termasuk **simulasi merge nyata**
   terhadap 6 branch lain di worktree sekali pakai.
4. Verifikasi API health terhadap **server Next sungguhan** (bukan hanya unit test).
5. PM2 preview readback: identitas proses, build yang benar-benar disajikan, health.
6. Probe Supabase **read-only** untuk kesiapan skema.
7. Membersihkan hanya artefak generated di workspace sendiri.
8. Menyusun technical release checklist + daftar blocker.

---

## 2. Hasil verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `npx next build` | **HIJAU** — 10 rute API, 4 halaman |
| `ENABLE_SMOKE=1 npx next build` | **HIJAU** — `/__smoke` merender 9 modul (`#mod-rap`, `#mod-sales-invoice` ikut) |
| Harness regresi | **2.550 assertion hijau**, 19 suite hijau + 127 e2e, **0 gagal** |
| Suite merah | 3 — **semua terbukti pre-existing** dengan menjalankannya di worktree bersih `18fb594` |
| Konflik di working tree | **0** (tidak ada `<<<<<<<`, tidak ada file `U`) |
| Konflik lintas branch | 3 konflik "both-add" di file CORE vs `feat/material-catalog` — **sudah dibuktikan bisa diselesaikan** (build + 5 suite hijau setelah resolusi) |
| Implementasi otorisasi | **1 saja** (`modules/sales-invoice/auth.js`), dipakai 3 endpoint |
| Tulis/transport di lapisan S5/S6 | **0** — pemindaian `.insert/.update/.delete/.upsert/.rpc` kosong; transport keluar hanya muncul di komentar |
| Sifat pekerjaan | **read-only** terhadap DB. Satu-satunya tulisan adalah `data/sales_invoices.json` (store pratinjau) saat e2e H4, dan file itu **dikembalikan identik** (md5 sama). |
| Route guard S6 | **34/34** aksi terlarang → 403 sebelum auth, diuji ke server nyata |
| Store S4 fail-closed | Diuji ke Supabase LIVE: `SCHEMA_UNAVAILABLE` / 503, **bukan** daftar kosong |
| E2E alur penuh invoice (H4) | **39/39** lewat HTTP nyata: draft → terbit → terkirim → lunas, idempotensi, 409/400 pada bukti kurang |

### 2.1 Rincian tiga suite merah (semua pre-existing)

| Suite | Gagal | Sebab sebenarnya |
|---|---|---|
| `rab-boq-test` | E7 (1/20) | assertion mencari daftar exclude tombol refresh tanpa `'rap'`; S3 memang menambahkannya — assertion perlu diperbarui pemilik RAB/BOQ |
| `rab-boq-render-test` | F1, F2 (2/70) | heading sidebar harus `font-weight >= 800` + `var(--ivory)` — gagal identik di `18fb594` |
| `ui-olive-tokens-test` | C (1/35) | `font-weight: 750` ×2 di `styles/globals.css`, baris milik `e53e83f`/`de55d034` — gagal identik di `18fb594` |

---

## 3. Temuan yang perlu tindakan (di luar kode S1…S6)

### T1 — Preview PM2 menyajikan `main` yang endpoint invoice-nya TANPA otorisasi

`purchasing-preview` (`pid 1719173`, cwd `/home/ubuntu/purchasing-app`, HEAD
`18fb594` = `main`) menyajikan build `kpdL4JDM7c6L03-GyOYkZ` yang **cocok**
dengan `.next/BUILD_ID` di disk. Jadi prosesnya sehat — hanya saja ia
menyajikan **main**, bukan branch ini.

Diuji langsung ke `http://127.0.0.1:3001`:

```
GET   /api/sales-invoices        -> 200  {"ok":true,"invoices":[]}
POST  /api/sales-invoices  {}    -> 400  (lolos auth, masuk validasi)
PATCH /api/sales-invoices  {}    -> 400  (lolos auth, masuk validasi)
GET   /api/reminders             -> 404  (belum ada di main)
GET   /api/marketing-contract    -> 404  (belum ada di main)
```

`pages/api/sales-invoices.js` di `main` tidak mengimpor `verifyAdmin` sama sekali.
Artinya endpoint invoice di preview **terbuka untuk tulis** oleh siapa pun yang
bisa menjangkau port itu. Preview bind ke `*:3001`, jadi jangkauannya mencakup
**seluruh tailnet** (`100.91.244.41:3001` → 200), bukan hanya loopback. Paparan
ke internet publik tertutup (IP publik `43.157.201.163:3001` timeout), tapi ini
**lubang aktif sekarang**, bukan risiko teoretis. Bukan regresi branch ini —
justru inilah yang S4 perbaiki. Tindakan: redeploy preview dari branch, atau
hentikan preview.

### T2 — `feat/mobile-responsive/t_eebe4678` meng-commit symlink `node_modules`

`git ls-tree feat/mobile-responsive/t_eebe4678 node_modules` →
`120000 blob 16ec707…` dengan target `/home/ubuntu/purchasing-app/node_modules`,
masuk di commit `1da59de`. `.gitignore` berisi `node_modules/` (dengan garis
miring) sehingga **symlink tanpa garis miring tidak ter-ignore**. Akibatnya
merge branch itu gagal (`untracked working tree file 'node_modules' would be
overwritten`). Harus dibersihkan di branch itu (`git rm --cached node_modules`).

### T3 — `feat/receiving-simplify/t_7bc6246b` sudah usang

Branch itu masih memodifikasi `modules/receivings/view.jsx`,
`receiptForm.jsx`, `receiptLogic.js` — tiga file yang **sudah dihapus**
`t_9109cf5e` (arahan DAT: Purchase berhenti di "barang dibeli"). Merge akan
menghasilkan 8 konflik termasuk 4 `modify/delete` dan **menghidupkan kembali
kode yang sengaja dibuang**. 6 ahead / 7 behind. Sebaiknya dibatalkan.

### T4 — Dokumentasi S6 menyebut "48 aksi terlarang", kodenya 34

`scripts/marketing/handler.js` → `FORBIDDEN_ACTIONS` berisi **34** nama
(dihitung ulang dari kode dan diuji satu per satu ke server nyata: 34/34 → 403).
Dokumen dan laporan menyebut 48 di 6 tempat:

- `docs/marketing-crm-integration-contract.md` baris 181 ("48 nama") dan 451
- `docs/report-t_1fd27ad9.md` baris 23, 87, 118, 155

Daftar nama yang dicetak di dokumen **sama persis** dengan kode (34 nama) —
hanya angka klaimnya yang salah. Harness sendiri sudah jujur: `B4d semua 34
aksi terlarang → 403`. Ini kesalahan teks, bukan kebocoran guard.

### T5 — Urutan guard tidak seragam antar endpoint admin

| Endpoint | Urutan | `DELETE` tanpa sesi |
|---|---|---|
| `/api/sales-invoices` (S4) | auth → 405 | **401** |
| `/api/reminders` (S5) | 405 → auth | **405** |
| `/api/marketing-contract` (S6) | 405 → 403 aksi → auth | **405** |

Semua tetap *fail closed* (tidak ada lubang keamanan), tapi
`docs/sales-invoice-contract.md` §5 menulis "`lain` → `405` + `Allow`" tanpa
menyebut auth diperiksa lebih dulu. Perlu keputusan Tech Lead soal standar;
kartu ini tidak mengubah kode S4 karena harness S4 mengunci perilaku itu.

---

## 4. Blocker rilis

| # | Blocker | Bukti |
|---|---|---|
| B1 | **Kredensial migrasi tidak tersedia** | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `DATABASE_URL`, `POSTGRES_URL`, `PGPASSWORD`, `SUPABASE_ACCESS_TOKEN`, `DIRECT_URL` → semuanya **kosong** di env maupun `.env.local`. `psql`/`pg_dump` tidak terpasang; `psycopg2`/`pg8000` tidak ada. Hanya `NEXT_PUBLIC_SUPABASE_URL` + anon key. **DDL tidak bisa dijalankan dari sini dengan alat apa pun.** |
| B2 | **File migrasi 6 tabel belum ada** | `migrations/` = 9 file; tidak satu pun membuat `sales_invoices`, `customers`, `leads`, `lead_touchpoints`, `campaigns`, `lead_handoffs`. DDL masih "USULAN, BELUM DIJALANKAN" di `docs/sales-invoice-contract.md` §3 dan `docs/marketing-crm-integration-contract.md` §9.2. Urutan sebenarnya: **setujui → tulis file → jalankan**. |
| B3 | **Persetujuan bisnis DAT belum ada** | definisi `QUALIFIED`, batas `DORMANT`, komisi `REFERRAL` (S6); SLA 6 ambang reminder (S5 memakai 3/7 hari sebagai tebakan); skema termin/pembayaran sebagian (S5 tidak bisa menghitung sisa tagihan) |
| B4 | **Branch belum di-push** | `origin` hanya punya `origin/main` = `3870ef7`, yaitu **7 commit di belakang** `main` lokal (`18fb594`). 16 commit belum terkirim. |

---

## 5. Kesiapan skema (read-only, live Supabase)

**Ada:** `projects` 11, `purchase_requests` 11, `pr_items` 46,
`approval_steps` 2, `vendors` 22, `materials` 343, `receivings` 5,
`receiving_items` 4, `handovers` 1, `project_plans` 0, `project_closings` 0,
`telegram_alerts_log` 0, `profiles` 4. `tukang_*` & `user_credentials` ada
tapi RLS menolak anon (bukan drift).

**Tidak ada (`PGRST205`):** `sales_invoices`, `customers`, `leads`,
`lead_touchpoints`, `campaigns`, `lead_handoffs`.

**Drift repo→DB = 0:** seluruh 8 tabel yang dideklarasikan di `migrations/*.sql`
memang ada di DB. Yang kurang adalah tabel yang belum punya file migrasi.

Laporan live dari CLI (read-only, hanya `SELECT`):

```
reminders --as-of 2026-10-18 : DEGRADED · 13 reminder (1 critical, 9 warning, 3 info)
                               invoice_due & invoice_draft_stale -> BLOCKED (PGRST205)
marketing --readiness        : 5 tabel marketing/CRM SCHEMA_UNAVAILABLE
                               projects 11 baris (baca saja)
                               "pipeline lead TIDAK dinilai (bukan berarti kosong)"
```

**Tidak ada klaim skema siap.** Ketidakhadiran tabel dilaporkan sebagai
BLOCKED oleh S5 & S6, dan itu perilaku yang benar.

---

## 6. Kebersihan workspace

| Tindakan | Bukti |
|---|---|
| 3 worktree sementara dibuat & dihapus | `git worktree list` kembali ke 9 entri semula (`/tmp/s7-baseline`, `/tmp/s7-merge`, `/tmp/s7-mx` hilang) |
| Server uji `next start` (port 3010, 3011, 3012, 3013) | dijalankan lalu dimatikan; keempat port bebas |
| Perubahan file tracked | **0** (`git status` hanya `?? WORKSPACE_ROLE.md`, `?? node_modules` — keduanya sudah ada sebelum kartu ini) |
| `migrations/` | **tidak disentuh** (0 file berubah vs main) |
| `data/` | sempat ditulis e2e H4 (store pratinjau), lalu **dikembalikan identik** — md5 `58e0494c…`, `git status data/` bersih |
| Satu-satunya file baru | `docs/release-checklist-ops-branch.md` + laporan ini |

---

## 7. Catatan untuk pekerja berikutnya

- Jangan menganggap "48 aksi" sebagai angka yang harus dipenuhi kode — kodenya
  34 dan harness mengunci 34. Perbaiki teksnya, jangan tambah aksi.
- Menambah tabel baca di lapisan marketing = tambah `READABLE_SOURCES` di
  `probe.js` **dan** `TABLE_OWNERSHIP` di `contract.js`; harness C4b mengunci
  jumlahnya.
- `rab-boq-test` E7 akan tetap merah sampai pemilik RAB/BOQ memperbarui
  assertion-nya (S3 sengaja menambahkan `'rap'` ke daftar exclude refresh).
- `ui-olive-tokens-test` gagal karena `font-weight: 750` di `styles/globals.css`
  yang sudah ada di main. Jangan "diperbaiki" dengan mengubah nilai font di
  kartu integrasi — itu perubahan desain, bukan integrasi.
- Preview PM2 **bukan** pratinjau branch ini. Untuk melihat branch ini, jalankan
  `next start -p <port lain>` dari workspace ini (seperti yang dipakai audit ini).
