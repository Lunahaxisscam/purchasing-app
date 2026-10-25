# Kebijakan Estimasi Harga Purchase Request (t_ac0b39c0)

## Ringkasan fitur

Saat membuat/mengedit PR, setiap item material kini menampilkan **harga acuan
otomatis** yang diisi begitu item ditambahkan, plus **Total Estimasi** untuk
satu PR. Semua angka estimasi di-resolve lewat **resolver yang sama** dengan
modul Material (`makeAcuanHelpers` di `modules/materials/acuan.js`,
t_090127ad) agar sumber harga konsisten antar modul.

## Sumber harga acuan (urutan prioritas)

**P1 t_e88c28fb — harga AKTUAL ≠ estimasi PR:** label "Historis/Terealisasi"
hanya untuk harga satuan **aktual terverifikasi** dari nota/purchase line
valid. Barang yang sudah diterima TIDAK membuat `pr_items.estimated_price`
menjadi harga beli aktual, dan vendor referensi PR bukan bukti supplier
aktual. Estimasi PR terdahulu yang barangnya sudah diterima tampil sebagai
kategori **PR_ESTIMATE** ("Estimasi PR terdahulu") — kategori terpisah,
tidak dipromosikan jadi aktual.

1. **HISTORIS vendor terpilih** — bila vendor rencana beli dipilih, harga
   beli **aktual terverifikasi** dari vendor itu (material + **satuan sama**,
   dijaga resolver; tanpa ongkir/admin; bukan `[Nominal]` nota). Skema
   `pr_items` existing belum punya kolom harga aktual — kategori ini baru
   terisi setelah skema actual disetujui DAT (tidak pernah memakai
   `estimated_price`).
2. **MASTER** — `materials.harga_acuan` existing (tanpa tanggal/vendor).
3. **PR_ESTIMATE (fallback terakhir)** — harga estimasi PR terdahulu yang
   barangnya sudah diterima. Selalu berbadge
   **"⚠️ Estimasi PR terdahulu"** (bukan "Historis") dan, bila ada vendor
   referensi, diberi catatan "vendor referensi PR — belum tentu supplier
   aktual". Tidak pernah mewakili "pembelian dari vendor terpilih".
4. **Tidak ada sumber** → input dibiarkan **kosong + label
   "Belum ada acuan"**. TIDAK PERNAH diisi 0 palsu, dan Total Estimasi
   diberi label **"belum lengkap"** dengan daftar item yang belum punya
   harga.

Sumber manual: harga yang **diketik user** di form diberi badge
**✍️ Manual** dan **tidak pernah ditimpa otomatis** (ganti vendor /
"Pakai acuan" hanya mengubah harga bila harga masih milik auto-acuan;
tombol `↺ Pakai acuan` mengembalikan harga ke acuan secara eksplisit).

## Yang tersimpan vs yang TIDAK tersimpan (BATAS PERSISTENSI — WAJIB DIBACA)

| Nilai | Tersimpan? | Di mana |
|---|---|---|
| Harga satuan estimasi per item | ✅ YA | `pr_items.estimated_price` (kolom existing) |
| Vendor rencana beli per item | ✅ YA | `pr_items.vendor_id` (kolom existing) |
| Kategori rencana beli per item | ✅ YA | `pr_items.supplier_category` (kolom existing) |
| **Sumber acuan** (Historis/Master/Manual) | ❌ TIDAK | hanya state form (field `est_*`) |
| **Vendor referensi & tanggal acuan** | ❌ TIDAK | hanya state form (field `est_*`) |

**Konsekuensi snapshot yang DIJAGA kode:**

- Reopening PR (mode edit) **TIDAK menghitung ulang** harga dari histori
  terbaru — `estimated_price` tersimpan dipertahankan apa adanya. Hanya
  item BARU tanpa harga yang diisi otomatis saat ditambahkan.
- Daftar PR (desktop/mobile) & panel detail Approval menampilkan angka
  **snapshot tersimpan** — bukan lookup dinamis. Pembelian baru TIDAK
  mengubah Total Estimasi PR lama.
- Kolom "sumber acuan" yang tampil di daftar form adalah metadata sesi;
  setelah simpan, yang tersimpan hanya harga. **Jangan mengklaim sumber
  tersimpan** sampai skema di bawah disetujui.
- Badge saat PR di-reopen: item ber-harga tanpa metadata sumber (snapshot
  tersimpan) berbadge **📌 Tersimpan (snapshot)** — bukan "Belum ada
  acuan" (harga jelas ada; hanya sumbernya yang tak tercatat). Label
  "Belum ada acuan" tetap khusus item **tanpa harga** sama sekali.

**Kebutuhan skema yang diusulkan ke DAT (menunggu izin — freeze migrasi
tetap berlaku; TIDAK dieksekusi):**

```sql
-- Snapshot per item PR agar sumber acuan ikut tersimpan & audit-able.
alter table pr_items add column price_source text;        -- 'HISTORIS' | 'MASTER' | 'PR_ESTIMATE' | 'MANUAL'
alter table pr_items add column price_ref_vendor_id uuid references vendors(id);
alter table pr_items add column price_ref_date date;
-- P1 t_e88c28fb: satu-satunya jalur label "Historis/Terealisasi" adalah
-- harga satuan AKTUAL terverifikasi dari nota/purchase line valid —
-- kolom harga aktual di baris item PR (lihat docs/material-acuan-policy.md).
alter table pr_items add column price_actual numeric check (price_actual is null or price_actual > 0);
```

