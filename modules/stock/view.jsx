// ============================================================
// modules/stock/view.jsx — TAMPILAN "Stok Workshop" (t_02e5f5fd)
// ============================================================
// Read-only. Tidak ada penulisan DB, tidak ada schema baru.
// Sumber data: rows.materials (katalog master) yang SUDAH dimuat
// pages/index.js — tidak ada query tambahan, tidak ada tabel baru.
//
// PRINSIP: jujur. Bila angka stok tidak ada di data, kartu menampilkan
// "Tidak tersedia" — BUKAN 0. Tidak ada angka stok yang diturunkan dari
// status PR / header (arahan Brooklyn). Detail keterbatasan data ada di
// modules/stock/logic.js (DATA_LIMITATIONS) dan dirender di panel bawah.
// ============================================================
import React, { useMemo, useState } from 'react'
import {
  UNAVAILABLE_LABEL,
  PREVIEW_LABEL,
  buildCategoryOptions,
  filterStockRows,
  materialName,
  materialKode,
  materialCategory,
  materialSatuan,
  stockStatus,
  summarizeStock,
  toCsv,
  DATA_LIMITATIONS
} from './logic'

const STATUS_TEXT = {
  UNAVAILABLE: 'Belum ada angka',
  MENIPIS: 'Stok menipis',
  TIDAK_DIPANTAU: 'Terpantau',
  OK: 'Terpantau'
}

function StatusPill({ state }) {
  const cls = state === 'MENIPIS' ? 'st-pill st-pill-warn'
    : state === 'UNAVAILABLE' ? 'st-pill st-pill-muted'
      : 'st-pill st-pill-ok'
  return <span className={cls}>{STATUS_TEXT[state] || state}</span>
}

