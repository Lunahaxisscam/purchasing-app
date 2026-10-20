# DATA MAP — Master Proyek, Upah Drive, dan Cost per Proyek (Tahap A)

Kartu: `t_9753008e` · Worktree: `/home/ubuntu/dev-workspaces/purchasing-project-data-map` · Branch: `feat/project-data-map`
Basis: `ce8d132` (lean admin A/B/C selesai). Tahap A = **audit + kontrak mapping/angka**, bukan integrasi UI.

Status: **audit selesai dengan bukti eksekusi**, angka terverifikasi untuk identitas proyek, satuan rupiah, arti upah, dan anti-double-cost material. Sisa yang **belum** bisa ditutup dicatat jujur di §7 (blocker/pertanyaan keputusan), bukan ditebak.

---

## 0. Ringkasan satu paragraf

Master proyek sudah ada dan **nomornya sudah lengkap**: tabel `projects` (11 baris; `kode` = `code`, tanpa duplikat) dan tab `PROJECT MASTER` di REKAP COST 2026 (12 baris = 11 proyek + 1 cost center operasional). Sumber upah Drive **sudah membawa nomor proyek** di kolom A tab `List Proyek`, tetapi daemon `tukang_upah_sync.py` **membuang kolom itu** (hanya membaca kolom B = nama), sehingga aplikasi selama ini menggabungkan upah lewat **nama proyek**. Itu akar masalah yang membuat actual labor rawan hilang/tertukar. Satuan angka sumber **Rupiah penuh (bukan ribuan)** dan itu dibuktikan (format sel `Rp`/`[$Rp-421]` + dua kecocokan persis dengan CLOSING). Arti `total_upah` = **hak upah tercatat**, sedangkan kasbon + pelunasan adalah **pembayaran atas hak yang sama** (formula sumber `=B5-E5-H5`), jadi tidak boleh dijumlahkan lagi sebagai biaya. Biaya material punya **satu sumber event** (`COST ITEMS`), satu tampilan (`REKAP COST`), dan satu agregat (`PROJECT SUMMARY`) — agregat **tidak** boleh dihitung sebagai event baru.

---

## 1. Sumber yang dibaca (read-only) dan bukti aksesnya

| Sumber | ID | Jenis (terverifikasi `drive.get`) | Tab yang dipakai |
|---|---|---|---|
| REKAP COST 2026 | `1A7UYMsp6ocak8VAsTjVYL6qY26CXCccAHDESPxAngGk` | Google Sheets native | `PROJECT MASTER`, `PROJECT SUMMARY`, `COST ITEMS`, `PETTY CASH`, `PAYMENT LEDGER`, `REKAP COST` |
| Upah Asep | `1rDddWjHSV0egk6wRDuEWfT5KjPQWLDGrxMS5fGe5tO4` | Google Sheets native | `Dashboard`, `List Proyek`, `Rincian Upah`, `Total Kasbon`, `Slip Pembayaran Upah` |
| Upah Pujon (dipakai daemon) | `12AZYVVV8_PoscDvjWlA2yjTTSim_uBsdBGGQu-OkOlk` | Google Sheets native | idem + `Sheet1`, `Sheet2` |
| "Pujon" di brief lama | `1COEFyCsubrIYB8h_a1VuLoIqOQf6eDKN` | **XLSX** (`...spreadsheetml.sheet`), bukan native | tidak dibaca Sheets API; **bukan** file yang disinkronkan daemon |
| CLOSING PER PROJECT | `14JH3BKmjMMyVCxyBEhQFauqWDXV1DG6jzmmepUXYsEc` | Google Sheets native | 11 tab per proyek |
| Folder `BAKSO - ACCOUNTING` | `116Ruo90LZkCkRLv8AORbpIMddbfn1DDZ` | folder | hanya berisi 2 dashboard native (`Asep_Simple_Upah_Kasbon`, `Pujon_Simple_Upah_Kasbon`) |

**Koreksi sumber:** brief menyebut `1COEF...` sebagai sheet Pujon. Itu benar sebagai *file riwayat kasbon Pujon (XLSX)*, tetapi **bukan** sumber sync: daemon memindai folder BAKSO dan hanya menerima `mimeType = application/vnd.google-apps.spreadsheet`, lalu menemukan `12AZY...`. Kalau `1COEF...` dipakai sebagai sumber upah, Sheets API akan gagal / perlu download+parse XLSX.

**Akses ulang (bukti):** `drive.get` untuk kelima ID berhasil; `spreadsheets.values.get` untuk 13 range berhasil. Token memakai kredensial OAuth existing lewat helper resmi (`HERMES_HOME=/home/ubuntu/.hermes`, read-only). Tidak ada penyalinan/pencentakan secret, tidak ada RLS/auth yang dibuka.

