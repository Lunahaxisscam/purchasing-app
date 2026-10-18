// Transform semua berkas sandbox (.mjs berisi JSX) via SWC bawaan Next.
// Dijalankan oleh run.py di dalam sandbox.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    let isDir = false
    try { isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(p).isDirectory()) } catch { isDir = false }
    if (isDir) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      walk(p, out)
    } else if (e.name.endsWith('.mjs')) {
      out.push(p)
    }
  }
  return out
}

const files = walk(SB)
let n = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const code = swc.transformSync(src, {
    filename: file,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  const rel = path.relative(SB, file)
  const out = path.join(SB, 'dist', rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, code)
  n++
}
console.log(`swc: ${n} file dikompilasi ke dist/`)
