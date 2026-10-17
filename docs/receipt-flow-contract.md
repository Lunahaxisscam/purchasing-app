# Kontrak Alur "Terima Barang" (Purchase) — t_5196b689

> ⚠️ **SUPERSEDED (17 Okt 2026, t_9109cf5e).** Alur "Terima Barang" beserta
> tombol gudang/tukang/retur/refund sudah **DIHAPUS** dari modul Purchase
> sesuai arahan DAT (Purchase berhenti di "barang dibeli"; distribusi fisik
> pindah ke Handover). Dokumen ini dipertahankan sebagai **arsip keputusan** —
> kontrak yang berlaku sekarang ada di `docs/purchase-flow-contract.md`.
> File yang disebut di bawah (`receiptForm.jsx`, `receiptLogic.js`,
> `receiptSave.js`, `view.jsx`) sudah tidak ada di repo.

Tanggal: 16 Okt 2026 · Owner: bamboo-tech · Untuk task lanjutan: **t_b418827b (Handover)**
Status migrasi DB: **BEKU** — tidak ada migration/SQL yang dijalankan oleh task ini.

---

## 1. Dimensi (jangan disamakan)

| Dimensi | Sumber kebenaran saat ini | Catatan |
|---|---|---|
| Penerimaan (jumlah datang) | `receiving_items.quantity_received` (kumulatif per item) | satu-satunya yang tersimpan |
| Kondisi (rusak / baik) | dihitung di form; **belum punya kolom** | baik = datang − rusak |
| Tujuan baik (Workshop / Tukang / belum ditentukan) | dihitung di form; **belum punya kolom** | split boleh; total ≤ baik |
| Status retur rusak (nanti / menunggu supplier / dibuang) | dihitung di form; **belum punya kolom** | "menunggu dikembalikan" ≠ "sudah dikembalikan" |
| Status nota (NORMAL/RETUR/REFUND) | `receivings.status` | dimensi TERPISAH dari qty; jangan tampilkan "LENGKAP hijau" untuk nota kendala |
| Alokasi nota (masuk gudang / ke tukang) | `receivings.alokasi/masuk_gudang/tukang_at` | header-level (keterbatasan skema) |
| Progres qty | dihitung dari children (`receivingProgress`) | over-receipt → key `OVER` (merah), bukan "LENGKAP" |

## 2. Kontrak perilaku yang SUDAH aktif (existing schema)

1. **Satu tombol "Terima Barang"** per baris Purchase (desktop & mobile) membuka
   modal `modules/receivings/receiptForm.jsx`. Label berubah "Lihat Barang" bila
   semua item lengkap & nota bukan kendala. Panel legacy "Langkah 1 — Cek Fisik"
   + toggle "Lihat X item" **dihapus total** (bukan disembunyikan).
2. **Input tidak menulis DB saat mengetik.** Hanya tombol "Simpan Penerimaan"
   (satu submit) yang memanggil `saveReceipt()`.
3. **Validasi** (`modules/receivings/receiptLogic.js`):
   - datang & rusak angka ≥ 0; rusak ≤ datang;
   - Σdatang kumulatif ≤ dipesan (over-receipt DIBLOK — belum ada kebijakan);
   - tujuan (WS + tukang) ≤ baik; tukang > 0 wajib nama penerima;
   - dibuang wajib centang konfirmasi (**foto opsional** — koreksi DAT 16 Okt);
   - form valid tapi memakai dimensi tanpa kolom → `schemaBlocks` → submit
     DIBLOK dengan pesan gap; **nol tulisan** (bukan packing ke `note`).
4. **Idempoten / anti dobel**: snapshot `prevCum` saat form dibuka;
   `saveReceipt` memakai compare-and-swap `WHERE id AND quantity_received = prevCum`
   (prevCum 0 cocok juga dengan NULL). Submit ganda/retry → konflik, angka tidak
   bertambah dua kali. UI: `busyRef` + tombol disabled. `CreateModal.save()` juga
   punya ref guard anti-dobel (G13).
5. **Nota lama tanpa item** (3 dari 4 nota live): modal menampilkan pesan +
   tombol "Muat item dari PR" (`loadItemsFromPr`) → insert baris qty 0 dari
   `pr_items`; 23505 dilewati; nota tanpa PR → pesan hubungi admin.
   `receivings.received_date` diisi bila masih kosong (tidak menimpa).
6. **Nilai `alokasi` asing** (mis. `LANGSUNG_LAPANGAN` di data live) ditampilkan
   apa adanya — jangan dipecah/ditafsirkan ulang.