**Master live (read-only):** `GET /rest/v1/projects?select=id,name,status,kode,code` → HTTP 200, **11 baris**. Probe tabel upah & ringkasan memakai kredensial aplikasi:
`project_cost_summary`, `tukang_projects`, `tukang_dashboards` → HTTP **401 permission denied**; `sync_status` → 200.
→ `[]`/kosong pada tabel itu **bukan** bukti “tidak ada data”. Tidak ada upaya membuka RLS.

**Catatan kejujuran data:** angka yang dikutip di dokumen ini dipakai **hanya sebagai bukti rekonsiliasi** (kesamaan/selisih), bukan dump data. Snapshot per baris — nominal, nama tukang, seluruh isi tab — **tidak** masuk git; semuanya ada di `/home/ubuntu/agents/bamboo/purchasing-project-data-map/` (lihat `CROSSWALK.md` di folder itu), sesuai guardrail A1.

---

## 2. Kontrak identitas proyek (A2)

### 2.1 Prosedur mapping (dipakai Tahap B)

```
nomor di sumber (string)      --normalizeProjectNo-->  canonical (digit tanpa leading zero)
        |                                                      |
        |  (bila kosong)                                       v
        +-- alias terkonfirmasi (kolom "Confirmed Aliases")  projects.kode  -->  projects.id
        |
        +-- (tidak ada nomor & tidak ada alias) -> state not_found  (BUKAN dipilih otomatis)
nama mirip  -> HANYA suggestCandidates() untuk review admin; tidak pernah jadi relasi final
```

Aturan yang dikunci:
- **Nomor adalah final.** Nama/alias hanya kandidat; alias sah **hanya** yang tertulis di `PROJECT MASTER → Confirmed Aliases` (sumber-driven, bukan tebakan kemiripan).
- **Tidak memilih otomatis** bila nomor dipakai >1 baris master (`state: ambiguous`, daftar kandidat dikembalikan).
- **Tidak pernah menerbitkan nomor proyek baru.**
- **Format aneh tidak “diperbaiki”**: `083` → canonical `83` tetapi ditandai `leading_zero`; `#83`/`83a` → `format_invalid`; `operasional ws` → `non_project`.
- **Proyek archived/DONE tetap bisa dipetakan** (status dilaporkan, tidak disembunyikan) — master historis tidak dibuang hanya karena dropdown operasional active-only.
- **Konflik `kode` vs `code`** dilaporkan sebagai issue, bukan dipilih diam-diam.

### 2.2 Hasil dry-run pada data nyata (`docs/project-cost/dry-run-evidence.json`)

| Sumber | Baris | matched | alias | ambiguous | not_found | non_project |
|---|---|---|---|---|---|---|
| `PROJECT MASTER` (REKAP COST) | 12 | 11 | 0 | 0 | 0 | 1 (`operasional ws`) |
| `List Proyek` — Asep | 1 | 1 | 0 | 0 | 0 | 0 |
| `List Proyek` — Pujon | 56 | 2 (no. 83, 61) | 0 | 0 | **34 nomor legacy** + **20 baris tanpa nomor** | 0 |
| Tab `CLOSING PER PROJECT` | 11 | 0 | 2 (`Baroni`→99, `Mabes`→83) | 0 | 9 | 0 |
| **Total** | 80 | **16** | — | **0** | **63** | **1** |

Temuan identitas yang perlu ditindaklanjuti di sumber (bukan di aplikasi):

