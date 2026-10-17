// ============================================================
// modules/rap/view.jsx — HALAMAN RAP (Rencana Anggaran Pelaksana)
// ============================================================
// t_71d95cfe (S3/7), diperkeras t_3b877fb5 (temuan Brooklyn P1).
//
// Alur yang ditawarkan (dan HANYA ini):
//   1. Pilih proyek.
//   2. Ambil acuan RAB: tempel/impor JSON RAB & BOQ, ATAU tarik baris WBS
//      Budgeting (read-only, hanya upah — disebut apa adanya di layar).
//   3. Edit qty & harga satuan RENCANA per baris, TANDAI JENIS baris
//      (material baku / pekerjaan / upah), beri label versi.
//   4. Lihat perbandingan RAB vs RAP + LABEL SUMBER ACUAN (harga jual RAB,
//      upah WBS, manual) — tidak ada klaim "apel-vs-apel".
//   5. Ubah status versi (Draft -> Diajukan -> Disetujui/Ditolak) —
//      status ini label kerja LOKAL, bukan persetujuan resmi.
//   6. Susun PRATINJAU payload PR material — hanya baris material baku yang
//      lolos gerbang BOM (material_id + satuan + qty) dan terverifikasi ke
//      master material. Tidak ada penulisan DB.
//   7. Backup / pulihkan draft lewat JSON.
//
// KEJUJURAN YANG DIKUNCI DI UI:
//   * Banner tetap "Draft — belum tersimpan di server" (tidak ada tabel RAP).
//   * Angka RAP selalu berlabel RENCANA, tidak pernah "aktual/realisasi".
//   * Payload PR diberi label "PRATINJAU — BUKAN alokasi resmi, 0 tulisan DB".
//   * Baris pekerjaan/upah TIDAK dipecah otomatis dan TIDAK ditebak menjadi
//     material dari namanya; UI menampilkan penolakan + langkah perbaikan.
//
// File ini tidak mengimpor shell (pages/index.js, ModuleView, CreateModal) —
// arah dependensi tetap shell -> modul. Wiring halaman (registry + satu
// cabang render di pages/index.js) adalah file CORE milik Tech Lead; lihat
// docs/rap-contract.md bagian "Wiring yang dibutuhkan".
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import {
  LINE_KIND,
  LINE_KIND_LABEL,
  MONEY,
  PR_HANDOFF_LABEL,
  RAP_STATUS,
  RAP_STATUS_LABEL,
  buildPrHandoff,
  compareRapToRab,
  formatRupiah,
  lineAmounts,
  materialReadiness,
  normalizeLine,
  rapFromSnapshot,
  rapToSnapshot,
  rapTotals,
  setRapStatus,
  validateRap
} from './model'
import {
  RAP_CAPABILITY,
  loadMaterialsCatalog,
  loadWbsPlans,
  newMaterialLine,
  rabLinesFromBoqPayload,
  rabLinesFromWbsPlans,
  rapLinesFromRab
} from './budgetingBridge'

