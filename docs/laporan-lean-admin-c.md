# Laporan Lean Admin C — Integrasi Alur Admin, Uji Runtime, Preview Staging

Kartu: **t_c720bd7c** (Bamboo/Data Tech — Tahap C) · Parent done: **t_aead7c06** (Tahap B, commit f585c5a)
Tanggal: 2026-10-20 · Branch: **feat/lean-admin-integration** (HEAD `9da2edd`)

---

## 1. Yang dikerjakan

1. **FF worktree integrasi** `fe9862c` → `f585c5a` (EXACT committed parent handoff — bukan reset, merger bersih, history linear; fe9862c terbukti ancestor dari f585c5a).
2. **Harness alur admin lean end-to-end** baru `scripts/lean-admin-c-flow/run.py` + `lean_admin_test.mjs` — membuktikan RANTAI tahap A ⇄ B di atas skema existing, mock perekam (bukan bukti DB live), 10 skenario.
3. **E2E runtime browser nyata** `scripts/lean-admin-c-flow/e2e_runtime_test.mjs` — Chrome headless CDP di server scratch sendiri (bukan VPS desktop; bukan staging live).
4. Regresi + build smoke + paket rilis immutable + **switch staging 3001** (lampu hijau Brooklyn diterima).

## 2. Skenario terbukti (68 cek hijau)

| Grup | Skenario | Buktian |
|---|---|---|
| S1 | Template/draft → submit lean: status SUBMITTED + penanda [Jalur: LEAN]; **0 insert approval_steps**, **0 insert receivings**, **0 update pr_items** | 8 cek |
| S2 | Retry/klik ganda saat sudah lean → idempoten (alreadySubmitted, 0 write) | 5 cek |
| S3 | Kebutuhan lean muncul di "Siap Dibeli" via `isBuyable({item, request})` | 5 cek (legacy SUBMITTED tanpa penanda TIDAK muncul) |
| S4 | Nota lintas proyek (2 lean + 1 direct + SKU split): header project_id NULL, 3 baris item, alokasi readback per proyek 476k/105k, jejak request di baris | 16 cek |
| S5 | Tutup sisa: [Tutup: alasan] + [TutupPada], catatan manusia preserved, qty asli utuh, baris ditutup jadi tak muncul di openNeeds | 8 cek |
| S6 | Readback realisasi (fulfillment): DIBELI menghitung ke butuh 4, RETUR q99 diabaikan | 5 cek |
| S7 | Handover queue otomatis: 1 dokumen DRAFT per nota, ter-link receiving_id | 4 cek |
| S8 | Anti nota ganda: retry nota sama ditolak `duplicate_invoice` + pesan "Riwayat"; boundary reusable (BakpauWA hook) menolak harga 0/unknown | 10 cek |
| S9 | Failure isolation jujur: header tersimpan (uang keluar), item gagal → result `partial: true` + pesan "jangan simpan ulang"; dup-check select gagal → 0 write | 7 cek |
| S10 | Pembelian sebagian → SEBAGIAN (bukan dipaksa selesai) + openNeeds sisa 2 | 4 cek |

### E2E runtime (Chrome nyata, 22/22 hijau)

Halaman uji `/__smoke` (mock in-memory, NOL request mutasi ke Supabase — terbukti
dari network listener CDP). Yang diuji di browser nyata, bukan jsdom:

- Modul Purchase: dua tab (Siap Dibeli / Riwayat Pembelian), baris siap dibeli ada
- Dialog "Proses Pembelian" betul terbuka dengan tempat isian Toko/Tanggal/No. Nota,
  biaya lain & diskon dipisah, harga riil kosong di awal (bukan estimasi dijual sbg aktual)
- Tidak ada Gudang/Tukang/RETUR/REFUND di panel Purchase (harian)
- Modul Request: label lean "Siap Ditindaklanjuti" + legacy "Submitted lama" tampil
- Viewport 390: antarmuka Purchase tampil tanpa overflow sendiri
- Design token sistem (`--olive-800` dst.) tersedia di runtime, bukan cuma di file
- Nol exception JS selama navigasi

## 3. Bukti eksekusi