1. **Daemon membuang nomor proyek.** Tab `List Proyek` sudah punya `Project No` di kolom A (contoh terverifikasi: Asep `99`; Pujon `49, 47, 52, …, 83, 61, 91, 94`). `fetch_list_proyek()` hanya membaca kolom B (`project_name`) dan mengabaikan kolom A, sehingga pasangan nomor–nama hilang sebelum masuk DB. Inilah sebabnya `lib/laborSource.js`, `modules/labor-stock/logic.js`, dan `components/ProjectFinance.js` harus join nama.
2. **Join nama memang gagal pada data nyata.** Contoh: sumber menulis `Proyek Josh - Mabes` / `Proyek Sunter Hijau - Eric`, master menulis `Josh - Mabes` / `Eric - Sunter Hijau`. Dengan join nama keduanya **tidak** ketemu walau nomornya (83, 61) ada.
3. **34 nomor legacy** di Pujon (`21, 47, 49, 52, 53, 55, 57, 58, 63, 65, 66, 69–81, 85, 87–92, 94, 95, 96`) tidak ada di `projects` (master baru mulai 61/83/93/98/99/100–105). Ini **master historis yang sah** — jangan dihapus/dinormalkan; statusnya `not_found` dan biayanya tidak boleh ditampilkan sebagai “0”.
4. **20 baris upah tanpa nomor** (mis. `Project Sunter Hijau 8`, `Project Nerin 1/5`, `Service Park Serpong`, `Cendana Botanic`, `Everbeau`). Beberapa **mirip** nama proyek master (`Project Sunter Hijau 8` vs `Eric - Sunter Hijau`) — justru contoh mengapa fuzzy name berbahaya: baris ini berbeda proyek.
5. **Status Drive tidak otoritatif.** `PROJECT MASTER` menulis `ACTIVE` untuk semua baris, sedangkan `projects.status` punya `ON_GOING / DONE / NOT_START`. Sinkronisasi status **tidak boleh** menimpa DB dari Drive.
6. **Beda penulisan nama:** `projects.name` proyek 103 = `Susy -  Verdi Barat` (spasi ganda) vs Drive `Susy - Verdi Barat`. Normalisasi spasi wajib; jangan jadikan alasan memutus relasi.
7. **9 tab CLOSING belum punya alias/nomor terdaftar** (`Sunter Hijau`, `Kos Soni`, `Mori Tower`, `EA Store`, `Aan - BSD`, `Ruko Alsut`, `Verdi Barat`, `Breeze 7-32`, `Citizen East 10-12`). Beberapa tampak persis sama dengan nama master (`Aan - BSD`, `Kos Soni`, `Mori Tower`), tetapi menurut kontrak **nama bukan relasi final** → statusnya `not_found` sampai alias diisi di `PROJECT MASTER`. `Breeze 7-32` dan `Citizen East 10-12` bahkan tidak ada padanannya di master (kandidat: `Breeze 7-32` berisi upah 2,645,750 yang sama dengan baris Pujon `Cendana Botanic` — **petunjuk, bukan bukti**).
8. **`kode` vs `code`:** 11/11 baris sepakat; **tidak ada** konflik/duplikat pada master saat audit. Tabrakan masa depan akan muncul sebagai issue `kode_code_conflict` / `duplicate_kode` (sudah diuji dengan fixture sintetis).

---

## 3. Kontrak angka & satuan (A3)

### 3.1 Satuan = Rupiah penuh (bukan ribuan) — TERBUKTI

Bukti berlapis, bukan asumsi:

| Bukti | Detail |
|---|---|
| Number format sel upah | `NUMBER` pattern `_(* #,##0_);_(* \(#,##0\);_(* "-"??_);_(@_)` (integer ribuan-terpisah, tanpa desimal) |
| Header eksplisit | Pujon: `Total Upah (Rp)`, `TOTAL HAK UPAH PEKERJAAN (Rp)`, `TOTAL KASBON DIAMBIL (Rp)`, `TOTAL PELUNASAN DIBAYAR (Rp)` |
| Nilai terformat | Baris 5 Dashboard: `"Rp 10,345,000"` / `"Rp 507,538,700"` (nilai mentah `10345000` / `507538700`) |
| Format mata uang REKAP COST | `CURRENCY [$Rp-421] #,##0` pada `Harga Satuan` / `Total Biaya` di `COST ITEMS` |
| Rekonsiliasi silang | Hak upah proyek **83 = 9,230,000** sama persis dengan `CLOSING → Mabes → B7 Biaya Tukang = 9,230,000`; proyek **61 = 123,729,000** sama persis dengan `CLOSING → Sunter Hijau → B7`. Bila angka ribuan, B7 proyek 61 akan berarti Rp 123 miliar untuk proyek ber-revenue Rp 638 juta — mustahil. |

Catatan kualitas sumber: tab `List Proyek` **Asep** tidak menulis `(Rp)` di header (hanya `Total Upah`), walau sel Dashboard-nya berformat `Rp`. Ini dicatat sebagai `headerLabelMissingCurrency`, bukan alasan mengubah skala.

**Aturan:** `toIdr()` hanya mengonversi bila sumber terdaftar di `UNIT_CONTRACT` dengan `verified: true` dan `scale: 1`; sumber tak terdaftar → `null` (`UNIT_UNVERIFIED`). **Tidak ada** perkalian 1000 di mana pun, dan konversi ganda dicegah (`alreadyIdr`).

Akibat untuk UI: kalimat lama di `components/TukangUpah.js` (“Angka ditampilkan persis seperti di sheet (belum dikonversi satuan ribuan)”) **tidak lagi benar sebagai peringatan satuan** — satuannya rupiah penuh. Kalimat itu perlu diganti di Tahap B (bukan diubah sekarang karena Tahap A tidak menyentuh UI).

