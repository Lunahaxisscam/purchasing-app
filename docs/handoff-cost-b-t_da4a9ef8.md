# Handoff Tahap B — Integrasi Cost per Proyek (t_da4a9ef8)

Branch: `feat/project-cost-link` · Worktree: `/home/ubuntu/dev-workspaces/purchasing-project-cost-link`
Base: `ce8d132` → FF Tahap A `4d36b44` → merge Bit `d2c9ba6` (impl `3b6ca2a`) → merge Bandeng `6d8b3e9` (seri `7502f40`+`08a33fb`)
Commit integrasi: **`7e4b4ef`** (lihat `git log --oneline -4`)

Status: **kode + build + tes targeted hijau; staging 3001 diswitch ke build immutable baru.**
Konektor/ledger/DDL/transaksi finansial live **TIDAK diaktifkan** (lihat §6).

---

## 1. Yang benar-benar dikerjakan

### 1.1 Tiga regresi VERIFICATION_A (wajib, helper Tahap A)
| # | Masalah asli | Perbaikan di `lib/projectCrosswalk.js` |
|---|---|---|
| 1 | `costNoteKey('A-12') === costNoteKey('A1-2')` dipakai sebagai identitas | `costNoteKey` sekarang **eksplisit kandidat saja**; identitas baru `noteIdentity({rawRef, channel, source, vendorId, purchaseId})` mempertahankan literal mentah + namespace kanal + vendor. `noteCandidateMatches()` mengembalikan `fuzzy_only` (laporan) bukan merge. |
| 2 | `reconcileCostSources` membuang alokasi proyek kedua saat kunci sama | Ditulis ulang: semua baris app disimpan (array, bukan Map terakhir-menang), alokasi per proyek (`allocations[]`) dipertahankan, konflik ditandai (`note_key_collision`, `fuzzy_ref_only`, `source_total_mismatch`, `allocation_only_in_sheet`, `app_note_allocation_mismatch`). |
| 3 | Master `kode 83 / code 99` konflik tapi `resolveProject('83')` tetap `matched` | `buildProjectIndex` membangun `conflictsByKode`/`conflictsById`; `resolveProject` **fail closed** → state `identity_conflict`, `projectId: null` (juga untuk jalur alias). |

Bukti RED→GREEN: `scripts/project-data-map-test/regression_integrator.mjs` (15 cek) dijalankan
terhadap helper LAMA (`git show 4d36b44:lib/projectCrosswalk.js`) → **GAGAL** pada R2a/R2b/R2c/R2d/R2f/R3a/R3c
(persis tiga temuan Brooklyn), lalu **HIJAU** setelah perbaikan.

### 1.2 Satu boundary tulis untuk admin + konektor (G7)
`modules/receivings/purchaseSave.js`:
- `savePurchaseWithClient({client, form, ...})` = satu-satunya jalur tulis nota (validasi, anti-duplikat
  vendor+nomor nota, pemakaian ulang cangkang PR, header+baris, readback alokasi).
- `savePurchase(args)` = pembungkus tipis (`client: supabase`) → perilaku admin tidak berubah.
- Opsi kanal: `headerNoteSuffix`, `lineNoteSuffixes`, `shellReceivingId`, `projectIdOverride`,
  `prIdOverride`, `queueHandover` (admin true, konektor false), `internalRefPrefix` (PH/BK).
- `lib/bakpau/purchaseAdapter.js`: mapper kolom duplikat **DIHAPUS**, `writePurchase` kini mendelegasikan
  ke boundary bersama; konektor hanya menambahkan jejak asal-usul + `queueHandover:false`.
- Temuan saat uji: konektor tidak membawa baris cangkang di memori → boundary sekarang membaca
  `receiving_items` header yang dipakai ulang (kalau tidak, baris qty 0 terduplikasi). Ini O19/O20
  yang sempat merah lalu hijau.

### 1.3 Approval OFF: jalur maintenance ikut dipagari
`pages/api/seed-simulation.js`: `approvalGuard('seed-simulation')` dipanggil **sebelum** `createClient`
dan sebelum operasi tabel apa pun → HTTP 409 `APPROVAL_OFF`, **nol** tulis/hapus `approval_steps`,
nol panggilan RPC/alert. Token maintenance sah TIDAK membuka approval.
Regresi: `scripts/approval-off-test/seed_guard_test.mjs` — 12 cek, termasuk kontrol (flag dihidupkan di
salinan sandbox → jalur `approval_steps` memang ada, jadi yang menghentikan adalah kebijakan, bukan import rusak).

