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

## 4. Kebutuhan tambahan dari API (revisi 2 — RPC transaksional)

Revisi 1 menyatakan "tidak ada RPC baru". **Itu berubah** setelah review
Brooklyn: jalur multipart tidak memenuhi syarat transaksi tunggal.

Sekarang API membutuhkan **satu fungsi SQL** (bukan tabel baru):

`migrations/2026-10-21_bakpau_atomic_purchase_rpc.DRAFT.sql`

```
public.bakpau_save_purchase_atomic(p_payload jsonb) RETURNS jsonb
  SECURITY INVOKER, SET search_path = public, pg_temp
```

Isi (semua dalam satu transaksi PostgreSQL):

1. validasi bentuk payload (termasuk subtotal baris == `material`, dan
   `total == material + biaya_lain − diskon`, baris wajib punya `[Harga: n]`);
2. klaim event `evt:<channel>:<idempotency>` via `INSERT … ON CONFLICT DO NOTHING`
   pada `bakpau_events.dedup_key` (UNIQUE);
3. klaim bukti `evd:<sha256>` — bila sudah ada → `RAISE` `BK002` (rollback total);
4. tolak nota `vendor_id + invoice_no` yang sudah DIBELI (termasuk buatan admin)
   → `RAISE` `BK001`;
5. `INSERT` header `receivings` + semua baris `receiving_items` (satu statement);
6. `UPDATE` kedua baris ledger → `status='recorded'`, `receiving_id`;
7. `RETURN jsonb` berisi `receiving_id`, `invoice_no`, `item_count`, `total`,
   `event_key`, `evidence_hash`, `items[]`.

Hak akses: `REVOKE ALL FROM PUBLIC`, `anon`, `authenticated`; hanya
`service_role` yang boleh `EXECUTE`. **Tidak** ada SQL dinamis dan tidak ada
nama tabel/kolom dari parameter.

**Ketergantungan**: fungsi ini memerlukan `bakpau_events` (§3) sudah ada.
Urutan apply: ledger dulu, lalu fungsi — dalam **satu** jendela yang disetujui.

**Perubahan perilaku yang perlu diketahui integrator**:
`savePurchaseWithClient` (jalur admin) tetap multipart seperti sekarang. Agar
idempotensi benar-benar lintas kanal (admin vs Telegram vs WA vs API), jalur
admin perlu ikut memakai fungsi/RPC bersama ini. Itu **pekerjaan integrator**,
bukan sesuatu yang diklaim selesai oleh lane API. Sampai itu terjadi,
idempotensi lintas kanal hanya berlaku untuk nota yang sudah DIBELI dengan
vendor+nomor sama (dicek di dalam fungsi), bukan untuk seluruh alur admin.

## 4.1 Bukti fungsi ini bekerja (DB terisolasi, BUKAN produksi)

`scripts/bakpau-api-test/run_real_db.py` — PostgreSQL 16, database
`bakpau_api_t_dd743609`, fixture sintetis `t_03b41644`:

* 94 assertion PASS / 0 FAIL;
* **fault injection nyata**: trigger `BEFORE INSERT` melempar `23514` pada baris
  kedua → 0 header, 0 baris, 0 klaim ledger tertinggal, dan retry dengan kunci
  yang sama berhasil (kunci tidak "terbakar");
* race dua request paralel → tepat 1 nota;
* RPC di-rename → `503 atomic_rpc_unavailable`, 0 tulisan;
* 5 panggilan RPC langsung (tanpa lapisan aplikasi) yang cacat → semuanya
  ditolak, 0 tulisan;
* `has_function_privilege`: anon/authenticated `false`, service_role `true`.

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
| Schema gap teridentifikasi | ya (1 tabel `bakpau_events` + 1 fungsi RPC) |
| SQL handoff tersedia | ya (`migrations/2026-10-21_bakpau_connector_ledger.sql` + `migrations/2026-10-21_bakpau_atomic_purchase_rpc.DRAFT.sql`) |
| DDL dijalankan task ini | **0 di produksi**; 2 file di-apply hanya ke DB uji terisolasi (port 55434) |
| Applied produksi | **0** |
| Write live | **UNVERIFIED** (butuh ledger+RPC applied + transaksi nyata) |
| Read live | **AKTIF di kandidat 3001** (tidak butuh DDL) |
