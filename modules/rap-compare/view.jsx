// ============================================================
// modules/rap-compare/view.jsx — PERBANDINGAN RAB vs RAP vs AKTUAL
// (t_a5ba5f73)
// ============================================================
// Halaman admin-only. READ-ONLY dari sisi DB: tidak ada INSERT/UPDATE,
// tidak ada tabel baru, tidak ada localStorage.
//
// DARI MANA DATANYA (jujur, tidak dikarang):
// - RAB (acuan) : prop `rabItems` (fixture/JSON acuan) atau
//                 rows.boq_items / rows.rab_items bila host sudah
//                 memuatnya. Repo ini saat ini menyimpan RAB di memori
//                 halaman RAB & BOQ (tidak ada tabel boq_items), jadi
//                 kalau tidak ada yang dikirim, modul mengatakan kosong
//                 — tidak pernah menampilkan angka karangan.
// - RAP         : DRAFT yang hidup di state React di komponen ini
//                 (impor acuan), sama sikapnya dengan modules/rap di
//                 repo agent-1-ops: belum tersimpan di server, dan itu
//                 ditulis jelas di layar.
// - AKTUAL      : prop `actualRows` atau rows.receivings +
//                 rows.receiving_items yang sudah dimuat loadAll().
// - PAGU        : prop `pagu` (nilai kontrak/pagu). Tidak dikirim?
//                 statusnya "belum diketahui", bukan 0, bukan "aman".
//
// KEJUJURAN ANGKA (aturan yang tidak boleh dilanggar):
// - AKTUAL hanya dari nota pembelian yang sudah ada. Tidak ada aktual?
//   kolom menampilkan "Belum ada aktual", BUKAN Rp 0.
// - Perbandingan memakai nilai dasar baris (qty x harga satuan), bukan
//   grand total quotation yang sudah kena markup/PPN.
// - Selisih = RAP - RAB (positif = rencana melebihi acuan).
// ============================================================
import React, { useMemo, useState } from 'react'
import { buildComparison, toCsv, readRabLines, detailFor } from './logic'

const DIFF_LABEL = {
  match: 'Sesuai acuan',
  over: 'Melebihi acuan',
  under: 'Di bawah acuan',
  unknown: 'Tidak bisa dihitung'
}

// Label status pagu -> kelas warna + tingkat.
const CEILING_CLASS = {
  none: 'rc-ceil-none',
  unknown: 'rc-ceil-none',
  near: 'rc-ceil-near',
  over: 'rc-ceil-over',
  within: 'rc-ceil-ok'
}

