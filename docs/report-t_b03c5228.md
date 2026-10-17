# Laporan Eksekusi — t_b03c5228 (S2/7)

**Card:** [S2/7] Ringkas Handover dan pisahkan tanggung jawab fisik
**Owner:** bamboo-tech · **Tanggal:** 18 Okt 2026
**Branch:** `feat/ops-workflow-t_cde1b8ad` (base: `main` @ `18fb594`)
**Kontrak & keputusan:** `docs/handover-compact-contract.md`

---

## 1. Hasil dalam satu paragraf

Modul Handover kini memegang **satu-satunya** keputusan fisik barang, dengan
tampilan ringkas: tiga aksi (**📦 Gudang · 👷 Tukang · ⚠ Bermasalah**) di satu
baris, di mana Bermasalah sengaja tidak ditonjolkan; "Tandai Diserahkan" turun
menjadi **langkah penutup** karena ia bukti penerimaan, bukan langkah
distribusi. Seluruh **status teknis disembunyikan** — `KE_GUDANG`/`KE_TUKANG`/
`LANGSUNG_LAPANGAN` menjadi "Tujuan: Gudang/Tukang/Langsung ke lapangan",
`RETUR`/`REFUND` menjadi satu label "⚠ Nota bermasalah". Aksi Bermasalah
memakai **handler shell yang sudah ada** (`receivings.status` + `kendala`) tanpa
satu pun tulisan DB baru, tanpa migrasi, dan tanpa menyentuh kontrak
`actions.js`/`logic.js`. Rincian barang dan label jujur "Rincian barang belum
tersedia" dipertahankan; fallback data lama juga, dengan satu defect nyata
diperbaiki: handover tanpa nota dulu punya tombol distribusi **aktif** yang
"berhasil" tanpa mengubah apa pun — sekarang nonaktif dengan alasan terbaca.
Dua harness baru (86 + 52 assertion) plus e2e Chrome sungguhan (31 assertion)
membuktikan visibilitas aksi, tidak adanya field fisik ganda, dan nol overflow
horizontal di 4 viewport.

---

## 2. Perubahan per file

### `modules/handovers/queue.jsx` (ditulis ulang, ~455 baris)

- **3 aksi fisik satu baris**: `queue-primary-<id>` berisi Gudang, Tukang,
  Bermasalah. Bermasalah memakai gaya subtle (border putus-putus, 11.5px, tanpa
  warna aksi) — tidak menyolok, tapi tetap satu baris dengan aksi lain.
- **Panel Bermasalah** (`queue-problem-panel-<id>`): `↩ Retur ke Supplier` /
  `💸 Refund`, atau **alasan penolakan** bila tidak bisa dijalankan.
- **Langkah penutup** (`queue-finish-<id>`): label "Langkah penutup — setelah
  barang benar-benar diterima di lokasi" + tombol Tandai Diserahkan + form nama
  penerima (muncul hanya setelah tombol ditekan).
- **Rincian barang** (`queue-detail-<id>`, collapsed): nama barang + qty beli,
  diberi keterangan eksplisit "qty beli di nota" dan "Jumlah serah terima per
  item belum tercatat terpisah" — tidak menebak jumlah diserahkan dari
  `quantity_received` (kontrak `t_b418827b`).
- **Fungsi murni baru yang diekspor**: `alokasiLabel()` (kode DB → kalimat),
  `isProblemNoted()`, `problemPlan()`, `PROBLEM_OPTIONS`.
- **Lapisan tampilan di atas `actionPlan`**: nota bermasalah menutup aksi
  gudang/tukang; handover tanpa nota menutup keduanya. `logic.js` tidak diubah —
  pemetaan ini terjadi setelah `actionPlan()` dipanggil.
- `ACTIONS` tetap diekspor (kompatibilitas impor lama).

### `modules/handovers/view.jsx` (perubahan terbatas)

- Impor `alokasiLabel` + `isProblemNoted` dari `queue.jsx`.
- Kolom **Status** menampilkan `⚠ Nota bermasalah` (`problem-<id>`) bila
  `receivings.status`/`kendala` menunjukkan Retur/Refund/Rusak — satu label
  manusia, bukan kode.
- Label `Pengirim/Gudang` (yang dulu menampilkan kode `KE_TUKANG` mentah)
  diganti **`Tujuan barang`** dengan nilai manusia di detail desktop **dan**
  detail kartu mobile.
- Kartu mobile menampilkan catatan `⚠ Nota bermasalah …`
  (`problem-mobile-<id>`), paralel dengan desktop.
- **Tidak berubah**: filter bukti fisik, kolom Barang, aksi baris (✓/✏️/🗑️),
  prototype panel, modal edit/tambah, bukti foto.

### `scripts/handover-compact-test/` (baru, 4 file)

| File | Isi |
|---|---|
| `run.py` | sandbox `/tmp/handover-compact-verify` — salin VERBATIM sumber, mock supabase perekam, transform SWC, jalankan 2 test |
| `queue_ui_test.mjs` | **87 assertion** — A1–A13: visibilitas aksi, status teknis disembunyikan, label jujur, alasan tiap tombol nonaktif, nota bermasalah, fallback legacy, delegasi handler shell, multi-item ditolak, tidak ada field fisik ganda |
| `purchase_scope_test.mjs` | **52 assertion** — B1–B5: Purchase tanpa kontrol fisik, status/kendala tidak tampil, token kolom fisik tidak bocor, jalur simpan tidak menulis kolom fisik, Handover satu-satunya pemilik aksi fisik |
| `e2e_runtime_test.mjs` | **35 assertion** — Chrome CDP pada `/__smoke`: 3 tombol benar-benar terlihat & satu baris, kode status tidak bocor, nol overflow di 1440/1280/390/360, 3 aksi tidak terpotong di HP, nol request mutasi DB |

