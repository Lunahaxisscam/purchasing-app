# Instruksi workflow Bakpau — pemakaian API purchasing (v1)

Dokumen ini adalah artefak yang **ditinjau**, bukan perubahan pada bot,
webhook, poller, atau skills profil. Tidak ada poller baru; Bakpau tetap
menerima file dari kanal yang sudah ada (Telegram/WhatsApp existing), lalu
memanggil API ini.

## 0. Yang sudah terpasang

Di profil `bakpau-finance` hanya dua kunci yang ditambahkan:

```
BAKPAU_API_BASE_URL=https://<host>
BAKPAU_API_TOKEN=bpk.<keyId>.<secret>
```

Tidak ada skill/plugin/memory/cron/model yang diubah. Token **bukan**
service_role, **bukan** password Novi, **bukan** token bot. Rotasi/revoke
dilakukan di server (`BAKPAU_API_REVOKED`), bukan dengan mengubah profil.

## 1. Cek koneksi (tanpa mencetak rahasia)

```bash
node scripts/bakpau-api-client/client.mjs doctor
```

Keluaran hanya: host, keyId, fingerprint 12 hex, timeout, daftar perintah.
Kalau `doctor` gagal → jangan lanjut; laporkan ke DAT.

## 2. Tarik data purchasing (baca)

```bash
# master
node client.mjs read masters/projects --limit 200
node client.mjs read masters/materials --limit 200 --offset 200
node client.mjs read masters/vendors --limit 200

# PR
node client.mjs read purchase-requests --status APPROVED --limit 100
node client.mjs read purchase-request-items --pr-id <uuid>

# pembelian + status fisik
node client.mjs read purchases --limit 100 --order created_at.desc
node client.mjs read purchase-items --receiving-id <uuid>
node client.mjs read physical-status --limit 100
```

Aturan:

* **Pagination wajib** — jangan menganggap halaman pertama adalah seluruh data.
  Baca `page.total` dan ulangi dengan `offset` sampai habis.
* Filter ID/kode bersifat **literal**. `A-12` ≠ `A12`. Jangan "menebak" kode
  yang mirip; kalau tidak ada hasil, laporkan apa adanya.
* Kalau server menjawab `400 unknown_parameter`, itu berarti filter tidak
  dikenal — jangan mengulang dengan nama lain; baca kontrak §3.

## 3. Kirim pembelian hasil ekstraksi file

Alur: file → agen mengekstrak → **payload terstruktur** → API.

```bash
node client.mjs create --file /path/nota-2026-10-20.json
# atau dari pipe
cat nota.json | node client.mjs create
```

Bentuk payload ada di `docs/bakpau-api-contract.md` §4.

Aturan yang **tidak boleh dilanggar**:

1. **Jangan mengarang.** Qty/harga/proyek/tanggal yang tidak terbaca harus
   dikirim sebagai `ambiguous: true` + `ambiguousFields`, BUKAN diisi 0, 1,
   atau nilai "kira-kira". Server akan menolak 422 dan tidak menulis apa pun.
2. **`idempotencyKey` stabil per dokumen.** Satu file = satu kunci. Retry
   memakai kunci yang SAMA.
3. **Jangan retry create otomatis.** Kalau client mengembalikan
   `code: transport_unknown`, hasil tidak diketahui: ulangi dengan kunci yang
   sama (server akan menjawab `ignored_duplicate_event` bila sudah tercatat).
4. **Raw image ref bukan OCR.** Kalau file hanya berupa gambar dan agen tidak
   bisa mengekstrak, kirim ke manusia untuk klarifikasi. API tidak melakukan OCR.
5. **Satu nota = satu vendor + satu tanggal.** Nota lintas proyek boleh (alokasi
   per baris), tetapi proyek harus eksplisit per baris.
6. **Pembelian bukan penerimaan fisik.** Jangan mengharapkan serah terima,
   invoice, atau pembayaran otomatis dari create.

## 4. Membaca hasil create

Respons sukses (`201`) memuat `receivingId`, `invoiceNo`, `totals`, `items`,
dan `readback`. **Klaim "tercatat" hanya boleh bila `status === "tercatat"` dan
`readback.ok === true`.** Untuk verifikasi ulang independen:

```bash
node client.mjs read purchases --id <receivingId>
node client.mjs read purchase-items --receiving-id <receivingId>
```

Bandingkan `items[].qty`/`harga`/`project_id` dengan payload yang dikirim.
Kalau berbeda, laporkan sebagai kegagalan — jangan dianggap sukses.

## 5. Kode hasil yang perlu ditangani berbeda

| HTTP | code | Tindakan Bakpau |
|---|---|---|
| 201 | — | sukses; simpan `receivingId`, verifikasi readback |
| 200 | `ignored_duplicate_event` | sudah tercatat sebelumnya; **jangan** kirim ulang |
| 200 | `duplicate_evidence` | nota sama sudah ada (kanal lain); tampilkan nomor lama |
| 401 | `missing_token`/`invalid_token`/`token_revoked` | hentikan, laporkan ke DAT (token perlu diperbaiki) |
| 403 | `insufficient_scope` | hentikan; token tidak berizin untuk operasi ini |
| 422 | `invalid_payload` | perbaiki payload; **tidak ada** yang tersimpan |
| 422 | `ambiguous_extraction` | minta konfirmasi manusia; **tidak ada** yang tersimpan |
| 422 | `unknown_reference` | vendor/proyek/PR tidak ada di master; jangan buat master baru |
| 429 | `rate_limited` | tunggu `Retry-After` detik |
| 503 | `create_disabled` | **tulis belum diaktifkan** (gate review). Jangan akali; laporkan ke DAT |
| 503 | `atomic_rpc_unavailable` | fungsi transaksi bersama belum ada; jangan akali, jangan pecah jadi beberapa panggilan |
| 503 | `ledger_unavailable` | jalur tulis belum aktif (DDL belum diterapkan); laporkan, jangan akali |
| 503 | `api_not_configured` | deployment belum punya token; laporkan |

**Catatan penting tentang create:** sampai gate review lulus, server menjawab
`503 create_disabled` untuk SEMUA permintaan create, termasuk payload yang
sudah valid. Itu disengaja. Bakpau boleh menyiapkan payload dan menguji
`doctor`/`read`, tetapi tidak boleh menganggap create siap produksi.

## 6. Batas yang tetap berlaku

* Tidak ada akses SQL, admin, user-listing, role/password, DDL, delete,
  invoice, payment, atau handover otomatis lewat token ini.
* Tidak ada tabel bebas: hanya 8 resource di kontrak.
* Tidak mengubah parser menjadi fuzzy project name.
* Notifikasi hasil hanya ke Telegram DM DAT (bukan WA, bukan Novi).
* File asli tidak dipindah/diarsipkan oleh API.
