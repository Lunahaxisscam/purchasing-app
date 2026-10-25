# Laporan Lean Admin A — Request tanpa approval, template interaktif, autofill estimasi/vendor

Kartu: `t_a5a73034` · Assignee: bit-dev · Model: `cbai/deepseek-v4.1-flash` (9router)
Workspace: `/home/ubuntu/dev-workspaces/purchasing-lean-admin-requests`
Base: fast-forward dari parent `t_ffddeb2d` @ `625f5b9` (ancestor diverifikasi, bukan reset main/fe9862c)

---

## 1. Commit

| Commit | Isi |
|---|---|
| `5ac4d21` | fondasi kontrak lean (penanda, klasifikasi, submit, pemenuhan, autofill) + acceptance test logika |
| _(lihat commit berikutnya di komentar kartu)_ | UI + service wiring + render/viewport test + dokumentasi kontrak |

Branch: `feat/lean-admin-requests`. Tidak ada push, tidak ada deploy, tidak ada switch preview.

---

## 2. Yang diimplementasikan

### 2.1 Penanda jalur lean (tanpa enum/DDL baru)

`modules/requests/leanRequest.js` — parser tunggal untuk `purchase_requests.notes`:

```
[Jalur: LEAN] · [Tutup: <alasan>] · [TutupPada: <ISO>]
```

Preseden identik sudah dipakai `lib/purchaseNote.js` (`[Nominal: …]`, `[Tahap: DIBELI]`
di `receivings.note`). Klasifikasi eksplisit: `DRAFT` / `LEAN` / `LEGACY_APPROVAL` /
`LEGACY_UNKNOWN` / `APPROVED` / `REJECTED` / `REVISI`.

**Legacy tidak diakui sebagai lean**: `SUBMITTED` tanpa penanda → `LEGACY_UNKNOWN`
(tampil "Submitted lama"), tidak diubah massal, tidak dipakai sebagai antrean harian.

### 2.2 Submit tanpa approval

`modules/requests/submitLean.js` → `submitLean(pr, opts)`:

| Objek | Perubahan |
|---|---|
| `purchase_requests.status` | `DRAFT`/`REVISI` → `SUBMITTED` (nilai existing) |
| `purchase_requests.notes` | catatan manusia + `[Jalur: LEAN]` |
| `pr_items` | **0 tulisan** (status tetap `PENDING_APPROVAL`) |
| `approval_steps` | **0 insert/update** |
| `receivings` | **0 baris baru** |

Idempoten (klik ganda → 0 write tambahan), validasi qty/nama/status di service boundary,
readback status+penanda setelah tulis, gagal tulis → tidak ada sukses palsu.

`REJECTED` legacy tetap memakai jalur lama `handleFinishPr` (riwayat approval tidak rusak).

### 2.3 Tutup sisa kebutuhan

`closeRequestRemaining(pr, reason, opts)` — hanya menulis catatan (penanda tutup),
alasan wajib (≤300 char), penutupan ulang mengganti bukan menumpuk, **qty asli tidak
berubah**, status tidak dipalsukan.

### 2.4 Autofill estimasi + saran vendor

`modules/requests/suggest.js`:

- `estimateForMaterial()` memakai resolver existing `makePrEstimator` (satu sumber dengan
  modul Material). Tanpa acuan → `price: null`, label **"Belum ada acuan"** (tidak pernah `0`).
- `suggestVendorsFor()` / `suggestVendorsForItem()`: vendor histori pembelian material itu
  lebih dulu, lalu vendor master yang **eligible** untuk kategori kanonik material.
  Tidak ada vendor eligible → array kosong (tidak menebak). Tidak menulis `vendor_id`,
  tidak mengubah master, vendor tidak wajib.
- UI: chip saran di baris item (`form.jsx` → `VendorSuggestion`), klik = pilih,
  klik lagi = batal. Blok "Belum ada saran vendor" bila kosong.

### 2.5 Pemenuhan dari realisasi valid

`modules/requests/fulfillment.js`:

```
realisasi = Σ receiving_items.quantity_received
            WHERE isPurchasedNota(receiving) AND NOT isReceivingKendala(status)
```

- `estimated_price` **bukan** realisasi; request terkirim **bukan** selesai.
- Nota DRAFT / RETUR / REFUND / RUSAK diabaikan.
- Over-receipt dilaporkan, sisa terbuka, `openNeeds()` untuk task B.
- Ditampilkan sebagai baris "Pemenuhan" di tabel desktop (jalur lean) dan di kartu mobile.

### 2.6 UI lain

- Tab: **Siap Ditindaklanjuti** (hanya bertanda lean) vs **Submitted lama** — dipisah tegas.
- Badge status jujur: "Siap Ditindaklanjuti" / "Submitted lama" / "Antrean Approval (lama)";
  warna `badge-lean` / `badge-legacy`. Nilai enum DB tidak berubah.
- Tombol baris: **"✓ Selesai & Kirim"** (bukan "ke modul Approval") + **"🔒 Tutup sisa"**
  dengan dialog alasan.
- Catatan: penanda teknis tidak tampil (note popover, kartu mobile, prefill edit).
- `save.js` mode edit mempertahankan penanda yang sudah ada.

---

## 3. Tes (exit code asli)