### 1.4 Breakdown cost per proyek (B1/B2)
`lib/projectCostBreakdown.js` (murni, tanpa DB/React) memakai kontrak A:
- identitas via **nomor proyek**; baris upah tanpa nomor/alias terkonfirmasi → ember
  `unmappedLabor` (bukan dipinjamkan ke proyek bernama mirip, bukan 0);
- identitas konflik → ditahan;
- material = nota `DIBELI` + barisnya, dialokasikan **per baris/qty** (`allocateNoteByItems`), total header
  tidak ditempel; baris tanpa proyek → `unassignedMaterial`; baris tanpa harga → gap, tidak dihitung 0;
- upah = hak tercatat (`laborSettlement`), kasbon/pelunasan **tidak** menambah biaya; saldo per proyek
  `null` + alasan (pembayaran di sumber bersifat per tukang) — bukan Rp 0;
- PROJECT SUMMARY hanya pembanding; revenue/rasio/margin **tidak** dihitung (HOLD).

UI: `components/ProjectFinance.js`
- aktual upah proyek kini di-resolve lewat **nomor** (sebelumnya `actualLaborForProject(rows, project.name)`
  → pada data nyata gagal karena "Proyek Josh - Mabes" vs "Josh - Mabes");
- tab Material menampilkan panel **"Rincian Cost Aktual — nota per proyek"** (nota/vendor/tanggal/baris/
  alokasi vs total nota) + panel **"Celah data breakdown"**.

### 1.5 Konsolidasi menu Stok → Material (B3)
- `lib/constants.js`: `STOCK_MENU_CONSOLIDATED=true`, `STOCK_MENU_TARGET='materials'`, `navAliasFor()`;
  `isModuleVisible('stock')` → false (menu hilang dari sidebar desktop+mobile).
- `pages/index.js`: semua navigasi lewat `goTo()` yang mengalihkan `stock` → `materials` + notice
  ("menu digabung, tidak ada data yang dihapus"). Rute lama tidak crash.
- `components/Dashboard.js`: kartu `stock` diberi label "Stok (di Material)".
- Entri katalog/registry/komponen `modules/stock/view.jsx` **tetap ada** (reversible, masih dirender
  di `/__smoke`); tidak ada tabel/kolom/baris yang dihapus. `materials.current_stock`, batas minimum,
  banner BHP, acuan harga, ekspor, riwayat serah terima tidak berubah.

---

## 2. Bukti uji (dijalankan di tree terintegrasi)

| Suite | Hasil |
|---|---|
| `scripts/project-data-map-test/run.py` (A 36 + regresi B 15) | **51 pass, 0 fail** |
| `scripts/project-cost-link-test/run.py` (breakdown K1–K10) | **10 pass, 0 fail** |
| `scripts/bakpau-connector-test/run.py` | **321 + 45 = 366 pass, 0 fail** (mapper duplikat dihapus, tetap hijau) |
| `scripts/approval-off-test/run.py` (logic 84 + render 31 + static 65 + seed-guard 12) | **192 pass, 0 fail** |
| `scripts/integration-test/wiring_test.mjs` | **67/67** |
| `scripts/purchase-flow-test/run.py` | 218 + 103 pass, 0 fail |
| `scripts/lean-admin-test/run.py` | 38 + 105 pass, 0 fail |
| `scripts/fase2-save-test/run.py` | 56 pass, 0 fail |
| `npm run build` (flock `/home/ubuntu/dev-workspaces/.purchasing-build.lock`) | **exit 0**, BUILD_ID `IsyQ1GHDQrxXQ6vnDTieJ` |

Kegagalan pre-existing (stash-verified oleh Bit, bukan dari perubahan ini): `s7-compact-test` (CSS duplikat),
`rab-boq-render-test` F1/F2. Tidak diperbaiki di kartu ini.

---

## 3. Staging (yang DAT lihat)

