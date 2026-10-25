import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { rupiah, formatDateTime, timeAgo, persen } from '../lib/constants'
import { targetBudget70 } from '../lib/money'
import { WBS_ESTIMATE_LABEL } from '../lib/laborSource'
import CompactRoot from './CompactRoot'

// ============================================================
// Modul FINANCE — khusus role admin.
// Tab "🏢 Ringkasan Perusahaan" (OPSI C — default): 4 KPI konsolidasi
//   (Total Revenue, Total Project Margin, Beban Operasional WS,
//   Net Margin Perusahaan) + tabel gross margin per proyek + rekap pos umum
//   Operasional WS. Gross Profit proyek MURNI = Revenue − Actual Material −
//   Estimasi Upah WBS; petty cash/operasional TIDAK memotong margin proyek —
//   dilaporkan sebagai pos umum WS. FN-EST_LABEL (REVIEW-03): komponen upah
//   adalah ESTIMASI WBS (project_plans.labor_cost), bukan upah terbayar.
// Filter Periode (arahan DAT): pilihan cepat Semua Periode (default),
//   Bulan Ini, Bulan Lalu, Kustom Tanggal (Dari/Sampai). Angka utama Drive
//   tetap akumulasi (sumber kumulatif tanpa riwayat bulanan); periode
//   terpilih menghitung "🗓️ Biaya Periode" per proyek dari transaksi
//   ber-tanggal (nominal Penerimaan Barang + rencana biaya tukang).
// Tab Pengadaan per Project & Detail per PR: ringkasan dari data
//   pengadaan app (estimasi PR vs purchase riil).
// Tab "Cost Drive": data cost dari Google Sheets "REKAP COST 2026"
//   (READ-ONLY) yang disinkronkan daemon ke tabel project_cost_summary.
//   Tombol "🔄 Refresh Sekarang" meminta sync on-demand via sync_status;
//   daemon (pm2 drive-sync) memproses permintaan itu dalam ≤45 detik.
// Tab "Closing Proyek": P&L per proyek (Revenue, Budget 70%, Cost Kumulatif,
//   Margin, Labor Ratio) + modal review & kunci snapshot permanen ke tabel
//   project_closings (RPC close_project — atomic, admin-only).
// Tab "Arsip Closing": riwayat P&L yang sudah terkunci permanen.
// ============================================================

function parseNominalFromNote(note) {
  const s = String(note || '')
  const m = s.match(/\[Nominal:\s*Rp\s*([\d.,]+)\s*\]/i)
  if (!m) return null
  const digits = m[1].replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}

// Timestamp (ms) transaksi utk Filter Periode: tanggal eksplisit dulu
// (received_date DATE pada receivings), fallback created_at. String
// 'YYYY-MM-DD' diparse sebagai waktu LOKAL (bukan UTC) supaya batas hari
// mengikuti kalender Indonesia. Return null bila tidak ada tanggal valid
// (transaksi tanpa tanggal tidak bisa dimasukkan ke periode apa pun).
function periodTs(rec) {
  if (!rec) return null
  for (const k of ['received_date', 'created_at']) {
    const v = rec[k]
    if (!v) continue
    const s = String(v)
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s)
    if (!isNaN(d.getTime())) return d.getTime()
  }
  return null
}