### 3.2 Parser: “parse sukses” ≠ “satuan benar” — TERBUKTI

`docs/project-cost/parser-matrix.json` (dijalankan pada fungsi murni, tanpa daemon/jaringan):

| Input | `drive_cost_sync.parse_rupiah` | `tukang_upah_sync.parse_rupiah_loose` | `logic.js toNumberOrNull` | `crosswalk.parseSourceAmount` |
|---|---|---|---|---|
| `Rp 10,345,000` | 10345000 | 10345000 | 10345000 | 10345000 |
| `15,000.76` | **1500076** | 15000.76 | 15000.76 | 15000.76 |
| `15.000,76` | **1500076** | 15000.76 | 15000.76 | 15000.76 |
| `12,5` | **125** | 12.5 | 12.5 | 12.5 |
| `12.5` | **125** | 12.5 | 12.5 | 12.5 |
| `1.234.567,89` | **123456789** | 1234567.89 | 1234567.89 | 1234567.89 |
| `(-Rp 9,500)` | **+9500** (tanda hilang) | -9500 | **null** | -9500 |
| `-Rp 32,107` | -32107 | -32107 | **null** | -32107 |
| `-` / `''` / `n/a` | null | null | null | null |

**7 dari 17 sampel tidak sepakat.** Yang penting:
- `drive_cost_sync.parse_rupiah` (dipakai `PROJECT SUMMARY`) membuang semua non-digit → **desimal hancur** dan **tanda negatif dalam kurung hilang**. Untuk kolom biaya yang hari ini bulat, hasilnya benar; tetapi parser ini tidak boleh dipakai untuk nilai desimal/negatif.
- Parser upah & `logic.js` sepakat pada format rupiah umum; `logic.js` mengembalikan `null` untuk teks bertanda negatif (aman: null ≠ 0, tetapi tidak bisa membaca koreksi/retur).
- `1.500` / `1,500` berakhir `1500` di semua parser; itu **interpretasi ribuan**, bukan fakta. `parseSourceAmount` menandainya `ambiguous: true` tanpa menambah skala.

**Kosakata angka yang dikunci:** kosong/`-`/`n/a` → `null` (**bukan 0**); nilai tanpa angka → `null`; sel berisi teks satuan (`12 pcs`) → `null`.

### 3.3 Satuan kuantitas material: GAP

`COST ITEMS` punya `Jumlah` (qty) + `Harga Satuan` + `Total Biaya`, tetapi **tidak punya kolom satuan** (pcs/lembar/m³). Master Supabase (`materials.satuan` / `pr_items.unit`) punya satuan, jadi satuan item COST ITEMS **tidak bisa** diverifikasi dari sumber dan statusnya `unverified` — jangan mengonversi qty apa pun di Tahap B.

---

## 4. Arti `total_upah`, kasbon, pelunasan (A4)

Formula sumber di tab `Dashboard` (dibaca dengan `valueRenderOption=FORMULA`):

```
TOTAL HAK UPAH PEKERJAAN   =E16
TOTAL KASBON DIAMBIL       =F16
TOTAL PELUNASAN DIBAYAR    =SUM(H10:H15)
SISA SALDO BERJALAN        =B5-E5-H5      ->  hak - kasbon - pelunasan
```

Verifikasi konsistensi pada data nyata (dry-run):

| Tukang | Hak | Kasbon | Pelunasan | Saldo sumber | Saldo hitung kontrak | Cocok |
|---|---|---|---|---|---|---|
| Asep | 10,345,000 | 9,500,000 | 0 (`-`) | 845,000 | 845,000 | ✅ |
| Pujon | 507,538,700 | 422,172,000 | 78,411,000 | 6,955,700 | 6,955,700 | ✅ |

**Kontrak biaya upah:**
- `costRecognized` = **hak upah tercatat** (satu-satunya basis biaya upah).
- `kasbon` dan `pelunasan` = **pembayaran** atas hak yang sama → `paidToDate = kasbon + pelunasan`, **tidak** ditambahkan lagi ke biaya (`doubleCounted: false`).
- `outstanding = hak − kasbon − pelunasan`; bila salah satu angka belum tercatat → `null` (bukan 0).
- Bukti bahwa basis hak dipakai bisnis: `CLOSING → B7 Biaya Tukang` = hak upah sumber untuk 83 dan 61 (persis), bukan kasbon/pelunasan.