Setelah izin diberi: form mengisi kolom ini saat simpan, daftar/detail
menampilkan sumber tersimpan, dan metadata sesi tidak diperlukan lagi.

## Validasi (service boundary — bukan UI-only)

`modules/requests/save.js` memvalidasi SEBELUM menulis DB:

- **Qty**: finite & > 0 (`validatedQty`) — NaN/0/negatif ditolak dengan
  pesan per item.
- **Harga**: nonnegative & finite (`validatedPrice`) — tanda minus dan
  parentheses ditolak eksplisit (`-5` tidak pernah diam-diam menjadi `5`);
  string berformat `1.250.000` diterima; hasil dibulatkan ke rupiah.
- **Vendor eligible**: vendor harus aktif pada kategori yang cocok dengan
  **kategori kanonik master material** (`materials.category` ↔
  `vendors.supplier_category`). Pilihan kategori rencana beli TIDAK bisa
  dipakai "mengakali" izin. Vendor tersimpan yang menjadi tidak-eligible
  (kategori vendor diubah/dinonaktifkan) **tidak dihapus diam-diam** — form
  menandainya "tidak aktif utk kategori material ini" dan save menolak dengan
  pesan yang minta user memilih vendor valid. Histori lama vendor beda
  kategori tetap tampil sebagai histori read-only di modul Material.
- **Multi-kategori vendor (kebijakan DAT terbaru)**: satu vendor BOLEH aktif
  pada beberapa kategori. Resolver `isVendorEligible` menerima vendor
  ber-kategori scalar (existing) maupun array (bila skema disetujui):
  eligible = kategori material termasuk SALAH SATU kategori aktif vendor.
  Catatan skema: `vendors.supplier_category` existing = scalar text (dicek
  read-only; 22/22 baris string, operator array PostgREST ditolak 42883) —
  penyimpanan multi-kategori menunggu keputusan skema DAT
  (usulan: kolom `text[]` atau tabel relasi; lihat komentar task t_ac0b39c0).
  Tidak ada UI checklist yang tampil sebelum penyimpanan siap (tanpa klaim
  palsu), dan tidak ada hack delimiter/note.

## Batasan lain

- **Satuan tanpa konversi**: entri historis hanya dipakai bila satuan item
  PR = satuan master material (per Dus ≠ per Pcs tanpa faktor valid).
- **Harga murni material**: tanpa ongkir/admin (sama dengan aturan acuan
  Material t_090127ad).
- **Vendor referensi ≠ vendor pesanan**: menampilkan "ref: Toko X" dari
  histori TIDAK mengubah `vendor_id` item.
- **Total Estimasi ≠ nominal actual**: nilai receiving/budget/finance tidak
  tersentuh fitur ini.
- **Total Estimasi selalu terlihat**: baris total + label "belum lengkap" +
  disclaimer dirender DI LUAR area scroll daftar item (temuan review run 86:
  sebelumnya ikut ter-scroll di dalam kontainer max-height 240px sehingga
  terpotong saat item banyak — user tidak boleh harus scroll untuk melihat
  total PR). Di-assert di render_test blok C.

## File yang berubah

- `modules/requests/estimator.js` (baru) — resolver wrapper + eligibility +
  total (dipakai form & save).
- `modules/requests/form.jsx` — header satu baris Project + Judul
  Kebutuhan (`.pr-header-row`, desktop 2 kolom 40/60, mobile stack),
  area pemilih (filter kategori + search diperkecil, stack mobile),
  badge sumber, subtotal per item, Total Estimasi, tombol "Pakai acuan".
- `modules/requests/save.js` — gate validasi harga/qty/vendor + penulisan
  `validatedPrice`.
- `modules/requests/view.jsx` — subtotal snapshot per item + baris Total
  Estimasi PR (desktop & mobile).
- `modules/approvals/view.jsx` — kolom Subtotal + Total Estimasi read-only
  di panel detail material.
- `modules/shared/itemHelpers.js` — `savedSubtotal` pada `requestItemRows`.
- `components/CreateModal.js` — auto-fill saat tambah item, recalc saat
  ganti vendor (hanya bila belum manual), filter kategori katalog, totals,
  ctx save.
- `components/ModuleView.js` — kirim `allPrItems`/`allReceivingItems` ke
  form (data yang sudah dimuat halaman; tidak ada query baru).
- `styles/globals.css` — blok `.pr-picker-row-*` (append-only).

## RLS / role

Tidak ada query baru dan tidak ada tabel baru: fitur hanya memakai data yang
sudah dimuat halaman (`materials`, `vendors`, `pr_items`, `receivings`,
`receiving_items`) dan menulis lewat jalur simpan PR existing. Izin baca/tulis
mengikuti RLS existing; penambahan kolom `price_*` (bila disetujui) akan
mewarisi RLS `pr_items`.
