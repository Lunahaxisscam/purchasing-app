# Modul RAB & BOQ — Admin Suite (t_18564dce)

Port modul **perhitungan-rab-otomatis-2.html** (DAT, 1570 baris, standalone
Automatic BOQ Calculator, payload `version: 5`) ke Admin Suite aplikasi
purchasing. **Admin-only.** Source HTML TIDAK ditaruh di `public/` dan TIDAK
di-render via iframe — seluruh logika di-port ke React + CSS scoped.

## File & kepemilikan

| File | Isi |
|---|---|
| `modules/rab-boq/boqCalc.js` | Rumus VERBATIM dari source: `num`, `calcCostArea`, `calcCostPart`, `calcItem`, `breakdownTotal`, `calcTotals` (core `calculateTotals`), `normalizeItem`, formatter `thousand`/`rupiahFromK`, `csvCell`, `safeFileName` + **sanitizer import** (limits/type validation). |
| `modules/rab-boq/lib.js` | Seed verbatim: `templates` (Plain/Preliminary/Interior/Civil), `plainChoiceSeed`, `standardNoteSeed`, `buildTemplateChoiceSeed`, `itemOptionsFor`, `incrementReference` (BOQ-001→BOQ-002), `todayJakarta`, `masterProjectReff` (run 58). |
| `modules/rab-boq/pdf.js` | Port PDF binary builder (A4, multi-page, notes, summary) — verbatim, hanya menerima payload+items. Mengembalikan `Uint8Array`. |
| `modules/rab-boq/csvExport.js` | Port Export CSV (BOM + `;`, kolom TOTAL (000)/(IDR), breakdown detail, baris total). |
| `modules/rab-boq/view.jsx` | UI full-page kalkulator (React, state = state source) + CSS scoped `boq-` (tanpa override global). |
| `modules/rab-boq/CreateProjectModal.jsx` | Aksi admin-only "Buat Proyek dari BOQ". |
| `scripts/rab-boq-test/run.py` | Harness regresi (math parity, import, sanitasi, guard). |
| `scripts/rab-boq-render-test/run.py` | Harness render runtime (React+jsdom): computed styles, guard, status penawaran (run 58). |

Guard 3 lapis untuk menu/halaman/data:

1. **Menu**: section "Admin Suite" di `lib/constants.js` sudah `adminOnly: true`
   — sidebar (`components/Sidebar.js`) menyaring section per role dari
   `profiles.role` (server), bukan localStorage. Run 58: **RAB & BOQ adalah
   item PERTAMA** di bawah heading ADMIN SUITE (feedback DAT) dan heading
   dibuat lebih kontras (`styles/globals.css` `.nav-group-label` — weight 800,
   `var(--ivory)`; perubahan global ini memengaruhi seluruh section heading,
   bukan hanya modul).
2. **Render**: `pages/index.js` merender `<BoqModule />` hanya bila
   `page === 'rab_boq' && role === 'admin'`; selainnya panel
   "khusus administrator" (pola sama dengan Planning/Finance/Settings).
   `role` berasal dari tabel `profiles` via sesi Supabase yang terverifikasi.
3. **Data**: satu-satunya mutasi modul adalah INSERT Master Project, lewat
   klien Supabase sesi user. **CATATAN RUN 51 (verifikasi independen):
   pembatas terakhir di level DB BELUM berfungsi** — lihat bagian
   "Temuan keamanan live" di bawah. Guard yang benar-benar aktif saat ini
   adalah menu + render; lapisan data dijabarkan jujur di bawah.
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
- Status penawaran prototype (`offerStatus`) hanya dipulihkan bila enum-nya
  dikenal (`DRAFT/TERKIRIM/DISETUJUI/DITOLAK`); nilai asing → `DRAFT`.

## Persistence boundary (jujur, tidak fake-persistent)

