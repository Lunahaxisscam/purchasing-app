# Kontrak Ledger Penerimaan & Retur per Barang — t_7bc6246b

Tanggal: 21 Okt 2026 · Branch: `feat/receipt-ledger-t_7bc6246b` (base `origin/main` 4a92bec)
Status DB: **tidak ada SQL dijalankan oleh task ini.** Skema milik `t_03b41644`.

---

## 1. Kenapa dokumen ini ada

Aplikasi **tidak boleh** mengklaim "tersimpan" untuk dimensi yang belum punya
tabel. Dokumen ini menetapkan:

1. **semantik qty** (tiga angka terpisah, tidak boleh tercampur),
2. **nama tabel/kolom/RPC** yang dipanggil kode (harus sama 1:1 dengan migrasi),
3. **mode LEGACY vs READY** dan siapa yang menentukan,
4. **jalur tulis** (satu RPC, tidak ada insert langsung dari client).

---

## 2. Semantik qty — sumber bug yang sudah terbukti

| Kolom | Arti | Penulis |
|---|---|---|
| `receiving_items.quantity_received` | **QTY BELI** | `purchaseSave.js` (modul Pembelian) |
| `receiving_items.qty_arrived` | **QTY DATANG** (Σ `receiving_events.qty_datang`) | RPC `receipt_apply_events` |
| `receiving_items.qty_handed_over` | **QTY DISERAHKAN** (Σ `handover_items.qty_diserahkan`) | RPC `handover_confirm` |

**Aturan wajib:** `sisa pesanan = pr_items.quantity − qty_arrived`.
Memakai `quantity_received` di sini menghasilkan: nota dibeli 10 tapi belum
datang → tampil "sudah diterima 10" → sisa 0 → barang tidak bisa dibeli lagi.
Rincian: `COMPATIBILITY_CUTOVER.md` (workspace `t_03b41644`).

Kode di branch ini mematuhi aturan itu:
`receiptLogic.buildRows()` membaca `qty_arrived`;
`receiptCapability` mewajibkan view `v_receipt_progress` ada sebelum mode READY.

---

## 3. Objek yang dipanggil kode

### 3.1 Tabel & view

| Objek | Kolom yang dibaca/ditulis kode |
|---|---|
| `receiving_events` | `id, client_event_id, receiving_id, receiving_item_id, pr_item_id, item_name, unit, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, penerima_tukang, retur_status, retur_qty, discard_confirmed, foto_ref, source, created_at` |
| `handover_items` | `id, handover_id, receiving_event_id, receiving_item_id, pr_item_id, item_name, qty_diserahkan, satuan, penerima, catatan, created_at` |
| `return_lines` | `id, return_case_id, receiving_event_id, qty` |
| `v_receipt_progress` | `receiving_item_id, qty_datang, qty_rusak, qty_baik, belum_diserahkan, qty_bought, qty_arrived, qty_handed_over, tujuan_tukang` |

Nama kolom view **wajib persis** — `receiptCapability.js` memprobe daftar itu.

### 3.2 RPC (satu-satunya jalur tulis)

| RPC | Parameter | Dipanggil dari |
|---|---|---|
| `receipt_apply_events` | `p_receiving_id`, `p_events` (jsonb array), `p_meta` | `receiptEventSave.applyReceiptEvents` |
| `handover_confirm` | `p_handover_id`, `p_lines` (jsonb array) | `receiptEventSave.confirmHandoverLines` |
| `return_create` | `p_receiving_id`, `p_lines`, `p_resolution`, `p_reason` | `receiptEventSave.createReturnCase` |

Tabel ledger **tidak punya policy tulis**: client hanya SELECT, semua tulis
lewat RPC SECURITY DEFINER (grant `authenticated`, cabut `anon`).

### 3.3 Idempotensi

`client_event_id` deterministik:
`rcpt:<receivingId>:<receivingItemId>:<prevCum>-><prevCum+datang>`

Isian sama → id sama → `ON CONFLICT (client_event_id) DO NOTHING` → retry,
double-click, dan dua user tidak menggandakan qty. **Dibuktikan pada
PostgreSQL nyata** (bukan mock): submit ulang → `applied=0`,
`already_applied=2`, `qty_arrived` tetap.

---

## 4. Mode LEGACY vs READY

Ditentukan **hanya** oleh `getReceiptCapability()` (probe SELECT limit 1, TTL 60s):

| Flag | Syarat | Efek UI |
|---|---|---|
| `ready` | `receiving_events` ∧ `handover_items` ∧ `v_receipt_progress` terbaca | form Terima Barang menyimpan via RPC; konfirmasi per item aktif |
| `returnReady` | `ready` ∧ `return_lines` terbaca | tombol/modal Retur aktif |
| keduanya false | — | submit diblok dengan pesan gap, **nol tulisan**; konfirmasi jatuh ke header (`confirm.js`); banner menyebut alasan |

**Status live per 21 Okt 2026 (probe read-only, anon key):**

```
receiving_events    PGRST205 (tidak ada)
handover_items      PGRST205 (tidak ada)
return_lines        PGRST205 (tidak ada)
v_receipt_progress  PGRST205 (tidak ada)
→ ready=false, returnReady=false, mode UI = LEGACY
```

Data live utuh: receivings 6 · receiving_items 6 · handovers 1 ·
purchase_requests 16 · pr_items 60 · vendors 22.

---

## 5. Bukti pengujian

| Harness | Cakupan | Hasil |
|---|---|---|
| `scripts/receipt-ledger-db-test/` | RPC **nyata** di PostgreSQL 16 terisolasi + migrasi 00..04 schema owner | **47 PASS / 0 FAIL** |
| `scripts/receipt-physical-test/` | jsdom interaktif: form Terima Barang, konfirmasi, retur, pintu masuk, logika murni | **90 PASS / 0 FAIL** |
| `scripts/handover-flow-test/` | regresi Handover | 61 / 66 / 73 lulus |
| `scripts/handover-compact-test/` | kontrak 3 aksi fisik + scope Purchase | 89/89 (+ 50/52 status quo main) |
| `scripts/purchase-flow-test/` | regresi Pembelian | 218 / 105 lulus |

DB test membuktikan antara lain: `quantity_received` tetap 10 saat
`qty_arrived` 6; over-receipt ditolak server; konfirmasi kedua `already`;
quota tukang ditolak → CAS ikut rollback; retur kedua ditolak; anon 0 grant.

---

## 6. Yang TIDAK dibuktikan (jujur)

- RLS terhadap **sesi user Novi nyata** — policy diuji mekanis (grant/role),
  bukan login E2E.
- Migrasi **belum di produksi** (`applied=0`); aplikasi tetap LEGACY.
- Cluster uji memakai fixture sintetis, bukan dump produksi.
- Nomor proyek draft-vs-issued **tidak** diaktifkan (belum diputuskan DAT).

---

## 7. Urutan aktivasi (setelah schema owner menjalankan DDL)

```
1. backup consistent + restore drill lulus        (BACKUP_RUNBOOK_v2)
2. apply migrasi 00→05 + readback SQL              (MIGRATION_MANIFEST §5)
3. probe aplikasi (TTL 60s) → ready=true, returnReady=true   [tanpa deploy]
4. merge branch ini + patch COMPATIBILITY_CUTOVER §3
5. deploy
6. transaksi NYATA pertama oleh Novi (bukan fixture)
```

Langkah 3 aman sebelum langkah 4: selama build produksi belum memuat
`receiptCapability`, tidak ada UI yang memakai tabel baru.
