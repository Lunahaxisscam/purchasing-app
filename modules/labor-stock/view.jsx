// ============================================================
// modules/labor-stock/view.jsx — DASHBOARD ACTUAL LABOR & STOK
// WORKSHOP (t_62e41e91)
// ============================================================
// Halaman admin-only, READ-ONLY dari sisi DB: tidak ada INSERT/UPDATE,
// tidak ada tabel baru, tidak ada RPC, tidak ada migrasi, tidak ada
// perubahan formula finance.
//
// SATU HALAMAN, DUA BAGIAN:
//   1) ACTUAL LABOR  — upah tukang yang benar-benar tercatat
//      (tukang_projects) vs ESTIMASI (project_plans.labor_cost).
//   2) WORKSHOP STOCK — ringkasan bahan gudang (rows.materials).
//
// ATURAN KEJUJURAN (inti task S5):
//   - Estimasi TIDAK pernah ditulis sebagai aktual, dan aktual tidak
//     pernah ditarik dari estimasi.
//   - Sumber tidak dikirim -> panel "belum tersedia", BUKAN angka 0.
//   - Nilai tidak ada -> "Tidak tersedia", bukan 0.
//   - Filter project & periode + ekspor CSV hanya dari baris yang tampil.
// ============================================================
import React, { useMemo, useState } from 'react'
import {
  UNAVAILABLE_LABEL,
  ESTIMATE_LABEL,
  ACTUAL_LABEL,
  CAPABILITY_COPY,
  sourceCapability,
  laborProjectName,
  laborTukangName,
  projectKey,
  laborPeriodOptions,
  filterLaborRows,
  laborCompleteness,
  summarizeLabor,
  estimateLaborByProject,
  projectNameMap,
  toCsv,
  DATA_LIMITATIONS
} from './logic'
import {
  UNAVAILABLE_LABEL as STOCK_UNAVAILABLE,
  buildCategoryOptions,
  filterStockRows,
  materialName,
  materialKode,
  materialCategory,
  materialSatuan,
  stockStatus,
  summarizeStock
} from '../stock/logic'

const VISIBLE = 12

function rupiahOrNull(n) {
  if (n === null || n === undefined) return UNAVAILABLE_LABEL
  const num = Number(n)
  if (!isFinite(num)) return UNAVAILABLE_LABEL
  const abs = Math.abs(num)
  const s = abs.toLocaleString('id-ID', { maximumFractionDigits: 0 })
  return num < 0 ? `-Rp ${s}` : `Rp ${s}`
}

function textOr(v) {
  const s = String(v ?? '').trim()
  return s === '' ? UNAVAILABLE_LABEL : s
}

const COMPLETENESS_TONE = {
  LENGKAP: 'ls-pill-ok',
  AKTUAL_SAJA: 'ls-pill-info',
  ESTIMASI_SAJA: 'ls-pill-warn',
  KOSONG: 'ls-pill-muted'
}

