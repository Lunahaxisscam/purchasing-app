# Bakpau → Purchasing: mulai singkat

Tidak perlu MCP. Gunakan Node dan `scripts/bakpau-api-client/client.mjs` dari proyek ini. Ini panduan kandidat staging, bukan bukti produksi siap atau deployment telah dilakukan.

## 1. Pasang identitas secara privat

Operator membuat satu kunci khusus Bakpau secara offline:

```sh
node scripts/bakpau-api-client/generate-key.mjs --out-dir "C:/lokasi-privat/bakpau-baru"
```

Parent harus sudah ada; direktori tujuan harus baru, absolut, di luar repo dan semua direktori yang disajikan web. Jangan gunakan folder sinkronisasi. Generator tidak mencetak rahasia dan tidak menimpa hasil lama. File `agent-token.txt` berisi token mentah; file `server-registry-entry.txt` berisi satu entri hash server. Mode direktori 0700/file 0600 hanya best effort di Windows: operator wajib membatasi ACL ke akun yang berhak. Generator tidak bisa mengetahui semua konfigurasi web server; operator harus memastikan lokasi benar-benar privat.

- Pasang `BAKPAU_API_BASE_URL` sebagai origin HTTPS server yang disetujui (tanpa query, token, atau path endpoint).
- Pasang isi `agent-token.txt` sebagai `BAKPAU_API_TOKEN` di environment privat proses Bakpau melalui pengelola rahasia. Jangan tempel token ke chat, argumen CLI, URL, Git, atau shell history.
- Operator server menambahkan isi `server-registry-entry.txt` ke `BAKPAU_API_TOKENS`, dipisahkan koma. **Pertahankan semua entri lama** dan pastikan keyId tidak bentrok. Jangan mengganti seluruh registry tanpa pemeriksaan.
- Kunci database, terutama service-role/secret key, tetap **server-only**, tidak pernah diberikan kepada agen. Token Bakpau bukan kunci DB.
- Aktivasi `BAKPAU_API_CREATE_ENABLED=true` adalah keputusan deployment operator setelah verifikasi prasyarat RPC/ledger dan izin. Jangan nyalakan hanya agar tes lolos. Panduan ini tidak memasang registry, mengubah VPS, atau mengaktifkan write.

## 2. Cek lokal, lalu baca master

```sh
node scripts/bakpau-api-client/client.mjs doctor
node scripts/bakpau-api-client/client.mjs read masters/projects --limit 50
node scripts/bakpau-api-client/client.mjs read masters/projects --kode 83 --limit 5
node scripts/bakpau-api-client/client.mjs read masters/vendors --limit 50
node scripts/bakpau-api-client/client.mjs read masters/materials --limit 50
```

`doctor` hanya memeriksa konfigurasi lokal, tidak menghubungi server. Cocokkan proyek dari master terlebih dahulu; gunakan UUID sebenarnya, jangan menebak nama/kode atau membuat master fiktif. Periksa halaman berikut dengan `--offset` bila perlu. Jika proyek/vendor/item ambigu, berhenti dan tanyakan pengguna.

## 3. Draft → persetujuan → create

Tampilkan draft nota, vendor, tanggal, proyek, semua item dan total kepada pengguna. Minta persetujuan eksplisit sebelum create. Persetujuan ini aturan prosedural agen, **bukan persetujuan yang terikat server** kecuali mekanisme tersebut benar-benar diimplementasikan.

Gunakan **satu proyek per nota** untuk saat ini. Setiap item harus memiliki proyek efektif; contoh mengisi UUID proyek yang sama pada header dan item. Header saja dapat menjadi fallback item; header tanpa proyek dapat diturunkan dari item-item satu proyek oleh perbaikan API, tetapi contoh eksplisit ini paling jelas. Multi-proyek ditolak sebelum penyimpanan untuk saat ini; tahan untuk penanganan manual dan jangan otomatis memecah satu invoice asli menjadi beberapa nota.

Simpan payload di file privat `payload.json` di luar repo. Contoh berikut hanya template: ganti UUID, data nota, sumber dan waktu ekstraksi dengan fakta yang sudah diverifikasi. Pertahankan `idempotencyKey` stabil untuk dokumen yang sama.

```json
{
  "idempotencyKey": "nota-2026-11-11-toko-contoh-001",
  "provenance": {
    "sourceType": "foto_nota",
    "sourceRef": "arsip-privat/nota-001.jpg",
    "extractedBy": "bakpau-agen-v1",
    "extractedAt": "2026-11-11T10:00:00Z"
  },
  "purchase": {
    "vendorId": "11111111-1111-4111-8111-111111111111",
    "vendorName": "Toko Contoh",
    "date": "2026-11-11",
    "invoiceNo": "CONTOH-001",
    "projectId": "22222222-2222-4222-8222-222222222222",
    "biayaLain": 0,
    "diskon": 0,
    "statedTotal": 240000,
    "catatan": "Draft disetujui pengguna",
    "items": [{
      "itemName": "Triplek 9mm",
      "qty": 2,
      "harga": 120000,
      "unit": "Lembar",
      "projectId": "22222222-2222-4222-8222-222222222222",
      "ambiguous": false,
      "ambiguousFields": []
    }]
  }
}
```

Setelah disetujui, jalankan sekali (ganti path privat):

```sh
node scripts/bakpau-api-client/client.mjs create --file "C:/lokasi-privat/payload.json"
```

Jangan hilangkan penanda ambigu demi lolos validasi. Jangan membuat PR fiktif. API ini bukan endpoint update, pembayaran, invoice, atau serah-terima fisik.

## 4. Baca balik dan tangani hasil tidak pasti

Gunakan ID pembelian dari respons dan ganti UUID contoh di bawah:

```sh
node scripts/bakpau-api-client/client.mjs read purchases --id 33333333-3333-4333-8333-333333333333 --limit 1
node scripts/bakpau-api-client/client.mjs read purchase-items --receiving-id 33333333-3333-4333-8333-333333333333 --limit 80
```

Cocokkan header/proyek dan total dengan readback respons create serta item yang tersedia sebelum mengatakan berhasil. Resource `purchase-items` adalah baris mentah: tidak menjanjikan kolom `project_id` atau `harga` ternormalisasi; penanda proyek dapat berada di `note`. Jangan menganggap field yang tidak ditampilkan sudah diverifikasi. `biayaLain` mengikuti aturan operasional WS yang ada, bukan klaim alokasi biaya proyek. Simpan request_id dan hasil privat untuk penelusuran. Status duplicate bukan bukti nota baru dibuat; baca balik catatan yang dirujuk.

Jika timeout, `transport_unknown`, readback gagal, atau status commit tidak jelas: **berhenti, jangan membuat idempotencyKey baru dan jangan membuat nota duplikat**. Baca berdasarkan vendor + nomor invoice jika ID belum diketahui:

```sh
node scripts/bakpau-api-client/client.mjs read purchases --vendor-id 11111111-1111-4111-8111-111111111111 --invoice-no CONTOH-001 --limit 20
```

Hasil baca kosong saja belum membuktikan transaksi gagal. Eskalasi ke operator untuk rekonsiliasi. Bila pemeriksaan memerlukan pengiriman ulang, gunakan payload dan idempotencyKey **yang sama**, bukan nota baru; jangan retry create otomatis. `create_disabled`/RPC belum tersedia harus diselesaikan operator melalui proses deployment yang disengaja.
