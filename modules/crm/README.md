# Modul CRM Customer (t_7253b859)

Halaman customer CRM minimal untuk Noir Living: daftar customer, pencarian,
form tambah (draf memori), dan selector yang bisa dipakai ulang modul lain.

## Status

READ-ONLY dari sisi database. Tidak ada tabel `customers`, tidak ada RPC,
tidak ada migrasi baru, tidak ada penulisan ke Supabase, tidak ada localStorage.
Customer yang ditambahkan dari form hidup sebagai **draf memori halaman** dan
setiap barisnya diberi label "Draf halaman".

## File

| File | Isi |
|---|---|
| `modules/crm/logic.js` | Logika murni: baca/normalisasi baris, filter, validasi, duplikat, ringkasan, relasi, CSV |
| `modules/crm/selector.jsx` | `<CustomerSelector />` reusable — pakai dari modul lain |
| `modules/crm/view.jsx` | Halaman CRM: KPI, toolbar, tabel, drawer detail, form draf |
| `scripts/crm-test/run.py` | Harness test (logika murni + render + responsif) |

## Kontrak data

Host mengirim:

- `customers` — array baris customer. Nama field alternatif yang dibaca:
  `name`/`customer_name`/`nama`, `phone`/`whatsapp`/`customer_phone`/`telp`,
  `email`/`mail`, `address`/`project_address`/`alamat`, `source`/`sumber`,
  `notes`/`note`/`catatan`, `id`, `created_at`. Baris tanpa nama dibuang.
- `invoiceCounts` — `{ <customer_id>: <jumlah invoice> }` opsional.

### Capability sumber

| Nilai | Arti | Tampilan |
|---|---|---|
| `unavailable` | host tidak mengirim prop `customers` sama sekali | panel penjelasan, bukan daftar kosong |
| `empty` | array kosong dikirim | "Belum ada customer terdata" |
| `ready` | ada baris | daftar baca |

## Aturan kejujuran

- Kontak yang kosong ditulis "Tidak tersedia" — tidak dibiarkan string kosong
  yang terbaca seperti "tidak perlu dihubungi".
- Hitungan relasi invoice yang tidak dikirim host ditulis
  "Relasi invoice tidak dikirim ke halaman ini" — **bukan 0** (0 terbaca
  seperti "tidak pernah dirujuk").
- Tidak ada customer contoh. Daftar kosong berarti kosong.
- Perubahan pada baris dari host tidak dikirim ke mana pun; tombol aksi baris
  host ditulis "Baca saja".
- Validasi client-side: nama wajib (min 2 karakter), nomor WA ≥ 8 digit,
  format email. Duplikat nama/WA muncul sebagai **peringatan**, bukan penolakan.

## Pencarian

Nama, WA, email, alamat, dan sumber dicocokkan case-insensitive. Nomor WA
dinormalkan (`62…` → `0…`, tanda baca dibuang) supaya `0812-3456` tetap
menemukan `628123456`. Minimal 3 digit untuk pencocokan lewat nomor.

## Test

```
python3 scripts/crm-test/run.py
```

Menjalankan tiga tahap: unit logika murni (Node), render server-side
(react-dom/server), dan cek responsif + kontrak kejujuran pada markup.
