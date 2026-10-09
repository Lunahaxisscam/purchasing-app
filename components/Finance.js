import React, { useMemo, useState } from 'react'
import { rupiah, format } from '../lib/constants'

// ============================================================
// Modul FINANCE — khusus role admin.
// Tahap struktur: ringkasan keuangan dari data pengadaan yang ada
// (nilai PR, purchase riil, dan selisihnya), dikelompokkan per project.
// Sumber: purchase_requests + pr_items (estimated_price) + receivings
// (nominal riil di kolom note) + projects.
// ============================================================

function parseNominalFromNote(note) {
  const s = String(note || '')
  const m = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const digits = m[1].replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

export default function Finance({ rows }) {
  const [view, setView] = useState('summary')

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
          <span>Selisih (Riil − Estimasi)</span>
          <strong style={{ fontSize: '22px', color: data.totalReal - data.totalEst > 0 ? '#b91c1c' : '#0d6e38' }}>
            {data.totalReal === 0 ? '—' : rupiah(data.totalReal - data.totalEst)}
          </strong>
          <small>{data.totalReal === 0 ? 'belum ada purchase bernominal' : 'positif = lebih mahal dari estimasi'}</small>
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
        </div>
      </div>

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

      {/* Kartu mobile */}
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
    </>
  )
}
