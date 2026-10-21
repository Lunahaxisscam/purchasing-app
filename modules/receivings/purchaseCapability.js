// ============================================================
// modules/receivings/purchaseCapability.js — probe kemampuan SIMPAN NOTA
// ============================================================
// Menjawab satu pertanyaan dengan bukti, bukan asumsi:
//   "Apakah alokasi per baris (material/proyek/harga) BISA disimpan
//    secara terstruktur di database ini?"
//
// Kenapa perlu dipisah dari receiptCapability.js:
//   receiptCapability menjawab "apakah ledger FISIK (datang/serah/retur) siap".
//   Pertanyaan ini berbeda: ia menyangkut jalur TULIS NOTA (pembelian).
//   Menggabungkannya akan membuat satu kegagalan tampak seperti kegagalan
//   yang lain — persis kelas defect yang sudah ditutup berkali-kali di card ini.
//
// KONTRAK YANG DIPROBE (diusulkan Bandeng di t_2b8dcab3, belum live):
//   receiving_items.unit_price / material_id / project_id   (typed per baris)
//   receiving_item_allocations(receiving_item_id, project_id, qty, amount)
//   RPC purchase_save_atomic(p_payload jsonb) -> jsonb
//
// KEADAAN (bukan dua):
//   unknown  → probe belum selesai; JANGAN mengklaim apa pun
//   legacy   → kolom/tabel belum ada. Nota TETAP bisa disimpan lewat jalur
//              lama (header + baris + penanda [Harga]), tetapi alokasi
//              per proyek TIDAK tersimpan → UI WAJIB bilang begitu.
//   partial  → kolom ada tetapi tabel alokasi/RPC belum (atau sebaliknya).
//              Jalur atomik TIDAK boleh dipakai; jalur lama tetap jalan
//              dengan label jujur yang sama seperti legacy.
//   ready    → typed + allocations + RPC semuanya terbaca → jalur atomik.
//
// Probe hanya SELECT (limit 1). Tidak ada tulisan, tidak ada DDL.
// ============================================================
import { supabase } from '../../lib/supabaseClient'

export const TYPED_ITEM_COLUMNS = ['id', 'material_id', 'project_id', 'unit_price', 'quantity_received']
export const ALLOCATION_COLUMNS = ['id', 'receiving_item_id', 'project_id', 'qty', 'amount']

export const PURCHASE_CAP = {
  UNKNOWN: 'unknown',
  LEGACY: 'legacy',
  PARTIAL: 'partial',
  READY: 'ready'
}

const TTL_MS = 60 * 1000
let cache = null
let inflight = null

function classify(error) {
  if (!error) return { ok: true }
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  if (code === 'PGRST205' || code === '42P01' || /Could not find the table/i.test(msg)) {
    return { ok: false, missing: true, reason: 'objek belum ada' }
  }
  if (code === 'PGRST204' || code === '42703' || /column .* does not exist/i.test(msg)) {
    return { ok: false, missing: true, reason: 'kolom belum ada' }
  }
  // RLS / GRANT / jaringan → TIDAK BISA DISIMPULKAN. Jangan pernah
  // menyimpulkan "belum ada" dari error yang tidak bisa disimpulkan.
  return { ok: false, indeterminate: true, reason: msg || 'tidak bisa dibaca' }
}

async function probeSelect(table, columns, client) {
  const sb = client || supabase
  if (!sb) return { ok: false, indeterminate: true, reason: 'Supabase tidak tersedia' }
  try {
    const { error } = await sb.from(table).select(columns.join(',')).limit(1)
    return classify(error)
  } catch (err) {
    return { ok: false, indeterminate: true, reason: err.message }
  }
}

