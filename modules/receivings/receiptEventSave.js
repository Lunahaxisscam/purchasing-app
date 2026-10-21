// ============================================================
// modules/receivings/receiptEventSave.js — tulis ledger penerimaan via RPC
// ============================================================
// SATU jalur tulis untuk dimensi per barang (datang/rusak/tujuan/retur):
//   supabase.rpc('receipt_apply_events', { p_receiving_id, p_events, p_meta })
// Tidak pernah insert/update tabel ledger langsung dari client (RLS: tanpa
// policy tulis). Lihat docs/receiving-events-contract.md §2.1.
//
// Mode LEGACY (skema belum ada): fungsi ini TIDAK dipanggil; form tetap
// memblokir submit dengan pesan gap dan nol tulisan.
//
// Idempotensi: client_event_id deterministik (receiptEventLogic) + RPC
// memakai ON CONFLICT DO NOTHING → submit ganda / retry / dua user aman.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { validateEventDrafts, deliverabilityOf } from './receiptEventLogic'

// Bandingkan payload dengan event yang SUDAH tersimpan (berdasarkan
// client_event_id). Dipakai untuk membedakan REPLAY (isian identik → aman,
// RPC idempoten) dari KOREKSI (isian berbeda → RPC akan diam-diam
// mengabaikannya). Lihat komentar di applyReceiptEvents.
//
// Kolom yang dibandingkan = dimensi yang menentukan arti catatan. `foto_ref`
// diperlakukan KHUSUS: form tidak pernah memuat ulang lampiran, jadi submit
// ulang tanpa memilih foto lagi BUKAN koreksi (jangan dituduh konflik), tetapi
// memilih foto BARU pada kedatangan yang sama juga tidak akan tersimpan —
// itu harus dikatakan, bukan didiamkan. Lihat `conditionalFields` di bawah.
const COMPARE_FIELDS = [
  ['qty_datang', 'jumlah datang'],
  ['qty_rusak', 'jumlah rusak'],
  ['tujuan_ws', 'tujuan workshop'],
  ['tujuan_tukang', 'tujuan tukang'],
  ['penerima_tukang', 'nama penerima tukang'],
  ['retur_status', 'penanganan barang rusak'],
  ['retur_qty', 'qty retur'],
  ['discard_confirmed', 'konfirmasi dibuang'],
  ['foto_ref', 'foto bukti']
]

const numEq = (a, b) => {
  const x = a === null || a === undefined || a === '' ? 0 : Number(a)
  const y = b === null || b === undefined || b === '' ? 0 : Number(b)
  if (!isFinite(x) || !isFinite(y)) return String(a ?? '') === String(b ?? '')
  return Math.abs(x - y) < 1e-9
}
const txtEq = (a, b) => String(a ?? '').trim() === String(b ?? '').trim()
const boolEq = (a, b) => !!a === !!b

