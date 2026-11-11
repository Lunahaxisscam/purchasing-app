#!/usr/bin/env node
// Offline provisioning only. Never reads env or contacts a server.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const within = (base, candidate) => {
  const rel = path.relative(base, candidate)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

export function generateKey(outDir) {
  if (!outDir || !path.isAbsolute(outDir)) throw new Error('Absolute --out-dir required.')
  // Require a NEW directory under an existing private parent. Resolve symlinks
  // before checking containment; never write beneath this repo or a served tree.
  const parent = fs.realpathSync(path.dirname(outDir))
  const target = path.join(parent, path.basename(outDir))
  const repo = fs.realpathSync(projectRoot)
  if (within(repo, target) || /(?:^|[\\/])(?:public|www|wwwroot|htdocs|static|dist|build|\.next)(?:[\\/]|$)/i.test(target)) {
    throw new Error('Output must be outside repository and served directories.')
  }
  fs.mkdirSync(target, { mode: 0o700 }) // exclusive: existing directory is refused
  const created = []
  try {
    const keyId = crypto.randomBytes(12).toString('hex')
    const secret = crypto.randomBytes(32).toString('base64url')
    const token = `bpk.${keyId}.${secret}`
    const hash = crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
    const outputs = [
      ['agent-token.txt', `${token}\n`],
      ['server-registry-entry.txt', `${keyId}:${hash}:purchasing:read+purchasing:create\n`]
    ]
    for (const [name, value] of outputs) {
      const file = path.join(target, name)
      fs.writeFileSync(file, value, { flag: 'wx', mode: 0o600 })
      created.push(file)
    }
    return target // paths only; no credential returned or logged
  } catch {
    for (const file of created) { try { fs.unlinkSync(file) } catch {} }
    try { fs.rmdirSync(target) } catch {}
    throw new Error('Provisioning failed; no credentials logged. Inspect private output directory before retrying.')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2 || args[0] !== '--out-dir') throw new Error('Usage: node generate-key.mjs --out-dir ABSOLUTE_NEW_PRIVATE_DIRECTORY')
    const location = generateKey(args[1])
    process.stdout.write(`Private files created in ${location}\nPermissions are best effort on Windows; restrict the directory ACL to the intended account. Do not use a web-served or synced directory.\n`)
  } catch {
    // Do not echo arguments, filesystem errors or secret-bearing values.
    process.stderr.write('Key generation failed. Require --out-dir absolute, a new directory under an existing private parent, outside repository/served directories.\n')
    process.exitCode = 1
  }
}
