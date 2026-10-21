// ============================================================
// modules/receivings/receiptCapability.js — probe kemampuan skema (READ-ONLY)
// ============================================================
// Tujuan: aplikasi TIDAK BOLEH mengklaim "tersimpan" untuk dimensi
// (rusak / tujuan per barang / retur / rincian handover) yang belum punya
// tabel di database. Kontrak lengkap: docs/receiving-events-contract.md.
//
// Probe hanya MELAKUKAN SELECT (limit 1). Tidak ada tulisan, tidak ada DDL.
// Status disimpan di memori modul dengan TTL supaya tidak query tiap render,
// dan bisa dipaksa refresh setelah migrasi dijalankan schema owner.
//
// Pemakaian:
//   const cap = await getReceiptCapability()   // { ready, returnReady, ... }
//   const cap = await getReceiptCapability({ force: true })
// ============================================================
import { supabase } from '../../lib/supabaseClient'

// Kolom wajib untuk alur event penerimaan (harus sama dengan migrasi
// 02_receiving_events_physical.sql milik t_03b41644).
export const EVENT_COLUMNS = [
  'id', 'client_event_id', 'receiving_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'unit', 'qty_datang', 'qty_rusak', 'tujuan_ws', 'tujuan_tukang',
  'penerima_tukang', 'retur_status', 'retur_qty', 'discard_confirmed',
  'foto_ref', 'source', 'created_at'
]
export const HANDOVER_ITEM_COLUMNS = [
  'id', 'handover_id', 'receiving_event_id', 'receiving_item_id', 'pr_item_id',
  'item_name', 'qty_diserahkan', 'satuan', 'penerima', 'catatan', 'created_at'
]
// Retur butuh DUA tabel (kasus + baris). Tanpa `return_lines`, riwayat retur
// tidak bisa dibaca → tombol Retur tidak boleh aktif (anti double-retur).
export const RETURN_LINE_COLUMNS = ['id', 'return_case_id', 'receiving_event_id', 'qty']
// View progres: nama kolom WAJIB persis (diprobe oleh form & banner).
export const PROGRESS_COLUMNS = [
  'receiving_item_id', 'qty_datang', 'qty_rusak', 'qty_baik', 'belum_diserahkan',
  'qty_bought', 'qty_arrived', 'qty_handed_over', 'tujuan_tukang'
]

const TTL_MS = 60 * 1000
let cache = null          // { at, value }
let inflight = null

function isMissingTable(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  // PostgREST: PGRST205 = tabel tidak ada di schema cache, 42P01 = undefined_table
  return code === 'PGRST205' || code === '42P01' || /Could not find the table/i.test(msg)
    || /does not exist/i.test(msg)
}

async function probeTable(table, columns) {
  try {
    const { error } = await supabase.from(table).select(columns.join(',')).limit(1)
    if (!error) return { ok: true }
    if (isMissingTable(error)) return { ok: false, reason: `tabel ${table} belum ada` }
    // Kolom hilang (PGRST204 / 42703) → tabel ada tapi versi skema berbeda.
    const code = String(error.code || '')
    if (code === 'PGRST204' || code === '42703' || /column .* does not exist/i.test(error.message || '')) {
      return { ok: false, reason: `kolom ${table} belum lengkap` }
    }
    // Error lain (mis. RLS / permission denied / jaringan) → TIDAK BISA
    // DISIMPULKAN. Dulu ini dianggap sama dengan "tabel belum ada" (LEGACY),
    // padahal tabelnya bisa saja SUDAH ADA dan hanya hak aksesnya kurang —
    // persis keadaan blocker `GRANT SELECT v_receipt_progress`. Menyimpulkan
    // LEGACY di situ berarti menulis dokumen tanpa rincian lalu mengunci
    // selamanya (defect run 212 / BUG-R1). Sekarang ditandai `indeterminate`.
    return { ok: false, reason: `${table}: ${error.message || 'tidak bisa dibaca'}`, indeterminate: true }
  } catch (err) {
    return { ok: false, reason: `${table}: ${err.message}`, indeterminate: true }
  }
}

