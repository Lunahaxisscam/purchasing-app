# Kontrak Reminder Operasional & Readiness Control — t_94e9bfaa (S5)

Tanggal: 18 Okt 2026 · Owner: **bamboo-tech** · Tahap: **S5** (setelah S4 Sales Invoice)
Status migrasi DB: **TIDAK ADA SQL DIJALANKAN.** Nol file migrasi baru, `data/` tidak disentuh,
tidak ada push/deploy.

---

## 1. Satu kalimat

Lapisan **pengawas** yang membaca data operasional (read-only) lalu melaporkan apa yang
terlambat / kurang bukti — **tanpa mengirim pesan, tanpa membayar, tanpa mengubah status,
tanpa menyentuh cron**.

## 2. Jaminan yang ditegakkan kode (bukan niat)

| Jaminan | Bagaimana dibuktikan |
|---|---|
| **Dry-run / read-only** | `scripts/reminders/collect.js` hanya `select()`. Harness `C2b-*` memeriksa seluruh file lapisan dan gagal bila ada `.insert(`/`.update(`/`.delete(`/`.upsert(`/`.rpc(` di kode (komentar dibuang lebih dulu). |
| **Tidak ada pengiriman keluar** | Tidak ada Telegram/WA/email/webhook di lapisan ini (`B9f`). Laporan justru mencetak "tidak ada pesan yang dikirim". |
| **Tidak ada pembayaran** | Tidak ada pemanggilan payment/transfer; `side_effects.payment = false` di setiap respons (`A11e`, `C2j`). |
| **Tidak ada mutasi cron** | Tidak ada `vercel.json` dengan `crons`, tidak ada paket penjadwal di `package.json`, tidak ada `setInterval`/`schedule` di kode (`C2e`, `C2f`, `C2g`, `B9h`). |
| **Tidak mengubah status** | Endpoint hanya `GET`; method lain → **405** dan pembacaan data tidak dijalankan sama sekali (`B3-*`, `D4-*`). |
| **Nol tulis ke DB** | E2E menembak server Next nyata + "Supabase" palsu yang mencatat setiap POST/PATCH/DELETE: hasilnya **0 tulis** (`D7a`). |
| **Data hilang ≠ data bersih** | Tabel yang tidak bisa dibaca membuat jenis reminder terkait **BLOCKED** dengan alasan eksplisit ("bukan berarti bersih"), bukan "0 temuan" (`A10*`, `D6*`). |

## 3. Letak file

```
pages/api/reminders.js            # endpoint tipis (re-export) — GET saja
scripts/reminders/handler.js      # logika endpoint (diuji harness apa adanya)
scripts/reminders/collect.js      # pembaca data READ-ONLY (satu-satunya yang menyentuh jaringan)
scripts/reminders/rules.js        # mesin aturan MURNI (tanpa I/O) + render teks
scripts/reminders/auth.js         # guard admin (memakai ulang guard S4, bukan salinan)
scripts/reminders/cli.mjs         # laporan terminal (--offline / --json / --as-of)
scripts/reminders/sample-data.json# data contoh untuk mode offline
scripts/reminders-test/           # harness A/B/C/D + fake_supabase + runner
docs/reminders-contract.md        # dokumen ini
docs/report-t_94e9bfaa.md         # laporan hasil kerja
```

