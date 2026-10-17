# Kontrak RAP Internal (Rencana Anggaran Pelaksana) — versi minimum

**Task:** `t_71d95cfe` (S3/7) · **Pemilik:** bamboo-tech
**Status:** modul berdiri sendiri (`modules/rap/`), **belum di-wire** ke shell
**Penyimpanan:** `DRAFT_ONLY` (tidak ada tabel, tidak ada RPC, tidak ada migrasi)

---

## 1. Apa yang dibangun, dan apa yang TIDAK

| Ada | Tidak ada (dan tidak diklaim ada) |
|---|---|
| Halaman RAP: pilih proyek, buat draft dari acuan RAB, edit qty & harga satuan **rencana**, label versi, status versi, perbandingan RAB vs RAP, pemeriksaan draft, backup/pulihkan JSON | Tabel `rap_versions` / RPC penyimpanan / migrasi |
| Sumber acuan: **JSON RAB & BOQ** (tempel/impor) dan **WBS Budgeting** (baca-saja) | Penyimpanan server, autosave, localStorage-as-DB |
| Handoff PR: **payload** berbentuk kontrak PR existing (ditampilkan, bukan dikirim) | Pembuatan PR dari RAP, penomoran PR, penulisan DB |
| Logika murni teruji (`model.js`, `budgetingBridge.js`, `store.js`) | Klaim "realisasi/aktual" atas angka rencana |

Alasan: migrasi sedang **dibekukan** dan belum ada tabel RAP. Karena itu modul
memilih mode **draft-only eksplisit** — bukan menyimpan ke tempat lain lalu
mengaku tersimpan.

---

## 2. File & tanggung jawab

| File | Isi | Boleh menulis DB? |
|---|---|---|
| `modules/rap/model.js` | Logika murni: konversi harga RAB, baris, total, selisih, validasi, transisi status, kontrak handoff PR, snapshot JSON | **Tidak** (tidak mengimpor Supabase) |
| `modules/rap/budgetingBridge.js` | Jembatan **baca-saja** ke RAB & BOQ (payload JSON) dan Budgeting (`project_plans`) | **Tidak** (satu `select`, tanpa rpc/insert/update) |
| `modules/rap/store.js` | Store sesi (`DRAFT_ONLY`) + jejak `writes` yang harus selalu kosong | **Tidak** |
| `modules/rap/view.jsx` | Halaman React (styled-jsx ter-scope, tanpa override global) | **Tidak** |
| `scripts/rap-test/*` | Harness: unit (logika) + render (jsdom interaktif) + e2e (Chrome nyata) | — |
| `docs/rap-contract.md` | Dokumen ini | — |

Tidak ada file di luar `modules/rap/`, `scripts/rap-test/`, dan `docs/` yang
diubah — kecuali `pages/__rapbuildprobe.js` (probe build sementara, dijaga
`ENABLE_SMOKE=1`, lihat §7).

---

## 3. Model data (in-memory, satu draft)

```
rap = {
  id, version: 'RAP-01', status: DRAFT|DIAJUKAN|DISETUJUI|DITOLAK|DIGANTIKAN,
  project_id, project_name, project_kode,
  rab_reff, rab_revision, rab_source, rab_price_unit,
  rab_lines: [ line... ],   // SNAPSHOT acuan RAB (tidak ikut berubah)
  lines:     [ line... ],   // baris RENCANA yang diedit
  history:   [ { at, action, status, by } ],
  persisted: false, persistence: 'DRAFT_ONLY',
  created_at, updated_at
}

line = {
  id, key (= nama|satuan), item_name, unit, area, specs,
  material_id, kode,
  rab_qty, rab_unit_price,          // ACUAN (rupiah penuh)
  planned_qty, planned_unit_price,  // RENCANA (diedit tim)
  price_source: RAB | RAB_TANPA_HARGA | WBS_UPAH | WBS_TANPA_UPAH | MANUAL
}
```

**Kenapa `rab_lines` dipisah dari `lines`:** kalau acuan diambil dari baris RAP
yang sedang diedit, menghapus satu baris akan ikut mengecilkan "nilai RAB" —
selisih jadi terlihat lebih kecil dari kenyataan. Snapshot mencegah itu, dan
baris RAB yang hilang muncul eksplisit sebagai **"Pekerjaan RAB yang belum ada
di RAP"**.

---

## 4. Angka & satuan (satu tempat konversi)