export default function Finance({ rows, session, refresh, initialDriveRows, initialPlans, initialClosings, initialPeriodMode, initialPeriodFrom, initialPeriodTo }) {
  // Opsi C: tab default = Ringkasan Perusahaan (KPI konsolidasi + gross margin
  // per proyek + rekap pos umum Operasional WS).
  const [view, setView] = useState('opsi')
  // --- state tab Cost Drive ---
  // initial* props: data awal dari SSR/test (opsional) supaya kartu terisi
  // tanpa menunggu efek muat data; produksi tetap memuat via loadDrive().
  const [driveRows, setDriveRows] = useState(initialDriveRows || [])
  const [sync, setSync] = useState(null)
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveError, setDriveError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef(null)
  // --- state tab Closing Proyek ---
  const [closings, setClosings] = useState(initialClosings || [])
  const [plans, setPlans] = useState(initialPlans || [])
  const [closingLoading, setClosingLoading] = useState(false)
  const [closingError, setClosingError] = useState('')
  const [closingModal, setClosingModal] = useState(null)   // { project, calc }
  const [closingNotes, setClosingNotes] = useState('')
  const [closingSaving, setClosingSaving] = useState(false)
  // --- state cetak dokumen closing (Sprint 1) ---
  const [printDoc, setPrintDoc] = useState(null)   // snapshot project_closings utk dokumen cetak
  const [printDate, setPrintDate] = useState(null) // waktu dokumen dibuka/dicetak
  // --- Filter Periode (tab Ringkasan Perusahaan — arahan DAT) ---
  // mode: 'all' (Semua Periode, default) | 'this_month' (Bulan Ini) |
  //       'last_month' (Bulan Lalu) | 'custom' (Kustom Tanggal: dari/sampai).
  // Kustom dianggap AKTIF hanya bila kedua tanggal terisi & rentang valid —
  // sebelum itu UI memaksa memilih tanggal dulu (data tetap tampil penuh).
  const [periodMode, setPeriodMode] = useState(initialPeriodMode || 'all')
  const [periodFrom, setPeriodFrom] = useState(initialPeriodFrom || '')
  const [periodTo, setPeriodTo] = useState(initialPeriodTo || '')
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
  // FILTER PERIODE (Ringkasan Perusahaan — arahan DAT)
  // Pilihan Cepat: 'all' Semua Periode (default) | 'this_month' Bulan Ini |
  //   'last_month' Bulan Lalu | 'custom' Kustom Tanggal (Dari/Sampai).
  // Nama bulan mengikuti waktu perangkat (WIB), contoh "Okt 2026".
  // custom valid hanya bila kedua tanggal terisi & rentangnya benar —
  // sebelum itu periode kustom dianggap belum aktif (tampil data penuh).
  // ============================================================
  const period = useMemo(() => {
    const now = new Date()
    const monFmt = new Intl.DateTimeFormat('id-ID', { month: 'short', year: 'numeric' })
    const monthStart = (y, m) => new Date(y, m, 1, 0, 0, 0, 0).getTime()
    const thisFrom = monthStart(now.getFullYear(), now.getMonth())
    const thisTo = monthStart(now.getFullYear(), now.getMonth() + 1) // eksklusif
    const lastFrom = monthStart(now.getFullYear(), now.getMonth() - 1)
    const lastTo = thisFrom

    let fromTs = null
    let toTs = null           // eksklusif
    let label = ''
    let pending = false       // kustom belum lengkap → tampilkan data penuh
    if (periodMode === 'this_month') {
      fromTs = thisFrom; toTs = thisTo
      label = `Bulan Ini (${monFmt.format(now)})`
    } else if (periodMode === 'last_month') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      fromTs = lastFrom; toTs = lastTo
      label = `Bulan Lalu (${monFmt.format(lm)})`
    } else if (periodMode === 'custom') {
      const okFrom = /^\d{4}-\d{2}-\d{2}$/.test(periodFrom)
      const okTo = /^\d{4}-\d{2}-\d{2}$/.test(periodTo)
      if (!okFrom || !okTo) {
        pending = true
      } else {
        const f = new Date(`${periodFrom}T00:00:00`).getTime()
        const t = new Date(`${periodTo}T00:00:00`).getTime()
        if (isNaN(f) || isNaN(t) || f > t) {
          pending = true
        } else {
          fromTs = f
          toTs = t + 24 * 60 * 60 * 1000  // "Sampai Tanggal" inklusif
          label = `Kustom (${new Date(f).toLocaleDateString('id-ID')} – ${new Date(t).toLocaleDateString('id-ID')})`
        }
      }
    }

    const active = !pending && fromTs !== null && toTs !== null
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    return {
      mode: periodMode,
      active: active,                 // true = saring transaksi per periode
      pendingCustom: pending,         // kustom dipilih tapi tanggal belum lengkap/salah
      fromTs, toTs, label, monFmt,
      thisMonthLabel: monFmt.format(now),
      lastMonthLabel: monFmt.format(lastMonthDate)
    }
  }, [periodMode, periodFrom, periodTo])

  // ============================================================
  // OPSI C — RINGKASAN PERUSAHAAN (Net Margin WS)
  // Gross Profit per proyek = Revenue − Actual Material − ESTIMASI Upah WBS
  //   (MURNI — petty cash tidak memotong margin proyek).
  // FN-EST_LABEL (REVIEW-03): komponen upah di sini berasal dari
  //   project_plans.labor_cost = RENCANA WBS Budgeting, bukan upah yang
  //   sudah dibayar. Upah AKTUAL (tukang_projects.total_upah, sync Google
  //   Sheets) TIDAK dijumlahkan ke margin ini — mencampur keduanya akan
  //   menghitung upah dua kali dan menyembunyikan selisih rencana vs realisasi.
  // Beban Operasional WS = pos umum workshop di Drive data: baris dengan
  //   project_no "operasional ws" (kolom cumulative_cost = OPEX kumulatif,
  //   kolom current_week_expense = OPEX minggu berjalan).
  // Net Margin Perusahaan = Σ Gross Profit seluruh proyek − Beban Operasional WS.
  // ============================================================
  const opsC = useMemo(() => {
    // 👷 Estimasi upah WBS per proyek — dari modul Budgeting (project_plans).
    // (BUKAN Actual Tukang; lihat catatan FN-EST_LABEL di atas.)
    const laborByProject = {}
    for (const pl of plans) {
      if (!pl.project_id) continue
      laborByProject[pl.project_id] = (laborByProject[pl.project_id] || 0) + (Number(pl.labor_cost) || 0)
    }
    // Baris pos umum "operasional ws" di tabel Drive (case-insensitive).
    let opexRow = null
    const opexRowsRest = []
    for (const d of driveRows) {
      const no = String(d.project_no || '').trim().toLowerCase()
      if (!opexRow && no === 'operasional ws') opexRow = d
      else opexRowsRest.push(d)
    }
    const opexWeek = opexRow ? (Number(opexRow.current_week_expense) || 0) : 0
    const opexCumulative = opexRow ? (Number(opexRow.cumulative_cost) || 0) : null // null = baris pos umum belum ada

    // 📊 Rincian gross margin per proyek (hanya proyek yang punya kode/Drive,
    // supaya tidak muncul baris kosong; closing/arsip memakai tab lain).
    const projectRows = (rows.projects || []).map(p => {
      const drive = driveRows.find(d => String(d.project_no || '').trim() === String(p.kode || '').trim()) || null
      const revenue = Number(drive?.revenue) || 0
      const material = Number(drive?.cumulative_cost) || 0
      const labor = Math.round(laborByProject[p.id] || 0)
      const gross = revenue - material - labor
      return {
        id: p.id,
        kode: p.kode || '—',
        name: p.name || '—',
        status: p.status || '—',
        hasData: !!(drive && (revenue > 0 || material > 0 || labor > 0)),
        revenue, material, labor, gross,
        marginPct: revenue > 0 ? (gross / revenue) * 100 : null
      }
    })
      .filter(r => r.hasData)
      .sort((a, b) => {
        const na = parseInt(a.kode, 10)
        const nb = parseInt(b.kode, 10)
        if (!isNaN(na) && !isNaN(nb)) return na - nb
        return String(a.kode).localeCompare(String(b.kode), 'id', { numeric: true })
      })

    const totalRevenue = projectRows.reduce((s, r) => s + r.revenue, 0)
    const totalMaterial = projectRows.reduce((s, r) => s + r.material, 0)
    const totalLabor = projectRows.reduce((s, r) => s + r.labor, 0)
    const totalGross = projectRows.reduce((s, r) => s + r.gross, 0)
    // Net margin bisa dihitung hanya bila pos umum "operasional ws" ada di data.
    const net = opexCumulative === null ? null : totalGross - opexCumulative

    // ============================================================
    // FILTER PERIODE — 🗓️ Biaya Periode per proyek.
    // Sumber data Drive bersifat KUMULATIF (tanpa riwayat per bulan), jadi
    // angka utama (Revenue/Material/Tukang) tetap akumulasi. Utk periode
    // terpilih, biaya dihitung dari transaksi app ber-tanggal:
    //   • Material  = nominal riil Penerimaan Barang (kolom note receivings,
    //     dipetakan ke proyek via project_id / project_name) dalam periode.
    //   • Tukang    = rencana biaya tukang Budgeting (project_plans) yang
    //     dibuat/diperbarui dalam periode.
    // "Semua Periode" memakai angka akumulasi penuh (perilaku lama).
    // ============================================================
    const periodFilterOn = period.active
    const inPeriod = (rec) => {
      if (!periodFilterOn) return true
      const ts = periodTs(rec)
      return ts !== null && ts >= period.fromTs && ts < period.toTs
    }

    // Nominal material riil per proyek dalam periode (detil di ujung kartu).
    const periodMaterialByProject = {}
    let periodMaterialUnclassified = 0
    if (periodFilterOn) {
      for (const r of (rows.receivings || [])) {
        if (!inPeriod(r)) continue
        const nominal = parseNominalFromNote(r.note)
        if (nominal === null || nominal <= 0) continue
        const proj = (rows.projects || []).find(p => p.id === r.project_id)
          || (r.project_name ? (rows.projects || []).find(p =>
            `[${p.kode}] ${p.name}` === r.project_name || p.name === r.project_name) : null)
        if (proj && proj.id) {
          periodMaterialByProject[proj.id] = (periodMaterialByProject[proj.id] || 0) + nominal
        } else {
          // Penerimaan tanpa proyek yang cocok — tetap dilaporkan di baris total.
          periodMaterialUnclassified += nominal
        }
      }
    }
    // Biaya tukang per proyek dalam periode (project_plans ber-tanggal).
    const periodLaborByProject = {}
    if (periodFilterOn) {
      for (const pl of plans) {
        if (!pl.project_id || !inPeriod(pl)) continue
        periodLaborByProject[pl.project_id] =
          (periodLaborByProject[pl.project_id] || 0) + (Number(pl.labor_cost) || 0)
      }
    }
    // Terapkan ke baris proyek (tabel rincian) + kartu mobile.
    for (const r of projectRows) {
      r.periodMaterial = periodMaterialByProject[r.id] || 0
      r.periodLabor = periodLaborByProject[r.id] || 0
      r.periodTotal = r.periodMaterial + r.periodLabor
    }
    const totalPeriodMaterial = projectRows.reduce((s, r) => s + r.periodMaterial, 0)
    const totalPeriodLabor = projectRows.reduce((s, r) => s + r.periodLabor, 0)
    const totalPeriod = projectRows.reduce((s, r) => s + r.periodTotal, 0)

    return {
      projectRows,
      totalRevenue, totalMaterial, totalLabor, totalGross,
      totalGrossPct: totalRevenue > 0 ? (totalGross / totalRevenue) * 100 : null,
      opexRow, opexWeek, opexCumulative,
      opexRowsRest,
      net,
      netPct: net !== null && totalRevenue > 0 ? (net / totalRevenue) * 100 : null,
      // --- Filter Periode ---
      periodOn: periodFilterOn,
      periodLabel: period.label,
      periodPendingCustom: period.pendingCustom,
      periodMaterialUnclassified,
      totalPeriodMaterial, totalPeriodLabor, totalPeriod
    }
  }, [rows, plans, driveRows, period])

  // ============================================================
  // CLOSING PROYEK — kalkulasi P&L per proyek.
  //   Revenue        : dari project_cost_summary.revenue (sync REV PROJECT)
  //   Material       : project_cost_summary.cumulative_cost (COST ITEMS CONFIRMED)
  //   Petty Cash     : project_cost_summary.petty_cash (tab PETTY CASH)
  //   Estimasi Upah : SUM(project_plans.labor_cost) per proyek (WBS Budgeting;
  //                   RENCANA — FN-EST_LABEL, bukan upah terbayar)
  //   Budget Target  : 70% × Revenue
  //   Cost Kumulatif : Material + Petty Cash + Estimasi Upah
  //   Margin         : Revenue − Cost Kumulatif (Rp & %)
  //   Labor Ratio    : Estimasi Upah ÷ Cost Kumulatif × 100%
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
      // FN-TARGET70 (REVIEW-03): target 70% dihitung lewat lib/money.js
      // (revenue*7/10 lalu dibulatkan SEKALI ke rupiah utuh). Nilai ini yang
      // dibandingkan HEMAT/OVER-BUDGET dan yang dikirim ke RPC close_project
      // sebagai target_budget, jadi layar, keputusan, dan snapshot memakai
      // angka yang sama — tanpa pecahan sen tersisa.
      const target = targetBudget70(revenue)
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
    <CompactRoot className="finance-compact">
      {/* ==== FILTER PERIODE — tab Ringkasan Perusahaan (arahan DAT) ====
          Pilihan Cepat: Semua Periode (default) / Bulan Ini / Bulan Lalu /
          Kustom Tanggal (+ input Dari & Sampai Tanggal). Mengontrol kolom
          "🗓️ Biaya Periode" & bar indikator di atas tabel rincian proyek. */}
      {view === 'opsi' && (
        <div
          className="panel"
          data-testid="period-filter"
          style={{ marginBottom: '16px', padding: '12px 16px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--olive-700)' }}>
              🗓️ Filter Periode
            </span>
            <div className="filter-tabs" style={{ marginTop: 0 }}>
              {[
                ['all', 'Semua Periode'],
                ['this_month', `Bulan Ini (${period.thisMonthLabel})`],
                ['last_month', `Bulan Lalu (${period.lastMonthLabel})`],
                ['custom', 'Kustom Tanggal']
              ].map(([mode, text]) => (
                <button
                  key={mode}
                  type="button"
                  className={`pill ${periodMode === mode ? 'active' : ''}`}
                  onClick={() => {
                    setPeriodMode(mode)
                    // Ganti mode: kosongkan kustom lama agar tidak mengaktifkan
                    // rentang basi saat kembali ke Kustom Tanggal.
                    if (mode === 'custom') { setPeriodFrom(''); setPeriodTo('') }
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
            {periodMode === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Dari Tanggal
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={e => setPeriodFrom(e.target.value)}
                    style={{ width: 'auto', padding: '6px 10px', fontSize: '12.5px', marginLeft: '6px' }}
                  />
                </label>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Sampai Tanggal
                  <input
                    type="date"
                    value={periodTo}
                    onChange={e => setPeriodTo(e.target.value)}
                    style={{ width: 'auto', padding: '6px 10px', fontSize: '12.5px', marginLeft: '6px' }}
                  />
                </label>
              </div>
            )}
          </div>
          {periodMode === 'custom' && period.pendingCustom && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--warn)', fontWeight: 600 }}>
              Lengkapi Dari Tanggal &amp; Sampai Tanggal (rentang valid) untuk mengaktifkan periode kustom — sementara ini data ditampilkan penuh.
            </div>
          )}
        </div>
      )}

      {/* ==== 4 KARTU RINGKASAN ATAS — OPSI C (Ringkasan Perusahaan) ====
          1. Total Revenue        = akumulasi revenue seluruh proyek (Drive)
          2. Total Project Margin = akumulasi Gross Profit seluruh proyek
             (Revenue − Actual Material − Estimasi Upah WBS, murni)
          3. Beban Operasional WS = pos umum workshop (baris "operasional ws"
             di data Drive — petty cash / operasional TIDAK memotong margin proyek)
          4. Net Margin Perusahaan= Total Project Margin − Beban Operasional WS
          Kartu lama (estimasi/purchase PR, jumlah project) pindah ke tab
          Ringkasan Pengadaan. */}
      <div className="cards">
        <div className="card" title="Akumulasi revenue (nilai kontrak) seluruh proyek — sumber: REV PROJECT via sync Google Drive">
          <span>💰 Total Revenue</span>
          <strong style={{ fontSize: '22px' }}>{opsC.totalRevenue > 0 ? rupiah(opsC.totalRevenue) : '—'}</strong>
          <small>{opsC.projectRows.length} proyek · {opsC.periodOn ? 'akumulasi penuh (Drive kumulatif)' : 'akumulasi seluruh proyek'}</small>
        </div>
        <div className="card" title={`Total Project Margin = Σ (Revenue − Actual Material − ${WBS_ESTIMATE_LABEL}) seluruh proyek — gross profit murni, tanpa petty cash/operasional. Komponen upah memakai ESTIMASI WBS, bukan upah terbayar (lihat Actual Labor & Stok untuk aktual tukang_projects).`}>
          <span>📈 Total Project Margin</span>
          <strong style={{ fontSize: '22px', color: opsC.totalGross < 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {opsC.projectRows.length ? rupiah(opsC.totalGross) : '—'}
          </strong>
          <small style={{ fontWeight: 700, color: opsC.totalGross < 0 ? 'var(--danger)' : 'var(--ok)' }}>
            {opsC.projectRows.length ? `${persen(opsC.totalGrossPct)} margin kotor` : 'belum ada data proyek'}
          </small>
        </div>
        <div className="card" title="Beban Operasional WS (pos umum workshop) — baris 'operasional ws' di data REKAP COST 2026; tidak memotong margin proyek">
          <span>🏢 Beban Operasional WS</span>
          <strong style={{ fontSize: '22px' }}>
            {opsC.opexCumulative === null ? '—' : rupiah(opsC.opexCumulative)}
          </strong>
          <small>
            {opsC.opexCumulative === null
              ? 'pos umum "operasional ws" belum ada di data Drive'
              : `pos umum workshop · minggu ini ${rupiah(opsC.opexWeek)}`}
          </small>
        </div>
        <div className="card" title="Net Margin Perusahaan = Total Project Margin (Gross Profit semua proyek) − Beban Operasional WS">
          <span>🏦 Net Margin Perusahaan</span>
          <strong style={{ fontSize: '22px', color: opsC.net === null ? 'var(--text-muted)' : (opsC.net < 0 ? 'var(--danger)' : 'var(--ok)') }}>
            {opsC.net === null ? '—' : rupiah(opsC.net)}
          </strong>
          <small style={{ fontWeight: 700, color: opsC.net === null ? 'var(--text-muted)' : (opsC.net < 0 ? 'var(--danger)' : 'var(--ok)') }}>
            {opsC.net === null
              ? 'menunggu pos umum Operasional WS di Drive'
              : `${persen(opsC.netPct)} net margin · Gross ${rupiah(opsC.totalGross)} − OPEX ${rupiah(opsC.opexCumulative)}`}
          </small>
        </div>
      </div>

      <div className="toolbar">
        <div className="filter-tabs">
          <button type="button" className={`pill ${view === 'opsi' ? 'active' : ''}`} onClick={() => setView('opsi')}>
            🏢 Ringkasan Perusahaan
          </button>
          <button type="button" className={`pill ${view === 'summary' ? 'active' : ''}`} onClick={() => setView('summary')}>
            Pengadaan per Project ({data.byProject.length})
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '8px 14px', background: '#eef0e6', borderRadius: 'var(--radius-sm)', border: '1px solid var(--olive-200)', marginBottom: '14px', fontSize: '12px', color: 'var(--olive-600)' }}>
          <div>
            {refreshing ? (
              <span style={{ fontWeight: 600, color: 'var(--ok)' }}>
                ⏳ Permintaan sinkronisasi sedang diproses daemon (maksimal ±45 detik)…
              </span>
            ) : sync?.last_synced_at ? (
              <span>
                Google Sheets <b>REKAP COST 2026</b> · Terakhir disinkronkan: <b>{formatDateTime(sync.last_synced_at)}</b> ({timeAgo(sync.last_synced_at)})
                {sync.last_message ? <span style={{ color: 'var(--text-muted)' }}> · {sync.last_message}</span> : null}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Belum pernah disinkronkan dari Google Drive.</span>
            )}
          </div>
          {sync?.last_status === 'ERROR' && (
            <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
              ⚠️ Sync gagal: {sync.last_message || 'Terjadi kesalahan'}
            </span>
          )}
        </div>
      )}

      {driveError && (
        <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: 'var(--danger-border)', color: '#8a2425', marginBottom: '14px' }}>
          {driveError}
        </div>
      )}

      {view === 'opsi' && (
        <>
          {/* ---- BAR INDIKATOR PERIODE AKTIF (arahan DAT) ----
              Tampil hanya saat periode non-'Semua Periode' dipilih, tepat di
              atas tabel rincian proyek. */}
          {opsC.periodOn && (
            <div
              data-testid="period-indicator"
              style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', marginBottom: '12px', padding: '9px 14px', background: 'var(--olive-50)', border: '1px solid var(--olive-200)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px', fontWeight: 700, color: 'var(--olive-700)' }}
            >
              <span>🗓️ Menampilkan data periode: {opsC.periodLabel}</span>
              <span style={{ fontWeight: 500, color: 'var(--olive-500)' }}>
                · Biaya Periode (Penerimaan + Tukang): {rupiah(opsC.totalPeriod)}
                {opsC.periodMaterialUnclassified > 0
                  ? ` (termasuk ${rupiah(opsC.periodMaterialUnclassified)} penerimaan tanpa proyek)`
                  : ''}
              </span>
            </div>
          )}

          {/* ---- TABEL RINCIAN GROSS MARGIN PER PROYEK (OPSI C) ---- */}
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Kode</th>
                  <th>Proyek</th>
                  <th style={{ textAlign: 'right' }}>💰 Revenue</th>
                  <th style={{ textAlign: 'right' }}>🧱 Material</th>
                  <th style={{ textAlign: 'right' }} title="Estimasi upah dari WBS Budgeting (project_plans.labor_cost) — RENCANA, bukan upah terbayar">👷 Estimasi Upah WBS</th>
                  {opsC.periodOn && (
                    <th style={{ textAlign: 'right' }} title="Biaya transaksi ber-tanggal pada periode terpilih: nominal riil Penerimaan Barang + rencana biaya tukang Budgeting">🗓️ Biaya Periode</th>
                  )}
                  <th style={{ textAlign: 'right' }}>📈 Gross Profit</th>
                  <th style={{ textAlign: 'right', width: '90px' }}>% Margin</th>
                </tr>
              </thead>
              <tbody>
                {opsC.projectRows.length ? opsC.projectRows.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.kode}</b></td>
                    <td style={{ whiteSpace: 'normal', maxWidth: '240px', fontWeight: 600 }}>
                      {r.name}
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{r.status}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.revenue > 0 ? rupiah(r.revenue) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.material > 0 ? rupiah(r.material) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.labor > 0 ? rupiah(r.labor) : '—'}</td>
                    {opsC.periodOn && (
                      <td style={{ textAlign: 'right', fontWeight: 700, color: r.periodTotal > 0 ? 'var(--olive-700)' : 'var(--text-muted)' }}>
                        {r.periodTotal > 0 ? rupiah(r.periodTotal) : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.gross < 0 ? 'var(--danger)' : 'var(--ok)' }}>
                      {rupiah(r.gross)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.marginPct === null ? 'var(--text-muted)' : (r.gross < 0 ? 'var(--danger)' : 'var(--ok)') }}>
                      {r.marginPct === null ? '—' : persen(r.marginPct)}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={opsC.periodOn ? 8 : 7} className="empty">
                    Belum ada data revenue/cost proyek. Buka tab &quot;☁️ Cost Drive&quot; lalu klik &quot;🔄 Refresh dari Drive&quot;.
                  </td></tr>
                )}
              </tbody>
              {opsC.projectRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: 'var(--olive-50)', fontWeight: 800 }}>
                    <td colSpan={2} style={{ textAlign: 'right' }}>TOTAL</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(opsC.totalRevenue)}</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(opsC.totalMaterial)}</td>
                    <td style={{ textAlign: 'right' }}>{rupiah(opsC.totalLabor)}</td>
                    {opsC.periodOn && (
                      <td style={{ textAlign: 'right', color: opsC.totalPeriod > 0 ? 'var(--olive-700)' : 'var(--text-muted)' }}>
                        {opsC.totalPeriod > 0 ? rupiah(opsC.totalPeriod) : '—'}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', color: opsC.totalGross < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(opsC.totalGross)}</td>
                    <td style={{ textAlign: 'right', color: opsC.totalGross < 0 ? 'var(--danger)' : 'var(--ok)' }}>{persen(opsC.totalGrossPct)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* ---- REKAP POS UMUM OPERASIONAL WS ---- */}
          <div className="panel" style={{ marginBottom: '16px' }}>
            <h2>🏢 Rekap Pos Umum — Beban Operasional WS</h2>
            <table>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600, width: '260px' }}>Beban Operasional WS (Kumulatif)</td>
                  <td style={{ fontWeight: 800, fontSize: '16px' }}>
                    {opsC.opexCumulative === null ? '—' : rupiah(opsC.opexCumulative)}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Beban Operasional WS (Minggu Ini)</td>
                  <td>{opsC.opexRow ? rupiah(opsC.opexWeek) : '—'}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Sumber Data</td>
                  <td className="muted">
                    Baris pos umum <code>operasional ws</code> di REKAP COST 2026 (tab PROJECT SUMMARY — Google Drive)
                    {sync?.last_synced_at ? ` · terakhir sync ${timeAgo(sync.last_synced_at)}` : ''}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Perhitungan Net Margin</td>
                  <td className="muted">
                    {opsC.net === null
                      ? <>Baris pos umum belum tersedia — Net Margin Perusahaan belum bisa dihitung. Tambahkan baris <code>operasional ws</code> di REKAP COST 2026, lalu sync ulang.</>
                      : <>{rupiah(opsC.totalGross)} (Gross Profit semua proyek) − {rupiah(opsC.opexCumulative)} (Operasional WS) = <b style={{ color: opsC.net < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(opsC.net)}</b> ({persen(opsC.netPct)})</>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Kartu mobile (tab Opsi C) */}
          <div className="mobile-cards-view">
            {opsC.projectRows.length ? opsC.projectRows.map(r => (
              <div className="mobile-card" key={r.id}>
                <div className="mobile-card-header">
                  <div>
                    <b className="mobile-card-title">[{r.kode}] {r.name}</b>
                    <div className="mobile-card-sub">{r.status}</div>
                  </div>
                  <span className={`badge ${r.gross < 0 ? 'status-REJECTED' : 'status-APPROVED'}`} style={{ fontSize: '10px' }}>
                    {r.marginPct === null ? '—' : persen(r.marginPct)}
                  </span>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row"><span className="mobile-label">Revenue:</span><span className="mobile-val">{r.revenue > 0 ? rupiah(r.revenue) : '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Material:</span><span className="mobile-val">{r.material > 0 ? rupiah(r.material) : '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Estimasi Upah WBS:</span><span className="mobile-val">{r.labor > 0 ? rupiah(r.labor) : '—'}</span></div>
                  {opsC.periodOn && (
                    <div className="mobile-card-row"><span className="mobile-label">Biaya Periode:</span><span className="mobile-val" style={{ fontWeight: 700, color: r.periodTotal > 0 ? 'var(--olive-700)' : 'var(--text-muted)' }}>{r.periodTotal > 0 ? rupiah(r.periodTotal) : '—'}</span></div>
                  )}
                  <div className="mobile-card-row"><span className="mobile-label">Gross Profit:</span><span className="mobile-val" style={{ fontWeight: 700, color: r.gross < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(r.gross)}</span></div>
                </div>
              </div>
            )) : <div className="panel empty">Belum ada data margin proyek.</div>}
            {opsC.periodOn && (
              <div className="panel" style={{ fontWeight: 700, color: 'var(--olive-700)' }}>
                🗓️ Menampilkan data periode: {opsC.periodLabel}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontWeight: 600, color: 'var(--olive-500)' }}>
                  <span>Biaya Periode (Penerimaan + Tukang):</span><span>{rupiah(opsC.totalPeriod)}</span>
                </div>
              </div>
            )}
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Gross Profit (semua proyek):</span><b>{rupiah(opsC.totalGross)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                <span>Operasional WS:</span><span>{opsC.opexCumulative === null ? '—' : rupiah(opsC.opexCumulative)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontWeight: 800, color: opsC.net === null ? 'var(--text-muted)' : (opsC.net < 0 ? 'var(--danger)' : 'var(--ok)') }}>
                <span>Net Margin Perusahaan:</span><span>{opsC.net === null ? '—' : rupiah(opsC.net)}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {view === 'closing' ? (
        <>
          {closingError && (
            <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: 'var(--danger-border)', color: '#8a2425' }}>
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
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '170px' }}>{p.name || '—'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{p.status || '—'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.revenue > 0 ? rupiah(row.revenue) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {row.revenue > 0 ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{rupiah(row.target)}</div>
                            <div style={{ fontSize: '11px', color: row.underBudget ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>
                              {row.underBudget ? '✓ HEMAT' : '⚠ OVER-BUDGET'}
                            </div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>{rupiah(row.total)}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Mat {rupiah(row.material)} · PC {rupiah(row.petty)} · Est. Upah WBS {rupiah(row.labor)}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: row.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(row.margin)}</div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: row.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{persen(row.marginPct)}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{persen(row.laborRatio)}</td>
                      <td style={{ textAlign: 'center' }}>
                        {row.closed ? (
                          <div>
                            <span className="badge status-APPROVED" style={{ fontSize: '10px' }}>🔒 TERKUNCI</span>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '4px 0' }}>{formatDateTime(row.closed.closed_at)}</div>
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
                    <div className="mobile-card-row"><span className="mobile-label">Margin:</span><span className="mobile-val" style={{ fontWeight: 700, color: row.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(row.margin)} ({persen(row.marginPct)})</span></div>
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
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '170px' }}>{c.project_name || '—'}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(c.revenue || 0)}</td>
                      <td style={{ textAlign: 'right' }}>{rupiah(c.target_budget || 0)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>{rupiah(c.total_cost || 0)}</div>
                        <div style={{ fontSize: '11px', color: hemat ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>{hemat ? '✓ HEMAT' : '⚠ OVER-BUDGET'}</div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: Number(c.margin_nominal) < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(c.margin_nominal || 0)}</div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: Number(c.margin_nominal) < 0 ? 'var(--danger)' : 'var(--ok)' }}>{persen(c.margin_percentage || 0)}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{persen(c.labor_ratio || 0)}</td>
                      <td style={{ fontSize: '12px' }}>
                        <div style={{ fontWeight: 600 }}>{formatDateTime(c.closed_at)}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>oleh {c.closed_by || '—'}</div>
                        {c.notes && <div style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'normal', maxWidth: '220px', marginTop: '2px' }}>📝 {c.notes}</div>}
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
                    <div className="mobile-card-row"><span className="mobile-label">Margin:</span><span className="mobile-val" style={{ fontWeight: 700, color: Number(c.margin_nominal) < 0 ? 'var(--danger)' : 'var(--ok)' }}>{rupiah(c.margin_nominal || 0)} ({persen(c.margin_percentage || 0)})</span></div>
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
                  <tr style={{ background: 'var(--olive-50)', fontWeight: 800 }}>
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
      ) : view === 'summary' || view === 'detail' ? (
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
                    <td style={{ textAlign: 'right', fontWeight: 700, color: diff === null ? 'var(--text-muted)' : (diff > 0 ? 'var(--danger)' : 'var(--ok)') }}>
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
                  <td style={{ textAlign: 'right', fontWeight: 700, color: p.diff === null ? 'var(--text-muted)' : (p.diff > 0 ? 'var(--danger)' : 'var(--ok)') }}>
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
      ) : null}

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
                  <div className="mobile-card-row"><span className="mobile-label">Selisih:</span><span className="mobile-val" style={{ fontWeight: 700, color: diff === null ? 'var(--text-muted)' : (diff > 0 ? 'var(--danger)' : 'var(--ok)') }}>{diff === null ? '—' : rupiah(diff)}</span></div>
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
                <div className="mobile-card-row"><span className="mobile-label">Selisih:</span><span className="mobile-val" style={{ fontWeight: 700, color: p.diff === null ? 'var(--text-muted)' : (p.diff > 0 ? 'var(--danger)' : 'var(--ok)') }}>{p.diff === null ? '—' : rupiah(p.diff)}</span></div>
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
                          {/* FN-EST_LABEL (REVIEW-03): angka tersimpan
                              (project_closings.labor_cost) berasal dari
                              SUM(project_plans.labor_cost) = ESTIMASI WBS
                              Budgeting, bukan upah yang sudah dibayar. Label
                              "Realisasi Biaya Tukang" pada dokumen resmi
                              membuat pembaca menandatanganinya sebagai
                              realisasi. Upah aktual (tukang_projects) belum
                              ikut dihitung ke snapshot closing — dinyatakan
                              apa adanya di catatan bawah tabel. */}
                          <td style={{ paddingLeft: '18px' }}>Estimasi Biaya Tukang <small>(WBS Budgeting)</small></td>
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
                          {/* Komposisi jujur: baris 3 masih ESTIMASI WBS, jadi
                              total ini tidak boleh disebut "HPP RIIL" penuh.
                              Label diberi keterangan sumber di catatan bawah
                              tabel agar dokumen tidak mengklaim realisasi atas
                              angka rencana (FN-EST_LABEL). */}
                          <td><b>TOTAL BIAYA TERCATAT (2 + 3 + 4)</b></td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{rupiah(printDoc.total_cost || 0)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 800 }}>{pctOf(printDoc.total_cost)}</td>
                        </tr>
                        <tr className={Number(printDoc.margin_nominal) < 0 ? 'print-row-loss' : 'print-row-profit'}>
                          <td />
                          {/* FN-PRINTREF (REVIEW-03): rujukan lama "(1 − 5)"
                              menunjuk baris 5 yang TIDAK ADA di tabel ini
                              (penomoran: 1 Revenue, 2 Material, 3 Tukang,
                              4 Petty Cash, lalu TOTAL HPP RIIL tanpa nomor).
                              Pembaca dokumen resmi mencari baris 5 yang tidak
                              pernah ada. Rujukan diganti ke nomor baris nyata:
                              Revenue (1) dikurangi TOTAL HPP RIIL (2 + 3 + 4). */}
                          <td><b>GROSS MARGIN / KEUNTUNGAN KOTOR (1 − TOTAL BIAYA TERCATAT)</b></td>
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

            <div className="panel" style={{ padding: '14px 18px', marginBottom: '14px', background: closingModal.underBudget ? '#eef4ee' : '#fdf2f2', borderColor: closingModal.underBudget ? 'var(--ok-border)' : 'var(--danger-border)' }}>
              <b style={{ color: closingModal.underBudget ? 'var(--ok)' : 'var(--danger)', fontSize: '14px' }}>
                {closingModal.underBudget
                  ? '✓ HEMAT — Cost kumulatif berada DI BAWAH Budget Target 70%'
                  : '⚠ OVER-BUDGET — Cost kumulatif MELEBIHI Budget Target 70%'}
              </b>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
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
                  <td style={{ paddingLeft: '26px', color: 'var(--text-muted)' }}>a. Material Cost <small>(Bakpau — COST ITEMS)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.material)}</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '26px', color: 'var(--text-muted)' }}>b. Petty Cash <small>(Bakpau — PETTY CASH)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.petty)}</td>
                </tr>
                <tr>
                  {/* FN-EST_LABEL (REVIEW-03): komponen ini = SUM(project_plans
                      .labor_cost) dari WBS Budgeting = RENCANA, bukan upah
                      terbayar. Label lama "Biaya Tukang" ambigu. */}
                  <td style={{ paddingLeft: '26px', color: 'var(--text-muted)' }}>c. Estimasi Upah Tukang <small>(WBS Budgeting / project_plans)</small></td>
                  <td style={{ textAlign: 'right' }}>{rupiah(closingModal.labor)}</td>
                </tr>
                <tr style={{ background: 'var(--olive-50)' }}>
                  <td style={{ fontWeight: 700 }}>COST KUMULATIF (a + b + c)</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupiah(closingModal.total)}</td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>Budget Target (70% × Revenue)</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupiah(closingModal.target)}</td>
                </tr>
                <tr style={{ background: closingModal.margin < 0 ? '#fdf2f2' : '#eef4ee' }}>
                  <td style={{ fontWeight: 700 }}>MARGIN / LABA KOTOR</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: closingModal.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>
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
    </CompactRoot>
  )
}