**Bug nyata yang ditemukan (bukan diperbaiki di Tahap A):**
`components/TukangUpah.js:226` menghitung saldo `hak - kasbon + pelunasan`. Untuk Pujon itu menghasilkan **163,017,700** padahal sumber & kontrak = **6,955,700** (selisih = 2 × pelunasan). `checkSaldoFormula()` mengunci formula yang benar dan **menolak** formula lama; perbaikan komponen ada di Tahap B.

---

## 5. Anti-double-cost material (A5)

Tiga representasi data yang mudah tertukar:

| Representasi | Sifat | Perlakuan |
|---|---|---|
| `COST ITEMS` (272 baris, semua `CONFIRMED`) | **event** biaya, punya `Cost ID`, `Purchase ID`, `Document Reference`, `Source Channel` | satu-satunya sumber event |
| `REKAP COST` (tab) | **tampilan** event tanpa ID (Project Name/No, Tanggal, Deskripsi, Jumlah, Harga Satuan, Total Biaya) | jangan dihitung ulang |
| `PROJECT SUMMARY` | **agregat** (Current Week / Cumulative / Total Paid / Outstanding) | ringkasan, **bukan** event baru |

Bukti agregat = jumlah event (dry-run, 11/11 proyek): `events == summary` untuk kode 61, 83, 99, 100, 101, 102, 103, 104, 105, 93, 98. Contoh: 99 → 23,901,863 = 23,901,863; 61 → 17,372,796 = 17,372,796. Ringkasan yang ditambahkan sebagai event akan **menggandakan** biaya; helper menandai `aggregateCountedAsEvent: false` + warning `summary_equals_events`.

Kunci eksternal yang dikunci:
- **Nota**: `Document Reference` (`DOC-xxxx`) / `Purchase ID` (`PUR-xxxx`) / `invoice_no` aplikasi → dinormalisasi (`costNoteKey`) untuk mencocokkan dua kanal (aplikasi purchasing vs WhatsAapp/REKAP COST).
- **Item**: `Cost ID` (`COST-xxxx`) → `costEventKey`; dedupe per item, karena satu nota berisi banyak item.
- 117 nota unik dari 272 item; **1 baris tanpa referensi nota** (COST-0020, deskripsi `Test Item`) — tetap dihitung sebagai event dan dilaporkan di `notesWithoutKey` (tidak dibuang diam-diam).
- **67 dari 117 nota mencakup lebih dari satu proyek.** Total header **tidak boleh** ditempel ke semua proyek: alokasi per item/qty (`allocateNoteByItems`) dan selisih header vs item dilaporkan (`unallocated_amount`).
- **90 baris `COST ITEMS` ber-cost-center `operasional ws`** (overhead WS) — bukan proyek. Dry-run memisahkan bucket `project` / `overhead` / `blank` (0 blank); overhead tidak boleh masuk biaya proyek mana pun (kebijakan existing dipertahankan, tidak diubah).
- **Kanál aplikasi belum ada di sumber**: `receivings` (nota aplikasi) belum punya padanan `Document Reference` di COST ITEMS saat audit (`matchedNotes = 0`, `onlySheet = 117`). Jadi `reconcileCostSources` siap, tetapi **belum ada satu pun nota yang benar-benar tercatat di dua kanal** → integrasi Bakpau/WA tetap **belum boleh diklaim aktif**.

`CLOSING` vs sumber:
- `61`: material CLOSING 17,372,796 **sama** dengan PROJECT SUMMARY (snapshot terbaru).
- `99`: CLOSING 23,240,863 vs summary 23,901,863 → **selisih 661,000** (snapshot closing belum diperbarui).
- `83`: CLOSING 1,061,380 vs summary 4,225,401 → **selisih 3,164,021**.
→ `CLOSING` adalah **snapshot yang bisa basi**; jangan menjumlahkan `CLOSING B5` + `COST ITEMS`. Bila Tahap B butuh angka material, pakai event `COST ITEMS`/`cumulative` dan tampilkan tanggal snapshot CLOSING sebagai freshness.

`PETTY CASH`:
- Hanya 2 cost center: `99 Baroni` = 250,000 (sama persis dengan `CLOSING → Baroni → B6`) dan `operasional ws` = 503,100 (overhead WS).
- Daemon `drive_cost_sync.fetch_petty_cash` mengisi `petty_cash = 0.0` untuk **setiap** proyek yang tidak punya baris petty cash (`petty_map.get(no, 0.0)`) → melanggar aturan “belum tercatat ≠ 0”, dan overhead WS tidak pernah terlampir ke baris proyek.

---

## 6. Helper + tests yang dikirim (A6)

