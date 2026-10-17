# Kontrak Event Penerimaan, Alokasi, Handover & Retur (v2)

Tanggal: 17 Okt 2026 · Owner kontrak: **bamboo-tech** (task t_7bc6246b)
Owner **schema/migrasi tunggal**: **reviewer_resek** (task t_03b41644)
Status migrasi: **BELUM ADA** — dokumen ini adalah *permintaan kontrak*, bukan SQL.
Task t_7bc6246b **tidak menjalankan SQL apa pun** dan tidak menulis DB.

---

## 0. Ringkasan keputusan desain (yang harus diikuti schema owner)

| # | Keputusan | Alasan |
|---|---|---|
| D1 | `receiving_items.quantity_received` **tetap** menjadi angka kumulatif yang dibaca modul lain (Finance, PR, stok) | kompatibilitas: layar lama, RPC `receive_to_warehouse`, laporan Finance tidak boleh berubah |
| D2 | Ledger sebenarnya = `receiving_events` (append-only, satu baris = satu kejadian terima per item) | dimensi datang/rusak/tujuan/retur tidak bisa dipacking ke satu kolom |
| D3 | `quantity_received` di-**maintain oleh RPC** sebagai Σ `receiving_events.qty_datang` (satu penulis) | tidak ada dua sumber angka; backfill tidak menebak |
| D4 | Tidak ada tabel `receiving_allocations` terpisah — tujuan tersimpan di event (`tujuan_ws`, `tujuan_tukang`) dan realisasi serah terima di `handover_items` | satu fakta satu tempat; sisa "belum diserahkan" = alokasi tukang − Σ diserahkan |
| D5 | Semua tulis lewat **RPC SECURITY DEFINER** (bukan insert tabel langsung dari client) | multi-tabel atomik + guard role + advisory lock per receiving |
| D6 | Idempotensi pakai `client_event_id` unik (bukan timestamp) | retry / double-click / dua user tidak menggandakan qty |
| D7 | Data historis **tidak** difabrikasi: `qty_rusak` boleh `NULL` = tidak diketahui | "unknown tetap unresolved, no guess" (blueprint §6) |
| D8 | `handovers` tetap header; `handover_items` = rincian barang per penyerahan | H1–H3 di `docs/handover-gap-proposal.md` |
| D9 | Retur memakai `return_cases` + `return_lines` yang **merujuk event rusak** (bukan ketik ulang item/qty) | retur tanpa input ulang |
| D10 | Fitur persisten hanya aktif bila **capability probe** melihat tabel+kRPC benar-benar ada | "READY ≠ database siap" |

---

## 1. Tabel (additive, tanpa drop/rename/rewrite)

### 1.1 `receiving_events`
```sql
create table if not exists public.receiving_events (
  id                uuid primary key default gen_random_uuid(),
  client_event_id   text not null unique,          -- idempotency (D6)
  receiving_id      uuid not null references public.receivings(id) on delete cascade,
  receiving_item_id uuid not null references public.receiving_items(id) on delete cascade,
  pr_item_id        uuid null references public.pr_items(id) on delete set null,
  item_name         text not null,
  unit              text null,
  qty_datang        numeric not null check (qty_datang > 0),
  qty_rusak         numeric null check (qty_rusak is null or qty_rusak >= 0),
  tujuan_ws         numeric not null default 0 check (tujuan_ws >= 0),
  tujuan_tukang     numeric not null default 0 check (tujuan_tukang >= 0),
  penerima_tukang   text null,
  retur_status      text not null default 'NONE'
                    check (retur_status in ('NONE','PENDING','RETURNED','REPLACED','REFUNDED','DISCARDED')),
  retur_qty         numeric not null default 0 check (retur_qty >= 0),
  discard_confirmed boolean not null default false,
  foto_ref          text null,                     -- referensi arsip (bukan base64 di DB)
  source            text not null default 'FORM' check (source in ('FORM','BACKFILL')),
  reversal_of       uuid null references public.receiving_events(id),
  created_at        timestamptz not null default now(),
  created_by        uuid null,
  -- invariant dasar (server-side, bukan hanya form)
  constraint ev_rusak_le_datang check (qty_rusak is null or qty_rusak <= qty_datang),
  constraint ev_tujuan_le_baik  check (tujuan_ws + tujuan_tukang <= qty_datang - coalesce(qty_rusak,0)),
  constraint ev_tukang_penerima check (tujuan_tukang = 0 or coalesce(btrim(penerima_tukang),'') <> ''),
  constraint ev_discard_confirm check (retur_status <> 'DISCARDED' or discard_confirmed)
);
create index if not exists receiving_events_rec_idx on public.receiving_events(receiving_id);
create index if not exists receiving_events_item_idx on public.receiving_events(receiving_item_id);
```

