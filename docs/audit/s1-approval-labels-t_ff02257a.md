# Laporan Audit Label — [S1/7] Estimasi vs Aktual & Approval Compact (t_ff02257a)

Run bandeng #125 · 18 Okt 2026 · base main@18fb594 · branch `feat/approvals-s1-audit` · worktree `wt-s1-approvals`

## 1. Contoh perubahan (diff per file)

| File | Perubahan | Hak akses |
|---|---|---|
| `lib/constants.js` | `headersFor('approvals')`: 9 kolom → **5 kolom compact** (`pr_number, project_name, title, step_number, status`) dengan komentar sumber t_ff02257a. Hanya entri ini; `navSections`/`labels`/RAB **tidak disentuh**. | Explicit OK (Brooklyn) |
| `modules/approvals/view.jsx` | (a) **desktopRow jalur compact** — SATU baris per PR: `No. PR / Project / Judul / Step / Status / Total Estimasi (snapshot) / Diputuskan / Rincian / Aksi`, dengan Total Estimasi snapshot `(belum lengkap — N item belum ada harga)` saat ada item tanpa harga; (b) jangkar drawer `≡ Rincian` di jalur compact + `rowActions.detailBtn` (gantikan tombol expandable `▼ Material`, permintaan penyebab TypeError run feedback) di **desktop & mobile**; (c) hook modal `receiptForm(ctx)` → render drawer; (d) `savedPriceOf` diekspor (sama untuk drawer). **Jalur lama (9-kolom) 100% dipertahankan** — tidak ada regresi. | Ownership bandeng |
| `modules/approvals/detailDrawer.jsx` *(BARU)* | Drawer detail read-only (portal `document.body`, bukan di dalam tbody): identitas PR, status, catatan (`displayNote`, anggota t_1fe52e80 — catatan tolak/revisi pengguna utuh, auto-seed legacy = dash), rincian material per grup kategori dengan subtotal (sumber & aturan skip sama pada view.jsx), Total Estimasi snapshot dengan label jujur. **Tanpa tombol keputusan; tanpa tulis DB.** | Ownership bandeng |
| `components/ModuleView.js` | (a) state `approvalDetailId` untuk drawer; (b) reset drawer saat pindah modul; (c) injecting state ke ctx. Tidak ada perubahan lain. | Explicit OK (Brooklyn) |
| `modules/shared/renderModuleCell.jsx` | Komentar semata — hook `renderModuleModal` sudah generik per modul; tidak ada perubahan logika. | Explicit OK (Brooklyn) |
| `scripts/approval-queue-test/render_test.mjs` | Asersi H.3/H.4 dibaca via drawer compact (kontrak S1); **3 asersi negatif baru** (total parsial ≠ klaim lengkap; drawer keputusan kosong = dash; drawer tutup). Mock PR_ITEMS + 2 (riwayat dgn harga snapshot). | Test S1 |

**Label yang dihilangkan dari daftar (pindah ke drawer, tidak hilang datanya):** `items`, `items_qty`, `note`, `decided_at`.

## 2. Audit LABEL ESTIMASI vs AKTUAL yang TAMPIL bagi pengguna

Sumber kejujuran: snapshot `pr_items.estimated_price` × qty (t_ac0b39c0).

| Permukaan | Label ditemukan | Status | Verifikasi |
|---|---|---|---|
| Approval — daftar compact (desktop) | `Total Estimasi: Rp X` + `belum lengkap — N item belum ada harga` saat ada item tanpa harga; tanpa item → dash `—`. **Tidak ada `Rp 0` palsu; tidak klaim "lengkap" pada total parsial.** | **Baru (solusi S1)** | Harness A + negatif `59/0` |
| Approval — drawer detail | `Total Estimasi (belum lengkap): Rp X — N item belum ada harga`; per-item tanpa harga → `belum ada harga` (bukan 0); subtotal grup hanya dari harga valid. | **Baru**, sumber & semantik sama pada view.jsx (t_ac0b39c0) | Harness H + negatif (drawer dibuka stlh klik `≡ Rincian`) |
| Approval — baris lama 9-kolom (fallback) & panel perluasan & mobile card | Tidak berubah — jalur lama utuh. | Tetap t_e88c28fb | Harness B–G + diff 0 |

## 3. Perilaku yang TIDAK berubah (anti-regresi)

- Status/steps/histori approval: **read-only UI**; keputusan (Setujui/Tolak/Revisi) tetap di baris/kartu daftar via `onDecideApproval` / `onReviseApproval` alur lama → pages/index.js `executeDecision`.
- **Tanpa migrasi DB**; **tanpa tulis DB dari drawer**; data legacy tidak dihapus; kolom Catatan auto-seed legacy tetap dash (aturan t_1fe52e80).
- Permission tidak diubah: tanpa penambahan adminOnly/admin guard; tab antrean + aksi tetap sama.
- Modul lain: **tidak ada diff** di luar file di atas (positif via harness G — modul lain default filter tetap).

## 4. Bukti test/build

```
python3 scripts/approval-queue-test/run.py  →  59 LULUS, 0 GAGAL
                                             (termasuk 3 asersi negatif baru)
npm run build  →  ✓ Compiled successfully, exit 0
```

Catatan: perubahan render_test.mjs dari run Brooklyn (H.3/H.4 tadinya assert
tabel 9-kolom) **disinkronkan ke kontrak compact+drawer S1** — tidak ada
penunggal yang diabaikan. Semua baris lama (B–G) tetap lulus tanpa revisi kode
lalam jalur legacy — bukti tidak ada regresi submit/approve/revise/reject.
