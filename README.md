# Internal Purchasing App — Noir Living Indonesia

Aplikasi internal web terpadu untuk pengadaan barang (*procurement*), kontrol biaya proyek (*cost control*), upah & kasbon mandor, serta rekonsiliasi keuangan workshop & lapangan.

Dokumentasi cetak biru lengkap sistem & saran pengembangan masa depan dapat dibaca di:
👉 **`../INTERNAL_PURCHASING_APP.md`**

## Ringkasan Fitur
- **Procurement Flow**: Purchase Request (PR) ➔ Approval ➔ Purchase/Receiving ➔ Handover ke Tukang.
- **Master Data**: Projects, Vendors, Materials Catalog (prefix otomatis `PLY`, `HPL`, `WPC`, `HWF`, `KEL`, `ALM`, `BHP`).
- **Admin & Finance**: Project Planning, Project Finance, Finance & Closing Proyek (integrasi Google Sheets `REKAP COST 2026`), Upah Tukang (integrasi folder `BAKSO - ACCOUNTING`), User Settings (RBAC).
- **Security**: PostgreSQL Row Level Security (RLS) & Token-Gated Sync RPCs.

## Menjalankan Aplikasi
```bash
npm install
npm run dev
```
Produksi dideploy via Vercel & Supabase.
