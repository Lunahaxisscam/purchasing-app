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

| Sumber | Arti | Dari mana | Tanggal |
|---|---|---|---|
| `HISTORIS` | Harga TEREALISASI pembelian nyata | `receiving_items` (qty diterima > 0) → `pr_items` (`material_id`, `vendor_id`, `estimated_price`, `unit`) → `receivings` (`vendor_id`, `received_date`) | `received_date` |
| `MASTER` | Acuan yang sudah ada di master material | `materials.harga_acuan` | **—** (tidak di-invent) |
| `MANUAL` | Entri "Tambah Acuan" (prototype) | state sesi (memori) | **—** (belum tersimpan) |

Aturan mutlak yang dijaga resolver (`modules/materials/acuan.js`):

1. **Hanya pembelian terealisasi** — item penerimaan yang benar-benar diterima
   (`quantity_received > 0`) dan penerimaan bukan Retur/Refund/Rusak.
   Estimasi PR yang belum diterima BUKAN histori.
2. **Relasi FK, bukan nama** — `receiving_items.pr_item_id → pr_items.id` dan
   `pr_items.material_id → materials.id`. Produk "nama mirip" tidak mungkin
   tercampur.
3. **Harga satuan murni material** — dari `pr_items.estimated_price`.
   `[Nominal]` di note receivings sengaja TIDAK dipakai (itu total nota yang
   bisa mengandung ongkir/admin).
4. **Satuan tanpa konversi** — entri historis hanya dihitung bila satuan item
   PR sama dengan satuan master material (per Meter ≠ per Pcs tanpa faktor
   valid yang tersimpan).
5. **Data lama jujur** — `harga_acuan` existing tampil sebagai sumber MASTER
   TANPA tanggal & vendor yang dikarang.
6. **Data historis read-only** — UI tidak pernah menulis/mengubah sumber
   HISTORIS/MASTER.
7. Vendor penerimaan kosong tampil "Tidak dicatat" — tidak dikira-kira.

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