| Artefak | Isi |
|---|---|
| `lib/projectCrosswalk.js` | Modul **murni** (tanpa import/jaringan/DB/DOM): `normalizeProjectNo`, `buildProjectIndex`, `buildAliasIndex`, `resolveProject`, `suggestCandidates`, `parseSourceAmount`, `UNIT_CONTRACT`, `toIdr`, `laborSettlement`, `checkSaldoFormula`, `allocateNoteByItems`, `costEventKey`, `costNoteKey`, `reconcileCostSources` |
| `scripts/project-data-map-test/crosswalk_test.mjs` | 36 assertion kontrak (fixture **sintetis**, berlabel) |
| `scripts/project-data-map-test/run.py` | Runner: sandbox TMPDIR resmi, tanpa DB/jaringan/.next |
| `scripts/project-data-map/dryrun.mjs` + `run_dryrun.py` | Dry-run terhadap **sumber nyata read-only**; output privat + anonim |
| `scripts/project-data-map/parser_matrix.py` | Matriks 4 parser (bukti §3.2) |
| `docs/project-cost/dry-run-evidence.json` | Bukti dry-run **anonim** (tanpa nominal/nama asli) |
| `docs/project-cost/parser-matrix.json` | Matriks parser |

Bukti eksekusi:
```
python3 scripts/project-data-map-test/run.py    -> {"pass": 36, "fail": 0}
python3 scripts/project-data-map/run_dryrun.py  -> ok:true, tally matched 16 / not_found 63 / non_project 1
                                                   unitUnverified 0, saldoFormulaOk true (2/2)
                                                   events 117, perProjectEqual 11/11
python3 scripts/project-data-map/parser_matrix.py -> 7/17 format tidak sepakat antar parser
```
RED→GREEN terlihat nyata: runner pertama kali keluar `{"pass":0,"fail":1,"red":true,"failures":["lib/projectCrosswalk.js belum ada (RED)"]}` sebelum modul dibuat.

Fixture di git **sintetis** (proyek `101`, `83`, `99`, `55`, `77`, nama generik); snapshot berisi nominal nyata hanya ada di folder audit privat di luar git.

---

## 7. Yang BELUM selesai / blocker spesifik (A7)

| # | Item | Status | Keterangan |
|---|---|---|---|
| 1 | Skema `tukang_projects` (apakah ada kolom `project_no`) | **ACCESS_REQUIRED** | REST 401 untuk anon/aplikasi. Payload daemon (`sync_replace_tukang_detail`) hanya berisi `project_name/total_upah/status/batch/sort_order/item_count/total_rincian` → **nomor tidak pernah dikirim**. Verifikasi kolom butuh akses admin yang sah. |
| 2 | Menyimpan nomor proyek ke `tukang_projects` | **PATCH DRAFT, TIDAK DIAPPLY** | Perubahan harus aditif (kolom `project_no text` + backfill per tukang) + daemon mengirim kolom A `List Proyek`. Dilarang di Tahap A (bukan DDL/live). |
| 3 | 34 nomor legacy Pujon + 20 baris tanpa nomor | **UNRESOLVED (data)** | Butuh pengisian nomor/alias oleh finance di sheet, atau keputusan bahwa baris `Service *` memang jasa non-proyek. |
| 4 | 9 tab CLOSING tanpa alias terdaftar | **UNRESOLVED (data)** | Isi kolom `Confirmed Aliases` di `PROJECT MASTER` untuk nama tab; jangan fuzzy. |
| 5 | Selisih hak upah Pujon: Σ`List Proyek` 519,911,600 vs Dashboard 507,538,700 (**12,372,900**) | **UNRESOLVED (pertanyaan)** | Dugaan bukan bukti. Pertanyaan tepat: *“Apakah `TOTAL HAK UPAH PEKERJAAN` di Dashboard = jumlah batch yang sudah ditutup (E16), sedangkan `List Proyek` memuat proyek yang belum ditutup — dan apakah baris `Cove 2 - 27` yang muncul 2× (10,421,500 dan 2,425,000) memang dua entitas?”* |
| 6 | `CLOSING` basi untuk 99 (661,000) dan 83 (3,164,021) | **UNRESOLVED (data)** | Finance perlu memperbarui snapshot closing; aplikasi tidak boleh “merapikan” angka historis. |
| 7 | Satuan kuantitas `COST ITEMS` | **UNVERIFIED (gap sumber)** | Tidak ada kolom satuan; jangan konversi qty. |
| 8 | Parser `drive_cost_sync.parse_rupiah` | **Temuan, tidak diubah** | Daemon read-only pada batch ini; patch parser dilaporkan sebagai rekomendasi (desimal & tanda negatif). |
| 9 | Formula saldo di `TukangUpah.js:226` | **Temuan, tidak diubah** | Perbaikan UI = Tahap B; kontrak benar sudah dikunci `checkSaldoFormula`. |
| 10 | Revenue / rasio cost-revenue / dashboard finance penuh | **HOLD** | Sesuai brief: tidak ada perubahan denominator, tidak ada dashboard baru. |

