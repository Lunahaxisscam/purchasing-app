# Handoff t_b3768506 — Kolom "Pilih" & checkbox Pembelian terlihat

Tanggal: 2026-10-20 · Branch: `fix/purchase-select-ui` · Commit: `6e0c1c9`
Base: `b3a14cb` (HEAD `feat/project-cost-link`, app `7e4b4ef`)
Worktree isolasi: `/home/ubuntu/dev-workspaces/purchasing-select-ui-fix`
(worktree utama, rilis immutable 3001, dan worktree agen lain TIDAK disentuh)

## 1. Root cause (terbukti, bukan dugaan)

Diukur di Chrome nyata pada PC DAT (viewport 1280x800), halaman reproduksi
minimal dengan `styles/globals.css` asli dan markup tabel Pembelian asli:

| elemen | SEBELUM (b3a14cb) | SESUDAH (6e0c1c9) |
|---|---|---|
| `input[type=checkbox]` rect | **w 0px**, h 13px | w 18px, h 18px |
| computed width | `0px` | `18px` |
| sel `<th>` | w 36px, padding 14px 18px -> **content box 0px** | w 58px, padding 8px 6px -> content box 46px |
| label kolom | (kosong) | `PILIH` |
| `elementFromPoint` di tengah checkbox | (tak ada kotak) | checkbox itu sendiri |
| horizontal scroll | — | scrollWidth 1280 = clientWidth 1280 |

Penyebab: aturan dasar `input, select, textarea { width: 100%; padding: 10px 14px;
background: white; border: 1px solid #cbd5e1 }` (styles/globals.css:541) ikut
berlaku untuk `input[type=checkbox]`. Karena sel kolom pilih hanya 34px dengan
padding 18px kiri-kanan, content box = 0px, sehingga checkbox terhitung
`width: 0px` → tidak terlihat sama sekali (bukan `display:none`, bukan
`:first-child` disembunyikan). Kolom juga tidak punya label, jadi user tidak
tahu di situ tempat mencentang.

## 2. Perubahan (3 poin)

1. `styles/globals.css` — aturan dasar input diganti
   `input:not([type='checkbox']):not([type='radio']), select, textarea`
   (root cause, berlaku seluruh aplikasi). Ditambah aturan kolom pilih:
   `.purchase-select-col` 58px/padding 8px 6px, checkbox 18x18px native +
   `accent-color: var(--primary)`, `:focus-visible` ring, `:disabled` 0.45,
   mobile card 20x20px.
2. `modules/receivings/page.jsx` — header jadi
   `<label class="purchase-select-all-label">` berisi checkbox "pilih semua"
   + teks **PILIH**; tiap `<td>` baris memakai kelas kolom; tombol
   **Proses Pembelian** saat nonaktif dapat `title` + `aria-describedby`;
   status pemilihan selalu tampil (jumlah dipilih / petunjuk
   "Pilih barang untuk satu nota/toko: centang kotak di kolom Pilih, lalu
   klik Proses Pembelian").
3. `scripts/purchase-select-ui-test/cascade_test.mjs` — tes cascade baru
   (membaca CSS/JSX nyata, mode `--git <rev>` untuk RED).

Tidak ada perubahan alur bisnis, query, DB, schema, finance, approval, atau
modul lain. `selectedIDs`/filter behavior tidak diubah.

## 3. Verifikasi

- **RED → GREEN**: `node scripts/purchase-select-ui-test/cascade_test.mjs --git b3a14cb`
  → 1/9 lolos (gagal: R1,R2,R2b,R2c,R3,R4,R5,R6, exit 1).
  Worktree → **9/9 lolos, exit 0**.
- **Regresi pembelian**: `python3 scripts/purchase-flow-test/run.py`
  → **103/103 render + 218 logic lolos, 0 gagal** (centang, pilih semua,
  buka dialog Proses Pembelian, batal tanpa tulis, belanja langsung).
- **Build**: `npm run build` di worktree → **exit 0** (BUILD_ID `1sbtVwysnmQBsOWAv0jmE`).
- **Runtime browser nyata (Chrome PC DAT, tab baru eksklusif, tab user tidak
  diusik)**: sebelum w0/h13/padding sel 18px → sesudah 18x18px, label PILIH,
  content box 46px, `elementFromPoint` = checkbox, tanpa horizontal scroll.
  Tidak ada login/DB write, tidak membaca credentials.

## 4. Rollback

`git revert 6e0c1c9` (atau `git checkout b3a14cb -- styles/globals.css modules/receivings/page.jsx`).
Staging 3001 (`purchasing-cost-b-release-20261020-1728`, BUILD_ID
`IsyQ1GHDQrxXQ6vnDTieJ`) **tidak diganti**.

## 5. Preview untuk Brooklyn

Server preview terpisah dari 3001: `http://100.91.244.41:3012`
(worktree `purchasing-select-ui-fix`, commit `6e0c1c9`).
Halaman Pembelian tetap butuh login seperti biasa.

## 6. Batas / belum

- Tidak ada push/deploy produksi (menunggu verifikasi independen Brooklyn).
- DB master import/DDL/backup, transport Bakpau live, schema handover
  per-item tetap di luar rilis ini.
