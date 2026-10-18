# Korektif scoped t_472efa7d — C8 flaky + review skrip switch preview

Tanggal: 2026-10-18 (WIB). Branch: `feat/final-package-20261018`.
Basis: `c087eb7` (paket akhir + bukti Brooklyn `t_987f2c96`).
Scope: **alat uji + skrip switch saja**. Tidak ada perubahan `modules/`, `lib/`,
`components/`, `pages/`; tidak ada DDL, DB write, atau push produksi.

---

## 1. Assertion C8 — flaky karena me-regex seluruh JSON (DIPERBAIKI)

### Penyebab (dikonfirmasi, bukan dugaan)

`scripts/sales-invoice-payment-test/piutang_test.mjs:100` (versi lama):

```js
const text = JSON.stringify(rep)          // mencakup SELURUH report
ok('C8', 'tidak ada aging bucket 30/60/90 hari', !/aging|30|60|90 hari/.test(text))
```

`text` memuat `generated_at` = `new Date().toISOString()`
(`scripts/reminders/rules.js:1053`). Regex lama punya dua alternasi **telanjang**
`30` dan `60`, sehingga cocok pada timestamp apa pun yang memuat `:30` atau
`:60` (menit/detik) — bukan hanya `90`. `report()` di harness bahkan tidak
mengirim `generatedAt`, jadi nilainya selalu jam dinding.

### Reproduksi deterministik (SEBELUM perbaikan)

```
$ bash /tmp/repro_c8.sh          # tunggu detik :30
START 2026-10-18T21:48:30+08:00
EXIT=1
  FAIL C8 tidak ada aging bucket 30/60/90 hari
C+D selesai: 18 ok, 1 fail, 2 finding (C8, C3, C10)
TOTAL assertion lulus : 50
TOTAL assertion gagal : 1
```

Sama dengan laporan Brooklyn (50 lulus / 1 gagal saat start di detik `:30`).

### Perbaikan

1. Yang diuji **hanya bagian report yang menyatakan aging**: `kinds`
   (key/label/threshold_key), `summary`, `thresholds`, `notes`, dan
   `items` (kind/severity/title/detail). `generated_at` dibuang eksplisit
   (`generated_at: undefined`).
2. Pola diperketat ke pola bucket yang sebenarnya — `aging`, `bucket`, atau
   rentang `0-30` / `31-60` / `61-90` / `>90`. Angka umur tunggal
   ("lewat jatuh tempo 139 hari") bukan bucket dan tidak boleh memicu.
3. Dataset tidak lagi kosong (`sales_invoices: []` membuat assertion lama lulus
   secara vakum). Kini berisi invoice berumur 1 / 47 / 139 hari + satu belum
   jatuh tempo, dan assertion mensyaratkan `items.length >= 3`.
4. Penjaga regresi deterministik di dalam assertion: report kedua dibangun
   dengan `generatedAt: '2026-10-18T13:30:60.090Z'` (memuat `:30`, `:60`, dan
   `.090`); C8 harus tetap hijau dan nilai `generated_at` harus benar-benar
   terpasang. Jadi pemicu flaky lama kini diuji **setiap run**, bukan menunggu
   kebetulan jam dinding.

### Bukti BEFORE/AFTER (deterministik, tanpa menunggu jam)

`node scripts/sales-invoice-payment-test/c8_before_after.mjs "$PWD"`:

```
generated_at                     keterangan                 BEFORE  AFTER
2026-10-18T13:47:12.000Z         detik normal (:47)         HIJAU    HIJAU
2026-10-18T13:30:12.000Z         DETIK :30 (pemicu flaky)   MERAH    HIJAU
2026-10-18T13:47:60.000Z         detik :60                  MERAH    HIJAU
2026-10-18T13:30:60.090Z         detik :30 DAN :60          MERAH    HIJAU
2026-10-18T13:47:12.090Z         milidetik .090             HIJAU    HIJAU
2026-10-18T13:30:12.000+07:00    offset +07:00 dengan :30   MERAH    HIJAU

KONTROL POSITIF (aging_0_30 disuntik): AFTER = MERAH (benar, assertion tidak vakum)
```

