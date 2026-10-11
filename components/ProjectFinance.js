import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { rupiah, persen, formatDateTime, timeAgo, normalizeStatus, planningStatusStyle } from '../lib/constants'

// ============================================================
// Modul PROJECT FINANCE — khusus role admin (READ-ONLY).
// Monitoring keuangan PER PROYEK ON-GOING dengan 3 komponen:
//   💰 Revenue  — nilai kontrak proyek (sync REV PROJECT.xlsx via Drive)
//   👷 Tukang   — estimasi upah dari modul Project Planning (project_plans)
//   🧱 Material — cost material (sync REKAP COST 2026) + rincian pengadaan
//                 internal (estimasi PR vs purchase riil dari nota)
// Plus kartu ringkasan: Margin = Revenue − (Material + Petty Cash + Tukang),
// konsisten dengan formula modul Closing Proyek.
// TIDAK ada input di modul ini — semua angka berasal dari sumbernya
// (Google Drive sync & modul Planning). Jangan tambahkan form tulis di sini
// tanpa permintaan eksplisit dari user.
// ============================================================

function parseNominalFromNote(note) {
  const s = String(note || '')
  const m = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const digits = m[1].replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

export default function ProjectFinance({ rows }) {
  const [projectId, setProjectId] = useState('')
  const [view, setView] = useState('revenue')
  // Data dari tabel admin-only (RLS) — dimuat saat komponen dibuka.
  const [driveRows, setDriveRows] = useState([])
  const [plans, setPlans] = useState([])
  const [sync, setSync] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const activeProjects = useMemo(
    () => (rows.projects || []).filter(p => normalizeStatus(p.status) !== 'DONE'),
    [rows]
  )

  // Pilih proyek pertama otomatis supaya halaman langsung terisi.
  useEffect(() => {
    if (!projectId && activeProjects.length) setProjectId(activeProjects[0].id)
  }, [activeProjects, projectId])

  const load = useCallback(async (silent = false) => {
    if (!supabase) return
    if (!silent) setLoading(true)
    setError('')
    try {
      const [costRes, plansRes, syncRes] = await Promise.all([
        supabase.from('project_cost_summary').select('*').order('project_no', { ascending: true }),
        supabase.from('project_plans').select('*').order('created_at', { ascending: true }),
        supabase.from('sync_status').select('*').eq('id', 'rekap_cost').maybeSingle()
      ])
      const errs = []
      if (costRes.error) errs.push(costRes.error.message)
      else setDriveRows(costRes.data || [])
      if (plansRes.error) errs.push(plansRes.error.message)
      else setPlans(plansRes.data || [])
      if (!syncRes.error && syncRes.data) setSync(syncRes.data)
      if (errs.length) setError(errs.join('; '))
    } catch (e) {
      setError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const project = activeProjects.find(p => p.id === projectId) || null

  // Baris cost dari Drive yang cocok dengan kode proyek ini.
  const drive = useMemo(() => {
    if (!project) return null
    const key = String(project.kode || '').trim()
    if (!key) return null
    return driveRows.find(d => String(d.project_no || '').trim() === key) || null
  }, [project, driveRows])

  // 👷 Tukang — item pekerjaan (WBS) proyek ini dari modul Planning.
  const laborRows = useMemo(
    () => plans.filter(pl => pl.project_id === projectId),
    [plans, projectId]
  )
  const laborTotal = useMemo(
    () => laborRows.reduce((s, pl) => s + (Number(pl.labor_cost) || 0), 0),
    [laborRows]
  )

  // 🧱 Material — rincian pengadaan internal proyek ini: estimasi PR vs
  // purchase riil (nominal dari nota penerimaan), per nomor PR.
  const materialPrRows = useMemo(() => {
    if (!project) return []
    const prs = (rows.requests || []).filter(pr => pr.project_id === project.id)
    const prItems = rows.pr_items || []
    const receivings = rows.receivings || []
    return prs.map(pr => {
      const items = prItems.filter(it => it.pr_id === pr.id)
      const est = items.reduce((sum, it) => {
        const p = Number(it.estimated_price)
        const q = Number(it.quantity)
        if (!isFinite(p) || p <= 0) return sum
        return sum + p * (isFinite(q) && q > 0 ? q : 1)
      }, 0)
      let real = null
      for (const r of receivings.filter(r => r.purchase_request_id === pr.id)) {
        const n = parseNominalFromNote(r.note)
        if (n !== null) real = (real || 0) + n
      }
      return {
        id: pr.id,
        pr_number: pr.pr_number || '—',
        title: pr.title || '—',
        status: pr.status || '—',
        est,
        real,
        diff: (real !== null && est > 0) ? real - est : null
      }
    }).sort((a, b) => String(a.pr_number).localeCompare(String(b.pr_number), 'id', { numeric: true }))
  }, [rows, project])

  const materialPrTotals = useMemo(() => {
    const est = materialPrRows.reduce((s, p) => s + p.est, 0)
    const real = materialPrRows.reduce((s, p) => s + (p.real || 0), 0)
    return { est, real, count: materialPrRows.length }
  }, [materialPrRows])

  // Ringkasan margin — formula sama dengan Closing Proyek:
  // Margin = Revenue − (Material + Petty Cash + Tukang).
  const summary = useMemo(() => {
    const revenue = Number(drive?.revenue) || 0
    const material = Number(drive?.cumulative_cost) || 0
    const petty = Number(drive?.petty_cash) || 0
    const labor = Math.round(laborTotal)
    const total = material + petty + labor
    const margin = revenue - total
    // Pembulatan sebelum dibandingkan (pitfall uang: 43300000*0.7 = 30309999.99…).
    const target = Math.round(revenue * 70) / 100
    return {
      revenue, material, petty, labor, total, margin,
      marginPct: revenue > 0 ? (margin / revenue) * 100 : null,
      target,
      underBudget: revenue > 0 ? total <= target : null
    }
  }, [drive, laborTotal])

  const hasDriveData = !!(drive && (summary.revenue > 0 || summary.material > 0))

  return (
    <>
      {/* Toolbar: pilih proyek on-going */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#3b504b' }}>
            Proyek On-Going ({activeProjects.length})
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              style={{ minWidth: '280px', padding: '9px 13px', fontSize: '13px' }}
            >
              {activeProjects.length === 0 && <option value="">— belum ada proyek on-going —</option>}
              {activeProjects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.kode ? `[${p.kode}] ` : ''}{p.name}
                </option>
              ))}
            </select>
          </label>
          {project && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge status-APPROVED" style={{ fontSize: '11px' }}>
                {project.kode ? `[${project.kode}] ` : ''}{project.name}
              </span>
              <span className="badge status-DRAFT" style={{ fontSize: '11px' }}>{project.status || '—'}</span>
            </div>
          )}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="outline" onClick={() => load(false)} style={{ padding: '9px 14px', fontSize: '13px' }}>
            ↻ Muat Ulang
          </button>
        </div>
      </div>

      {error && (
        <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>
          Gagal memuat sebagian data: {error}
        </div>
      )}

      {loading ? (
        <div className="panel empty">Memuat data keuangan proyek…</div>
      ) : !project ? (
        <div className="panel empty">Belum ada proyek on-going. Tambahkan / aktifkan proyek dulu di modul Projects.</div>
      ) : (
        <>
          {/* Kartu ringkasan 4 komponen */}
          <div className="cards">
            <div className="card" title="Nilai kontrak proyek — sumber: REV PROJECT.xlsx via sync Google Drive">
              <span>💰 Revenue</span>
              <strong style={{ fontSize: '22px' }}>{summary.revenue > 0 ? rupiah(summary.revenue) : '—'}</strong>
              <small>{summary.revenue > 0 ? 'nilai kontrak (REV PROJECT)' : 'belum ada data revenue di Drive'}</small>
            </div>
            <div className="card" title="Total estimasi upah tukang dari modul Project Planning">
              <span>👷 Biaya Tukang</span>
              <strong style={{ fontSize: '22px' }}>{laborRows.length ? rupiah(summary.labor) : '—'}</strong>
              <small>{laborRows.length ? `${laborRows.length} item pekerjaan (Planning)` : 'belum ada item pekerjaan di Planning'}</small>
            </div>
            <div className="card" title="Cost material kumulatif — sumber: REKAP COST 2026 via sync Google Drive">
              <span>🧱 Material</span>
              <strong style={{ fontSize: '22px' }}>{drive ? rupiah(summary.material) : '—'}</strong>
              <small>
                {drive
                  ? `REKAP COST${summary.petty > 0 ? ` · Petty Cash ${rupiah(summary.petty)}` : ''}`
                  : 'belum ada data cost di Drive'}
              </small>
            </div>
            <div className="card" title="Margin = Revenue − (Material + Petty Cash + Tukang)">
              <span>📈 Margin (Laba Kotor)</span>
              <strong style={{ fontSize: '22px', color: summary.marginPct === null ? '#9aa8a4' : (summary.margin < 0 ? '#b91c1c' : '#0d6e38') }}>
                {summary.marginPct === null ? '—' : rupiah(summary.margin)}
              </strong>
              <small>
                {summary.marginPct === null
                  ? 'menunggu data revenue'
                  : `${persen(summary.marginPct)} · ${summary.underBudget ? '✓ HEMAT (≤ budget 70%)' : '⚠ OVER-BUDGET (> 70%)'}`}
              </small>
            </div>
          </div>

          {/* Tab 3 komponen */}
          <div className="toolbar">
            <div className="filter-tabs">
              <button type="button" className={`pill ${view === 'revenue' ? 'active' : ''}`} onClick={() => setView('revenue')}>
                💰 Revenue
              </button>
              <button type="button" className={`pill ${view === 'tukang' ? 'active' : ''}`} onClick={() => setView('tukang')}>
                👷 Tukang ({laborRows.length})
              </button>
              <button type="button" className={`pill ${view === 'material' ? 'active' : ''}`} onClick={() => setView('material')}>
                🧱 Material ({materialPrTotals.count})
              </button>
            </div>
          </div>

          {/* ---------------- TAB REVENUE ---------------- */}
          {view === 'revenue' && (
            <>
              <div className="panel">
                <h2>💰 Revenue — {project.kode ? `[${project.kode}] ` : ''}{project.name}</h2>
                <table>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600, width: '240px' }}>Nilai Kontrak (Revenue)</td>
                      <td style={{ fontWeight: 800, fontSize: '16px' }}>{summary.revenue > 0 ? rupiah(summary.revenue) : '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Budget Target (70%)</td>
                      <td>
                        {summary.revenue > 0 ? (
                          <>
                            <b>{rupiah(summary.target)}</b>
                            <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: summary.underBudget ? '#137333' : '#b91c1c' }}>
                              {summary.underBudget ? '✓ HEMAT' : '⚠ OVER-BUDGET'}
                            </span>
                            <div style={{ fontSize: '11px', color: '#71817d', marginTop: '2px' }}>
                              total cost saat ini {rupiah(summary.total)} (Material + Petty Cash + Tukang)
                            </div>
                          </>
                        ) : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Sumber Data</td>
                      <td className="muted">REV PROJECT.xlsx (Google Drive) — disinkronkan otomatis</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Terakhir Sinkron</td>
                      <td className="muted">
                        {sync?.last_synced_at ? `${formatDateTime(sync.last_synced_at)} (${timeAgo(sync.last_synced_at)})` : '—'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Status Proyek</td>
                      <td><span className="badge status-DRAFT" style={{ fontSize: '11px' }}>{project.status || '—'}</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {!hasDriveData && (
                <div className="notice" style={{ marginTop: '14px' }}>
                  Data Drive untuk proyek ini belum tersedia. Pastikan kode proyek ({project.kode || '—'}) cocok dengan
                  PROJECT NO di REKAP COST 2026 / REV PROJECT, lalu klik &quot;🔄 Refresh Sekarang&quot; di modul Finance → tab Cost Drive.
                </div>
              )}
            </>
          )}

          {/* ---------------- TAB TUKANG ---------------- */}
          {view === 'tukang' && (
            <>
              <div className="panel table desktop-table-view">
                <table>
                  <thead>
                    <tr>
                      <th>Area</th>
                      <th>Item Pekerjaan</th>
                      <th>Pekerja (Tukang)</th>
                      <th>Model Upah</th>
                      <th style={{ textAlign: 'right' }}>Estimasi Upah</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {laborRows.length ? laborRows.map(pl => (
                      <tr key={pl.id}>
                        <td style={{ fontWeight: 600 }}>{pl.area || '—'}</td>
                        <td style={{ whiteSpace: 'normal', maxWidth: '240px' }}>
                          <div style={{ fontWeight: 600 }}>{pl.item_name || '—'}</div>
                          {pl.spec && <div style={{ fontSize: '11px', color: '#71817d', marginTop: '2px' }}>{pl.spec}</div>}
                        </td>
                        <td>{pl.worker_name || '—'}</td>
                        <td style={{ textTransform: 'capitalize' }}>{pl.worker_type || 'borongan'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(pl.labor_cost || 0)}</td>
                        <td>
                          <span className="badge" style={{ fontSize: '11px', ...planningStatusStyle(pl.status) }}>
                            {pl.status || 'Perencanaan'}
                          </span>
                          {Number(pl.progress) > 0 && (
                            <div style={{ fontSize: '11px', color: '#71817d', marginTop: '2px' }}>{pl.progress}%</div>
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="empty">
                        Belum ada item pekerjaan / upah tukang untuk proyek ini. Tambahkan di modul Project Planning.
                      </td></tr>
                    )}
                  </tbody>
                  {laborRows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: '#f7faf9', fontWeight: 800 }}>
                        <td colSpan={4} style={{ textAlign: 'right' }}>TOTAL ESTIMASI UPAH</td>
                        <td style={{ textAlign: 'right' }}>{rupiah(summary.labor)}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Kartu mobile */}
              <div className="mobile-cards-view">
                {laborRows.length ? laborRows.map(pl => (
                  <div className="mobile-card" key={pl.id}>
                    <div className="mobile-card-header">
                      <div>
                        <b className="mobile-card-title">{pl.item_name || '—'}</b>
                        <div className="mobile-card-sub">{pl.area || '—'}</div>
                      </div>
                    </div>
                    <div className="mobile-card-body">
                      <div className="mobile-card-row"><span className="mobile-label">Pekerja:</span><span className="mobile-val">{pl.worker_name || '—'} ({pl.worker_type || 'borongan'})</span></div>
                      <div className="mobile-card-row"><span className="mobile-label">Upah:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{rupiah(pl.labor_cost || 0)}</span></div>
                      <div className="mobile-card-row"><span className="mobile-label">Status:</span><span className="mobile-val">{pl.status || 'Perencanaan'}{Number(pl.progress) > 0 ? ` · ${pl.progress}%` : ''}</span></div>
                    </div>
                  </div>
                )) : <div className="panel empty">Belum ada item pekerjaan untuk proyek ini.</div>}
                {laborRows.length > 0 && (
                  <div className="panel" style={{ fontWeight: 800, textAlign: 'right' }}>
                    Total estimasi upah: {rupiah(summary.labor)}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---------------- TAB MATERIAL ---------------- */}
          {view === 'material' && (
            <>
              <div className="panel" style={{ marginBottom: '16px' }}>
                <h2>🧱 Cost Material — {project.kode ? `[${project.kode}] ` : ''}{project.name}</h2>
                <table>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600, width: '240px' }}>Cost Material Kumulatif</td>
                      <td style={{ fontWeight: 800, fontSize: '16px' }}>{drive ? rupiah(summary.material) : '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Pengeluaran Minggu Ini</td>
                      <td>{drive ? rupiah(drive.current_week_expense || 0) : '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Petty Cash (Kas Kecil)</td>
                      <td>{drive ? rupiah(summary.petty) : '—'}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Sumber Data</td>
                      <td className="muted">
                        REKAP COST 2026 — tab PROJECT SUMMARY (Google Drive)
                        {sync?.last_synced_at ? ` · terakhir sync ${timeAgo(sync.last_synced_at)}` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="panel table desktop-table-view">
                <table>
                  <thead>
                    <tr>
                      <th>No. PR</th>
                      <th>Judul Kebutuhan</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Estimasi</th>
                      <th style={{ textAlign: 'right' }}>Purchase Riil</th>
                      <th style={{ textAlign: 'right' }}>Selisih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialPrRows.length ? materialPrRows.map(p => (
                      <tr key={p.id}>
                        <td><b>{p.pr_number}</b></td>
                        <td style={{ whiteSpace: 'normal', maxWidth: '220px' }}>{p.title}</td>
                        <td><span className={`badge status-${p.status}`} style={{ fontSize: '11px' }}>{p.status}</span></td>
                        <td style={{ textAlign: 'right' }}>{p.est > 0 ? rupiah(p.est) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{p.real !== null ? rupiah(p.real) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: p.diff === null ? '#9aa8a4' : (p.diff > 0 ? '#b91c1c' : '#0d6e38') }}>
                          {p.diff === null ? '—' : rupiah(p.diff)}
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="empty">
                        Belum ada Purchase Request untuk proyek ini. Rincian pengadaan muncul di sini setelah PR dibuat di modul Purchase Request.
                      </td></tr>
                    )}
                  </tbody>
                  {materialPrRows.length > 0 && (
                    <tfoot>
                      <tr style={{ background: '#f7faf9', fontWeight: 800 }}>
                        <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL</td>
                        <td style={{ textAlign: 'right' }}>{materialPrTotals.est > 0 ? rupiah(materialPrTotals.est) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{materialPrTotals.real > 0 ? rupiah(materialPrTotals.real) : '—'}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Kartu mobile */}
              <div className="mobile-cards-view">
                <div className="panel">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Cost Material (Drive):</span><b>{drive ? rupiah(summary.material) : '—'}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                    <span>Minggu Ini:</span><span>{drive ? rupiah(drive.current_week_expense || 0) : '—'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                    <span>Petty Cash:</span><span>{drive ? rupiah(summary.petty) : '—'}</span>
                  </div>
                </div>
                {materialPrRows.length ? materialPrRows.map(p => (
                  <div className="mobile-card" key={p.id}>
                    <div className="mobile-card-header">
                      <div>
                        <b className="mobile-card-title">{p.pr_number}</b>
                        <div className="mobile-card-sub">{p.title}</div>
                      </div>
                    </div>
                    <div className="mobile-card-body">
                      <div className="mobile-card-row"><span className="mobile-label">Status:</span><span className="mobile-val">{p.status}</span></div>
                      <div className="mobile-card-row"><span className="mobile-label">Estimasi:</span><span className="mobile-val">{p.est > 0 ? rupiah(p.est) : '—'}</span></div>
                      <div className="mobile-card-row"><span className="mobile-label">Purchase Riil:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{p.real !== null ? rupiah(p.real) : '—'}</span></div>
                      <div className="mobile-card-row"><span className="mobile-label">Selisih:</span><span className="mobile-val" style={{ fontWeight: 700, color: p.diff === null ? '#9aa8a4' : (p.diff > 0 ? '#b91c1c' : '#0d6e38') }}>{p.diff === null ? '—' : rupiah(p.diff)}</span></div>
                    </div>
                  </div>
                )) : <div className="panel empty">Belum ada Purchase Request untuk proyek ini.</div>}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
