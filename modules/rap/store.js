// ============================================================
// modules/rap/store.js — PENYIMPANAN DRAFT RAP (SESI, BUKAN DATABASE)
// ============================================================
// t_71d95cfe (S3/7). Kontrak penyimpanan RAP versi minimum.
//
// KENYATAAN YANG TIDAK BOLEH DISAMARKAN:
//   * Tidak ada tabel `rap_versions` dan tidak ada RPC penyimpanan RAP.
//   * Migrasi sedang dibekukan (arahan DAT), jadi modul ini TIDAK membuat
//     tabel, TIDAK memanggil Supabase untuk menulis, dan TIDAK memakai
//     localStorage sebagai pengganti DB.
//   * Karena itu mode penyimpanan satu-satunya adalah DRAFT_ONLY:
//     draft hidup selama komponen ter-mount (sesi tab), hilang saat tab
//     ditutup, dan setiap dokumen membawa `persisted:false`.
//
// Yang tetap disediakan supaya draft tidak hilang begitu saja: backup JSON
// manual (rapToSnapshot) + pulihkan dari JSON (rapFromSnapshot) — keduanya
// di file model.js dan diuji di harness.
// ============================================================
import { createRapDraft, nextVersionLabel, RAP_STATUS, setRapStatus, validateRap, touchRap } from './model'

export const PERSISTENCE_MODE = 'DRAFT_ONLY'

// Store sesi sederhana: array draft di memori + listener. Dibuat sebagai
// factory (bukan singleton) supaya tiap test mendapat store bersih.
export function createRapStore(options = {}) {
  const now = options.now || (() => new Date().toISOString())
  let drafts = []
  let activeId = null
  const listeners = new Set()
  // Jejak operasi tulis. HARUS selalu kosong: kalau ada yang menulis DB
  // lewat store ini, harness akan menangkapnya.
  const writes = []

  function emit() {
    for (const fn of listeners) {
      try { fn(snapshot()) } catch (e) { /* listener rusak tidak boleh mematikan store */ }
    }
  }

  function snapshot() {
    return {
      mode: PERSISTENCE_MODE,
      drafts: drafts.map(d => ({ ...d })),
      activeId,
      active: drafts.find(d => d.id === activeId) || null,
      writes: writes.slice()
    }
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function createDraft(opts = {}) {
    const version = opts.version || nextVersionLabel(drafts.map(d => d.version))
    const draft = createRapDraft({ ...opts, version, now: now() })
    drafts = [draft, ...drafts]
    activeId = draft.id
    emit()
    return draft
  }

  function replaceActive(patch) {
    if (!activeId) return null
    drafts = drafts.map(d => (d.id === activeId ? touchRap(d, patch, now()) : d))
    const next = drafts.find(d => d.id === activeId) || null
    emit()
    return next
  }

  function selectDraft(id) {
    activeId = drafts.some(d => d.id === id) ? id : null
    emit()
    return snapshot().active
  }

  function removeDraft(id) {
    drafts = drafts.filter(d => d.id !== id)
    if (activeId === id) activeId = drafts.length ? drafts[0].id : null
    emit()
    return snapshot()
  }

  // Transisi status memakai aturan model (bukan if-else liar di UI).
  function changeStatus(to, meta = {}) {
    const active = drafts.find(d => d.id === activeId)
    if (!active) return { ok: false, problem: 'Belum ada draft RAP yang dipilih.' }
    // Menyimpan draft TIDAK mengubah kenyataan penyimpanan: status hanya
    // label kerja internal, bukan bukti persetujuan resmi di server.
    const result = setRapStatus(active, to, { now: now(), by: meta.by || '', note: meta.note || '' })
    if (!result.ok) return result
    drafts = drafts.map(d => (d.id === active.id ? result.rap : d))
    emit()
    return result
  }

  function validation() {
    const active = drafts.find(d => d.id === activeId)
    return validateRap(active)
  }

  function upsertSnapshot(rap) {
    // Dipakai jalur "pulihkan dari JSON": draft hasil impor masuk store,
    // tetap bertanda belum tersimpan di server.
    const existing = drafts.some(d => d.id === rap.id)
    drafts = existing ? drafts.map(d => (d.id === rap.id ? rap : d)) : [rap, ...drafts]
    activeId = rap.id
    emit()
    return rap
  }

  return {
    mode: PERSISTENCE_MODE,
    subscribe,
    snapshot,
    createDraft,
    replaceActive,
    selectDraft,
    removeDraft,
    changeStatus,
    validation,
    upsertSnapshot,
    writes,
    status: RAP_STATUS
  }
}