**Tidak ada file modul/UI agent lain yang diubah.** Tidak ada entri menu baru: lapisan ini
sengaja tanpa UI supaya tidak bentrok dengan pekerjaan agent lain (arahan kartu: "Do not touch
other agents' UI files"). Bila nanti DAT ingin tombol di Admin Suite, itu pekerjaan terpisah
yang menyentuh `modules/registry.js` + `pages/index.js` (file CORE milik Tech Lead).

## 4. Endpoint

```
GET /api/reminders                       # JSON laporan + readiness
GET /api/reminders?format=text           # laporan teks siap baca
GET /api/reminders?as_of=2026-10-18      # hitung "hari ini" dari tanggal ini (uji/backfill)
GET /api/reminders?kinds=invoice_due,handover_pending
GET /api/reminders?limit=1000&max_items=50&all=1
GET /api/reminders?pr_overdue_days=5     # override ambang (0..365)
```

**Otorisasi:** hanya admin, memakai guard yang **sama** dengan `/api/sales-invoices`
(`modules/sales-invoice/auth.js`): JWT diverifikasi ke Supabase, peran dibaca dari tabel
`profiles`.

| Situasi | Respons |
|---|---|
| Tanpa sesi | `401 UNAUTHORIZED` |
| Sesi non-admin | `403 FORBIDDEN` |
| Otorisasi belum dikonfigurasi | `503 AUTH_NOT_CONFIGURED` (fail closed) |
| Mode pratinjau lokal | wajib `x-preview-token` = `REMINDER_PREVIEW_TOKEN` (fallback `SALES_INVOICE_PREVIEW_TOKEN`) |
| Method selain GET | `405 METHOD_NOT_ALLOWED`, tanpa membaca data |

## 5. Tujuh jenis reminder & ambang

Ambang default dipilih konservatif; semuanya bisa diubah lewat env (`REMINDER_*_DAYS`) atau
query string, dan **laporan selalu mencetak ambang yang benar-benar dipakai beserta asalnya**
(`default` / `env` / `query`). Nilai di luar `0..365` **ditolak dan dilaporkan**, tidak dipakai
diam-diam.

| Jenis | Ambang (default) | Env | Isi |
|---|---|---|---|
| `pr_overdue_approval` | `pr_overdue_days` = **3** | `REMINDER_PR_OVERDUE_DAYS` | PR berstatus `SUBMITTED` yang belum diputuskan. Umur dihitung dari langkah approval PENDING **tertua**; bila jejak approval tidak ada → jatuh ke `created_at` PR **dan** dilaporkan "bukti approval_steps kurang". ≥ 2× ambang + 1 → `critical`. |
| `pr_draft_stale` | `draft_stale_days` = **7** | `REMINDER_DRAFT_STALE_DAYS` | Draft PR yang tidak pernah diajukan — tidak masuk antrean approval maupun pembelian. |
| `purchase_pending_delivery` | `purchase_pending_days` = **7** | `REMINDER_PURCHASE_PENDING_DAYS` | Dua jalur: (a) item `APPROVED`/`ORDERED`/`PENDING_APPROVAL` yang **belum punya satu pun** `receiving_items.quantity_received > 0`; (b) **cangkang nota** dari Approval (tanpa `invoice_no`, tanpa `received_date`, tanpa `[Nominal: …]`). Estimasi rupiah dijumlahkan `qty × estimated_price` — **bukan** uang nyata. |
| `handover_pending` | `handover_pending_days` = **3** | `REMINDER_HANDOVER_PENDING_DAYS` | Handover tanpa `diserahkan_at` (barang dibeli, belum diserahkan). |
| `invoice_due` | `invoice_due_soon_days` = **7** | `REMINDER_INVOICE_DUE_SOON_DAYS` | Invoice `TERBIT`/`TERKIRIM`/`DISETUJUI`: lewat jatuh tempo → `critical`; ≤ 7 hari lagi → `warning`; tanpa `due_date` → dilaporkan juga (tidak bisa ditagih tepat waktu). |
| `invoice_draft_stale` | `invoice_draft_stale_days` = **3** | `REMINDER_INVOICE_DRAFT_STALE_DAYS` | Draft invoice belum terbit. |
| `missing_evidence` | — (tanpa ambang) | — | Bukti operasional yang bolong; lihat §6. |

### Kenapa outstanding dihitung dari STATUS, bukan `paid_amount`
Sesuai catatan handoff S4: belum ada skema pembayaran bertahap (termin). `LUNAS` hanya sah untuk
pembayaran **penuh**. Jadi outstanding = invoice berstatus `TERBIT`/`TERKIRIM`/`DISETUJUI`, bukan
`grand_total − paid_amount` (angka itu akan mengarang sisa tagihan yang tidak pernah dicatat).

## 6. Pemeriksaan bukti (`missing_evidence`)

Setiap pemeriksaan berdiri sendiri. Bila sumbernya tidak tersedia, pemeriksaan itu **dilewati dan
dilaporkan** (`notes: "Pemeriksaan bukti dilewati karena sumber tidak tersedia: …"`), tidak
dianggap lulus.

| Sub | Tingkat | Arti |
|---|---|---|
| `handover_confirmed_no_timestamp` | **critical** | Status `CONFIRMED` tetapi `diserahkan_at` kosong — status dan bukti fisik bertentangan. |
| `handover_no_receiver` | warning | Handover selesai tanpa nama penerima (`received_by` kosong / "Belum ditentukan"). |
| `nota_no_proof` | info | Nota belanja tanpa `[BuktiNota: …]` / `[BuktiTransfer: …]`. **Bukti memang opsional** di kontrak Purchase — karena itu `info`, bukan pelanggaran. |
| `nota_no_items` | warning | Nota tercatat tetapi tidak punya baris barang — isi nota tidak bisa diperiksa. |
| `nota_no_date` | info | `received_date` kosong → umur pengeluaran tidak bisa dihitung. |
| `pr_approved_no_step` | warning | PR `APPROVED` tanpa satu pun `approval_steps` yang `APPROVED` — tidak jelas siapa menyetujui. |
| `pr_approved_no_items` | warning | PR `APPROVED` tanpa satu pun baris `pr_items` — barang tidak bisa dibeli dan PR tidak akan muncul di tab "Siap Dibeli". |
| `invoice_paid_no_proof` | **critical** | `LUNAS` tanpa `paid_at` / `payment_ref` / `payment_verified_by`. |
| `invoice_sent_no_channel` | warning | `TERKIRIM` tanpa `sent_channel`. |

## 7. Sumber data & arti "tidak tersedia"

Endpoint membaca 8 tabel dengan `SELECT *` + `count: 'exact'`, urut `created_at` naik (supaya bila
batas baris tercapai, yang terpotong adalah data **terbaru** — reminder mengurus yang tertua) dan
melaporkan `truncated` bila `count > fetched`.

| Sumber | Status saat dokumen ini ditulis |
|---|---|
| `purchase_requests` (11), `pr_items` (46), `approval_steps` (2), `receivings` (5), `receiving_items` (4), `handovers` (1), `projects` (11) | **TERSEDIA** (diverifikasi lewat PostgREST read-only) |
| `sales_invoices` | **TIDAK TERSEDIA** — `PGRST205` "Could not find the table 'public.sales_invoices' in the schema cache". Migrasi usulan ada di `docs/sales-invoice-contract.md` §3, **belum dijalankan**. |

Konsekuensinya di laporan: `data_ready: false`, `status: "degraded"`, `invoice_due` dan
`invoice_draft_stale` masuk `kinds_blocked` — **bukan** "0 temuan".

### Handoff S4 tentang dua backend invoice (dipatuhi)
Invoice punya dua backend: Supabase (kanonik/durable) dan file JSON lokal (**pratinjau**, tidak
durable, tidak dibagi antar-instance). Lapisan reminder:

- **tidak pernah** membaca file pratinjau sebagai data kanonik,
- hanya **melaporkan keberadaannya** (`readiness.invoice_preview_file`, `sources[].preview`) dengan
  catatan "tidak durable — JANGAN dipakai untuk keputusan penagihan nyata",
- mengekspos `readiness.invoice_source_durable` supaya pemanggil bisa menolak memakai laporan ini
  untuk penagihan bila `false`.

## 8. Bentuk laporan

```jsonc
{
  "ok": true,
  "dry_run": true,
  "read_only": true,
  "side_effects": { "outbound_send": false, "payment": false, "cron_mutation": false,
                    "write_queries": 0, "status_changes": 0 },
  "generated_at": "…", "as_of": "2026-10-18",
  "data_ready": false, "status": "degraded",
  "thresholds": { "pr_overdue_days": 3, … },
  "threshold_sources": { "pr_overdue_days": "default", … },
  "rejected_thresholds": [],
  "sources": [ { "key": "sales_invoices", "available": false, "row_count": 0,
                 "error_code": "SCHEMA_UNAVAILABLE", "durable": false,
                 "preview": { "exists": true, "rows": 0, … } } ],
  "kinds": [ { "key": "invoice_due", "blocked": true, "found": 0, "threshold_days": 7 } ],
  "blocked": [ { "kind": "invoice_due", "missing_sources": ["sales_invoices"],
                 "reason": "… TIDAK dievaluasi (bukan berarti bersih)." } ],
  "summary": { "total": 12, "by_kind": {…}, "by_severity": {"critical":1,"warning":8,"info":3},
               "oldest_age_days": 17 },
  "items": [ { "id": "handover_pending::handover:c148…", "kind": "handover_pending",
               "severity": "warning", "title": "…", "detail": "…",
               "entity": { "type": "handover", "id": "c148…", "ref": "Pak Joko" },
               "age_days": 3, "threshold_days": 3, "due_date": null, "overdue_days": null,
               "evidence_missing": [], "action_hint": "…", "meta": {…} } ],
  "notes": [ … ],
  "readiness": { "data_ready": false, "sources_available": […], "sources_unavailable": […],
                 "kinds_blocked": […], "thresholds_used": {…}, "invoice_source_durable": false,
                 "items_total": 12, "items_shown": 12, "items_truncated": false }
}
```

Item diurutkan `critical → warning → info`, lalu umur terbesar. `items` dibatasi `max_items`
(default 200) kecuali `?all=1`; pemotongan **selalu** dinyatakan (`items_truncated`).

## 9. Cara memakai (tanpa mengubah apa pun)

```bash
# Laporan teks dari data Supabase (butuh env Supabase, read-only)
node scripts/reminders/cli.mjs --as-of 2026-10-18

# Tanpa jaringan sama sekali (data contoh di repo)
node scripts/reminders/cli.mjs --offline

# JSON untuk diproses lebih lanjut
node scripts/reminders/cli.mjs --json > /tmp/reminder.json

# Lewat endpoint (butuh sesi admin)
curl -s -H "Authorization: Bearer <jwt-admin>" \
  "https://<host>/api/reminders?format=text&as_of=2026-10-18"
```

CLI sengaja **selalu** exit code `0` bila laporan berhasil dibuat — tidak ada exit code khusus
untuk "ada temuan", supaya tidak ada yang menyambungkannya ke alert otomatis tanpa keputusan
manusia.

## 10. Variabel lingkungan

| Var | Arti |
|---|---|
| `REMINDER_PREVIEW_TOKEN` | Token pratinjau lokal untuk endpoint ini. Fallback ke `SALES_INVOICE_PREVIEW_TOKEN`. |
| `REMINDER_PR_OVERDUE_DAYS` | Ambang `pr_overdue_days` (0..365). |
| `REMINDER_DRAFT_STALE_DAYS` | Ambang `draft_stale_days`. |
| `REMINDER_PURCHASE_PENDING_DAYS` | Ambang `purchase_pending_days`. |
| `REMINDER_HANDOVER_PENDING_DAYS` | Ambang `handover_pending_days`. |
| `REMINDER_INVOICE_DUE_SOON_DAYS` | Ambang `invoice_due_soon_days`. |
| `REMINDER_INVOICE_DRAFT_STALE_DAYS` | Ambang `invoice_draft_stale_days`. |
| `SALES_INVOICE_PREVIEW_DIR` | (opsional) direktori file pratinjau invoice; hanya **metadata**-nya dibaca untuk dilaporkan. |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Kredensial baca (read-only). Tanpa kredensial → semua sumber `NO_CREDENTIALS` dan laporan `status: "unavailable"` (bukan error 500). |

## 11. Yang BELUM ada (jujur)

1. **`sales_invoices` belum ada di Supabase** → `invoice_due` & `invoice_draft_stale` **BLOCKED**.
   Ini bukan bug lapisan ini; menunggu migrasi yang disetujui DAT (`docs/sales-invoice-contract.md` §3).
2. **Tidak ada pengiriman otomatis** (Telegram/WA/email) dan **tidak ada cron**. Itu keputusan
   desain untuk kartu ini; bila nanti diminta, pekerjaannya terpisah dan butuh persetujuan.
3. **Tidak ada UI.** Reminder dibaca lewat endpoint/CLI. Tombol di Admin Suite akan menyentuh file
   CORE (registry/pages) — di luar lingkup kartu ini.
4. **Termin/pembayaran sebagian belum ada skemanya** → `invoice_due` sengaja tidak menghitung sisa
   tagihan dari `paid_amount`.
5. **`receiving_items` hanya menyimpan `quantity_received`** → tidak ada pemeriksaan "barang rusak
   tanpa foto" atau "distribusi parsial" (kolomnya belum ada, lihat `docs/receipt-flow-contract.md` §3).
6. **Ambang masih tebakan konservatif** (3/7 hari). Belum ada keputusan bisnis DAT soal SLA; karena
   itu semua ambang bisa diubah tanpa deploy dan laporan mencetak sumbernya.

## 12. Verifikasi

| Harness | Isi | Hasil |
|---|---|---|
| `scripts/reminders-test/rules_test.mjs` (A) | 7 jenis, ambang, BLOCKED, read-only, urutan, render | **123 lulus / 0 gagal** |
| `scripts/reminders-test/api_test.mjs` (B) | auth 401/403/503, 405, readiness, format=text, bukti tanpa jalur tulis, handoff S4 | **95 lulus / 0 gagal** |
| `scripts/reminders-test/parity_test.mjs` (C) | paritas `readNoteMarkers` vs `lib/purchaseNote.parsePurchaseNote`, bukti read-only seluruh lapisan, CLI offline | **25 lulus / 0 gagal** |
| `scripts/reminders-test/e2e_runtime_test.mjs` (D) | HTTP nyata ke server Next + Supabase palsu | **36 lulus / 0 gagal** |

Total: **279 lulus / 0 gagal**.

```bash
python3 scripts/reminders-test/run.py        # A + B + C (tanpa DB/jaringan)
python3 scripts/reminders-test/run_e2e.py    # D (menyalakan Next + Supabase palsu)
```
