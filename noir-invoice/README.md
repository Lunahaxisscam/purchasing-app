# Manual Invoice Noir / Kabineku (staging)

One manual form → select presentation → real pdf-lib A4. No CRM, projects API,
DB, cloud save, issuing, status transitions or automatic numbering. Local drafts
and JSON backups are optional and retain the existing v1 namespace.

## Reproduce

Node 22+, run `npm ci --prefix noir-invoice`, then:

```
NODE_OPTIONS=--max-old-space-size=1536 npm --prefix noir-invoice run build
NODE_OPTIONS=--max-old-space-size=1536 noir-invoice/node_modules/.bin/vitest run noir-invoice/tests
```

Wrapper test also needs root React/react-dom dependencies (`npm ci` at repo
root in a clean isolated checkout). PDF tests require Poppler `pdftotext` and
write SYNTHETIC TEST samples to `INVOICE_TEST_REPORT_DIR` or
`/home/ubuntu/reports/invoice-kabineku-staging`. Never use real customer data.

`vite.config.js` builds canonical source into `public/noir-invoice` with hashed
assets. PDF generator re-exports the shared official renderer; duplicated model
has matching explicit template identity (Noir v1 default, Kabineku v1 allowlist).
Unsupported versions normalize to supported v1. No paths/CSS come from imports.

Restored source prerequisites: styles from existing standalone generator;
fonts/logo byte copies of tracked `public/invoice-assets`. Package and lockfile
restored from existing standalone buildchain. No global dependency changes.
For this run the existing standalone node_modules were reused by untracked
symlink; the lock pins Vite 7.3.7 / Vitest 3.2.7 / jsdom 26.1.0.

Kabineku logo is a temporary vector reconstruction, not an official brand master.
HTML preview is a continuous sheet; actual PDF has A4 pagination/repeated table
headers. Mobile form is single-column, A4 preview scrolls horizontally at a
readable minimum width. Legacy invoice list/auth/business history remains intact;
only its generator-specific CRM lookup/push was removed. This does not imply the
entire authenticated parent app makes no business requests when listing history.