7. **Data rusak/belum datang tidak masuk stok usable/handover**: form memblok
   submit saat dimensi rusak/tujuan dipakai (belum bisa disimpan akurat), jadi
   tidak ada jalur yang menulis "rusak" sebagai "usable" dari flow baru.

## 3. Yang BELUM bisa (gap skema — menunggu izin DAT)

`receiving_items` hanya punya `quantity_received`; `handovers` tidak punya item
rows. Karena itu **belum disimpan**: rusak per item, tujuan baik per item,
split WS/tukang, retur/buang, bukti foto, rincian barang handover per item,
handover parsial.

**Usulan minimal** (selaras §H audit t_905e0e5a — BELUM dieksekusi):

```sql
-- append-only; satu baris = satu event penerimaan
receiving_events(
  id, receiving_id, pr_item_id,
  qty_datang numeric, qty_rusak numeric default 0,
  tujuan_baik text check (in 'WS','TUKANG','PENDING','SPLIT'),
  tujuan_ws numeric default 0, tujuan_tukang numeric default 0,
  penerima_tukang text,
  retur_status text check (in 'NONE','PENDING','RETURNED','REPLACED','REFUNDED'),
  discard_foto text,  -- data-url ≤2MB; OPSIONAL
  created_at, created_by
)
handover_items(
  id, handover_id, receiving_event_id, pr_item_id,
  qty_diserahkan numeric, satuan text, catatan text
)
```

Alternatif note-JSON **ditolak DAT** (packing). Sampai ada izin: dimensi
rusak/tujuan tetap hanya di form (diblok saat submit), dan handover tetap
header-level.

## 4. Kontrak untuk Handover (t_b418827b)

1. **Handover hanya berisi jumlah BAIK yang benar-benar diserahkan.** Sumber
   angka = event penerimaan (setelah skema) — sebelum itu, jangan mengarang
   rincian dari `receiving_items.quantity_received` (itu termasuk rusak).
2. **Jangan auto-confirm.** `status=CONFIRMED` tanpa `diserahkan_at` BUKAN bukti
   fisik (bukti live A3). Konfirmasi fisik harus menulis `diserahkan_at`;
   label "Sudah Diserahkan" hanya bila `diserahkan_at` ada.
3. **Edit handover** harus mengambil `receiving_id/project_id/status` dari
   `editRow` (bukan form) — prefill saja tidak mengunci (G5).
4. **Antrean Belum Diserahkan**: dibuat saat alokasi ke tukang dipilih, bukan
   saat barang fisik diserahkan. Qty handover = qty yang dipilih per item.
5. **Data lama tanpa rincian** → label "Rincian barang belum tersedia" (jangan
   menebak dari current Purchase yang bisa berubah).
6. **Direct-to-tukang ≠ stock WS issue**: pengiriman langsung ke tukang TIDAK
   boleh memotong stok WS (`receive_to_warehouse` hanya untuk alokasi gudang).
7. Retur pengganti/tunai: jangan menggandakan qty/cost; perubahan status
   logistik tidak otomatis write-off keuangan.

## 5. File & tes

- Implementasi: `modules/receivings/{receiptLogic.js, receiptSave.js, receiptForm.jsx, view.jsx}`,
  `components/ModuleView.js` (state `receiptRow` + `renderModuleModal`),
  `modules/shared/renderModuleCell.jsx`, `lib/constants.js` (kolom `items`),
  `modules/shared/itemHelpers.js` (OVER + `kendala`), `pages/index.js`
  (hapus fungsi legacy), `docs/owners.md`.
- Harness: `scripts/receipt-flow-test/` — `run.py` menjalankan
  `logic_test.mjs` (67 cek: logika + simpan idempoten dengan mock CAS) dan
  `render_test.mjs` (54 cek: jsdom interaktif) + `e2e_runtime_test.mjs`
  (16 cek CDP browser nyata, dijalankan terhadap build smoke).
- Regresi terkait: `flow-logic-test` (29/29), `flow-gap-repro-test`
  (GAP-1 kini NOT-REPRODUCED = ditutup; GAP-3/4/5 milik handover),
  `fase2-save-test` (44/44), `showmore-list-test`, `vendors-toolbar-test`,
  `approval-queue-test`, `material-acuan-test`.

## 6. Batas

- **Tidak** ada migration/SQL/schema baru; **tidak** mengubah Finance/accounting;
  **tidak** menghapus data lama (3 nota live test + handover asli utuh).
- Foto bukti: **opsional**; arsip otomatis ke
  `PLAYFIELD/BROKOLI - OPERATIONS/Arsip Bukti Purchasing` (persiapan t_79391975)
  **belum terintegrasi** — UI menyatakan jujur "belum tersimpan", tidak
  mengklaim sukses.
