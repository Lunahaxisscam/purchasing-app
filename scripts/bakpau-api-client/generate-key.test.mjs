import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateKey } from './generate-key.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
// Auth is pure ESM in a non-module package: import the unchanged source as data.
const authSource = fs.readFileSync(path.join(here, '../../lib/bakpau/apiAuth.js'), 'utf8')
const { verifyApiToken } = await import(`data:text/javascript;base64,${Buffer.from(authSource).toString('base64')}`)

test('offline provisioning: auth compatibility, exclusive creation and no credential logging', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bakpau-key-test-'))
  try {
    const output = path.join(root, 'private-key')
    const result = spawnSync(process.execPath, [path.join(here, 'generate-key.mjs'), '--out-dir', output], { encoding: 'utf8', env: {} })
    assert.equal(result.status, 0)
    const token = fs.readFileSync(path.join(output, 'agent-token.txt'), 'utf8').trim()
    const registry = fs.readFileSync(path.join(output, 'server-registry-entry.txt'), 'utf8').trim()
    const [prefix, keyId, secret] = token.split('.')
    assert.equal(prefix, 'bpk')
    assert.match(keyId, /^[a-z0-9]{8,32}$/)
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(Buffer.from(secret, 'base64url').length, 32)
    const hash = crypto.createHash('sha256').update(secret).digest('hex')
    assert.ok(registry === `${keyId}:${hash}:purchasing:read+purchasing:create`)
    for (const requiredScope of ['purchasing:read', 'purchasing:create']) {
      assert.ok(verifyApiToken({ headers: { authorization: `Bearer ${token}` }, env: { BAKPAU_API_TOKENS: registry }, requiredScope }).ok)
    }
    assert.equal(verifyApiToken({ headers: { authorization: `Bearer bpk.${keyId}.${'x'.repeat(43)}` }, env: { BAKPAU_API_TOKENS: registry } }).ok, false)
    const logs = result.stdout + result.stderr
    for (const value of [token, secret, registry, hash]) assert.ok(!logs.includes(value), 'credential not logged')
    const again = spawnSync(process.execPath, [path.join(here, 'generate-key.mjs'), '--out-dir', output], { encoding: 'utf8', env: {} })
    assert.equal(again.status, 1)
    assert.ok(!`${again.stdout}${again.stderr}`.includes(secret))
    assert.ok(fs.readFileSync(path.join(output, 'agent-token.txt'), 'utf8').trim() === token, 'existing token unchanged')
    assert.throws(() => generateKey('relative-dir'))
    assert.throws(() => generateKey(path.join(here, 'must-not-exist')))
    const served = path.join(root, 'public')
    fs.mkdirSync(served)
    assert.throws(() => generateKey(path.join(served, 'key')))
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(output).mode & 0o777, 0o700)
      assert.equal(fs.statSync(path.join(output, 'agent-token.txt')).mode & 0o777, 0o600)
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
