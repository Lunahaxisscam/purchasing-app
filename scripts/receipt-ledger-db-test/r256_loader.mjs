// r256_loader.mjs — hook resolusi untuk probe notice (BUKAN bagian produksi).
// Hanya supaya `pages/index.js` bisa dijalankan di Node:
//   - `*.module.css` / `*.css`      → modul kosong (Proxy default {})
//   - `next/*`                      → stub minimal
//   - import relatif tanpa ekstensi → `<spec>.mjs` (hasil kompilasi SWC)
// Semua file JS/JSX yang diuji tetap SUMBER VERBATIM hasil kompilasi SWC.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css') || /\.module\.(mjs|js)$/.test(specifier)) {
    return { url: new URL('./r256_css_stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  if (specifier.startsWith('next/')) {
    return { url: new URL('./r256_next_stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const base = new URL(specifier, context.parentURL)
    const p = fileURLToPath(base)
    // 1) apa adanya  2) + .mjs  3) .js/.jsx → .mjs  4) index.mjs
    const cands = [p, `${p}.mjs`, p.replace(/\.(js|jsx)$/, '.mjs'), `${p}/index.mjs`]
    for (const c of cands) {
      if (existsSync(c)) {
        return { url: new URL(`file://${c}`).href, shortCircuit: true }
      }
    }
  }
  return next(specifier, context)
}
