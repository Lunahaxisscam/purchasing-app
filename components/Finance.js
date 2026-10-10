import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { rupiah, formatDateTime, timeAgo, persen, formatNominalInput } from '../lib/constants'

// ============================================================
// Modul FINANCE — khusus role admin.
// Tab 1 & 2: ringkasan dari data pengadaan app (estimasi PR vs purchase riil).
// Tab 3 "Cost Drive": data cost dari Google Sheets "REKAP COST 2026"
//   (READ-ONLY) yang disinkronkan daemon ke tabel project_cost_summary.
//   Tombol "🔄 Refresh Sekarang" meminta sync on-demand via sync_status;
//   daemon (pm2 drive-sync) memproses permintaan itu dalam ≤45 detik.
// Tab 4 "Closing Proyek": P&L per proyek (Revenue, Budget 70%, Cost Kumulatif,
//   Margin, Labor Ratio) + modal review & kunci snapshot permanen ke tabel
//   project_closings (RPC close_project — atomic, admin-only).
// Tab 5 "Arsip Closing": riwayat P&L yang sudah terkunci permanen.
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
  // --- state tab Closing Proyek ---
  const [closings, setClosings] = useState([])
  const [plans, setPlans] = useState([])
  const [closingLoading, setClosingLoading] = useState(false)
  const [closingError, setClosingError] = useState('')
  const [closingModal, setClosingModal] = useState(null)   // { project, calc }
  const [closingNotes, setClosingNotes] = useState('')
  const [closingSaving, setClosingSaving] = useState(false)

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

  // --- Loader data Closing (project_closings + project_plans) ---
  const loadClosing = useCallback(async () => {
    if (!supabase) return
    setClosingLoading(true)
    setClosingError('')
    try {
      const [clRes, plRes] = await Promise.all([
        supabase.from('project_closings').select('*').order('closed_at', { ascending: false }),
        supabase.from('project_plans').select('project_id,labor_cost')
      ])
      if (clRes.error) setClosingError(clRes.error.message)
      else setClosings(clRes.data || [])
      if (!plRes.error) setPlans(plRes.data || [])
    } catch (e) {
      setClosingError(e.message)
    } finally {
      setClosingLoading(false)
    }
  }, [])

  // Muat saat pertama kali & saat tab closing dibuka.
  useEffect(() => { loadClosing() }, [loadClosing])
  useEffect(() => {
    if (view === 'closing' || view === 'closing_archive') loadClosing()
  }, [view, loadClosing])

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

  // ============================================================
  // CLOSING PROYEK — kalkulasi P&L per proyek.
  //   Revenue        : dari project_cost_summary.revenue (sync REV PROJECT)
  //   Material       : project_cost_summary.cumulative_cost (COST ITEMS CONFIRMED)
  //   Petty Cash     : project_cost_summary.petty_cash (tab PETTY CASH)
  //   Biaya Tukang   : SUM(project_plans.labor_cost) per proyek (modul Planning)
  //   Budget Target  : 70% × Revenue
  //   Cost Kumulatif : Material + Petty Cash + Tukang
  //   Margin         : Revenue − Cost Kumulatif (Rp & %)
  //   Labor Ratio    : Tukang ÷ Cost Kumulatif × 100%
  // ============================================================
  const closingRows = useMemo(() => {
    const projects = rows.projects || []
    const laborByProject = {}
    for (const pl of plans) {
      if (!pl.project_id) continue
      laborByProject[pl.project_id] = (laborByProject[pl.project_id] || 0) + (Number(pl.labor_cost) || 0)
    }
    const closedByProjectId = {}
    const closedByNo = {}
    for (const c of closings) {
      if (c.project_id) closedByProjectId[c.project_id] = c
      if (c.project_no) closedByNo[String(c.project_no)] = c
    }
    const driveByNo = {}
    for (const d of driveRows) {
      driveByNo[String(d.project_no || '').trim()] = d
    }

    const list = projects.map(p => {
      const drive = driveByNo[String(p.kode || '').trim()] || null
      const revenue = Number(drive?.revenue) || 0
      const material = Number(drive?.cumulative_cost) || 0
      const petty = Number(drive?.petty_cash) || 0
      const labor = laborByProject[p.id] || 0
      const total = material + petty + labor
      const target = revenue * 0.7
      const margin = revenue - total
      const marginPct = revenue === 0 ? 0 : (margin / revenue) * 100
      const laborRatio = total === 0 ? 0 : (labor / total) * 100
      const closed = closedByProjectId[p.id] || closedByNo[String(p.kode || '').trim()] || null
      return {
        project: p,
        revenue, material, petty, labor, total, target, margin, marginPct, laborRatio,
        closed,
        underBudget: total <= target
      }
    })
    // Urut nomor proyek numerik.
    return list.sort((a, b) => {
      const na = parseInt(a.project.kode, 10)
      const nb = parseInt(b.project.kode, 10)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return String(a.project.kode || '').localeCompare(String(b.project.kode || ''))
    })
  }, [rows, plans, closings, driveRows])

  // Estimasi Net Profit bulanan (preview): total margin proyek − OPEX WS.
  const netProfitPreview = useMemo(() => {
    const gross = closingRows.reduce((s, r) => s + (r.margin || 0), 0)
    const opex = Number((driveByNoGlobal(driveRows)['operasional ws'])?.cumulative_cost) || 0
    return { gross, opex, net: gross - opex }
  }, [closingRows, driveRows])

  function driveByNoGlobal(list) {
    const map = {}
    for (const d of list) map[String(d.project_no || '').trim().toLowerCase()] = d
    return map
  }

  // Buka modal review closing.
  function openClosingModal(row) {
    if (row.closed) {
      setClosingError(`Proyek [${row.project.kode}] ${row.project.name} sudah pernah di-closing pada ${formatDateTime(row.closed.closed_at)} — snapshot permanen tidak bisa diubah.`)
      return
    }
    if (row.revenue <= 0) {
      setClosingError(`Revenue proyek [${row.project.kode}] belum tersedia. Pastikan sync Drive berjalan & nilai kontrak terisi di REV PROJECT, lalu klik "🔄 Refresh Sekarang" di tab Cost Drive.`)
      return
    }
    setClosingError('')
    setClosingNotes('')
    setClosingModal(row)
  }

  // Konfirmasi closing — RPC atomic (snapshot permanen).
  async function confirmClosing() {
    if (!supabase || !closingModal || closingSaving) return
    const row = closingModal
    const label = `[${row.project.kode}] ${row.project.name}`
    const ok = window.confirm(
      `KUNCI SNAPSHOT PERMANEN untuk ${label}?\n\n` +
      `Revenue: ${rupiah(row.revenue)}\n` +
      `Cost Kumulatif: ${rupiah(row.total)}\n` +
      `Margin: ${rupiah(row.margin)} (${persen(row.marginPct)})\n\n` +
      `Setelah dikunci, angka historis ini TIDAK BISA diubah lagi dan proyek dipindahkan ke Past Project.`
    )
    if (!ok) return
    setClosingSaving(true)
    try {
      const { data, error } = await supabase.rpc('close_project', {
        p_project_id: row.project.id,
        p_project_no: String(row.project.kode),
        p_project_name: row.project.name,
        p_revenue: row.revenue,
        p_material_cost: row.material,
        p_petty_cash_cost: row.petty,
        p_labor_cost: row.labor,
        p_notes: closingNotes.trim() || null
      })
      if (error) { setClosingError(`Gagal closing: ${error.message}`); return }
      if (!data || data.ok === false) {
        if (data && data.reason === 'already_closed') {
          setClosingError(`${label} sudah pernah di-closing sebelumnya (snapshot permanen sudah ada).`)
        } else if (data && data.reason === 'not_admin') {
          setClosingError('Hanya admin yang boleh melakukan closing proyek.')
        } else {
          setClosingError('Closing gagal: alasan tidak dikenal.')
        }
        return
      }
      setClosingModal(null)
      setClosingNotes('')
      setClosingError('')
      await loadClosing()
      await loadDrive(true)
      window.alert(
        `✅ Closing proyek ${label} berhasil dikunci permanen.\n\n` +
        `Total Cost: ${rupiah(data.total_cost)} ${data.under_budget ? '(HEMAT — di bawah budget 70%)' : '(OVER-BUDGET — di atas budget 70%)'}\n` +
        `Margin: ${rupiah(data.margin_nominal)} (${persen(data.margin_percentage)})\n` +
        `Labor Ratio: ${persen(data.labor_ratio)}\n\n` +
        `Proyek dipindahkan ke Past Project dan snapshot tercatat di tab Arsip Closing.`
      )
    } finally {
      setClosingSaving(false)
    }
  }

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
        <div className="card" title="Estimasi: Total Gross Margin Proyek − Beban OPEX WS (bulan berjalan)">
          <span>Net Profit Bulanan (Preview)</span>
          <strong style={{ fontSize: '22px', color: netProfitPreview.net < 0 ? '#b91c1c' : '#0d6e38' }}>
            {rupiah(netProfitPreview.net)}
          </strong>
          <small>Margin {rupiah(netProfitPreview.gross)} − OPEX WS {rupiah(netProfitPreview.opex)}</small>
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
          <button type="button" className={`pill ${view === 'closing' ? 'active' : ''}`} onClick={() => setView('closing')}>
            🔒 Closing Proyek ({closingRows.filter(r => !r.closed).length})
          </button>
          <button type="button" className={`pill ${view === 'closing_archive' ? 'active' : ''}`} onClick={() => setView('closing_archive')}>
            📁 Arsip Closing ({closings.length})
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

      {view === 'closing' ? (
        <>
          {closingError && (
            <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>
              {closingError}
            </div>
          )}
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '110px' }}>No. &amp; Nama Proyek</th>
                  <th style={{ textAlign: 'right' }}>Revenue Project</th>
                  <th style={{ textAlign: 'right' }}>Budget Target (70%)</th>
                  <th style={{ textAlign: 'right' }}>Cost Kumulatif</th>
                  <th style={{ textAlign: 'right' }}>Margin (Laba Kotor)</th>
                  <th style={{ textAlign: 'right' }}>Labor Ratio</th>
                  <th style={{ width: '150px', textAlign: 'center' }}>Aksi Closing</th>
                </tr>
              </thead>
              <tbody>
                {closingLoading ? (
                  <tr><td colSpan={7} className="empty">Memuat data closing…</td></tr>
                ) : closingRows.length ? closingRows.map(row => {
                  const p = row.project
                  return (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{p.kode || '—'}</div>
                        <div style={{ fontSize: '12px', color: '#556b65', whiteSpace: 'normal', maxWidth: '170px' }}>{p.name || '—'}</div>
                        <div style={{ fontSize: '11px', color: '#9aa8a4', marginTop: '2px' }}>{p.status || '—'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.revenue > 0 ? rupiah(row.revenue) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.revenue > 0 ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{rupiah(row.target)}</div>
                            <div style={{ fontSize: '11px', color: row.underBudget ? '#137333' : '#b91c1c', fontWeight: 700 }}>
                              {row.underBudget ? '✓ HEMAT' : '⚠ OVER-BUDGET'}
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>{rupiah(row.total)}</div>
                        <div style={{ fontSize: '11px', color: '#71817d' }}>
                          Mat {rupiah(row.material)} · PC {rupiah(row.petty)} · Tukang {rupiah(row.labor)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: row.margin < 0 ? '#b91c1c' : '#0d6e38' }}>{rupiah(row.margin)}</div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: row.margin < 0 ? '#b91c1c' : '#0d6e38' }}>{persen(row.marginPct)}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{persen(row.laborRatio)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {row.closed ? (
                          <div>
                            <span className="badge status-APPROVED" style={{ fontSize: '10px' }}>🔒 TERKUNCI</span>
                            <div style={{ fontSize: '10px', color: '#9aa8a4', marginTop: '4px' }}>{formatDateTime(row.closed.closed_at)}</div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-finish"
                            style={{ fontSize: '11px', padding: '6px 10px', whiteSpace: 'nowrap' }}
                            onClick={() => openClosingModal(row)}
                            title="Review P&L lalu kunci snapshot permanen"
                          >
                            🔒 Closing Proyek
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={7} className="empty">Belum ada proyek.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {closingLoading ? (
              <div className="panel empty">Memuat data closing…</div>
            ) : closingRows.length ? closingRows.map(row => {
              const p = row.project
              return (
                <div className="mobile-card" key={p.id}>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">[{p.kode || '—'}] {p.name || '—'}</b>
                      <div className="mobile-card-sub">{p.status || '—'}</div>
                    </div>
                    {row.closed && <span className="badge status-APPROVED" style={{ fontSize: '10px' }}>🔒</span>}
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row"><span className="mobile-label">Revenue:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{row.revenue > 0 ? rupiah(row.revenue) : '—'}</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Budget 70%:</span><span className="mobile-val">{row.revenue > 0 ? rupiah(row.target) : '—'}</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Cost Kumulatif:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{rupiah(row.total)}</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Margin:</span><span className="mobile-val" style={{ fontWeight: 700, color: row.margin < 0 ? '#b91c1c' : '#0d6e38' }}>{rupiah(row.margin)} ({persen(row.marginPct)})</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Labor Ratio:</span><span className="mobile-val">{persen(row.laborRatio)}</span></div>
                  </div>
                  {!row.closed && (
                    <div className="mobile-card-actions">
                      <button type="button" className="btn-finish" style={{ fontSize: '11px', padding: '7px 12px' }} onClick={() => openClosingModal(row)}>🔒 Closing Proyek</button>
                    </div>
                  )}
                </div>
              )
            }) : <div className="panel empty">Belum ada proyek.</div>}
          </div>
        </>
      ) : view === 'closing_archive' ? (
        <>
          <div className="panel" style={{ marginBottom: '18px', padding: '16px 22px' }}>
            <p className="muted" style={{ margin: 0 }}>
              🔒 <b>Arsip Closing</b> — snapshot P&L historis yang sudah <b>terkunci permanen</b>. Angka di tab ini adalah rekaman audit saat closing dilakukan dan tidak berubah walaupun data sumber diperbarui.
            </p>
          </div>
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th>No. &amp; Nama Proyek</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Budget (70%)</th>
                  <th style={{ textAlign: 'right' }}>Cost Kumulatif</th>
                  <th style={{ textAlign: 'right' }}>Margin</th>
                  <th style={{ textAlign: 'right' }}>Labor Ratio</th>
                  <th>Closing</th>
                </tr>
              </thead>
              <tbody>
                {closingLoading ? (
                  <tr><td colSpan={7} className="empty">Memuat arsip…</td></tr>
                ) : closings.length ? closings.map(c => {
                  const hemat = (Number(c.total_cost) || 0) <= (Number(c.target_budget) || 0)
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{c.project_no || '—'}</div>
                        <div style={{ fontSize: '12px', color: '#556b65', whiteSpace: 'normal', maxWidth: '170px' }}>{c.project_name || '—'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(c.revenue || 0)}</td>
                      <td style={{ textAlign: 'right' }}>{rupiah(c.target_budget || 0)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>{rupiah(c.total_cost || 0)}</div>
                        <div style={{ fontSize: '11px', color: hemat ? '#137333' : '#b91c1c', fontWeight: 700 }}>{hemat ? '✓ HEMAT' : '⚠ OVER-BUDGET'}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: Number(c.margin_nominal) < 0 ? '#b91c1c' : '#0d6e38' }}>{rupiah(c.margin_nominal || 0)}</div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: Number(c.margin_nominal) < 0 ? '#b91c1c' : '#0d6e38' }}>{persen(c.margin_percentage || 0)}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{persen(c.labor_ratio || 0)}</td>
                      <td style={{ fontSize: '12px' }}>
                        <div style={{ fontWeight: 600 }}>{formatDateTime(c.closed_at)}</div>
                        <div style={{ fontSize: '11px', color: '#9aa8a4' }}>oleh {c.closed_by || '—'}</div>
                        {c.notes && <div style={{ fontSize: '11px', color: '#556b65', whiteSpace: 'normal', maxWidth: '220px', marginTop: '2px' }}>📝 {c.notes}</div>}
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={7} className="empty">Belum ada proyek yang di-closing. Buka tab "🔒 Closing Proyek" untuk memulai.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {closingLoading ? (
              <div className="panel empty">Memuat arsip…</div>
            ) : closings.length ? closings.map(c => {
              const hemat = (Number(c.total_cost) || 0) <= (Number(c.target_budget) || 0)
              return (
                <div className="mobile-card" key={c.id}>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title">[{c.project_no || '—'}] {c.project_name || '—'}</b>
                      <div className="mobile-card-sub">{formatDateTime(c.closed_at)} · {c.closed_by || '—'}</div>
                    </div>
                    <span className={`badge ${hemat ? 'status-APPROVED' : 'status-REJECTED'}`} style={{ fontSize: '10px' }}>{hemat ? '✓ HEMAT' : '⚠ OVER'}</span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row"><span className="mobile-label">Revenue:</span><span className="mobile-val">{rupiah(c.revenue || 0)}</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Cost:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{rupiah(c.total_cost || 0)}</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Margin:</span><span className="mobile-val" style={{ fontWeight: 700, color: Number(c.margin_nominal) < 0 ? '#b91c1c' : '#0d6e38' }}>{rupiah(c.margin_nominal || 0)} ({persen(c.margin_percentage || 0)})</span></div>
                    <div className="mobile-card-row"><span className="mobile-label">Labor Ratio:</span><span className="mobile-val">{persen(c.labor_ratio || 0)}</span></div>
                    {c.notes && <div className="mobile-card-row"><span className="mobile-label">Catatan:</span><span className="mobile-val">{c.notes}</span></div>}
                  </div>
                </div>
              )
            }) : <div className="panel empty">Belum ada proyek yang di-closing.</div>}
          </div>
        </>
      ) : view === 'drive' ? (
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
      {(view === 'summary' || view === 'detail') && (
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

      {/* ============================================================
          MODAL REVIEW CLOSING PROYEK
          Rincian P&L + evaluasi budget 70% + catatan + tombol kunci.
          ============================================================ */}
      {closingModal && (
        <div className="modal">
          <div className="dialog dialog-wide">
            <div className="dialoghead">
              <h2>🔒 Review Closing Proyek — [{closingModal.project.kode}] {closingModal.project.name}</h2>
              <button type="button" className="icon" onClick={() => setClosingModal(null)}>×</button>
            </div>

            <div className="panel" style={{ padding: '14px 18px', marginBottom: '14px', background: closingModal.underBudget ? '#f0f9f2' : '#fdf2f2', borderColor: closingModal.underBudget ? '#bce1ce' : '#fca5a5' }}>
              <b style={{ color: closingModal.underBudget ? '#137333' : '#b91c1c', fontSize: '14px' }}>
                {closingModal.underBudget
                  ? '✓ HEMAT — Cost kumulatif berada DI BAWAH Budget Target 70%'
                  : '⚠ OVER-BUDGET — Cost kumulatif MELEBIHI Budget Target 70%'}
              </b>
              <div style={{ fontSize: '12px', color: '#556b65', marginTop: '4px' }}>
                Cost Kumulatif {rupiah(closingModal.total)} vs Budget 70% {rupiah(closingModal.target)}
              </div>
            </div>

            <table style={{ marginBottom: '14px' }}>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>Revenue (Nilai Kontrak)</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(closingModal.revenue)}</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '26px', color: '#556b65' }}>a. Material Cost <small>(Bakpau — COST ITEMS)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.material)}</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '26px', color: '#556b65' }}>b. Petty Cash <small>(Bakpau — PETTY CASH)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.petty)}</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '26px', color: '#556b65' }}>c. Biaya Tukang <small>(Brokoli / Planning)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.labor)}</td>
                </tr>
                <tr style={{ background: '#f7faf9' }}>
                  <td style={{ fontWeight: 700 }}>COST KUMULATIF (a + b + c)</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(closingModal.total)}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Budget Target (70% × Revenue)</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(closingModal.target)}</td>
                </tr>
                <tr style={{ background: closingModal.margin < 0 ? '#fdf2f2' : '#f0f9f2' }}>
                  <td style={{ fontWeight: 700 }}>MARGIN / LABA KOTOR</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: closingModal.margin < 0 ? '#b91c1c' : '#0d6e38' }}>
                    {rupiah(closingModal.margin)} ({persen(closingModal.marginPct)})
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Labor Ratio (Tukang ÷ Cost Kumulatif)</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{persen(closingModal.laborRatio)}</td>
                </tr>
              </tbody>
            </table>

            <label>Catatan Evaluasi Closing
              <textarea
                rows={3}
                value={closingNotes}
                onChange={e => setClosingNotes(e.target.value)}
                placeholder="cth: Pekerjaan selesai lebih cepat, material hemat. Evaluasi: koordinasi tukang sudah baik, lanjutkan pola ini…"
              />
            </label>

            <p className="muted" style={{ fontSize: '12px', margin: '10px 0 0' }}>
              Menekan tombol di bawah akan <b>mengunci snapshot permanen</b> ke tabel <code>project_closings</code> dan memindahkan proyek ke <b>Past Project</b>. Angka historis tidak dapat diubah lagi.
            </p>

            <div className="actions">
              <button type="button" className="outline" onClick={() => setClosingModal(null)}>Batal</button>
              <button type="button" disabled={closingSaving} onClick={confirmClosing}>
                {closingSaving ? '⏳ Mengunci…' : '🔒 Konfirmasi Closing & Kunci Snapshot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
