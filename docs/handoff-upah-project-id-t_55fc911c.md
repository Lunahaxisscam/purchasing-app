# Handoff — Upah & Kasbon: Project ID pada proyek (v2)

Kartu: `t_55fc911c` · Worktree: `/home/ubuntu/dev-workspaces/purchasing-upah-kasbon-projectid/.worktrees/t_55fc911c`
Branch: `wt/t_55fc911c` · Basis: `abf7b44` (source PLAYFIELD 25 Okt 2026)
Status: **kode + test selesai; migrasi masih DRAFT menunggu approval DAT.**

---

## 1. Yang dikerjakan

### 1.1 Selector Project ID (form tambah/edit proyek)

`public/upah-kasbon-prototype.html`

- Form List Proyek kini punya `<select id="pProjectId">` berisi master `projects`
  (read-only): `[kode] nama — status`. Opsi pertama `— Belum terhubung —`.
- Form dipakai untuk **tambah DAN edit**. Tombol **Edit** ada di baris proyek aktif
  maupun arsip (tidak muncul untuk proyek yang sudah masuk totalan final).
- Hint di bawah selector menampilkan **UUID master** + status master, atau
  peringatan bila tautan tidak ada di daftar master yang termuat.
- Saat menambah proyek baru dan nama masih kosong, memilih Project ID mengisi nama
  dari master (kemudahan input). Nama tetap **snapshot** yang bisa diubah admin.
- List proyek dapat kolom **Project ID (master)**; detail proyek menampilkan
  tautan + status master.

### 1.2 State & persistensi

`public/upah-kasbon-sync.js`

| State (`state.projects[]`) | DB (`upah_projects`) | Catatan |
|---|---|---|
| `projectId` | `project_id` (UUID) | **relasi utama** ke `public.projects(id)` |
| `name` | `project_name` | **snapshot historis**, tidak dipakai mencocokkan |

- `stateFromDb()` membaca `project_id -> projectId` (null bila kolom belum ada).
- `rowProject()` menulis `project_id` saat tautan dipilih dan menulis `NULL` saat
  tautan dilepas. Proyek **tanpa** tautan tidak mengirim kolom `project_id`, jadi
  database yang belum menjalankan migrasi draft tetap bisa menyimpan proyek lama.
- Perbandingan diff `planPersist()` diperbaiki: `upah_projects.project_id` **bukan**
  id sementara, jadi sekarang ikut dibandingkan. Tanpa ini, mengubah tautan saja
  tidak pernah menghasilkan operasi `update`.
- `executeOps()` tidak me-resolve `upah_projects.project_id` lewat `idMap`
  (idMap hanya untuk id sementara tukang/proyek upah).
- `assertFinalHistoryImmutable()` ikut mengunci `projectId` untuk proyek yang
  masuk totalan final.
- Fungsi baru `fetchMasterProjects(client)`: baca `projects` (`select('*')`),
  urut nomor proyek, **fail-soft** (gagal baca = `{ok:false}` + pesan, modul
  tetap jalan; tautan lama tidak dihapus).

### 1.3 Data lama tanpa Project ID

- Ditandai badge **Belum terhubung** di list + detail.
- Ringkasan di atas tabel: “N proyek Belum terhubung ke master Projects”.
- **Tidak ada penebakan otomatis** dari nama. Proyek bernama persis sama dengan
  proyek master tetap “Belum terhubung” sampai admin memilih manual.
- Tautan tersimpan yang tidak ada di daftar master (mis. RLS gagal / baris master
  dihapus) **tidak dihapus diam-diam**; ditampilkan sebagai “master tidak termuat”.

### 1.4 Kontrak database (DRAFT, belum dijalankan)

`migrations/2026-10-25_upah_projects_project_id.DRAFT.sql`

Hasil review `migrations/2026-10-24_upah_kasbon_master.sql`: kolom `project_id`
dan FK `ON DELETE SET NULL` **sudah ada** di `CREATE TABLE` (baris 47). Yang belum
tertutup adalah database lama (tabel sudah terlanjur dibuat), index, dan kontrak
agregasi. Draft (aditif + idempotent) berisi:

1. `add column if not exists project_id uuid`
2. FK `upah_projects_project_id_fkey` ke `public.projects(id)` bila belum ada
   (`NOT VALID` lalu `VALIDATE` — orphan membuat transaksi rollback, bukan data rusak)
3. index `upah_projects_project_id_idx`
4. komentar kolom (dokumentasi kontrak)
5. view `v_upah_project_actual` — total upah **aktual** per `master_project_id`
   (`total_manual` menimpa `SUM(upah_rincian)`, sama dengan aturan modul),
   `security_invoker = true`
6. view `v_upah_project_unlinked` — daftar kerja proyek yang belum tertaut
7. query diagnostik read-only (orphan, tautan ganda, kandidat nama **untuk review**)

**Tidak dijalankan ke database live. Tidak ada perubahan data Supabase.**

### 1.5 Kesiapan Project Finance

- `upah_projects.project_id` + `v_upah_project_actual` cukup untuk agregasi
  berbasis `project_id` (bukan nama).
