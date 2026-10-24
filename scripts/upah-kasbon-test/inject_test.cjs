// Uji ORDERING injeksi klien Supabase ke modul Upah & Kasbon.
//
// Kenapa tes ini ada: view.jsx merender <iframe> ke prototipe. Prototipe
// membaca window.parent.__UPAH_SUPABASE__ SAAT SCRIPTNYA JALAN. Bila klien
// baru dipasang di useEffect (setelah React commit), iframe sudah mulai
// memuat HTML dan bisa terlanjur masuk mode legacy (localStorage) — modul
// tampak kosong walau database sehat. Tes ini mengunci kontraknya:
// klien WAJIB sudah terpasang tepat setelah modul di-import, TANPA render.
const fs = require('fs')
const Module = require('module')
const path = require('path')

const root = process.cwd()
const swc = require('next/dist/build/swc')
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true
})
global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.error('  ✗ GAGAL: ' + m) } }

// klien palsu: yang diuji hanya URUTAN pemasangan, bukan isi klien
const fakeClient = { from: () => ({}), auth: {} }
const stubPath = path.join(root, 'lib/supabaseClient.js')
const origJs = Module._extensions['.js']
for (const ext of ['.js', '.jsx']) {
  Module._extensions[ext] = function (mod, file) {
    if (!file.startsWith(root + '/') || file.includes('/node_modules/')) return origJs(mod, file)
    if (file === stubPath) { mod.exports = { supabase: fakeClient }; return }
    if (file.endsWith('.css')) { mod.exports = {}; return }
    const code = swc.transformSync(fs.readFileSync(file, 'utf8'), {
      filename: file,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'commonjs' }
    }).code
    mod._compile(code, file)
  }
}

console.log('== injeksi klien terjadi saat IMPORT (bukan saat render) ==')
ok(dom.window.__UPAH_SUPABASE__ === undefined, 'sebelum import: belum ada klien di window')

const viewPath = path.join(root, 'modules/upah-kasbon/view.jsx')
const mod = require(viewPath)
ok(typeof mod.default === 'function', 'modul view diekspor sebagai komponen')

// INTI TES: setelah require() selesai, klien harus SUDAH terpasang —
// artinya pemasangan terjadi di module scope, sebelum React merender iframe.
ok(dom.window.__UPAH_SUPABASE__ === fakeClient,
  'setelah import (TANPA render): window.__UPAH_SUPABASE__ sudah terpasang')
ok(dom.window.__UPAH_SUPABASE__ !== undefined,
  'iframe akan membaca klien yang benar pada detik pertama ia dieksekusi')

console.log('')
console.log('HASIL: ' + pass + ' lulus, ' + fail + ' gagal')
process.exit(fail ? 1 : 0)
