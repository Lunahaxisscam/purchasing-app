# Dashboard Actual Labor & Workshop Stock (t_62e41e91)

Halaman admin-only yang menggabungkan dua ringkasan: **Actual Labor**
(upah tukang yang benar-benar tercatat) dan **Workshop Stock** (bahan
gudang). Read-only dari sisi DB.

## Sumber data (kontrak prop)

| Bagian | Prop | Sumber | Bila tidak dikirim |
|---|---|---|---|
| Actual Labor (aktual) | `laborRows` (fallback `rows.tukang_projects`) | tabel `tukang_projects` — sync Google Sheets tim finance via daemon Drive sync | panel "Sumber data belum dikirim", bukan daftar kosong, bukan angka 0 |
| Actual Labor (estimasi) | `estimateRows` | `project_plans.labor_cost` (rencana) | kolom estimasi ditulis "Tidak dikirim"; **tidak ada estimasi yang dikarang** |
| Workshop Stock | `materials` (fallback `rows.materials`) | tabel `materials` (katalog master) | panel "Sumber data belum tersedia", bukan angka 0 |

Catatan: `estimateRows` hanya diterima lewat prop (tidak ditarik dari
`rows`) supaya status "tidak dikirim" tidak tertukar dengan "kosong".

## Aturan estimasi vs aktual

- **Estimasi** = rencana yang bisa berubah (`project_plans.labor_cost`).
- **Aktual** = uang yang sudah tercatat keluar (`tukang_projects.total_upah`).
- Keduanya **tidak pernah dijumlahkan** dan tidak saling ditukar.
- Selisih hanya dihitung bila KEDUA angka ada; kalau tidak, selisih
  ditulis "Tidak tersedia".
- Nilai yang tidak ada di baris ditulis "Tidak tersedia" — bukan 0,
  karena 0 terbaca "aktual nol rupiah".

## Status kelengkapan (per project)

| State | Arti |
|---|---|
| `LENGKAP` | ada estimasi dan aktual — bisa dibandingkan |
| `AKTUAL_SAJA` | aktual tercatat, estimasi tidak dikirim |
| `ESTIMASI_SAJA` | ada rencana, aktual belum tercatat |
| `KOSONG` | keduanya belum ada / belum dikirim |

## Fitur

- Filter project, periode (batch), dan pencarian bebas (bagian labor).
- Filter kategori dan pencarian (bagian stok).
- Ekspor CSV client-side — hanya baris & kolom yang sudah tampil;
  nilai kosong diekspor sebagai string kosong, bukan 0.
- Read-only: tidak ada INSERT/UPDATE/RPC/migrasi/localStorage, dan
  formula finance tidak disentuh.

## Verifikasi

```
python3 scripts/labor-stock-test/run.py
```

Cakupan harness: `logic_test.mjs` (fungsi murni: capability, estimasi
vs aktual, status kelengkapan, filter, CSV), `render_test.mjs` (render
nyata via jsdom: panel missing-source, label "Tidak tersedia", bukan 0),
`responsive_test.mjs` (360/390/768/1440 + kontrak CSS no-overflow).
