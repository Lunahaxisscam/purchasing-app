# Kebijakan Acuan Harga Material (t_090127ad)

## Ringkasan fitur

Kolom **Acuan Harga** dihilangkan dari daftar Material (desktop & mobile).
Tampilannya dipindah menjadi **rincian expandable di bawah nama material**:

- Tombol `+ Acuan Harga` di bawah NAMA membuka rincian; collapse `▲ Tutup Acuan`.
- **Default semua baris TERTUTUP** — daftar tetap ringkas (konsisten arahan
  daftar-ringkas t_cf05c96f). Expand tidak menambah jumlah parent dan tidak
  me-reset Show More (baris expand dirender di luar perhitungan limit).
- Rincian: **Vendor | Harga per satuan | Tanggal | Sumber**, bisa lebih dari
  satu vendor. Empty state: **"Belum ada acuan harga"**.
- Nama material TETAP bersih — tanpa suffix vendor/kategori.

## Sumber data (skema existing — TANPA migrasi DB)

**P1 t_e88c28fb — harga AKTUAL ≠ estimasi PR.** Barang yang sudah diterima
(`qty_received > 0`) TIDAK membuktikan `pr_items.estimated_price` = harga
beli aktual — nota bisa berbeda dari estimasi, dan `vendor_id` pada PR hanya
rencana beli (bukan bukti supplier aktual). Label **HISTORIS PEMBELIAN
hanya untuk harga satuan aktual terverifikasi dari nota/purchase line
valid**. Karena skema `pr_items` existing belum punya kolom harga aktual
(dicek read-only), entri dari penerimaan tampil sebagai kategori
terpisah **"Estimasi PR terdahulu"** — tidak dipromosikan jadi aktual agar
tidak terjadi loop `estimated → "historic" → estimasi palsu`.

| Sumber | Arti | Dari mana | Tanggal |
|---|---|---|---|
| `HISTORIS` | Harga beli **AKTUAL** terverifikasi (nota/purchase line valid) | kolom harga aktual `pr_items` (`price_actual`/`actual_price`/… — **belum ada** di skema existing) lewat `receiving_items` (qty diterima > 0, bukan Retur/Refund/Rusak) | `received_date` |
| `MASTER` | Acuan yang sudah ada di master material | `materials.harga_acuan` | **—** (tidak di-invent) |
| `PR_ESTIMATE` | **Estimasi PR terdahulu** yang barangnya sudah diterima — BUKAN harga beli | `pr_items.estimated_price` (kolom existing) lewat `receiving_items` valid | `received_date` |
| `MANUAL` | Entri "Tambah Acuan" (prototype) | state sesi (memori) | **—** (belum tersimpan) |

Urutan tampil & prioritas (resolver `modules/materials/acuan.js`):
**HISTORIS → MASTER → PR_ESTIMATE → MANUAL**. Estimasi PR terdahulu sengaja
di bawah MASTER; ia fallback terakhir dan selalu berbadge
**"⚠️ Estimasi PR terdahulu — bukan harga beli"** (netral abu-abu, bukan
hijau sukses).

Aturan mutlak yang dijaga resolver (`modules/materials/acuan.js`):

1. **Hanya pembelian terealisasi** — item penerimaan yang benar-benar diterima
   (`quantity_received > 0`) dan penerimaan bukan Retur/Refund/Rusak.
   Estimasi PR yang belum diterima BUKAN histori — dan estimasi yang sudah
   diterima TETAP estimasi (`PR_ESTIMATE`), bukan harga pembelian aktual.
2. **Relasi FK, bukan nama** — `receiving_items.pr_item_id → pr_items.id` dan
   `pr_items.material_id → materials.id`. Produk "nama mirip" tidak mungkin
   tercampur.
3. **Harga satuan murni material — aktual dulu, estimasi dilabeli eksplisit**
   — harga satuan aktual dibaca dari kolom harga aktual `pr_items`
   (`actualPurchasePrice`); bila kolom aktual tidak tersedia, yang bisa
   dibaca hanya `pr_items.estimated_price` dan entri WAJIB berkategori
   `PR_ESTIMATE` (bukan HISTORIS). `[Nominal]` di note receivings sengaja
   TIDAK dipakai dan TIDAK menjadi fallback "harga aktual" (itu total nota
   yang bisa mengandung ongkir/admin — total invoice ≠ unit price).
4. **Satuan tanpa konversi** — entri historis hanya dihitung bila satuan item
   PR sama dengan satuan master material (per Meter ≠ per Pcs tanpa faktor
   valid yang tersimpan).