### 1.2 `handover_items`
```sql
create table if not exists public.handover_items (
  id                 uuid primary key default gen_random_uuid(),
  handover_id        uuid not null references public.handovers(id) on delete cascade,
  receiving_event_id uuid null references public.receiving_events(id) on delete set null,
  receiving_item_id  uuid null references public.receiving_items(id) on delete set null,
  pr_item_id         uuid null references public.pr_items(id) on delete set null,
  item_name          text not null,
  qty_diserahkan     numeric not null check (qty_diserahkan > 0),
  satuan             text null,
  penerima           text null,          -- boleh beda dari header (H3)
  catatan            text null,
  created_at         timestamptz not null default now(),
  created_by         uuid null
);
create unique index if not exists handover_items_uniq
  on public.handover_items(handover_id, receiving_event_id) where receiving_event_id is not null;
```

### 1.3 `return_cases` / `return_lines`
```sql
create table if not exists public.return_cases (
  id           uuid primary key default gen_random_uuid(),
  receiving_id uuid not null references public.receivings(id) on delete cascade,
  vendor_id    uuid null references public.vendors(id) on delete set null,
  status       text not null default 'DRAFT'
               check (status in ('DRAFT','PENDING_SUPPLIER','RETURNED','REPLACED','REFUNDED','DISCARDED','CANCELLED')),
  resolution   text not null default 'PENDING'
               check (resolution in ('PENDING','RETURN','REPLACE','REFUND','DISCARD')),
  reason       text null,
  created_at   timestamptz not null default now(),
  created_by   uuid null,
  decided_at   timestamptz null
);
create table if not exists public.return_lines (
  id                 uuid primary key default gen_random_uuid(),
  return_case_id     uuid not null references public.return_cases(id) on delete cascade,
  receiving_event_id uuid not null references public.receiving_events(id) on delete restrict,
  receiving_item_id  uuid null references public.receiving_items(id) on delete set null,
  pr_item_id         uuid null references public.pr_items(id) on delete set null,
  qty                numeric not null check (qty > 0),
  satuan             text null,
  note               text null,
  created_at         timestamptz not null default now()
);
create unique index if not exists return_lines_uniq on public.return_lines(return_case_id, receiving_event_id);
```
Aturan anti-double-accounting (blueprint §9): `return_lines.qty` **tidak** mengurangi `quantity_received` dan **tidak** membuat baris biaya; ia hanya status logistik. Replacement (`REPLACED`) menambah event baru, bukan mengedit event lama.

---

## 2. RPC (satu-satunya jalur tulis)

Semua `SECURITY DEFINER`, `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated, service_role`.

### 2.1 `receipt_apply_events(p_receiving_id uuid, p_events jsonb, p_meta jsonb default '{}')`
- `pg_advisory_xact_lock(hashtext('receipt:' || p_receiving_id))`
- Validasi tiap event terhadap **state DB saat itu** (bukan hanya kiriman client):
  `Σ qty_datang ≤ pr_items.quantity − Σ qty_datang event lain` (over-receipt ditolak, `reason='over_receipt'`);
  `qty_rusak ≤ qty_datang`; `tujuan_ws + tujuan_tukang ≤ baik`; tukang ⇒ penerima.
- Insert event; `ON CONFLICT (client_event_id) DO NOTHING` → `already_applied` untuk replay.
- Update `receiving_items.quantity_received = Σ qty_datang` (D3) dalam transaksi yang sama.
- Isi `receivings.received_date` bila null.
- Return `{ ok, applied, already_applied, event_ids, item_totals }`.

### 2.2 `handover_confirm(p_handover_id uuid, p_lines jsonb)`
- CAS: `update handovers set status='CONFIRMED', diserahkan_at=now() where id=$1 and diserahkan_at is null` (0 baris ⇒ `already`).
- Insert `handover_items` (unique `(handover_id, receiving_event_id)` ⇒ retry aman).
- Validasi per event: `Σ diserahkan ≤ tujuan_tukang − Σ sudah diserahkan handover lain`.
- **Tidak** menyentuh `receiving_items` / stok (D7 kontrak receipt: direct-to-tukang ≠ stok WS).