Kontrol positif penting: kalau aplikasi benar-benar menambahkan aging bucket,
C8 tetap MERAH — perbaikan ini tidak melemahkan assertion.

### Bukti 30 run berurutan (termasuk satu run dipaksa detik :30)

`bash scripts/sales-invoice-payment-test/c8_stability_30x.sh 30`
Log: `docs/c8-stability/c8-stability-20261018T135723Z.log`

```
C8 stability 20261018T135723Z — 30 run berurutan
run 01/30  rc=0  C8=ok  51 lulus / 0 gagal  dipaksa_detik30=tidak  mulai=2026-10-18T21:57:23+08:00
...
run 15/30  rc=0  C8=ok  51 lulus / 0 gagal  dipaksa_detik30=ya (detik :30)  mulai=2026-10-18T21:58:30+08:00
...
run 30/30  rc=0  C8=ok  51 lulus / 0 gagal  dipaksa_detik30=tidak  mulai=2026-10-18T21:58:39+08:00

RINGKASAN: 30 run, 0 run menyimpang (harus 0)
Run yang dipaksa mulai detik :30 -> 2026-10-18T21:58:30+08:00
```

**30/30 run = `51 lulus / 0 gagal`**, termasuk run yang dimulai tepat detik
`:30`. Finding audit tetap 7 (A3, A6, B1, A6h, B10, C3, C10) — tidak ada temuan
yang hilang atau bertambah karena perbaikan ini.

---

## 2. Review commit `9fa81fd` (skrip switch preview)

### Keputusan: **DIADOPSI, dengan 3 cacat sisa diperbaiki**

`9fa81fd` sudah menjadi ancestor HEAD di branch paket. Diagnosis intinya benar
dan saya buktikan ulang secara terpisah:

```
$ PORT=3001 npm start -p 3001        -> argv: ["3001"]
$ PORT=3001 npm start                -> argv: []      (PORT env dipakai)
$ next start 3019                    -> ⨯ Invalid project directory ... /3019
$ PORT=3019 npm start (env saja)     -> root=200 buildId=IcSFkquFW77CZf0zQ3JeV
```

Jadi `-- start -p "$PORT"` memang salah: npm menelan `-p`, meneruskan `3001`
sebagai argumen posisi, dan Next membacanya sebagai direktori proyek. Perbaikan
"port hanya lewat `env PORT`" + "readback `buildId` dari HTML yang disajikan"
adalah arah yang benar.

### Tiga cacat sisa yang saya temukan saat review (sudah diperbaiki)

1. **`set -e` + `pipefail` mematikan skrip tanpa pesan.** Loop tunggu-siap
   `CODE="$(curl ...)"` tanpa `|| true` membuat curl exit 7 (koneksi ditolak,
   yaitu kondisi normal saat server belum siap) langsung mengakhiri skrip
   sebelum baris `say "  HTTP / : $CODE"`. Dibuktikan:
   `bash /tmp/prove_set_e_curl.sh` → mati di iterasi pertama, `EXIT=7`.
2. **Ekstraksi BUILD_ID dari HTML bisa mematikan skrip.** Rantai
   `curl | grep -o | head -1 | cut` tanpa proteksi: bila `grep` tidak menemukan
   `buildId`, pipefail mengakhiri skrip sebelum `die` sempat mencetak
   diagnostik. Dibuktikan: `bash /tmp/prove_grep_pipefail.sh` → `EXIT=1`
   tanpa satu pun pesan.
3. **Preview bisa ditinggal mati saat `--apply` gagal readback.** `9fa81fd`
   memanggil `die` tepat setelah `pm2 delete` + start build baru; kalau build
   baru tidak menyajikan BUILD_ID yang benar, preview tetap mati (persis
   insiden `t_987f2c96`, hanya berpindah pemicu). Kini ada `restore_to`:
   readback gagal → pulihkan ke cwd/BUILD_ID lama → **baru** keluar dengan
   pesan. `--rollback` memakai jalur yang sama.

Tambahan struktural: satu helper `start_app()` dipakai `--apply`, `--rollback`,
dan pemulihan, sehingga tidak ada dua cara start yang bisa menyimpang lagi.