const STATUS_TONE = {
  DRAFT: { bg: '#f1f2ec', fg: '#4b523a', border: '#d5d9ce' },
  DIAJUKAN: { bg: '#fef3c7', fg: '#92400e', border: '#fde68a' },
  DISETUJUI: { bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
  DITOLAK: { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' },
  DIGANTIKAN: { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
}

const STATE_LABEL = { OVER: 'Lebih', UNDER: 'Kurang', SAME: 'Sama' }

function statusBadge(status) {
  const tone = STATUS_TONE[String(status || '').toUpperCase()] || STATUS_TONE.DRAFT
  return { ...tone, label: RAP_STATUS_LABEL[String(status || '').toUpperCase()] || 'Draft' }
}

function pctText(pct) {
  if (pct === null || pct === undefined) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct}%`
}

// Nilai input yang ditampilkan: nilai MENTAH apa adanya (supaya "-100" tetap
// terlihat "-100" dan tidak berubah jadi 0 di layar).
function rawInputValue(line, field) {
  const rawKey = field + '_raw'
  if (line && Object.prototype.hasOwnProperty.call(line, rawKey) && line[rawKey] !== null && line[rawKey] !== undefined) {
    return String(line[rawKey])
  }
  return line && line[field] !== null && line[field] !== undefined ? String(line[field]) : ''
}

function priceStateHint(state, raw) {
  if (state === MONEY.NEGATIVE) return `ditolak: ${String(raw)} (negatif)`
  if (state === MONEY.NOT_NUMBER) return `ditolak: ${String(raw)} (bukan angka)`
  if (state === MONEY.MISSING) return 'kosong (bukan 0)'
  if (state === MONEY.ZERO) return '0 — belum lengkap'
  return ''
}

export default function RapModule({
  projects = [],
  say,
  // Opsional: bila shell menyediakan navigasi, tombol "Buka Purchase
  // Request" bisa dipakai. Tanpa setPage tombolnya tidak dirender.
  setPage = null,
  // Opsional: untuk label "oleh" pada riwayat status.
  session = null,
  // Diinjeksi harness; default store sesi (lihat modules/rap/store.js).
  initialDraft = null,
  // Opsional (harness/embedding): katalog material siap pakai. Bila tidak
  // diberikan, katalog dibaca dari tabel `materials` (read-only).
  materials: materialsProp = null
}) {
  const actor = (session && session.user && session.user.email) || ''

  const [draft, setDraft] = useState(() => initialDraft || null)
  const [projectId, setProjectId] = useState('')
  const [rabJson, setRabJson] = useState('')
  const [rabError, setRabError] = useState('')
  const [rabInfo, setRabInfo] = useState(null)
  const [wbsError, setWbsError] = useState('')
  const [wbsBusy, setWbsBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [prPreview, setPrPreview] = useState(null)
  const [showPr, setShowPr] = useState(false)
  const [catalog, setCatalog] = useState(() => (Array.isArray(materialsProp) ? materialsProp : []))
  const [catalogError, setCatalogError] = useState('')
  const [catalogBusy, setCatalogBusy] = useState(false)
  const fileRef = useRef(null)

  const activeProjects = useMemo(() => {
    const list = (projects || []).slice()
    list.sort((a, b) => {
      const na = parseInt(a.kode, 10)
      const nb = parseInt(b.kode, 10)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return String(a.kode || '').localeCompare(String(b.kode || ''))
    })
    return list
  }, [projects])

  useEffect(() => {
    if (!projectId && activeProjects.length) setProjectId(activeProjects[0].id)
  }, [activeProjects, projectId])

  // Katalog master material = satu-satunya sumber verifikasi material_id,
  // satuan, dan skala harga. READ-ONLY (satu select).
  useEffect(() => {
    if (Array.isArray(materialsProp)) { setCatalog(materialsProp); return }
    let alive = true
    setCatalogBusy(true)
    loadMaterialsCatalog(supabase).then(res => {
      if (!alive) return
      setCatalogBusy(false)
      if (!res.ok) { setCatalogError(res.error || 'Gagal membaca katalog material.'); return }
      setCatalogError('')
      setCatalog(res.materials || [])
    }).catch(e => {
      if (!alive) return
      setCatalogBusy(false)
      setCatalogError(e.message || 'Gagal membaca katalog material.')
    })
    return () => { alive = false }
  }, [materialsProp])

  const project = useMemo(
    () => activeProjects.find(p => p.id === projectId) || (projects || []).find(p => p.id === projectId) || null,
    [activeProjects, projects, projectId]
  )

  const say_ = useCallback((msg) => {
    setNotice(msg)
    if (typeof say === 'function') say(msg)
  }, [say])

  // ----------------------------------------------------------
  // Aksi: buat draft dari acuan
  // ----------------------------------------------------------
  function buildDraftFromRabLines(rabLines, ref, sourceLabel, extraWarnings = []) {
    if (!project) {
      setRabError('Pilih proyek dulu sebelum membuat RAP.')
      return
    }
    const lines = rapLinesFromRab(rabLines)
    const version = nextDraftVersion()
    const next = {
      id: 'rap-' + Date.now().toString(36),
      version,
      status: RAP_STATUS.DRAFT,
      project_id: project.id,
      project_name: project.name || '',
      project_kode: project.kode || project.code || '',
      rab_reff: (ref && ref.reff) || '',
      rab_revision: (ref && ref.revision) || '',
      rab_source: sourceLabel,
      rab_price_unit: (ref && ref.priceUnit) || '',
      rab_basis: (ref && ref.priceBasis) || '',
      // snapshot acuan RAB (tidak ikut berubah saat rencana diedit)
      rab_lines: (rabLines || []).map(normalizeLine),
      note: '',
      lines: lines.map(normalizeLine),
      history: [{ at: new Date().toISOString(), action: 'DIBUAT', status: RAP_STATUS.DRAFT, by: actor }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      persisted: false,
      persistence: 'DRAFT_ONLY'
    }
    setDraft(next)
    setRabInfo({ source: sourceLabel, ref, warnings: extraWarnings })
    setPrPreview(null)
    setShowPr(false)
    setRabError('')
    say_(`Draft ${version} dibuat dari ${sourceLabel} (${lines.length} baris). Belum tersimpan di server. Baris RAB = pekerjaan; tandai baris material baku bila akan dipakai untuk PR material.`)
  }

  function nextDraftVersion() {
    // Versi hanya label kerja (tidak ada nomor dokumen DB).
    const m = draft && String(draft.version || '').match(/RAP[-\s]?(\d+)/i)
    const n = m ? parseInt(m[1], 10) : 0
    return 'RAP-' + String((Number.isFinite(n) ? n : 0) + 1).padStart(2, '0')
  }

  function importRabJson() {
    setRabError('')
    const raw = String(rabJson || '').trim()
    if (!raw) { setRabError('Tempel dulu JSON RAB & BOQ (Backup JSON dari modul RAB & BOQ).'); return }
    let payload
    try {
      payload = JSON.parse(raw)
    } catch (e) {
      setRabError('JSON RAB tidak terbaca: ' + e.message)
      return
    }
    const result = rabLinesFromBoqPayload(payload)
    if (!result.ok) {
      setRabError(result.problems.join(' '))
      return
    }
    buildDraftFromRabLines(result.lines, result.ref, 'RAB & BOQ (JSON)', result.warnings)
  }

  async function pullWbs() {
    setRabError('')
    setWbsError('')
    if (!project) { setRabError('Pilih proyek dulu.'); return }
    setWbsBusy(true)
    try {
      const res = await loadWbsPlans(supabase, project.id)
      if (!res.ok) { setWbsError(res.error || 'Gagal membaca WBS Budgeting.'); return }
      const built = rabLinesFromWbsPlans(res.plans)
      if (!built.ok) { setWbsError(built.problems.join(' ')); return }
      buildDraftFromRabLines(built.lines, built.ref, 'WBS Budgeting (upah)', built.warnings)
    } finally {
      setWbsBusy(false)
    }
  }

  // ----------------------------------------------------------
  // Aksi: edit baris
  // ----------------------------------------------------------
  function patchLine(id, patch) {
    setDraft(d => {
      if (!d) return d
      return {
        ...d,
        updated_at: new Date().toISOString(),
        lines: d.lines.map(line => (line.id === id ? normalizeLine({ ...line, ...patch }) : line))
      }
    })
    setPrPreview(null)
  }

  // Angka diketik apa adanya: nilai MENTAH disimpan ke `*_raw` supaya
  // "-100" TETAP "-100" (state NEGATIVE, memblokir) dan tidak pernah
  // berubah diam-diam menjadi 0.
  function setLineNumber(id, field, raw) {
    patchLine(id, { [field + '_raw']: raw, [field]: raw })
  }

  function setLineKind(id, kind) {
    patchLine(id, { line_kind: kind })
  }

  function pickMaterial(id, materialId) {
    const m = catalog.find(x => String(x.id) === String(materialId)) || null
    if (!m) {
      patchLine(id, { material_id: null })
      return
    }
    patchLine(id, {
      material_id: m.id,
      item_name: m.name || m.nama || '',
      kode: m.kode || m.code || '',
      unit: String((m.satuan == null ? m.unit : m.satuan) || ''),
      line_kind: LINE_KIND.MATERIAL,
      price_source: 'MANUAL'
    })
  }

  function addManualLine() {
    setDraft(d => {
      if (!d) return d
      const line = normalizeLine({ item_name: '', unit: 'unit', planned_qty: 1, planned_unit_price: 0, rab_qty: 0, rab_unit_price: 0, price_source: 'MANUAL', line_kind: LINE_KIND.UNSPECIFIED })
      return { ...d, lines: [...d.lines, line], updated_at: new Date().toISOString() }
    })
  }

  function addMaterialLine() {
    if (!catalog.length) {
      say_('Katalog master material belum termuat — baris material baku tidak bisa dibuat. ' + (catalogError || ''))
      return
    }
    setDraft(d => {
      if (!d) return d
      const line = newMaterialLine(catalog[0], { qty: 1 })
      return { ...d, lines: [...d.lines, line], updated_at: new Date().toISOString() }
    })
  }

  function removeLine(id) {
    setDraft(d => (d ? { ...d, lines: d.lines.filter(l => l.id !== id), updated_at: new Date().toISOString() } : d))
    setPrPreview(null)
  }

  function setVersion(raw) {
    setDraft(d => (d ? { ...d, version: raw, updated_at: new Date().toISOString() } : d))
  }

  function setStatus(to) {
    if (!draft) return
    // Transisi tetap lewat aturan model (bukan if-else di UI). Draft yang
    // masih punya penghalang tidak boleh diajukan/disetujui.
    const gated = to === RAP_STATUS.DIAJUKAN || to === RAP_STATUS.DISETUJUI
    if (gated) {
      const check = validateRap(draft)
      if (!check.ok) {
        say_(`Tidak bisa ${RAP_STATUS_LABEL[to] || to}: masih ${check.problems.length} penghalang. ${check.problems[0]}`)
        return
      }
    }
    const result = setRapStatus(draft, to, { by: actor })
    if (!result.ok) { say_(result.problem); return }
    setDraft(result.rap)
    say_(`Status ${draft.version} -> ${RAP_STATUS_LABEL[result.rap.status]}. Status ini label kerja LOKAL — BUKAN persetujuan resmi dan BELUM tersimpan di server.`)
  }

  // ----------------------------------------------------------
  // Aksi: handoff PR (menyusun pratinjau payload, bukan menyimpan)
  // ----------------------------------------------------------
  function previewPrHandoff() {
    if (!draft) return
    const result = buildPrHandoff(draft, { project_id: draft.project_id, materials: catalog })
    setPrPreview(result)
    setShowPr(true)
    if (!result.ok) {
      say_(`Pratinjau PR DITOLAK (${result.gate.rejected} baris): ${result.problems[0]}`)
    } else {
      say_(`Pratinjau payload PR disusun untuk ${result.items.length} baris material terverifikasi. Ini BUKAN alokasi resmi dan belum ada yang dibuat — PR dibuat di modul Purchase Request.`)
    }
  }

  // ----------------------------------------------------------
  // Aksi: backup / pulihkan JSON
  // ----------------------------------------------------------
  function downloadSnapshot() {
    if (!draft) return
    try {
      const text = JSON.stringify(rapToSnapshot(draft), null, 2)
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `RAP-${(draft.version || 'draft').replace(/[^\w.-]+/g, '_')}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      say_('Backup JSON diunduh. Ini salinan manual — server tetap tidak menyimpan RAP.')
    } catch (e) {
      say_('Gagal membuat backup JSON: ' + e.message)
    }
  }

  async function restoreSnapshot(file) {
    if (!file) return
    try {
      const text = await file.text()
      const parsed = rapFromSnapshot(text)
      if (!parsed.ok) { say_('Pulihkan gagal: ' + parsed.problem); return }
      setDraft(parsed.rap)
      setRabInfo({ source: 'Pulihkan JSON', ref: { reff: parsed.rap.rab_reff, revision: parsed.rap.rab_revision }, warnings: [] })
      setPrPreview(null)
      say_(`Draft ${parsed.rap.version} dipulihkan dari JSON. Status penyimpanan tetap: belum tersimpan di server.`)
    } catch (e) {
      say_('Pulihkan gagal: ' + e.message)
    }
  }

  // ----------------------------------------------------------
  // Turunan
  // ----------------------------------------------------------
  const totals = useMemo(() => (draft ? rapTotals(draft) : null), [draft])
  const validation = useMemo(() => (draft ? validateRap(draft) : null), [draft])
  const material = useMemo(() => (draft ? materialReadiness(draft) : null), [draft])
  const comparison = useMemo(() => {
    if (!draft) return null
    // Acuan RAB = snapshot `draft.rab_lines` (tidak ikut berubah saat
    // qty/harga rencana diedit), jadi perbandingan tidak bisa "menyusut"
    // hanya karena baris RAP dihapus.
    return compareRapToRab(draft)
  }, [draft])

  const badge = statusBadge(draft && draft.status)
  const baseline = (comparison && comparison.baseline) || (totals && totals.baseline) || null
  const materialOptions = catalog

  return (
    <div className="rap-root" data-testid="rap-root">
      {/* ---------- Banner kejujuran penyimpanan ---------- */}
      <div className="rap-honest" data-testid="rap-persistence-banner">
        <strong>Draft saja — belum tersimpan di server.</strong>
        <span>
          {RAP_CAPABILITY.reason} Backup JSON manual tersedia di bawah; menutup tab menghapus draft ini.
        </span>
      </div>

      {notice && <div className="notice" data-testid="rap-notice">{notice}</div>}

      {/* ---------- Toolbar: proyek + versi + status ---------- */}
      <div className="rap-toolbar">
        <label className="rap-field">
          <span>Proyek</span>
          <select
            data-testid="rap-project"
            data-project-resolved={project ? project.id : 'none'}
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
          >
            {activeProjects.length === 0 && <option value="">— belum ada proyek —</option>}
            {activeProjects.map(p => (
              <option key={p.id} value={p.id}>
                {p.kode ? `[${p.kode}] ` : ''}{p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="rap-field">
          <span>Versi RAP</span>
          <input
            data-testid="rap-version"
            value={(draft && draft.version) || ''}
            placeholder="RAP-01"
            onChange={e => setVersion(e.target.value)}
            disabled={!draft}
          />
        </label>

        <div className="rap-field">
          <span>Status</span>
          <div className="rap-status-row">
            <span
              className="rap-badge"
              data-testid="rap-status-badge"
              style={{ background: badge.bg, color: badge.fg, borderColor: badge.border }}
            >
              {badge.label}
            </span>
            {draft && (
              <div className="rap-status-actions">
                <button type="button" className="outline" data-testid="rap-act-ajukan" onClick={() => setStatus(RAP_STATUS.DIAJUKAN)}>Ajukan</button>
                <button type="button" className="outline" data-testid="rap-act-setujui" onClick={() => setStatus(RAP_STATUS.DISETUJUI)}>Setujui</button>
                <button type="button" className="outline" data-testid="rap-act-tolak" onClick={() => setStatus(RAP_STATUS.DITOLAK)}>Tolak</button>
              </div>
            )}
          </div>
          <span className="rap-muted" data-testid="rap-status-honest">
            Label kerja LOKAL — bukan persetujuan resmi, tidak tersimpan di server.
          </span>
        </div>
      </div>

      {/* ---------- Sumber acuan RAB ---------- */}
      <div className="rap-panel" data-testid="rap-source-panel">
        <div className="rap-panel-head">
          <strong>Sumber acuan RAB</strong>
          <span className="rap-muted">
            {draft
              ? `Acuan: ${draft.rab_source || '—'}${draft.rab_reff ? ` · ${draft.rab_reff}` : ''}${draft.rab_revision ? ` ${draft.rab_revision}` : ''}`
              : 'Belum ada acuan — buat draft dulu.'}
          </span>
        </div>

        <div className="rap-source-grid">
          <div className="rap-source-col">
            <label className="rap-field">
              <span>Tempel JSON RAB &amp; BOQ (Backup JSON dari modul RAB &amp; BOQ)</span>
              <textarea
                data-testid="rap-rab-json"
                rows={4}
                value={rabJson}
                onChange={e => setRabJson(e.target.value)}
                placeholder='{"version":5,"boqReff":"BOQ-001","items":[{"item":"Wardrobe","unit":"unit","qty":2,"price":1500}]}'
              />
            </label>
            <button type="button" className="btn-create-module" data-testid="rap-act-import-rab" onClick={importRabJson}>
              Buat draft dari JSON RAB
            </button>
          </div>

          <div className="rap-source-col">
            <p className="rap-muted">
              Atau tarik baris WBS dari Budgeting. <b>Perhatian:</b> WBS hanya menyimpan
              volume, satuan, dan estimasi <b>upah</b> — belum ada harga material, jadi
              total acuannya BUKAN nilai kontrak penuh.
            </p>
            <button type="button" className="outline" data-testid="rap-act-pull-wbs" onClick={pullWbs} disabled={wbsBusy || !project}>
              {wbsBusy ? 'Membaca WBS…' : 'Ambil baris dari WBS Budgeting'}
            </button>
            {wbsError && <div className="rap-error" data-testid="rap-wbs-error">{wbsError}</div>}
          </div>
        </div>

        {rabError && <div className="rap-error" data-testid="rap-rab-error">{rabError}</div>}
        {rabInfo && rabInfo.warnings && rabInfo.warnings.length > 0 && (
          <ul className="rap-warn-list" data-testid="rap-source-warnings">
            {rabInfo.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </div>

      {/* ---------- Label sumber acuan: apa yang dibandingkan ---------- */}
      {draft && baseline && (
        <div className="rap-baseline" data-testid="rap-baseline">
          <strong data-testid="rap-baseline-label">Sumber acuan: {baseline.label}</strong>
          <span data-testid="rap-baseline-note">{baseline.note}</span>
          <span className="rap-muted" data-testid="rap-baseline-flag">
            Perbandingan biaya-vs-biaya (apel-vs-apel): <b>TIDAK</b> — acuan ini bukan acuan biaya terverifikasi.
          </span>
        </div>
      )}

      {/* ---------- Ringkasan RAB vs RAP ---------- */}
      {draft && totals && (
        <div className="rap-kpi" data-testid="rap-kpi">
          <div className="rap-kpi-card">
            <span className="rap-kpi-lbl">Acuan RAB</span>
            <strong className="rap-kpi-val" data-testid="rap-kpi-rab">{formatRupiah(totals.rabTotal)}</strong>
            <span className="rap-kpi-sub">{baseline ? baseline.label : 'harga acuan'} · {totals.lineCount} baris</span>
          </div>
          <div className="rap-kpi-card">
            <span className="rap-kpi-lbl">Rencana RAP</span>
            <strong className="rap-kpi-val" data-testid="rap-kpi-rap">{formatRupiah(totals.rapTotal)}</strong>
            <span className="rap-kpi-sub">qty × harga satuan rencana</span>
          </div>
          <div className={`rap-kpi-card ${totals.overBudget ? 'rap-kpi-over' : ''}`}>
            <span className="rap-kpi-lbl">Selisih RAP − RAB</span>
            <strong className="rap-kpi-val" data-testid="rap-kpi-diff">
              {formatRupiah(totals.diffAmount)} <small>{pctText(totals.diffPct)}</small>
            </strong>
            <span className="rap-kpi-sub">
              {totals.hasRabBaseline
                ? (totals.overBudget ? '⚠ Rencana MELEBIHI acuan (indikasi margin habis)' : 'Rencana di bawah acuan')
                : 'Tanpa acuan — selisih TIDAK DIKETAHUI'}
            </span>
          </div>
          <div className="rap-kpi-card">
            <span className="rap-kpi-lbl">Baris perlu perhatian</span>
            <strong className="rap-kpi-val" data-testid="rap-kpi-flags">
              {totals.overCount} lebih · {totals.zeroPrice} harga 0 · {totals.invalidPrice} harga tidak valid
            </strong>
            <span className="rap-kpi-sub">
              {comparison ? `${comparison.summary.missingCount} baris RAB belum masuk RAP · ${totals.incomparable} tak sebanding` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* ---------- Tabel baris ---------- */}
      {draft ? (
        <div className="rap-panel">
          <div className="rap-panel-head">
            <strong>Baris pekerjaan — qty &amp; harga satuan RENCANA</strong>
            <div className="rap-head-actions">
              <button type="button" className="outline" data-testid="rap-act-add-material" onClick={addMaterialLine} disabled={!catalog.length}>
                + Baris material (BOM)
              </button>
              <button type="button" className="outline" data-testid="rap-act-add-line" onClick={addManualLine}>+ Baris manual</button>
            </div>
          </div>
          {catalogError && <div className="rap-error" data-testid="rap-catalog-error">{catalogError}</div>}
          <p className="rap-muted" data-testid="rap-kind-honest">
            Jenis baris TIDAK ditebak dari nama barang. Hanya baris bertanda
            <b> Material baku (BOM)</b> yang boleh masuk PR material.
            {catalogBusy ? ' (memuat katalog material…)' : ` Katalog material: ${catalog.length} item.`}
          </p>
          <div className="rap-table-wrap">
            <table className="rap-table" data-testid="rap-lines">
              <thead>
                <tr>
                  <th>Pekerjaan / material</th>
                  <th>Jenis baris</th>
                  <th>Satuan</th>
                  <th className="rap-num">Qty RAB</th>
                  <th className="rap-num">Harga RAB</th>
                  <th className="rap-num">Qty rencana</th>
                  <th className="rap-num">Harga rencana</th>
                  <th className="rap-num">Total rencana</th>
                  <th className="rap-num">vs RAB</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.lines.map(line => {
                  const a = lineAmounts(line)
                  const priceHint = priceStateHint(line.planned_unit_price_state, line.planned_unit_price_raw)
                  return (
                    <tr key={line.id} data-testid={`rap-line-${line.id}`} data-line-kind={line.line_kind}>
                      <td>
                        {line.line_kind === LINE_KIND.MATERIAL ? (
                          <select
                            className="rap-input-name"
                            data-testid={`rap-material-${line.id}`}
                            value={line.material_id == null ? '' : String(line.material_id)}
                            onChange={e => pickMaterial(line.id, e.target.value)}
                          >
                            <option value="">— pilih material —</option>
                            {materialOptions.map(m => (
                              <option key={String(m.id)} value={String(m.id)}>
                                {m.kode ? `[${m.kode}] ` : ''}{m.name || m.nama} ({m.satuan || m.unit || '—'})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="rap-input-name"
                            data-testid={`rap-name-${line.id}`}
                            value={line.item_name}
                            onChange={e => patchLine(line.id, { item_name: e.target.value })}
                            placeholder="Nama pekerjaan"
                          />
                        )}
                        {line.price_source && line.price_source !== 'RAB' && (
                          <span className="rap-src-tag" title="Sumber angka acuan baris ini">{sourceTag(line.price_source)}</span>
                        )}
                      </td>
                      <td>
                        <select
                          className="rap-input-kind"
                          data-testid={`rap-kind-${line.id}`}
                          value={line.line_kind}
                          onChange={e => setLineKind(line.id, e.target.value)}
                        >
                          <option value={LINE_KIND.UNSPECIFIED}>{LINE_KIND_LABEL.UNSPECIFIED}</option>
                          <option value={LINE_KIND.MATERIAL}>{LINE_KIND_LABEL.MATERIAL}</option>
                          <option value={LINE_KIND.WORK_ITEM}>{LINE_KIND_LABEL.WORK_ITEM}</option>
                          <option value={LINE_KIND.LABOR}>{LINE_KIND_LABEL.LABOR}</option>
                        </select>
                      </td>
                      <td>
                        <input
                          className="rap-input-unit"
                          data-testid={`rap-unit-${line.id}`}
                          value={line.unit}
                          onChange={e => patchLine(line.id, { unit: e.target.value })}
                        />
                      </td>
                      <td className="rap-num">{line.rab_qty === null ? '—' : line.rab_qty}</td>
                      <td className="rap-num">{line.rab_unit_price === null ? '—' : formatRupiah(line.rab_unit_price)}</td>
                      <td className="rap-num">
                        <input
                          className="rap-input-num"
                          data-testid={`rap-qty-${line.id}`}
                          value={rawInputValue(line, 'planned_qty')}
                          onChange={e => setLineNumber(line.id, 'planned_qty', e.target.value)}
                        />
                        {priceStateHint(line.planned_qty_state, line.planned_qty_raw) && (
                          <small className="rap-invalid" data-testid={`rap-qty-hint-${line.id}`}>{priceStateHint(line.planned_qty_state, line.planned_qty_raw)}</small>
                        )}
                      </td>
                      <td className="rap-num">
                        <input
                          className="rap-input-num"
                          data-testid={`rap-price-${line.id}`}
                          value={rawInputValue(line, 'planned_unit_price')}
                          onChange={e => setLineNumber(line.id, 'planned_unit_price', e.target.value)}
                        />
                        {priceHint && <small className="rap-invalid" data-testid={`rap-price-hint-${line.id}`}>{priceHint}</small>}
                      </td>
                      <td className="rap-num"><strong>{formatRupiah(a.rapAmount)}</strong></td>
                      <td className={`rap-num rap-state-${a.state}`} data-testid={`rap-diff-${line.id}`}>
                        {formatRupiah(a.diffAmount)}
                        <small>{pctText(a.diffPct)}</small>
                      </td>
                      <td>
                        <button type="button" className="rap-del" title="Hapus baris" data-testid={`rap-del-${line.id}`} onClick={() => removeLine(line.id)}>×</button>
                      </td>
                    </tr>
                  )
                })}
                {draft.lines.length === 0 && (
                  <tr><td colSpan={10} className="rap-empty">Belum ada baris. Buat draft dari JSON RAB / WBS, atau tambah baris material/manual.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rap-panel rap-empty-panel" data-testid="rap-empty">
          <strong>Belum ada draft RAP.</strong>
          <p>Pilih proyek, lalu buat draft dari JSON RAB &amp; BOQ atau dari baris WBS Budgeting.</p>
        </div>
      )}

      {/* ---------- Validasi ---------- */}
      {draft && validation && (
        <div className="rap-panel" data-testid="rap-validation">
          <div className="rap-panel-head">
            <strong>Pemeriksaan draft</strong>
            <span className="rap-muted">{validation.ok ? 'Tidak ada penghalang' : `${validation.problems.length} penghalang`}</span>
          </div>
          {validation.problems.length > 0 && (
            <ul className="rap-error-list" data-testid="rap-validation-problems">
              {validation.problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul className="rap-warn-list" data-testid="rap-validation-warnings">
              {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {validation.problems.length === 0 && validation.warnings.length === 0 && (
            <p className="rap-muted">Semua baris punya qty &gt; 0 dan harga satuan terisi.</p>
          )}
          {material && (
            <p className="rap-muted" data-testid="rap-material-readiness">
              Kesiapan PR material: {material.material} baris material · {material.work_item} pekerjaan · {material.labor} upah · {material.unspecified} belum ditandai.
              {' '}{material.note}
            </p>
          )}
        </div>
      )}

      {/* ---------- Perbandingan vs RAB ---------- */}
      {draft && comparison && (
        <div className="rap-panel" data-testid="rap-compare">
          <div className="rap-panel-head">
            <strong>Perbandingan RAB vs RAP</strong>
            <span className="rap-muted">
              {comparison.summary.overCount} baris lebih mahal · {comparison.summary.missingCount} baris RAB belum masuk RAP
            </span>
          </div>
          <p className="rap-muted" data-testid="rap-compare-basis">
            Acuan: <b>{comparison.baseline.label}</b>. {comparison.baseline.note}
          </p>
          {comparison.missingInRap.length > 0 ? (
            <div className="rap-missing" data-testid="rap-missing">
              <strong>Pekerjaan RAB yang belum ada di RAP:</strong>
              <ul>
                {comparison.missingInRap.map(m => (
                  <li key={m.key}>{m.item_name} ({m.unit || '—'}) — {formatRupiah(m.rabAmount)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rap-muted" data-testid="rap-no-missing">Semua baris RAB sudah tercakup di RAP.</p>
          )}
        </div>
      )}

      {/* ---------- Handoff PR (pratinjau) ---------- */}
      {draft && (
        <div className="rap-panel" data-testid="rap-pr-panel">
          <div className="rap-panel-head">
            <strong>Pratinjau payload PR material</strong>
            <div className="rap-head-actions">
              <button type="button" className="outline" data-testid="rap-act-pr-preview" onClick={previewPrHandoff}>
                Susun pratinjau payload PR
              </button>
              {showPr && setPage && (
                <button type="button" className="outline" data-testid="rap-act-open-pr" onClick={() => setPage('requests')}>
                  Buka modul Purchase Request
                </button>
              )}
            </div>
          </div>
          <p className="rap-muted" data-testid="rap-pr-honest">
            Tombol di atas hanya <b>menyusun pratinjau</b> payload. {PR_HANDOFF_LABEL}. RAP tidak membuat PR,
            tidak mengalokasikan material, dan tidak menulis apa pun ke database — PR tetap dibuat, dialokasikan,
            dan disetujui di modul Purchase Request (nomor PR dari <code>next_pr_number</code>).
          </p>
          <p className="rap-muted" data-testid="rap-pr-gate-rule">
            <b>Gerbang BOM:</b> hanya baris <b>material baku</b> dengan material_id + satuan + qty positif yang
            terverifikasi ke master material yang bisa masuk. Pekerjaan/upah/barang jadi DITOLAK dengan penjelasan —
            tidak dipecah otomatis dan tidak ditebak dari nama barang.
          </p>
          {showPr && prPreview && (
            <div className="rap-pr-preview" data-testid="rap-pr-preview">
              <div className="rap-pr-meta" data-testid="rap-pr-gate">
                Pratinjau (bukan alokasi resmi) · dipilih {prPreview.gate.selected} baris · terverifikasi {prPreview.gate.verified} ·
                ditolak {prPreview.gate.rejected} · katalog {prPreview.gate.catalog_loaded ? `${prPreview.gate.catalog_size} item` : 'BELUM termuat'}
              </div>
              {prPreview.problems.length > 0 && (
                <ul className="rap-error-list" data-testid="rap-pr-problems">
                  {prPreview.problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              )}
              {prPreview.warnings.length > 0 && (
                <ul className="rap-warn-list" data-testid="rap-pr-warnings">
                  {prPreview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <div className="rap-pr-meta" data-testid="rap-pr-meta">
                {prPreview.items.length} item · total rencana {formatRupiah(prPreview.meta.planned_total)} ·
                {' '}penulisan DB: {prPreview.meta.writes} · persetujuan: {prPreview.meta.approval === 'NONE' ? 'TIDAK ADA (draft)' : prPreview.meta.approval}
              </div>
              <p className="rap-muted" data-testid="rap-pr-approval-note">{prPreview.meta.approval_note}</p>
              <p className="rap-muted" data-testid="rap-pr-basis-note">
                Basis acuan payload: {prPreview.meta.rab_basis_label} · perbandingan apel-vs-apel: <b>TIDAK</b>.
              </p>
              <pre className="rap-pre" data-testid="rap-pr-payload">{JSON.stringify({ request: prPreview.request, items: prPreview.items }, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* ---------- Backup / pulihkan ---------- */}
      <div className="rap-panel" data-testid="rap-backup-panel">
        <div className="rap-panel-head"><strong>Backup draft (manual)</strong></div>
        <div className="rap-head-actions">
          <button type="button" className="outline" data-testid="rap-act-backup" onClick={downloadSnapshot} disabled={!draft}>
            Unduh JSON draft
          </button>
          <button type="button" className="outline" data-testid="rap-act-restore" onClick={() => fileRef.current && fileRef.current.click()}>
            Pulihkan dari JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            data-testid="rap-restore-file"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files && e.target.files[0]; if (f) restoreSnapshot(f); e.target.value = '' }}
          />
        </div>
        <p className="rap-muted">Backup JSON adalah salinan manual di komputer Anda, bukan penyimpanan di server.</p>
      </div>

      <style jsx>{`
        .rap-root { display: grid; gap: 14px; min-width: 0; }
        /* Grid/flex item default min-width:auto — tanpa ini, isi panjang
           (mis. payload JSON di <pre>) melebarkan SELURUH halaman di HP. */
        .rap-root > * { min-width: 0; }
        .rap-honest {
          display: grid; gap: 2px; padding: 10px 14px; border-radius: 10px;
          background: #fdfaf2; border: 1px solid #fde68a; color: #7c4a03; font-size: 12.5px;
        }
        .rap-honest strong { font-size: 13px; }
        .rap-honest span { color: #8a6410; }
        .rap-baseline {
          display: grid; gap: 3px; padding: 10px 14px; border-radius: 10px;
          background: #f4f7fb; border: 1px solid #c7d7ea; color: #1e3a5f; font-size: 12.2px;
        }
        .rap-baseline strong { font-size: 12.8px; }
        .rap-toolbar {
          display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;
          background: var(--card-bg, #fff); border: 1px solid var(--border-light, #e0e2db);
          border-radius: 12px; padding: 12px 14px;
        }
        .rap-field { display: grid; gap: 4px; font-size: 11.5px; font-weight: 700; color: #3b504b; }
        .rap-field select, .rap-field input, .rap-field textarea {
          font-weight: 500; font-size: 12.5px; padding: 6px 9px; border-radius: 6px;
          border: 1px solid #cfd3c7; background: #fff; color: #222; min-width: 150px;
        }
        .rap-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .rap-badge {
          display: inline-flex; align-items: center; font-size: 11.5px; font-weight: 700;
          padding: 4px 10px; border-radius: 999px; border: 1px solid transparent;
        }
        .rap-status-actions { display: flex; gap: 6px; }
        .rap-status-actions button { padding: 4px 9px; font-size: 11.5px; }
        .rap-panel {
          background: var(--card-bg, #fff); border: 1px solid var(--border-light, #e0e2db);
          border-radius: 12px; padding: 12px 14px;
        }
        .rap-panel-head {
          display: flex; justify-content: space-between; align-items: center; gap: 10px;
          flex-wrap: wrap; margin-bottom: 10px; font-size: 12.5px;
        }
        .rap-muted { color: var(--text-muted, #6b7280); font-size: 11.8px; line-height: 1.5; margin: 0; }
        .rap-source-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px; }
        @media (max-width: 720px) { .rap-source-grid { grid-template-columns: 1fr; } }
        .rap-source-col { display: grid; gap: 8px; align-content: start; }
        .rap-source-col textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 11.5px; }
        .rap-error {
          margin-top: 8px; padding: 8px 10px; border-radius: 8px; font-size: 12px;
          background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b;
        }
        .rap-error-list { margin: 0; padding-left: 18px; color: #991b1b; font-size: 12px; display: grid; gap: 3px; }
        .rap-warn-list { margin: 6px 0 0; padding-left: 18px; color: #8a6410; font-size: 12px; display: grid; gap: 3px; }
        .rap-kpi { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
        .rap-kpi-card {
          background: var(--card-bg, #fff); border: 1px solid var(--border-light, #e0e2db);
          border-radius: 10px; padding: 10px 12px; display: grid; gap: 2px;
        }
        .rap-kpi-over { border-color: #fca5a5; background: #fff7f7; }
        .rap-kpi-lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; font-weight: 700; }
        .rap-kpi-val { font-size: 16px; font-weight: 800; color: #1f2a26; font-variant-numeric: tabular-nums; }
        .rap-kpi-val small { font-size: 11px; font-weight: 700; color: #6b7280; }
        .rap-kpi-sub { font-size: 11px; color: #777; }
        .rap-table-wrap { overflow-x: auto; }
        .rap-table { width: 100%; border-collapse: collapse; font-size: 12.3px; }
        .rap-table th {
          text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px;
          color: #6b7280; background: #f5f6f2; padding: 8px 10px; border-bottom: 1px solid #e0e2db; white-space: nowrap;
        }
        .rap-table td { padding: 7px 10px; border-bottom: 1px solid #f0f2eb; vertical-align: middle; }
        .rap-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .rap-num small { display: block; font-size: 10px; color: #8b8f88; }
        .rap-invalid { color: #b91c1c !important; font-weight: 700; }
        .rap-state-OVER { color: #b91c1c; font-weight: 700; }
        .rap-state-UNDER { color: #166534; }
        .rap-input-name { min-width: 180px; width: 100%; }
        .rap-input-kind { min-width: 150px; }
        .rap-input-unit { width: 74px; }
        .rap-input-num { width: 96px; text-align: right; }
        .rap-input-name, .rap-input-unit, .rap-input-num, .rap-input-kind {
          font-size: 12.3px; padding: 4px 6px; border: 1px solid #d8dcd0; border-radius: 5px; background: #fff;
        }
        .rap-input-name:focus, .rap-input-unit:focus, .rap-input-num:focus, .rap-input-kind:focus { border-color: #4b523a; outline: none; }
        .rap-src-tag {
          display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 700;
          background: #eef2ea; color: #3b4233; border-radius: 4px; padding: 1px 5px;
        }
        .rap-del {
          border: 1px solid #e5e7eb; background: #fff; color: #9ca3af; border-radius: 5px;
          width: 24px; height: 24px; cursor: pointer; line-height: 1;
        }
        .rap-del:hover { color: #b91c1c; border-color: #fca5a5; }
        .rap-empty { text-align: center; color: #777; padding: 18px; }
        .rap-empty-panel { display: grid; gap: 4px; }
        .rap-missing { font-size: 12px; color: #7c4a03; background: #fdfaf2; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; }
        .rap-missing ul { margin: 4px 0 0; padding-left: 18px; }
        .rap-head-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .rap-pr-preview { display: grid; gap: 8px; margin-top: 8px; }
        .rap-pr-meta { font-size: 11.8px; color: #3b504b; font-weight: 700; }
        .rap-pre {
          margin: 0; max-height: 260px; max-width: 100%; overflow: auto; background: #f7f8f5; border: 1px solid #e0e2db;
          border-radius: 8px; padding: 10px; font-size: 11px; line-height: 1.45; color: #2a3024;
        }
        .rap-table-wrap { overflow-x: auto; max-width: 100%; }
        .rap-pr-preview { min-width: 0; }
        .rap-field { min-width: 0; }
        .rap-field select, .rap-field input, .rap-field textarea { max-width: 100%; }
      `}</style>
    </div>
  )
}

function sourceTag(src) {
  const map = {
    WBS_UPAH: 'acuan WBS (upah saja)',
    WBS_TANPA_UPAH: 'WBS tanpa upah',
    RAB_TANPA_HARGA: 'RAB tanpa harga',
    RAB_HARGA_TIDAK_VALID: 'RAB harga tidak valid',
    MANUAL: 'manual'
  }
  return map[src] || src
}
