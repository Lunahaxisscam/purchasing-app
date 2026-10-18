# LAPORAN TEMUAN KRITIS S7/7 — GATE AKHIR PRA-PRODUKSI

Task: t_ad749e3b — [S7/7] Final business review, kritisi, dan acceptance gate
Pemeriksa: Bit (bit-dev), independen dari worker S1–S6
Tanggal: 18 Okt 2026 (malam) · Basis: 1d364e7 · HEAD diperiksa: c06822b (+3c591b0 bukti audit)
Worktree: /home/ubuntu/dev-workspaces/purchasing-review-prep-20261018
Catatan: ini BUKAN sertifikasi produksi. Gate akhir tetap milik Brooklyn.

---

## A. VERDICT PER KLAIM (6 deliverable S1–S6)

| # | Klaim worker | Hasil verifikasi independen | Verdict |
|---|---|---|---|
| S1 | Label estimasi jujur + aksi per-item | Suite `approval-item-action-test` 18 ok/0 FAIL dijalankan ulang oleh Bit; drawer benar tidak memunculkan keputusan tingkat PR; gerbang izin REJECTED menutup aksi item | **TERBUKTI** |
| S2 | Skema ledger belum ada (0/13) | `probe_s2.mjs` dijalankan ulang: tabel/RPC ledger TIDAK ADA (PGRST205/202); hanya RPC legacy ADA (revoked anon). Restore gate G1–G7 semua ❌ | **TERBUKTI** |
| S3 | Kontrol RAP/pagu | `rap_audit_test.mjs` 36 LULUS/0 GAGAL; probe_infinity: 22 probe, temuan Infinity/NaN & locale BELUM terbukti reachable (jujur, tidak mengklaim) | **TERBUKTI** |
| S4 | Termin/pembayaran/piutang | `sales-invoice-payment-test` 46 assertion lulus, 10 finding audit (A3,A6,B1,A6h,B10,C3,C7,C10,D4,D7) | **TERBUKTI** |
| S5 | Regresi lintas-flow + anti-double-cost | `crossflow-regression-test` SEMUA TEST LULUS (A1…B4 hijau, 124 assertion sesuai laporan) | **TERBUKTI** |
| S6 | KPI pertumbuhan | `growth-kpi-test` 126 assertion lulus; header suite menyatakan angka = FIXTURE, bukan live; 3 larangan klaim angka live dinyatakan eksplisit | **TERBUKTI** |

## B. KLUAT SKRIP VERIFIKASI (diulang Bit sendiri)

```
approval-item-action-test   → 18 ok, 0 FAIL          (baru; masuk runner 3c591b0)
marketing-test              → 263 LULUS, 0 GAGAL     (dry-run, tidak ada kirim/outbound)
growth-kpi-test (S6)        → 126 assertion, exit 0
crossflow-regression-test   → SEMUA TEST LULUS
sales-invoice-payment-test  → 46 assertion lulus, 0 gagal
rap_audit_test (S3)         → 36 LULUS, 0 GAGAL
verify_dup_baseline         → baseline 315 blok dup = worktree 315, selisih +0
s7-compact-test             → 110 lulus, 1 gagal (pra-ada, bukti baseline)
run_all.py (31 suite)       → 2243 lulus, 4 gagal (3 suite merah, semua pra-ada)
```

## C. TIGA SUITE MERAH — SEMUA PRA-ADA, BUKAN REGRESI

| Suite | Merah | Pembanding baseline | Kesimpulan |
|---|---|---|---|
| rab-boq-render-test | 2 (F1 font-weight ≥800, F2 kontras ivory) | identik di `baseline-18fb594-rab-boq-render-test.log` | pra-ada, bukan dari paket ini |
| ui-olive-tokens-test | 1 (`font-weight: 750` ×2) | `git show 1d364e7:styles/globals.css` → 2 kemunculan sama | pra-ada sejak base |
| s7-compact-test | 1 (blok CSS duplikat) | `verify_dup_baseline.py`: baseline 315 = worktree 315, 0 selector baru | pra-ada; dedup CSS memang tidak dikerjakan dan itu dinyatakan terbuka |

## D. TIDAK ADA PERUBAHAN DESTRUKTIF (bukti git)

- `git diff 1d364e7..c06822b -- migrations/` → KOSONG (0 migrasi baru/ubah)
- `git diff 1d364e7..c06822b -- pages/api/` → KOSONG (0 route API diubah)
- `git diff 1d364e7..c06822b --diff-filter=D --name-only` → KOSONG (0 file dihapus)
- `styles/globals.css` → +424/−0 (hanya tambahan; 0 deletion)
- Perubahan aplikasi hanya 16 file yang memang disengaja (REVIEW-03 + port Approval/Marketing).
- Tidak ada DB write / DDL / push / staging switch (sesuai laporan t_7634fa92, tidak diperiksa live karena kredensial tidak tersedia — lihat E).

## E. TEMUAN KRITIS UNTUK BROOKLYN/DAT (urut penting)