function downloadCsvFile(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  // jsdom (harness test) tidak punya createObjectURL — unduhan via
  // data: URL, tetap jalan di browser sungguhan dan bisa diuji headless.
  const url = typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(blob)
    : `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

// ------------------------------------------------------------
// BAGIAN 1 — ACTUAL LABOR
// ------------------------------------------------------------
function ActualLaborSection({ actualRows, estimateRows, projects = [] }) {
  const [project, setProject] = useState('all')
  const [period, setPeriod] = useState('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const capability = sourceCapability(actualRows)
  const copy = CAPABILITY_COPY[capability] || CAPABILITY_COPY.empty

  const allRows = useMemo(() => (Array.isArray(actualRows) ? actualRows : []), [actualRows])
  const periods = useMemo(() => laborPeriodOptions(allRows), [allRows])

  // Daftar project untuk filter: hanya nama yang benar-benar ada.
  const projectOptions = useMemo(() => {
    const seen = new Map()
    for (const r of allRows) {
      const n = laborProjectName(r)
      if (n === UNAVAILABLE_LABEL) continue
      const k = projectKey(n)
      if (!seen.has(k)) seen.set(k, n)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'id'))
  }, [allRows])

  const filtered = useMemo(
    () => filterLaborRows({ rows: allRows, project, period, query }),
    [allRows, project, period, query]
  )

  // Estimasi per project hanya dihitung bila host benar-benar mengirim
  // sumber estimasi DAN peta id -> nama project. Tidak ada estimasi yang
  // dikarang, dan estimasi tidak pernah dipakai mengisi angka aktual.
  const estimateMap = useMemo(
    () => (estimateRows === null || estimateRows === undefined ? null : estimateLaborByProject(estimateRows, projectNameMap(projects))),
    [estimateRows, projects]
  )

  const kpi = useMemo(
    () => summarizeLabor({ actualRows: allRows, estimateRows, projectNames: projectNameMap(projects) }),
    [allRows, estimateRows, projects]
  )
  const visible = expanded ? filtered : filtered.slice(0, VISIBLE)

  // Baris tabel: aktual per baris + status kelengkapan vs estimasi.
  const tableRows = useMemo(() => filtered.map(r => {
    const key = projectKey(laborProjectName(r))
    const est = estimateMap ? (estimateMap.get(key)?.estimate ?? null) : null
    const estHasAngka = estimateMap ? estimateMap.get(key)?.adaAngka > 0 : false
    const completeness = laborCompleteness({
      estimate: estHasAngka ? est : null,
      actual: r?.total_upah,
      estimateSent: estimateMap !== null,
      actualSent: true
    })
    return {
      key: r.id || `${laborTukangName(r)}|${laborProjectName(r)}|${key}`,
      tukang: laborTukangName(r),
      project: laborProjectName(r),
      status: textOr(r?.status),
      batch: textOr(r?.batch),
      estimate: estimateMap ? (estHasAngka ? est : null) : null,
      actual: completeness.actual,
      completeness
    }
  }), [filtered, estimateMap])

  const visibleTableRows = expanded ? tableRows : tableRows.slice(0, VISIBLE)

  function downloadCsv() {
    downloadCsvFile('actual-labor.csv', toCsv(filtered))
  }

  return (
    <section className="ls-section" data-testid="labor-section" data-capability={capability}>
      <div className="ls-section-head">
        <div>
          <h2 className="ls-section-title">Actual Labor</h2>
          <p className="ls-section-sub">
            Upah yang benar-benar tercatat (dari catatan tim finance) dibandingkan
            dengan {ESTIMATE_LABEL.toLowerCase()} rencana. Keduanya tidak pernah dijumlahkan.
          </p>
        </div>
        <div className="ls-header-actions">
          <span className="ls-badge">Baca — tidak ada penulisan ke DB</span>
          <button
            type="button"
            className="ls-btn"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            data-testid="labor-csv"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {capability !== 'ready' && (
        <div className={`ls-capability ls-capability--${capability}`} data-testid="labor-capability">
          <strong data-testid="labor-capability-title">{copy.title}</strong>
          <span data-testid="labor-capability-body">{copy.body}</span>
        </div>
      )}

      <div className="ls-kpi-grid">
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Project beraktual</span>
          <b className="ls-kpi-val" data-testid="labor-kpi-projects">{kpi.actualProjects}</b>
          <small className="ls-kpi-sub">project dengan angka upah tercatat</small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Total aktual</span>
          <b className="ls-kpi-val ls-c-ok" data-testid="labor-kpi-actual">
            {kpi.actualProjects === 0 ? UNAVAILABLE_LABEL : rupiahOrNull(kpi.actualTotal)}
          </b>
          <small className="ls-kpi-sub">{kpi.actualRowsAngka} dari {kpi.actualRows} baris punya angka</small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">{ESTIMATE_LABEL} rencana</span>
          <b className="ls-kpi-val ls-c-muted" data-testid="labor-kpi-estimate">
            {kpi.estimateSent
              ? (kpi.estimateProjects === 0 ? UNAVAILABLE_LABEL : rupiahOrNull(kpi.estimateTotal))
              : 'Tidak dikirim'}
          </b>
          <small className="ls-kpi-sub">
            {kpi.estimateSent
              ? `${kpi.estimateProjects} project dari project_plans`
              : 'host tidak mengirim sumber estimasi'}
          </small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Status kelengkapan</span>
          <b className="ls-kpi-val" data-testid="labor-kpi-completeness">
            {capability === 'ready' ? tableRows.filter(t => t.completeness.state === 'LENGKAP').length : '—'}
          </b>
          <small className="ls-kpi-sub">project punya estimasi &amp; aktual</small>
        </div>
      </div>

      <div className="ls-toolbar">
        <label className="ls-field">
          <span>Project</span>
          <select
            value={project}
            onChange={e => setProject(e.target.value)}
            data-testid="labor-filter-project"
          >
            <option value="all">Semua project</option>
            {projectOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="ls-field">
          <span>Periode</span>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            data-testid="labor-filter-period"
          >
            <option value="all">Semua periode</option>
            {periods.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="ls-field ls-field--grow">
          <span>Cari</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Project, tukang, atau status…"
            data-testid="labor-search"
          />
        </label>
      </div>

      {tableRows.length === 0 ? (
        <div className="ls-empty" data-testid="labor-empty">
          {capability === 'unavailable'
            ? 'Sumber upah tukang belum tersedia. Tidak ada angka yang ditampilkan sebagai gantinya.'
            : allRows.length === 0
              ? 'Belum ada catatan upah tukang.'
              : 'Tidak ada baris yang cocok dengan filter ini.'}
        </div>
      ) : (
        <>
          <div className="ls-table-wrap">
            <table className="ls-table" data-testid="labor-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Tukang</th>
                  <th>{ESTIMATE_LABEL}</th>
                  <th>{ACTUAL_LABEL}</th>
                  <th>Selisih</th>
                  <th>Status kelengkapan</th>
                  <th>Periode</th>
                </tr>
              </thead>
              <tbody>
                {visibleTableRows.map(t => (
                  <tr key={t.key} className="ls-row" data-testid={`labor-row-${projectKey(t.project)}`}>
                    <td>{t.project}</td>
                    <td>{t.tukang}</td>
                    <td className="ls-num" data-testid="labor-est">
                      {t.estimate === null ? UNAVAILABLE_LABEL : rupiahOrNull(t.estimate)}
                    </td>
                    <td className="ls-num" data-testid="labor-act">
                      {t.actual === null ? UNAVAILABLE_LABEL : rupiahOrNull(t.actual)}
                    </td>
                    <td className="ls-num" data-testid="labor-diff">
                      {t.completeness.diff === null
                        ? UNAVAILABLE_LABEL
                        : rupiahOrNull(t.completeness.diff)}
                    </td>
                    <td>
                      <span
                        className={`ls-pill ${COMPLETENESS_TONE[t.completeness.state] || 'ls-pill-muted'}`}
                        data-testid="labor-completeness"
                        data-state={t.completeness.state}
                      >
                        {t.completeness.label}
                      </span>
                    </td>
                    <td>{t.batch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tableRows.length > VISIBLE && (
            <button
              type="button"
              className="ls-btn-more"
              onClick={() => setExpanded(v => !v)}
              data-testid="labor-toggle"
            >
              {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${tableRows.length} baris`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------
// BAGIAN 2 — WORKSHOP STOCK
// ------------------------------------------------------------
function WorkshopStockSection({ materials }) {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const capability = sourceCapability(materials)
  const copy = CAPABILITY_COPY[capability] || CAPABILITY_COPY.empty

  const rows0 = useMemo(
    () => (Array.isArray(materials) ? materials : []).filter(m => materialName(m) !== ''),
    [materials]
  )
  const categories = useMemo(() => buildCategoryOptions(rows0), [rows0])
  const rows = useMemo(() => filterStockRows({ materials: rows0, category, query }), [rows0, category, query])
  const kpi = useMemo(() => summarizeStock(rows), [rows])
  const visible = expanded ? rows : rows.slice(0, VISIBLE)

  function downloadCsv() {
    const esc = v => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const head = ['Kode', 'Nama', 'Kategori', 'Satuan', 'Stok', 'Min Stok', 'Status']
    const lines = [head.join(',')]
    for (const m of rows) {
      const st = stockStatus(m)
      lines.push([
        materialKode(m), materialName(m), materialCategory(m), materialSatuan(m),
        st.current === null ? '' : st.current,
        st.min === null ? '' : st.min,
        st.state
      ].map(esc).join(','))
    }
    downloadCsvFile('workshop-stock.csv', lines.join('\n'))
  }

  return (
    <section className="ls-section" data-testid="stock-section" data-capability={capability}>
      <div className="ls-section-head">
        <div>
          <h2 className="ls-section-title">Workshop Stock</h2>
          <p className="ls-section-sub">
            Ringkasan bahan gudang. Angka stok dibaca apa adanya dari katalog
            material — yang tidak ada ditandai &ldquo;{STOCK_UNAVAILABLE}&rdquo;, bukan 0.
          </p>
        </div>
        <div className="ls-header-actions">
          <span className="ls-badge">Baca — tidak ada penulisan ke DB</span>
          <button
            type="button"
            className="ls-btn"
            onClick={downloadCsv}
            disabled={rows.length === 0}
            data-testid="stock-csv"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {capability !== 'ready' && (
        <div className={`ls-capability ls-capability--${capability}`} data-testid="stock-capability">
          <strong>{copy.title}</strong>
          <span>{copy.body}</span>
        </div>
      )}

      <div className="ls-kpi-grid">
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Material terfilter</span>
          <b className="ls-kpi-val" data-testid="stock-kpi-total">{kpi.total}</b>
          <small className="ls-kpi-sub">dari {rows0.length} di katalog</small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Ada angka stok</span>
          <b className="ls-kpi-val ls-c-ok" data-testid="stock-kpi-ada">{kpi.adaAngka}</b>
          <small className="ls-kpi-sub">current_stock terisi</small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Stok menipis</span>
          <b className="ls-kpi-val ls-c-warn" data-testid="stock-kpi-menipis">{kpi.menipis}</b>
          <small className="ls-kpi-sub">BHP di bawah min. stok</small>
        </div>
        <div className="ls-kpi-card">
          <span className="ls-kpi-lbl">Belum ada angka</span>
          <b className="ls-kpi-val ls-c-muted" data-testid="stock-kpi-tanpa">{kpi.tanpaAngka}</b>
          <small className="ls-kpi-sub">ditandai {STOCK_UNAVAILABLE}</small>
        </div>
      </div>

      <div className="ls-toolbar">
        <label className="ls-field ls-field--grow">
          <span>Cari material</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nama atau kode material…"
            data-testid="stock-search"
          />
        </label>
        <label className="ls-field">
          <span>Kategori</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            data-testid="stock-filter-category"
          >
            <option value="all">Semua kategori</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="ls-empty" data-testid="stock-empty">
          {capability === 'unavailable'
            ? 'Sumber material belum tersedia. Tidak ada angka stok yang ditampilkan sebagai gantinya.'
            : rows0.length === 0
              ? 'Belum ada material terdata.'
              : 'Tidak ada material yang cocok dengan filter ini.'}
        </div>
      ) : (
        <>
          <div className="ls-stock-grid" data-testid="stock-grid">
            {visible.map(m => {
              const st = stockStatus(m)
              const tone = st.state === 'MENIPIS' ? 'ls-pill-warn'
                : st.state === 'UNAVAILABLE' ? 'ls-pill-muted' : 'ls-pill-ok'
              const label = st.state === 'MENIPIS' ? 'Stok menipis'
                : st.state === 'UNAVAILABLE' ? 'Belum ada angka' : 'Terpantau'
              return (
                <div className="ls-stock-card" key={m.id || materialKode(m) || materialName(m)}>
                  <div className="ls-stock-card-head">
                    <div className="ls-stock-card-title">
                      {materialKode(m) && <small className="ls-kode">{materialKode(m)}</small>}
                      <b>{materialName(m)}</b>
                    </div>
                    <span className={`ls-pill ${tone}`}>{label}</span>
                  </div>
                  <div className="ls-stock-meta">
                    <span>{materialCategory(m) || 'Tanpa kategori'}</span>
                    {materialSatuan(m) && <span>· {materialSatuan(m)}</span>}
                  </div>
                  <div className="ls-stock-nums">
                    <div>
                      <small>Stok</small>
                      <b className={st.current === null ? 'ls-na' : undefined}>
                        {st.current === null ? STOCK_UNAVAILABLE : st.current}
                      </b>
                    </div>
                    <div>
                      <small>Min.</small>
                      <b className={st.min === null ? 'ls-na' : undefined}>
                        {st.min === null ? STOCK_UNAVAILABLE : st.min}
                      </b>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {rows.length > VISIBLE && (
            <button
              type="button"
              className="ls-btn-more"
              onClick={() => setExpanded(v => !v)}
              data-testid="stock-toggle"
            >
              {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${rows.length} material`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

// ------------------------------------------------------------
// HALAMAN UTAMA
// ------------------------------------------------------------
export default function LaborStockModule({
  rows = {},
  laborRows,
  estimateRows,
  materials,
  say = () => {}
}) {
  // Sumber aktual: prop dulu, lalu rows.tukang_projects.
  const rawLabor = laborRows !== undefined && laborRows !== null
    ? laborRows
    : rows?.tukang_projects
  // Sumber estimasi: prop saja (tidak ditarik dari rows supaya jelas
  // bedanya "tidak dikirim" dari "kosong").
  const rawEstimate = estimateRows !== undefined && estimateRows !== null ? estimateRows : null
  const rawMaterials = materials !== undefined && materials !== null
    ? materials
    : rows?.materials

  const capability = useMemo(() => sourceCapability(rawLabor), [rawLabor])

  function downloadAll() {
    const csvLabor = toCsv(Array.isArray(rawLabor) ? rawLabor : [])
    downloadCsvFile('actual-labor.csv', csvLabor)
  }

  return (
    <div className="ls-root" data-testid="labor-stock-root" data-capability={capability}>
      <div className="ls-intro">
        <div className="ls-intro-copy">
          <strong>Actual Labor &amp; Workshop Stock</strong>
          <span>
            Satu halaman untuk dua hal yang sering tertukar: upah tukang yang
            BENAR-BENAR tercatat (aktual) versus rencana (estimasi), dan ringkasan
            stok bahan workshop. Halaman ini hanya membaca data — tidak menulis ke database,
            tidak mengubah formula finance.
          </span>
        </div>
        <div className="ls-header-actions">
          <span className="ls-badge">Baca — tidak ada penulisan ke DB</span>
          <button
            type="button"
            className="ls-btn"
            onClick={downloadAll}
            disabled={!Array.isArray(rawLabor) || rawLabor.length === 0}
            data-testid="labor-stock-csv"
          >
            Unduh CSV aktual
          </button>
        </div>
      </div>

      <ActualLaborSection actualRows={rawLabor} estimateRows={rawEstimate} projects={rows?.projects || []} />
      <WorkshopStockSection materials={rawMaterials} />

      <div className="ls-limitations" data-testid="labor-stock-limitations">
        <strong>Batasan tampilan ini</strong>
        <ul>
          {DATA_LIMITATIONS.map(l => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </div>
  )
}