5. **Data lama jujur** — `harga_acuan` existing tampil sebagai sumber MASTER
   TANPA tanggal & vendor yang dikarang.
6. **Data historis read-only** — UI tidak pernah menulis/mengubah sumber
   HISTORIS/MASTER/PR_ESTIMATE. Provenance bacaan skema dipertahankan:
   entri membawa `provenance: 'actual' | 'unknown'` — `unknown` bila harga
   yang terbaca masih estimasi (kolom actual belum ada); sumber tidak pernah
   diklaim lebih pasti daripada skema yang ada.
7. Vendor penerimaan kosong tampil "Tidak dicatat" — tidak dikira-kira.
   Vendor referensi PR/estimasi TIDAK dianggap supplier aktual.

## Keterbatasan prototype MANUAL (WAJIB dibaca)

**Entri manual BELUM TERSIMPAN ke database.** DAT membekukan migrasi DB, dan
skema existing tidak punya tabel untuk ledger harga per material per vendor —
opsi `material_price_history` / `vendor_prices` / dsb. tidak ada di Supabase
(dicek read-only). Menyimpan ledger ke kolom `note`/localStorage dilarang
arahan DAT, jadi:

- Form "Tambah Acuan" tampil & memvalidasi input (vendor wajib, harga > 0,
  satuan wajib — `validateManualAcuan`).
- Entri yang disimpan hanya hidup di **memori sesi** (`manualAcuanRef` di
  `components/ModuleView.js`) dan selalu diberi badge
  **"✍️ Manual — belum tersimpan"** + catatan peringatan di bawah tabel.
- Refresh halaman / pindah modul menghilangkan entri manual. **Jangan gunakan
  sebagai data resmi** sebelum skema disetujui.

**Kebutuhan skema yang diusulkan ke DAT (menunggu izin, belum dieksekusi):**

```sql
create table material_price_refs (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  vendor_id uuid references vendors(id) on delete set null,
  price numeric not null check (price > 0),
  unit text not null,
  source text not null default 'MANUAL' check (source in ('MANUAL')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
```

Setelah izin diberi, resolver tinggal menambah pembacaan tabel ini (sumber
MANUAL jadi persisten) tanpa mengubah UI.

**Kebutuhan skema untuk HISTORIS AKTUAL (P1 t_e88c28fb — usulan ke DAT,
menunggu izin, belum dieksekusi):** kategori `HISTORIS` di atas butuh kolom
harga satuan aktual hasil penerimaan. Tanpa kolom itu, yang bisa dibaca
resolver dari skema existing hanya estimasi PR (kategori `PR_ESTIMATE`).
Usulan minimal (salah satu bentuk, menunggu keputusan DAT):

```sql
-- Opsional A: kolom aktual di baris item PR (diisi dari nota saat receiving)
alter table pr_items add column price_actual numeric check (price_actual is null or price_actual > 0);
-- Opsional B: ledger harga aktual per material+vendor (lanjutan tabel MANUAL di atas)
```

Setelah skema actual disetujui, resolver otomatis mengisi kategori
`HISTORIS` (bacaan `actualPurchasePrice` sudah menerima kolom
`price_actual`/`actual_price`/…) — TANPA mengubah UI, dan `PR_ESTIMATE`
tetap tampil terpisah apa adanya. Tidak ada migrasi/penulisan finance live
yang dieksekusi sebelum izin.

## File yang berubah

- `modules/materials/acuan.js` (baru) — resolver satu sumber (dipakai juga
  estimator PR di t_ac0b39c0 agar konsisten).
- `modules/materials/view.jsx` — cell Nama (+ tombol), rowExpand rincian,
  kartu mobile tanpa baris Acuan Harga statis + panel expand.
- `components/ModuleView.js` — state `expandedAcuan`, prototype form manual,
  helper `A` (makeAcuanHelpers), reset saat pindah modul.
- `lib/constants.js` — kolom `harga_acuan` dihapus dari `headersFor`
  (field DB & nilai existing TETAP; form edit material tidak diubah).
- `styles/globals.css` — blok `.acuan-*` (append-only).

## RLS / role

Prototype manual memakai data yang sudah dimuat halaman (tidak ada query baru,
tidak ada penulisan), sehingga mengikuti izin baca existing. Bila penyimpanan
manual diaktifkan nanti, insert-nya wajib mengikuti izin edit material
(halaman Materials memang diakses semua role; form edit material tidak
membatasi role — batasan akhir ditentukan RLS tabel baru di atas).
