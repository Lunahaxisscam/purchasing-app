import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { rupiah, formatDateTime, timeAgo } from '../lib/constants'

// ============================================================
// Modul FINANCE — khusus role admin.
// Tab 1 & 2: ringkasan dari data pengadaan app (estimasi PR vs purchase riil).
// Tab 3 "Cost Drive": data cost dari Google Sheets "REKAP COST 2026"
//   (READ-ONLY) yang disinkronkan daemon ke tabel project_cost_summary.
//   Tombol "🔄 Refresh Sekarang" meminta sync on-demand via sync_status;
//   daemon (pm2 drive-sync) memproses permintaan itu dalam ≤45 detik.
// ============================================================

function parseNominalFromNote(note) {
  const s = String(note || '')
  const m = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const digits = m[1].replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

export default function Finance({ rows, session }) {
  const [view, setView] = useState('summary')
  // --- state tab Cost Drive ---
  const [driveRows, setDriveRows] = useState([])
  const [sync, setSync] = useState(null)
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef(null)

  const loadDrive = useCallback(async (silent = false) => {
    if (!supabase) return
    if (!silent) setDriveLoading(true)
    setDriveError('')
    try {
      const [costRes, syncRes] = await Promise.all([
        supabase.from('project_cost_summary').select('*').order('project_no', { ascending: true }),
        supabase.from('sync_status').select('*').eq('id', 'rekap_cost').maybeSingle()
      ])
      if (costRes.error) {
        setDriveError(costRes.error.message)
      } else {
        const sorted = (costRes.data || []).sort((a, b) => {
          const na = parseInt(a.project_no, 10)
          const nb = parseInt(b.project_no, 10)
          if (!isNaN(na) && !isNaN(nb)) return na - nb
          return (a.project_no || '').localeCompare(b.project_no || '', 'id', { numeric: true })
        })
        setDriveRows(sorted)
      }
      if (!syncRes.error && syncRes.data) setSync(syncRes.data)
    } catch (e) {
      setDriveError(e.message)
    } finally {
      if (!silent) setDriveLoading(false)
    }
  }, [])

  // Muat data Drive saat pertama kali masuk agar kartu ringkasan langsung terisi
  useEffect(() => {
    loadDrive(true)
  }, [loadDrive])

  useEffect(() => {
    if (view === 'drive') loadDrive(false)
  }, [view, loadDrive])

  // Bersihkan polling saat unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // "🔄 Refresh Sekarang": tulis permintaan ke sync_status; daemon memprosesnya.
  // Lalu poll status tiap 5 dtk (maks ~90 dtk) sampai last_synced_at berubah.
  async function requestRefresh() {
    if (!supabase || refreshing) return
    setRefreshing(true)
    try {
      const prevSynced = sync?.last_synced_at || null
      const { error } = await supabase.from('sync_status').update({
        requested_at: new Date().toISOString(),
        request_by: session?.user?.email || 'admin'
      }).eq('id', 'rekap_cost')
      if (error) {
        setDriveError(`Gagal meminta sync: ${error.message}`)
        setRefreshing(false)
        return
      }
      // tampilkan status "sedang diminta" lebih dulu
      setSync(prev => ({ ...(prev || {}), requested_at: new Date().toISOString() }))

      let tries = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        tries += 1
        const { data } = await supabase.from('sync_status').select('*').eq('id', 'rekap_cost').maybeSingle()
        if (data) setSync(data)
        const done = data && data.last_synced_at && data.last_synced_at !== prevSynced
        if (done || tries >= 18) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setRefreshing(false)
          if (done) loadDrive(true)
        }
      }, 5000)
    } catch (e) {
      setDriveError(`Gagal meminta sync: ${e.message}`)
      setRefreshing(false)
    }
  }

  const driveTotals = useMemo(() => {
    const sum = (k) => driveRows.reduce((s, r) => s + (Number(r[k]) || 0), 0)
    return {
      cumulative: sum('cumulative_cost'),
      week: sum('current_week_expense'),
      count: driveRows.length
    }
  }, [driveRows])

  const data = useMemo(() => {
    const prs = rows.requests || []
    const prItems = rows.pr_items || []
    const receivings = rows.receivings || []
    const projects = rows.projects || []

    const estForPr = (prId) => {
      const items = prItems.filter(it => it.pr_id === prId)
      return items.reduce((sum, it) => {
        const p = Number(it.estimated_price)
        const q = Number(it.quantity)
        if (!isFinite(p) || p <= 0) return sum
        return sum + p * (isFinite(q) && q > 0 ? q : 1)
      }, 0)
    }

    const realForPr = (prId) => {
      const recs = receivings.filter(r => r.purchase_request_id === prId)
      let total = 0
      let hasAny = false
      for (const r of recs) {
        const n = parseNominalFromNote(r.note)
        if (n !== null) { total += n; hasAny = true }
      }
      return hasAny ? total : null
    }

    const perPr = prs.map(pr => {
      const est = estForPr(pr.id)
      const real = realForPr(pr.id)
      return {
        id: pr.id,
        pr_number: pr.pr_number || '—',
        project_name: pr.project_name || 'Tanpa Project',
        title: pr.title || '—',
        status: pr.status || '—',
        est,
        real,
        diff: (real !== null && est > 0) ? real - est : null
      }
    })

    // Kelompokkan per project
    const byProjectMap = {}
    for (const p of perPr) {
      const key = p.project_name
      if (!byProjectMap[key]) byProjectMap[key] = { project: key, prCount: 0, est: 0, real: 0, hasReal: false }
      byProjectMap[key].prCount += 1
      byProjectMap[key].est += p.est
      if (p.real !== null) { byProjectMap[key].real += p.real; byProjectMap[key].hasReal = true }
    }
    const byProject = Object.values(byProjectMap).sort((a, b) => b.est - a.est)

    const totalEst = perPr.reduce((s, p) => s + p.est, 0)
    const totalReal = perPr.reduce((s, p) => s + (p.real || 0), 0)
    const totalPrWithPrice = perPr.filter(p => p.est > 0).length

    return { perPr, byProject, totalEst, totalReal, totalPrWithPrice, projectCount: projects.length }
  }, [rows])

  return (
    <>
      <div className="cards">
        <div className="card">
          <span>Total Estimasi PR</span>
          <strong style={{ fontSize: '22px' }}>{rupiah(data.totalEst)}</strong>
          <small>{data.totalPrWithPrice} PR punya estimasi harga</small>
        </div>
        <div className="card">
          <span>Total Purchase (Riil)</span>
          <strong style={{ fontSize: '22px' }}>{rupiah(data.totalReal)}</strong>
          <small>dari nota penerimaan</small>
        </div>
        <div className="card">
          <span>Cost Proyek (Drive)</span>
          <strong style={{ fontSize: '22px' }}>{driveRows.length ? rupiah(driveTotals.cumulative) : '—'}</strong>
          <small>{driveRows.length ? `${driveTotals.count} project · sinkron dari REKAP COST 2026` : 'buka tab Cost Drive untuk memuat'}</small>
        </div>
        <div className="card">
          <span>Project</span>
          <strong>{data.projectCount}</strong>
          <small>{data.byProject.length} project ada pengadaan</small>
        </div>
      </div>

      <div className="toolbar">
        <div className="filter-tabs">
          <button type="button" className={`pill ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>
            Ringkasan per Project ({data.byProject.length})
          </button>
          <button type="button" className={`pill ${view === 'detail' ? 'active' : ''}`} onClick={() => setView('detail')}>
            Detail per PR ({data.perPr.length})
          </button>
          <button type="button" className={`pill ${view === 'drive' ? 'active' : ''}`} onClick={() => setView('drive')}>
            ☁️ Cost Drive ({driveRows.length || '…'})
          </button>
        </div>
        {view === 'drive' && (
          <div className="toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="btn-finish"
              onClick={requestRefresh}
              disabled={refreshing}
              style={{ opacity: refreshing ? 0.7 : 1, padding: '7px 14px', fontSize: '12px' }}
              title="Minta daemon menarik data terbaru dari Google Sheets REKAP COST 2026 (read-only)"
            >
              {refreshing ? '⏳ Sinkronisasi…' : '🔄 Refresh Sekarang'}
            </button>
            <button
              type="button"
              className="outline"
              onClick={() => loadDrive()}
              style={{ padding: '7px 12px', fontSize: '12px' }}
              title="Muat ulang data dari database lokal"
            >
              ↻ Muat Ulang
            </button>
          </div>
        )}
      </div>

      {view === 'drive' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 14px', background: '#f0f7f4', borderRadius: 'var(--radius-sm)', border: '1px solid #cce3d8', marginBottom: '14px', fontSize: '12px', color: '#173d36' }}>
          <div>
            {refreshing ? (
              <span style={{ fontWeight: 600, color: '#137333' }}>
                ⏳ Permintaan sinkronisasi sedang diproses daemon (maksimal ±45 detik)…
              </span>
            ) : sync?.last_synced_at ? (
              <span>
                Google Sheets <b>REKAP COST 2026</b> · Terakhir disinkronkan: <b>{formatDateTime(sync.last_synced_at)}</b> ({timeAgo(sync.last_synced_at)})
                {sync.last_message ? <span style={{ color: '#556b65' }}> · {sync.last_message}</span> : null}
              </span>
            ) : (
              <span style={{ color: '#556b65' }}>Belum pernah disinkronkan dari Google Drive.</span>
            )}
          </div>
          {sync?.last_status === 'ERROR' && (
            <span style={{ color: '#b91c1c', fontWeight: 700 }}>
              ⚠️ Sync gagal: {sync.last_message || 'Terjadi kesalahan'}
            </span>
          )}
        </div>
      )}

      {driveError && (
        <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', marginBottom: '14px' }}>
          {driveError}
        </div>
      )}

      {view === 'drive' ? (
        <>
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>No</th>
                  <th>Project</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Cost Kumulatif</th>
                  <th style={{ textAlign: 'right' }}>Minggu Ini</th>
                </tr>
              </thead>
              <tbody>
                {driveLoading ? (
                  <tr><td colSpan={5} className="empty">Memuat data cost dari Drive…</td></tr>
                ) : driveRows.length ? driveRows.map((r, i) => (
                  <tr key={r.id || i}>
                    <td><b>{r.project_no || '—'}</b></td>
                    <td style={{ fontWeight: 600 }}>{r.project_name || '—'}</td>
                    <td>{r.project_status || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(r.cumulative_cost || 0)}</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(r.current_week_expense || 0)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="empty">
                    {driveError ? 'Tidak bisa menampilkan data cost.' : 'Belum ada data — klik "🔄 Refresh Sekarang" untuk menarik dari Google Drive.'}
                  </td></tr>
                )}
              </tbody>
              {driveRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#f7faf9', fontWeight: 800 }}>
                    <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(driveTotals.cumulative)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {driveLoading ? (
              <div className="panel empty">Memuat data cost dari Drive…</div>
            ) : driveRows.length ? driveRows.map((r, i) => (
              <div className="mobile-card" key={r.id || i}>
                <div className="mobile-card-header">
                  <div>
                    <b className="mobile-card-title">{r.project_name || '—'}</b>
                    <div className="mobile-card-sub">No. {r.project_no || '—'} · {r.project_status || '—'}</div>
                  </div>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row"><span className="mobile-label">Cost Kumulatif:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{rupiah(r.cumulative_cost || 0)}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Minggu Ini:</span><span className="mobile-val">{rupiah(r.current_week_expense || 0)}</span></div>
                </div>
              </div>
            )) : <div className="panel empty">Belum ada data — klik "🔄 Refresh Sekarang" untuk menarik dari Google Drive.</div>}
          </div>
        </>
      ) : (
      <div className="panel table desktop-table-view">
        {view === 'summary' ? (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th style={{ textAlign: 'right' }}>Jml PR</th>
                <th style={{ textAlign: 'right' }}>Estimasi</th>
                <th style={{ textAlign: 'right' }}>Purchase Riil</th>
                <th style={{ textAlign: 'right' }}>Selisih</th>
              </tr>
            </thead>
            <tbody>
              {data.byProject.length ? data.byProject.map((p, i) => {
                const diff = p.hasReal ? p.real - p.est : null
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{p.project}</td>
                    <td style={{ textAlign: 'right' }}>{p.prCount}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.est > 0 ? rupiah(p.est) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.hasReal ? rupiah(p.real) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: diff === null ? '#9aa8a4' : (diff > 0 ? '#b91c1c' : '#0d6e38') }}>
                      {diff === null ? '—' : rupiah(diff)}
                    </td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={5} className="empty">Belum ada data pengadaan.</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr>
                <th>No. PR</th>
                <th>Project</th>
                <th>Judul</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Estimasi</th>
                <th style={{ textAlign: 'right' }}>Purchase Riil</th>
                <th style={{ textAlign: 'right' }}>Selisih</th>
              </tr>
            </thead>
            <tbody>
              {data.perPr.length ? data.perPr.map((p, i) => (
                <tr key={i}>
                  <td><b>{p.pr_number}</b></td>
                  <td>{p.project_name}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: '220px' }}>{p.title}</td>
                  <td>{p.status}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.est > 0 ? rupiah(p.est) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{p.real !== null ? rupiah(p.real) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: p.diff === null ? '#9aa8a4' : (p.diff > 0 ? '#b91c1c' : '#0d6e38') }}>
                    {p.diff === null ? '—' : rupiah(p.diff)}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="empty">Belum ada data pengadaan.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* Kartu mobile (tab ringkasan/detail) */}
      {view !== 'drive' && (
      <div className="mobile-cards-view">
        {view === 'summary' ? (
          data.byProject.length ? data.byProject.map((p, i) => {
            const diff = p.hasReal ? p.real - p.est : null
            return (
              <div className="mobile-card" key={i}>
                <div className="mobile-card-header">
                  <b className="mobile-card-title">{p.project}</b>
                  <span className="badge status-APPROVED" style={{ fontSize: '10px' }}>{p.prCount} PR</span>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row"><span className="mobile-label">Estimasi:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{p.est > 0 ? rupiah(p.est) : '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Purchase Riil:</span><span className="mobile-val">{p.hasReal ? rupiah(p.real) : '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Selisih:</span><span className="mobile-val" style={{ fontWeight: 700, color: diff === null ? '#9aa8a4' : (diff > 0 ? '#b91c1c' : '#0d6e38') }}>{diff === null ? '—' : rupiah(diff)}</span></div>
                </div>
              </div>
            )
          }) : <div className="panel empty">Belum ada data pengadaan.</div>
        ) : (
          data.perPr.length ? data.perPr.map((p, i) => (
            <div className="mobile-card" key={i}>
              <div className="mobile-card-header">
                <div>
                  <b className="mobile-card-title">{p.pr_number}</b>
                  <div className="mobile-card-sub">{p.project_name}</div>
                </div>
                <span className={`badge status-${p.status}`}>{p.status}</span>
              </div>
              <div className="mobile-card-body">
                <div className="mobile-card-row"><span className="mobile-label">Judul:</span><span className="mobile-val">{p.title}</span></div>
                <div className="mobile-card-row"><span className="mobile-label">Estimasi:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{p.est > 0 ? rupiah(p.est) : '—'}</span></div>
                <div className="mobile-card-row"><span className="mobile-label">Purchase Riil:</span><span className="mobile-val">{p.real !== null ? rupiah(p.real) : '—'}</span></div>
                <div className="mobile-card-row"><span className="mobile-label">Selisih:</span><span className="mobile-val" style={{ fontWeight: 700, color: p.diff === null ? '#9aa8a4' : (p.diff > 0 ? '#b91c1c' : '#0d6e38') }}>{p.diff === null ? '—' : rupiah(p.diff)}</span></div>
              </div>
            </div>
          )) : <div className="panel empty">Belum ada data pengadaan.</div>
        )}
      </div>
      )}
    </>
  )
}
