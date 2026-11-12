# Kabineku manual invoice
Recovered from feat/invoice-kabineku-staging; mounted inside the final Purchasing Invoice module via a brand chooser. Noir source and official renderer are not replaced.
Kabineku is an opaque-origin sandbox without allow-same-origin: no parent DOM/CRM, Supabase credentials, business APIs, database writes, automatic numbering, or Noir localStorage access. Drafts are memory-only per tab. Export/import JSON is a user-controlled file backup, not a ledger. PDF assets are embedded in the bundle; CSP denies external/data API connections. Logo uses the artwork supplied by DAT, cropped only to remove outer white space; no reconstruction or extra tagline.
Build: npm ci then npm run build here, then npm run build at repo root. Tests: node kabineku-invoice/node_modules/vitest/vitest.mjs run kabineku-invoice/tests from repo root.

## Final approved template
DAT approved: supplied logo, INVOICE title without duplicate issuer name below it, BCA 6040359867 Daril Aldian, right-aligned signature. New invoice numbering MM/KBNK/NNN; retain literal input (no implicit normalization/counter/Noir linkage). Blank notes by default, no simulation text in final mode; draft validation safeguards remain. Johan commitment-fee document corrected explicitly to 11/KBNK/007 with no simulation note.
