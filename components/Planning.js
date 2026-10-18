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
// Modul BUDGETING — khusus role admin (adminOnly).
// WBS per proyek: daftar pekerjaan per area, volume & satuan,
// penugasan pekerja/tukang, estimasi upah (borongan/harian),
// status progress, dan shortcut "+ Buat PR Material" ke modul
// Purchase Request (membuat PR DRAFT + item otomatis terisi).
//
// Tabel DB: public.project_plans (RLS admin-only).
// ============================================================

const UNIT_OPTIONS = ['unit', 'm1', 'm2', 'm3', 'ls', 'titik', 'set', 'pcs', 'kg', 'liter']

// ============================================================
// PATOKAN ANGGARAN 4-PILAR (Noir Living)
//   Budget Standar  : Material 50% · Upah 25% · Operasional 10% · Target Margin 15%
//   Budget Custom   : persentase bebas (draft), diterapkan hanya bila VALID.
// Draft vs Applied: draft = yang sedang diketik user (boleh sementara total >100
// agar dapat rebalance). Applied = snapshot valid terakhir yang dipakai untuk
// pagu nominal, deteksi anomali, dan sumber data finance. Tidak ada normalisasi
// senyap: nilai tidak valid hanya TIDAK diterapkan (bukan di-rescale).
// ============================================================
const STANDARD_PERCENTAGES = { material: 50, manpower: 25, operasional: 10, margin: 15 }
const PCT_FIELDS = [
  { key: 'material', label: 'Material' },
  { key: 'manpower', label: 'Upah' },
  { key: 'operasional', label: 'Operasional' },
  { key: 'margin', label: 'Target Margin' }
]

// Bentuk draft (string) dari objek persentase — dipakai untuk nilai input.
function pctToDraft(p) {
  return {
    material: String(p.material),
    manpower: String(p.manpower),
    operasional: String(p.operasional),
    margin: String(p.margin)
  }
}

// Validasi draft persentase: tiap field harus finite dan 0..100, TOTAL <= 100.
// Mengembalikan { valid, fieldsOk, totalOk, total, remaining, errors, values }.
// values berisi angka tervalidasi (null bila field invalid) — hanya dipakai bila valid.
function validatePercentDraft(draft) {
  const values = {}
  const errors = []
  let total = 0
  let fieldsOk = true
  for (const f of PCT_FIELDS) {
    const raw = draft ? draft[f.key] : ''
    const str = String(raw ?? '').trim()
    const num = str === '' ? NaN : Number(str)
    if (str === '' || !Number.isFinite(num) || num < 0 || num > 100) {
      fieldsOk = false
      errors.push(`${f.label} harus angka 0–100`)
      values[f.key] = null
    } else {
      values[f.key] = num
      total += num
    }
  }
  const totalRounded = Math.round(total * 100) / 100
  const totalOk = fieldsOk && totalRounded <= 100
  const valid = fieldsOk && totalOk
  return {
    valid,
    fieldsOk,
    totalOk,
    total: totalRounded,
    remaining: Math.max(0, Math.round((100 - totalRounded) * 100) / 100),
    errors,
    values
  }
}

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

// Normalisasi nomor proyek untuk pencocokan project_no (Rekap Cost) ↔ kode (Projects).
// Toleran terhadap: spasi, leading zero ('099' == '99'), dan sisa desimal ekspor
// numerik Sheets ('99.0' == '99'). String non-numerik ('99abc') TIDAK dianggap
// sama dengan '99' (mencegah false-match seperti parseInt).
function normalizeProjectNo(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^0*(\d+)(?:[.,]0+)?$/)
  return m ? String(Number(m[1])) : s
}

