// ============================================================
// API Route: /api/reminders — REMINDER OPERASIONAL & READINESS CONTROL (S5)
// ============================================================
// Endpoint TIPIS: seluruh logika ada di scripts/reminders/handler.js supaya
// harness menguji file yang SAMA PERSIS dengan yang dipakai Next (tidak ada
// salinan kedua yang bisa menyimpang).
//
// DRY-RUN / READ-ONLY. Endpoint ini HANYA membaca (SELECT) lalu menghitung
// laporan. Ia TIDAK PERNAH:
//   * mengirim pesan keluar (Telegram / WhatsApp / email / webhook),
//   * melakukan pembayaran atau menyentuh tagihan,
//   * mengubah status data apa pun,
//   * membuat/mengubah jadwal (cron) — tidak ada cron yang didaftarkan.
//
// Otorisasi: HANYA admin, memakai guard yang sama dengan /api/sales-invoices
// (JWT diverifikasi + peran dari tabel `profiles`). Tanpa sesi 401, non-admin
// 403, 503 fail closed bila otorisasi belum dikonfigurasi.
//
// GET /api/reminders
//   ?as_of=YYYY-MM-DD     hitung "hari ini" dari tanggal ini (uji/backfill)
//   ?kinds=a,b            batasi jenis reminder
//   ?format=json|text     text = laporan siap baca
//   ?limit=1000           batas baris per tabel (1..5000)
//   ?pr_overdue_days=3 …  override ambang (angka 0..365)
//   &all=1                sertakan item melewati batas `max_items`
//
// Blok `readiness` di respons menyatakan dengan jujur sumber data mana yang
// tersedia, ambang yang dipakai, dan jenis mana yang BLOCKED karena datanya
// belum ada (mis. tabel sales_invoices belum dimigrasikan).
// ============================================================

export { createRemindersHandler } from '../../scripts/reminders/handler.js'
export { default } from '../../scripts/reminders/handler.js'
