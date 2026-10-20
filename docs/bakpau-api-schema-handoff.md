# Schema gap & SQL handoff — API Bakpau (untuk Bandeng / t_2b8dcab3)

**Bukan instruksi apply.** Tidak ada DDL yang dijalankan oleh task ini.
Schema owner tetap Bandeng; gate backup produksi + isolated restore + review
belum terpenuhi (lihat `PG_ACCESS_CHECK.json` di `t_2b8dcab3`).

## 1. Gap yang menghalangi WRITE live

| Kebutuhan | Status di DB live | Bukti |
|---|---|---|
| `public.bakpau_events` (ledger idempotensi event/bukti/notifikasi) | **tidak ada** | REST `PGRST205` ("Could not find the table 'public.bakpau_events'") |
| `public.receiving_events` (ledger fisik t_7bc6246b) | **tidak ada** | `PGRST205` |
| `public.handover_items`, `public.return_lines`, `v_receipt_progress` | **tidak ada** | `PGRST205` |

Tanpa `bakpau_events`, jalur create API **fail closed** (`503 ledger_unavailable`)
sebelum satu pun baris `receivings` ditulis. Ini disengaja: tanpa UNIQUE
`dedup_key` tidak ada cara atomik mengklaim event, sehingga dua request
bersamaan bisa menulis nota ganda.

## 2. Yang sudah ada (tidak perlu dibuat)

Semua tabel yang dipakai jalur BACA dan jalur tulis nota sudah ada:

`projects`, `materials`, `vendors`, `purchase_requests`, `pr_items`,
`receivings`, `receiving_items`, `handovers`.

Kolom yang dipakai API (semua sudah ada, diverifikasi dengan SELECT nyata):

```
receivings        : id, purchase_request_id, vendor_id, status, received_date,
                    invoice_no, delivery_note, note, project_id, alokasi,
                    masuk_gudang, kendala, created_at
receiving_items   : id, receiving_id, pr_item_id, item_name,
                    quantity_received, unit, note, created_at
handovers         : id, receiving_id, project_id, received_by, handover_date,
                    status, note, diserahkan_at, created_at
```

## 3. Artefak SQL yang SUDAH ada (draft, belum applied)

`migrations/2026-10-21_bakpau_connector_ledger.sql` (dari t_310dfb07):

* `CREATE TABLE public.bakpau_events` — `dedup_key text NOT NULL UNIQUE`,
  `kind` ∈ (`event`,`evidence`,`notification`), `status` ∈
  (`claimed`,`recorded`,`sent`,`failed`), `payload jsonb`, `result jsonb`,
  `receiving_id uuid`, `created_at`, `updated_at`.
* index `(kind, created_at DESC)` dan `(receiving_id)`.
* trigger `updated_at`.
* RLS **ENABLE**, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`,
  `GRANT SELECT,INSERT,UPDATE,DELETE ... TO service_role`, tanpa policy
  untuk anon/authenticated → deny by default.
* rollback: drop trigger → drop function → drop table (aman, tidak menyimpan
  data keuangan).

**Catatan penting untuk Bandeng:** draft ini sudah ada sejak t_310dfb07 dan
belum pernah dijalankan. Task ini **tidak** mengubahnya. Bila ada kebutuhan
gabungan dari `t_03b41644` (00..06), gabungkan secara terkendali di sana —
jangan apply dua paket terpisah yang menyentuh objek yang sama.

## 4. Kebutuhan tambahan dari API (usulan, belum ditulis sebagai migrasi)

API v1 **tidak menambah tabel**. Yang dibutuhkan hanya:

1. `bakpau_events` di atas (sudah ada draft).
2. Tidak ada RPC baru: jalur tulis memakai `savePurchaseWithClient` yang
   menulis langsung ke `receivings` + `receiving_items` (jalur yang sama
   dengan form admin). Tidak ada fungsi SQL kedua.
3. Tidak ada perubahan RLS pada tabel existing. API berjalan di server dengan
   kredensial yang sudah dipakai aplikasi; token Bakpau hanya gerbang di
   lapisan HTTP, **bukan** identitas Postgres.

## 5. Yang harus dibuktikan sebelum `applied` boleh dinaikkan

1. Backup konsisten produksi + **isolated restore** teruji (bukan hanya dump).
2. Review objek baru: kolom, constraint, index, RLS, grant.
3. Apply aditif di jendela yang disetujui; **tidak** menyalakan READY
   berdasarkan keberadaan file migrasi.
4. Setelah apply, probe harus berubah dari `PGRST205` → tabel ada, dan
   `GET /api/bakpau/v1/read?resource=purchases` tetap 200.
5. Baru setelah itu uji create dengan **transaksi nyata yang DAT minta**
   (bukan dummy finansial). Sampai saat itu status write tetap
   **WRITE_LIVE_UNVERIFIED**.

## 6. Rollback

* Token: tambahkan `keyId` ke `BAKPAU_API_REVOKED` → seluruh API menolak 401
  seketika, tanpa deploy dan tanpa menghapus data.
* Endpoint: hapus dua file route (`pages/api/bakpau/v1/*`) lalu redeploy;
  tidak ada data yang hilang karena API tidak menyimpan state sendiri.
* Ledger: drop `bakpau_events` → konektor/API kembali **fail closed**
  (menolak menulis), bukan kembali ke mode "tulis tanpa idempotensi".
* Tidak ada data keuangan di `bakpau_events`, jadi rollback tidak menyentuh
  nota/pembelian.

## 7. Kesimpulan status

| Item | Status |
|---|---|
| Schema gap teridentifikasi | ya (1 tabel) |
| SQL handoff tersedia | ya (`migrations/2026-10-21_bakpau_connector_ledger.sql`) |
| DDL dijalankan task ini | **0** |
| Applied produksi | **0** |
| Write live | **UNVERIFIED** (butuh DDL + transaksi nyata) |
| Read live | **AKTIF** (tidak butuh DDL) |
