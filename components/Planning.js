import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  rupiah,
  formatRibuan,
  persen,
  formatNominalInput,
  PLANNING_STATUSES,
  planningStatusStyle,
  volumeText,
  normalizeStatus
} from '../lib/constants'

// ============================================================
// Modul PROJECT PLANNING — khusus role admin (adminOnly).
// WBS per proyek: daftar pekerjaan per area, volume & satuan,
// penugasan pekerja/tukang, estimasi upah (borongan/harian),
// status progress, dan shortcut "+ Buat PR Material" ke modul
// Purchase Request (membuat PR DRAFT + item otomatis terisi).
//
// Tabel DB: public.project_plans (RLS admin-only).
// ============================================================

const UNIT_OPTIONS = ['unit', 'm1', 'm2', 'm3', 'ls', 'titik', 'set', 'pcs', 'kg', 'liter']

const emptyForm = {
  id: null,
  area: '',
  item_name: '',
  volume: '1',
  unit: 'unit',
  spec: '',
  worker_name: '',
  worker_type: 'borongan',
  labor_cost: '',
  status: 'Perencanaan',
  progress: '0',
  target_start: '',
  target_end: ''
}

function digitsOnly(v) {
  const d = String(v ?? '').replace(/[^\d]/g, '')
  return d ? Number(d) : 0
}