| Suite | Hasil | Exit |
|---|---|---|
| `scripts/lean-admin-test/run.py` (baru) | **102 logika + 38 render + 105 viewport = 245 lulus, 0 gagal** | 0 |
| `scripts/fase2-save-test/run.py` | 56 lulus, 0 gagal | 0 |
| `scripts/pr-resubmit-test/run.py` | render + logika lulus | 0 |
| `scripts/field-form-test/run.py` | logika+simpan+render+7 viewport lulus | 0 |
| `scripts/pr-estimate-sync-test/run.py` | 7 viewport lulus | 0 |
| `scripts/approval-queue-test/run.py` | 60 lulus, 0 gagal | 0 |
| `scripts/pr-group-test/run.py` | lulus | 0 |
| `scripts/showmore-list-test/run.py` | lulus | 0 |
| `scripts/compact-admin-test/compact_admin_test.mjs` | 113 ok, 0 gagal | 0 |
| `scripts/all-modules-compact-test/run.py` | 749 lulus, 0 gagal | 0 |
| `scripts/crossflow-regression-test/run.py` | lulus | 0 |
| `scripts/ui-olive-tokens-test/run.py` | 35 lulus, 0 gagal | 0 |
| `scripts/purchase-flow-test/run.py` | 178 + 90 lulus, 0 gagal | 0 |
| `npm run build` (ENABLE_SMOKE=1, flock) | sukses | 0 |
| SSR `/__smoke` (next start port 3024) | 200, memuat label lean, "Submitted lama", "Tutup sisa", "Pemenuhan: sebagian — sisa 1" | 0 |

Dua assertion lama diperbarui karena memang **sengaja** berubah perilaku:
- `pr-estimate-sync-test/test_viewports.mjs`: dulu menuntut teks mentah `REJECTED`;
  kini badge status diterjemahkan ("Ditolak (lama)") sesuai brief
  "UI label boleh berbeda dari legacy enum". Assertion baru menguji badge ada & menyatakan ditolak.
- `fase2-save-test/run.py`: menambahkan penyalinan `modules/requests/leanRequest.js`
  ke sandbox (file dependensi baru), bukan melonggarkan assertion.

---

## 4. Known gaps (jujur — jangan dibaca sebagai selesai)

1. **Modul Purchase belum memakai kontrak lean.** `isBuyableStatus()` masih
   `APPROVED|ORDERED`, jadi item request lean **belum muncul** di tab "Siap Dibeli".
   Kontrak + patch yang disarankan ada di `docs/lean-request-contract.md` §4; eksekusi
   adalah ownership **task B (Bamboo t_aead7c06)**. Tanpa itu, vertical slice berhenti
   di "request terkirim & terlihat siap ditindaklanjuti", belum sampai belanja.
2. **Tidak ada tulis ke Supabase live.** Semua bukti DB = mock in-memory yang mencatat
   operasi. Skema & nilai status dibaca **read-only** (probe di `scripts/lean-admin/`).
3. **Tidak ada runtime browser nyata.** Browser tool gagal start di environment ini
   (`browser.use_real_profile` butuh `--no-sandbox`). Bukti UI = jsdom (38 assertion) +
   SSR HTML `/__smoke`. Klaim "tanpa horizontal scroll" di level atribut/inline style,
   bukan pengukuran layout nyata.
4. **Belum diuji terhadap 15 PR live.** Hanya dibaca untuk memastikan kolom & nilai status.
5. **Penanda di kolom `notes`** adalah solusi skema-existing. Bila kelak ada kolom
   khusus jalur, migrasi aditif + backfill opsional bisa menggantikannya; parser terpusat
   di satu file sehingga perubahan lokal.
6. **`pr_items.status` tetap `PENDING_APPROVAL`.** Ini disengaja (anti cap palsu), tapi
   berarti modul Approval lama masih akan menampilkan item tersebut bila dibuka — bukan
   gate, hanya riwayat. Bila DAT ingin item lean disembunyikan dari antrean Approval,
   itu perubahan terpisah di modul Approval (bukan scope kartu ini).
7. **Staging port 3001 tidak disentuh** (bukan wewenang kartu ini). Tidak ada switch preview.
8. **BakpauWA tidak diklaim aktif.** Boundary yang disiapkan hanya fungsi murni +
   service boundary `submitLean`/`closeRequestRemaining` yang bisa dipanggil konektor
   kelak; tidak ada integrasi WhatsApp.

---

## 5. File yang berubah

Baru:
- `modules/requests/leanRequest.js`
- `modules/requests/submitLean.js`
- `modules/requests/fulfillment.js`
- `modules/requests/suggest.js`
- `scripts/lean-admin-test/{run.py,compile_sandbox.mjs,mock.mjs,logic_test.mjs,render_test.mjs,viewport_test.mjs}`
- `scripts/lean-admin/{schema_probe.mjs,live_schema_probe.mjs,live_status_probe.mjs,build_smoke.sh}`
- `docs/lean-request-contract.md`

Diubah:
- `modules/requests/view.jsx` (label, tab, aksi kirim/tutup, baris pemenuhan, strip penanda)
- `modules/requests/form.jsx` (blok saran vendor)
- `modules/requests/save.js` (pertahankan penanda saat edit; pesan sukses)
- `modules/shared/filterRows.js` (tab LEAN vs SUBMITTED_LEGACY)
- `components/CreateModal.js` (suggestVendorsForItem, strip penanda di prefill)
- `components/ModuleView.js` (prop `onCloseRemaining`, ctx `allReceivingItems`)
- `pages/index.js` (finishPr → submitLean utk non-REJECTED, closePrRemaining)
- `pages/__smoke.js` (fixture lean + realisasi parsial)
- `styles/globals.css` (badge-lean/badge-legacy, pr-fulfil-note, tombol lean, sentuh ≥44px)
- `scripts/fase2-save-test/run.py`, `scripts/pr-estimate-sync-test/test_viewports.mjs` (dependensi/assertion)

Tidak disentuh: auth/RLS, live DB, Finance/Planning/analytics, profil/skill Bakpau,
preview port 3001, main/fe9862c.
