# Kontrak Jalur Request LEAN (tanpa approval) — untuk modul Purchase (Bamboo)

Kartu: **t_a5a73034** (Lean Admin A — Bit Dev). Konsumen: **t_aead7c06** (Bamboo).
Status dokumen: **kontrak implementasi + hasil tes unit/render/viewport**.
Bukan klaim schema/live E2E (lihat §7).

---

## 1. Kenapa ada penanda, bukan enum baru

Arahan DAT: request tukang **tanpa approval terpisah**; admin langsung menindaklanjuti.
Guardrail eksplisit: **jangan** menganggap semua `SUBMITTED` legacy otomatis jalur lean,
**jangan** memalsukan `APPROVED`/approver, **jangan** mass-update histori, dan
**jangan** bikin enum/DDL baru hanya untuk label.

Skema `purchase_requests` yang benar-benar ada di DB live (dibaca **read-only** lewat
PostgREST, `scripts/lean-admin/live_schema_probe.mjs`):

```
id, pr_number, project_id, priority, status, notes, created_at, title, materials_summary
```

Tidak ada kolom penanda jalur. Karena itu penanda ditulis di kolom teks `notes`
mengikuti preseden yang **sudah dipakai aplikasi ini** (`lib/purchaseNote.js` menulis
`[Nominal: …]`, `[Tahap: DIBELI]` di `receivings.note`, satu parser).

```
[Jalur: LEAN]          request dikirim lewat jalur admin langsung
[Tutup: <alasan>]      sisa kebutuhan ditutup admin (alasan wajib, ≤300 char)
[TutupPada: <ISO>]     waktu penutupan
```

Parser tunggal: `modules/requests/leanRequest.js`
(`isLeanMarked`, `closeReasonOf`, `closedAtOf`, `stripLeanMarkers`,
`composeNotesWithMarkers`, `withLeanMarker`, `withCloseMarker`).

**Penanda tidak pernah tampil sebagai catatan manusia.** Semua tampilan catatan
(note popover desktop, kartu mobile, prefill form edit) memakai `stripLeanMarkers()`.
Saat admin mengedit catatan, `composeNotesWithMarkers()` menyisipkan kembali penanda
yang sudah ada sehingga klasifikasi & penutupan tidak hilang.

---

## 2. Status yang ditulis (nilai enum existing)

| Objek | Nilai | Catatan |
|---|---|---|
| `purchase_requests.status` | `DRAFT` → `SUBMITTED` | `SUBMITTED` sudah dipakai data live (2 PR terverifikasi read-only). Tidak ada enum baru. |
| `purchase_requests.notes` | catatan manusia + `[Jalur: LEAN]` | Catatan manusia dipertahankan; penanda tidak dobel (idempoten). |
| `pr_items.status` | **tidak diubah** | Tetap `PENDING_APPROVAL`/`ORDERED` apa adanya. |
| `approval_steps` | **tidak ada insert/update** | 0 operasi. |
| `receivings` | **tidak ada baris baru** | Bukan cangkang nota lewat approval. |

**Kenapa bukan `APPROVED`:** `APPROVED` berarti disetujui approver. Menulisnya di jalur
tanpa approval = cap persetujuan palsu. **Kenapa `pr_items` tidak jadi `APPROVED`:**
satu-satunya nilai item yang membuat modul Purchase menganggap barang "boleh dibeli"
adalah `APPROVED`/`ORDERED` (`modules/receivings/purchaseLogic.js`), jadi menulisnya
akan memalsukan persetujuan.

**Konsekuensi untuk task B:** item request lean **tetap** `PENDING_APPROVAL`. Kelayakan
beli harus **diturunkan dari penanda request**, bukan dari status item.

---

## 3. Klasifikasi request (satu sumber, dipakai UI & service)

`classifyRequest(pr, { approvalStepCount })`:

| key | Kapan | Arti |
|---|---|---|
| `DRAFT` | status DRAFT | masih draft, bisa dilanjutkan/dikirim |
| `LEAN` | ada `[Jalur: LEAN]` | dikirim jalur admin, siap ditindaklanjuti |
| `LEGACY_APPROVAL` | status SUBMITTED + punya `approval_steps` | alur lama, riwayat |
| `LEGACY_UNKNOWN` | status SUBMITTED **tanpa** penanda & tanpa step | data lama, **bukan** lean, **tidak** diubah massal |
| `APPROVED`/`REJECTED`/`REVISI` | status lama | riwayat apa adanya |

Label UI (`requestStatusLabel`): `LEAN` → **"Siap Ditindaklanjuti"**,
`LEGACY_UNKNOWN` → **"Submitted lama"**, `LEGACY_APPROVAL` → **"Antrean Approval (lama)"**,
`APPROVED` → "Disetujui (lama)", dst. Nilai enum DB tidak berubah.

Tab modul Request: **Siap Ditindaklanjuti** (hanya bertanda lean) dan
**Submitted lama** (SUBMITTED tanpa penanda) dipisah tegas. Alias lama
`prFilter === 'SUBMITTED'` tetap ada (menampilkan semua SUBMITTED apa adanya).

---

## 4. KELAYAKAN BELI — WAJIB dibaca task B

Modul Purchase saat ini memakai `isBuyableStatus(status)` = `APPROVED` | `ORDERED`
(`modules/receivings/purchaseLogic.js`). Untuk request lean, itemnya **tidak** akan
lolos fungsi itu. Ubah predikatnya menjadi:

```js
import { isLeanRequest } from '../requests/leanRequest'

// item boleh dibeli bila:
//   (a) request induknya bertanda LEAN  -> isLeanRequest(pr) === true
//   (b) ATAU item berstatus APPROVED/ORDERED (alur lama, tetap didukung)
export function isBuyable({ item, request }) {
  return isLeanRequest(request) || isBuyableStatus(item?.status)
}
```

`buildReadyRows()` di file yang sama harus menerima `requests` (sudah ada di
signature-nya) dan memakai `isBuyable` di atas, bukan `isBuyableStatus` saja.
**Jangan** memfilter dengan `approval_steps` dan **jangan** mengubah status item
menjadi `APPROVED` saat menampilkan/membeli.

Kontrak ini belum diubah di modul Purchase oleh kartu ini (ownership task B) —
jika tidak diimplementasikan di sana, kebutuhan lean **tidak akan muncul** di tab
"Siap Dibeli". Itu known gap yang harus ditutup task B, bukan diklaim selesai di sini.

---

## 5. PEMENUHAN — satu sumber angka

`modules/requests/fulfillment.js` (murni, tanpa query):

```
realisasi(pr_item) = Σ receiving_items.quantity_received
                     WHERE receiving.pr_item_id = pr_item.id
                       AND isPurchasedNota(receiving)      // DIBELI / [Tahap: DIBELI]
                       AND NOT isReceivingKendala(status)  // RETUR/REFUND/RUSAK diabaikan
                       AND quantity_received > 0
```

- `estimated_price` **tidak pernah** dihitung sebagai realisasi.
- Request dikirim **bukan** berarti selesai.
- Nota `DRAFT`/belum dibeli & nota Retur/Refund/Rusak **tidak** menutup kebutuhan.
- `pr_items.quantity` **tidak pernah** diubah; sisa = `quantity − realisasi` dihitung saat tampil.
- Over-receipt dilaporkan (`over`), tidak dipotong diam-diam; status tetap `SELESAI`.

API:

| Fungsi | Keluaran |
|---|---|
| `buildRealizationIndex({receivings, receivingItems})` | `Map<prItemId, {qty, notes[]}>` |
| `itemFulfillment(prItem, {realizationIndex, requestClosed, closedReason})` | `{status, requested, realized, remaining, over, label, notes}` |
| `requestFulfillment(pr, {items, receivings, receivingItems})` | `{items, counts, status, label, requested, realized, remaining, closedReason, isLean}` |
| `openNeeds(pr, {...})` | baris yang masih terbuka: `{prItemId, prId, materialId, itemName, unit, requested, realized, remaining}` |

