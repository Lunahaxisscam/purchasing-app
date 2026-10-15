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

  // Statistik cepat proyek terpilih & kalkulasi pagu anggaran historis Noir Living
  const stats = useMemo(() => {
    const total = projectPlans.length
    const labor = projectPlans.reduce((s, pl) => s + (Number(pl.labor_cost) || 0), 0)
    const avgProgress = total
      ? Math.round(projectPlans.reduce((s, pl) => s + (Number(pl.progress) || 0), 0) / total)
      : 0
    const selesai = projectPlans.filter(pl => pl.status === 'Selesai').length

    // Pagu anggaran historis dari revenue project_cost_summary:
    // - Material = 50% max
    // - Manpower = 25% max
    // - Operasional = 10%
    // - Target Margin = 15%
    const revenue = Number(activeCost?.revenue) || 0
    const budgetMaterial = Math.round(revenue * 0.50)
    const budgetManpower = Math.round(revenue * 0.25)
    const budgetOperasional = Math.round(revenue * 0.10)
    const targetMargin = Math.round(revenue * 0.15)
    const isLaborOverBudget = revenue > 0 && labor > budgetManpower
    const laborVariance = labor - budgetManpower
    const laborPct = revenue > 0 ? (labor / revenue) * 100 : 0
    const laborUsageOfPlafon = budgetManpower > 0 ? (labor / budgetManpower) * 100 : 0

    return {
      total,
      labor,
      avgProgress,
      selesai,
      revenue,
      budgetMaterial,
      budgetManpower,
      budgetOperasional,
      targetMargin,
      isLaborOverBudget,
      laborVariance,
      laborPct,
      laborUsageOfPlafon
    }
  }, [projectPlans, activeCost])

  // Expose budget data object useMemo untuk komponen Planning
  const budget = useMemo(() => {
    const revenue = Number(activeCost?.revenue) || 0
    const budgetMaterial = Math.round(revenue * 0.50)
    const budgetManpower = Math.round(revenue * 0.25)
    const budgetOperasional = Math.round(revenue * 0.10)
    const targetMargin = Math.round(revenue * 0.15)
    const isLaborOverBudget = revenue > 0 && stats.labor > budgetManpower
    const laborVariance = stats.labor - budgetManpower
    const laborPct = revenue > 0 ? (stats.labor / revenue) * 100 : 0
    const laborUsageOfPlafon = budgetManpower > 0 ? (stats.labor / budgetManpower) * 100 : 0

    return {
      revenue,
      budgetMaterial,
      budgetManpower,
      budgetOperasional,
      targetMargin,
      isLaborOverBudget,
      laborVariance,
      laborPct,
      laborUsageOfPlafon,
      costSummary: activeCost
    }
  }, [activeCost, stats.labor])

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
        <div className="card" style={stats.isLaborOverBudget ? { borderColor: '#fca5a5', background: '#fffafa' } : {}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Estimasi Upah Tukang (WBS)</span>
            {stats.revenue > 0 && (
              <span className={`badge ${stats.isLaborOverBudget ? 'status-REJECTED' : 'status-APPROVED'}`} style={{ fontSize: '10px' }}>
                {stats.isLaborOverBudget ? '⚠️ OVER-BUDGET' : '✓ ON-TRACK'}
              </span>
            )}
          </div>
          <strong style={{ fontSize: '22px', color: stats.isLaborOverBudget ? '#dc2626' : 'inherit' }}>
            {rupiah(stats.labor)}
          </strong>
          <small>
            {stats.revenue > 0
              ? `${persen(stats.laborPct, 1)} dari revenue (plafon 25%: ${rupiah(stats.budgetManpower)})`
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
      <div className={`panel budget-control-panel ${stats.isLaborOverBudget ? 'has-anomaly' : ''}`}>
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
              Evaluasi alokasi pagu terhadap estimasi pekerjaan (WBS) untuk proyek <strong>{project ? (project.kode ? `[${project.kode}] ${project.name}` : project.name) : '—'}</strong>
            </p>
          </div>

          <div>
            {stats.revenue > 0 ? (
              stats.isLaborOverBudget ? (
                <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontSize: '12px', padding: '6px 12px', fontWeight: 800 }}>
                  ⚠️ ANOMALI: Upah Melebihi Plafon 25% (+{rupiah(stats.laborVariance)})
                </span>
              ) : (
                <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontSize: '12px', padding: '6px 12px', fontWeight: 750 }}>
                  ✓ On-Track ({persen(stats.laborPct, 1)} dari Revenue)
                </span>
              )
            ) : (
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '12px', padding: '6px 12px', fontWeight: 700 }}>
                Revenue belum diset di Rekap Cost
              </span>
            )}
          </div>
        </div>

        {/* Banner Peringatan Anomali Over-Budget */}
        {stats.revenue > 0 && stats.isLaborOverBudget && (
          <div style={{
            background: '#fef2f2',
            border: '1.5px solid #ef4444',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '22px' }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 800, color: '#991b1b', fontSize: '13.5px' }}>
                  PERINGATAN ANOMALI: Upah Melebihi Plafon 25% (+{rupiah(stats.laborVariance)})
                </div>
                <div style={{ fontSize: '12px', color: '#b91c1c', marginTop: '2px' }}>
                  Estimasi upah WBS saat ini <strong>{rupiah(stats.labor)}</strong> ({persen(stats.laborPct, 1)} dari revenue), melampaui pagu 25% ({rupiah(stats.budgetManpower)}). Segera tinjau rincian pekerjaan atau negosiasi tarif tukang.
                </div>
              </div>
            </div>
            <span className="badge" style={{ background: '#b91c1c', color: '#ffffff', fontWeight: 800, fontSize: '11px', padding: '6px 12px' }}>
              OVER-BUDGET +{rupiah(stats.laborVariance)}
            </span>
          </div>
        )}

        {/* Grid 5 Kartu Kontrol Pagu Anggaran */}
        <div className="budget-cards-grid">
          {/* 1. Revenue Proyek */}
          <div className="budget-card card-revenue">
            <div className="budget-card-header">
              <span className="budget-card-title">Revenue Proyek</span>
              <span className="badge" style={{ background: '#e8f0fe', color: '#1a56c4', fontSize: '10px', fontWeight: 700 }}>100%</span>
            </div>
            <div>
              {stats.revenue > 0 ? (
                <div className="budget-card-nominal">{rupiah(stats.revenue)}</div>
              ) : (
                <div style={{ margin: '6px 0 8px' }}>
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontWeight: 700, fontSize: '11px', whiteSpace: 'normal', lineHeight: 1.3, display: 'inline-block', padding: '5px 8px' }}>
                    Revenue belum diset di Rekap Cost
                  </span>
                </div>
              )}
            </div>
            <div className="budget-card-sub">
              {stats.revenue > 0 ? 'Nilai Kontrak (REV PROJECT)' : 'Basis pagu dihitung otomatis saat nilai kontrak diisi'}
            </div>
          </div>

          {/* 2. Plafon Upah Tukang (25% max) */}
          <div className={`budget-card card-manpower ${stats.isLaborOverBudget ? 'is-anomaly' : (stats.revenue > 0 ? 'is-on-track' : '')}`}>
            <div className="budget-card-header">
              <span className="budget-card-title">Plafon Upah (25% max)</span>
              <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', fontSize: '10px', fontWeight: 700 }}>25% Max</span>
            </div>
            <div>
              <div className={`budget-card-nominal ${stats.isLaborOverBudget ? 'danger-text' : (stats.revenue > 0 ? 'success-text' : '')}`}>
                {stats.revenue > 0 ? rupiah(stats.budgetManpower) : '—'}
              </div>
              <div style={{ fontSize: '11.5px', color: '#556b65', display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '2px 0 6px' }}>
                <span>Estimasi WBS:</span>
                <strong style={{ color: stats.isLaborOverBudget ? '#b91c1c' : '#142320' }}>{rupiah(stats.labor)}</strong>
              </div>
            </div>
            <div>
              {stats.revenue > 0 ? (
                stats.isLaborOverBudget ? (
                  <span className="badge badge-anomaly-glow" style={{ background: '#fee2e2', color: '#b91c1c', border: '1.5px solid #ef4444', fontWeight: 800, fontSize: '10.5px', whiteSpace: 'normal', lineHeight: 1.3, display: 'block', padding: '5px 8px', textAlign: 'center' }}>
                    ⚠️ ANOMALI: Upah Melebihi Plafon 25% (+{rupiah(stats.laborVariance)})
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#e8f7ee', color: '#0d6e38', border: '1px solid #b7e4c7', fontWeight: 750, fontSize: '11px', display: 'inline-block', padding: '4px 8px' }}>
                    ✓ On-Track ({persen(stats.laborUsageOfPlafon, 0)} pagu)
                  </span>
                )
              ) : (
                stats.labor > 0 ? (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '10.5px' }}>
                    WBS: {rupiah(stats.labor)}
                  </span>
                ) : (
                  <span className="badge status-DRAFT" style={{ fontSize: '10.5px' }}>Belum ada WBS</span>
                )
              )}
            </div>
            {stats.revenue > 0 && (
              <div className="budget-progress-track" title={`Pemakaian: ${persen(stats.laborUsageOfPlafon, 1)} dari pagu 25%`}>
                <div
                  className="budget-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, stats.laborUsageOfPlafon))}%`,
                    background: stats.isLaborOverBudget ? '#dc2626' : '#10b981'
                  }}
                />
              </div>
            )}
          </div>

          {/* 3. Plafon Material (50% max) */}
          <div className="budget-card card-material">
            <div className="budget-card-header">
              <span className="budget-card-title">Plafon Material (50% max)</span>
              <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '10px', fontWeight: 700 }}>50% Max</span>
            </div>
            <div className="budget-card-nominal">
              {stats.revenue > 0 ? rupiah(stats.budgetMaterial) : '—'}
            </div>
            <div className="budget-card-sub">
              Batas belanja pengadaan material proyek
            </div>
          </div>

          {/* 4. Plafon Operasional (10%) */}
          <div className="budget-card card-operasional">
            <div className="budget-card-header">
              <span className="budget-card-title">Plafon Operasional (10%)</span>
              <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: '10px', fontWeight: 700 }}>10%</span>
            </div>
            <div className="budget-card-nominal">
              {stats.revenue > 0 ? rupiah(stats.budgetOperasional) : '—'}
            </div>
            <div className="budget-card-sub">
              Overhead workshop &amp; operasional proyek
            </div>
          </div>

          {/* 5. Target Margin (15%) */}
          <div className="budget-card card-margin">
            <div className="budget-card-header">
              <span className="budget-card-title">Target Margin (15%)</span>
              <span className="badge" style={{ background: '#dcfce7', color: '#15803d', fontSize: '10px', fontWeight: 700 }}>15%</span>
            </div>
            <div className="budget-card-nominal" style={{ color: stats.revenue > 0 ? '#0d6e38' : 'inherit' }}>
              {stats.revenue > 0 ? rupiah(stats.targetMargin) : '—'}
            </div>
            <div className="budget-card-sub">
              Target profit minimal perusahaan
            </div>
          </div>
        </div>

        {/* Footer Ringkasan Patokan Historis */}
        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '11.5px', color: '#71817d' }}>
            <strong>Komposisi Pagu Total (100%):</strong> Material 50% ({stats.revenue > 0 ? rupiah(stats.budgetMaterial) : '50%'}) + Upah 25% ({stats.revenue > 0 ? rupiah(stats.budgetManpower) : '25%'}) + Ops 10% ({stats.revenue > 0 ? rupiah(stats.budgetOperasional) : '10%'}) + Margin 15% ({stats.revenue > 0 ? rupiah(stats.targetMargin) : '15%'}) = <strong>{stats.revenue > 0 ? rupiah(stats.revenue) : '100%'}</strong>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', fontWeight: 650 }}>
            <span style={{ color: '#0284c7' }}>● Material 50%</span>
            <span style={{ color: stats.isLaborOverBudget ? '#dc2626' : '#0d9488' }}>● Upah 25%</span>
            <span style={{ color: '#d97706' }}>● Operasional 10%</span>
            <span style={{ color: '#16a34a' }}>● Margin 15%</span>
          </div>
        </div>
      </div>

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