async function findSameEvents(payload) {
  const ids = payload.map(p => p.client_event_id).filter(Boolean)
  if (!ids.length) return { ok: true, conflicts: [] }
  try {
    const { data, error } = await supabase
      .from('receiving_events')
      .select('id, client_event_id, item_name, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, penerima_tukang, retur_status, retur_qty, discard_confirmed, foto_ref')
      .in('client_event_id', ids)
    if (error) return { ok: false, error: `Tidak bisa memeriksa catatan penerimaan yang sudah ada: ${error.message}` }
    const stored = new Map((data || []).map(r => [r.client_event_id, r]))
    const conflicts = []
    for (const p of payload) {
      const s = stored.get(p.client_event_id)
      if (!s) continue
      const diffs = []
      for (const [field, label] of COMPARE_FIELDS) {
        const a = p[field]
        const b = s[field]
        // Foto: hanya dianggap konflik bila user MEMILIH foto baru
        // (`a` terisi). Submit ulang tanpa memilih foto bukan koreksi — form
        // tidak pernah memuat ulang lampiran lama.
        if (field === 'foto_ref' && !String(a ?? '').trim()) continue
        const same = field === 'penerima_tukang' || field === 'retur_status' || field === 'foto_ref'
          ? txtEq(a, b)
          : field === 'discard_confirmed' ? boolEq(a, b) : numEq(a, b)
        if (!same) diffs.push(label)
      }
      if (diffs.length) {
        const parts = []
        if (!numEq(p.qty_datang, s.qty_datang)) parts.push(`datang ${s.qty_datang}`)
        if (!numEq(p.qty_rusak, s.qty_rusak)) parts.push(`rusak ${s.qty_rusak ?? '—'}`)
        if (!numEq(p.tujuan_ws, s.tujuan_ws) || !numEq(p.tujuan_tukang, s.tujuan_tukang)) {
          parts.push(`tujuan WS ${s.tujuan_ws} / tukang ${s.tujuan_tukang}`)
        }
        if (!txtEq(p.retur_status, s.retur_status)) parts.push(`status rusak ${s.retur_status}`)
        if (!txtEq(p.penerima_tukang, s.penerima_tukang)) parts.push(`penerima ${s.penerima_tukang || '—'}`)
        conflicts.push({
          receiving_event_id: s.id,
          client_event_id: p.client_event_id,
          item_name: s.item_name || p.item_name || '—',
          diffs,
          storedSummary: parts.length ? parts.join(', ') : diffs.join(', ')
        })
      }
    }
    return { ok: true, conflicts }
  } catch (err) {
    return { ok: false, error: `Tidak bisa memeriksa catatan penerimaan yang sudah ada: ${err.message}` }
  }
}

// Panggil RPC. `drafts` = hasil buildEventDrafts (sudah divalidasi UI).
export async function applyReceiptEvents({ receiving, drafts, meta = {}, sisaById = {} } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  const list = Array.isArray(drafts) ? drafts : []
  if (!list.length) return { ok: false, error: 'Tidak ada jumlah datang yang diisi.' }

  const v = validateEventDrafts(list, { sisaById })
  if (!v.ok) return { ok: false, error: v.errors[0], errors: v.errors }

  // Buang field internal (_computed) — payload hanya kolom kontrak.
  const payload = list.map(({ _computed, ...rest }) => rest)

  // ---- KOREKSI vs REPLAY (defect run 199) -------------------------------
  // `client_event_id` deterministik dari (penerimaan, item, kumulatif-sebelum,
  // qty datang). Submit ulang dengan qty datang SAMA tetapi kondisi/tujuan
  // BERBEDA menghasilkan id yang sama, sehingga RPC menjawab
  // `applied=0, already_applied=1` dan perubahan TIDAK tersimpan — sementara
  // pesan UI hanya bilang "sudah pernah tercatat". Admin mengira koreksinya
  // masuk. Di sini isian dibandingkan dengan event tersimpan: identik → replay
  // (aman, tidak digandakan); berbeda → DITOLAK dengan penjelasan, karena
  // kontrak RPC belum punya operasi koreksi (`reversal_of` ada di skema tetapi
  // belum ada RPC-nya). Tidak ada klaim tersimpan untuk data yang tidak ditulis.
  const sameEvent = await findSameEvents(payload)
  if (!sameEvent.ok) return { ok: false, error: sameEvent.error }
  if (sameEvent.conflicts.length) {
    const c = sameEvent.conflicts[0]
    const beda = c.diffs.join(', ')
    return {
      ok: false,
      code: 'CORRECTION_UNSUPPORTED',
      conflicts: sameEvent.conflicts,
      error: `Isian untuk "${c.item_name}" berbeda dari catatan yang sudah tersimpan (${beda}). `
        + 'Koreksi belum didukung: yang tersimpan adalah ' + c.storedSummary + '. '
        + 'Perubahan tidak ditulis — jangan ulangi simpan dengan isian berbeda pada kedatangan yang sama; '
        + 'catat selisihnya sebagai kedatangan baru bila barangnya memang datang lagi.'
    }
  }

  try {
    const { data, error } = await supabase.rpc('receipt_apply_events', {
      p_receiving_id: receiving.id,
      p_events: payload,
      p_meta: meta || {}
    })
    if (error) {
      // Pesan RPC diteruskan apa adanya (mis. over_receipt) — jangan ditelan.
      return { ok: false, error: error.message, code: error.code || null }
    }
    if (!data || data.ok === false) {
      return { ok: false, error: (data && data.error) || 'RPC penerimaan menolak permintaan.', reason: data?.reason || null, data }
    }
    return {
      ok: true,
      applied: data.applied ?? payload.length,
      alreadyApplied: data.already_applied ?? 0,
      eventIds: data.event_ids || [],
      totals: data.item_totals || [],
      raw: data
    }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan penerimaan: ${err.message}` }
  }
}

// Konfirmasi fisik serah terima per item (RPC handover_confirm).
// BUKAN auto-confirm: hanya dipanggil dari aksi eksplisit user.
export async function confirmHandoverLines({ handover, lines } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!handover?.id) return { ok: false, error: 'Data serah terima tidak dikenal.' }
  const list = Array.isArray(lines) ? lines : []
  if (!list.length) return { ok: false, error: 'Tidak ada barang yang diserahkan.' }
  try {
    const { data, error } = await supabase.rpc('handover_confirm', {
      p_handover_id: handover.id,
      p_lines: list
    })
    if (error) return { ok: false, error: error.message }
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'RPC serah terima menolak permintaan.', data }
    return { ok: true, already: !!data.already, inserted: data.inserted ?? list.length, diserahkanAt: data.diserahkan_at || null, raw: data }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan serah terima: ${err.message}` }
  }
}