Status: `BELUM_DIBELI` | `SEBAGIAN` | `SELESAI` | `DITUTUP` (+ `KOSONG` untuk request tanpa item).

**Untuk task B:** gunakan `openNeeds()` untuk mengisi pilihan "kebutuhan yang mau
dibeli" dan `requestFulfillment()` untuk readback setelah nota tersimpan. Jangan
menghitung ulang sisa dengan cara lain (dua rumus = dua kebenaran).

---

## 6. Penutupan sisa kebutuhan

`closeRequestRemaining(pr, reason, {supabase, ...})` di `modules/requests/submitLean.js`:

- hanya menulis `purchase_requests.notes` (menambah `[Tutup: …]` + `[TutupPada: …]`);
- alasan **wajib**, ≤300 karakter, tidak boleh memuat `]`;
- penutupan ulang **mengganti** penanda lama (tidak menumpuk);
- **tidak** mengubah `pr_items.quantity`, **tidak** mengubah `status`;
- item yang ditutup **tidak** muncul di `openNeeds()` (tidak menghalangi pembelian
  item lain di request yang sama).

---

## 7. Batas bukti (jujur)

Yang **sudah** dibuktikan di kartu ini:

- `scripts/lean-admin-test` → **245 assertion hijau** (102 logika/kontrak + 38 UI render
  + 105 viewport). Sandbox mengompilasi file NYATA via SWC Next.js; DB di-mock
  in-memory dan **mencatat setiap operasi**, sehingga klaim "0 insert approval_steps /
  0 insert receivings / 0 perubahan pr_items" adalah hasil pemeriksaan operasi, bukan
  asumsi.
- Regresi terkait: `fase2-save-test` (56), `pr-resubmit-test`, `field-form-test`,
  `pr-estimate-sync-test`, `approval-queue-test` (60), `pr-group-test`,
  `showmore-list-test`, `compact-admin-test` (113), `all-modules-compact-test` (749),
  `crossflow-regression-test`, `ui-olive-tokens-test` (35), `purchase-flow-test` (178+90).
- `npm run build` (ENABLE_SMOKE=1) exit 0; SSR `/__smoke` 200 dan memuat label lean,
  "Submitted lama", tombol "Tutup sisa", dan baris "Pemenuhan: sebagian — sisa 1".

Yang **BELUM** dibuktikan (jangan diklaim):

- **Tidak ada tulis ke Supabase live.** Semua bukti DB adalah mock in-memory.
- **Belum ada runtime browser nyata** (browser tool gagal start di environment ini:
  `browser.use_real_profile` butuh `--no-sandbox`). Bukti UI = jsdom + SSR HTML,
  bukan interaksi browser sungguhan.
- **Belum diuji terhadap data live** (15 PR / 6 approval_steps yang ada) — hanya
  dibaca read-only untuk memastikan skema & nilai status.
- Staging port 3001 **tidak** disentuh (bukan wewenang kartu ini).

---

## 8. Checklist implementasi task B (Bamboo)

1. `isBuyable({item, request})` seperti §4; pakai di `buildReadyRows`.
2. Tab "Siap Dibeli" menampilkan item request lean **tanpa** mengubah status item.
3. Readback pemenuhan memakai `requestFulfillment()`; sisa dari `openNeeds()`.
4. Jangan menulis `APPROVED`/`approver_id` ke jalur lean.
5. Jangan mass-update `SUBMITTED` legacy. `LEGACY_UNKNOWN` tetap riwayat.
6. Nota multi-proyek tetap boleh memuat item dari request lean & legacy sekaligus.
7. Sertakan tes: item lean muncul di Siap Dibeli; item legacy SUBMITTED tanpa penanda
   **tidak** muncul sebagai lean; sisa berkurang setelah nota DIBELI; nota RETUR tidak
   menutup kebutuhan.
