# Kontrak Konektor Bakpau — Input Telegram/WA, Notifikasi Telegram DAT

Kartu: **t_310dfb07** · Lane: **Bandeng** · Baseline: `ce8d132c8b85d94c9cf15da3f3758cb7a3aac20d`
Worktree: `/home/ubuntu/dev-workspaces/purchasing-bakpau-connector`
Branch: `feat/bakpau-connector-20261020`

Status: **kode adaptor + harness hijau, BELUM aktif di produksi, BELUM di-apply DDL.**
Bukan klaim E2E aktif. Lihat §9 untuk status verifikasi per komponen.

---

## 1. Batas tanggung jawab (satu paragraf)

Konektor Bakpau **menerima** bukti pembelian dari Telegram atau WhatsApp,
menormalkannya ke satu draft, memvalidasinya lewat **boundary pembelian yang
sama dengan admin** (`modules/receivings/purchaseSave.js`), lalu menulis satu
nota + baris barang dengan jejak asal-usul. Notifikasi hasilnya **hanya** ke
Telegram DM DAT (`chat_id 1320969465`). Konektor **tidak** membuat PR, tidak
menyentuh `approval_steps`, tidak menambah stok, tidak membuat serah terima,
tidak mencatat pembayaran, dan tidak menulis ke Google Sheets.

---

## 2. File yang dibuat (semua BARU — tidak ada file lama diubah)

| File | Peran |
|---|---|
| `lib/bakpau/constants.js` | Allowlist notifikasi beku, status, reason code, batas operasional |
| `lib/bakpau/normalize.js` | Telegram & WhatsApp → satu bentuk kanonik |
| `lib/bakpau/verify.js` | Tanda tangan, allowlist identitas, DM-only, freshness/anti-replay |
| `lib/bakpau/evidence.js` | Parser teks bukti (grammar di §3), anti-tebak |
| `lib/bakpau/resolve.js` | Draft → id master; deteksi konflik identitas (fail closed) |
| `lib/bakpau/duplicate.js` | Identitas bukti (hash kanonik) + keputusan duplikat |
| `lib/bakpau/ledger.js` | Klaim idempotensi atomik (event + bukti), fail closed |
| `lib/bakpau/purchaseAdapter.js` | Validasi via boundary bersama + tulis + **readback exact** |
| `lib/bakpau/notify.js` | Routing notifikasi Telegram DAT saja, dedup, retry terbatas |
| `lib/bakpau/connector.js` | Orkestrasi berurutan (11 langkah, §5) |
| `lib/bakpau/httpHandler.js` | Handler HTTP server-only (POST, auth, tanpa kebocoran) |
| `pages/api/bakpau/telegram.js` | Route masuk Telegram (platform dikunci route) |
| `pages/api/bakpau/whatsapp.js` | Route masuk WhatsApp (platform dikunci route) |
| `migrations/2026-10-21_bakpau_connector_ledger.sql` | **DRAFT** tabel ledger idempotensi + rollback |
| `scripts/bakpau-connector-test/*` | Harness: 316 + 45 assertion + 2 probe read-only |

**Tidak disentuh** (sesuai batas lane): `pages/index.js`, `lib/constants.js`,
`lib/telegramAlert.js`, `modules/requests/**`, `modules/approvals/**`,
`modules/receivings/**` (hanya di-import read-only), data resolver Bamboo.

---

## 3. Grammar bukti (input yang diterima)

Baris header `kunci: nilai` (tidak case-sensitive):

```
toko | vendor | supplier        -> nama toko (WAJIB)
nota | no nota | invoice        -> nomor nota vendor (OPSIONAL)
tanggal | tgl                   -> YYYY-MM-DD atau DD/MM/YYYY (WAJIB)
proyek | project                -> kode atau nama proyek (default seluruh nota)
total                           -> total tertulis (untuk rekonsiliasi)
ongkir | biaya lain | kirim      -> biaya tambahan toko
diskon | potongan               -> potongan toko
catatan                         -> catatan bebas
```

Baris barang — dua bentuk, keduanya deterministik:

```
A. PIPE   - <nama> | <qty> | <satuan> | <harga> [| spek=<x>] [| proyek=<kode>] [| pr=<no PR>]
B. INLINE - <nama…> <qty> <satuan> <harga>
```

Contoh sintetis lengkap (bukan data nyata):