**Source HTML murni client-only: tidak ada localStorage, tidak ada server.**
Perilaku ini dipertahankan: data hidup selama tab/komponen ter-mount;
menutup tab = data hilang. Yang TIDAK dilakukan: menyimpan draft ke
Supabase/localStorage lalu mengaku "source menyimpan" (fake persistent).

- **Run 58 (feedback DAT): toolbar atas kini hanya berisi Export PDF.**
  Tombol *Fill Sample Data*, *Import JSON*, *Save as Draft*, *Download
  template*, dan *Export CSV* dihapus dari toolbar beserta helper draft-nya.
- **Peringatan kehilangan data (eksplisit, DAT memintanya):** draft tetap
  **client-only** — tidak ada autosave/server. Agar penghapusan tombol tidak
  memutus satu-satunya jalur backup, **Backup JSON / Pulihkan JSON** tersedia
  sebagai tautan kecil di blok Status penawaran (payload sama persis dengan
  Save as Draft lama, kini termasuk status penawaran prototype).
- *Export CSV* tidak lagi di UI (source-nya `csvExport.js` tetap ada dan
  teruji; bisa dimunculkan kembali bila DAT berubah pikiran).

## Status penawaran (run 58 — PROTOTYPE, menunggu keputusan DB)

Alur bisnis DAT: **Belum dikirim → Terkirim → Disetujui / Ditolak.**

- **Export PDF BUKAN bukti terkirim.** Status `Terkirim` dicatat admin secara
  **eksplisit** ("Tandai terkirim") **setelah** pengiriman nyata (email/WA di
  luar sistem). Tidak ada kirim otomatis WhatsApp/email.
- "Catat keputusan" muncul hanya pada status Terkirim: pilihan
  Disetujui/Ditolak, tanggal keputusan (hari ini), **siapa yang menyetujui/
  menolak (pihak eksternal, opsional)**, dan catatan/alasan (wajib makna saat
  ditolak). Status tampil sebagai badge — bukan bagian dari toolbar export.
- **Disetujui mengunci versi**: saat "Tandai terkirim", snapshot kecil versi
  (revision + BOQ reff + total quotation + tanggal/pencatat) masuk riwayat
  `sentVersions` yang terpisah dari meta — revisi lanjut TIDAK menimpa
  riwayat. Tidak ada jalur auto ke PR/Budgeting/Revenue (transisi RAB final
  existing tetap sumber finance).
- **Sebelum terkirim, status tampil "Belum dikirim"** — bukan status palsu.
- **Persistensi: IN-MEMORY (prototype).** Snapshot/status BUTUH dukungan DB;
  freeze migrasi berlaku sehingga TIDAK ada tabel baru sekarang, dan UI
  TIDAK mengklaim "tersimpan" — baris persistensi menyatakan jujur
  "TIDAK tersimpan di server" + backup manual JSON.
- **Usulan spec minimal (menunggu izin DAT, jangan implement sebelum
  disetujui):** tabel `boq_offers` (`id uuid pk`, `project_id uuid null fk
  projects`, `boq_reff text`, `revision text`, `status text check in
  ('DRAFT','TERKIRIM','DISETUJUI','DITOLAK')`, `payload jsonb` snapshot,
  `sent_at timestamptz`, `sent_by uuid null`, `decided_at timestamptz`,
  `decided_by_external text null`, `decision_note text null`,
  `created_at/updated_at`) + RLS admin-only (lihat temuan RLS di bawah —
  aktifkan RLS dulu, baru tabel ini aman). Alternatif lebih kecil: satu kolom
  `jsonb` di tabel baru `boq_documents` per versi. Keduanya = mutasi schema
  → butuh keputusan DAT.

## Batas bisnis (DAT, termasuk konfirmasi Revenue)

- BOQ adalah **modul tambahan + pintu awal membuat nomor proyek** saja.
- "Buat Proyek dari BOQ" = **aksi eksplisit berkonfirmasi** (window.confirm
  dengan ringkasan mapping) → INSERT `projects {kode, code, name, status:
  NOT_START}`. Tidak auto-activate penawaran/draft, tidak membuat
  PR/Budgeting/Revenue, tidak menulis angka BOQ ke mana pun.
