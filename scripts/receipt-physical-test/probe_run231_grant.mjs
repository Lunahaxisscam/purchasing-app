// ============================================================
// probe_run231_grant.mjs — REVIEW RUN 231, bagian 3
// ============================================================
// Jalur masuk KEDUA ke keadaan yang sama, dan ini yang paling mungkin terjadi:
//
//   file 03_return_layer.sql SUDAH dijalankan (tabel ADA),
//   tetapi role `authenticated` tidak punya SELECT / RLS menolak.
//
// `probeTable` menandai hasil itu `indeterminate: true` — benar.
// Tetapi `probeFailed` di receiptCapability.js dihitung:
//
//     const probeFailed = !coreReady && indeterminate
//
// Saat coreReady = TRUE (events + handover_items + view OK), kegagalan
// `return_lines` TIDAK PERNAH menandai probeFailed. Hasilnya:
//     probeFailed = false, ready = true, returnReady = false
//     → capabilityState() = 'ready'
//
// Ini persis kelas blocker `GRANT SELECT v_receipt_progress` yang memblok card
// ini, hanya objeknya `return_lines`. Bedanya: untuk view, coreReady ikut
// false sehingga probeFailed=true dan UI jujur. Untuk return_lines, UI diam.
// ============================================================
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom0 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true })
global.window = dom0.window
global.document = dom0.window.document
global.HTMLElement = dom0.window.HTMLElement
global.HTMLInputElement = dom0.window.HTMLInputElement
global.HTMLSelectElement = dom0.window.HTMLSelectElement
global.Event = dom0.window.Event
global.FileReader = dom0.window.FileReader

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { flushSync } = await import('react-dom')
const mock = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)
const importDist = (rel) => import(pathToFileURL(path.join(SB, 'dist', rel)).href)
const CAP = await importDist('modules/receivings/receiptCapability.mjs')
const Q = await importDist('modules/handovers/queue.mjs')

let pass = 0, fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}  ${extra}`) }
}
const tick = () => new Promise(r => setTimeout(r, 0))

const REC = { id: 'rec1', purchase_request_id: 'pr1', project_id: 'p1', status: 'NORMAL', invoice_no: 'INV-BARU', note: '', alokasi: 'KE_TUKANG', masuk_gudang: false, tukang_at: null }
const RI = [{ id: 'ri1', receiving_id: 'rec1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', quantity_received: 10 }]
const HO = { id: 'h1', receiving_id: 'rec1', project_id: 'p1', received_by: 'Pak Joko', status: 'DRAFT', handover_date: '2026-10-21', diserahkan_at: null, note: '' }
const PR_ITEMS = [{ id: 'pi1', pr_id: 'pr1', item_name: 'Triplek 9mm', quantity: 10, unit: 'Lembar', status: 'RECEIVED' }]
const EVENTS = [{ id: 'ev1', receiving_id: 'rec1', receiving_item_id: 'ri1', pr_item_id: 'pi1', item_name: 'Triplek 9mm', unit: 'Lembar', qty_datang: 6, qty_rusak: 2, tujuan_ws: 0, tujuan_tukang: 4, penerima_tukang: 'Pak Joko', retur_status: 'PENDING', retur_qty: 2, discard_confirmed: false }]
const LEDGER = { receivingEvents: EVENTS, handoverItems: [], returnLines: [], returnCases: [], progress: [{ receiving_item_id: 'ri1', qty_datang: 6, qty_rusak: 2, qty_baik: 4, belum_diserahkan: 4, qty_bought: 10, qty_arrived: 6, qty_handed_over: 0, tujuan_tukang: 4 }] }

console.log('\n=== 1. Probe NYATA dengan return_lines = permission denied (42501) ===\n')
{
  mock.__reset({ receivings: [REC], prItems: PR_ITEMS, receivingItems: RI, handovers: [HO], ledger: LEDGER })
  CAP.resetReceiptCapability()
  const origFrom = mock.supabase.from
  mock.supabase.from = (table) => {
    if (table === 'return_lines') {
      return {
        select() { return this },
        limit() {
          return Promise.resolve({
            data: null,
            error: { code: '42501', message: 'permission denied for table return_lines', details: null, hint: null }
          })
        }
      }
    }
    return origFrom(table)
  }
  const cap = await CAP.getReceiptCapability({ force: true })
  mock.supabase.from = origFrom
  console.log(`     cap = ${JSON.stringify({ ready: cap.ready, returnReady: cap.returnReady, returnLines: cap.returnLines, probeFailed: cap.probeFailed, missing: cap.missing })}`)
  check('1a returnReady=false (benar — retur tidak bisa dipakai)', cap.returnReady === false, String(cap.returnReady))
  check('1b probeFailed=true (kegagalan RLS harus TERLIHAT, bukan disimpulkan "tidak ada")',
    cap.probeFailed === true, `probeFailed=${cap.probeFailed}`)
  const st = CAP.capabilityState(cap)
  console.log(`     capabilityState = ${st}`)
  check('1c capabilityState TIDAK boleh "ready" saat retur tidak terbaca', st !== 'ready', st)
  const msg = CAP.capabilityMessage(cap)
  console.log(`     capabilityMessage = ${JSON.stringify(msg)}`)
  check('1d capabilityMessage memberi tahu admin bahwa retur tidak bisa dipakai',
    /retur/i.test(String(msg)) && String(msg).trim().length > 0, JSON.stringify(msg))
}

console.log('\n=== 2. Akibatnya di gerbang tulis ===\n')
{
  const cap = { ready: true, returnReady: false, events: true, handoverItems: true, returnLines: false, progress: true, probeFailed: false, missing: ['retur: return_lines: permission denied'] }
  const st = CAP.capabilityState(cap)
  const plan = Q.problemPlan(REC, 1, true, st)
  console.log(`     capState=${st} → problemPlan = ${JSON.stringify(plan)}`)
  check('2a panel Bermasalah tidak menawarkan jalur retur saat return_lines tak terbaca',
    !(plan.ok && plan.perLine), JSON.stringify(plan))
}

console.log(`\n=== HASIL PROBE RUN 231-GRANT: ${pass} PASS / ${fail} FAIL ===`)
if (fail) console.log('GAGAL: ' + failures.join(' | '))
process.exit(fail ? 1 : 0)