// "Rp 1.500.000" untuk nilai; "—" untuk null. Tidak pernah menampilkan
// Rp 0 untuk data yang tidak ada (itu akan terbaca sebagai "gratis").
// Selisih negatif tetap terbaca benar: "Rp -200.000".
function money(n) {
  if (n === null || n === undefined) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}Rp ${Math.abs(Number(n)).toLocaleString('id-ID')}`
}

// Cari baris RAB untuk satu proyek. Prop `rabItems` diprioritaskan
// karena modul ini mengonsumsi props/fixtures (sesuai spesifikasi
// t_a5ba5f73); bentuk kolom repo (boq_items / rab_items) tetap
// dibaca supaya tidak ada data yang diam-diam terbuang hanya karena
// nama tabelnya beda di satu alur.
function pickRabItems(rows, projectId, rabItems) {
  if (Array.isArray(rabItems) && rabItems.length) return rabItems
  if (!rows) return []
  const pools = [rows.boq_items, rows.rab_items, rows.quotation_items]
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue
    const scoped = pool.filter(it => it && (it.project_id === projectId || !projectId))
    if (scoped.length) return scoped
  }
  return []
}

// Cari nota pembelian untuk satu proyek -> baris aktualnya.
// Prop `actualRows` diprioritaskan (fixture); kalau tidak ada, pakai
// rows.receivings + rows.receiving_items yang sudah dimuat loadAll().
function pickActualItems(rows, projectId, actualRows) {
  if (Array.isArray(actualRows) && actualRows.length) return actualRows
  if (!rows) return []
  const recs = (rows.receivings || []).filter(r => r && (r.project_id === projectId || !projectId))
  if (!recs.length) return []
  const recIds = new Set(recs.map(r => r.id))
  const items = (rows.receiving_items || []).filter(it => it && recIds.has(it.receiving_id))
  return items
}

export default function RapCompareModule({
  rows = {},
  allProjects = [],
  rabItems,
  actualRows,
  pagu,
  say = () => {}
}) {
  const projects = useMemo(
    () => (allProjects || []).filter(p => p && (p.kode || p.code || p.name)),
    [allProjects]
  )
  const [projectId, setProjectId] = useState(projects[0]?.id || '')
  const [draft, setDraft] = useState(null) // { lines: [...], version, status }
  const [expanded, setExpanded] = useState(false)
  const [detailKey, setDetailKey] = useState(null) // baris yang drawer-nya terbuka

  const activeProject = projects.find(p => p.id === projectId) || projects[0] || null

  const rabPool = useMemo(
    () => pickRabItems(rows, activeProject?.id, rabItems),
    [rows, activeProject, rabItems]
  )
  const actualItems = useMemo(
    () => pickActualItems(rows, activeProject?.id, actualRows),
    [rows, activeProject, actualRows]
  )

  const comparison = useMemo(
    () => buildComparison({
      rabJson: { items: rabPool },
      rapLines: draft?.lines || [],
      actualRows: actualItems,
      paguValue: pagu
    }),
    [rabPool, draft, actualItems, pagu]
  )

  // Isi drawer ringkas untuk baris yang dipilih (null = tertutup).
  const detail = useMemo(
    () => detailFor(comparison.rows.find(r => r.key === detailKey) || null),
    [comparison, detailKey]
  )

  const VISIBLE = 10
  const visibleRows = expanded ? comparison.rows : comparison.rows.slice(0, VISIBLE)

  // Draft awal: salin baris RAB jadi titik mulai RAP (qty & harga sama).
  // Ini mengikuti pola modul RAP agent-1-ops (impor acuan -> draft), tapi
  // di sini murni di memori: tidak ada penulisan ke mana pun.
  // Baris diambil dari readRabLines (mentah per baris), BUKAN dari baris
  // comparison yang sudah diagregasi per nama — kalau tidak, dua baris RAB
  // dengan nama sama akan tergabung dan draft jadi kehilangan detail.
  function importRabAsDraft() {
    const lines = readRabLines({ items: rabPool })
      .filter(l => l.qty !== null && l.price !== null)
      .map((l, i) => ({
        id: `rap-${i + 1}`,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        price: l.price
      }))
    if (!lines.length) {
      say('Tidak ada baris RAB lengkap (qty & harga) yang bisa diimpor untuk proyek ini.')
      return
    }
    setDraft({ lines, version: 'RAP-01', status: 'Draft' })
    say('Draft RAP dibuat dari acuan RAB (hanya di memori, belum tersimpan).')
  }

  function downloadCsv() {
    const csv = toCsv(comparison)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `perbandingan-rab-rap-${activeProject?.kode || activeProject?.code || 'proyek'}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rc-root" data-testid="rap-compare-root">
      <div className="rc-intro">
        <div className="rc-intro-copy">
          <strong>Perbandingan RAB vs RAP vs Aktual</strong>
          <span>
            Acuan biaya (RAB) dibandingkan rencana pelaksanaan (RAP) dan belanja
            yang sudah terjadi (nota pembelian). Perbandingan memakai nilai dasar
            baris (qty x harga satuan), bukan total quotation yang sudah kena
            markup/PPN.
          </span>
        </div>
        <div className="rc-header-actions">
          <span className="rc-badge-draft">Draft — belum tersimpan di server</span>
          <button type="button" className="rc-btn-csv" onClick={downloadCsv}>
            Unduh CSV
          </button>
        </div>
      </div>

      <div className="rc-toolbar">
        <label className="rc-field">
          <span>Proyek</span>
          <select
            value={activeProject?.id || ''}
            onChange={e => { setProjectId(e.target.value); setDraft(null) }}
            data-testid="rap-compare-project"
          >
            {projects.length === 0 && <option value="">Tidak ada proyek</option>}
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                [{p.kode || p.code || '-'}] {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rc-btn-import"
          onClick={importRabAsDraft}
          data-testid="rap-compare-import"
        >
          Buat draft RAP dari acuan RAB
        </button>
        {draft && (
          <span className="rc-draft-meta" data-testid="rap-compare-draft-meta">
            {draft.version} · {draft.status} · {draft.lines.length} baris (di memori saja)
          </span>
        )}
      </div>

      <div className="rc-kpi-grid">
        <div className="rc-kpi-card">
          <span className="rc-kpi-lbl">Total RAB (acuan)</span>
          <b className="rc-kpi-val" data-testid="rap-compare-kpi-rab">{money(comparison.totals.rab)}</b>
          <small className="rc-kpi-sub">nilai dasar baris BOQ</small>
        </div>
        <div className="rc-kpi-card">
          <span className="rc-kpi-lbl">Total RAP (rencana)</span>
          <b className="rc-kpi-val" data-testid="rap-compare-kpi-rap">{money(comparison.totals.rap)}</b>
          <small className="rc-kpi-sub">
            {draft ? 'draft di memori' : 'belum ada draft'}
          </small>
        </div>
        <div className="rc-kpi-card">
          <span className="rc-kpi-lbl">Aktual (nota)</span>
          <b
            className={comparison.totals.actual === null ? 'rc-kpi-val rc-c-muted' : 'rc-kpi-val'}
            data-testid="rap-compare-kpi-actual"
          >
            {comparison.totals.actual === null ? 'Belum ada aktual' : money(comparison.totals.actual)}
          </b>
          <small className="rc-kpi-sub" data-testid="rap-compare-actual-note">
            {comparison.honesty.actualLabel}
          </small>
        </div>
        <div className="rc-kpi-card">
          <span className="rc-kpi-lbl">Selisih RAP − RAB</span>
          <b
            className={
              comparison.totals.diff === null ? 'rc-kpi-val rc-c-muted'
                : comparison.totals.diff > 0 ? 'rc-kpi-val rc-c-warn'
                  : 'rc-kpi-val rc-c-ok'
            }
            data-testid="rap-compare-kpi-diff"
          >
            {money(comparison.totals.diff)}
          </b>
          <small className="rc-kpi-sub">positif = rencana melebihi acuan</small>
        </div>
      </div>

      {/* STATUS PAGU (spesifikasi: "warning when planned amount exceeds
          contract/pagu"). Peringatan hanya untuk RAP (rencana) karena
          rencana yang melampaui pagu harus terlihat sebelum uang keluar.
          Tanpa pagu -> status "belum diketahui", bukan "aman". */}
      <div
        className={`rc-ceiling ${CEILING_CLASS[comparison.ceiling.level] || 'rc-ceil-none'}`}
        data-testid="rap-compare-ceiling"
        data-level={comparison.ceiling.level}
        role={comparison.ceiling.level === 'over' ? 'alert' : 'status'}
      >
        <strong data-testid="rap-compare-ceiling-label">{comparison.ceiling.label}</strong>
        <span data-testid="rap-compare-ceiling-msg">{comparison.ceiling.message}</span>
        {comparison.ceiling.hasPagu && (
          <span className="rc-ceiling-nums">
            Pagu {money(comparison.ceiling.pagu)} · Rencana {money(comparison.ceiling.used)}
            {comparison.ceiling.pct !== null && ` · ${comparison.ceiling.pct}% terpakai`}
            {comparison.ceiling.over !== null && ` · melebihi ${money(comparison.ceiling.over)}`}
          </span>
        )}
      </div>

      {comparison.rows.length === 0 ? (
        <div className="panel empty" data-testid="rap-compare-empty">
          Belum ada data yang bisa dibandingkan untuk proyek ini.
        </div>
      ) : (
        <>
          <div className="rc-table-wrap">
            <table className="rc-table" data-testid="rap-compare-table">
              <thead>
                <tr>
                  <th>Pekerjaan</th>
                  <th>Satuan</th>
                  <th className="rc-num">RAB (acuan)</th>
                  <th className="rc-num">RAP (rencana)</th>
                  <th className="rc-num">Aktual (nota)</th>
                  <th className="rc-num">Selisih RAP − RAB</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr
                    key={r.key}
                    data-testid={`rap-compare-line-${r.key}`}
                    className={detailKey === r.key ? 'rc-row-active' : 'rc-row'}
                    onClick={() => setDetailKey(detailKey === r.key ? null : r.key)}
                  >
                    <td>
                      {/* petunjuk visual bahwa baris bisa dibuka detailnya */}
                      <span className="rc-row-open" aria-hidden="true">
                        {detailKey === r.key ? '▾' : '▸'}
                      </span>{' '}
                      {r.name}
                    </td>
                    <td>{r.unit || '—'}</td>
                    <td className="rc-num">{money(r.rab)}</td>
                    <td className="rc-num">{money(r.rap)}</td>
                    <td className="rc-num">
                      {r.actualMissing ? 'Belum ada aktual' : money(r.actual)}
                    </td>
                    <td className="rc-num">{money(r.diff)}</td>
                    <td>
                      <span
                        className={
                          r.diffStatus === 'over' ? 'rc-pill rc-pill-warn'
                            : r.diffStatus === 'under' ? 'rc-pill rc-pill-ok'
                              : r.diffStatus === 'match' ? 'rc-pill rc-pill-ok'
                                : 'rc-pill rc-pill-muted'
                        }
                      >
                        {DIFF_LABEL[r.diffStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {comparison.rows.length > VISIBLE && (
            <button
              type="button"
              className="rc-btn-more"
              onClick={() => setExpanded(v => !v)}
              data-testid="rap-compare-toggle"
            >
              {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${comparison.rows.length} baris`}
            </button>
          )}

          {/* DRAWER RINGKAS (spesifikasi: "compact detail drawer").
              Klik baris tabel -> asal-usul tiap angka untuk baris itu.
              Tidak menambah data baru: hanya menerangkan apa yang sudah
              ditampilkan di tabel dan mana yang memang tidak ada. */}
          {detail && (
            <aside
              className="rc-drawer"
              data-testid="rap-compare-drawer"
              data-row={detail.key}
              aria-label={`Detail baris ${detail.name}`}
            >
              <div className="rc-drawer-head">
                <strong>{detail.name}</strong>
                <button
                  type="button"
                  className="rc-drawer-close"
                  onClick={() => setDetailKey(null)}
                  data-testid="rap-compare-drawer-close"
                  aria-label="Tutup detail"
                >
                  ✕
                </button>
              </div>
              <dl className="rc-drawer-list">
                {detail.sources.map(s => (
                  <div key={s.label} className="rc-drawer-row">
                    <dt>{s.label}</dt>
                    <dd data-present={s.present ? 'yes' : 'no'}>{s.text}</dd>
                  </div>
                ))}
                <div className="rc-drawer-row">
                  <dt>Selisih RAP − RAB</dt>
                  <dd data-present={detail.diff !== null ? 'yes' : 'no'}>{detail.diffText}</dd>
                </div>
              </dl>
              {detail.notes.length > 0 && (
                <ul className="rc-drawer-notes" data-testid="rap-compare-drawer-notes">
                  {detail.notes.map(n => <li key={n}>{n}</li>)}
                </ul>
              )}
            </aside>
          )}
        </>
      )}

      <div className="rc-coverage" data-testid="rap-compare-coverage">
        <strong>Yang belum lengkap</strong>
        <ul>
          <li data-testid="rap-compare-cov-rabonly">
            {comparison.coverage.rabOnly} baris RAB belum masuk rencana RAP.
          </li>
          <li data-testid="rap-compare-cov-raponly">
            {comparison.coverage.rapOnly} baris RAP di luar acuan RAB.
          </li>
          <li data-testid="rap-compare-cov-actual">
            {comparison.coverage.actualWithoutPlan} belanja nyata tanpa acuan RAB maupun RAP.
          </li>
          <li data-testid="rap-compare-cov-missing">
            {comparison.coverage.missingActual} baris berencana belum ada aktualnya.
          </li>
        </ul>
      </div>

      <div className="rc-limitations">
        <strong>Batasan tampilan ini</strong>
        <ul>
          <li>
            Draft RAP hanya hidup di memori halaman — belum tersimpan di server, tidak
            ada tabel atau migrasi baru, dan tidak memakai localStorage.
          </li>
          <li>
            Aktual dihitung dari nota pembelian yang sudah diterima. Baris yang belum
            punya nota ditandai &ldquo;Belum ada aktual&rdquo;, bukan Rp 0.
          </li>
          <li>
            Baris dicocokkan berdasarkan nama pekerjaan (huruf besar/kecil dan spasi
            diabaikan). Nama yang berbeda tipis akan jadi baris terpisah.
          </li>
          <li>
            Nilai pagu/kontrak hanya dipakai bila dikirim ke halaman ini. Tidak
            ada pagu? statusnya &ldquo;Pagu belum diketahui&rdquo; — bukan 0 dan
            bukan &ldquo;aman&rdquo;.
          </li>
          <li>
            Harga jual quotation (markup, PPN) tidak ikut dibandingkan — hanya biaya
            dasar pelaksanaan per baris.
          </li>
        </ul>
      </div>
    </div>
  )
}