- Release immutable: `/home/ubuntu/dev-workspaces/purchasing-cost-b-release-20261020-1728`
- Manifest: `state/release-manifest.json` → `build_id=IsyQ1GHDQrxXQ6vnDTieJ`, `source_commit=7e4b4ef`
- Switch script: `scripts/integration-test/switch_cost_b_staging.sh` (snapshot rollback + auto-rollback)
- Readback nyata:
  - `GET /` = **200**, `html_build_id_hits=1` (BUILD_ID benar-benar disajikan)
  - chunk `_app-*.js` = **200**, listener `next-server` pid 694912 di `*:3001`
  - `GET /api/sales-invoices` = **401** (auth guard utuh)
  - `POST /api/seed-simulation` = **403** (endpoint maintenance tertutup: token tidak diset; kalau diset
    pun akan 409 APPROVAL_OFF)
  - `GET /__smoke` = **404** (ENABLE_SMOKE tidak aktif di proses ini) — halaman diagnostik, bukan UI user
- Rollback: `state/before-*.json` menyimpan cwd + BUILD_ID lama (`purchasing-lean-c-release-20261020-055948`,
  `J5CFfVZgrqBwDQakH0DvK`).

**Label untuk reviewer:** preview ini = kode integrasi terbaru, tetapi datanya **data aplikasi existing**
(bukan transaksi uji baru). Simpan nota / konektor / DDL / migrasi **TIDAK aktif** di preview ini.

Catatan ketepatan: rilis yang disajikan dibangun dari commit **`7e4b4ef`**. Commit setelahnya hanya
menyesuaikan EKSPEKTASI TES (jumlah item sidebar kini dihitung dari kebijakan 21−approval−stok),
tidak mengubah kode aplikasi yang disajikan.

---

## 4. Yang TIDAK diklaim
- Konektor Bakpau **belum aktif**: transport Telegram/WA live, ledger (`bakpau_events`), dan webhook
  tetap UNVERIFIED/tidak dipasang. Migrasi `migrations/2026-10-21_bakpau_connector_ledger.sql` masih DRAFT,
  **tidak di-apply**.
- Trigger/RPC DB (telegram_send_pr_alert, ensure_item_in_purchase, cleanup_unreceived_purchase) tetap
  **UNVERIFIED** — flag aplikasi tidak mematikan trigger DB; tidak ada DDL/grant yang diubah.
- Foto nota (OCR) belum ada; lampiran hanya referensi.
- Upah: baris yang tidak punya nomor & tidak punya alias terkonfirmasi masuk ember "belum terhubung" —
  perlu pengisian nomor/alias di sumber oleh finance (63 baris not_found + 34 nomor legacy + 20 baris
  tanpa nomor dari audit A). Breakdown menampilkannya, tidak menebak.
- Tujuh skenario Novi–Bakpau belum aktif sebagai integrasi; kontrak kunci nota/item dari A + adapter
  yang sudah lulus harness adalah fondasinya.
- Revenue, rasio cost/revenue, margin final, dan dashboard finance penuh: **HOLD**.

## 5. Arah final DAT (dicatat, belum dieksekusi)
Supabase **cloud** = sumber data kanonik (bukan self-host di VPS agen), backup harian terenkripsi ke
Google Drive PLAYFIELD (`Database Purchasing/Backups`), alert backup ke Telegram DAT.
Backup/restore, `pg_dump`, enkripsi, jadwal WIB, retensi: **belum diverifikasi / belum aktif**;
`t_03b41644` tetap access/tooling-blocked. Tidak ada instalasi Supabase di VPS, tidak ada repoint env,
tidak ada DDL/migrasi/cutover dari kartu ini.

## 6. Kebutuhan skema untuk target final (usulan, bukan DDL yang dijalankan)
1. `receivings`: unique index `(vendor_id, invoice_no)` (anti-duplikat nota di level DB, saat ini
   dicegah aplikasi) + kolom eksplisit `source_channel`/`external_event_id` (bukan hanya marker di `note`).
2. `receiving_items`: harga satuan kolom nyata (`unit_price`) + `project_id` NOT NULL-opsional terindeks;
   saat ini harga dititipkan di teks `[Harga: n]` dan proyek per baris hanya di `note` untuk kanal konektor.
3. `tukang_projects`: **`project_no`** (nomor proyek sumber) + `source_row_id` — akar masalah join nama;
   daemon `tukang_upah_sync.fetch_list_proyek` harus ikut membawa kolom A.
4. Tabel ledger idempoten kanal (`bakpau_events`) — draft ada, belum di-apply.
5. View/report: agregasi material harus per baris-nota (bukan total header), upah = hak tercatat,
   pembayaran terpisah; estimasi PR/RAP/WBS **tidak** boleh masuk kolom aktual.