export default function Planning({ rows, say, setPage, refresh }) {
  const allProjects = rows?.projects || []
  const [plans, setPlans] = useState([])
  const [costData, setCostData] = useState([])
  // Error khusus tabel project_cost_summary (Rekap Cost) — dipisah dari `error`
  // supaya panel pagu anggaran TIDAK salah klaim "Revenue belum diset" ketika
  // data cost sebenarnya GAGAL dimuat (RLS / jaringan).
  const [costError, setCostError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [modal, setModal] = useState(null)   // null | { mode: 'add' | 'edit', form }
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [prBusyId, setPrBusyId] = useState(null)
  const [budgetMode, setBudgetMode] = useState('standard') // 'standard' or 'custom'
  // Draft = nilai input yang sedang diketik (string, boleh sementara total >100).
  const [customDraft, setCustomDraft] = useState(() => pctToDraft(STANDARD_PERCENTAGES))
  // Applied = snapshot VALID terakhir (angka) yang dipakai untuk pagu/anomali.
  const [appliedPercentages, setAppliedPercentages] = useState(STANDARD_PERCENTAGES)
  const [customNotApplied, setCustomNotApplied] = useState(false)

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
    setCostError('')
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
        setCostError(costRes.error.message || 'gagal memuat data Rekap Cost')
        setCostData([])
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

  // Data project_cost_summary yang cocok dengan proyek aktif (project_no == p.kode).
  // Exact match dulu; fallback normalisasi nomor (leading zero / '.0') yang aman
  // dari false-match (lihat normalizeProjectNo).
  const activeCost = useMemo(() => {
    if (!project || !costData.length) return null
    const key = String(project.kode || '').trim()
    if (!key) return null
    const keyNorm = normalizeProjectNo(key)
    return costData.find(c => {
      const cNo = String(c.project_no || '').trim()
      if (cNo === key) return true
      if (!keyNorm || !cNo) return false
      return normalizeProjectNo(cNo) === keyNorm
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

  // Validasi draft persentase custom (dihitung tiap render draft berubah).
  // total boleh sementara >100 (draft) agar user dapat rebalance.
  const customValidation = useMemo(() => validatePercentDraft(customDraft), [customDraft])

  // Sinkronkan draft → applied HANYA bila draft valid (tidak ada normalisasi senyap).
  // Saat draft invalid (mis. total >100 di tengah rebalance) applied TIDAK berubah,
  // sehingga pagu nominal/anomali tetap memakai snapshot valid terakhir.
  useEffect(() => {
    if (budgetMode !== 'custom') return
    if (customValidation.valid) {
      setAppliedPercentages(customValidation.values)
      setCustomNotApplied(false)
    } else {
      setCustomNotApplied(true)
    }
  }, [budgetMode, customValidation.valid, customDraft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kalkulasi pagu anggaran historis Noir Living & perbandingan Pagu vs Realisasi Riil
  const budget = useMemo(() => {
    const revenueVal = Number(activeCost?.revenue)
    const revenue = !isNaN(revenueVal) && revenueVal > 0 ? revenueVal : 0

    // Mode custom berlaku walau revenue belum tersedia (pagu nominal pending).
    // Persentase yang DITERAPKAN: custom memakai snapshot valid terakhir;
    // standar memakai patokan fixed 50/25/10/15. TIDAK fallback diam-diam.
    const useCustom = budgetMode === 'custom'
    const applied = useCustom ? appliedPercentages : STANDARD_PERCENTAGES
    const pctMaterial = applied.material
    const pctManpower = applied.manpower
    const pctOperasional = applied.operasional
    const pctMargin = applied.margin

    // Total persentase yang benar-benar DITERAPKAN (selalu <= 100).
    const totalCustomPct = pctMaterial + pctManpower + pctOperasional + pctMargin
    const isExceedingLimit = useCustom && !customValidation.valid

    // 1. Plafon 4-Pilar (Patokan Historis DAT / Noir Living) atau Custom
    const budgetMaterial = Math.round(revenue * (pctMaterial / 100))
    const budgetManpower = Math.round(revenue * (pctManpower / 100))
    const budgetOperasional = Math.round(revenue * (pctOperasional / 100))
    const targetMargin = Math.round(revenue * (pctMargin / 100))

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
      
      // Custom Budget Mode Info
      useCustom,
      appliedPercentages,
      draftPercentages: customDraft,
      customValidation,
      customNotApplied,
      totalCustomPct,
      isExceedingLimit,

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

      // Status muat Rekap Cost (project_cost_summary) — dipakai panel untuk
      // membedakan "revenue memang belum diisi" vs "data gagal dimuat".
      costError,

      costSummary: activeCost
    }
  }, [activeCost, stats.labor, costError, budgetMode, appliedPercentages, customValidation, customDraft, customNotApplied])

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

  // Update DRAFT persentase (string) — tidak menyentuh applied secara langsung.
  // Applied disinkronkan oleh efek saat draft valid; nilai invalid ditandai.
  function updateCustomPercentage(field, value) {
    setCustomDraft(prev => ({ ...prev, [field]: value }))
  }

  // Pindah mode anggaran. Kembali ke Standar → applied direset ke patokan fixed.
  // Pindah ke Custom → draft dipulihkan dari snapshot applied terakhir.
  function changeBudgetMode(mode) {
    if (mode === budgetMode) return
    if (mode === 'standard') {
      setBudgetMode('standard')
      setAppliedPercentages(STANDARD_PERCENTAGES)
      setCustomDraft(pctToDraft(STANDARD_PERCENTAGES))
      setCustomNotApplied(false)
    } else {
      setBudgetMode('custom')
      setCustomDraft(pctToDraft(appliedPercentages))
    }
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
        notes: `Dari Budgeting — ${plan.area}${plan.spec ? ` (${plan.spec})` : ''}`
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
              notes: `Dari Budgeting — ${plan.area}${plan.spec ? ` (${plan.spec})` : ''}`
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
          Gagal memuat data budgeting: {error}
        </div>
      )}

      {costError && (
        <div className="notice" style={{ background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
          ⚠️ Gagal memuat data Rekap Cost (project_cost_summary): {costError}. Pagu anggaran 4-pilar belum bisa dihitung — nilai di bawah BUKAN angka nol sesungguhnya. Coba tombol ↻ Perbarui; bila berulang, periksa koneksi / hak akses (RLS admin).
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#142320', fontFamily: 'var(--font-heading)' }}>
                🎯 Kontrol Anggaran &amp; Pagu Historis
              </h3>
              <span className="badge" style={{ background: '#e6ece9', color: '#2d4a43', fontSize: '10.5px', fontWeight: 650 }}>
                Patokan: Material {budget.appliedPercentages.material}% · Upah {budget.appliedPercentages.manpower}% · Ops {budget.appliedPercentages.operasional}% · Margin {budget.appliedPercentages.margin}%
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', background: budgetMode === 'standard' ? '#e6ece9' : '#f3f4f6', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="budgetMode"
                  value="standard"
                  checked={budgetMode === 'standard'}
                  onChange={() => changeBudgetMode('standard')}
                  style={{ margin: 0 }}
                />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>🔸 Budget Standar</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', background: budgetMode === 'custom' ? '#e6ece9' : '#f3f4f6', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="budgetMode"
                  value="custom"
                  checked={budgetMode === 'custom'}
                  onChange={() => changeBudgetMode('custom')}
                  style={{ margin: 0 }}
                />
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>🔸 Budget Custom</span>
              </label>
            </div>
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
            ) : budget.costError ? (
              <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', fontSize: '12px', padding: '6px 12px', fontWeight: 700 }}>
                ⚠️ Gagal memuat Rekap Cost — pagu belum bisa dihitung
              </span>
            ) : (
              <span className="badge" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '12px', padding: '6px 12px', fontWeight: 700 }}>
                Revenue belum diset di Rekap Cost
              </span>
            )}
          </div>
        </div>

        {/* ============================================================
            PANEL ATUR PERSENTASE ANGGARAN (khusus Budget Custom)
            Tampil TEPAT di bawah saklar mode — 4 input jelas + total/sisa.
            ============================================================ */}
        {budget.useCustom && (
          <div className="budget-pct-panel">
            <div className="budget-pct-panel-head">
              <span className="budget-pct-panel-title">⚙️ Atur persentase anggaran</span>
              <span className="budget-pct-panel-hint">
                Draft perubahan <em>Belum tersimpan permanen</em> — hanya berlaku di sesi ini.
              </span>
            </div>

            <div className="budget-pct-grid">
              {PCT_FIELDS.map(f => {
                const invalidField = budget.customValidation.values[f.key] === null
                return (
                  <label key={f.key} className="budget-pct-field">
                    <span className="budget-pct-field-label">{f.label} (%)</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      aria-label={`Persentase ${f.label}`}
                      value={budget.draftPercentages[f.key]}
                      onChange={(e) => updateCustomPercentage(f.key, e.target.value)}
                      className="custom-pct-input"
                      style={{
                        border: invalidField ? '2px solid #ef4444' : '1px solid #cbd5e1'
                      }}
                    />
                  </label>
                )
              })}
            </div>

            <div className="budget-pct-footer">
              <span className="budget-pct-total">
                Total: <strong style={{ color: budget.customValidation.totalOk ? '#047857' : '#b91c1c' }}>{budget.customValidation.total}%</strong> / 100%
              </span>
              <span className="budget-pct-sisa">
                Sisa: <strong>{budget.customValidation.remaining}%</strong>
              </span>
              <span
                className="budget-pct-status"
                style={{
                  background: budget.customValidation.valid ? '#ecfdf5' : '#fef2f2',
                  color: budget.customValidation.valid ? '#047857' : '#b91c1c',
                  borderColor: budget.customValidation.valid ? '#d1fae5' : '#fecaca'
                }}
              >
                {budget.customValidation.valid
                  ? '✓ Diterapkan'
                  : (budget.customValidation.totalOk
                    ? `⚠️ ${budget.customValidation.errors[0] || 'Nilai tidak valid'}`
                    : '⚠️ Total melebihi 100% — belum diterapkan')}
              </span>
            </div>

            {!budget.customValidation.valid && (
              <div className="budget-pct-warn">
                Perubahan belum diterapkan. Pagu &amp; deteksi anomali masih memakai alokasi valid terakhir
                {' '}(Material {budget.appliedPercentages.material}% · Upah {budget.appliedPercentages.manpower}% ·
                {' '}Ops {budget.appliedPercentages.operasional}% · Margin {budget.appliedPercentages.margin}%).
              </div>
            )}
            {budget.revenue <= 0 && (
              <div className="budget-pct-pending">
                ℹ️ Nilai kontrak (revenue) belum tersedia — pagu nominal menunggu. Persentase tetap dapat diatur sekarang.
              </div>
            )}
          </div>
        )}

        {/* Ringkasan Kontrak & Total Realisasi Biaya (Overview Strip) */}
        <div className="budget-overview-strip">
          <div className="budget-overview-item">
            <span className="budget-overview-label">Nilai Kontrak (Revenue)</span>
            <div className="budget-overview-val">
              {budget.revenue > 0 ? rupiah(budget.revenue) : (budget.costError ? 'Gagal Dimuat' : 'Belum Diset')}
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
              ) : budget.costError ? (
                <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #f87171', fontSize: '11px', fontWeight: 750 }}>
                  ⚠️ Rekap Cost Gagal Dimuat
                </span>
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
                <span className="budget-card-title">1. Material</span>
                {budget.useCustom ? (
                  <span className="badge" style={{ background: budget.customNotApplied ? '#fef3c7' : '#e0f2fe', color: budget.customNotApplied ? '#b45309' : '#0369a1', fontSize: '10px', fontWeight: 700 }} title="Persentase diterapkan (atur di panel atas)">
                    {budget.appliedPercentages.material}% Diterapkan
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '10px', fontWeight: 700 }}>50% Max</span>
                )}
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
                    {budget.costError ? '—' : rupiah(budget.realMaterial)}
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
                    {budget.costError ? 'Riil: — (Rekap Cost gagal dimuat)' : `Riil: ${rupiah(budget.realMaterial)}`}
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
                <span className="budget-card-title">2. Manpower</span>
                {budget.useCustom ? (
                  <span className="badge" style={{ background: budget.customNotApplied ? '#fef3c7' : '#f0fdfa', color: budget.customNotApplied ? '#b45309' : '#0f766e', fontSize: '10px', fontWeight: 700 }} title="Persentase diterapkan (atur di panel atas)">
                    {budget.appliedPercentages.manpower}% Diterapkan
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#f0fdfa', color: '#0f766e', fontSize: '10px', fontWeight: 700 }}>25% Max</span>
                )}
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
                  {/* FN-EST_LABEL (REVIEW-03): angka ini berasal dari
                      project_plans.labor_cost — RENCANA upah di WBS Budgeting,
                      bukan upah yang sudah dibayar. Label lama "Pengeluaran
                      Riil" membuat rencana terbaca sebagai realisasi. Upah
                      terbayar ada di tukang_projects (modul Tukang Upah /
                      Actual Labor & Stok) dan tidak dijumlahkan di sini. */}
                  <span className="budget-detail-label" title="Estimasi rencana dari WBS Budgeting (project_plans.labor_cost) — bukan upah yang sudah dibayar.">Estimasi Upah WBS:</span>
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
                <span className="budget-card-title">3. Operasional</span>
                {budget.useCustom ? (
                  <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: '10px', fontWeight: 700 }} title="Persentase diterapkan (atur di panel atas)">
                    {budget.appliedPercentages.operasional}% Diterapkan
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#fef3c7', color: '#b45309', fontSize: '10px', fontWeight: 700 }}>10% Max</span>
                )}
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
                    {budget.costError ? '—' : rupiah(budget.realOperasional)}
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
                    {budget.costError ? 'Petty Cash: — (Rekap Cost gagal dimuat)' : `Petty Cash: ${rupiah(budget.realOperasional)}`}
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
                <span className="budget-card-title">4. Target Margin</span>
                {budget.useCustom ? (
                  <span className="badge" style={{ background: budget.customNotApplied ? '#fef3c7' : '#dcfce7', color: budget.customNotApplied ? '#b45309' : '#15803d', fontSize: '10px', fontWeight: 700 }} title="Persentase diterapkan (atur di panel atas)">
                    {budget.appliedPercentages.margin}% Diterapkan
                  </span>
                ) : (
                  <span className="badge" style={{ background: '#dcfce7', color: '#15803d', fontSize: '10px', fontWeight: 700 }}>15% Min</span>
                )}
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

        {/* Footer Ringkasan Patokan Historis (data finance) */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px dashed var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ fontSize: '11.5px', color: '#71817d' }}>
            <strong>Komposisi Pagu Total (100%):</strong> Material {budget.appliedPercentages.material}% ({budget.revenue > 0 ? rupiah(budget.budgetMaterial) : `${budget.appliedPercentages.material}%`}) + Upah {budget.appliedPercentages.manpower}% ({budget.revenue > 0 ? rupiah(budget.budgetManpower) : `${budget.appliedPercentages.manpower}%`}) + Ops {budget.appliedPercentages.operasional}% ({budget.revenue > 0 ? rupiah(budget.budgetOperasional) : `${budget.appliedPercentages.operasional}%`}) + Margin {budget.appliedPercentages.margin}% ({budget.revenue > 0 ? rupiah(budget.targetMargin) : `${budget.appliedPercentages.margin}%`}) = <strong>{budget.revenue > 0 ? rupiah(budget.revenue) : '100%'}</strong>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '11px', fontWeight: 650, flexWrap: 'wrap' }}>
            <span style={{ color: budget.revenue > 0 && budget.isMaterialOver ? '#dc2626' : '#0284c7' }}>● Material {budget.appliedPercentages.material}% {budget.revenue > 0 ? (budget.isMaterialOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isLaborOver ? '#dc2626' : '#0d9488' }}>● Upah {budget.appliedPercentages.manpower}% {budget.revenue > 0 ? (budget.isLaborOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isOperasionalOver ? '#dc2626' : '#d97706' }}>● Ops {budget.appliedPercentages.operasional}% {budget.revenue > 0 ? (budget.isOperasionalOver ? '(Over)' : '(Aman)') : '(—)'}</span>
            <span style={{ color: budget.revenue > 0 && budget.isMarginThin ? '#dc2626' : '#16a34a' }}>● Margin {budget.appliedPercentages.margin}% {budget.revenue > 0 ? (budget.isMarginThin ? '(Tipis)' : '(Aman)') : '(—)'}</span>
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