// Probe utama. Selalu resolve (tidak pernah throw) supaya UI bisa jatuh ke
// mode legacy dengan pesan jujur — TETAPI kegagalan probe ditandai eksplisit
// (`probeFailed`) agar UI tidak menyimpulkan "skema belum ada" dari error yang
// tidak bisa disimpulkan (RLS/jaringan). Lihat `capabilityState`.
export async function getReceiptCapability({ force = false } = {}) {
  if (!supabase) return { ready: false, returnReady: false, events: false, progress: false, probeFailed: true, missing: ['Supabase tidak tersedia'], checkedAt: null }
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inflight) return inflight

  inflight = (async () => {
    const events = await probeTable('receiving_events', EVENT_COLUMNS)
    const handoverItems = await probeTable('handover_items', HANDOVER_ITEM_COLUMNS)
    // Retur WAJIB punya return_lines: tanpa itu riwayat retur tidak terbaca dan
    // retur yang sama bisa dicatat berulang (anti double-retur).
    const returnLines = await probeTable('return_lines', RETURN_LINE_COLUMNS)
    // View progres: WAJIB untuk form READY (prevCum = qty_arrived dari view,
    // bukan quantity_received). Tanpa view, form tidak boleh jalan karena
    // akan menghitung sisa dari qty BELI (bug COMPATIBILITY_CUTOVER #1).
    const progress = await probeTable('v_receipt_progress', PROGRESS_COLUMNS)

    const missing = []
    if (!events.ok) missing.push(events.reason)
    if (!handoverItems.ok) missing.push(handoverItems.reason)
    if (!progress.ok) missing.push(progress.reason)
    if (!returnLines.ok) missing.push(`retur: ${returnLines.reason}`)

    // `ready` = ledger penerimaan + rincian serah terima + read-model progres.
    // `returnReady` = tambahan riwayat retur; tombol Retur hanya aktif bila
    // keduanya ada, karena tanpa `return_lines` retur bisa tercatat ganda.
    const coreReady = events.ok && handoverItems.ok && progress.ok
    // Probe TIDAK KONKLUSIF bila ada objek yang gagal dengan alasan selain
    // "belum ada" (mis. permission denied pada view/tabel). Di keadaan itu UI
    // tidak boleh menyimpulkan apa pun — apalagi menulis.
    //
    // DEFECT run 231 / BUG-T3: dulu `probeFailed = !coreReady && indeterminate`.
    // Artinya kegagalan probe `return_lines` TIDAK PERNAH terlihat begitu ledger
    // inti siap (coreReady true) → `probeFailed:false, ready:true,
    // returnReady:false` → state 'ready' + pesan kosong, dan admin tidak diberi
    // tahu bahwa retur tidak bisa dipakai. Kelas kegagalan yang sama dengan
    // blocker `GRANT SELECT v_receipt_progress`, hanya objeknya berbeda. Sekarang
    // kegagalan non-konklusif pada objek APA PUN ditandai.
    const indeterminate = [events, handoverItems, returnLines, progress].some(p => p.indeterminate)
    const value = {
      ready: coreReady,
      returnReady: coreReady && returnLines.ok,
      events: events.ok,
      handoverItems: handoverItems.ok,
      returnLines: returnLines.ok,
      progress: progress.ok,
      // `ready:false` + `probeFailed:true` = TIDAK DIKETAHUI, bukan LEGACY.
      probeFailed: indeterminate,
      // Dipakai UI untuk membedakan "tabel retur belum dimigrasi" dari
      // "tabel retur ada tetapi TIDAK BISA DIBACA (GRANT/RLS/jaringan)".
      // Keduanya memblokir retur, tetapi hanya yang kedua yang berarti
      // pemeriksaan tidak konklusif — admin harus diberi sebab yang benar.
      returnProbeFailed: !!returnLines.indeterminate,
      missing,
      checkedAt: new Date().toISOString()
    }
    cache = { at: Date.now(), value }
    return value
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

// Dipakai test & setelah migrasi: lupakan hasil probe sebelumnya.
export function resetReceiptCapability() {
  cache = null
  inflight = null
}

// ------------------------------------------------------------
// KEADAAN capability — bukan dua (defect run 212 / BUG-R1 + run 219 + run 231)
// ------------------------------------------------------------
// `null` = probe BELUM SELESAI (frame pertama setiap modal dibuka). Dulu
// keadaan ini diperlakukan sama dengan LEGACY (`ready:false`), dan karena
// `confirmForm` di LEGACY MENULIS header (`status=CONFIRMED` + `diserahkan_at`)
// tanpa satu pun baris `handover_items`, satu klik di jendela probe mengunci
// dokumen selamanya: `handover_confirm` memakai CAS `diserahkan_at IS NULL`,
// jadi rincian per barang tidak akan pernah bisa dicatat untuk dokumen itu.
//
//   unknown  → JANGAN menulis apa pun; tombol tulis DISABLED + label
//              "memeriksa kesiapan skema…"
//   error    → probe gagal (jaringan/RLS): juga JANGAN menulis; minta ulangi
//   partial  → SEBAGIAN objek ledger SUDAH ADA (data per barang sudah tercatat)
//              tetapi read-model/objek lain belum siap. Ini BUKAN LEGACY:
//              memperlakukannya sebagai LEGACY berarti UI memberi tahu admin
//              "fitur belum aktif" padahal datanya ada, lalu aksi borongan
//              menimpa tujuan per barang dan tombol penutup mengunci dokumen
//              tanpa rincian (defect run 219 / BUG-S2). Diperlakukan seperti
//              error: tidak menulis, tombol borongan mati, pesan jujur.
//   legacy   → probe selesai & TIDAK ADA satu pun objek ledger: perilaku lama
//              (header saja) — satu-satunya jalur yang tersisa
//   ready    → ledger inti + layer retur aktif: semua dimensi bisa ditindak-
//              lanjuti
//   ready_no_return → DEFECT run 231 / BUG-T1..T3. Ledger INTI siap
//              (`receiving_events`, `handover_items`, `v_receipt_progress`
//              terbaca) tetapi layer retur BELUM: file `03_return_layer.sql`
//              belum dijalankan, ATAU `return_lines` ada tetapi SELECT-nya
//              ditolak (GRANT/RLS `42501`) — kelas blocker yang sama dengan
//              `GRANT SELECT v_receipt_progress`. Dulu keadaan ini dilaporkan
//              sebagai `'ready'` dengan pesan KOSONG, sehingga panel Bermasalah
//              menawarkan tombol retur yang buntu dan `receiptForm` menjanjikan
//              "retur tersimpan permanen". Sekarang keadaan ini punya nama:
//              pencatatan penerimaan/serah terima TETAP boleh (objeknya ada),
//              tetapi SEMUA jalur retur ditutup dengan sebab yang bisa dibaca.
export const CAP_STATE = {
  UNKNOWN: 'unknown',
  ERROR: 'error',
  PARTIAL: 'partial',
  LEGACY: 'legacy',
  READY_NO_RETURN: 'ready_no_return',
  READY: 'ready'
}

export function capabilityState(cap) {
  if (cap === null || cap === undefined) return CAP_STATE.UNKNOWN
  // Ledger INTI terbukti hidup → tulis penerimaan/serah terima boleh. Kalau
  // layer retur belum siap, keadaan itu PUNYA NAMA SENDIRI (bukan 'ready'),
  // supaya tidak ada satu pun layar yang menyimpulkan "semua siap".
  if (cap.ready) return cap.returnReady === false ? CAP_STATE.READY_NO_RETURN : CAP_STATE.READY
  if (cap.probeFailed) return CAP_STATE.ERROR
  // `partial` HANYA bila ada objek ledger yang benar-benar terbaca. Capability
  // lama/uji yang tidak membawa field ini (undefined) tetap dianggap LEGACY.
  const anyLedgerObject = !!(cap.events || cap.handoverItems || cap.returnLines || cap.progress)
  if (anyLedgerObject) return CAP_STATE.PARTIAL
  return CAP_STATE.LEGACY
}

// Ledger inti siap = penerimaan & serah terima per barang bisa ditulis.
// Retur punya gerbangnya SENDIRI (`returnReady`), karena tabelnya terpisah.
export function coreLedgerReady(cap) {
  const st = capabilityState(cap)
  return st === CAP_STATE.READY || st === CAP_STATE.READY_NO_RETURN
}

// Retur hanya boleh ditawarkan bila RIWAYATNYA bisa dibaca (`return_lines`).
// Tanpa itu retur yang sama bisa dicatat dua kali dan tidak bisa ditindaklanjuti.
export function returnLayerReady(cap) {
  return capabilityState(cap) === CAP_STATE.READY && !!cap?.returnReady
}

// Pesan jujur standar (dipakai UI & form) — tidak pernah mengklaim tersimpan.
export function capabilityMessage(cap) {
  const st = capabilityState(cap)
  if (st === CAP_STATE.READY) return ''
  if (st === CAP_STATE.UNKNOWN) {
    return 'Kesiapan skema masih DIPERIKSA — belum ada data yang ditulis. Tunggu sebentar; tombol simpan aktif setelah pemeriksaan selesai.'
  }
  if (st === CAP_STATE.ERROR) {
    const why = (cap?.missing || []).filter(Boolean).join('; ') || 'tidak diketahui'
    return `Pemeriksaan kesiapan skema GAGAL (${why}). Tidak ada data yang ditulis — tutup lalu buka lagi form ini.`
  }
  if (st === CAP_STATE.PARTIAL) {
    const why = (cap?.missing || []).filter(Boolean).join('; ') || 'objek lain belum siap'
    const ada = [
      cap?.events ? 'catatan penerimaan per barang' : null,
      cap?.handoverItems ? 'rincian serah terima per barang' : null,
      cap?.returnLines ? 'riwayat retur' : null
    ].filter(Boolean).join(', ')
    return `Migrasi skema BELUM LENGKAP: ${ada || 'sebagian objek ledger'} SUDAH ADA dan berisi data, tetapi ${why}. Tidak ada data yang ditulis dari layar ini — jangan pakai aksi borongan (bisa menimpa tujuan per barang). Minta admin menyelesaikan migrasi.`
  }
  if (st === CAP_STATE.READY_NO_RETURN) {
    // DEFECT run 231 / BUG-T3: sebabnya dibedakan — "belum dimigrasi" vs
    // "ADA tetapi TIDAK BISA DIBACA (GRANT/RLS)". Yang kedua bukan salah admin.
    const why = (cap?.missing || []).filter(Boolean).join('; ') || 'tabel retur belum siap'
    const sebab = cap?.returnProbeFailed
      ? `pemeriksaan tabel retur TIDAK BISA DISIMPULKAN (${why}) — biasanya hak akses/RLS`
      : `tabel retur belum ada (${why})`
    return `Penerimaan & serah terima per barang AKTIF dan tersimpan permanen, TETAPI retur BELUM bisa dipakai: ${sebab}. Jangan janjikan retur ke siapa pun dari layar ini; barang rusak tetap tercatat dan akan bisa diretur setelah layer retur siap.`
  }
  const list = (cap?.missing || []).filter(Boolean).join('; ')
  return `Penyimpanan per barang (kondisi/tujuan/retur/rincian serah terima) belum aktif: ${list || 'skema belum tersedia'}. Tidak ada data yang ditulis.`
}
