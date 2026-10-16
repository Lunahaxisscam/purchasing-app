# Modul RAB & BOQ — Admin Suite (t_18564dce)

Port modul **perhitungan-rab-otomatis-2.html** (DAT, 1570 baris, standalone
Automatic BOQ Calculator, payload `version: 5`) ke Admin Suite aplikasi
purchasing. **Admin-only.** Source HTML TIDAK ditaruh di `public/` dan TIDAK
di-render via iframe — seluruh logika di-port ke React + CSS scoped.

## File & kepemilikan

| File | Isi |
|---|---|
| `modules/rab-boq/boqCalc.js` | Rumus VERBATIM dari source: `num`, `calcCostArea`, `calcCostPart`, `calcItem`, `breakdownTotal`, `calcTotals` (core `calculateTotals`), `normalizeItem`, formatter `thousand`/`rupiahFromK`, `csvCell`, `safeFileName` + **sanitizer import** (limits/type validation). |
| `modules/rab-boq/lib.js` | Seed verbatim: `templates` (Plain/Preliminary/Interior/Civil), `plainChoiceSeed`, `standardNoteSeed`, `buildTemplateChoiceSeed`, `itemOptionsFor`, `incrementReference` (BOQ-001→BOQ-002), `todayJakarta`. |
| `modules/rab-boq/pdf.js` | Port PDF binary builder (A4, multi-page, notes, summary) — verbatim, hanya menerima payload+items. Mengembalikan `Uint8Array`. |
| `modules/rab-boq/csvExport.js` | Port Export CSV (BOM + `;`, kolom TOTAL (000)/(IDR), breakdown detail, baris total). |
| `modules/rab-boq/view.jsx` | UI full-page kalkulator (React, state = state source) + CSS scoped `boq-` (tanpa override global). |
| `modules/rab-boq/CreateProjectModal.jsx` | Aksi admin-only "Buat Proyek dari BOQ". |
| `scripts/rab-boq-test/run.py` | Harness regresi (math parity, import, sanitasi, guard). |

Guard 3 lapis untuk menu/halaman/data:

1. **Menu**: section "Admin Suite" di `lib/constants.js` sudah `adminOnly: true`
   — sidebar (`components/Sidebar.js`) menyaring section per role dari
   `profiles.role` (server), bukan localStorage.
2. **Render**: `pages/index.js` merender `<BoqModule />` hanya bila
   `page === 'rab_boq' && role === 'admin'`; selainnya panel
   "khusus administrator" (pola sama dengan Planning/Finance/Settings).
   `role` berasal dari tabel `profiles` via sesi Supabase yang terverifikasi.
3. **Data**: satu-satunya mutasi modul adalah INSERT Master Project, lewat
   klien Supabase sesi user — **RLS `projects` di DB adalah pembatas
   terakhir** (user non-admin yang memaksa payload tetap ditolak DB).
   Tidak ada API route baru di `pages/api/` untuk modul ini; JSON/CSV/PDF
   sepenuhnya client-side (tidak ada endpoint ekspor untuk dijaga).

## Rumus (tidak diubah dari source)

- Item total = `qty × price`, keduanya di-`max(0,·)`; harga ribuan IDR (000).
- Breakdown komponen: Amount = **P × L × Qty × UnitPrice** (area = max(0,P)×max(0,L)).
- Markup on cost: `base × rate%` (cap 99%) atau nominal Rp (`rate/1000` ribuan).
- Gross margin: `base/(1 − rate%) − base` (cap 99%).
- Discount: `−base × rate%` atau `−min(base, nominal)`.
- PPN configurable (default 11% dari source, tanpa hardcode tarif baru):
  `tax = (base + adjustment) × rate%`, total quotation = base+adjustment+tax.

## Import JSON (hardening di atas source)

Source mem-parse JSON apa pun. Port ini menambah lapisan (bukan mengganti
perilaku normal):

