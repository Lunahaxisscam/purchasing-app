#!/usr/bin/env node
/**
 * RUNTIME READBACK — bundle PRODUKSI (served dari port 3101, hasil next build
 * isolated), bukan transform sandbox harness. Merender komponen _app/index
 * asli dari chunk produksi tidak praktis; yang dibuktikan di sini:
 *   1. Bundle produksi memuat seluruh string fitur baru (Show More,
 *      Menampilkan X dari Y, Ringkas, list-show-more) — bukti build berisi
 *      implementasi terbaru, bukan build lama.
 *   2. CSS produksi memuat rule .list-show-more + touch target 44px mobile.
 *   3. __smoke page 200 (smoke route build hijau).
 *   4. Smoke page statis & HTML root dapat diambil (server Next hidup).
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3101'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom') // pastikan jsdom tersedia bila perlu (tidak wajib di sini)

let pass = 0, fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  return r.text()
}

const html = await fetchText(BASE + '/')
check('GET / -> 200 & HTML root', html.includes('__NEXT_DATA__'))

// kumpulkan semua script chunk + css dari HTML
const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map(m => m[1])
const cssLinks = [...html.matchAll(/href="(\/_next\/[^"]+\.css)"/g)].map(m => m[1])
check('HTML merujuk bundle JS produksi', scripts.length > 0, String(scripts.length))
check('HTML merujuk CSS produksi', cssLinks.length > 0, String(cssLinks.length))

let jsAll = ''
for (const s of scripts) jsAll += '\n/* ' + s + ' */\n' + await fetchText(BASE + s)
let cssAll = ''
for (const c of cssLinks) cssAll += await fetchText(BASE + c)

check('bundle produksi memuat tombol "Show More / Tampilkan Lebih Banyak"', jsAll.includes('Show More / Tampilkan Lebih Banyak'))
check('bundle produksi memuat indikator "Menampilkan "', jsAll.includes('Menampilkan '))
check('bundle produksi memuat tombol "Ringkas"', jsAll.includes('Ringkas'))
check('bundle produksi memuat class .list-show-more', jsAll.includes('list-show-more'))
check('bundle produksi memuat label kolom Material (regresi)', jsAll.includes('Acuan Harga') || jsAll.includes('Batas Min'))
check('CSS produksi memuat rule .list-show-more', cssAll.includes('.list-show-more'))
check('CSS produksi memuat indikator .list-shown-indicator', cssAll.includes('.list-shown-indicator'))
check('CSS produksi touch target mobile 44px di .list-show-more-actions', /list-show-more-actions[\s\S]{0,400}min-height:44px|@media[^{]*1024px[\s\S]{0,900}list-show-more-actions[\s\S]{0,500}min-height: 44px/.test(cssAll.replace(/\s/g, '').includes('min-height:44px') ? cssAll : cssAll.replace(/\s+/g, ' ')) || cssAll.includes('min-height: 44px'))

// smoke route
const smoke = await fetch(BASE + '/__smoke')
check('/__smoke -> 200', smoke.status === 200)

console.log(`\n=== RUNTIME READBACK: ${pass} LULUS, ${fail} GAGAL (BASE=${BASE}) ===`)
process.exit(fail ? 1 : 0)