### `scripts/pr-purchase-compact-test/render_test.mjs` (1 assertion disesuaikan)

Assertion lama `tidak ada file modules/handovers/ yang berubah` **mustahil**
dipenuhi kartu S2 (pemilik `queue.jsx`/`view.jsx`). Diganti dengan assertion
yang lebih tepat: `modules/handovers/` hanya boleh berisi `queue.jsx` +
`view.jsx` — jadi `actions.js`/`logic.js` tetap terkunci. Larangan migrasi,
materials, dan vendors tidak berubah. Alasan lengkap ada di komentar file itu
dan §7 kontrak.

### `docs/handover-compact-contract.md` (baru)

Kontrak lengkap: tanggung jawab, anatomi kartu, tabel status teknis yang
disembunyikan, aturan aksi Bermasalah + semua jalur penolakan, fallback data
lama, daftar kontrak yang tidak diubah, dan verifikasi.

---

## 3. Keputusan yang perlu diketahui reviewer

**a) "Tandai Diserahkan" bukan aksi keempat.** Aksi distribusi mengubah letak
barang; `diserahkan_at` mengubah klaim "barang sudah diterima di lokasi"
(dimensi berbeda, kontrak `t_b418827b`). Kalau disejajarkan, user bisa mengira
"diserahkan" adalah alternatif "kirim ke tukang". Ia tetap memakai
`runHandoverAction(ACT_TERIMA, …)` yang sama.

**b) Bermasalah memakai handler shell, bukan Supabase langsung.** `queue.jsx`
memanggil `ctx.onReceivingStatusChange` — satu jalur tulis status nota di
seluruh aplikasi, guard multi-item yang sudah ada ikut berlaku, dan tidak ada
ketergantungan DB baru di file ini (dibuktikan: nol `update`/`insert`).

**c) Bermasalah pada nota multi-item ditolak, bukan disembunyikan.** Handler
shell memang menolak mengubah status parent multi-item. Menampilkan tombolnya
akan memberi ilusi tersimpan — jadi panel menampilkan alasan skemanya.

**d) Handover tanpa nota: tombol distribusi dinonaktifkan.** Defect nyata yang
ditemukan: `actionPlan` mengizinkan aksi, lalu `actions.js` → `loadContext`
mendapat `receiving: null` dan mengembalikan "berhasil" tanpa menulis apa pun.
Kartu tetap tampil (fallback data lama dijaga), tapi aksinya nonaktif dengan
alasan terbaca.

**e) `ACTIONS` (label "Tandai Diserahkan") tetap diekspor dari `queue.jsx`.**
Tidak ada yang mengimpornya saat ini, tapi menghapusnya akan memutus
kompatibilitas impor lama tanpa manfaat.

---

## 4. Bukti verifikasi (dijalankan ulang setelah perubahan terakhir)

```
scripts/handover-compact-test   QUEUE 87 + PURCHASE 52          / 0 GAGAL   ← baru
scripts/handover-compact-test/e2e (Chrome CDP)  35              / 0 GAGAL   ← baru
scripts/handover-flow-test      logic 61 + queue 66 + render 73 / 0 GAGAL
scripts/purchase-flow-test      178 + 90                        / 0 GAGAL
scripts/pr-purchase-compact-test  20 + 130                      / 0 GAGAL
scripts/pr-estimator-test       48 + 47 + 14                    / 0 GAGAL
scripts/pr-group-test           31 + 54                         / 0 GAGAL
scripts/showmore-list-test      49                              / 0 GAGAL
scripts/fase2-save-test         56                              / 0 GAGAL
scripts/approval-queue-test     56                              / 0 GAGAL
ENABLE_SMOKE=1 npx next build   hijau
```

E2E memakai build smoke sungguhan (`next start` port 3162) — 31/31 hijau,
termasuk 8 assertion overflow (4 viewport × body + kartu antrean) dan
`mutationRequests === 0` selama pemeriksaan tampilan.

---

## 5. Yang TIDAK dikerjakan (di luar batas / butuh keputusan)

- **Tidak ada migrasi / kolom / tabel baru.** Retur/Refund tetap memakai
  `receivings.status` + `receivings.kendala` yang sudah ada.
- **`modules/handovers/actions.js` dan `logic.js` tidak disentuh** — kontrak
  penulis DB & aturan aksi tetap.
- **`modules/receivings/*` tidak diubah** (milik S1) — hanya diverifikasi ulang
  lewat `purchase_scope_test`.
- **`components/*`, `lib/*`, `modules/shared/*`, `modules/registry.js`,
  `styles/globals.css`, `migrations/*`** tidak disentuh.
- **Retur/Refund per barang** (bukan status nota) butuh `receiving_events` +
  `handover_items` — masih beku di `docs/handover-gap-proposal.md`.
- **Dialog tukang lengkap** (nama wajib + tanggal + foto + catatan dalam satu
  dialog) belum dibuat: kolomnya belum ada. Yang tersedia sekarang: tombol
  "Serah Terima ke Tukang" (menulis `receivings.tukang_at` + `pr_items.status`)
  dan langkah penutup dengan nama penerima (`handovers.received_by`).

---

## 6. Catatan lingkungan

- Branch `feat/ops-workflow-t_cde1b8ad` melanjutkan commit `8811bbd` (S1).
- `npx next start` dijalankan di port **3162** untuk e2e; sudah dimatikan
  setelah verifikasi. Build smoke terakhir ada di `.next` worktree ini.
- `scripts/handover-compact-test/` belum terdaftar di `modules/registry.js`
  (file CORE, milik Tech Lead) — perlu didaftarkan agar muncul di manifest.
