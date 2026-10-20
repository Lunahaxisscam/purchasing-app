# Handoff — Approval OFF (t_50b783de)

**Status: implementasi selesai & teruji (belum deploy).** Bamboo B integrator
tinggal fast-forward/merge commit ini.

## Commit

| Item | Nilai |
|---|---|
| Branch | `feat/approval-off-20261020` |
| Commit | `3b6ca2a9a5567f327ac6ae74dce73cb1a7ef72d2` (`3b6ca2a`) |
| Base | `ce8d132c8b85d94c9cf15da3f3758cb7a3aac20d` — diverifikasi **ancestor** (fast-forward, tidak ada reset/cherry-pick) |
| Worktree | `/home/ubuntu/dev-workspaces/purchasing-approval-off` |
| Push | **tidak** (tidak ada push GitHub/Vercel/production) |
| Deploy | **tidak** (staging/integrasi = Bamboo B) |

## Saklar (reversible)

`lib/constants.js` → `APPROVAL_MODULE_ENABLED = false`.
Salinan di `scripts/reminders/rules.js` (paket ESM terpisah) dijaga paritas
test L1a/L1b. Mengubah satu baris ke `true` menghidupkan kembali menu, kartu,
query, handler, alert, dan reminder approval.

## File yang diubah (owned, tidak menyentuh milik Bamboo A / Bandeng)

Kode aplikasi:
```
lib/constants.js                     (flag + guard + visibleNavSections)
lib/telegramAlert.js                 (guard Trigger A saja)
components/Sidebar.js                (visibleNavSections; desktop+mobile satu komponen)
components/Dashboard.js              (kartu + sheet ekspor Approval bersyarat)
components/ModuleView.js             (fallback lapis kedua utk page='approvals')
pages/index.js                       (load tanpa approval_steps, fallback rute, guard handler, lean resubmit)
pages/__smoke.js                     (komentar; section approvals tetap, kini fallback)
modules/registry.js                  (entri approvals: enabled:false)
modules/requests/submit.js           (guard fail-closed di baris pertama)
modules/requests/submitLean.js       (REJECTED eligible saat OFF + penanda kirim ulang)
modules/requests/leanRequest.js      (withResubmitMarker / resubmittedAtOf)
modules/requests/view.jsx            (tooltip kirim ulang mengikuti kebijakan)
```

Reminder (server-side, milik lapisan S5 — perubahan minimal & teruji):
```
scripts/reminders/rules.js           (flag salinan, requiresApprovalModule, skipped_by_policy)
scripts/reminders/collect.js         (approval_steps tidak dibaca saat OFF)
scripts/reminders/handler.js         (readiness membedakan skipped_by_policy)
```

Uji & dokumen:
```
scripts/approval-off-test/**         (baru: run.py, logic_test, render_test, static_test, mock, helper)
scripts/reminders-test/{rules_test,api_test}.mjs
scripts/{approval-queue,pr-group,showmore-list,pr-estimator,pr-estimate-sync,pr-resubmit}-test/run.py
scripts/all-modules-compact-test/all_modules_test.mjs
docs/approval-off-contract.md
```

**Tidak** disentuh: `lib/bakpau*`, `pages/api/bakpau*`, `modules/bakpau*`,
resolver data/cost Bamboo (`lib/laborSource.js`, `modules/labor-stock/**`,
`components/ProjectFinance.js`), `styles/globals.css`, migrasi, RLS/auth.

## Bukti uji (semua lewat flock build lock)

| Suite | Hasil |
|---|---|
| `scripts/approval-off-test/run.py` (baru) | **84 + 31 + 65 = 180 cek, 0 gagal** |
| `reminders-test` | 253 lulus, 0 gagal |
| `all-modules-compact-test` | 738 lulus, 0 gagal |
| `purchase-flow-test` | 103 lulus, 0 gagal |
| `lean-admin-test` | 105 lulus, 0 gagal |
| `lean-admin-c-flow` | 68 lulus, 0 gagal |
| `approval-queue-test` | 60 lulus, 0 gagal (flag ON di sandbox) |
| `approval-item-action-test` | 18 ok, 0 FAIL |
| `pr-group-test` | 31 unit + 59 render, 0 gagal |
| `showmore-list-test` | 50 lulus, 0 gagal |
| `pr-estimator-test` | 49 render + 14 save, 0 gagal |
| `pr-estimate-sync-test` | semua lulus (termasuk 7 viewport) |
| `pr-resubmit-test` | GREEN (flag ON di sandbox) |
| `integration-test/wiring_test.mjs` | 67/67 |
| `projects-merge-test` | 63 lulus, 0 gagal |
| `crm/rap/marketing/sales-invoice/material/field-form/handover/rab-boq/pr-print/vendors/stock-view/labor-stock/rap-compare/growth-kpi/manual-input/fase2-save/fn-repro/rap-audit` | semua exit 0 |
| `next build` | **exit 0**, `/` 21.5 kB, 5/5 static pages |
| Runtime smoke (`ENABLE_SMOKE=1 next start -p 3099`) | `/__smoke` 200; `approval-off-fallback` muncul **1×**; `approvals-table` **0×** |

