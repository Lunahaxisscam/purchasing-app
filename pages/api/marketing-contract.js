// ============================================================
// API Route: /api/marketing-contract — KONTRAK MARKETING → CRM/PROJECT (S6)
// ============================================================
// Endpoint TIPIS: seluruh logika ada di scripts/marketing/handler.js supaya
// harness menguji file yang SAMA PERSIS dengan yang dipakai Next.
//
// DRY-RUN / READ-ONLY / KONTRAK SAJA. Endpoint ini:
//   * hanya GET (method lain 405, tanpa membaca apa pun),
//   * hanya membaca tabel yang boleh dibaca marketing (leads, campaigns,
//     lead_touchpoints, lead_handoffs, customers, projects),
//   * TIDAK mengirim pesan (WhatsApp/email/DM), TIDAK membeli/memasang iklan,
//   * TIDAK menulis tabel apa pun — termasuk purchase_requests/pr_items/
//     approval_steps/receivings/receiving_items/handovers/projects/sales_invoices
//     yang merupakan milik modul lain (purchasing tidak boleh terganggu),
//   * TIDAK punya cron/sinkronisasi latar.
//
// Route guard: permintaan yang mengarah ke aksi keluar (mis.
// ?action=send, ?ads=1, ?sync=1) dijawab 403 ACTION_FORBIDDEN.
//
// GET /api/marketing-contract                    → ringkasan kontrak
// GET /api/marketing-contract?view=readiness     → ketersediaan tabel (SELECT)
// GET /api/marketing-contract?view=sample        → validasi contoh dry-run
// GET /api/marketing-contract?view=sample&sample=valid-won-full
//
// Otorisasi: HANYA admin, memakai guard yang sama dengan /api/sales-invoices.
// ============================================================

export { createMarketingHandler } from '../../scripts/marketing/handler.js'
export { default } from '../../scripts/marketing/handler.js'
