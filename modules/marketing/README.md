# Modul Marketing / Lead Pipeline (t_31a1a9f9)

Prototype halaman Marketing untuk melihat lead dari "masuk" sampai "menang":
New Lead → Qualified → RAB → Won/Lost, plus tag sumber/kampanye, aksi
berikutnya, dan tautan ke customer CRM.

Modul ini **read-only dari sisi database**. Tidak membuat tabel, tidak
memanggil RPC, tidak menambah migrasi, dan tidak menyentuh formula finance
atau modul lain.

## Kenapa read-only

Belum ada keputusan skema untuk lead (siapa pemilik lead, bagaimana lead
dipindah tahap, apakah satu lead bisa punya beberapa penawaran). Kalau modul
ini langsung menulis DB, skema yang belum diputuskan akan terkunci di kode.
Prototype ini membuat alur dan tampilannya bisa dipakai dan dinilai dulu;
penyimpanan menyusul setelah keputusan itu ada.

## File

| File | Isi |
| --- | --- |
| `modules/marketing/logic.js` | Logika murni (tanpa React/DOM/DB). Bisa diuji headless. |
| `modules/marketing/view.jsx` | Papan pipeline, filter, form draf, drawer detail, ekspor CSV. |
| `scripts/marketing-test/run.py` | Runner verifikasi (compile + logika + render + responsif). |

CSS modul ini punya blok sendiri di `styles/globals.css` dengan prefix `mk-`.

## Sumber data

- Lead: prop `leads` dari host, atau `rows.leads` kalau host sudah memuatnya.
  Nama field alternatif yang diterima: `lead_name`, `nama`, `customer_name`,
  `stage`/`status`/`tahap`, `source`/`sumber`/`channel`, `campaign`/`kampanye`,
  `next_action`/`next_step`, `next_action_date`/`due_date`, `customer_id`/
  `crm_customer_id`.
- Customer CRM: prop `customers` atau `rows.customers` (bentuk sama seperti
  data yang dipakai `modules/crm/selector.jsx`).

Host belum mengirim sumber lead sama sekali (`undefined`/`null`) ditandai
terpisah dari "sumber ada tapi kosong":

| Keadaan | Artinya | Yang tampil |
| --- | --- | --- |
| `unavailable` | host tidak mengirim sumber lead | Panel penjelasan, bukan papan kosong |
| `empty` | host mengirim array kosong | "Belum ada lead terdata" |
| `ready` | ada baris lead | Papan pipeline |

Tidak ada lead contoh yang disuntikkan supaya halaman terlihat hidup — papan
kosong berarti kosong.

## Lead baru dari form = draf memori halaman

Tidak ada tabel `leads` yang dibuat atau ditulis. Lead yang ditambahkan lewat
form hidup di state React halaman, diberi label **"Draf halaman"** di setiap
kartunya, dan hilang saat halaman dimuat ulang. Itu disebutkan di layar, di
catatan form, dan di setiap pesan setelah submit — bukan disembunyikan.

Kartu lead yang berasal dari host bersifat baca saja: tombol Ubah/Hapus hanya
muncul untuk draf.

## Tahap yang tidak dikenali

Lead dengan tahap yang tidak bisa dibaca **tidak** dipaksa masuk "New Lead".
Ia ditaruh di ember sendiri bertanda "Tahap tidak diketahui" supaya bisa
diperbaiki. Validasi form menolak nilai tahap yang bukan tahap sah, supaya
draf baru tidak bisa masuk ke ember itu.

## Nilai yang tidak ada

- Sumber/kampanye kosong → "Tidak tersedia", bukan teks kosong.
- Aksi berikutnya kosong → "Belum ada aksi berikutnya", supaya tidak terbaca
  seperti "tidak ada tindakan".
- Tanggal aksi kosong → tanpa tanggal, bukan 1 Januari 1970.
- Tanggal aksi yang sudah lewat ditandai "Terlambat", bukan dihitung 0.

## Tautan ke customer CRM

Empat keadaan yang dibedakan karena maknanya berbeda:

| State | Artinya |
| --- | --- |
| `linked` | `customer_id` ada dan ditemukan di data CRM yang dikirim |
| `missing` | `customer_id` kosong — belum ditautkan |
| `unresolved` | `customer_id` ada tapi tidak ada di data CRM yang dikirim |
| `unknown` | host tidak mengirim data CRM sama sekali — sumber tidak dikirim, **bukan** "tidak ditemukan" |

## Verifikasi

```
python3 scripts/marketing-test/run.py
```

Runner menjalankan: compile `logic.js`/`view.jsx` (Babel, seperti modul lain),
uji logika (normalisasi tahap, capability, filter, validasi, CSV), render headless
pada tiga keadaan sumber (unavailable/empty/ready), dan cek aturan CSS
(prefix `mk-` + tidak ada selektor tanpa prefix + modul lain tidak disentuh).
