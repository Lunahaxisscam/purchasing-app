// ============================================================
// scripts/approval-off-test/static_test.mjs — BUKTI STATIS FAIL-CLOSED
// ============================================================
// Membaca SUMBER REPO (bukan hasil kompilasi) dan membuktikan urutannya:
// setiap handler approval di pages/index.js memanggil `approvalGuard(...)`
// SEBELUM operasi DB/RPC/alert pertama. Ini penting karena "menutup menu"
// saja tidak cukup — handler harus berhenti sebelum write/call.
//
// Juga memastikan tidak ada penulisan/hapus approval_steps yang tersisa di
// jalur yang bisa dijalankan saat OFF, dan tidak ada DDL/seed yang diubah.
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const REPO = process.argv[2] || process.cwd()
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}  ${extra}`) }
}

console.log('\n=== S. BUKTI STATIS: GUARD SEBELUM EFEK SAMPING ===')

const index = read('pages/index.js')
const submit = read('modules/requests/submit.js')
const telegram = read('lib/telegramAlert.js')
const constants = read('lib/constants.js')
const reminders = read('scripts/reminders/rules.js')
const collect = read('scripts/reminders/collect.js')

// ---------- S1. Satu flag, tidak ada flag kedua ----------
{
  const flagsInConstants = (constants.match(/export const APPROVAL_MODULE_ENABLED\s*=/g) || []).length
  check('S1a tepat satu deklarasi APPROVAL_MODULE_ENABLED di lib/constants.js', flagsInConstants === 1, `n=${flagsInConstants}`)
  const val = (constants.match(/export const APPROVAL_MODULE_ENABLED\s*=\s*(true|false)/) || [])[1]
  check('S1b nilai flag false (modul OFF)', val === 'false', `got=${val}`)
  const remVal = (reminders.match(/export const APPROVAL_MODULE_ENABLED\s*=\s*(true|false)/) || [])[1]
  check('S1c salinan flag di scripts/reminders/rules.js sama (false)', remVal === 'false', `got=${remVal}`)
  check('S1d tidak ada file kebijakan approval kedua (approvalPolicy.*)', !fs.existsSync(path.join(REPO, 'lib/approvalPolicy.js')))
}

// ---------- S2. Setiap handler approval: guard lebih dulu ----------
function handlerBody(src, name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) return null
  // ambil sampai penanda fungsi berikutnya (deklarasi top-level berikutnya)
  const rest = src.slice(start + 10)
  const next = rest.search(/\n  (?:async )?function |\n  \/\/ ={10,}/)
  return next < 0 ? rest : rest.slice(0, next)
}
for (const fn of ['decideApproval', 'executeDecision', 'reviseApproval', 'approveItem', 'markPrItemOrdered']) {
  const body = handlerBody(index, fn)
  check(`S2a ${fn}: fungsi ditemukan`, !!body)
  if (!body) continue
  const guardIdx = body.indexOf('approvalGuard(')
  check(`S2b ${fn}: memanggil approvalGuard`, guardIdx >= 0)
  if (guardIdx < 0) continue
  const sideEffects = [
    ['.from(', 'query Supabase'],
    ['.rpc(', 'RPC'],
    ['window.confirm(', 'dialog konfirmasi'],
    ['sendPrAlert(', 'alert Telegram'],
    ['ensureItemInPurchase(', 'sync Purchase']
  ]
  for (const [needle, label] of sideEffects) {
    const idx = body.indexOf(needle)
    check(`S2c ${fn}: ${label} terjadi SETELAH guard (atau tidak ada)`, idx < 0 || idx > guardIdx, `guard@${guardIdx} ${label}@${idx}`)
  }
}

// ---------- S3. submit.js: guard di baris pertama ----------
{
  const start = submit.indexOf('export async function handleFinishPr')
  const body = submit.slice(start)
  const guardIdx = body.indexOf('approvalGuard(')
  check('S3a handleFinishPr memanggil approvalGuard', guardIdx >= 0)
  const firstFrom = body.indexOf(".from(")
  check('S3b approval_steps/purchase_requests TIDAK dibaca sebelum guard', firstFrom < 0 || firstFrom > guardIdx, `guard@${guardIdx} from@${firstFrom}`)
  check('S3c approval_steps hanya disentuh SETELAH guard', (() => {
    const stepIdx = body.indexOf("from('approval_steps')")
    return stepIdx < 0 || stepIdx > guardIdx
  })())
}

// ---------- S4. Alert approval: guard sebelum RPC ----------
{
  const start = telegram.indexOf('export async function sendPrAlert')
  const body = telegram.slice(start, telegram.indexOf('export async function sendCostAlerts'))
  const guardIdx = body.indexOf('approvalGuard(')
  const rpcIdx = body.indexOf('.rpc(')
  check('S4a sendPrAlert memanggil approvalGuard', guardIdx >= 0)
  check('S4b RPC telegram terjadi setelah guard', guardIdx >= 0 && rpcIdx > guardIdx, `guard@${guardIdx} rpc@${rpcIdx}`)
  check('S4c sendCostAlerts (alert biaya, BUKAN approval) tidak diblokir guard', !telegram.slice(telegram.indexOf('export async function sendCostAlerts')).slice(0, 600).includes('approvalGuard('))
}

// ---------- S5. Load path: approval_steps tidak di-query saat OFF ----------
{
  const loadStart = index.indexOf('async function loadAll()')
  const loadBody = index.slice(loadStart, index.indexOf('async function login('))
  check('S5a loadAll memakai isApprovalEnabled()', loadBody.includes('isApprovalEnabled()'))
  check('S5b spec approval_steps bersyarat (spread approvalOn)', /\.\.\.\(approvalOn \? \[\['approvals', 'approval_steps'\]\] : \[\]\)/.test(loadBody))
  check('S5c state approvals dikosongkan saat OFF', loadBody.includes('if (!approvalOn) result.approvals = []'))
}

// ---------- S6. Rute langsung: fallback sebelum render modul ----------
{
  check('S6a approvalBlocked dihitung dari kebijakan', /const approvalBlocked = page === 'approvals' && !isApprovalEnabled\(\)/.test(index))
  check('S6b fallback dirender lebih dulu (approvalBlocked ? ...)', /\{approvalBlocked \? \(/.test(index))
  check('S6c fallback menyediakan jalan keluar ke modul aktif', /Buka Purchase Request/.test(index) && /Buka Pembelian/.test(index))
  const moduleView = read('components/ModuleView.js')
  check('S6d ModuleView punya fallback sendiri (lapis kedua)', /page === 'approvals' && !isApprovalEnabled\(\)/.test(moduleView))
  check('S6e fallback ModuleView tanpa tabel/tombol keputusan', /data-testid="approval-off-fallback"/.test(moduleView))
}

// ---------- S7. Tidak ada hapus/histori approval di jalur aktif ----------
{
  check('S7a hapus approval_steps diblokir saat OFF', /pageTarget === 'approvals' && !isApprovalEnabled\(\)/.test(index))
  check('S7b tidak ada bulk update status PR/approval baru', !/from\('approval_steps'\)\.update\(\{[^}]*status:\s*'APPROVED'/.test(index))
  check('S7c tidak ada delete massal approval_steps di app code', !/from\('approval_steps'\)\.delete\(\)/.test(index))
  check('S7d seed-simulation TIDAK diubah (tetap maintenance-only, bukan jalur app)', /MAINTENANCE_TOKEN/.test(read('pages/api/seed-simulation.js')))
}

// ---------- S8. Reminder: approval_steps tidak dibaca ----------
{
  check('S8a collect.js melewati approval_steps saat OFF', /def\.key === 'approval_steps' && !APPROVAL_MODULE_ENABLED/.test(collect))
  check('S8b collect.js menandai skipped_by_policy (bukan error)', /skipped_by_policy: true/.test(collect))
  check('S8c rules.js menonaktifkan jenis khusus approval',
    /def\.requiresApprovalModule && !approvalModuleEnabled/.test(reminders))
  check('S8d sumber dilewati kebijakan tidak dihitung sebagai degradasi', /policyDisabledSources/.test(reminders))
}

// ---------- S9. Registry: entri tetap ada, ditandai nonaktif ----------
{
  const registry = read('modules/registry.js')
  check('S9a registry masih mendaftarkan id approvals (reversible)', /id: 'approvals'/.test(registry))
  check('S9b registry menandai enabled: false', /id: 'approvals',[\s\S]{0,400}?enabled: false/.test(registry))
}

// ---------- S10. Data lama tidak dihapus dari kode ----------
{
  const approvalsView = read('modules/approvals/view.jsx')
  check('S10a modul approval lama TIDAK dihapus dari repo', approvalsView.length > 1000)
  check('S10b tabel approval_steps masih ada di skema aplikasi (tidak ada DROP)', !/DROP TABLE[^;]*approval_steps/i.test(index + constants + submit))
}

console.log(`\nHASIL STATIC TEST: ${pass} lulus, ${fail} gagal`)
if (fail > 0) {
  console.log('GAGAL: ' + failures.join(' | '))
  process.exit(1)
}