// Retur dari event rusak (RPC return_create) — TANPA mengetik ulang item/qty.
export async function createReturnCase({ receiving, lines, resolution = 'RETURN', reason = '' } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  if (!receiving?.id) return { ok: false, error: 'Data penerimaan tidak dikenal.' }
  const list = (Array.isArray(lines) ? lines : []).filter(l => Number(l.qty) > 0)
  if (!list.length) return { ok: false, error: 'Tidak ada barang rusak yang bisa diretur.' }
  try {
    const { data, error } = await supabase.rpc('return_create', {
      p_receiving_id: receiving.id,
      p_lines: list.map(l => ({ receiving_event_id: l.receiving_event_id, qty: Number(l.qty), note: l.note || null })),
      p_resolution: resolution,
      p_reason: reason || null
    })
    if (error) return { ok: false, error: error.message }
    if (!data || data.ok === false) return { ok: false, error: (data && data.error) || 'RPC retur menolak permintaan.', data }
    return { ok: true, returnCaseId: data.return_case_id, lines: data.lines || list, raw: data }
  } catch (err) {
    return { ok: false, error: `Gagal menyimpan retur: ${err.message}` }
  }
}

// Baca event + turunan untuk satu penerimaan (read-only).
export async function loadReceivingEvents({ receivingId } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', events: [] }
  if (!receivingId) return { ok: false, error: 'Penerimaan tidak dikenal.', events: [] }
  try {
    const { data, error } = await supabase
      .from('receiving_events')
      .select('id, receiving_id, receiving_item_id, pr_item_id, item_name, unit, qty_datang, qty_rusak, tujuan_ws, tujuan_tukang, penerima_tukang, retur_status, retur_qty, discard_confirmed, created_at')
      .eq('receiving_id', receivingId)
      .order('created_at', { ascending: true })
    if (error) return { ok: false, error: error.message, events: [] }
    return { ok: true, events: data || [] }
  } catch (err) {
    return { ok: false, error: err.message, events: [] }
  }
}

// Baca baris serah terima (untuk prefill "sisa belum diserahkan").
export async function loadHandoverItems({ handoverId } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', items: [] }
  if (!handoverId) return { ok: false, error: 'Handover tidak dikenal.', items: [] }
  try {
    const { data, error } = await supabase
      .from('handover_items')
      .select('id, handover_id, receiving_event_id, receiving_item_id, pr_item_id, item_name, qty_diserahkan, satuan, penerima, catatan, created_at')
      .eq('handover_id', handoverId)
    if (error) return { ok: false, error: error.message, items: [] }
    return { ok: true, items: data || [] }
  } catch (err) {
    return { ok: false, error: err.message, items: [] }
  }
}