- Maks ukuran file **2 MB** (ditolak di depan, tanpa parse).
- Maks **500 item**, 200 komponen/item, 500 pilihan/template, 100 note.
- Panjang string dipotong 2000 karakter; karakter kontrol dibuang.
- Angka di-clamp (`qty/price ≤ 1e9`, dimensi ≤ 1e6); nilai non-numerik
  → fallback (bukan NaN/crash).
- `version === 1` tetap didukung: harga dibagi 1000 (legacy, source line 1473).
- React meng-escape string saat render, sehingga payload berbahaya
  tidak pernah dieksekusi sebagai HTML.

## Persistence boundary (jujur, tidak fake-persistent)

**Source HTML murni client-only: tidak ada localStorage, tidak ada server.**
Perilaku ini dipertahankan: data hidup selama tab/komponen ter-mount;
menutup tab = data hilang. Yang TIDAK dilakukan: menyimpan draft ke
Supabase/localStorage lalu mengaku "source menyimpan" (fake persistent).

- **Backup/restore resmi = file**: *Save as Draft* (JSON lengkap, termasuk
  templateChoices & settings) → *Import JSON* untuk melanjutkan.
- *Download template* = JSON sama (payload identik); *Export CSV/PDF* =
  dokumen hasil.

## Batas bisnis (DAT, termasuk konfirmasi Revenue)

- BOQ adalah **modul tambahan + pintu awal membuat nomor proyek** saja.
- "Buat Proyek dari BOQ" = **aksi eksplisit berkonfirmasi** (window.confirm
  dengan ringkasan mapping) → INSERT `projects {kode, name, status:
  NOT_START}`. Kode project: pratinjau `max+1` dari daftar (pattern
  `nextPrNum` CreateModal), **bisa ditimpa admin**, cek duplikat saat submit.
  **Tidak** auto-activate penawaran/draft, **tidak** membuat PR/Budgeting/
  Revenue, **tidak** menulis angka BOQ ke mana pun.
- **Revenue/Project Finance TIDAK ditarik dari modul BOQ.** Konfirmasi DAT:
  Revenue Project Finance mengambil **FILE RAB FINAL existing proyek** —
  opsi wiring otomatis BOQ draft → revenue dibatalkan. Discovery finance
  (t_bb379b0d) memakai RAB final existing; modul ini tidak menyediakan
  endpoint/field untuk itu dan tidak mengubah sumber finance apa pun.

## Audit numbering (sudah dilakukan, hasil)

- **Master Project**: `kode` diisi **manual oleh admin** di modul Project
  (`modules/projects/form.jsx`, field "Kode Project (Nomor)" required) —
  TIDAK ada generator otomatis/unique constraint di repo. Nomor PR punya
  RPC `next_pr_number` (server), nomor project tidak. Karena itu:
  - Fitur ini memakai **pratinjau** kode (`max+1`) yang bisa ditimpa, plus
    cek duplikat saat submit terhadap daftar terbaru (cegah duplikasi kasus
    dua admin bersamaan sejauh daftar yang dimuat; race ekstrem tetap
    mungkin karena DB belum punya unique constraint — di luar batas
    migrasi yang dibekukan).
  - **Gap terdokumentasi** (butuh keputusan DAT, freeze migrasi berlaku):
    `projects.kode` belum `UNIQUE` dan belum ada RPC penomoran server-side
    seperti `next_pr_number`. Bila DAT mengizinkan (migrasi baru), generator
    + unique index dapat ditambahkan dan modal ini tinggal memanggil RPC.
- BOQ Reff (BOQ-001, dst.) dan Project Reff (PRJ-001) di dalam modul adalah
  **penomoran lokal modul** (increment saat Reset, verbatim source) — bukan
  nomor proyek master dan tidak dipakai sistem lain.

## Keamanan ringkas

- Tidak ada file source HTML di `public/`; tidak ada iframe; tidak ada
  `dangerouslySetInnerHTML` di modul ini (semua render via React).
- Tidak menyimpan role di localStorage; guard memakai `profiles.role`
  (server-verified session) + RLS DB untuk mutasi.
- Import JSON: lihat bagian hardening di atas (ukuran/tipe/jumlah/panjang).
