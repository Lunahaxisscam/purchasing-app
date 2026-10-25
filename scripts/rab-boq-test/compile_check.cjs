#!/usr/bin/env node
// Cek kompilasi JSX modul rab-boq dengan SWC Next (sama seperti render test).
const fs = require('fs')
const path = require('path')
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')
const files = [
  'modules/rab-boq/view.jsx',
  'modules/rab-boq/CreateProjectModal.jsx',
  'modules/rab-boq/lib.js'
]
let bad = 0
for (const f of files) {
  const src = fs.readFileSync(path.join('/home/ubuntu/purchasing-app', f), 'utf8')
  try {
    swc.transformSync(src, {
      filename: f,
      jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
      module: { type: 'es6' }
    })
    console.log('OK  ' + f)
  } catch (e) {
    bad++
    console.log('FAIL ' + f + ' :: ' + String(e.message).slice(0, 500))
  }
}
process.exit(bad ? 1 : 0)
