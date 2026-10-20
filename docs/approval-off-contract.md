# Kontrak Approval OFF (sementara) — t_50b783de

Mandat DAT: sembunyikan modul **Approval purchasing** dan putuskan seluruh
konektor khusus approval **sementara**. Ini perubahan alur bisnis purchasing —
**bukan** menonaktifkan auth/RLS, bukan security/tool approval Hermes, bukan
approval customer Sales Invoice, dan bukan mematikan kanal messaging.

Data & riwayat lama **dipreservasi**. Tidak ada DDL live, tidak ada deploy dari
worker ini.

---

## 1. Satu saklar

`lib/constants.js`

```js
export const APPROVAL_MODULE_ENABLED = false   // false = modul OFF
```

Semua titik membaca nilai ini (tidak ada flag kedua):

| Simbol | Dipakai oleh |
|---|---|
| `isApprovalEnabled()` | Sidebar, Dashboard, ModuleView, pages/index.js, submitLean, view.jsx |
| `approvalGuard(action)` | handler keputusan, approve-item, mark-ordered, submit legacy, alert PR |
| `isModuleVisible(id)` / `visibleNavSections` | navigasi (desktop + drawer mobile) |
| `APPROVAL_OFF_MESSAGE` | pesan UI & service (satu teks) |

**Reversible**: ubah satu baris itu menjadi `true` → menu, kartu dashboard,
query `approval_steps`, handler, alert, dan reminder approval hidup lagi tanpa
menyentuh data historis.

`scripts/reminders/rules.js` adalah paket ESM terpisah (tidak bisa mengimpor
`lib/`) sehingga menyimpan **salinan** `APPROVAL_MODULE_ENABLED`; kesamaan
keduanya dijaga test `scripts/approval-off-test/logic_test.mjs` (L1a/L1b).

---

## 2. Yang diputus (dan buktinya)

| Konektor | Lokasi | Perilaku saat OFF |
|---|---|---|
| Menu sidebar (desktop + drawer mobile) | `components/Sidebar.js` → `visibleNavSections` | item `approvals` tidak dirender; 20 item (admin) / 7 (user) |
| Kartu dashboard "Menunggu approval" | `components/Dashboard.js` | kartu tidak dimasukkan ke daftar; sheet ekspor Approval juga hilang |
| Query `approval_steps` saat load | `pages/index.js` `loadAll()` | spec tabel dibuang (`...(approvalOn ? [...] : [])`), `rows.approvals = []` |
| Rute langsung `page='approvals'` | `pages/index.js` | fallback `data-testid="approval-off-fallback"` + tombol ke PR/Pembelian/Dashboard |
| Shell modul (lapis kedua) | `components/ModuleView.js` | fallback yang sama; tidak ada `<table>`, tidak ada tombol keputusan |
| Setujui / Tolak / Revisi | `pages/index.js` `decideApproval`, `executeDecision`, `reviseApproval` | `approvalGuard()` di baris pertama → 0 write, 0 alert |
| Setujui per-item / Sudah Order | `approveItem`, `markPrItemOrdered` | guard sebelum `ensureItemInPurchase`/update |
| Submit legacy ke antrean approval | `modules/requests/submit.js` `handleFinishPr` | guard sebelum SELECT pertama; 0 query, 0 insert |
| Alert approval PR | `lib/telegramAlert.js` `sendPrAlert` | guard sebelum RPC `telegram_send_pr_alert` |
| Hapus baris approval dari UI | `pages/index.js` `deleteItem` | diblokir saat OFF (histori tidak boleh hilang lewat UI) |
| Reminder antrean approval | `scripts/reminders/collect.js` + `rules.js` | `approval_steps` **tidak dibaca** (`skipped_by_policy`), jenis `pr_overdue_approval` dilaporkan **BLOCKED/disabled**, bukan "0 temuan" |

**Tidak** diputus: `sendCostAlerts` (early warning biaya), `sendTestAlert`,
kanal Telegram/WA umum, sales-invoice approval customer, auth/RLS/profiles,
validasi data PR, dan guard permission yang sudah ada.

---

## 3. Alur pengganti (lean)

### Request baru (DRAFT / REVISI)
`submitLean` — tidak berubah dari kontrak `t_a5a73034`:
status `SUBMITTED` + penanda `[Jalur: LEAN]` di `notes`, **0** `approval_steps`,
**0** `receivings`, status item **tidak** diubah menjadi APPROVED.

### PR REJECTED yang sah diperbaiki (baru di kartu ini)
Saat Approval OFF, `submitLean` menerima `REJECTED` sebagai status eligible:

* ID & `pr_number` **sama** (tidak ada PR baru, tidak ada nomor baru),
* status → `SUBMITTED`, penanda `[Jalur: LEAN]` + `[KirimUlang: <ISO>]`,
* baris `approval_steps` lama **tidak diubah/dihapus** (status & note penolakan
  tetap apa adanya),
* konfirmasi menyebut eksplisit bahwa riwayat penolakan tetap tersimpan,
* klasifikasi UI menjadi `LEAN` (bukan `REJECTED`), sehingga muncul di
  "Siap Ditindaklanjuti" dan bisa dibelanjakan lewat jalur lean.

Saat Approval ON, `REJECTED` kembali ke antrean approval (`handleFinishPr`).

### Legacy pending
`SUBMITTED` tanpa penanda tetap `LEGACY_UNKNOWN` → **tidak** actionable, tidak
otomatis dianggap siap belanja. `REJECTED` historis tidak dibuka otomatis —
harus aksi admin eksplisit (tombol Kirim Ulang).

---

## 4. Batas yang masih perlu verifikasi di luar worker ini

1. **RPC/trigger DB**: `telegram_send_pr_alert`, `ensure_item_in_purchase`,
   `cleanup_unreceived_purchase` masih ada di database. App tidak memanggilnya
   saat OFF, tetapi trigger/RPC/cron di sisi DB **belum diverifikasi** (tidak ada
   akses DDL/live dari worker ini). Bila ada automation eksternal yang memanggil
   RPC tersebut langsung, itu **di luar** jangkauan perubahan ini.
2. **`pages/api/seed-simulation.js`** (maintenance-only, butuh
   `MAINTENANCE_TOKEN`) masih menulis `approval_steps` sebagai data simulasi.
   Tidak diubah karena bukan jalur aplikasi; **jangan dijalankan** selama
   Approval OFF.
3. **`pages/api/inspect.js` / `schema.js`** masih menghitung baris
   `approval_steps` (read-only, maintenance). Tidak diubah; tidak dipanggil app.
4. **Modul approval lama** (`modules/approvals/**`, `modules/registry.js` entry)
   tetap ada di repo dan tetap diuji (dengan flag ON di sandbox) supaya
   reversible.

---

## 5. Uji

```bash
flock /home/ubuntu/dev-workspaces/.purchasing-build.lock python3 scripts/approval-off-test/run.py
```

175 cek: 79 logika/kontrak, 31 render (sidebar desktop+mobile, dashboard, shell
fallback, tooltip), 65 statis (urutan guard fail-closed sebelum efek samping).

Suite lama yang menguji **UI/handler Approval** menyalakan flag **di salinan
sandbox** saja lewat `scripts/approval-off-test/enable_in_sandbox.py`; sumber
repo tetap OFF.
