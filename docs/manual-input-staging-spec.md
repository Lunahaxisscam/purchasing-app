# Input Manual Terkontrol: Template + Dry-Run Staging (t_0bb833f1)

Status: **siap pakai utk dry-run; apply belum diaktifkan** (menunggu keputusan
DAT + tooling apply approved). Bagian simplifikasi blueprint
`purchasing-master-database-blueprint.md` yang jadi ruang lingkup dokumen ini:
ownership MASTER/PR dan persiapan input manual terkontrol. Ini **bukan**
migrasi, bukan sync dua arah, dan tidak pernah menulis database.

## 1. Simplifikasi scope MASTER→PR (ringkasan keputusan yang SUDAH jalan)

Blueprint menyederhanakan alur: PR wajib bersumber master project/material/vendor.
Bagian yang sudah diimplementasi task sebelumnya dan **tidak diulang** di sini
(reuse, bukan reimplement):

| Kebutuhan blueprint | Yang sudah ada | Di mana |
|---|---|---|
| Pilih barang dari master material (bukan ketik bebas) | Pemilih katalog + filter kategori × search | `modules/requests/form.jsx` (t_ac0b39c0) |
| Kategori canonical autofill | `supplier_category` item = kategori master material saat item ditambahkan | `components/CreateModal.js` `addItemToPR` (t_ac0b39c0) |
| Vendor multicategory eligible | Resolver membaca scalar existing **dan** array bila skema disetujui; eligible = kategori material ∈ salah satu kategori aktif vendor | `modules/requests/estimator.js` `vendorActiveCategories`/`isVendorEligible` (t_ac0b39c0) |
| Price autofill valid source | Resolver acuan HISTORIS (aktual terverifikasi) → MASTER → PR_ESTIMATE (fallback berbadge) → kosong "Belum ada acuan" (tidak pernah 0 palsu) | `modules/materials/acuan.js` + `estimator.js` (t_090127ad, t_e88c28fb) |
| Actual ≠ estimated | Label HISTORIS hanya utk harga aktual terverifikasi; `pr_items.estimated_price` yang diterima tampil sebagai PR_ESTIMATE | `docs/pr-estimasi-policy.md`, `docs/material-acuan-policy.md` (t_e88c28fb) |
| Source labels + snapshot | Badge sumber di form; harga tersimpan = snapshot (reopen tidak recalc) | `docs/pr-estimasi-policy.md` (t_ac0b39c0) |
| No duplicate entry (form) | Item material sama di form PR → qty ditambah, tidak dobel baris | `CreateModal.addItemToPR` |
| No duplicate entry (save boundary) | Validasi qty/harga/vendor-eligible SEBELUM tulis DB | `modules/requests/save.js` (t_ac0b39c0) |

**Source customer CRM once → RAB/invoice** adalah desain handoff task database
`t_03b41644` (schema owner tunggal reviewer_resek) — di luar task ini; file
BOQ/sales milik reviewer tidak disentuh. Tabel `customers` belum ada; template
project di sini memakai `customer_note` teks bebas dan TIDAK memalsukan FK.

## 2. Posisi alat: satu jalur masuk, staging murni

```
master snapshot (read-only export)
        │
        ▼
[validate.py]  DRY-RUN  ──►  report.json + plan.json  (INTENDED, bukan applied)
        │                          │
        │                 review konflik + approve admin
        │                          ▼
        │                 apply transaksional (tooling approved TERPISAH,
        │                 batch explicit — BELUM ADA, menunggu DAT)
        │                          ▼
        │                 readback reconciliation + log batch
```

Validator (`scripts/manual-input-staging/validate.py`, stdlib murni):

- **Tidak ada koneksi DB, tidak ada jaringan, tidak ada write ke luar
  folder output.** `apply_blocked` hard-coded — ini desain, bukan
  keterbatasan sementara (guard test: `test_no_db_write`).
- Baris hilang dari Sheet **bukan** perintah hapus database (tidak ada
  jalur delete). Koreksi posted event = reversal, bukan hard-delete.
- Retry aman: baris identik dengan master → `SKIP_UNCHANGED`, plan kosong;
  idempotensi per `external_ref` — bukan append buta.

## 3. Template CSV (`scripts/manual-input-staging/templates/`)

Lima file, **header saja tanpa contoh data** (tidak ada baris dummy yang
bisa terlihat seperti data nyata — guard test `test_templates_blank`).
Kolom universal di semua entitas:

| Kolom | Wajib | Isi |
|---|---|---|
| `record_id` | utk UPDATE | ID master yang ada; **kosong = INSERT baru**. Tidak boleh menebak — dicocokkan ke snapshot. |
| `external_ref` | selalu | Identitas stabil baris input (idempotensi retry, dedupe batch) |
| `source_file_id` | utk nilai moneter | File/nota sumber (Drive file id dkk.) — provenance historis tidak ditebak |
| `source_row` | utk nilai moneter | Baris/halaman sumber |
| `notes` | opsional | Catatan bebas |