- `components/ProjectFinance.js` **tidak diubah** — kalkulasi lama (yang masih
  memakai `tukang_projects` hasil sync Sheets) tidak rusak. Penyambungan
  Project Finance ke `upah_*` adalah tiket lanjutan setelah migrasi disetujui.

---

## 2. File berubah

```
public/upah-kasbon-prototype.html                     (selector, edit proyek, badge, lock totalan final)
public/upah-kasbon-sync.js                            (project_id dua arah, fetchMasterProjects, diff fix)
migrations/2026-10-25_upah_projects_project_id.DRAFT.sql   (BARU — draft, belum dijalankan)
scripts/upah-kasbon-test/project_link_ui_test.cjs      (BARU — 28 assertion)
scripts/upah-kasbon-test/project_link_sync_test.cjs    (BARU — 27 assertion)
```

Perbaikan kecil yang ikut (ditemukan saat test, sudah rusak di baseline):

- `fileImport` listener tanpa guard membuat script berhenti sebelum `bootMaster()`
  saat prototipe dibuka standalone (header demo/impor tidak dirender di app).
  Sekarang `?.` — modul boot normal.
- Tombol hapus totalan **final** masih tampil di UI (padahal sync menolak).
  Sekarang final = badge “Dikunci”, hapus massal dinonaktifkan, dan handler
  menolak hapus totalan final. Ini membuat 2 test lama (`historical_lock_ui_test`,
  `lock_totalan_test`) yang gagal di baseline menjadi hijau.

---

## 3. Hasil test

Semua dijalankan di worktree, tanpa jaringan/Supabase.

| Test | Hasil |
|---|---|
| `project_link_ui_test.cjs` (baru) | **31 lulus, 0 gagal** |
| `project_link_sync_test.cjs` (baru) | **27 lulus, 0 gagal** |
| `historical_lock_ui_test.cjs` | 8 lulus, 0 gagal (baseline: 7/1) |
| `lock_totalan_test.cjs` | 11 lulus, 0 gagal (baseline: 10/1) |
| `lock_totalan_sync_test.cjs` | 11 lulus, 0 gagal |
| `sync_store_test.cjs` | 50 lulus, 0 gagal |
| `tukang_name_test.cjs` | 23 lulus, 0 gagal |
| `inject_test.cjs` | 4 lulus, 0 gagal |
| `render_test.cjs` | 9/9 lulus |

Cakupan test baru:

- selector memuat kode/ID + nama + status master (83/99/100),
- edit proyek → pilih Project ID → state + `localStorage` menyimpan `projectId`,
  dan bertahan setelah `loadState()`,
- lepas tautan eksplisit → `projectId` null → kembali “Belum terhubung”,
- proyek tanpa link tetap “Belum terhubung” (termasuk nama yang sama persis
  dengan master) dan tidak berubah saat proyek lain diedit,
- daftar master gagal dimuat → tautan lama utuh,
- sync: mapping dua arah, update hanya-tautan, lepas tautan = `NULL`,
  kompatibilitas DB pra-migrasi, lock totalan final, `project_id` tidak di-resolve
  sebagai id sementara.

Build: `npm run build` → **✓ Compiled successfully**, 5/5 static pages, tanpa error.

Catatan: `schema_test.sql` (uji skema ke database) **tidak dijalankan** karena
butuh database live dan migrasi belum disetujui.

---

## 4. Risiko & catatan

1. **Migrasi belum dijalankan.** UI sudah mengirim `project_id` saat tautan dipilih.
   Bila kolom belum ada, insert/update proyek **dengan tautan** akan gagal
   (error Supabase tampil di banner). Proyek tanpa tautan tetap aman.
   → Jalankan draft migrasi setelah approval, sebelum modul dipakai menautkan.
2. **Master `projects` dibaca read-only** dengan `select('*')`. Bila RLS menolak,
   selector kosong + pesan; modul tidak crash dan tautan lama tidak hilang.
3. **Satu master project boleh dipakai beberapa proyek upah** (beda tukang/tahap).
   Tidak ada unique constraint; query diagnostik (c) disediakan bila DAT ingin
   aturan lain.
4. **Nama proyek masih bisa diedit** (snapshot). Untuk proyek yang sudah masuk
   totalan final, seluruh field termasuk `projectId` dikunci.
5. **Project Finance belum memakai `upah_*`.** Kontrak data sudah siap, tetapi
   penyambungan kalkulasi adalah tiket terpisah agar angka existing tidak berubah.
6. Legacy/localStorage: `projectId` ikut tersimpan di JSON state v2 (tanpa migrasi
   versi baru). Data lama otomatis `null` → “Belum terhubung”.

---

## 5. Cara verifikasi manual (setelah migrasi disetujui)

1. Buka modul **Upah & Kasbon** sebagai admin.
2. Tab **List Proyek** → klik **Edit** pada proyek lama → pilih **Project ID**
   (`[kode] nama — status`) → **Simpan Perubahan**.
3. Badge baris berubah dari “Belum terhubung” menjadi `[kode] nama · status`.
4. Muat ulang halaman → tautan tetap ada (dibaca dari `upah_projects.project_id`).
5. Proyek yang dibiarkan tanpa Project ID tetap “Belum terhubung”.
6. Cek di SQL: `select id, project_name, project_id from upah_projects;`
   dan `select * from v_upah_project_actual;`