// Total qty yang SUDAH diserahkan per event penerimaan (LINTAS semua handover
// dari penerimaan itu) — supaya tidak dobel hitung saat diserahkan bertahap.
export async function loadDeliveredByEvent({ eventIds = [] } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', delivered: {} }
  const ids = (eventIds || []).filter(Boolean)
  if (!ids.length) return { ok: true, delivered: {} }
  try {
    const { data, error } = await supabase
      .from('handover_items')
      .select('receiving_event_id, qty_diserahkan')
      .in('receiving_event_id', ids)
    if (error) return { ok: false, error: error.message, delivered: {} }
    const delivered = {}
    for (const row of data || []) {
      const k = row.receiving_event_id
      if (!k) continue
      delivered[k] = (delivered[k] || 0) + Number(row.qty_diserahkan || 0)
    }
    return { ok: true, delivered }
  } catch (err) {
    return { ok: false, error: err.message, delivered: {} }
  }
}

// ------------------------------------------------------------
// Keterangan SERAH-TERIMA satu penerimaan (defect run 251 / D1)
// ------------------------------------------------------------
// Menggabungkan dua bacaan yang sudah ada (event penerimaan + qty yang sudah
// diserahkan LINTAS dokumen) menjadi satu jawaban: apakah penerimaan ini
// punya barang yang PERNAH ditujukan ke tukang, dan berapa sisa yang masih
// bisa diserahkan.
//
// Dipakai antrean & modal konfirmasi supaya tombol "Tandai Diserahkan" tidak
// ditawarkan untuk penerimaan yang seluruh barangnya ke gudang/workshop —
// kontrak v1 MENOLAK konfirmasi tanpa baris (`empty_lines`) dan menolak
// penulisan header langsung (`physical_rpc_required`), jadi tombol itu pasti
// gagal. Gagal baca = `ok:false` (fail closed: UI tidak menebak).
export async function loadDeliverability({ receivingId } = {}) {
  if (!receivingId) return { ok: false, error: 'Penerimaan tidak dikenal.', deliverability: null }
  const ev = await loadReceivingEvents({ receivingId })
  if (!ev.ok) return { ok: false, error: ev.error, deliverability: null }
  const ids = (ev.events || []).map(e => e.id).filter(Boolean)
  // `loadDeliveredByEvent` butuh id event, jadi memang berurutan — tetapi
  // hasilnya dipakai bersama oleh antrean & modal. Satu permintaan per layar,
  // bukan per render.
  const del = await loadDeliveredByEvent({ eventIds: ids })
  if (!del.ok) return { ok: false, error: del.error, deliverability: null }
  return { ok: true, error: null, deliverability: deliverabilityOf(ev.events || [], del.delivered || {}) }
}

// Total qty yang SUDAH diretur per event penerimaan (dari `return_lines`).
// Modal retur WAJIB memakai ini supaya barang rusak yang sudah pernah diretur
// tidak ditawarkan lagi (anti double-retur — temuan review run 101).
export async function loadReturnedByEvent({ eventIds = [] } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.', returned: {} }
  const ids = (eventIds || []).filter(Boolean)
  if (!ids.length) return { ok: true, returned: {} }
  try {
    const { data, error } = await supabase
      .from('return_lines')
      .select('receiving_event_id, qty')
      .in('receiving_event_id', ids)
    if (error) return { ok: false, error: error.message, returned: {} }
    const returned = {}
    for (const row of data || []) {
      const k = row.receiving_event_id
      if (!k) continue
      returned[k] = (returned[k] || 0) + Number(row.qty || 0)
    }
    return { ok: true, returned }
  } catch (err) {
    return { ok: false, error: err.message, returned: {} }
  }
}