| Entitas | Kolom khusus | Kunci dedupe | Status skema |
|---|---|---|---|
| `projects.csv` | `project_code`, `name`, `status` (NOT_START/ON_GOING/DONE), `customer_note` | `project_code` | existing (tabel `projects`) |
| `vendors.csv` | `name`, `phone`, `store_link`, `supplier_category`, `contact` | `name` | existing (tabel `vendors`, kategori scalar) |
| `materials.csv` | `kode` (opsional), `name`, `category`, `satuan`, `harga_acuan`, `current_stock`, `min_stock` | `name`+`category` | existing (tabel `materials`) |
| `vendor_categories.csv` | `vendor_name`, `category` | `vendor_name`+`category` | **PENDING** — usulan `vendor_categories` |
| `price_references.csv` | `material_kode`, `price`, `price_date` (YYYY-MM-DD), `vendor_name` (ops.) | `material_kode`+`price_date` | **PENDING** — usulan `material_price_refs` |

Kategori yang diterima = kategori kanonik master (`lib/constants.js`
`MATERIAL_KODE_PREFIXES` + `snapshot.categories`); drift prefix dijaga test
`test_kode_prefix_match_js`. **Tanpa delimiter hack** utk multi-kategori —
satu vendor banyak kategori hanya lewat `vendor_categories.csv` setelah
skema disetujui; resolver aplikasi sudah kompatibel array.

## 4. Hasil validasi — status per baris

| Status | Arti |
|---|---|
| `PLAN_INSERT` | Baris valid, kunci belum ada di master → masuk plan apply |
| `PLAN_UPDATE` | `record_id` cocok master, ada perubahan nilai → masuk plan |
| `SKIP_UNCHANGED` | Nilai identik master → tidak masuk plan (retry idempoten) |
| `PLAN_STAGING` | Baris valid tapi tabel tujuan belum disetujui (schema pending) |
| `REJECTED` | Ditolak dengan alasan per baris — tidak pernah masuk plan |

Penolakan utama: mandatory ID tidak resolve ke master; nilai moneter tanpa
`source_file_id`/`source_row`; harga negatif/parenthesis/desimal (semantik
sama dengan `validatedPrice` aplikasi — `-5` tidak pernah diam-diam jadi 5);
`kode` material tidak cocok prefix kategori; kategori non-kanonik;
`external_ref`/kunci duplikat dalam batch; **CONFLICT** = INSERT intent ke
kunci yang sudah ada di master (diperiksa manusia, bukan update senyap);
tanggal bukan ISO; `record_id` tidak cocok master.

Peringatan (tidak menolak): stok diisi sebelum cutover disepakati; satuan
beda dengan master (resolver tidak memakai entri lintas satuan); phone
berisi huruf (telepon = teks); schema drift snapshot vs validator.

## 5. Reconciliation & batch

- `report.json` per batch: hitungan per status, total moneter input vs
  planned (control sum — bukan event tambahan), sha256 file input, versi
  skema snapshot (drift terdeteksi sebagai WARNING), `batch_id`.
- Exit code: `0` bersih / `1` ada REJECTED / `2` salah pakai / `3` reserved.
- Plan menandai `requires: admin_approve + approved_batch_flag +
  transactional_apply_tooling` — tidak ada batch approved = tidak ada apply.
- Tidak ada import produksi tanpa batch yang disetujui eksplisit DAT.

## 6. Pemakaian

```bash
# snapshot master (read-only export JSON) + CSV terisi dari template
python3 scripts/manual-input-staging/validate.py \
  --entity vendors \
  --input  /path/staging_vendors.csv \
  --master /path/master_snapshot.json \
  --out    /path/output --batch-id B-20261017-01
```

## 7. Batasan (apa yang TIDAK dilakukan task ini)

1. **Tidak menulis DB / tidak ada SQL mandiri.** Schema owner tunggal
   reviewer_resek (t_03b41644); `vendor_categories`/`material_price_refs`
   hanya PLAN_STAGING sampai migrasi approved ada.
2. **Tidak ada sync dua arah.** Satu jalur masuk; Sheet bukan UI edit live.
3. **Tidak ada import produksi.** Apply menunggu tooling approved terpisah.
4. **Tidak menyentuh** BOQ/sales/customer (handoff t_03b41644),
   `lib/workflow.js`, shell core, atau file milik reviewer.
5. **Tidak ada data dummy** di luar fixture test — semua fixture
   `[CONTOH]`, template kosong.

## 8. Test

```bash
python3 scripts/manual-input-staging-test/run.py   # 73 check, sandbox /tmp
```

Mencakup: guard drift prefix vs `lib/constants.js`; template kosong;
mandatory IDs; evidence moneter; duplikat & CONFLICT; enum status;
SKIP_UNCHANGED idempoten; schema drift warning; PLAN_STAGING schema-pending;
tanpa jalur tulis DB di validator.