### Kegagalan yang terbukti PRE-EXISTING (bukan akibat kartu ini)
* `scripts/s7-compact-test` — CSS globals punya blok duplikat (`.notice x2`,
  `.badge x2`, …). `styles/globals.css` **tidak** diubah oleh commit ini
  (`git diff --name-only ce8d132 | grep styles/` kosong). Dibuktikan dengan
  stash-verify: baseline juga `110 lulus, 1 gagal`.
* `scripts/rab-boq-render-test` — F1/F2 heading sidebar font-weight/ivory.
  Stash-verify: baseline juga gagal 2 cek yang sama.

## Cakupan konektor yang DITEMUKAN & diputus

1. Navigasi (sidebar desktop + drawer mobile) — satu komponen.
2. Kartu dashboard + sheet ekspor Excel "Approval".
3. Query `approval_steps` di `loadAll()`.
4. Handler: `decideApproval`, `executeDecision`, `reviseApproval`,
   `approveItem`, `markPrItemOrdered`, `handleFinishPr` (submit legacy),
   `sendPrAlert`, `deleteItem('approvals')`.
5. Reminder server-side: pembacaan `approval_steps` + jenis
   `pr_overdue_approval` + pemeriksaan "APPROVED tanpa jejak approval".

Tidak ditemukan subscription/realtime channel approval, webhook approval, atau
cron approval di app (hanya `supabase.auth.onAuthStateChange` yang tidak
terkait approval). **Tidak** mematikan notifikasi/kanal messaging umum.

## Edge yang MASIH perlu verifikasi di luar worker ini (jujur)

1. **DB triggers/RPC** — `telegram_send_pr_alert`, `ensure_item_in_purchase`,
   `cleanup_unreceived_purchase` masih ada di database. App tidak memanggilnya
   saat OFF, tetapi trigger/automation DB yang memanggilnya langsung **belum
   diverifikasi** (tidak ada akses DDL/live). Ini blocker integrasi Bamboo B
   bila ada automation eksternal.
2. **`pages/api/seed-simulation.js`** — maintenance-only (butuh
   `MAINTENANCE_TOKEN`), masih menulis/menghapus `approval_steps`. Tidak diubah
   (bukan jalur aplikasi) → **jangan dijalankan** selama Approval OFF.
3. **`pages/api/inspect.js`, `pages/api/schema.js`** — read-only maintenance,
   masih menghitung baris `approval_steps`. Tidak diubah, tidak dipanggil app.
4. **`pages/__mobile.js`** — harness mock-only (404 tanpa `ENABLE_SMOKE=1`).
   Tidak diubah; memakai `ModuleView` sehingga otomatis menampilkan fallback.
5. **Data legacy** — `approval_steps` tidak dihapus/diubah; status PR/PR item
   lama tidak di-update massal. Legacy `SUBMITTED` tanpa penanda tetap
   `LEGACY_UNKNOWN` (tidak otomatis siap belanja).

## Catatan untuk integrator (Bamboo B)

* Fast-forward ke `3b6ca2a` (base `ce8d132` adalah ancestor).
* Semua harness yang menguji **UI/handler Approval** kini menyalakan flag **di
  salinan sandbox** via `scripts/approval-off-test/enable_in_sandbox.py`
  (`force_enable(SB)`); sumber repo tetap OFF. Jangan "memperbaiki" dengan
  menyalakan flag di repo.
* `buildReadyRows` (Purchase) sudah mendukung jalur lean lewat
  `isLeanRequest(request)`; PR REJECTED yang dikirim ulang kini memenuhi
  kontrak itu — teruji di L6b (item masuk Siap Dibeli, status item tetap
  `REJECTED`, 0 approval_steps baru).