---

## 8. Handoff ke Tahap B

- **Commit A** (branch `feat/project-data-map`, di atas `ce8d132`) — lihat pesan commit & laporan kartu.
- Worktree B: `/home/ubuntu/dev-workspaces/purchasing-project-cost-link` → **fast-forward ke commit A**, jangan reset/discard. B kini **integrator** A + Bit (`t_50b783de`) + Bandeng (`t_310dfb07`): merge/cherry-pick commit isolated mereka secara terkontrol, dan buktikan staging lewat actual owner + BUILD_ID + JS/CSS (nama PM2 duplikat lama bukan bukti health).
- Wajib dipakai B: `lib/projectCrosswalk.js` (`resolveProject` untuk identitas, `parseSourceAmount` + `toIdr` untuk angka, `laborSettlement` untuk hak/kasbon/pelunasan, `reconcileCostSources` + `allocateNoteByItems` untuk material).
- Dilarang B: join nama sebagai relasi final, menampilkan `null` sebagai 0, menjumlahkan ringkasan/CLOSING snapshot sebagai event, konversi qty tanpa satuan, menerbitkan nomor proyek baru.
- Perbaikan UI yang sudah punya kontrak di sini: label satuan ribuan di `TukangUpah.js`, formula saldo, label `ACTUAL_WAGE_NOTE` di `lib/laborSource.js` (menyebut “uang yang sudah tercatat keluar” padahal `total_upah` = hak, bukan pembayaran).
- Angka **jangan** diklaim final: 34 nomor legacy + 20 baris tanpa nomor + 9 tab CLOSING masih unmapped; tampilkan state jelas (unmapped/ambiguous/overhead), bukan 0.

---

## 9. Gap assessment tujuh skenario Novi–DAT–Bakpau (acuan `NOVI_BAKPAU_ACCEPTANCE.md`)

Acuan: `/home/ubuntu/agents/brooklyn/purchasing-project-cost-next/NOVI_BAKPAU_ACCEPTANCE.md`. Tujuh skenario ini **acuan desain & targeted tests**, **bukan** bagian yang diklaim aktif. Konektor WhatsApp Bakpau, write transaksi live, dan live DDL **di luar izin batch A/B**. Kolom “bukti ada” hanya menunjuk file/kontrak yang **benar-benar ditemukan di worktree ini**; “bukti” di level mock/harness **tidak** berarti konektor atau DB live berfungsi.

| # | Skenario | Bukti existing (file/kontrak) | Gap yang tersisa |
|---|---|---|---|
| 1 | Dibeli **tanpa PR** (direct purchase) | `modules/receivings/purchaseSave.js` (`savePurchase`, `validatePurchaseBoundary`, header tanpa PR + `alokasi` readback per proyek); harness `scripts/lean-admin-c-flow` S4 (2 lean + 1 direct dalam satu nota) — **level mock** | Tidak ada penulisan ke DB live yang diverifikasi; nota tanpa rincian item belum punya jalur khusus “nominal saja” yang teruji di sumber nyata; tidak menambah stok otomatis dari nota (belum ada mekanismenya sama sekali, sesuai aturan) |
| 2 | Dibeli **kurang dari PR** | `modules/requests/leanRequest.js`: `withCloseMarker` (`[Tutup: alasan]`), `closeReasonOf`, `closedAtOf`, `isActionable`; harness S5/S6 (sisa tetap terbuka, qty asli utuh) | Perhitungan “butuh / sudah dibeli / sisa” bertumpu pada `receiving_items.quantity_received` + `pr_items.quantity` di level mock; belum ada pembacaan DB live, dan belum ada kontrak angka yang mengunci satuan qty (lihat §3.3) |
| 3 | **Spek aktual berbeda** | Hanya tersedia `receiving_items.item_name` / `supplier_category` sebagai tempat menulis spek aktual; `validatePurchaseBoundary` menolak harga 0/unknown | **Belum ada** pasangan “spek awal vs spek aktual” + jejak konfirmasi Novi/tukang, belum ada penanda retur/refund terpisah dari event beli. Perlu kontrak/kolom baru (draft migrasi aditif, bukan apply) |
| 4 | **Satu nota beberapa proyek** | `savePurchase` membangun alokasi per item dan me-readback per proyek (S4: 476k/105k); `allocateNoteByItems` (Tahap A) mengunci aturan alokasi per item/qty + `unallocated_amount` | Di data nyata **67 dari 117 nota COST ITEMS memang lintas proyek** dan 90 baris ber-cost-center `operasional ws`; belum ada mekanisme membawa alokasi ini dari kanal WA/REKAP COST ke tabel aplikasi. Store alokasi di DB live belum diverifikasi |
| 5 | Nota **campuran ber-PR/direct** | S4 di harness mencampur baris lean + direct dalam satu nota; `receiving_items.pr_item_id` boleh kosong per baris | Belum ada uji untuk **beberapa PR berbeda** dalam satu nota; belum ada readback live yang membuktikan biaya tidak dipecah/digandakan karena beda linkage |
| 6 | **Bakpau mencatat lebih dulu**, PR menyusul | Hanya: `costNoteKey`/`costEventKey` (Tahap A) sebagai kunci eksternal bersama + `duplicate_invoice` exact-match di `savePurchase` | **Belum ada** kandidat pencocokan pembelian existing pada layar kebutuhan, belum ada info source/freshness, belum ada aturan “link transaksi existing tanpa purchase/cost kedua”. Butuh konektor WA (di luar batch) |
| 7 | **PR lebih dulu**, pembelian dicatat Bakpau | S6 menghitung realisasi (DIBELI dihitung, RETUR diabaikan) di level mock; `reconcileCostSources` (Tahap A) menyiapkan rekonsiliasi dua kanal & menandai `notesWithoutKey` | Belum ada penautan otomatis alokasi aktual → baris PR di DB live; referensi ambigu belum punya state “perlu rekonsiliasi” di UI; progres fisik tetap harus dari penerimaan/serah terima (belum diuji end-to-end) |