```
1. scripts/lean-admin-c-flow/run.py         → 68/68 LULUS, exit 0
2. scripts/integration-test/run_all.py      → 34/36 SUITE hijau (dua MERAH sama persis dengan baseline parent, lihat §4)
3. ENABLE_SMOKE=1 npm run build             → exit 0, /__smoke & seluruh route build sukses (BUILD_ID J5CFfVZgrqBwDQakH0DvK)
4. scripts/lean-admin-c-flow/e2e_runtime_test.mjs → 22/22 LULUS di Chrome nyata
5. switch_preview_lean_c.sh --apply         → readback root/smoke/chunk/css = 200/200/200/200
                                              html berisi BUILD_ID J5CFfVZgrqBwDQakH0DvK; pm2 save OK
```

## 4. Known gaps & kejujuran

1. **Mock-DB, bukan live DB:** seluruh klaim tulis DB (dup-check, readback alokasi,
   handover queue, fallback status DIBELI) dibuktikan di MOCK yang MEREKAM operasi
   Supabase — BUKAN di Supabase live. Pemisahan ini sesuai brief (tulis bisnis uji ke
   live dilarang); kartu DB/backup t_03b41644 masih belum selesai, jadi **belum
   diklaim beres di level database**.
2. **Nol bukti E2E di Supabase live; belum ada jalur bakpau/bakpauWA aktif**
   (boundary reusable sudah diuji sebagai fungsi, tetapi belum disambung ke teks bantuan
   WhatsApp itu).
3. **Dua MERAH pre-existing** yang dulu diadopsi di t_aead7c06 dan tidak menyelesaikan:
   `rab-boq-render-test` (2 cek, font-wd + ivory sidebar; kelemahan fanout
   hardcode file origin repo) dan `s7-compact-test` (dup CSS .notice/.btn-file ×2).
   Bukti identik baseline di docs/integration-logs/20261020-044706/.
4. **Preview staging 3001 sudah di aliran LEAN C** (immutable dir
   `purchasing-lean-c-release-20261020-055948`, BUILD_ID J5CFfVZgrqBwDQakH0DvK,
   commit 9da2edd); rollback tersedia (`--rollback`, snapshot
   state/before-...json + pm2-before-...), previous release
   `purchasing-compact-release-20261019-180320` (build_id miXlGh9XtMlZq-ZtUoPdF).
5. **Halaman smoke bukan dashboard produksi** — smoke page meletakkan semua
   section modul berjajar tanpa shell Dashboard/Sidebar asli, jadi buktian
   anti-scroll di mobile (per 768/1024/1280/1440) tetap bersumber dari
   all-modules-compact-test (749 cek) + mobile-unified-check; harness ini tidak
   mengklaimmengulang sweep itu.
6. **Bukti alur map ke unit/ mock; belum ada sesi DAT mencoba live** — DAT di
   mohon cek staging 3001 langsung di phone/PC untuk validasi UX sebelum dianggap
   siap (form tukang → nota → riwayat).

## 5. Lokasi artefak

- Worktree: `/home/ubuntu/dev-workspaces/purchasing-lean-admin-integration` (branch `feat/lean-admin-integration`, HEAD `9da2edd`)
- Commit baru: `8c02b0b` (harness 68 cek), `9f530ce` (hapus probe debug), `9da2edd` (e2e 22 cek)
- Bukti run: `docs/integration-evidence-20261020-044706.json` + `docs/integration-logs/20261020-044706/*.log`
- Rilis immutable: `/home/ubuntu/dev-workspaces/purchasing-lean-c-release-20261020-055948`
  (manifest `state/release-manifest.json`, switch script `switch_preview_lean_c.sh`,
  snapshot rollback `state/before-*.json`, `state/pm2-before-*.json`)
- Staging: port 3001, pm2 `purchasing-staging-3001`, BUILD_ID J5CFfVZgrqBwDQakH0DvK (tersaji, terbaca dari HTTP)

## 6. Fitur untuk DAT (cek staging 3001)

Alur admin lean betul-betul tersambung end-to-end:
1. Tukang isi template → admin kirim "Selesai & Kirim" (**tanpa approval**)
2. Kebutuhan muncul di "Siap Dibeli" (ada saran estimasi/vendor — boleh koreksi)
3. Centang → "Proses Pembelian" → isi harga riil per item (estimasi TIDAK dijual sbg harga aktual)
4. Satu nota bisa lintas proyek, termasuk barang non-request; qty SKU sama boleh dibagi
5. Total nota dibaca balik; alokasi per proyek muncul di hasil
6. Sisa kebutuhan berkurang/manda "Sebagian – sisa 2"/"Selesai"/"Ditutup"
7. Barang dibeli masuk antrean Serah Terima (DRAFT)
8. Nota duplikat ditolak (retry aman)