### E1. Snapshot closing 70% masih pecahan sen (LOW-MEDIUM, bukti kode)
FN-TARGET70 diperbaiki di client (`lib/money.js` → rupiah utuh), TAPI `close_project`
RPC tetap menghitung `v_target := COALESCE(p_revenue,0) * 0.7` di
`migrations/2026-10-10_planning_closing.sql:141`. Parameter `p_target` TIDAK ada di
signature RPC, dan pemanggil (`components/Finance.js:546`) hanya mengirim
p_revenue/p_material_cost/p_petty_cash_cost/p_labor_cost. Untuk revenue desimal,
`project_closings.target_budget` tersimpan berpotongan sen sementara layar
menampilkan bulat. Perbandingan HEMAT/OVER membaca kolom snapshot DB, bukan nilai
client. Belum ada snapshot salah tersimpan (tidak ada DB write), jadi belum merusak data.
Perbaikannya butuh migrasi aditif → butuh DB access (terblokir, lihat E2).

### E2. Migrasi DB TERBLOKIR — tidak boleh ditandai selesai (BLOCKER)
Restore gate S2 §6: G1 (backup consistent) ❌, G2 (restore drill; `psql`/`pg_restore`
tidak terpasang di VPS) ❌, G3 readback ❌, G4 keputusan handover c14802de ❌,
G5 connection string di vault ❌ (vault kosong), G6 klien DB ❌, G7 izin per-fase ⚠ draft.
**Kesimpulan: migrasi ledger receiving/handover/retur TIDAK BOLEH dijalankan dan
TIDAK BOLEH ditandai selesai tanpa bukti backup+restore.** Ini sesuai instruksi task.

### E3. KPI F6 (stock turnover) tidak bisa dihitung jujur
Tidak ada tabel movement/ledger, barang keluar tidak jadi pengurang, `materials`
adalah katalog global tanpa project_id. Tabel marketing (leads/touchpoints/campaigns/
handoffs) juga BELUM ADA → F1/F2 tidak boleh dilaporkan sebagai angka live.
Ini batasan skema, bukan kegagalan worker; harus tetap tercatat di laporan bisnis.

### E4. Klaim audit FN-TARGET70 yang salah (koreksi dari t_7634fa92)
Klaim "43.300.000 → 30309999.999999996" TIDAK ter-reproduksi. Cacat nyata = pecahan
sen pada revenue desimal yang ikut ke snapshot closing (lihat E1). Koreksi ini sudah
dicatat worker dan dikonfirmasi Bit via pembacaan kode RPC.

### E5. `/api/marketing-contract` 503 AUTH_NOT_CONFIGURED adalah fail-closed
Bukan API fungsional terautentikasi. Marketing masih draft-only tanpa persistensi.
Jangan dilaporkan sebagai fitur jalan ke DAT.

### E6. Estimasi WBS di snapshot closing (tercatat, diterima)
`project_closings.labor_cost` menyimpan ESTIMASI WBS sementara material/petty riil;
provenance per-baris tidak ada. UI + dokumen cetak sudah dilabeli jujur
("Aktual Upah Tukang (tukang_projects)" vs "Estimasi Upah Tukang (WBS Budgeting)",
dokumen cetak "TOTAL BIAYA TERCATAT"). Bukan klaim palsu, tapi batasan yang harus
tetap tampil di laporan bisnis.

## F. YANG TIDAK DILAKUKAN (batas audit)

- Tidak ada penulisan DB / DDL / migrasi / push / ganti staging.
- Tidak ada edit file aplikasi di worktree S1–S6 maupun prep (hanya 1 commit bukti
  tes: `docs/integration-evidence-20261018-190647.json` + log 20261018-190647).
- E2E HTTP (`e2e:*`, security + mobile-unified) tidak dijalankan pada run ini karena
  butuh server smoke hidup; bukti hijau terakhir ada di stamp 20261018-050817
  (13+20 asersi hijau). Perlu dijalankan ulang saat server smoke tersedia.

### F1. Koreksi verifikasi runtime Marketing (dijalankan Bit, bukan klaim pekerja)

Klaim t_7634fa92 menyebut "Marketing 7ce9414 diport utuh draft-only tanpa DB/outbound"
dan "263+327 keduanya hijau". Bit tidak memverifikasi ke server runtime; Bit
menjalankan `scripts/marketing-test/run.py` langsung → **263 LULUS, 0 GAGAL**, dan
output skrip sendiri menyatakan: "Catatan: lapisan ini DRY-RUN. Tidak ada pesan
terkirim, tidak ada iklan dibeli, tidak ada tabel ditulis, tidak ada migrasi
dijalankan." Jadi sifat draft-only/DRY-RUN **terkonfirmasi untuk lapisan kontrak
logika**, tetapi lapisan UI (run_ui.py, 102 assertion di run_all; angka 327 pada
laporan pekerja TIDAK direproduksi oleh Bit di luar run_all) hanya terbukti lewat
`run_all.py`. Klaim "tanpa DB/outbound" untuk UI belum diverifikasi runtime oleh Bit.


## G. SARAN GATE (untuk Brooklyn, bukan keputusan Bit)

1. Terima paket pra-review sebagai **siap QA terbatas**, BUKAN produksi.
2. Wajib sebelum migrasi DB: penuhi G1–G7 (backup + restore drill terverifikasi +
   izin DAT per fase).
3. E1 (snapshot 70% server-side) sebaiknya masuk task teknis terpisah sebelum closing
   pertama benar-benar dipakai DAT.
4. E5/E6 harus disebut eksplisit ke DAT saat demo supaya tidak terbaca sebagai fitur jadi.