// Probe RPC tanpa menulis: kirim payload yang PASTI ditolak validasi
// (`p_payload` kosong). RPC yang benar mengembalikan `{ok:false, reason:...}`
// tanpa menyentuh tabel apa pun. Yang penting bagi kita: APAKAH FUNGSINYA ADA.
//
// RUN 246 — KETAT: "tidak ada error" BUKAN bukti fungsi ada. PostgREST bisa
// menjawab sukses dengan `data: null` (mis. mock/endpoint yang tidak
// mengembalikan apa pun), dan menyimpulkan READY dari itu berarti mengaktifkan
// jalur tulis yang tidak ada — kelas defect yang sama dengan mock yang
// menjawab `[]` untuk tabel tak dikenal (run 188 BUG-4). Bukti yang diterima
// HANYA salah satu dari:
//   (a) `{ok:false, reason:...}` → fungsi benar-benar berjalan & menolak, atau
//   (b) error yang JELAS berasal dari validasi payload (bukan "tidak ada").
async function probeAtomicRpc(client) {
  const sb = client || supabase
  if (!sb) return { ok: false, indeterminate: true, reason: 'Supabase tidak tersedia' }
  try {
    const { data, error } = await sb.rpc('purchase_save_atomic', { p_payload: {} })
    const code = String(error?.code || '')
    const msg = String(error?.message || '')
    if (error) {
      if (code === 'PGRST202' || /Could not find the function/i.test(msg)) {
        return { ok: false, missing: true, reason: 'RPC purchase_save_atomic belum ada' }
      }
      // Fungsi ADA tetapi menolak payload kosong → itu BUKTI fungsi hidup.
      if (code === '22023' || code === '23514' || code === '22P02' || code === '42501'
        || /p_payload|invalid|wajib|required|reason|forbidden/i.test(msg)) {
        // 42501 = fungsi ada tetapi role ini tidak boleh memanggilnya.
        // Untuk capability: fungsi HIDUP, tetapi jalur ini TIDAK bisa dipakai
        // oleh pengguna sekarang → jangan nyalakan jalur atomik.
        if (code === '42501') return { ok: false, indeterminate: true, reason: `akses RPC ditolak (${code})` }
        return { ok: true }
      }
      return { ok: false, indeterminate: true, reason: msg || 'RPC tidak bisa dipanggil' }
    }
    // Tidak ada error: satu-satunya bukti sah adalah RPC menjawab `ok:false`
    // dengan sebab — artinya ia benar-benar berjalan dan menolak payload kosong.
    //
    // PENTING (kontrak v1, catatan Bandeng): `{ok:false,reason:'forbidden'}`
    // BUKAN bukti jalur ini bisa dipakai. Non-admin mendapat jawaban yang sama
    // persis, jadi menerimanya sebagai bukti akan menyalakan jalur atomik untuk
    // pengguna yang RPC-nya akan menolak setiap penulisan. `forbidden` =
    // fungsi hidup tetapi TIDAK bisa dipakai sesi ini → jangan READY.
    if (data && typeof data === 'object' && data.ok === false) {
      const why = String(data.reason || '')
      if (why === 'forbidden') {
        return { ok: false, forbidden: true, indeterminate: true, reason: 'RPC menolak: sesi ini bukan admin (forbidden)' }
      }
      if (!why && !String(data.error || '')) {
        return {
          ok: false,
          indeterminate: true,
          reason: 'RPC menolak tanpa sebab yang bisa dibaca — kesiapan tidak bisa disimpulkan'
        }
      }
      return { ok: true }
    }
    // `data` kosong/null tanpa error = TIDAK BISA DISIMPULKAN. Jangan pernah
    // menyimpulkan READY dari ketiadaan jawaban.
    return {
      ok: false,
      indeterminate: true,
      reason: 'RPC menjawab tanpa hasil yang bisa dibaca — kesiapan tidak bisa disimpulkan'
    }
  } catch (err) {
    return { ok: false, indeterminate: true, reason: err.message }
  }
}