**Kesimpulan jujur:** tidak satu pun dari tujuh skenario bisa disebut “integrasi Novi–Bakpau aktif”. Yang nyata pada Tahap A adalah **fondasi kontrak**: kunci identitas proyek (`resolveProject`), kunci satuan (`toIdr`/`UNIT_CONTRACT`), kunci nota & item (`costNoteKey`/`costEventKey`), aturan alokasi per item (`allocateNoteByItems`), dan rekonsiliasi agregat-vs-event (`reconcileCostSources`). Skenario 3, 6, dan 7 (dan bagian live dari 1–5) dicatat untuk **paket berikutnya**, bukan dikerjakan dengan memotong scope A/B.

---

## 10. Routing kanal & ownership terbaru (`UPDATE_DAT_CHANNELS.md`)

Arahan DAT terbaru (menggantikan batas lama “Bamboo-only / konektor belum boleh dibentuk”; guardrail lain tetap):

- **Input Bakpau**: Telegram **atau** WhatsApp melalui adapter authorized yang existing, dengan **satu** validation/purchase boundary (jalur yang sama dengan input admin). Lane konektor = **Bandeng** (`t_310dfb07`), file adapter/backend/tests baru.
- **Output** notifikasi / status / permintaan klarifikasi: **hanya Telegram ke DAT DM `1320969465`**. Tidak memakai destination inbound reply sebagai default outbound, **tanpa** fallback WhatsApp, dan **tidak** ke Novi/vendor/grup.
- **Modul Approval purchasing OFF** (lane **Bit**, `t_50b783de`) tidak mematikan validasi data, auth, otorisasi manusia atas write finansial, security approval tool, atau modul lain seperti Sales Invoice. Tidak boleh mengembalikan status `APPROVED` fiktif; histori approval lama dipreservasi.
- **Tahap B kini integrator**: menunggu exact commit A + Bit + Bandeng (parent link sudah terpasang: `t_da4a9ef8` ← `t_9753008e`, `t_50b783de`, `t_310dfb07`), fast-forward A lalu merge/cherry-pick commit isolated Bit/Bandeng **tanpa reset/discard**. Staging harus membuktikan **actual owner + BUILD_ID + JS/CSS**; nama PM2 duplikat lama bukan bukti health.
- **Kejujuran laporan**: bedakan `implemented/tested` vs `activated/live-write/transport-verified`. Kode konektor atau notifikasi Kanban **bukan** bukti konektor pembelian live aktif.

Kontribusi Tahap A untuk aturan ini: `costNoteKey` (kunci nota bersama antar kanal) dan `costEventKey` (kunci item) adalah identitas yang harus dipakai **kedua** adapter agar retry bukti yang sama idempotent dan pembelian sah berulang tidak terhapus. `notesWithoutKey` (§5) menunjukkan satu baris nyata yang belum punya referensi nota — adapter baru wajib menolak/menandai kasus seperti ini, bukan menebak.
