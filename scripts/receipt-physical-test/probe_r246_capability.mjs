// ============================================================
// probe_r246_capability.mjs — GERBANG capability simpan nota
// ============================================================
// Acceptance Paket 1 butir 5 (OPERATIONAL_BATCH_1.md):
//   "Mode yang belum didukung harus menolak secara jujur, bukan melaporkan siap."
//
// Probe ini menguji `getPurchaseCapability()` terhadap database dalam berbagai
// keadaan, termasuk keadaan yang MEMBUAT RUN 246 MENEMUKAN DEFECT:
// RPC menjawab SUKSES tanpa data (mock lama) → dulu disimpulkan READY,
// sehingga jalur atomik dinyalakan padahal fungsinya tidak ada.
// ============================================================
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SB = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const mock = await load('lib/supabaseClient.mjs')
const { __state } = mock
const capMod = await load('modules/receivings/purchaseCapability.mjs')
const { getPurchaseCapability, resetPurchaseCapability, purchaseCapabilityMessage, PURCHASE_CAP } = capMod

let pass = 0, fail = 0
const ck = (id, name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${id}  ${name}`) }
  else { fail++; console.log(`  FAIL ${id}  ${name}${detail ? ' :: ' + detail : ''}`) }
}
const head = (t) => console.log(`\n=== ${t} ===`)

// Builder palsu: menjawab error per tabel sesuai skenario.
function installFakeDb({ typedOk, allocOk, rpcMode }) {
  mock.supabase.from = (table) => {
    const builder = {
      select() { return builder },
      limit() {
        let err = null
        if (table === 'receiving_items' && !typedOk) {
          err = { code: '42703', message: 'column receiving_items.unit_price does not exist' }
        } else if (table === 'receiving_item_allocations' && !allocOk) {
          err = { code: 'PGRST205', message: "Could not find the table 'public.receiving_item_allocations' in the schema cache" }
        }
        return Promise.resolve({ data: null, error: err })
      },
      then(res, rej) { return Promise.resolve({ data: null, error: null }).then(res, rej) }
    }
    return builder
  }
  mock.supabase.rpc = async (fn) => {
    __state.calls.push({ op: 'rpc', fn })
    if (rpcMode === 'missing') {
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } }
    }
    if (rpcMode === 'nullNoError') {
      // INI yang dulu menipu: sukses tanpa data.
      return { data: null, error: null }
    }
    if (rpcMode === 'rejectsEmpty') {
      return { data: { ok: false, reason: 'invalid_payload', error: 'p_payload wajib' }, error: null }
    }
    if (rpcMode === 'forbidden') {
      return { data: null, error: { code: '42501', message: 'permission denied for function purchase_save_atomic' } }
    }
    return { data: null, error: null }
  }
}

// ------------------------------------------------------------
// C1 — skema belum dimigrasi (LEGACY)
// ------------------------------------------------------------
head('C1 skema alokasi belum ada')
installFakeDb({ typedOk: false, allocOk: false, rpcMode: 'missing' })
resetPurchaseCapability()
let cap = await getPurchaseCapability({ force: true })
console.log('  cap:', JSON.stringify(cap))
ck('C1a', 'state = legacy', cap.state === PURCHASE_CAP.LEGACY, String(cap.state))
ck('C1b', 'allocationPersisted = false', cap.allocationPersisted === false)
ck('C1c', 'RPC TIDAK dipanggil saat objek belum ada (tidak ada kebisingan)',
  __state.calls.filter(c => c.op === 'rpc').length === 0,
  `n=${__state.calls.filter(c => c.op === 'rpc').length}`)
ck('C1d', 'pesan menyebut alokasi TIDAK tersimpan',
  /TIDAK tersimpan/.test(purchaseCapabilityMessage(cap)), purchaseCapabilityMessage(cap))

// ------------------------------------------------------------
// C2 — DEFECT RUN 246: RPC menjawab sukses TANPA data
// ------------------------------------------------------------
head('C2 RPC menjawab sukses tanpa data (dulu disimpulkan READY)')
installFakeDb({ typedOk: true, allocOk: true, rpcMode: 'nullNoError' })
resetPurchaseCapability()
cap = await getPurchaseCapability({ force: true })
console.log('  cap:', JSON.stringify(cap))
ck('C2a', 'TIDAK disimpulkan READY', cap.state !== PURCHASE_CAP.READY, String(cap.state))
ck('C2b', 'allocationPersisted = false', cap.allocationPersisted === false)
ck('C2c', 'probeFailed ditandai (tidak bisa disimpulkan)',
  cap.probeFailed === true, String(cap.probeFailed))

// ------------------------------------------------------------
// C3 — RPC ada & menolak payload kosong (keadaan SEHAT)
// ------------------------------------------------------------
head('C3 RPC ada & menolak payload kosong')
installFakeDb({ typedOk: true, allocOk: true, rpcMode: 'rejectsEmpty' })
resetPurchaseCapability()
cap = await getPurchaseCapability({ force: true })
console.log('  cap:', JSON.stringify(cap))
ck('C3a', 'state = ready', cap.state === PURCHASE_CAP.READY, String(cap.state))
ck('C3b', 'allocationPersisted = true', cap.allocationPersisted === true)
ck('C3c', 'pesan kosong (tidak ada peringatan)', purchaseCapabilityMessage(cap) === '', purchaseCapabilityMessage(cap))

// ------------------------------------------------------------
// C4 — RPC ada tetapi role ditolak (42501)
// ------------------------------------------------------------
head('C4 RPC ada tetapi role ditolak')
installFakeDb({ typedOk: true, allocOk: true, rpcMode: 'forbidden' })
resetPurchaseCapability()
cap = await getPurchaseCapability({ force: true })
console.log('  cap:', JSON.stringify(cap))
ck('C4a', 'TIDAK READY (jalur atomik tidak bisa dipakai)', cap.state !== PURCHASE_CAP.READY, String(cap.state))
ck('C4b', 'allocationPersisted = false', cap.allocationPersisted === false)
ck('C4c', 'pesan menyebut masalahnya', /RPC|akses|alokasi/i.test(purchaseCapabilityMessage(cap)), purchaseCapabilityMessage(cap))

// ------------------------------------------------------------
// C5 — kolom typed ADA tetapi tabel alokasi belum (PARTIAL)
// ------------------------------------------------------------
head('C5 kolom typed ada, tabel alokasi belum')
installFakeDb({ typedOk: true, allocOk: false, rpcMode: 'missing' })
resetPurchaseCapability()
cap = await getPurchaseCapability({ force: true })
console.log('  cap:', JSON.stringify(cap))
ck('C5a', 'state = partial', cap.state === PURCHASE_CAP.PARTIAL, String(cap.state))
ck('C5b', 'allocationPersisted = false', cap.allocationPersisted === false)
ck('C5c', 'pesan menyebut BELUM lengkap', /BELUM lengkap/.test(purchaseCapabilityMessage(cap)), purchaseCapabilityMessage(cap))

console.log(`\n===== TOTAL: ${pass} PASS / ${fail} FAIL =====`)
process.exit(fail ? 1 : 0)