### Uji skrip (port 3018/3019 — port 3001 TIDAK disentuh)

`bash /tmp/full_switch_test.sh`:

```
A. --apply    (3018) -> HTTP=200  build=IcSFkquFW77CZf0zQ3JeV
B. --rollback (3018) -> HTTP=200  build=GyzaWYEcq009kHRu9esvy
C. --apply    (3018) -> HTTP=200  build=IcSFkquFW77CZf0zQ3JeV
D. jalur GAGAL (3019, artefak rusak di atas preview sehat):
     READBACK GAGAL (file=FAKEBUILDID... http=000 tersaji=? != FAKEBUILDID...)
     Mengembalikan preview ke build sebelumnya (tidak ditinggal mati)...
     readback pemulihan: HTTP=200 build_id_tersaji=IcSFkquFW77CZf0zQ3JeV
     GAGAL: switch dibatalkan; preview dikembalikan ke build sebelumnya
   kondisi akhir 3019: HTTP=200 build=IcSFkquFW77CZf0zQ3JeV  <- TIDAK mati
E. 3001: HTTP=200 build=IcSFkquFW77CZf0zQ3JeV (utuh); 3018/3019 = 000
```

### Cek pola `-p` di skrip lain

`grep -rn -- "start -p" scripts/` → dua kategori:

| Lokasi | Bentuk | Status |
| --- | --- | --- |
| `switch_preview_final_package.sh` | `pm2 start npm -- start -p "$PORT"` | **RUSAK** (sudah diperbaiki; tidak ada lagi `-p`) |
| `switch_staging_3001.sh:80,112` | `pm2 start ./node_modules/next/dist/bin/next -- start -p "$PORT"` | **SAH** — binary `next` dipanggil langsung, bukan lewat npm |
| `scripts/sales-invoice-test/e2e_runtime_test.mjs:8`, `scripts/pr-print-template-test/e2e_runtime_test.mjs:9` | komentar prasyarat `npx next start -p PORT` | hanya komentar, bukan eksekusi |

Bukti `-p` pada binary langsung tetap sah (diuji di 3019):

```
=== next start -p 3019 (binary langsung, seperti switch_staging_3001.sh) ===
root=200 buildId_tersaji=IcSFkquFW77CZf0zQ3JeV
 ✓ Ready in 433ms
```

Jadi `switch_staging_3001.sh` **tidak perlu diubah** — mengubahnya menjadi
`env PORT` saja akan menghilangkan `-p` yang justru valid di jalur itu.

---

## 3. Kriteria selesai

| Kriteria | Status | Bukti |
| --- | --- | --- |
| C8 tidak bergantung `generated_at` | SELESAI | `c8_before_after.mjs`: BEFORE MERAH di `:30`/`:60`, AFTER HIJAU di semua timestamp |
| 30 run berurutan hijau + 1 dipaksa detik `:30` | SELESAI | `docs/c8-stability/c8-stability-20261018T135723Z.log` — 30/30 × `51 lulus / 0 gagal` |
| `9fa81fd` di-review; keputusan adopsi dicatat | SELESAI | diadopsi + 3 cacat sisa diperbaiki; uji A–E di atas |
| Tanpa perubahan `modules/`, `lib/`, `components/`, `pages/` | SELESAI | `git status` hanya menyentuh `scripts/` dan `docs/` |
| Tanpa DDL / DB write / push produksi | SELESAI | hanya file skrip + log; tidak ada koneksi DB, tidak ada `git push` |

## 4. Catatan batasan (tidak berubah dari gate sebelumnya)

- Perbaikan ini **tidak** mengubah angka regresi paket: 46 suite, 43 hijau,
  2.887 lulus / 4 gagal, dengan 3 suite merah pra-ada. Yang berubah hanya
  **stabilitas** angka C8.
- Preview 3001 tetap menyajikan `IcSFkquFW77CZf0zQ3JeV` (staging review, bukan
  produksi). Tidak ada switch baru ke 3001 yang dilakukan di kartu ini.
- `t_03b41644` dan `t_7bc6246b` tidak disentuh.