- RAB & BOQ menyimpan harga dalam **ribuan rupiah (000)** (`priceUnit:
  'thousand IDR (000)'`). RAP memakai **rupiah penuh**.
- Konversi hanya di `model.rabPriceToRupiah()` (× 1000, dibulatkan, diklem ≥ 0).
  Payload legacy `version: 1` tetap dibaca (harga sudah rupiah penuh).
- Perbandingan memakai **nilai dasar baris** (qty × harga satuan) — **bukan**
  total quotation RAB (yang sudah kena markup/PPN). RAP adalah biaya
  pelaksanaan, bukan harga jual ke klien; membandingkannya dengan grand total
  RAB akan menyesatkan.
- Input angka: `parseNumberInput` menolak minus/parenthesis secara eksplisit
  (bukan diam-diam jadi positif), menerima `1.500.000` dan `2,5`.
- Tanpa acuan RAB (`rabTotal = 0`): `diffPct = null` dan `overBudget = false`
  — selisih "tidak diketahui", **bukan** "lebih".

---

## 5. Perbandingan RAB vs RAP

`compareRapToRab(rap)` mengembalikan:

- `rows[]` — per baris: `rabAmount`, `rapAmount`, `diffAmount`, `diffPct`,
  `qtyDiff`, `priceDiff`, `state` (`OVER` / `UNDER` / `SAME`), `inRab`.
- `missingInRap[]` — pekerjaan RAB yang tidak ada di RAP (pekerjaan terlewat).
- `extraInRap[]` — baris RAP di luar RAB (lingkup tambahan).
- `summary` — `rabTotal`, `rapTotal`, `diffAmount`, `diffPct`, `overBudget`,
  `overCount`, `missingCount`, `extraCount`.

Pencocokan baris memakai `key = nama pekerjaan + satuan` (dinormalisasi),
karena RAB hanya payload JSON tanpa ID. Nama/satuan yang berbeda dianggap
baris berbeda — itu **disengaja**: lebih baik terlihat "hilang/tambahan" dan
diperiksa manusia daripada dicocokkan secara menebak.

---

## 6. Status versi

```
DRAFT ──▶ DIAJUKAN ──▶ DISETUJUI ──▶ DIGANTIKAN
             │
             └──▶ DITOLAK ──▶ DRAFT (revisi)
```

- Transisi lain **ditolak** dengan alasan terbaca (`transitionProblem`).
  Contoh: `DRAFT → DISETUJUI` ditolak — tidak ada loncat status.
- Setiap transisi menambah entri `history` (waktu, status, pelaku).
- **Penting:** status ini label kerja **internal**, bukan bukti persetujuan
  resmi di server. UI menyatakan itu setiap kali status diubah.

---

## 7. Kontrak handoff ke Purchase Request

`buildPrHandoff(rap, { line_ids?, project_id?, title?, priority? })` menghasilkan
payload yang **bentuknya sama** dengan jalur simpan PR existing
(`modules/requests/save.js`):

```
request = { project_id, title, pr_number: null, priority, status: 'DRAFT',
            materials_summary, notes }
item    = { material_id, item_name, kode, unit, quantity, status: 'PENDING_APPROVAL',
            supplier_category: null, vendor_id: null, estimated_price, sort_order }
```

Aturan yang dijaga:

1. `pr_number` **null** — nomor PR diambil dari RPC `next_pr_number` oleh modul
   PR saat benar-benar menyimpan. RAP tidak mengarang nomor.
2. `pr_id` **tidak ada** — nilainya baru ada setelah PR tersimpan. Ia diisi
   modul PR (`PR_ITEM_FIELDS_FROM_TARGET`).
3. `quantity` invalid (≤ 0) → **ditolak**, tidak diubah diam-diam jadi 1
   (berbeda dari shortcut Budgeting lama yang memaksa 1 — di sini angka rencana
   adalah kontrak, jadi harus diperbaiki).
4. Harga 0 → **peringatan**, item tetap disusun (PR boleh tanpa estimasi).
5. `meta.writes = 0`, `meta.delivered = false` — eksplisit: tidak ada
   penulisan dan tidak ada pengiriman.
6. `notes` menyebut asal versi RAP + RAB + **"RENCANA, bukan realisasi"**.

---

## 8. Wiring (SUDAH dikerjakan di branch ini)

RAP sudah terpasang sebagai halaman Admin Suite:

1. `lib/constants.js` — item `['rap', 'RAP (Rencana Pelaksanaan)']` di section
   Admin Suite, **tepat setelah Budgeting** (RAP membaca WBS dari sana), dan
   label di `labels`.
2. `modules/registry.js` — entri modul `source: 'core'`, `adminOnly: true`,
   dengan daftar `files` kepemilikan modul.
3. `pages/index.js` — import `RapModule` + cabang render `page === 'rap'`
   dengan guard `role === 'admin'` dan fallback "Halaman ini khusus
   administrator" (pola RAB & BOQ), plus `'rap'` dikecualikan dari tombol
   `↻ Perbarui` global.
4. `pages/__smoke.js` — section `#mod-rap` supaya build smoke ikut merender
   modul (error render tertangkap saat build).

Semua langkah di atas diverifikasi oleh `scripts/rap-test/wiring_test.mjs`
(44 assertion: menu, registry, guard render, pengecualian tombol refresh,
smoke, dan larangan menulis DB di seluruh file modul).

**Catatan kepemilikan:** file CORE tersebut milik Tech Lead (`docs/owners.md`).
Karena kartu ini dijalankan oleh `bamboo-tech` (yang juga Tech Lead di papan
ini) dan modul tidak bisa dipakai tanpa wiring, wiring dikerjakan di branch
yang sama dan **dinyatakan eksplisit** di laporan — bukan diselundupkan.
Assertion kepemilikan di `scripts/pr-purchase-compact-test/render_test.mjs`
diperluas keempat file CORE itu (bukan dilonggarkan untuk file modul S1/S2).

---

## 9. Usulan skema (BELUM dijalankan — butuh izin DAT)

Bila DAT mengizinkan migrasi, tabel minimum yang membuat RAP benar-benar
tersimpan:

```sql
-- USULAN, JANGAN DIJALANKAN TANPA IZIN
CREATE TABLE public.rap_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version text NOT NULL,                    -- 'RAP-01'
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','DIAJUKAN','DISETUJUI','DITOLAK','DIGANTIKAN')),
  rab_reff text,
  rab_revision text,
  rab_lines jsonb NOT NULL DEFAULT '[]',    -- snapshot acuan
  lines jsonb NOT NULL DEFAULT '[]',        -- baris rencana
  note text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id, version)
);
ALTER TABLE public.rap_versions ENABLE ROW LEVEL SECURITY;
-- RLS admin-only (pola project_plans) + GRANT authenticated
```

Yang **masih** harus diputuskan sebelum migrasi:
- Apakah `lines` cukup `jsonb`, atau perlu tabel `rap_lines` (untuk query
  variance per pekerjaan dan tautan `material_id`)?
- Apakah "Disetujui" perlu jejak approver (`approved_by`, `approved_at`) dan
  gate approval yang sama dengan `lib/workflow.js`?
- Apakah versi baru otomatis men-`DIGANTIKAN` versi lama (butuh transaksi/RPC)?

Tanpa jawaban itu, tabel di atas **belum aman** dijalankan.

---

## 10. Bukti verifikasi

| Harness | Cakupan | Hasil |
|---|---|---|
| `scripts/rap-test/run.py` → `unit_test.mjs` | 115 assertion: konversi harga, bridge RAB/WBS, selisih, validasi, status, kontrak PR, snapshot | hijau |
| `scripts/rap-test/run.py` → `render_test.mjs` | 66 assertion: render jsdom interaktif modul asli (impor JSON, edit qty/harga, hapus baris, status, payload PR, pulihkan JSON, nol tulisan DB) | hijau |
| `scripts/rap-test/run.py` → `wiring_test.mjs` | 44 assertion: menu Admin Suite, registry `source:'core'`+`adminOnly`, guard render, pengecualian tombol refresh, smoke, larangan insert/update/delete/rpc di seluruh modul | hijau |
| `scripts/rap-test/e2e_runtime_test.mjs` | 40 assertion di Chrome nyata (`/__smoke` → `#mod-rap`): banner terlihat, alur impor→edit→payload, 4 viewport tanpa overflow, target klik, nol request mutasi | hijau |
| `npm run smoke` | build + render semua modul (termasuk `#mod-rap`) | hijau |

Perintah:

```bash
python3 scripts/rap-test/run.py                 # unit + render + wiring (tanpa DB)
npm run smoke                                   # build
ENABLE_SMOKE=1 npx next start -p 3311           # server
node scripts/rap-test/e2e_runtime_test.mjs http://127.0.0.1:3311
```