export default function StockModule({ allMaterials = [] }) {
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)

  const materials = useMemo(
    () => (allMaterials || []).filter(m => materialName(m) !== ''),
    [allMaterials]
  )
  const categories = useMemo(() => buildCategoryOptions(materials), [materials])
  const rows = useMemo(
    () => filterStockRows({ materials, category, query }),
    [materials, category, query]
  )
  const kpi = useMemo(() => summarizeStock(rows), [rows])

  // Kartu dibatasi sampai pengguna menekan "Tampilkan semua" — tampilan
  // ringkas sesuai judul task (halaman bisa berisi ratusan material).
  const VISIBLE = 12
  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE)

  function downloadCsv() {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'stok-workshop.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="st-root" data-testid="stock-root">
      <div className="st-intro">
        <div className="st-intro-copy">
          <strong>Stok Workshop</strong>
          <span>
            Ringkasan bahan di gudang. Angka berasal dari katalog material yang
            sudah masuk gudang — tampilan ini hanya membaca data.
          </span>
        </div>
        <div className="st-header-actions">
          <span className="st-badge-fase">{PREVIEW_LABEL}</span>
          <button type="button" className="st-btn-csv" onClick={downloadCsv}>
            Unduh CSV
          </button>
        </div>
      </div>

      <div className="st-kpi-grid">
        <div className="st-kpi-card">
          <span className="st-kpi-lbl">Material Terfilter</span>
          <b className="st-kpi-val">{kpi.total}</b>
          <small className="st-kpi-sub">dari {materials.length} di katalog</small>
        </div>
        <div className="st-kpi-card">
          <span className="st-kpi-lbl">Ada Angka Stok</span>
          <b className="st-kpi-val st-c-ok">{kpi.adaAngka}</b>
          <small className="st-kpi-sub">current_stock terisi</small>
        </div>
        <div className="st-kpi-card">
          <span className="st-kpi-lbl">Stok Menipis</span>
          <b className="st-kpi-val st-c-warn">{kpi.menipis}</b>
          <small className="st-kpi-sub">BHP di bawah min. stok</small>
        </div>
        <div className="st-kpi-card">
          <span className="st-kpi-lbl">Belum Ada Angka</span>
          <b className="st-kpi-val st-c-muted">{kpi.tanpaAngka}</b>
          <small className="st-kpi-sub">ditandai {UNAVAILABLE_LABEL}</small>
        </div>
      </div>

      <div className="st-toolbar">
        <div className="st-filter-tabs">
          <button
            type="button"
            className={category === 'all' ? 'st-tab active' : 'st-tab'}
            onClick={() => setCategory('all')}
          >
            Semua
          </button>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              className={category === c ? 'st-tab active' : 'st-tab'}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          className="st-search"
          type="search"
          placeholder="Cari nama atau kode material…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <div className="panel empty" data-testid="stock-empty">
          Tidak ada material yang cocok dengan filter ini.
        </div>
      ) : (
        <>
          <div className="st-grid" data-testid="stock-grid">
            {visibleRows.map(m => {
              const st = stockStatus(m)
              return (
                <div className="st-card" key={m.id || materialKode(m) || materialName(m)}>
                  <div className="st-card-head">
                    <div className="st-card-title">
                      {materialKode(m) && (
                        <small className="st-kode">{materialKode(m)}</small>
                      )}
                      <b>{materialName(m)}</b>
                    </div>
                    <StatusPill state={st.state} />
                  </div>
                  <div className="st-card-meta">
                    <span>{materialCategory(m) || 'Tanpa kategori'}</span>
                    {materialSatuan(m) && <span>· {materialSatuan(m)}</span>}
                  </div>
                  <div className="st-card-nums">
                    <div>
                      <small>Stok</small>
                      <b className={st.current === null ? 'st-na' : undefined}>
                        {st.current === null ? UNAVAILABLE_LABEL : st.current}
                      </b>
                    </div>
                    <div>
                      <small>Min.</small>
                      <b className={st.min === null ? 'st-na' : undefined}>
                        {st.min === null ? UNAVAILABLE_LABEL : st.min}
                      </b>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {rows.length > VISIBLE && (
            <div className="st-more">
              <button
                type="button"
                className="outline"
                onClick={() => setExpanded(v => !v)}
              >
                {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua (${rows.length})`}
              </button>
            </div>
          )}
        </>
      )}

      <div className="st-limits" data-testid="stock-limitations">
        <strong>Batasan data (jujur, bukan bug)</strong>
        <ul>
          {DATA_LIMITATIONS.map(t => <li key={t}>{t}</li>)}
        </ul>
      </div>

      <style>{`
        .st-root { padding: 0; }
        .st-intro { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:0 0 16px; }
        .st-intro-copy strong { display:block; font-size:15px; color:var(--text-main); font-weight:700; }
        .st-intro-copy span { display:block; margin-top:3px; font-size:12.5px; color:var(--text-muted); max-width:640px; line-height:1.5; }
        .st-header-actions { display:flex; align-items:center; gap:10px; }
        .st-badge-fase {
          display:inline-flex; align-items:center; font-size:11px; font-weight:700;
          color:#4b523a; background:#f0f1ea; border:1px solid #d5d9ce; border-radius:999px; padding:4px 10px;
        }
        .st-btn-csv {
          background:#4b523a; color:#fff; border:1px solid #3d432e; border-radius:6px;
          padding:7px 14px; font-size:12.5px; font-weight:600; cursor:pointer; transition:all 0.15s;
        }
        .st-btn-csv:hover { background:#3d432e; box-shadow:0 2px 6px rgba(0,0,0,0.12); }

        /* KPI GRID */
        .st-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px; }
        .st-kpi-card {
          background:var(--card-bg, #fff); border:1px solid var(--border-light, #e0e2db);
          border-radius:10px; padding:14px 16px; display:flex; flex-direction:column; gap:2px;
        }
        .st-kpi-lbl { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; }
        .st-kpi-val { font-size:24px; font-weight:700; color:var(--text-main); line-height:1.2; }
        .st-kpi-sub { font-size:11px; color:var(--text-muted); }
        .st-c-ok { color:#15803d; }
        .st-c-warn { color:#b45309; }
        .st-c-muted { color:#6b7280; }

        /* TOOLBAR */
        .st-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
        .st-filter-tabs { display:flex; gap:6px; flex-wrap:wrap; }
        .st-tab {
          border:1px solid var(--border-light, #e0e2db); background:var(--card-bg, #fff);
          color:var(--text-muted); border-radius:999px; padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer;
        }
        .st-tab.active { background:#4b523a; border-color:#3d432e; color:#fff; }
        .st-search {
          border:1px solid var(--border-light, #e0e2db); border-radius:8px; padding:7px 12px;
          font-size:12.5px; min-width:240px; background:var(--card-bg, #fff); color:var(--text-main);
        }

        /* KARTU MATERIAL */
        .st-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; }
        .st-card {
          background:var(--card-bg, #fff); border:1px solid var(--border-light, #e0e2db);
          border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;
        }
        .st-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
        .st-card-title { min-width:0; }
        .st-card-title b { display:block; font-size:13.5px; color:var(--text-main); font-weight:700; }
        .st-kode { display:block; font-size:11px; color:var(--text-muted); font-weight:600; letter-spacing:0.02em; }
        .st-card-meta { display:flex; gap:4px; flex-wrap:wrap; font-size:11.5px; color:var(--text-muted); }
        .st-card-nums { display:flex; gap:18px; border-top:1px dashed var(--border-light, #e0e2db); padding-top:8px; }
        .st-card-nums small { display:block; font-size:10.5px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em; }
        .st-card-nums b { font-size:16px; font-weight:700; color:var(--text-main); }
        .st-na { font-size:12px !important; font-weight:600 !important; color:#9ca3af; }

        /* PILL STATUS */
        .st-pill { display:inline-flex; align-items:center; border-radius:999px; padding:3px 9px; font-size:10.5px; font-weight:700; white-space:nowrap; }
        .st-pill-ok { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; }
        .st-pill-warn { background:#fffbeb; color:#b45309; border:1px solid #fed7aa; }
        .st-pill-muted { background:#f3f4f6; color:#6b7280; border:1px solid #e5e7eb; }

        .st-more { display:flex; justify-content:center; margin-top:14px; }

        /* BATASAN DATA */
        .st-limits {
          margin-top:18px; background:#f7f8f5; border:1px dashed #d5d9ce; border-radius:8px;
          padding:10px 14px; font-size:11.5px; color:#4b523a; line-height:1.6;
        }
        .st-limits strong { display:block; font-size:11.5px; margin-bottom:4px; }
        .st-limits ul { margin:0; padding-left:18px; }
        .st-limits li { margin-bottom:2px; }
      `}</style>
    </div>
  )
}
