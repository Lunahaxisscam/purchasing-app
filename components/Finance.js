import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { rupiah, formatDateTime, timeAgo, persen } from '../lib/constants'

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

export default function Finance({ rows, session, refresh }) {
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
  // --- state cetak dokumen closing (Sprint 1) ---
  const [printDoc, setPrintDoc] = useState(null)   // snapshot project_closings utk dokumen cetak
  const [printDate, setPrintDate] = useState(null) // waktu dokumen dibuka/dicetak
  // Portal hanya setelah mount (SSR-safe) — dokumen dicetak sebagai anak
  // langsung <body> supaya @media print bisa display:none semua elemen app
  // lain tanpa menyisakan halaman kosong (fix review F2).
  const [portalReady, setPortalReady] = useState(false)
  useEffect(() => { setPortalReady(true) }, [])

  // Saat dokumen cetak terbuka, tandai <body> supaya CSS @media print hanya
  // menyembunyikan kerangka aplikasi (navbar/sidebar/tombol) di mode ini.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (printDoc) document.body.classList.add('printing-closing')
    else document.body.classList.remove('printing-closing')
    return () => document.body.classList.remove('printing-closing')
  }, [printDoc])

  // Buka preview dokumen closing resmi utk snapshot yang sudah terkunci.
  function openPrintDoc(snapshot) {
    if (!snapshot) return
    setPrintDate(new Date())
    setPrintDoc(snapshot)
  }

  // Nama proyek biasanya berformat "Klien - Lokasi" (mis. "Aan - BSD").
  // Dipisah utk kop dokumen: Nama Klien & Lokasi. Tanpa pemisah → lokasi '—'.
  function splitClientLocation(name) {
    const s = String(name || '').trim()
    const idx = s.indexOf(' - ')
    if (idx > 0) return { client: s.slice(0, idx).trim(), location: s.slice(idx + 3).trim() }
    return { client: s || '—', location: '—' }
  }

  function formatTanggalPanjang(v) {
    if (!v) return '—'
    const d = new Date(v)
    if (isNaN(d.getTime())) return String(v)
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  }

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

  // Tombol "↻ Perbarui" (tab selain Cost Drive): muat ulang data lokal —
  // data app dari parent (rows) + tabel closing + ringkasan Drive.
  async function handleReloadLocal() {
    try { if (refresh) await refresh() } catch (e) { /* tetap lanjut memuat data lokal */ }
    await loadClosing()
    await loadDrive(true)
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
      // L1: revenue*0.7 bisa menghasilkan float (mis. 30309999.999999996);
      // dibulatkan ke rupiah supaya perbandingan HEMAT/OVER-BUDGET tepat di
      // batas pas 70%.
      const target = Math.round(revenue * 70) / 100
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
    // L4: OPEX dicari case-insensitive & dilaporkan bila barisnya tidak ada —
    // tanpa ini net profit tampak lebih besar dari kenyataan (opex dianggap 0).
    const map = {}
    for (const d of driveRows) map[String(d.project_no || '').trim().toLowerCase()] = d
    const opexRow = map['operasional ws']
    const opex = opexRow ? (Number(opexRow.cumulative_cost) || 0) : null
    return { gross, opex, net: opex === null ? null : gross - opex }
  }, [closingRows, driveRows])

  // Buka modal review closing.
  function openClosingModal(row) {
    if (row.closed) {
      setClosingError(`Proyek [${row.project.kode}] ${row.project.name} sudah pernah di-closing pada ${formatDateTime(row.closed.closed_at)} — snapshot permanen tidak bisa diubah.`)
      return
    }
    // L3: tanpa kode proyek, snapshot akan menyimpan literal "null" permanen.
    if (!row.project.kode) {
      setClosingError(`Proyek "${row.project.name}" belum punya Kode Project. Isi kodenya dulu di modul Projects sebelum closing (kode dipakai sebagai kunci snapshot permanen).`)
      return
    }
    if (row.revenue <= 0) {
      setClosingError(`Revenue proyek [${row.project.kode}] belum tersedia. Pastikan sync Drive berjalan & nilai kontrak terisi di REV PROJECT, lalu klik "🔄 Refresh dari Drive" di tab Cost Drive.`)
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
          <strong style={{ fontSize: '22px', color: netProfitPreview.net === null ? '#9aa8a4' : (netProfitPreview.net < 0 ? '#b91c1c' : '#0d6e38') }}>
            {netProfitPreview.net === null ? '—' : rupiah(netProfitPreview.net)}
          </strong>
          <small>
            {netProfitPreview.opex === null
              ? 'baris OPEX "operasional ws" belum ada di data Drive'
              : `Margin ${rupiah(netProfitPreview.gross)} − OPEX WS ${rupiah(netProfitPreview.opex)}`}
          </small>
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
        {/* SATU tombol refresh per halaman (permintaan user 11 Okt — sebelumnya
            ada 3 tombol refresh membingungkan: Perbarui global + Refresh Sekarang
            + Muat Ulang). Tab Cost Drive → tarik data dari Google Sheets;
            tab lain → muat ulang data dari database. */}
        <div className="toolbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {view === 'drive' ? (
            <button
              type="button"
              className="btn-finish"
              onClick={requestRefresh}
              disabled={refreshing}
              style={{ opacity: refreshing ? 0.7 : 1, padding: '7px 14px', fontSize: '12px' }}
              title="Minta daemon menarik data terbaru dari Google Sheets REKAP COST 2026 (read-only)"
            >
              {refreshing ? '⏳ Sinkronisasi…' : '🔄 Refresh dari Drive'}
            </button>
          ) : (
            <button
              type="button"
              className="outline"
              onClick={handleReloadLocal}
              style={{ padding: '7px 12px', fontSize: '12px' }}
              title="Muat ulang data dari database"
            >
              ↻ Perbarui
            </button>
          )}
        </div>
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
                            <div style={{ fontSize: '10px', color: '#9aa8a4', margin: '4px 0' }}>{formatDateTime(row.closed.closed_at)}</div>
                            {/* Sprint 1 — cetak dokumen resmi utk proyek yang sudah closed */}
                            <button
                              type="button"
                              className="outline"
                              style={{ fontSize: '10px', padding: '5px 8px', whiteSpace: 'nowrap' }}
                              onClick={() => openPrintDoc(row.closed)}
                              title="Buka dokumen laporan closing resmi siap cetak / simpan PDF"
                            >
                              📄 Cetak Dokumen Closing (PDF)
                            </button>
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
                  {row.closed && (
                    <div className="mobile-card-actions">
                      <button
                        type="button"
                        className="outline"
                        style={{ width: '100%', fontSize: '12px', padding: '8px' }}
                        onClick={() => openPrintDoc(row.closed)}
                      >
                        📄 Cetak Dokumen Closing (PDF)
                      </button>
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
                  <th style={{ width: '120px', textAlign: 'center' }}>Dokumen</th>
                </tr>
              </thead>
              <tbody>
                {closingLoading ? (
                  <tr><td colSpan={8} className="empty">Memuat arsip…</td></tr>
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
                      <td style={{ textAlign: 'center' }}>
                        {/* Sprint 1 — One-Click Cetak Laporan Closing Proyek Resmi */}
                        <button
                          type="button"
                          className="btn-finish"
                          style={{ fontSize: '11px', padding: '6px 10px', whiteSpace: 'nowrap' }}
                          onClick={() => openPrintDoc(c)}
                          title="Buka dokumen laporan closing resmi siap cetak / simpan PDF"
                        >
                          📄 Cetak Dokumen Closing (PDF)
                        </button>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={8} className="empty">Belum ada proyek yang di-closing. Buka tab "🔒 Closing Proyek" untuk memulai.</td></tr>
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
                  <div className="mobile-card-actions">
                    <button
                      type="button"
                      className="btn-finish"
                      style={{ width: '100%', fontSize: '12px', padding: '8px' }}
                      onClick={() => openPrintDoc(c)}
                    >
                      📄 Cetak Dokumen Closing (PDF)
                    </button>
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
                    {driveError ? 'Tidak bisa menampilkan data cost.' : 'Belum ada data — klik "🔄 Refresh dari Drive" untuk menarik dari Google Drive.'}
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
            )) : <div className="panel empty">Belum ada data — klik "🔄 Refresh dari Drive" untuk menarik dari Google Drive.</div>}
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
          DOKUMEN CETAK CLOSING PROYEK RESMI (Sprint 1)
          Dirender via PORTAL langsung ke <body> — layout siap cetak A4;
          saat print, semua elemen app di-display:none (lihat
          styles/globals.css @media print + body.printing-closing), hanya
          dokumen ini yang tercetak. ============================================ */}
      {printDoc && portalReady && typeof document !== 'undefined' && createPortal(
        <div className="print-portal">
        <div className="modal print-modal">
          <div className="dialog dialog-wide print-dialog">
            <div className="dialoghead print-toolbar">
              <h2>📄 Dokumen Closing — [{printDoc.project_no}] {printDoc.project_name}</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="outline" onClick={() => setPrintDoc(null)}>Tutup</button>
                <button type="button" className="btn-finish" onClick={() => window.print()}>
                  🖨️ Cetak / Simpan PDF
                </button>
              </div>
            </div>

            {/* ---- Kertas dokumen resmi (tercetak apa adanya) ---- */}
            <div className="print-paper">
              {/* KOP SURAT */}
              <div className="print-kop">
                <div className="print-kop-brand">
                  <span className="print-logo">NL</span>
                  <div>
                    <div className="print-company">NOIR LIVING INDONESIA</div>
                    <div className="print-company-sub">Studio &amp; In-house Workshop Mandiri — Tangerang / Jakarta</div>
                  </div>
                </div>
                <div className="print-kop-line" />
              </div>

              {/* JUDUL DOKUMEN */}
              <div className="print-title">
                <h1>LAPORAN PERTANGGUNGJAWABAN &amp; CLOSING PROYEK</h1>
                <div className="print-title-no">No. Dokumen: CLS/{printDoc.project_no}/{String(printDoc.closed_at || '').slice(0, 4) || new Date().getFullYear()}</div>
              </div>

              {/* INFO PROYEK */}
              {(() => {
                const { client, location } = splitClientLocation(printDoc.project_name)
                return (
                  <table className="print-info">
                    <tbody>
                      <tr>
                        <td className="print-info-label">Kode Proyek</td>
                        <td className="print-info-value">: {printDoc.project_no || '—'}</td>
                        <td className="print-info-label">Tanggal Closing</td>
                        <td className="print-info-value">: {formatTanggalPanjang(printDoc.closed_at)}</td>
                      </tr>
                      <tr>
                        <td className="print-info-label">Nama Klien</td>
                        <td className="print-info-value">: {client}</td>
                        <td className="print-info-label">Tanggal Dokumen Dicetak</td>
                        <td className="print-info-value">: {formatTanggalPanjang(printDate)}</td>
                      </tr>
                      <tr>
                        <td className="print-info-label">Lokasi</td>
                        <td className="print-info-value">: {location}</td>
                        <td className="print-info-label">Dikunci Oleh</td>
                        <td className="print-info-value">: {printDoc.closed_by || '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                )
              })()}

              {/* TABEL RINCIAN BIAYA (HPP & PROFIT) */}
              <table className="print-table">
                <thead>
                  <tr>
                    <th style={{ width: '34px' }}>No</th>
                    <th>Uraian</th>
                    <th style={{ width: '150px', textAlign: 'right' }}>Nominal (Rp)</th>
                    <th style={{ width: '110px', textAlign: 'right' }}>% Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rev = Number(printDoc.revenue) || 0
                    const pctOf = (v) => rev > 0 ? `${((Number(v) || 0) / rev * 100).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '—'
                    return (
                      <>
                        <tr>
                          <td style={{ textAlign: 'center' }}>1</td>
                          <td><b>Revenue Proyek (Nilai Kontrak)</b></td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(rev)}</td>
                          <td style={{ textAlign: 'right' }}>100,00%</td>
                        </tr>
                        <tr>
                          <td style={{ textAlign: 'center' }}>2</td>
                          <td style={{ paddingLeft: '18px' }}>Realisasi Biaya Material <small>(COST ITEMS CONFIRMED)</small></td>
                          <td style={{ textAlign: 'right' }}>{rupiah(printDoc.material_cost || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{pctOf(printDoc.material_cost)}</td>
                        </tr>
                        <tr>
                          <td style={{ textAlign: 'center' }}>3</td>
                          <td style={{ paddingLeft: '18px' }}>Realisasi Biaya Tukang <small>(Upah Borongan Mandor)</small></td>
                          <td style={{ textAlign: 'right' }}>{rupiah(printDoc.labor_cost || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{pctOf(printDoc.labor_cost)}</td>
                        </tr>
                        <tr>
                          <td style={{ textAlign: 'center' }}>4</td>
                          <td style={{ paddingLeft: '18px' }}>Realisasi Biaya Lapangan <small>(Petty Cash)</small></td>
                          <td style={{ textAlign: 'right' }}>{rupiah(printDoc.petty_cash_cost || 0)}</td>
                          <td style={{ textAlign: 'right' }}>{pctOf(printDoc.petty_cash_cost)}</td>
                        </tr>
                        <tr className="print-row-total">
                          <td />
                          <td><b>TOTAL HPP RIIL (2 + 3 + 4)</b></td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{rupiah(printDoc.total_cost || 0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{pctOf(printDoc.total_cost)}</td>
                        </tr>
                        <tr className={Number(printDoc.margin_nominal) < 0 ? 'print-row-loss' : 'print-row-profit'}>
                          <td />
                          <td><b>GROSS MARGIN / KEUNTUNGAN KOTOR (1 − 5)</b></td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{rupiah(printDoc.margin_nominal || 0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>
                            {Number(printDoc.margin_percentage || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                          </td>
                        </tr>
                        <tr>
                          <td />
                          <td>
                            <b>Rasio Biaya (Cost Ratio)</b> vs Target Standar (Max 70%)
                            <div style={{ fontSize: '10.5px', color: '#555', marginTop: '2px' }}>
                              Budget target 70%: {rupiah(printDoc.target_budget || 0)} —{' '}
                              <b>{(Number(printDoc.total_cost) || 0) <= (Number(printDoc.target_budget) || 0) ? '✓ HEMAT (di bawah target)' : '⚠ OVER-BUDGET (di atas target)'}</b>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>
                            {pctOf(printDoc.total_cost)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {(Number(printDoc.total_cost) || 0) <= (Number(printDoc.target_budget) || 0) ? '✓' : '⚠'}
                          </td>
                        </tr>
                      </>
                    )
                  })()}
                </tbody>
              </table>

              {/* CATATAN CLOSING */}
              <div className="print-notes">
                <div className="print-section-title">Catatan Closing:</div>
                <div className="print-notes-box">
                  {printDoc.notes ? String(printDoc.notes) : '—'}
                </div>
              </div>

              {/* KOLOM TANDA TANGAN */}
              <div className="print-sign">
                <div className="print-sign-col">
                  <div>Disiapkan Oleh,</div>
                  <div className="print-sign-space" />
                  <div className="print-sign-name">Finance Specialist</div>
                  <div className="print-sign-role">Divisi Keuangan</div>
                </div>
                <div className="print-sign-col">
                  <div>Disetujui Oleh,</div>
                  <div className="print-sign-space" />
                  <div className="print-sign-name">Direktur / Project Owner</div>
                  <div className="print-sign-role">DAT — Noir Living Indonesia</div>
                </div>
              </div>

              <div className="print-footer">
                Dokumen ini dicetak otomatis dari Internal Purchasing App — Noir Living Indonesia · {formatTanggalPanjang(printDate)}
              </div>
            </div>
          </div>
        </div>
        </div>,
        document.body
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