```
toko: SINTETIS Toko Bangunan A-12
nota: SINT-8891
tanggal: 20/10/2026
proyek: 101
total: 1.075.000
- Triplek 12mm | 6 | lembar | 125.000 | spek=12mm
- Semen 50kg | 5 | sak | 65.000
```

### Yang TIDAK pernah ditebak
- **Tanggal** tidak diambil dari jam pesan. Tidak ada tanggal → klarifikasi.
- **Harga 0 / kosong** bukan "gratis" → baris tidak sah → klarifikasi.
- **Qty/SKU** tidak dikarang dari nominal total (bukti transfer global →
  `monetary_only`, dicatat sebagai klarifikasi, bukan pembelian fiktif).
- **Proyek** dicocokkan exact (kode/nama). Mirip ≠ cocok.
- **Satuan** di luar daftar dikenal → klarifikasi spesifik (`unit_unknown`).
- **Baris tak terbaca** tidak dibuang; masuk `unparsedLines` dan memblokir simpan.
- **Tautan PR** hanya dari `pr=<no PR>` eksplisit. Nama barang sama hanya
  menghasilkan **kandidat** untuk manusia, tidak pernah auto-link.

---

## 4. Payload schema (contoh sintetis)

### 4.1 Masuk — Telegram (Update object)

```json
{
  "update_id": 904412,
  "message": {
    "message_id": 4412,
    "date": 1792481400,
    "chat": { "id": 1320969465, "type": "private" },
    "from": { "id": 1320969465, "is_bot": false, "first_name": "SINTETIS DAT" },
    "text": "toko: …\nnota: …\n…"
  }
}
```

Header wajib: `X-Telegram-Bot-Api-Secret-Token: <BAKPAU_TELEGRAM_WEBHOOK_SECRET>`

### 4.2 Masuk — WhatsApp (dari bridge resmi yang ADA, bukan bridge kedua)

```json
{
  "id": "WA-MSG-0001",
  "from": "628000000001@s.whatsapp.net",
  "chatId": "628000000001@s.whatsapp.net",
  "chatType": "dm",
  "timestamp": 1792481400,
  "body": "toko: …\nnota: …\n…",
  "hasMedia": false
}
```

Header wajib (salah satu): `x-bakpau-signature: sha256=<hmac(body_mentah)>`
atau `x-bakpau-token: <BAKPAU_WA_WEBHOOK_SECRET>`

### 4.3 Keluar — hasil proses (dikembalikan handler)

```json
{
  "ok": true,
  "status": "tercatat",
  "reason": null,
  "error": null,
  "receivingId": "rcv-001",
  "invoiceNo": "SINT-8891",
  "notification": { "sent": true, "skipped": false, "reason": null, "attempts": 1 }
}
```

`status` ∈ `tercatat | need_clarification | duplicate | gagal | ignored_duplicate_event`.
Tidak ada teks bukti mentah, token, atau kunci di respons.

### 4.4 Penanda yang ditulis ke kolom existing

`receivings.note` (ditambahkan SETELAH penanda `purchaseNote` yang sudah ada):

```
[Nominal: Rp 1.075.000] [Tahap: DIBELI] <catatan manusia>
[BakpauEvent: telegram:1320969465:4412] [BuktiHash: sha256:…] [Kanal: telegram] [Pengirim: …] [Pesan: 4412]
```

`receiving_items.note`:

```
[Harga: 125000] [Spek: 12mm] [SpekAwal: 2mm] [Proyek: <uuid>] [PRItem: <uuid>]
```

Parser tunggal: `parseConnectorMarkers()` di `lib/bakpau/markers.js`.
`parsePurchaseNote()` (lama) tetap bekerja — penanda konektor hanya masuk
`catatan` bila dibaca olehnya, dan `parseConnectorMarkers().catatanBersih`
membuangnya untuk tampilan.

---

## 5. Urutan yang dipaksa (tidak boleh ditukar)

```
1 normalize → 2 verify → 3 parse → 4 resolve → 5 evidenceHash
→ 6 cek duplikat DB → 7 klaim ledger (event+bukti) → 8 tulis
→ 9 READBACK EXACT → 10 notifikasi
```

| Langkah | Gagal → |
|---|---|
| 1–2 | `gagal` (401/503 di HTTP), **nol notifikasi** (anti-spam) |
| 3–4 | `need_clarification`, nol tulisan |
| 6 | `duplicate` atau `need_clarification` (konflik nota), nol tulisan |
| 7 | `gagal` + `ledger_unavailable`, **nol tulisan** (fail closed) |
| 8 | `gagal`; klaim dilepas bila belum ada baris tersimpan |
| 9 | `gagal` + `readback_mismatch`; **status tidak pernah `tercatat`** |
| 10 | pembelian tetap `tercatat`; notifikasi dilaporkan `sent:false` |