export default function Planning({ rows, say, setPage, refresh }) {
  const allProjects = rows?.projects || []
  const [plans, setPlans] = useState([])
  const [costData, setCostData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [modal, setModal] = useState(null)   // null | { mode: 'add' | 'edit', form }
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [prBusyId, setPrBusyId] = useState(null)

  // Proyek aktif (belum DONE), urut nomor kode numerik.
  const activeProjects = useMemo(() => {
    return allProjects
      .filter(p => normalizeStatus(p.status) !== 'DONE')
      .sort((a, b) => {
        const na = parseInt(a.kode, 10)
        const nb = parseInt(b.kode, 10)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return (a.kode || '').localeCompare(b.kode || '')
      })
  }, [allProjects])

  // Pilih proyek pertama otomatis saat data siap.
  useEffect(() => {
    if (!projectId && activeProjects.length) setProjectId(activeProjects[0].id)
  }, [activeProjects, projectId])

  const loadPlans = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    try {
      const [plansRes, costRes] = await Promise.all([
        supabase
          .from('project_plans')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase
          .from('project_cost_summary')
          .select('*')
      ])
      if (plansRes.error) setError(plansRes.error.message)
      else setPlans(plansRes.data || [])

      if (costRes.error) {
        console.warn('Gagal memuat project_cost_summary:', costRes.error.message)
      } else {
        setCostData(costRes.data || [])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadPlans() }, [loadPlans])

  const project = activeProjects.find(p => p.id === projectId) || allProjects.find(p => p.id === projectId)

  // Data project_cost_summary yang cocok dengan proyek aktif (berdasarkan project_no == p.kode)
  const activeCost = useMemo(() => {
    if (!project || !costData.length) return null
    const key = String(project.kode || '').trim()
    if (!key) return null
    return costData.find(c => {
      const cNo = String(c.project_no || '').trim()
      if (cNo === key) return true
      const na = parseInt(cNo, 10)
      const nb = parseInt(key, 10)
      return !isNaN(na) && !isNaN(nb) && na === nb
    }) || null
  }, [project, costData])

  const projectPlans = useMemo(
    () => plans.filter(pl => pl.project_id === projectId),
    [plans, projectId]
  )

  // Statistik cepat WBS proyek terpilih
  const stats = useMemo(() => {
    const total = projectPlans.length
    const labor = projectPlans.reduce((s, pl) => s + (Number(pl.labor_cost) || 0), 0)
    const avgProgress = total
      ? Math.round(projectPlans.reduce((s, pl) => s + (Number(pl.progress) || 0), 0) / total)
      : 0
    const selesai = projectPlans.filter(pl => pl.status === 'Selesai').length

    return {
      total,
      labor,
      avgProgress,
      selesai
    }
  }, [projectPlans])

  // Kalkulasi pagu anggaran historis Noir Living & perbandingan Pagu vs Realisasi Riil
  const budget = useMemo(() => {
    const revenueVal = Number(activeCost?.revenue)
    const revenue = !isNaN(revenueVal) && revenueVal > 0 ? revenueVal : 0

    // 1. Plafon 4-Pilar (Patokan Historis DAT / Noir Living)
    const budgetMaterial = Math.round(revenue * 0.50)
    const budgetManpower = Math.round(revenue * 0.25)
    const budgetOperasional = Math.round(revenue * 0.10)
    const targetMargin = Math.round(revenue * 0.15)

    // 2. Realisasi Riil
    const matVal = Number(activeCost?.cumulative_cost)
    const realMaterial = !isNaN(matVal) && matVal > 0 ? matVal : 0

    const labVal = Number(stats?.labor)
    const realLabor = !isNaN(labVal) && labVal > 0 ? labVal : 0

    const opsVal = Number(activeCost?.petty_cash)
    const realOperasional = !isNaN(opsVal) && opsVal > 0 ? opsVal : 0

    const realTotalCost = realMaterial + realLabor + realOperasional
    const realMargin = revenue - realTotalCost

    // 3. Deteksi Anomali
    const isMaterialOver = revenue > 0 && realMaterial > budgetMaterial
    const isLaborOver = revenue > 0 && realLabor > budgetManpower
    const isOperasionalOver = revenue > 0 && realOperasional > budgetOperasional
    const isMarginThin = revenue > 0 && realMargin < targetMargin

    // 4. Variansi & Sisa Kuota Budget (Aman dari NaN & Div by Zero)
    const isLaborOverBudget = isLaborOver
    const laborVariance = realLabor - budgetManpower
    const laborRemaining = budgetManpower - realLabor
    const laborPct = revenue > 0 ? (realLabor / revenue) * 100 : 0
    const laborUsageOfPlafon = budgetManpower > 0 ? (realLabor / budgetManpower) * 100 : 0

    const isMaterialOverBudget = isMaterialOver
    const materialVariance = realMaterial - budgetMaterial
    const materialRemaining = budgetMaterial - realMaterial
    const materialPct = revenue > 0 ? (realMaterial / revenue) * 100 : 0
    const materialUsageOfPlafon = budgetMaterial > 0 ? (realMaterial / budgetMaterial) * 100 : 0

    const isOperasionalOverBudget = isOperasionalOver
    const operasionalVariance = realOperasional - budgetOperasional
    const operasionalRemaining = budgetOperasional - realOperasional
    const operasionalPct = revenue > 0 ? (realOperasional / revenue) * 100 : 0
    const operasionalUsageOfPlafon = budgetOperasional > 0 ? (realOperasional / budgetOperasional) * 100 : 0

    const isMarginUnderTarget = isMarginThin
    const marginVariance = realMargin - targetMargin
    const marginDeficit = targetMargin - realMargin
    const marginPct = revenue > 0 ? (realMargin / revenue) * 100 : 0
    const marginAchievement = targetMargin > 0 ? (realMargin / targetMargin) * 100 : 0

    // 5. Rangkuman Anomali untuk Banner Peringatan
    const anomalies = []
    if (revenue > 0) {
      if (isMaterialOver) {
        anomalies.push({
          pillar: 'Material',
          title: '1. Material (50% max)',
          icon: '📦',
          pagu: budgetMaterial,
          actual: realMaterial,
          diff: materialVariance,
          diffFormatted: `+${rupiah(materialVariance)}`,
          statusBadge: `⚠️ Over-Budget (+${rupiah(materialVariance)})`,
          pct: materialPct,
          usagePct: materialUsageOfPlafon,
          message: `Belanja material riil ${rupiah(realMaterial)} (${persen(materialPct, 1)} dari revenue) melebihi batas pagu 50% (${rupiah(budgetMaterial)}).`,
          recommendation: 'Audit rincian item PR Material dan verifikasi harga nota belanja lapangan.'
        })
      }
      if (isLaborOver) {
        anomalies.push({
          pillar: 'Manpower',
          title: '2. Upah Tukang (25% max)',
          icon: '👷',
          pagu: budgetManpower,
          actual: realLabor,
          diff: laborVariance,
          diffFormatted: `+${rupiah(laborVariance)}`,
          statusBadge: `⚠️ Over-Budget (+${rupiah(laborVariance)})`,
          pct: laborPct,
          usagePct: laborUsageOfPlafon,
          message: `Estimasi upah WBS ${rupiah(realLabor)} (${persen(laborPct, 1)} dari revenue) melebihi batas pagu 25% (${rupiah(budgetManpower)}).`,
          recommendation: 'Tinjau kembali rincian pekerjaan atau negosiasi ulang kesepakatan upah tukang borongan.'
        })
      }
      if (isOperasionalOver) {
        anomalies.push({
          pillar: 'Operasional',
          title: '3. Operasional (10% max)',
          icon: '⚡',
          pagu: budgetOperasional,
          actual: realOperasional,
          diff: operasionalVariance,
          diffFormatted: `+${rupiah(operasionalVariance)}`,
          statusBadge: `⚠️ Over-Budget (+${rupiah(operasionalVariance)})`,
          pct: operasionalPct,
          usagePct: operasionalUsageOfPlafon,
          message: `Petty cash operasional riil ${rupiah(realOperasional)} (${persen(operasionalPct, 1)} dari revenue) melebihi batas pagu 10% (${rupiah(budgetOperasional)}).`,
          recommendation: 'Perketat pengeluaran kas kecil proyek dan batasi bon operasional non-esensial.'
        })
      }
      if (isMarginThin) {
        anomalies.push({
          pillar: 'Margin',
          title: '4. Target Margin (15% min)',
          icon: '📈',
          pagu: targetMargin,
          actual: realMargin,
          diff: marginDeficit,
          diffFormatted: `-${rupiah(marginDeficit)}`,
          statusBadge: `⚠️ Defisit Margin (-${rupiah(marginDeficit)})`,
          pct: marginPct,
          usagePct: marginAchievement,
          message: `Estimasi margin riil ${rupiah(realMargin)} (${persen(marginPct, 1)} dari revenue) berada di bawah target minimal 15% (${rupiah(targetMargin)}).`,
          recommendation: 'Evaluasi total biaya material, upah, dan petty cash untuk memulihkan margin keuntungan proyek.'
        })
      }
    }
    const hasAnomaly = anomalies.length > 0

    return {
      revenue,

      // Plafon 4-Pilar
      budgetMaterial,
      budgetManpower,
      budgetOperasional,
      targetMargin,

      // Realisasi Riil
      realMaterial,
      realLabor,
      realOperasional,
      realTotalCost,
      realMargin,

      // Flags Anomali
      isMaterialOver,
      isMaterialOverBudget,
      isLaborOver,
      isLaborOverBudget,
      isOperasionalOver,
      isOperasionalOverBudget,
      isMarginThin,
      isMarginUnderTarget,
      hasAnomaly,
      anomalies,

      // Sisa & Variansi Kuota Budget
      materialVariance,
      materialRemaining,
      materialPct,
      materialUsageOfPlafon,
      laborVariance,
      laborRemaining,
      laborPct,
      laborUsageOfPlafon,
      operasionalVariance,
      operasionalRemaining,
      operasionalPct,
      operasionalUsageOfPlafon,
      marginVariance,
      marginDeficit,
      marginPct,
      marginAchievement,

      costSummary: activeCost
    }
  }, [activeCost, stats.labor])

  // Sinkronkan ke stats untuk kompatibilitas penuh dengan pemanggilan legacy
  Object.assign(stats, budget)

  function openAdd() {
    if (!projectId) { say('Pilih proyek dulu sebelum menambah pekerjaan.'); return }
    setModal({ mode: 'add', form: { ...emptyForm } })
  }

  function openEdit(plan) {
    setModal({
      mode: 'edit',
      form: {
        id: plan.id,
        area: plan.area || '',
        item_name: plan.item_name || '',
        volume: plan.volume !== null && plan.volume !== undefined ? String(plan.volume) : '1',
        unit: plan.unit || 'unit',
        spec: plan.spec || '',
        worker_name: plan.worker_name || '',
        worker_type: plan.worker_type || 'borongan',
        labor_cost: plan.labor_cost ? formatNominalInput(String(Math.round(Number(plan.labor_cost)))) : '',
        status: plan.status || 'Perencanaan',
        progress: String(plan.progress ?? 0),
        target_start: plan.target_start || '',
        target_end: plan.target_end || ''
      }
    })
  }

  function setFormField(name, value) {
    setModal(m => {
      if (!m) return m
      const form = { ...m.form, [name]: value }
      // Status "Selesai" otomatis menuntaskan progress.
      if (name === 'status' && value === 'Selesai') form.progress = '100'
      return { ...m, form }
    })
  }

  async function savePlan(e) {
    e.preventDefault()
    if (!supabase || saving || !modal) return
    const f = modal.form
    if (!f.area.trim() || !f.item_name.trim()) {
      say('Area dan Nama Item wajib diisi.')
      return
    }
    setSaving(true)
    try {
      const progress = Math.max(0, Math.min(100, Math.round(Number(f.progress) || 0)))
      const payload = {
        project_id: projectId,
        area: f.area.trim(),
        item_name: f.item_name.trim(),
        volume: Number(f.volume) || 0,
        unit: f.unit || 'unit',
        spec: f.spec.trim() || null,
        worker_name: f.worker_name.trim() || null,
        worker_type: f.worker_type || 'borongan',
        labor_cost: digitsOnly(f.labor_cost),
        status: f.status || 'Perencanaan',
        progress: f.status === 'Selesai' ? 100 : progress,
        target_start: f.target_start || null,
        target_end: f.target_end || null
      }

      if (modal.mode === 'edit' && f.id) {
        const { error: err } = await supabase.from('project_plans').update(payload).eq('id', f.id)
        if (err) { say(`Gagal menyimpan perubahan: ${err.message}`); return }
        say(`Pekerjaan "${payload.item_name}" berhasil diperbarui.`)
      } else {
        const { error: err } = await supabase.from('project_plans').insert(payload)
        if (err) { say(`Gagal menambah pekerjaan: ${err.message}`); return }
        say(`Pekerjaan "${payload.item_name}" (${payload.area}) berhasil ditambahkan.`)
      }
      setModal(null)
      await loadPlans()
    } finally {
      setSaving(false)
    }
  }

  async function deletePlan(plan) {
    if (!supabase || busyId) return
    const ok = window.confirm(`Hapus pekerjaan "${plan.item_name}" (${plan.area})? Tindakan ini tidak bisa dibatalkan.`)
    if (!ok) return
    setBusyId(plan.id)
    try {
      const { error: err } = await supabase.from('project_plans').delete().eq('id', plan.id)
      if (err) { say(`Gagal menghapus: ${err.message}`); return }
      say(`Pekerjaan "${plan.item_name}" dihapus.`)
      await loadPlans()
    } finally {
      setBusyId(null)
    }
  }

  // Shortcut "+ Buat PR Material": membuat PR DRAFT + 1 item terisi otomatis
  // (mengikuti konvensi modul Purchase Request: status DRAFT, item
  // PENDING_APPROVAL, nomor dari RPC next_pr_number).
  async function createPrFromPlan(plan) {
    if (!supabase || prBusyId) return
    const proj = allProjects.find(p => p.id === plan.project_id)
    const projLabel = proj ? (proj.kode ? `[${proj.kode}] ${proj.name}` : proj.name) : 'proyek'
    const summary = `${plan.volume ?? ''} ${plan.unit || ''} ${plan.item_name}`.replace(/\s+/g, ' ').trim()
    const ok = window.confirm(
      `Buat Purchase Request material untuk:\n\n"${summary}"\nProyek: ${projLabel}\n\nPR dibuat sebagai DRAFT dan otomatis terisi 1 item material. Lanjutkan di modul Purchase Request.`
    )
    if (!ok) return

    setPrBusyId(plan.id)
    try {
      // Nomor PR atomic (advisory lock di DB); fallback aman bila RPC gagal.
      let prNumber = null
      try {
        const { data: rpcNum, error: rpcErr } = await supabase.rpc('next_pr_number')
        if (!rpcErr && rpcNum) prNumber = String(rpcNum)
      } catch (e) { /* fallback di bawah */ }
      if (!prNumber) {
        // Fallback terakhir bila RPC tidak tersedia: baca PR dengan nomor
        // TERBESAR (order numerik + limit 1) supaya tidak terpotong limit
        // default PostgREST dan tidak salah ambil format.
        const { data: lastPr } = await supabase.from('purchase_requests')
          .select('pr_number')
          .not('pr_number', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200)
        const maxNum = (lastPr || []).reduce((max, p) => {
          const n = parseInt(String(p.pr_number || '').replace(/^\D+/, ''), 10)
          return isFinite(n) && n > max ? n : max
        }, 0)
        prNumber = 'PR-' + String(maxNum + 1).padStart(3, '0')
      }

      const { data: inserted, error: prErr } = await supabase.from('purchase_requests').insert({
        project_id: plan.project_id || null,
        title: `Material: ${plan.item_name}`,
        pr_number: prNumber,
        priority: 'NORMAL',
        status: 'DRAFT',
        materials_summary: summary,
        notes: `Dari Project Planning — ${plan.area}${plan.spec ? ` (${plan.spec})` : ''}`
      }).select().single()

      if (prErr) {
        // Nomor bentrok (balapan) → ambil nomor baru sekali lalu retry.
        if (String(prErr.code) === '23505') {
          const { data: rp } = await supabase.rpc('next_pr_number')
          if (rp) {
            const retry = await supabase.from('purchase_requests').insert({
              project_id: plan.project_id || null,
              title: `Material: ${plan.item_name}`,
              pr_number: String(rp),
              priority: 'NORMAL',
              status: 'DRAFT',
              materials_summary: summary,
              notes: `Dari Project Planning — ${plan.area}${plan.spec ? ` (${plan.spec})` : ''}`
            }).select().single()
            if (retry.error) { say(`Gagal membuat PR: ${retry.error.message}`); return }
            await finishPrItem(retry.data, plan, summary)
            return
          }
        }
        say(`Gagal membuat PR: ${prErr.message}`)
        return
      }

      await finishPrItem(inserted, plan, summary)
    } catch (err) {
      say(`Terjadi kesalahan saat membuat PR: ${err.message}`)
    } finally {
      setPrBusyId(null)
    }
  }

  async function finishPrItem(insertedPr, plan, summary) {
    const { error: itemErr } = await supabase.from('pr_items').insert({
      pr_id: insertedPr.id,
      material_id: null,
      item_name: plan.item_name,
      kode: '',
      unit: plan.unit || 'unit',
      // Volume 0 / kosong → pakai 1 supaya qty PR tidak pernah 0.
      quantity: Number.isFinite(Number(plan.volume)) && Number(plan.volume) > 0 ? Number(plan.volume) : 1,
      status: 'PENDING_APPROVAL',
      supplier_category: null,
      vendor_id: null,
      estimated_price: null,
      sort_order: 0
    })
    if (itemErr) {
      say(`PR ${insertedPr.pr_number} dibuat, tapi item gagal disimpan: ${itemErr.message}. Buka modul Purchase Request untuk melengkapi.`)
    } else {
      say(`PR ${insertedPr.pr_number} berhasil dibuat (DRAFT) untuk "${plan.item_name}" — ${summary}. Lanjutkan di modul Purchase Request (klik "✓ Selesai" untuk kirim ke Approval).`)
    }
    // Muat ulang data app DULU supaya PR baru langsung terlihat di modul
    // Purchase Request (mencegah user mengira gagal lalu klik lagi → PR duplikat).
    try { if (refresh) await refresh() } catch (e) { /* navigasi tetap lanjut */ }
    setPage && setPage('requests')
  }

  return (
    <>
      {/* Kartu statistik cepat proyek */}
      <div className="cards">
        <div className="card">
          <span>Total Item Pekerjaan</span>
          <strong>{stats.total}</strong>
          <small>{stats.selesai} item selesai</small>
        </div>
        <div className="card" style={budget.isLaborOver ? { borderColor: '#fca5a5', background: '#fffafa' } : {}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Estimasi Upah Tukang (WBS)</span>
            {budget.revenue > 0 && (
              <span className={`badge ${budget.isLaborOver ? 'status-REJECTED' : 'status-APPROVED'}`} style={{ fontSize: '10px' }}>
                {budget.isLaborOver ? '⚠️ OVER-BUDGET' : '✓ ON-TRACK'}
              </span>
            )}
          </div>
          <strong style={{ fontSize: '22px', color: budget.isLaborOver ? '#dc2626' : 'inherit' }}>
            {rupiah(stats.labor)}
          </strong>
          <small>
            {budget.revenue > 0
              ? `${persen(budget.laborPct, 1)} dari revenue (plafon 25%: ${rupiah(budget.budgetManpower)})`
              : 'total labor cost planning proyek ini'}
          </small>
        </div>
        <div className="card">
          <span>Progress Rata-rata</span>
          <strong>{stats.avgProgress}%</strong>
          <small>dari {stats.total} item pekerjaan</small>
        </div>
      </div>

      {/* Header & filter proyek */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#3b504b' }}>
            Proyek Aktif ({activeProjects.length})
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              style={{ minWidth: '280px', padding: '9px 13px', fontSize: '13px' }}
            >
              {activeProjects.length === 0 && <option value="">— belum ada proyek aktif —</option>}
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
          <button type="button" className="outline" onClick={loadPlans} style={{ padding: '9px 14px', fontSize: '13px' }}>
            ↻ Perbarui
          </button>
          <button type="button" className="btn-create-module" onClick={openAdd}>
            + Tambah Pekerjaan
          </button>
        </div>
      </div>

      {error && (
        <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>
          Gagal memuat data planning: {error}
        </div>
      )}

      {/* ============================================================
          PANEL KONTROL ANGGARAN & PAGU HISTORIS (NOIR LIVING)
          Patokan: Material 50% max · Manpower 25% max · Ops 10% · Margin 15%
          Ditempatkan di atas tabel WBS
          ============================================================ */}
      <div className={`panel budget-control-panel ${budget.hasAnomaly ? 'has-anomaly' : ''}`}>
        {/* Header Panel */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px', paddingBottom: '14px', borderBottom: '1px solid var(--border-light)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#142320', fontFamily: 'var(--font-heading)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🎯 Kontrol Anggaran &amp; Pagu Historis</span>
              </h3>
              <span className="badge" style={{ background: '#e6ece9', color: '#2d4a43', fontSize: '11px', fontWeight: 650 }}>
                Patokan: Material 50% · Upah 25% · Ops 10% · Margin 15%
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: '#6b7e79' }}>
              Perbandingan Pagu Historis vs Pengeluaran Riil di lapangan untuk proyek <strong>{project ? (project.kode ? `[${project.kode}] ${project.name}` : project.name) : '—'}</strong>
            </p>
          </div>

          <div>
            {budget.revenue > 0 ? (
              budget.hasAnomaly ? (
                <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontSize: '12px', padding: '6px 12px', fontWeight: 800 }}>
                  ⚠️ {budget.anomalies.length} ANOMALI ANGGARAN TERDETEKSI
                </span>
              ) : (
                <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontSize: '12px', padding: '6px 12px', fontWeight: 750 }}>
                  ✓ Semua 4-Pilar Aman (Margin {persen(budget.marginPct, 1)})
                </span>
              )
            ) : (
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '12px', padding: '6px 12px', fontWeight: 700 }}>
                Revenue belum diset di Rekap Cost
              </span>
            )}
          </div>
        </div>

        {/* Ringkasan Kontrak & Total Realisasi Biaya (Overview Strip) */}
        <div className="budget-overview-strip">
          <div className="budget-overview-item">
            <span className="budget-overview-label">Nilai Kontrak (Revenue)</span>
            <div className="budget-overview-val">
              {budget.revenue > 0 ? rupiah(budget.revenue) : 'Belum Diset'}
              {budget.revenue > 0 && <small>Basis 100%</small>}
            </div>
          </div>
          <div className="budget-overview-item">
            <span className="budget-overview-label">Total Realisasi Biaya</span>
            <div className="budget-overview-val">
              {rupiah(budget.realTotalCost)}
              {budget.revenue > 0 && (
                <small style={{ color: budget.realTotalCost > (budget.revenue * 0.85) ? '#b91c1c' : '#556b65' }}>
                  ({persen((budget.realTotalCost / budget.revenue) * 100, 1)})
                </small>
              )}
            </div>
          </div>
          <div className="budget-overview-item">
            <span className="budget-overview-label">Estimasi Margin Riil</span>
            <div className={`budget-overview-val ${budget.isMarginThin ? 'danger-text' : (budget.revenue > 0 ? 'success-text' : '')}`}>
              {budget.revenue > 0 ? rupiah(budget.realMargin) : '—'}
              {budget.revenue > 0 && (
                <small style={{ color: budget.isMarginThin ? '#b91c1c' : '#0d6e38' }}>
                  ({persen(budget.marginPct, 1)})
                </small>
              )}
            </div>
          </div>
          <div className="budget-overview-item">
            <span className="budget-overview-label">Status Anggaran</span>
            <div style={{ marginTop: '2px' }}>
              {budget.revenue > 0 ? (
                budget.hasAnomaly ? (
                  <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', fontSize: '11px', fontWeight: 800 }}>
                    🚨 {budget.anomalies.length} Pilar Over-Budget / Defisit
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontSize: '11px', fontWeight: 750 }}>
                    ✓ Sesuai Pagu Historis
                  </span>
                )
              ) : (
                <span className="badge" style={{ background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: 650 }}>
                  Menunggu Nilai Kontrak
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Banner Peringatan Rangkuman Anomali */}
        {budget.revenue > 0 && budget.hasAnomaly && (
          <div className="budget-anomaly-summary-banner">
            <div className="anomaly-banner-top">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '24px', lineHeight: 1 }}>⚠️</span>
                <div>
                  <div className="anomaly-banner-title">
                    PERINGATAN RANGKUMAN ANOMALI ANGGARAN ({budget.anomalies.length} PILAR TERDETEKSI)
                  </div>
                  <div className="anomaly-banner-subtitle">
                    Pengeluaran riil lapangan telah melampaui batas pagu historis Noir Living. Mohon evaluasi segera sebelum menyetujui WBS baru atau pengajuan PR material.
                  </div>
                </div>
              </div>
              <span className="badge badge-anomaly-glow" style={{ background: '#b91c1c', color: '#ffffff', fontWeight: 800, fontSize: '11px', padding: '6px 14px', alignSelf: 'flex-start' }}>
                OVER-BUDGET ALERT
              </span>
            </div>

            <div className="anomaly-items-grid">
              {budget.anomalies.map((anom, idx) => (
                <div key={idx} className="anomaly-item-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 750, fontSize: '12px', color: '#991b1b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>{anom.icon}</span> {anom.title}
                    </span>
                    <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', fontWeight: 800, fontSize: '10.5px' }}>
                      {anom.pillar === 'Margin' ? `Defisit ${anom.diffFormatted}` : `Over ${anom.diffFormatted}`}
                    </span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#7f1d1d', lineHeight: 1.4, marginBottom: '6px' }}>
                    {anom.message}
                  </div>
                  <div style={{ fontSize: '11px', color: '#991b1b', background: '#fff5f5', padding: '5px 8px', borderRadius: '4px', border: '1px solid #fecaca' }}>
                    <strong>💡 Rekomendasi:</strong> {anom.recommendation}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grid 4 Kartu Kontrol Pagu Anggaran */}
        <div className="budget-cards-grid">
          {/* 1. Material (50% max) */}
          <div className={`budget-card card-material ${budget.isMaterialOver ? 'is-anomaly' : (budget.revenue > 0 ? 'is-on-track' : '')}`}>
            <div>
              <div className="budget-card-header">
                <span className="budget-card-title">1. Material (50% max)</span>
                <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '10px', fontWeight: 700 }}>50% Max</span>
              </div>
              <div>
                <div className="budget-card-nominal">
                  {budget.revenue > 0 ? rupiah(budget.budgetMaterial) : '—'}
                </div>
                <div className="budget-card-sub">
                  Batas Pagu (Maksimal Rp)
                </div>
              </div>

              <div className="budget-card-details">
                <div className="budget-detail-row">
                  <span className="budget-detail-label">Pengeluaran Riil:</span>
                  <span className={`budget-detail-val ${budget.isMaterialOver ? 'danger-text' : ''}`}>
                    {rupiah(budget.realMaterial)}
                  </span>
                </div>
                <div className="budget-detail-row">
                  <span className="budget-detail-label">{budget.isMaterialOver ? 'Over-Budget:' : 'Sisa Kuota Budget:'}</span>
                  <span className={`budget-detail-val ${budget.isMaterialOver ? 'danger-text' : 'success-text'}`}>
                    {budget.revenue > 0 ? (
                      budget.isMaterialOver ? `+${rupiah(budget.materialVariance)}` : rupiah(budget.materialRemaining)
                    ) : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div>
                {budget.revenue > 0 ? (
                  budget.isMaterialOver ? (
                    <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontWeight: 800, fontSize: '10.5px', whiteSpace: 'normal', lineHeight: 1.3, display: 'block', padding: '5px 8px', textAlign: 'center' }}>
                      ⚠️ Over-Budget (+{rupiah(budget.materialVariance)})
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontWeight: 750, fontSize: '11px', display: 'block', textAlign: 'center', padding: '4px 8px' }}>
                      ✓ Aman ({persen(budget.materialUsageOfPlafon, 0)} pagu)
                    </span>
                  )
                ) : (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '10.5px', display: 'block', textAlign: 'center' }}>
                    Riil: {rupiah(budget.realMaterial)}
                  </span>
                )}
              </div>

              {budget.revenue > 0 && (
                <div className="budget-progress-track" title={`Pemakaian Material: ${persen(budget.materialUsageOfPlafon, 1)} dari pagu 50%`}>
                  <div
                    className="budget-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, budget.materialUsageOfPlafon))}%`,
                      background: budget.isMaterialOver ? '#dc2626' : '#0284c7'
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 2. Manpower (25% max) */}
          <div className={`budget-card card-manpower ${budget.isLaborOver ? 'is-anomaly' : (budget.revenue > 0 ? 'is-on-track' : '')}`}>
            <div>
              <div className="budget-card-header">
                <span className="budget-card-title">2. Manpower (25% max)</span>
                <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', fontSize: '10px', fontWeight: 700 }}>25% Max</span>
              </div>
              <div>
                <div className={`budget-card-nominal ${budget.isLaborOver ? 'danger-text' : ''}`}>
                  {budget.revenue > 0 ? rupiah(budget.budgetManpower) : '—'}
                </div>
                <div className="budget-card-sub">
                  Batas Pagu (Maksimal Rp)
                </div>
              </div>

              <div className="budget-card-details">
                <div className="budget-detail-row">
                  <span className="budget-detail-label">Pengeluaran Riil (WBS):</span>
                  <span className={`budget-detail-val ${budget.isLaborOver ? 'danger-text' : ''}`}>
                    {rupiah(budget.realLabor)}
                  </span>
                </div>
                <div className="budget-detail-row">
                  <span className="budget-detail-label">{budget.isLaborOver ? 'Over-Budget:' : 'Sisa Kuota Budget:'}</span>
                  <span className={`budget-detail-val ${budget.isLaborOver ? 'danger-text' : 'success-text'}`}>
                    {budget.revenue > 0 ? (
                      budget.isLaborOver ? `+${rupiah(budget.laborVariance)}` : rupiah(budget.laborRemaining)
                    ) : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div>
                {budget.revenue > 0 ? (
                  budget.isLaborOver ? (
                    <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontWeight: 800, fontSize: '10.5px', whiteSpace: 'normal', lineHeight: 1.3, display: 'block', padding: '5px 8px', textAlign: 'center' }}>
                      ⚠️ Over-Budget (+{rupiah(budget.laborVariance)})
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontWeight: 750, fontSize: '11px', display: 'block', textAlign: 'center', padding: '4px 8px' }}>
                      ✓ Aman ({persen(budget.laborUsageOfPlafon, 0)} pagu)
                    </span>
                  )
                ) : (
                  budget.realLabor > 0 ? (
                    <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '10.5px', display: 'block', textAlign: 'center' }}>
                      WBS: {rupiah(budget.realLabor)}
                    </span>
                  ) : (
                    <span className="badge status-DRAFT" style={{ fontSize: '10.5px', display: 'block', textAlign: 'center' }}>Belum ada WBS</span>
                  )
                )}
              </div>

              {budget.revenue > 0 && (
                <div className="budget-progress-track" title={`Pemakaian Upah: ${persen(budget.laborUsageOfPlafon, 1)} dari pagu 25%`}>
                  <div
                    className="budget-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, budget.laborUsageOfPlafon))}%`,
                      background: budget.isLaborOver ? '#dc2626' : '#0d9488'
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 3. Operasional (10% max) */}
          <div className={`budget-card card-operasional ${budget.isOperasionalOver ? 'is-anomaly' : (budget.revenue > 0 ? 'is-on-track' : '')}`}>
            <div>
              <div className="budget-card-header">
                <span className="budget-card-title">3. Operasional (10% max)</span>
                <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: '10px', fontWeight: 700 }}>10% Max</span>
              </div>
              <div>
                <div className={`budget-card-nominal ${budget.isOperasionalOver ? 'danger-text' : ''}`}>
                  {budget.revenue > 0 ? rupiah(budget.budgetOperasional) : '—'}
                </div>
                <div className="budget-card-sub">
                  Batas Pagu (Maksimal Rp)
                </div>
              </div>

              <div className="budget-card-details">
                <div className="budget-detail-row">
                  <span className="budget-detail-label">Pengeluaran Riil (Petty Cash):</span>
                  <span className={`budget-detail-val ${budget.isOperasionalOver ? 'danger-text' : ''}`}>
                    {rupiah(budget.realOperasional)}
                  </span>
                </div>
                <div className="budget-detail-row">
                  <span className="budget-detail-label">{budget.isOperasionalOver ? 'Over-Budget:' : 'Sisa Kuota Budget:'}</span>
                  <span className={`budget-detail-val ${budget.isOperasionalOver ? 'danger-text' : 'success-text'}`}>
                    {budget.revenue > 0 ? (
                      budget.isOperasionalOver ? `+${rupiah(budget.operasionalVariance)}` : rupiah(budget.operasionalRemaining)
                    ) : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div>
                {budget.revenue > 0 ? (
                  budget.isOperasionalOver ? (
                    <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontWeight: 800, fontSize: '10.5px', whiteSpace: 'normal', lineHeight: 1.3, display: 'block', padding: '5px 8px', textAlign: 'center' }}>
                      ⚠️ Over-Budget (+{rupiah(budget.operasionalVariance)})
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontWeight: 750, fontSize: '11px', display: 'block', textAlign: 'center', padding: '4px 8px' }}>
                      ✓ Aman ({persen(budget.operasionalUsageOfPlafon, 0)} pagu)
                    </span>
                  )
                ) : (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '10.5px', display: 'block', textAlign: 'center' }}>
                    Petty Cash: {rupiah(budget.realOperasional)}
                  </span>
                )}
              </div>

              {budget.revenue > 0 && (
                <div className="budget-progress-track" title={`Pemakaian Ops: ${persen(budget.operasionalUsageOfPlafon, 1)} dari pagu 10%`}>
                  <div
                    className="budget-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, budget.operasionalUsageOfPlafon))}%`,
                      background: budget.isOperasionalOver ? '#dc2626' : '#d97706'
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 4. Target Margin (15% min) */}
          <div className={`budget-card card-margin ${budget.isMarginThin ? 'is-anomaly' : (budget.revenue > 0 ? 'is-on-track' : '')}`}>
            <div>
              <div className="budget-card-header">
                <span className="budget-card-title">4. Target Margin (15%)</span>
                <span className="badge" style={{ background: '#dcfce7', color: '#15803d', fontSize: '10px', fontWeight: 700 }}>15% Min</span>
              </div>
              <div>
                <div className="budget-card-nominal" style={{ color: budget.revenue > 0 ? '#0d6e38' : 'inherit' }}>
                  {budget.revenue > 0 ? rupiah(budget.targetMargin) : '—'}
                </div>
                <div className="budget-card-sub">
                  Target Minimal (Pagu 15%)
                </div>
              </div>

              <div className="budget-card-details">
                <div className="budget-detail-row">
                  <span className="budget-detail-label">Estimasi Margin Riil:</span>
                  <span className={`budget-detail-val ${budget.isMarginThin ? 'danger-text' : 'success-text'}`}>
                    {budget.revenue > 0 ? rupiah(budget.realMargin) : '—'}
                  </span>
                </div>
                <div className="budget-detail-row">
                  <span className="budget-detail-label">{budget.isMarginThin ? 'Defisit Margin:' : 'Surplus Margin:'}</span>
                  <span className={`budget-detail-val ${budget.isMarginThin ? 'danger-text' : 'success-text'}`}>
                    {budget.revenue > 0 ? (
                      budget.isMarginThin ? `-${rupiah(budget.marginDeficit)}` : `+${rupiah(budget.marginVariance)}`
                    ) : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div>
                {budget.revenue > 0 ? (
                  budget.isMarginThin ? (
                    <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontWeight: 800, fontSize: '10.5px', whiteSpace: 'normal', lineHeight: 1.3, display: 'block', padding: '5px 8px', textAlign: 'center' }}>
                      ⚠️ Defisit Margin (-{rupiah(budget.marginDeficit)})
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontWeight: 750, fontSize: '11px', display: 'block', textAlign: 'center', padding: '4px 8px' }}>
                      ✓ Aman ({persen(budget.marginPct, 1)} rev)
                    </span>
                  )
                ) : (
                  <span className="badge status-DRAFT" style={{ fontSize: '10.5px', display: 'block', textAlign: 'center' }}>Target: 15%</span>
                )}
              </div>

              {budget.revenue > 0 && (
                <div className="budget-progress-track" title={`Pencapaian Margin: ${persen(budget.marginAchievement, 1)} dari target 15%`}>
                  <div
                    className="budget-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, budget.marginAchievement))}%`,
                      background: budget.isMarginThin ? '#dc2626' : '#16a34a'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Ringkasan Patokan Historis */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px dashed var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '11.5px', color: '#71817d' }}>
            <strong>Komposisi Pagu Total (100%):</strong> Material 50% ({budget.revenue > 0 ? rupiah(budget.budgetMaterial) : '50%'}) + Upah 25% ({budget.revenue > 0 ? rupiah(budget.budgetManpower) : '25%'}) + Ops 10% ({budget.revenue > 0 ? rupiah(budget.budgetOperasional) : '10%'}) + Margin 15% ({budget.revenue > 0 ? rupiah(budget.targetMargin) : '15%'}) = <strong>{budget.revenue > 0 ? rupiah(budget.revenue) : '100%'}</strong>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', fontWeight: 650, flexWrap: 'wrap' }}>
            <span style={{ color: budget.revenue > 0 && budget.isMaterialOver ? '#dc2626' : '#0284c7' }}>● Material 50% {budget.revenue > 0 ? (budget.isMaterialOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isLaborOver ? '#dc2626' : '#0d9488' }}>● Upah 25% {budget.revenue > 0 ? (budget.isLaborOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isOperasionalOver ? '#dc2626' : '#d97706' }}>● Ops 10% {budget.revenue > 0 ? (budget.isOperasionalOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isMarginThin ? '#dc2626' : '#16a34a' }}>● Margin 15% {budget.revenue > 0 ? (budget.isMarginThin ? '(Tipis)' : '(Aman)') : '(—)'}</span>
          </div>
        </div>
      </div>

      {/* Peringatan Anomali Aktif di atas Tabel WBS */}
      {budget.revenue > 0 && budget.hasAnomaly && (
        <div className="notice" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <span style={{ fontSize: '12.5px', fontWeight: 650 }}>
              <strong>Perhatian Pekerjaan WBS:</strong> Proyek ini memiliki <strong>{budget.anomalies.length} anomali anggaran</strong> ({budget.anomalies.map(a => a.pillar).join(', ')}). Hindari penambahan item pekerjaan baru yang tidak tercover addendum / revisi kontrak SPK.
            </span>
          </div>
          <span className="badge badge-anomaly-glow" style={{ background: '#b91c1c', color: '#ffffff', fontSize: '10.5px', fontWeight: 800, padding: '4px 10px' }}>
            {budget.anomalies.length} Anomali Aktif
          </span>
        </div>
      )}

      {/* Tabel WBS */}
      <div className="panel table desktop-table-view">
        <table>
          <thead>
            <tr>
              <th>Area</th>
              <th>Item Pekerjaan</th>
              <th>Volume &amp; Satuan</th>
              <th>Pekerja (Tukang)</th>
              <th style={{ textAlign: 'right' }}>Estimasi Upah</th>
              <th>Status Progress</th>
              <th style={{ width: '170px', textAlign: 'center' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="empty">Memuat data pekerjaan…</td></tr>
            ) : projectPlans.length ? projectPlans.map(pl => (
              <tr key={pl.id}>
                <td style={{ fontWeight: 600 }}>{pl.area || '—'}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: '240px' }}>
                  <div style={{ fontWeight: 600 }}>{pl.item_name || '—'}</div>
                  {pl.spec && <div style={{ fontSize: '11px', color: '#71817d', marginTop: '2px' }}>{pl.spec}</div>}
                  {(pl.target_start || pl.target_end) && (
                    <div style={{ fontSize: '11px', color: '#9aa8a4', marginTop: '2px' }}>
                      🗓 {pl.target_start || '—'} → {pl.target_end || '—'}
                    </div>
                  )}
                </td>
                <td>{volumeText(pl.volume, pl.unit)}</td>
                <td>
                  {pl.worker_name ? (
                    <>
                      <div style={{ fontWeight: 600 }}>{pl.worker_name}</div>
                      <div style={{ fontSize: '11px', color: '#71817d', textTransform: 'capitalize' }}>{pl.worker_type || 'borongan'}</div>
                    </>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(pl.labor_cost || 0)}</td>
                <td>
                  <span className="badge" style={{ ...planningStatusStyle(pl.status), display: 'inline-block' }}>{pl.status || 'Perencanaan'}</span>
                  <div style={{ marginTop: '5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ flex: 1, minWidth: '60px', height: '6px', background: '#edf2ef', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(0, Math.min(100, Number(pl.progress) || 0))}%`, height: '100%', background: (Number(pl.progress) || 0) >= 100 ? '#137333' : '#1a56c4' }} />
                    </div>
                    <small style={{ fontSize: '11px', color: '#556b65', fontWeight: 700 }}>{Number(pl.progress) || 0}%</small>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', width: '140px', margin: '0 auto' }}>
                    <button
                      type="button"
                      className="btn-finish"
                      disabled={prBusyId === pl.id}
                      onClick={() => createPrFromPlan(pl)}
                      style={{ fontSize: '10px', padding: '5px 6px', whiteSpace: 'nowrap' }}
                      title="Buat Purchase Request material dari item pekerjaan ini (otomatis terisi)"
                    >
                      {prBusyId === pl.id ? '⏳ Membuat…' : '+ Buat PR Material'}
                    </button>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <button type="button" className="btn-edit icon-btn" style={{ flex: 1 }} onClick={() => openEdit(pl)} title="Edit pekerjaan">✏️</button>
                      <button type="button" className="btn-delete icon-btn" style={{ flex: 1 }} disabled={busyId === pl.id} onClick={() => deletePlan(pl)} title="Hapus pekerjaan">🗑️</button>
                    </div>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="empty">
                {projectId
                  ? 'Belum ada item pekerjaan untuk proyek ini. Klik "+ Tambah Pekerjaan" untuk memulai WBS.'
                  : 'Pilih proyek aktif terlebih dahulu.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Kartu mobile */}
      <div className="mobile-cards-view">
        {loading ? (
          <div className="panel empty">Memuat data pekerjaan…</div>
        ) : projectPlans.length ? projectPlans.map(pl => (
          <div className="mobile-card" key={pl.id}>
            <div className="mobile-card-header">
              <div>
                <b className="mobile-card-title">{pl.item_name || '—'}</b>
                <div className="mobile-card-sub">{pl.area || '—'} · {volumeText(pl.volume, pl.unit)}</div>
              </div>
              <span className="badge" style={planningStatusStyle(pl.status)}>{pl.status || 'Perencanaan'}</span>
            </div>
            <div className="mobile-card-body">
              <div className="mobile-card-row"><span className="mobile-label">Pekerja:</span><span className="mobile-val">{pl.worker_name || '—'} ({pl.worker_type || 'borongan'})</span></div>
              <div className="mobile-card-row"><span className="mobile-label">Estimasi Upah:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{rupiah(pl.labor_cost || 0)}</span></div>
              <div className="mobile-card-row"><span className="mobile-label">Progress:</span><span className="mobile-val" style={{ fontWeight: 700 }}>{Number(pl.progress) || 0}%</span></div>
            </div>
            <div className="mobile-card-actions" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" className="btn-finish" disabled={prBusyId === pl.id} onClick={() => createPrFromPlan(pl)} style={{ fontSize: '11px', padding: '6px 10px' }}>
                {prBusyId === pl.id ? '⏳…' : '+ Buat PR Material'}
              </button>
              <button type="button" className="btn-edit icon-btn" onClick={() => openEdit(pl)}>✏️</button>
              <button type="button" className="btn-delete icon-btn" disabled={busyId === pl.id} onClick={() => deletePlan(pl)}>🗑️</button>
            </div>
          </div>
        )) : <div className="panel empty">Belum ada item pekerjaan untuk proyek ini.</div>}
      </div>

      {/* Modal Tambah/Edit Pekerjaan */}
      {modal && (
        <div className="modal">
          <form className="dialog dialog-wide" onSubmit={savePlan}>
            <div className="dialoghead">
              <h2>{modal.mode === 'edit' ? 'Edit Pekerjaan' : 'Tambah Pekerjaan'} — WBS</h2>
              <button type="button" className="icon" onClick={() => setModal(null)}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label>Area / Ruangan
                <input
                  type="text"
                  value={modal.form.area}
                  onChange={e => setFormField('area', e.target.value)}
                  placeholder="cth: Dapur, Kamar Utama, Living Room"
                  required
                />
              </label>
              <label>Nama Item Pekerjaan
                <input
                  type="text"
                  value={modal.form.item_name}
                  onChange={e => setFormField('item_name', e.target.value)}
                  placeholder="cth: Kabinet Atas, Wardrobe 4 Pintu"
                  required
                />
              </label>
              <label>Volume
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={modal.form.volume}
                  onChange={e => setFormField('volume', e.target.value)}
                />
              </label>
              <label>Satuan
                <select value={modal.form.unit} onChange={e => setFormField('unit', e.target.value)}>
                  {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </label>
              <label style={{ gridColumn: '1 / -1' }}>Spesifikasi Singkat (opsional)
                <input
                  type="text"
                  value={modal.form.spec}
                  onChange={e => setFormField('spec', e.target.value)}
                  placeholder="cth: Plywood 18mm, HPL Taco TH 120, Edging PVC"
                />
              </label>
              <label>Nama Pekerja (Tukang / Mandor)
                <input
                  type="text"
                  value={modal.form.worker_name}
                  onChange={e => setFormField('worker_name', e.target.value)}
                  placeholder="cth: Pak Yanto, Pak Slamet"
                />
              </label>
              <label>Tipe Upah
                <select value={modal.form.worker_type} onChange={e => setFormField('worker_type', e.target.value)}>
                  <option value="borongan">Borongan per Item</option>
                  <option value="harian">Harian</option>
                </select>
              </label>
              <label>Estimasi Upah (Rp)
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="cth: 1.500.000"
                  value={modal.form.labor_cost}
                  onChange={e => setFormField('labor_cost', formatNominalInput(e.target.value))}
                />
              </label>
              <label>Status Progress
                <select value={modal.form.status} onChange={e => setFormField('status', e.target.value)}>
                  {PLANNING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>Progress (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={modal.form.progress}
                  onChange={e => setFormField('progress', e.target.value)}
                />
              </label>
              <label>Target Mulai
                <input type="date" value={modal.form.target_start} onChange={e => setFormField('target_start', e.target.value)} />
              </label>
              <label>Target Selesai
                <input type="date" value={modal.form.target_end} onChange={e => setFormField('target_end', e.target.value)} />
              </label>
            </div>

            <div className="actions">
              <button type="button" className="outline" onClick={() => setModal(null)}>Batal</button>
              <button disabled={saving}>{saving ? 'Menyimpan…' : (modal.mode === 'edit' ? 'Simpan Perubahan' : 'Simpan Pekerjaan')}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
