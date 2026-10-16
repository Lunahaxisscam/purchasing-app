# Catatan Approval: hanya catatan pengguna (t_1fe52e80)

## Masalah

Kolom **Catatan** di modul Approval mengisi teks otomatis
`"Menunggu persetujuan Direksi / PM untuk PR-xxx"` untuk setiap approval baru
yang dibuat/diaktifkan lewat tombol ✓ Selesai di modul PR (`finishPr()` di
`pages/index.js`). Teks ini menyerupai catatan padahal belum ada keputusan —
menimpa catatan revisi lama saat PR dikirim ulang, dan membuat kolom Catatan
tidak bisa dipakai untuk membedakan antrean yang punya catatan vs tidak.

## Perbaikan

### 1. Hentikan penyemaian otomatis (sumber kebenaran: DB `null` by default)

`pages/index.js` → `finishPr()` — dua jalur:

| Jalur | Sebelum | Sesudah |
|---|---|---|
| PR pernah direvisi (step lama diaktifkan ulang) | `update({ status:'PENDING', decided_at:null, note: 'Menunggu persetujuan…' })` | `update({ status:'PENDING', decided_at:null })` — note **tidak disentuh** |
| Approval baru (insert) | `insert({ …, status:'PENDING', note: 'Menunggu persetujuan…' })` | `insert({ …, status:'PENDING' })` — note **null** by default |

Catatan revisi lama kini dipertahankan saat PR dikirim ulang (dulunya tertimpa
teks otomatis). Catatan keputusan (`executeDecision`) tetap hanya diisi jika
pengguna mengetik — sudah diperbaiki di t_0e958a72, tidak diubah.

### 2. Render catatan (modules/approvals/view.jsx)

- Kolom desktop `Catatan` (dulu memakai generik `renderGenericCell` yang
  menampilkan `r.note` mentah) kini ditangani `renderCell` milik modul via
  `displayNote(r)`.
- Kartu mobile memakai `displayNote(r)` juga.
- Approval pending tanpa catatan:
  - Desktop → dash `—` (via `format(null)`).
  - Mobile → antrean Menunggu sengaja tanpa blok Catatan (desain antrean
    mobile yang sudah ada, perilaku t_0a35264f dipertahankan identik).

### 3. Data legacy — tampil dash saat render, TIDAK ada mutasi DB

Baris lama yang pernah disemai otomatis tetap tersimpan utuh di DB. Saat
render, teksnya diganti dash memakai deteksi dua lapis (`isLegacyAutoNote`):

1. **Metadata**: hanya `step_number === 1` **dan** `decided_at` kosong
   (pending). Catatan keputusan selalu punya `decided_at`, jadi tidak pernah
   lolos gerbang ini — apa pun teksnya.
2. **Teks exact-match** (setelah trim) terhadap pola yang dijaga ketat di
   `LEGACY_AUTO_NOTE_PATTERNS` — saat ini satu-satunya:
   `/^Menunggu persetujuan Direksi \/ PM untuk .*$/`
   (satu-satunya sumber: template literal di `finishPr()` sebelum task ini).

Tidak ada UPDATE/DELETE massal, tidak ada migrasi, tidak ada script cleanup.

## Keterbatasan identifikasi legacy (dokumentasi jujur)

- **False positive yang tak terhindarkan**: bila pengguna lama sengaja
  mengetik catatan yang **100% identik** dengan pola auto pada step-1 yang
  masih pending, catatan itu akan tampil sebagai dash. Tidak ada kolom
  provenance/pembuat di `approval_steps`, sehingga kasus ini tidak bisa
  dibedakan dari luar. Tidak dilakukan cleanup palsu atas data ini — isinya
  tetap utuh di DB dan tetap bisa dibaca lewat export/SQL.
- **Pola lama lain tidak dikenal**: bila ada versi aplikasi lebih tua yang
  memakai template auto berbeda (belum ditemukan jejaknya di kode/git), teks
  itu akan tetap tampil apa adanya — tidak disembunyikan, tidak dipalsukan.
  Menambah pola baru cukup menambah 1 entri di `LEGACY_AUTO_NOTE_PATTERNS`.
- Deteksi hanya aktif untuk modul Approval (`modules/approvals/view.jsx`);
  Dashboard dan export lain tetap menampilkan data mentah (tidak dimutasi).

## Uji (56 cek lulus, 0 gagal)

`python3 scripts/approval-queue-test/run.py` — skenario A–G (perilaku lama:
default antrean Menunggu, empty state, tab riwayat, reset, refresh, keputusan,
regresi modul lain) tetap hijau; skenario H baru mencakup:

- H.1 approval baru: kolom Catatan desktop = dash; teks auto tidak tampil.
- H.2 legacy exact-pattern: baris tetap ada, Catatan = dash (tanpa hapus data).
- H.3 catatan keputusan pengguna tampil utuh.
- H.4 catatan pengguna yang mengandung kata "Menunggu" **tidak** disembunyikan.
- H.5 kartu mobile: pending baru & legacy identik tanpa blok Catatan; riwayat
  tanpa catatan tetap dash (perilaku lama).
- H.6 unit `isLegacyAutoNote`/`displayNote`: exact match, substring tidak,
  `decided_at` guard, `step_number` guard, null, whitespace, fallback "PR".

`npm run build` terisolasi (sandbox /tmp, bukan `.next` aktif): hijau,
termasuk `/__smoke`.

## Batasan

- Tidak ada migrasi DB, tidak ada deploy produksi, tidak ada mutasi massal.
- File lain yang sedang dikerjakan worker lain (ModuleView.js dll.) tidak
  disentuh; commit bersifat selektif per-hunk.
