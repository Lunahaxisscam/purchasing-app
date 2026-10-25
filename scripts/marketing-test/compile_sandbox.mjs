// Transform semua file sandbox (.mjs berisi JSX) via esbuild,
// tulis hasil kompilasi ke dist/ (struktur mirror). Dijalankan oleh run.py.
//
// NOTE: harness CRM memakai esbuild yang tersedia di mesin (repo ini
// node_modules-nya minimal). Hasilnya ESM yang sama-sama bisa
// di-import oleh harness Node.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { transformSync } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/esbuild')

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    // Dirent.isDirectory() = false untuk SYMLINK (node_modules di-symlink
    // dari repo), jadi periksa nama dulu supaya symlink tidak jatuh ke
    // cabang ".mjs" dan membuat walk melempar.
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
  const compiled = transformSync(src, {
    loader: 'jsx',
    format: 'esm',
    target: 'es2022',
    jsx: 'transform',
    sourcemap: false,
  }).code
  const rel = path.relative(SB, file)
  const out = path.join(SB, 'dist', rel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, compiled)
  n++
}
console.log(`esbuild: ${n} file dikompilasi ke dist/`)