- **Run 58 (feedback DAT, screenshot 1792153939917): PROJECT REFF NO
  terikat Master Project** — bukan free text `PRJ-001`:
  - Admin memilih master dari panel picker (data = tabel `projects` yang
    dimuat server-side; kolom live: `id, name, status, created_at, kode, code`).
    Mempertahankan identitas master (kode + nama + status) — mengganti/Melepas
    (Lepas) tautan kapan saja.
  - **Project Reff No = `PRJ-<kode master>` computed & readonly**; tidak bisa
    diketik manual, tidak ada nomor dummy. Placeholder saat belum terikat.
  - **Import JSON TIDAK menimpa computed ref** — selama tautan aktif, effect
    guard mengembalikan `PRJ-<kode>` (teks "computed ref tidak menimpa
    existing"); saat tanpa tautan, ref kosong (bukan fallback `PRJ-001`).
  - **BOQ REFF tetap terpisah** dari nomor proyek (increment internal modul).
- **Kode proyek untuk "Buat Proyek" = manual & authoritative**: kode master
  di modul Projects diisi admin secara manual (live: 83/99/101/102 — tidak
  kontinu), sehingga modal TIDAK menawarkan tebakan `max+1` (dihapus dari
  run sebelumnya). Cek duplikat real-time + guard "BOQ sudah terikat master
  existing → tolak dobel buat".
- **Revenue/Project Finance TIDAK ditarik dari modul BOQ.** Konfirmasi DAT:
  Revenue Project Finance mengambil **FILE RAB FINAL existing proyek** —
  opsi wiring otomatis BOQ draft → revenue dibatalkan. Discovery finance
  (t_bb379b0d) memakai RAB final existing; modul ini tidak menyediakan
  endpoint/field untuk itu dan tidak mengubah sumber finance apa pun.

## Numbering (gap terdokumentasi, butuh keputusan DAT)

- **Master Project**: `kode` diisi **manual oleh admin** di modul Project —
  TIDAK ada generator otomatis/unique constraint di repo. Nomor PR punya
  RPC `next_pr_number` (server), nomor project tidak. Karena itu modal
  "Buat Proyek" meminta kode manual (authoritative) + cek duplikat;
  **penomoran otomatis server-side butuh RPC/UNIQUE (mutasi schema) — freeze
  migrasi berlaku, gap ini sengaja TIDAK diakali di client** (client max+1
  justru dihapus karena bisa menabrak nomor yang dipakai orang lain).
- BOQ Reff (BOQ-001, dst.) di dalam modul adalah penomoran lokal modul
  (increment saat Reset, verbatim source) — bukan nomor proyek master.

## Tipografi & kontras lokal (run 58, feedback DAT screenshot 1792155666579)

- **Template pills**: global `button { color: white }` membuat label
  Plain/Preliminary/Interior/Civil putih-di-atas-putih. Diperbaiki SCOPED:
  warna teks **hex eksplisit** (bukan `var()`) untuk state
  normal/hover/active/focus-visible + border nyata olive.
- **Kartu Settings samar**: global `aside { background: var(--sidebar-bg);
  color: #e6e7dc }` bocor ke `<aside class="boq-side">` milik modul —
  heading Settings dan label toggle Apply markup/discount, Apply PPN, Show
  markup/discount in PDF jadi pucat. Dineutralkan scoped di `.boq-root`
  (kartu kembali putih, teks gelap); label toggle weight 600, helper 500,
  heading 700 — bukan semuanya bold, sesuai skala tipografi DAT.
- Uji kontras: computed-style di harness render (A4/A6), bukan cuma JSX.
- Sidebar heading ADMIN SUITE: weight 800 + `var(--ivory)` (~9.6:1 di atas
  `--olive-800`) — perubahan global kecil di `styles/globals.css`.

## Temuan keamanan live (run 51, verifikasi independen — butuh keputusan DAT)

Probe read-only terhadap DB live (anon key dari `.env.local`, klaim JWT
terverifikasi `role=anon`, ref `wuurovgjflrhczlsbixm`):

- **RLS tidak ditegakkan server-side.** `anon` dapat `SELECT` baris dari
  `projects`, `profiles` (termasuk kolom `role`), `purchase_requests`,
  `pr_items`, `receivings`, `handovers`, `vendors`.
- **`anon` dapat `INSERT` ke `projects`** (terbukti satu baris probe yang
  langsung dihapus ulang oleh verifikator — tidak ada jejak; baris tersisa
  dengan kode `ZZPROBE`: 0).
- Implikasi jujur untuk modul ini: guard **menu** (sidebar) dan **render**
  (`pages/index.js`) aktif, tetapi "guard data = RLS" **belum** menjadi
  pembatas terakhir — sebuah klien yang tahu URL+anon key (bisa dibaca
  siapa pun dari bundle publik) dapat menulis `projects` tanpa sesi admin.
  Sifat data yang bocor pun lintas-modul, bukan khusus BOQ.
- **Bukan regresi commit `b2a2a2d`** — kondisi ini pra-eksisting dan
  menyangkut seluruh app (migrations/ di repo memang belum memuat policy
  `projects`; konsisten dengan temuan drift repo↔DB audit t_905e0e5a).
- **Usulan perbaikan (menunggu izin DAT; freeze migrasi tetap berlaku —
  TIDAK diterapkan dalam commit ini):**
  1. `ALTER TABLE projects ENABLE ROW LEVEL SECURITY;` + policy
     select/insert/update/delete untuk `authenticated` (insert/update
     diperketat ke `profiles.role='admin'`), dan policy yang setara untuk
     tabel operasional lainnya, dimulai dari `profiles`.
  2. Sementara RLS belum aktif: jangan pernah mengandalkan guard klien
     saja untuk data sensitif; pertimbangkan mematikan akses `anon` pada
     Supabase API untuk tabel internal (dashboard Auth/Policies).
  3. Setelah RLS aktif, klaim "guard 3 lapis" pada modul ini kembali penuh
     tanpa perubahan kode aplikasi.

## Keamanan ringkas

- Tidak ada file source HTML di `public/`; tidak ada iframe; tidak ada
  `dangerouslySetInnerHTML` di modul ini (semua render via React).
- Tidak menyimpan role di localStorage; guard memakai `profiles.role`
  (server-verified session). Pembatas data di level DB (RLS) **belum
  aktif di live DB** — lihat "Temuan keamanan live" di atas beserta
  usulan perbaikan yang menunggu keputusan DAT.
- Import JSON: lihat bagian hardening di atas (ukuran/tipe/jumlah/panjang).

## RINGKASAN RUN 58 — live vs prototype vs menunggu keputusan

**Live (berfungsi sekarang, admin-only):** pills template terbaca semua
state; sidebar RAB & BOQ item pertama + heading kontras; Project Reff No
terikat Master Project (picker, computed readonly, guard dobel-buat, kode
manual authoritative tanpa max+1); toolbar hanya Export PDF; status penawaran
Belum dikirim → Terkirim → Disetujui/Ditolak dengan tanggal/pencatat/alasan;
Backup/Pulihkan JSON (termasuk status) sebagai jalur backup; guard 3 lapis
menu/render tetap.

**Prototype (in-memory, jujur dilabeli):** snapshot versi terkirim &
status penawaran — hilang saat tab ditutup; UI menyatakan eksplisit "TIDAK
tersimpan di server".

**Menunggu keputusan DAT (freeze migrasi):** tabel `boq_offers`/persistensi
status server-side; RLS enforcement (temuan live); unique constraint/RPC
penomoran project.