**Status `tercatat` hanya ada setelah langkah 8 sukses DAN langkah 9 cocok.**

---

## 6. Anti-duplikat

### 6.1 Dua lapis, sengaja dipisah

| Lapis | Kunci | Cakupan |
|---|---|---|
| Event per kanal | `evt:<platform>:<chatId>:<messageId>` | retry/race webhook yang sama |
| Bukti lintas kanal | `evd:sha256:<hash kanonik>` | Telegram + WA + admin untuk bukti yang sama |
| Notifikasi | `ntf:<status>:<channelKey>` | satu pesan per status per transaksi |

### 6.2 Isi hash bukti (dan kenapa bukan "nomor nota saja")

`canonicalEvidence()` = `{ v, ns(vendor), invoice LITERAL, date, biayaLain,
diskon, rows[] }` → SHA-256.

- **Nomor nota literal**: `A-12` ≠ `A1-2` (regresi VERIFICATION_A #1).
- **Namespace vendor wajib**: nota `001` di toko berbeda = dua transaksi.
- **Tanggal ikut**: pembelian berulang di hari lain = transaksi sah.
- **Baris ikut**: nomor nota sama tapi isi beda = **konflik**, bukan merge.
- Urutan baris tidak mempengaruhi hash; isi baris mempengaruhi.

### 6.3 Keputusan

| Kondisi | Hasil |
|---|---|
| hash sama | `duplicate` — tidak menulis |
| nota sama + vendor sama + isi beda | `need_clarification` (`invoice_conflict`) |
| nota sama + vendor beda | transaksi baru (sah) |
| isi sama + nomor beda | transaksi baru (beli ulang sah) |

### 6.4 Atomisitas — jujur soal batasnya

Skema existing **tidak** punya UNIQUE index untuk klaim atomik
(`receivings.invoice_no` tidak unik; tabel ledger tidak ada — probe read-only
PGRST205). Karena itu konektor **fail closed**: tanpa tabel ledger, ia
**menolak menulis** (`ledger_unavailable`) alih-alih mengklaim jaminan yang
tidak bisa dipenuhi. Draft migrasi: §8.1.

---

## 7. Notifikasi

- Tujuan = **konstanta** `DAT_NOTIFY_TARGET` (platform `telegram`,
  chat `1320969465`, user `1320969465`, chat_type `dm`). Tidak bisa diperlebar
  lewat env. `BAKPAU_NOTIFY_ENABLED=0` hanya bisa **mematikan**.
- WhatsApp **selalu** ditolak sebagai tujuan (`recipient_not_allowlisted`
  atau `outbound_platform_disabled`).
- Tujuan **tidak pernah** diambil dari input masuk — tidak ada fallback.
- Retry terbatas 3 percobaan, backoff linear; gagal → `sent:false` (tidak
  pernah diklaim terkirim).
- Kegagalan kirim **tidak** mengulang penulisan pembelian (modul `notify.js`
  tidak punya akses tulis ke tabel pembelian).
- Format ringkas: toko, proyek, refnota, tanggal, total, jumlah baris,
  PR+sisa **hanya bila tautan terverifikasi**, link, dan daftar tindakan.
  Status non-`tercatat` selalu menutup dengan "BELUM tercatat".

Transport yang dipakai: RPC DB resmi `fn_telegram_send(text)`
(SECURITY DEFINER, token dari `private_secrets`) — token bot **tidak pernah**
melewati proses Node.

---

## 8. Yang dibutuhkan integrator (Bamboo B)

### 8.1 Jalankan draft migrasi ledger (WAJIB sebelum aktif)

`migrations/2026-10-21_bakpau_connector_ledger.sql` — tabel `bakpau_events`
dengan `UNIQUE(dedup_key)`, RLS deny-all untuk anon/authenticated, hanya
`service_role`. Rollback ada di akhir file. Tanpa ini konektor tetap
fail closed (tidak menulis apa pun).

### 8.2 Patch minimal yang diusulkan ke `purchaseSave.js` (TIDAK dilakukan lane ini)

`savePurchase()` mengimpor klien anon dari `lib/supabaseClient`, sehingga
tidak bisa dipakai server-side dengan klien service-role. Usulan patch
(minimal, tanpa mengubah perilaku UI):

```js
// modules/receivings/purchaseSave.js
export async function savePurchaseWithClient({ client, ...args }) {
  // isi fungsi = savePurchase saat ini, dengan `supabase` diganti `client`
}
export async function savePurchase(args) {
  return savePurchaseWithClient({ client: supabase, ...args })
}
```

Setelah patch itu ada, `lib/bakpau/purchaseAdapter.js` cukup memanggil
`savePurchaseWithClient` dan pemetaan kolom duplikat di adapter bisa dihapus.
Sampai saat itu, adapter memakai `validatePurchaseBoundary()` (kontrak
validasi yang sama) + pemetaan kolom yang **dikunci test** (`N1`/`N2`
membandingkan key payload adapter dengan sumber `purchaseSave.js`).

### 8.3 Env yang perlu diset (server saja, jangan ke browser)

| Env | Isi |
|---|---|
| `BAKPAU_TELEGRAM_WEBHOOK_SECRET` | secret `setWebhook` Telegram |
| `BAKPAU_TELEGRAM_ALLOWED_USER_IDS` | `1320969465` |
| `BAKPAU_WA_WEBHOOK_SECRET` | secret HMAC bridge WA |
| `BAKPAU_WA_ALLOWED_JIDS` | JID yang sah (eksplisit) |
| `SUPABASE_SERVICE_ROLE_KEY` | sudah ada untuk endpoint admin lain |
| `BAKPAU_NOTIFY_ENABLED` | `1` aktif / `0` mati (hanya mematikan) |

### 8.4 Wiring webhook Telegram (belum dilakukan)

```
setWebhook(url=https://<host>/api/bakpau/telegram, secret_token=<secret>)
```

Tidak ada poller/bridge WhatsApp kedua yang dibuat. Route WA hanya menerima
event yang diteruskan bridge resmi yang sudah ada.

### 8.5 Hook untuk integrasi

- `processInboundEvent({ platform, payload, headers, rawBody, env, client, ledger, transport, masters, existingNotas })`
  — inti yang bisa dipanggil dari job/queue, bukan hanya HTTP.
- `loadMasters({ client })` / `loadExistingNotas({ client })` — pembacaan
  read-only yang bisa diganti implementasi ber-cache.
- `createDbLedger({ client })` / `createMemoryLedger()` — ledger produksi vs
  harness (semantik sama).
- `createRpcTransport({ client })` — transport notifikasi resmi.

---

## 9. Status verifikasi (jujur, per komponen)

| Komponen | Status | Bukti |
|---|---|---|
| Normalisasi 2 kanal | **VERIFIED** (kode + harness) | `A1–A12` |
| Gerbang tanda tangan/identitas/freshness | **VERIFIED** (kode + harness) | `B1–B16`, `T1–T8`, `V1–V7` |
| Parser bukti anti-tebak | **VERIFIED** (kode + harness) | `C1–C25`, `K1–K11` |
| Resolusi master + konflik identitas | **VERIFIED** (kode + harness) | `D1–D18`, `RA14–RA17b` |
| Anti-duplikat + race | **VERIFIED** (kode + harness) | `E1–E10`, `F1–F8`, `J1–J18`, `W4–W10` |
| Tulis + readback exact | **VERIFIED terhadap mock** | `H1–H26`, `L1–L23`, `N1–N9`, `O1–O17` |
| Notifikasi target/dedup/retry | **VERIFIED terhadap mock** | `G1–G15`, `M1–M13`, `H4–H10` |
| Endpoint HTTP | **VERIFIED** (handler asli, req/res tiruan) | `S1–S5`, `U1–U11`, `X1–X4` |
| 7 skenario purchasing | **VERIFIED terhadap mock** | `Q` (`S1–S24`) |
| Regresi VERIFICATION_A | **VERIFIED** | `R` (`RA1–RA20`) |
| `next build` | **VERIFIED** | 2 route `/api/bakpau/*` terbentuk |
| **Transport Telegram live** | **UNVERIFIED — TERBUKTI TIDAK BERWENANG** | lihat §9.1 |
| **WhatsApp bridge live** | **UNVERIFIED** | bridge tidak meneruskan ke route ini; tidak ada bridge kedua |
| **DB write live** | **UNVERIFIED** | tabel ledger belum ada; tidak ada tulisan keuangan |
| **Readback live** | **UNVERIFIED** | butuh DB nyata + otorisasi integrator |

Tidak ada klaim "E2E aktif". Yang hijau adalah **kode yang dapat dieksekusi**
dengan fixture sintetis berlabel, bukan respons live yang difabrikasi.

### 9.1 Kenapa uji transport live TIDAK dijalankan (bukti, bukan alasan)

`scripts/bakpau-connector-test/probe_transport_readiness.mjs` dijalankan
read-only (hasil lengkap: `docs/bakpau-connector-transport-readiness.json`):

```
telegram_alert_status  -> 42501 permission denied for function
telegram_send_test     -> { ok:false, reason:"not_authorized", sent:null }
can_verify_target_identity: false
send_test_authorized:       false
conclusion: live_transport_test_blocked__cannot_verify_target_identity_or_not_authorized
```

Artinya lane ini **tidak bisa membuktikan** bahwa chat `1320969465` benar
DM DAT. Mengirim "pesan TEST" tanpa bisa memverifikasi tujuan = **menebak
recipient**, yang justru dilarang. Karena itu pesan uji tidak dikirim, dan
statusnya dilaporkan UNVERIFIED apa adanya. Uji transport live harus dilakukan
integrator yang punya otorisasi admin/drive-sync, setelah identitas tujuan
diverifikasi lewat `telegram_alert_status`.

---

## 10. Aktivasi & rollback

### Aktivasi (urutan aman)

1. Integrator review + apply migrasi ledger (§8.1) di staging.
2. Set env (§8.3) di staging; **jangan** ke browser.
3. Deploy route; verifikasi `POST` tanpa secret → 401 dan tanpa kredensial → 503.
4. Kirim **satu pesan TEST** berlabel jelas (`[TEST]`) dari Telegram DAT.
   Pesan TEST tidak menulis keuangan: kirim teks yang tidak memuat grammar
   bukti → hasilnya `need_clarification` (nol tulisan) dan satu notifikasi.
5. Baru setelah itu uji satu nota sintetis di staging, bukan produksi.

### Rollback

| Aksi | Efek |
|---|---|
| Hapus/disable webhook Telegram | input berhenti; tidak ada data rusak |
| `BAKPAU_NOTIFY_ENABLED=0` | semua notifikasi berhenti, penulisan tetap |
| Drop tabel `bakpau_events` (§8.1 rollback) | konektor **fail closed**, berhenti menulis |
| Revert commit konektor | route hilang; tidak ada migrasi data keuangan |

Tidak ada data keuangan di tabel ledger, sehingga rollback tidak menghapus
biaya. Nota yang sudah tercatat tetap di `receivings`/`receiving_items`.

---

## 11. Gap yang masih terbuka

| # | Gap | Dampak | Penanganan sekarang |
|---|---|---|---|
| G1 | Tabel ledger belum ada | tidak bisa klaim atomik | **fail closed** + draft migrasi |
| G2 | `savePurchase` belum menerima klien | adapter memetakan kolom sendiri | patch diusulkan (§8.2), pemetaan dikunci test |
| G3 | Lampiran (foto nota) hanya ref, belum diunduh | bukti gambar tidak dibaca otomatis | ref disimpan; tidak dikarang isinya |
| G4 | Belum ada UI klarifikasi/antrean kandidat | klarifikasi hanya via notifikasi | `prCandidates` sudah dikembalikan di payload |
| G5 | WhatsApp butuh bridge meneruskan | kanal WA belum aktif | route siap; tidak membuat bridge kedua |
| G6 | Master proyek bisa punya konflik kode/code | referensi ditahan | `buildProjectIndex` + fail closed |
| G7 | Tidak ada unique index `receivings.invoice_no` | duplikat nota manual masih mungkin dari UI admin | dicegah di lapisan konektor (hash bukti) |

---

## 12. Cara menjalankan

```bash
# harness konektor (tanpa DB, tanpa jaringan)
python3 scripts/bakpau-connector-test/run.py

# probe read-only bentuk skema (SELECT saja, tanpa tulisan)
node scripts/bakpau-connector-test/probe_readonly.mjs

# build serial (wajib pakai flock)
flock /home/ubuntu/dev-workspaces/.purchasing-build.lock -c 'npm run build'
```

Hasil terakhir: `316 lulus / 0 gagal` (connector) + `45 lulus / 0 gagal` (http),
`next build` hijau. Output mentah: `docs/bakpau-connector-test-evidence.log`.
