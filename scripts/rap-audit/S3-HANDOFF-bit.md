# S3 Audit Handoff — Bit (t_18652eb1)

Base audit: integration HEAD 1d364e7, worktree `wt-s3-rap-recovery`.
WIP di-recover dari `wt-s3-rap-audit` tanpa reset/clean.

## Hasil eksekusi (nyata)

| Suite | Hasil |
|---|---|
| `scripts/rap-audit/rap_audit_test.mjs` | LULUS=36 GAGAL=0 |
| `scripts/rap-audit/probe_infinity.mjs` | 22 probe — 14 cacat terkonfirmasi, 0 kapabilitas hilang |
| `scripts/rap-audit/probe_rap_compare.mjs` | 19 probe — 0 cacat, 0 kapabilitas hilang |
| `scripts/rap-audit/verify_csv.mjs` | 11 baris CSV selaras dengan dokumen |

Commit: `db927df` di branch `feat/rap-audit-evidence/t_18652eb1`.

## Klaim WIP yang diverifikasi ulang di base integrasi

- FN-INF_GUARD — TERKONFIRMASI di 3 file. Koreksi citation: Planning.js memakai `!isNaN(v) && v > 0` (L253, L277, L280, L283); ProjectFinance L150-152 dan Finance L470-472 memakai `Number(x)||0`. Klaim WIP menyebut satu idiom untuk ketiganya — perlu dikoreksi.
- FN-EST_LABEL — masih berlaku (ProjectFinance.js L228, Planning.js L1066).
- FN-PRINTREF — masih berlaku (Finance.js L1526).
- FN-TARGET70-DECIMAL — masih berlaku (ProjectFinance.js L156, identik Finance.js L478).

## Temuan baru di luar klaim WIP

- N3.1 — revenue tak-finite membuat SEMUA deteksi over-budget mati (false negative senyap).
- N7.1 / N7.2 — `appliedPercentages` Infinity/NaN mematikan deteksi over dan seluruh deteksi anomali; dashboard tampak sehat palsu.
- N4.1 / N4.1b — nominal bergaya id-ID ("1.250.000" / "1.250") salah dibaca (0 / 1,25).
- N8.3 — notasi ilmiah "5e1" diterima sebagai persen.

## Penting untuk perbaikan (sudah ada solusi di repo)

Modul `modules/rap-compare/logic.js` dan `modules/rap/model.js` SUDAH memakai
idiom yang benar: `Number.isFinite` eksplisit di `toRupiah`, strip-digit untuk
string lokal, dan status "none"/"unknown" alih-alih mengarang angka.
Jadi FN-INF_GUARD dan FN-RUPIAH_LOCALE adalah masalah penyelarasan
idiom di komponen lama, bukan kebutuhan menciptakan utilitas baru.

## Batasan reachability (jujur)

- Infinity/NaN dari DB `numeric` Postgres BELUM terbukti reachable. Jalur nyata
  paling mungkin: payload JSON ekstrem atau nilai dari Sheets sebelum masuk DB.
  Tidak ada probe DB live di audit ini.
- FN-RUPIAH_LOCALE juga belum terbukti reachable: realisasi Planning berasal dari
  kolom numeric DB, bukan string.
- Audit ini statik + eksekusi fungsi murni; tanpa render UI, tanpa tulis DB.

## Tata kelola

Audit proposal-only. Tidak mengubah kode aplikasi, tidak ada DDL,
tidak ada tulis DB, tidak ada push, tidak ada build paralel dengan Bamboo.
