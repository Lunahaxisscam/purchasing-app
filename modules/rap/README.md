# Modul RAP — Rencana Anggaran Pelaksana (versi minimum)

Task `t_71d95cfe` (S3/7). Kontrak lengkap & keputusan desain:
**`docs/rap-contract.md`**. Laporan eksekusi: `docs/report-t_71d95cfe.md`.

## Isi folder

| File | Peran |
|---|---|
| `model.js` | Logika murni (bebas React & Supabase): konversi harga RAB, baris, total, selisih RAB vs RAP, validasi, state machine status, kontrak handoff PR, snapshot JSON |
| `budgetingBridge.js` | Jembatan **baca-saja** ke RAB & BOQ (payload JSON) dan Budgeting (`project_plans`, hanya upah) |
| `store.js` | Store sesi `DRAFT_ONLY` + jejak `writes` yang harus selalu kosong |
| `view.jsx` | Halaman React (styled-jsx ter-scope) |

## Batas yang tidak boleh dilanggar

1. **Tidak menulis DB.** Tidak ada tabel `rap_versions`, tidak ada RPC, tidak
   ada migrasi. Mode satu-satunya: `DRAFT_ONLY`.
2. **Tidak memakai localStorage sebagai pengganti DB.**
3. **Angka RAP selalu RENCANA**, tidak pernah disebut aktual/realisasi.
4. **Nomor PR & `pr_id` tidak dikarang** di handoff — keduanya lahir di modul
   Purchase Request saat benar-benar menyimpan.
5. Acuan dari **WBS Budgeting hanya upah**; UI wajib menyebutnya.

## Menjalankan harness

```bash
python3 scripts/rap-test/run.py          # 115 unit + 66 render jsdom, tanpa DB
npm run smoke                            # build + render semua modul (probe RAP)
ENABLE_SMOKE=1 npx next start -p 3311
node scripts/rap-test/e2e_runtime_test.mjs http://127.0.0.1:3311   # 40 assertion Chrome
```

## Status wiring

Halaman ini **belum muncul di menu**: `modules/registry.js`,
`lib/constants.js`, dan cabang render `pages/index.js` adalah file CORE milik
Tech Lead. Langkah persisnya ada di `docs/rap-contract.md` §8; setelah wiring,
hapus `pages/__rapbuildprobe.js`.