export async function getPurchaseCapability({ force = false, client = null } = {}) {
  const sb = client || supabase
  if (!sb) {
    return {
      // TIDAK bisa disimpulkan ≠ legacy. `legacy` berarti "RPC terbukti tidak
      // ada"; tanpa klien kita tidak membuktikan apa pun, jadi jangan memakai
      // jalur lama atas dasar ketiadaan bukti.
      state: PURCHASE_CAP.PARTIAL, typed: false, allocations: false, atomic: false,
      probeFailed: true, allocationPersisted: false, missing: ['Supabase tidak tersedia'], checkedAt: null
    }
  }
  // Cache hanya untuk klien modul (satu sesi aplikasi). Klien yang disuntikkan
  // (probe/uji) selalu diprobe ulang: menyajikan hasil milik klien lain akan
  // menyimpulkan READY untuk role yang berbeda — persis kesalahan yang
  // ditutup di run ini.
  const injected = !!client
  if (!force && !injected && cache && Date.now() - cache.at < TTL_MS) return cache.value
  if (inflight) return inflight

  inflight = (async () => {
    const typed = await probeSelect('receiving_items', TYPED_ITEM_COLUMNS, sb)
    const allocs = await probeSelect('receiving_item_allocations', ALLOCATION_COLUMNS, sb)
    // RPC hanya diprobe bila objek yang ia tulis SUDAH ada. Memanggil RPC di
    // database yang belum dimigrasi hanya menghasilkan kebisingan, dan
    // kesimpulannya sudah pasti: belum siap.
    const atomic = (typed.ok && allocs.ok)
      ? await probeAtomicRpc(sb)
      : { ok: false, missing: true, reason: 'objek alokasi belum lengkap' }

    const missing = []
    if (!typed.ok) missing.push(`kolom typed: ${typed.reason}`)
    if (!allocs.ok) missing.push(`alokasi: ${allocs.reason}`)
    if (!atomic.ok) missing.push(`atomik: ${atomic.reason}`)

    const indeterminate = !!(typed.indeterminate || allocs.indeterminate || atomic.indeterminate)
    const anyReady = !!(typed.ok || allocs.ok || atomic.ok)

    let state
    if (typed.ok && allocs.ok && atomic.ok) state = PURCHASE_CAP.READY
    else if (anyReady) state = PURCHASE_CAP.PARTIAL
    else if (indeterminate) state = PURCHASE_CAP.PARTIAL // tidak bisa disimpulkan ≠ legacy
    else state = PURCHASE_CAP.LEGACY

    const value = {
      state,
      typed: !!typed.ok,
      allocations: !!allocs.ok,
      atomic: !!atomic.ok,
      // SATU-SATUNYA tanda yang boleh dipakai UI untuk bilang "alokasi
      // tersimpan". Bukan `state === READY` di layar mana pun.
      allocationPersisted: state === PURCHASE_CAP.READY,
      probeFailed: indeterminate,
      // RPC menjawab `forbidden` = sesi ini TIDAK boleh menulis lewat jalur
      // atomik. Jalur multipart juga akan ditolak trigger kontrak v1, jadi
      // pemanggil harus berhenti dengan pesan admin — bukan mencoba jalur lain
      // lalu menampilkan error SQL mentah.
      forbidden: !!atomic.forbidden,
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

export function resetPurchaseCapability() {
  cache = null
  inflight = null
}

// Pesan jujur standar. Tidak pernah menyebut "tersimpan" untuk alokasi
// yang tidak punya tempat di skema.
export function purchaseCapabilityMessage(cap) {
  const st = cap?.state
  if (st === PURCHASE_CAP.READY) return ''
  if (st === PURCHASE_CAP.UNKNOWN || !st) {
    return 'Kesiapan penyimpanan alokasi masih DIPERIKSA — jangan tutup form ini dulu.'
  }
  const why = (cap?.missing || []).filter(Boolean).join('; ')
  if (st === PURCHASE_CAP.PARTIAL) {
    return `Penyimpanan alokasi per proyek BELUM lengkap (${why}). Nota tetap bisa disimpan, `
      + 'tetapi alokasi proyek per barang TIDAK ikut tersimpan — jangan menganggap biaya sudah masuk ke proyek.'
  }
  return `Skema alokasi per proyek belum ada (${why}). Nota tersimpan sebagai catatan pembelian; `
    + 'alokasi proyek per barang TIDAK tersimpan di database.'
}