### 2.3 `return_create(p_receiving_id uuid, p_lines jsonb, p_resolution text, p_reason text)`
- Insert `return_cases` + `return_lines` (merujuk event rusak).
- Validasi `Σ qty per event ≤ retur_qty − Σ retur lain`.
- Update `receiving_events.retur_status` (`PENDING`/`DISCARDED`) untuk baris yang terpilih.
- Return `{ ok, return_case_id, lines }`.

### 2.4 Read model (boleh view biasa)
`v_receipt_progress`: per `receiving_item_id` → `qty_datang, qty_rusak, qty_baik, tujuan_ws, tujuan_tukang, belum_diserahkan, retur_pending`.
UI **wajib** memakai view ini bila ada; bila tidak ada → fallback lama (`quantity_received`) dengan label jujur.

---

## 3. RLS
- `receiving_events`, `handover_items`, `return_cases`, `return_lines`: `ENABLE ROW LEVEL SECURITY`; policy `SELECT` untuk `authenticated` (mengikuti visibilitas header induknya: `receiving_id`/`handover_id` harus terlihat user); **tidak ada policy INSERT/UPDATE/DELETE** → tulis hanya lewat RPC.
- Admin boleh `SELECT` semua; `created_by = auth.uid()` diisi RPC.
- Tidak ada kolom rahasia; `foto_ref` = path/ID arsip, bukan kredensial.

---

## 4. Backfill & data historis
1. `receiving_events` **mulai kosong**. Tidak ada fabrikasi event dari `quantity_received` (kondisi/tujuan historis tidak diketahui).
2. Bila DAT meminta backfill: hanya baris yang ditandai admin, `source='BACKFILL'`, `qty_rusak = NULL` (unknown), `tujuan_ws = 0`, `tujuan_tukang = 0`, `retur_status='NONE'`; `quantity_received` **tidak** diubah. Event backfill tidak boleh dipakai menghitung retur/handover otomatis.
3. Handover lama tanpa `handover_items` → tetap label "Rincian barang belum tersedia".

---

## 5. Rollback
Urutan drop terbalik (semua additive, tanpa menyentuh tabel lama):
`return_lines → return_cases → handover_items → receiving_events` (+ RPC + view).
Karena aplikasi memakai capability probe, setelah drop UI otomatis kembali ke mode legacy tanpa error. `quantity_received` tetap berisi angka hasil sinkronisasi terakhir (tidak hilang).

---

## 6. Capability probe (sisi aplikasi — sudah diimplementasikan)
`modules/receivings/receiptCapability.js` memeriksa (read-only, tanpa tulis):
1. tabel `receiving_events` & `handover_items` ada,
2. kolom wajib ada (`select=id,qty_datang,qty_rusak,tujuan_ws,tujuan_tukang,penerima_tukang,retur_status,retur_qty,discard_confirmed,client_event_id`),
3. tabel `return_lines` ada (WAJIB untuk retur — lihat catatan di bawah),
4. `v_receipt_progress` ada (opsional; bila tidak ada, UI hitung dari event).

Probe menghasilkan **dua** tingkat kesiapan, karena tidak semua fitur bergantung
pada tabel yang sama:

| flag | syarat | efek UI |
|---|---|---|
| `ready` | `receiving_events` + `handover_items` | form Terima Barang mode READY, modal konfirmasi fisik Handover |
| `returnReady` | `ready` **dan** `return_lines` | tombol `↩ Retur Rusak` tampil & modal retur bisa menyimpan |

Bila `ready` gagal → `ready=false` + `missing[]`, form berjalan **mode legacy**
(submit diblok dengan pesan gap, nol tulisan). Tidak ada klaim tersimpan.
Bila `ready` benar tetapi `return_lines` belum ada → penerimaan & serah terima
tetap jalan, **tombol Retur disembunyikan**: tanpa `return_lines` riwayat retur
tidak bisa dibaca, sehingga retur yang sama berpotensi tercatat dua kali.

**Anti double-retur (wajib dipertahankan schema owner):** `return_lines` harus
bisa dibaca oleh user yang berhak, karena modal retur menghitung
`sisa = qty_rusak − Σ return_lines.qty` per event. Bila pembacaan itu gagal,
modal **menolak** menampilkan baris (bukan mengarang riwayat).

---

## 7. Yang TIDAK berubah (dijaga task ini)
- `receivings.status` (NORMAL/RETUR/REFUND) tetap dimensi **nota**, bukan kondisi barang; tidak boleh meng-override kondisi item.
- Ringkasan parent tetap **turunan** item (read-only), tidak bisa diedit untuk nota multi-item.
- `quantity_received`/histori/idempotensi/role/foto opsional dipertahankan.
- Nomor proyek draft-vs-issued **tidak** diaktifkan.
