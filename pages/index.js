import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import Login from '../components/Login'
import Sidebar from '../components/Sidebar'
import Dashboard from '../components/Dashboard'
import Finance from '../components/Finance'
import Planning from '../components/Planning'
import ProjectFinance from '../components/ProjectFinance'
import TukangUpah from '../components/TukangUpah'
import Settings from '../components/Settings'
import Module from '../components/ModuleView'
import BoqModule from '../modules/rab-boq/view'
import SalesInvoiceModule from '../modules/sales-invoice/view'
import RapModule from '../modules/rap/view'
// t_02e5f5fd: modul "Stok Workshop" — halaman source:'core' (read-only,
// dirender langsung di sini), pola sama dengan RAB & BOQ / Invoice Penjualan.
import StockModule from '../modules/stock/view'
// t_a5ba5f73: modul "Perbandingan RAB vs RAP vs Aktual" — halaman
// source:'core' (read-only dari sisi DB, draft RAP hanya di memori).
import RapCompareModule from '../modules/rap-compare/view'
// t_7253b859: modul "Customer CRM" — halaman source:'core' (read-only dari
// sisi DB; customer dari form adalah draf memori halaman, tidak tersimpan).
import CrmModule from '../modules/crm/view'
import LaborStockModule from '../modules/labor-stock/view'
// t_31a1a9f9: modul "Marketing / Lead Pipeline" — halaman source:'core'
// (read-only dari sisi DB; lead dari form adalah draf memori halaman).
import MarketingModule from '../modules/marketing/view'
import PurchasePage from '../modules/receivings/page'
import { deleteDecision } from '../modules/handovers/deleteGuard'
import { confirmUniqueHandover } from '../modules/handovers/duplicateGuardDb'
import { createActiveHandover } from '../modules/handovers/createHandover'
import { dbErrorText } from '../modules/handovers/dbErrorText'
import { labels, normalizeStatus, orderSpecFor, isHandoverDelivered, isApprovalEnabled, approvalGuard, APPROVAL_OFF_MESSAGE, navAliasFor, STOCK_MENU_NOTICE } from '../lib/constants'
import { sendPrAlert } from '../lib/telegramAlert'
import { handleFinishPr } from '../modules/requests/submit'
import { submitLean, closeRequestRemaining } from '../modules/requests/submitLean'

export default function App() {
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [rows, setRows] = useState({
    projects: [],
    vendors: [],
    materials: [],
    requests: [],
    approvals: [],
    receivings: [],
    handovers: [],
    pr_items: [],
    receiving_items: [],
    receiving_item_allocations: [],
    // t_62e41e91 — modul Actual Labor & Stok. Default null (BUKAN [])
    // supaya modul bisa membedakan "sumber belum dimuat" dari "tabel
    // kosong": modul menampilkan panel 'unavailable', bukan angka 0 yang
    // terbaca seperti "aktual nol rupiah". Kedua tabel ini tidak punya
    // kolom project_id sehingga join proyek di bawah tidak bisa membuat
    // label project — nama project diambil apa adanya dari barisnya.
    tukang_projects: null,
    project_plans: null
  })
  const [notice, setNotice] = useState('')

  // t_da4a9ef8 (B3 — konsolidasi menu): rute lama `stock` DIALIHKAN ke
  // `materials`, bukan dibiarkan membuka halaman kedua yang isinya sama.
  // Semua pemanggil navigasi (sidebar, kartu dashboard, tautan modul) lewat
  // sini, jadi tidak ada jalur yang masih bisa membuka menu duplikat; state
  // lama/bookmark tetap aman karena `page` jatuh ke modul Material.
  const goTo = (next) => {
    const target = navAliasFor(next)
    if (target) {
      setNotice(STOCK_MENU_NOTICE)
      setPage(target)
      return
    }
    setPage(next)
  }
  const [actionBusy, setActionBusy] = useState(false)
  const finishPrLockRef = useRef(false)
  const [noteModal, setNoteModal] = useState(null)
  const [noteText, setNoteText] = useState('')
  // Role user: 'admin' (semua modul + Finance) atau 'user' (tanpa Finance).
  // Diambil dari tabel profiles (kolom role) saat sesi aktif; default 'user'
  // supaya kalau gagal baca, modul admin tidak pernah tampil ke non-admin.
  const [role, setRole] = useState('user') 

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    let finished = false
    const fallbackTimer = setTimeout(() => {
      if (!finished) {
        finished = true
        setLoading(false)
      }
    }, 2500)
    supabase.auth.getSession().then(({ data }) => {
      if (!finished) {
        finished = true
        clearTimeout(fallbackTimer)
        setSession(data?.session || null)
        setLoading(false)
      }
    }).catch(err => {
      console.warn('Auth session load error:', err)
      if (!finished) {
        finished = true
        clearTimeout(fallbackTimer)
        setLoading(false)
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      clearTimeout(fallbackTimer)
      subscription?.unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (session) loadAll()
  }, [session])

  // Muat role dari profiles setiap sesi berubah.
  useEffect(() => {
    let cancelled = false
    async function loadRole() {
      if (!supabase || !session?.user?.id) { setRole('user'); return }
      try {
        const { data, error } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
        if (cancelled) return
        if (!error && data?.role) setRole(String(data.role).toLowerCase() === 'admin' ? 'admin' : 'user')
        else setRole('user')
      } catch (e) {
        if (!cancelled) setRole('user')
      }
    }
    loadRole()
    return () => { cancelled = true }
  }, [session])

  async function loadAll() {
    if (!supabase) return
    // t_50b783de (Approval OFF): `approval_steps` TIDAK dibaca sama sekali
    // saat modul Approval dimatikan — daftar approval hanya melayani modul
    // yang tidak aktif, jadi query-nya ikut diputus (bukan cuma menunya).
    // `approvals: []` dipertahankan supaya bentuk state & komponen lama tidak
    // pecah; Dashboard/Approval tidak dirender saat OFF.
    const approvalOn = isApprovalEnabled()
    const specs = [
      ['projects', 'projects'],
      ['vendors', 'vendors'],
      ['materials', 'materials'],
      ['requests', 'purchase_requests'],
      ...(approvalOn ? [['approvals', 'approval_steps']] : []),
      ['receivings', 'receivings'],
      ['handovers', 'handovers'],
      ['pr_items', 'pr_items'],
      ['receiving_items', 'receiving_items'],
      // t_62e41e91 — sumber Actual Labor (aktual: tukang_projects) &
      // estimasi (project_plans). Read-only, hanya untuk modul
      // 'labor_stock' yang admin-only. Kalau tabel/RLS belum ada di
      // environment tertentu, supabase balas error dan field dibiarkan
      // null — modul lalu menampilkan panel "belum tersedia", bukan 0.
      ['tukang_projects', 'tukang_projects'],
      ['project_plans', 'project_plans']
    ]
    const result = { ...rows }
    // Approval OFF: state approval dikosongkan supaya tidak ada baris
    // approval_steps lama yang "hidup" di memori halaman (data DB tidak
    // disentuh; hanya cache tampilan).
    if (!approvalOn) result.approvals = []
    const { data: allProj } = await supabase.from('projects').select('*')
    const projList = (allProj || []).sort((a, b) => {
      const numA = parseInt(a.kode, 10)
      const numB = parseInt(b.kode, 10)
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB
      return (a.kode || '').localeCompare(b.kode || '')
    })

    const { data: allPRs } = await supabase.from('purchase_requests').select('*').order('pr_number', { ascending: true })
    const prList = allPRs || []

    await Promise.all(specs.map(async ([name, table]) => {
      let items = []
      if (name === 'requests') {
        items = prList
      } else {
        const spec = orderSpecFor(table)
        const base = supabase.from(table).select('*')
        // sort_order bisa NULL utk data lama (sebelum backfill) — taruh di akhir.
        const { data } = spec
          ? await base.order(spec.column, { ascending: spec.ascending, nullsFirst: false })
          : await base
        items = data || []
      }

      if (name === 'projects') {
        items.sort((a, b) => {
          const numA = parseInt(a.kode, 10)
          const numB = parseInt(b.kode, 10)
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB
          return (a.kode || '').localeCompare(b.kode || '')
        })
      }

      items = items.map(item => {
        const linkedPR = item.purchase_request_id ? prList.find(p => p.id === item.purchase_request_id) : null
        const effectiveProjectId = item.project_id || linkedPR?.project_id
        const proj = projList.find(p => p.id === effectiveProjectId)
        const projLabel = proj ? (proj.kode ? `[${proj.kode}] ${proj.name}` : proj.name) : '—'
        return {
          ...item,
          project_name: projLabel,
          pr_number: item.pr_number || linkedPR?.pr_number || '—',
          title: item.title || linkedPR?.title || '—'
        }
      })

      result[name] = items
    }))

    // ---------------------------------------------------------------
    // RINCIAN BARANG SERAH TERIMA (t_7bc6246b, defect run 206)
    // ---------------------------------------------------------------
    // `handover_items` adalah sumber jumlah yang DISERAHKAN per barang.
    // Sebelum ini tabel itu TIDAK PERNAH dibaca halaman, sehingga
    // `display.rincianInfo()` selalu jatuh ke label "Rincian barang belum
    // tersedia" — bahkan setelah migrasi dijalankan dan RPC
    // `handover_confirm` menulis barisnya. Artinya fitur "rincian barang"
    // mustahil terlihat, bukan sekadar belum aktif.
    //
    // Sifat pembacaan ini: BEST-EFFORT & TIDAK MEMBLOKIR halaman. Saat tabel
    // belum ada (mode LEGACY, PGRST205) atau RLS menolak, halaman tetap
    // memuat data lain dan label jujur tetap dipakai — bukan error, bukan
    // angka karangan.
    try {
      const { data: hiRows, error: hiErr } = await supabase
        .from('handover_items')
        .select('id, handover_id, receiving_event_id, receiving_item_id, item_name, qty_diserahkan, satuan, penerima, catatan, created_at')
      if (!hiErr && Array.isArray(hiRows)) {
        const byHandover = new Map()
        for (const row of hiRows) {
          if (!row || !row.handover_id) continue
          const list = byHandover.get(row.handover_id) || []
          list.push(row)
          byHandover.set(row.handover_id, list)
        }
        result.handovers = (result.handovers || []).map(h => {
          const items = byHandover.get(h.id)
          // Hanya ditempel bila ADA baris: `rincianInfo` memakai keberadaan
          // `items` sebagai bukti rincian tersimpan, jadi array kosong akan
          // salah dianggap "tersedia".
          return items && items.length ? { ...h, items } : h
        })
      }
    } catch (e) {
      // Sengaja tidak menghentikan loadAll: rincian opsional, data inti wajib.
    }

    // ---------------------------------------------------------------
    // ALOKASI PROYEK PER BARIS NOTA (t_7bc6246b, run 246)
    // ---------------------------------------------------------------
    // `receiving_item_allocations` menyimpan pembagian satu baris nota ke
    // BEBERAPA proyek. Tanpa dibaca di sini, ProjectFinance melihat baris
    // split sebagai "tanpa proyek" dan pembagian yang SUDAH tersimpan di DB
    // tidak pernah terbaca (hanya terlihat di sesi yang menyimpannya).
    //
    // BEST-EFFORT seperti handover_items: tabel belum ada di mode LEGACY
    // (PGRST205) atau RLS menolak → halaman tetap jalan dengan array kosong,
    // dan `projectCostBreakdown` tetap jujur (baris split masuk unassigned,
    // bukan ditebak ke satu proyek).
    try {
      const { data: allocRows, error: allocErr } = await supabase
        .from('receiving_item_allocations')
        .select('id, receiving_item_id, project_id, qty, amount')
      if (!allocErr && Array.isArray(allocRows)) {
        result.receiving_item_allocations = allocRows
      }
    } catch (e) {
      // Sengaja tidak menghentikan loadAll.
    }

    setRows(result)
  }

  async function login(e) {
    e.preventDefault()
    setError('')
    if (!supabase) return setError('Koneksi Supabase belum tersedia. Periksa Environment Variables di Vercel.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
  }

  async function logout() {
    await supabase.auth.signOut()
  }

  async function updateProjectStatus(project, newStatus) {
    if (!supabase) return
    // optimistic update
    setRows(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === project.id ? { ...p, status: newStatus } : p)
    }))
    const { error } = await supabase.from('projects').update({ status: newStatus }).eq('id', project.id)
    if (error) {
      setNotice(`Gagal update status: ${error.message}`)
      loadAll()
    } else {
      setNotice(`Status project "${project.name}" berhasil diubah ke "${prettyStatus(newStatus)}".`)
      loadAll()
    }
  }

  // ============================================================
  // CATATAN (t_9109cf5e): handler status nota + gudang/tukang di bawah TIDAK
  // LAGI dipakai modul Purchase — halaman Purchase baru (dua tab + dialog
  // Proses Pembelian) tidak punya tombol gudang/tukang maupun dropdown
  // retur/refund. Distribusi fisik barang = modul Handover (task terpisah).
  // Handler dibiarkan ada (bukan dihapus) supaya modul Handover bisa memakai
  // jalur RPC yang sama tanpa duplikasi logika stok; jangan dipanggil dari
  // Purchase lagi.
  // ============================================================
  async function updateReceivingStatus(receiving, newStatus) {
    if (!supabase) return
    const up = String(newStatus || '').toUpperCase()
    const kendala = up === 'RETUR' ? 'RETUR' : (up === 'REFUND' ? 'REFUND' : null)

    // t_b418827b (arahan DAT 16 Okt): status NOTA pada nota multi-item tidak
    // boleh diubah dari parent (bisa meng-override kondisi barang anak) —
    // perubahan Retur/Refund menunggu pencatatan per barang (skema).
    const items = (rows.receiving_items || []).filter(it => it.receiving_id === receiving.id)
    if (items.length >= 2) {
      setNotice('Nota multi-item: status Retur/Refund tidak bisa diubah dari daftar — perubahan status dicatat per barang (penyimpanan per barang belum aktif: menunggu persetujuan skema).')
      return
    }

    setRows(prev => ({
      ...prev,
      receivings: (prev.receivings || []).map(r => r.id === receiving.id ? {
        ...r,
        status: up,
        kendala
      } : r)
    }))

    const { error } = await supabase.from('receivings').update({ status: up, kendala }).eq('id', receiving.id)

    if (error) {
      setNotice(`Gagal update status Purchase: ${error.message}`)
      loadAll()
    } else {
      const label = prettyReceivingStatus(up)
      setNotice(`Status Purchase "${receiving.invoice_no || receiving.delivery_note || 'Data'}" berhasil diubah ke "${label}".`)
      loadAll()
    }
  }

  // "→ Ke Gudang": SATU panggilan RPC transaksional (klaim + kredit stok di DB).
  // Guard double-klik via actionBusy; guard sebenarnya (anti dobel) ada di dalam RPC
  // (update ... where masuk_gudang = false) sehingga retry/2 user aman.
  //
  // t_b418827b (arahan DAT 16 Okt): BULK DILARANG untuk nota multi-item —
  // tiap item harus punya kondisi & tujuan sendiri (belum bisa disimpan
  // granular: menunggu receiving_events). Guard di sini mencegah bypass lewat
  // handler (UI sudah menyembunyikan tombol). Nota tanpa jumlah diterima juga
  // ditolak: qty 0 / rusak tidak boleh masuk stok.
  async function moveToWarehouse(receiving) {
    if (!supabase || actionBusy) return
    const label = receiving.invoice_no || receiving.delivery_note || 'Penerimaan'
    if (receiving.masuk_gudang) { setNotice('Barang penerimaan ini sudah masuk Stok Gudang.'); return }

    const items = (rows.receiving_items || []).filter(it => it.receiving_id === receiving.id)
    if (!items.length) {
      setNotice('Penerimaan ini belum punya rincian barang — isi lewat Terima Barang dulu sebelum masuk gudang.')
      return
    }
    if (items.length >= 2) {
      setNotice('Nota multi-item tidak bisa diproses sekaligus — kondisi & tujuan tiap barang dicatat per barang lewat Terima Barang (penyimpanan per barang belum aktif: menunggu persetujuan skema).')
      return
    }
    if (!items.some(it => Number(it.quantity_received || 0) > 0)) {
      setNotice('Belum ada jumlah diterima pada nota ini — isi jumlah lewat Terima Barang dulu (0/rusak tidak masuk stok).')
      return
    }

    const ok = window.confirm(`Masukkan barang dari "${label}" ke Stok Gudang Workshop? Stok material terkait akan bertambah otomatis (hanya item yang sudah diterima).`)
    if (!ok) return

    setActionBusy(true)
    try {
      const { data, error } = await supabase.rpc('receive_to_warehouse', { p_receiving_id: receiving.id })
      if (error) { setNotice(`Gagal masuk gudang: ${error.message}`); loadAll(); return }
      if (!data || data.ok === false) {
        if (data && data.reason === 'none_received') {
          setNotice('Belum ada item yang bertanda "Sudah Diterima" — tandai dulu di panel item, lalu ulangi Ke Gudang.')
        } else if (data && data.reason === 'already') {
          setNotice('Barang penerimaan ini sudah masuk Stok Gudang (atau sedang Retur/Refund).')
        } else {
          setNotice('Tidak bisa masuk gudang: status penerimaan Retur/Refund atau sudah diproses.')
        }
        loadAll(); return
      }
      setNotice(`Barang "${label}" masuk Stok Gudang. ${data.added} material bertambah${data.skipped ? `, ${data.skipped} item dilewati (belum diterima/tanpa material)` : ''}.`)
      loadAll()
    } finally {
      setActionBusy(false)
    }
  }

  // "→ Ke Tukang": SATU panggilan RPC transaksional — klaim alokasi dulu, lalu
  // insert handover. Jika dipanggil dua kali (retry/2 user), handover tidak dobel.
  // t_b418827b: handover yang dibuat masuk antrean "Belum Diserahkan" (DRAFT).
  // Rincian qty per item TIDAK ditulis ke kolom note (itu "packing" yang
  // dilarang DAT dan menebak dari quantity_received kumulatif yang bisa
  // berubah) — rincian menunggu tabel handover_items.
  async function sendToTukang(receiving) {
    if (!supabase || actionBusy) return
    const label = receiving.invoice_no || receiving.delivery_note || 'Penerimaan'
    if (receiving.alokasi === 'KE_TUKANG' || receiving.tukang_at) { setNotice('Barang penerimaan ini sudah dikirim ke tukang.'); return }
    // t_b418827b (arahan DAT 16 Okt): bulk ke tukang DILARANG untuk nota
    // multi-item / tanpa jumlah diterima — guard handler mencegah bypass UI.
    const tukangItems = (rows.receiving_items || []).filter(it => it.receiving_id === receiving.id)
    if (tukangItems.length >= 2) {
      setNotice('Nota multi-item tidak bisa diserahkan sekaligus — barang ke tukang dipilih per barang lewat Terima Barang (penyimpanan per barang belum aktif: menunggu persetujuan skema).')
      return
    }
    if (!tukangItems.some(it => Number(it.quantity_received || 0) > 0)) {
      setNotice('Belum ada jumlah diterima pada nota ini — isi jumlah lewat Terima Barang dulu (0/rusak tidak ikut diserahkan).')
      return
    }
    const receiverInput = window.prompt(`Kirim barang dari "${label}" langsung ke tukang?\nMasukkan nama tukang / penerima barang:`, 'Tukang')
    if (receiverInput === null) return
    const receivedBy = receiverInput.trim() || 'Tukang'

    setActionBusy(true)
    try {
      // REVIEW run 251 / D3: panggilan RPC legacy `send_receiving_to_tukang`
      // DIHAPUS. Fungsi itu tidak ada di paket operasional v1 (0 hasil grep di
      // seluruh paket; X18 hanya menemukan `handover_confirm` dan
      // `handover_create_atomic`), jadi panggilan pertama SELALU gagal:
      // satu round-trip jaringan sia-sia setiap kali, dan — lebih berbahaya —
      // bila kelak RPC dengan nama itu dibuat dengan kontrak berbeda, jalur ini
      // akan MENDAHULUINYA dan melewati penjaga v1 (menulis `received_by` dan
      // `receivings.alokasi` langsung, bukan lewat RPC).
      //
      // Satu-satunya pintu yang tersisa adalah `createActiveHandover()` di
      // bawah — penjaga yang SAMA dengan form Tambah dan antrean pembelian
      // (RPC `handover_create_atomic` saat skema v1 aktif, slot deterministik
      // saat LEGACY).
      const now = new Date().toISOString()
      // REVIEW run 244 (BUG-W3): jalur ini dulu INSERT LANGSUNG tanpa penjaga —
      // pintu ketiga yang membuat dokumen kedua untuk satu penerimaan. Sekarang
      // lewat penjaga yang SAMA dengan form Tambah.
      const queued = await createActiveHandover({
        data: {
          receiving_id: receiving.id,
          project_id: receiving.project_id || null,
          received_by: receivedBy,
          handover_date: now.slice(0, 10),
          status: 'DRAFT',
          note: `Barang dari penerimaan ${label} dikirim langsung ke tukang. Menunggu konfirmasi serah terima fisik.`
        }
      })
      // Dokumen aktif sudah ada (dibuat pintu lain) → antrean tetap ada,
      // tidak ada yang perlu dibuat. Bukan kegagalan.
      if (!queued.ok && !queued.existingId && !queued.raced) {
        setNotice(`Gagal membuat Serah Terima: ${queued.reason}`)
        return
      }

      // `receivings.alokasi` adalah kolom HEADER legacy. Saat skema v1 aktif,
      // trigger `ops_v1_core_guard` menolaknya untuk peran API (tulisan fisik
      // harus lewat RPC), jadi kegagalan di sini TIDAK boleh menggagalkan
      // pembuatan dokumen yang sudah sah — cukup dilaporkan apa adanya.
      const { error } = await supabase.from('receivings').update({ alokasi: 'KE_TUKANG', tukang_at: now }).eq('id', receiving.id)
      if (error) {
        const t = dbErrorText(error, { fallback: 'Tujuan barang tidak bisa dicatat di header nota.' })
        setNotice(`Serah Terima sudah dibuat dan masuk antrean. Catatan tujuan di header nota tidak tersimpan: ${t.text}`)
        loadAll()
        return
      }

      setNotice(`Barang "${label}" dikirim ke tukang (${receivedBy}) dan masuk antrean Serah Terima — tandai "Sudah Diserahkan" setelah serah terima fisik.`)
      loadAll()
    } catch (err) {
      setNotice(`Terjadi kesalahan saat kirim ke tukang: ${err.message}`)
      loadAll()
    } finally {
      setActionBusy(false)
    }
  }

  // Handover: tandai "sudah diserahkan" — konfirmasi FISIK eksplisit.
  // t_b418827b: "Sudah Diserahkan" hanya bermakna bila `diserahkan_at` tertulis
  // (bukti live A3: CONFIRMED lama tanpa diserahkan_at). Penulisan lewat
  // modules/handovers/confirm.js: idempoten (guard `diserahkan_at IS NULL`),
  // tidak bisa re-confirm, dan selalu menulis waktu penyerahan.
  //
  // REVIEW run 244 (BUG-W3 + butir 2a): jalur shell ini dulu memanggil
  // `confirm.js` LANGSUNG — pintu konfirmasi keempat yang tidak memakai
  // penjaga dokumen ganda dan tidak memverifikasi apa pun sesudah menulis.
  // Sekarang lewat `confirmUniqueHandover()`: periksa DB sebelum, tulis, lalu
  // periksa DB LAGI sesudah `diserahkan_at` tertulis.
  async function markHandoverDelivered(handover) {
    if (!supabase) return
    if (isHandoverDelivered(handover)) { setNotice('Serah terima ini sudah ditandai diserahkan.'); return }
    const ok = window.confirm('Tandai serah terima ini sebagai SUDAH DISERAHKAN?\nLakukan hanya setelah barang benar-benar diterima tukang/mandor di lokasi.')
    if (!ok) return
    const res = await confirmUniqueHandover({ handover })
    if (!res.ok) { setNotice(`Gagal menandai sudah diserahkan: ${res.error}`); return }
    if (res.warning) setNotice(res.warning)
    else setNotice(res.already ? 'Serah terima ini sudah ditandai diserahkan sebelumnya.' : 'Serah terima ditandai sudah diserahkan (waktu penyerahan tercatat).')
    loadAll()
  }

  // Tolak / Revisi membuka dialog catatan dulu; Setujui langsung konfirmasi.
  // t_50b783de: guard pertama — saat Approval OFF tidak ada dialog, tidak ada
  // write, tidak ada alert. Fail closed sebelum efek samping apa pun.
  function decideApproval(approval, decision) {
    const gate = approvalGuard('decide')
    if (!gate.ok) { setNotice(gate.error); return }
    if (!supabase) return
    if (decision === 'REJECTED') {
      setNoteText('')
      setNoteModal({ approval, decision })
      return
    }
    const ok = window.confirm(`Apakah Anda yakin ingin menandai pengajuan "${approval.pr_number || 'PR'}" sebagai DISETUJUI?`)
    if (!ok) return
    executeDecision(approval, 'APPROVED', '')
  }

  function submitNote(e) {
    e.preventDefault()
    if (!noteModal) return
    const { approval, decision } = noteModal
    const userNote = noteText.trim()
    setNoteModal(null)
    setNoteText('')
    executeDecision(approval, decision, userNote)
  }

  async function executeDecision(approval, decision, userNote) {
    // Guard kedua (defense in depth): jalur ini bisa dipanggil dari state
    // modal lama / sisa event; tetap fail closed sebelum menyentuh DB.
    const gate = approvalGuard('execute-decision')
    if (!gate.ok) { setNotice(gate.error); return }
    if (!supabase || actionBusy) return
    const now = new Date().toISOString()
    const label = decision === 'APPROVED' ? 'DISETUJUI' : (decision === 'REJECTED' ? 'DITOLAK' : 'DIMINTA REVISI')
    // Catatan hanya diisi jika user mengetikkan sendiri; kalau kosong biarkan null
    const note = userNote ? userNote : null

    const { error: appErr } = await supabase.from('approval_steps').update({
      status: decision,
      decided_at: now,
      note
    }).eq('id', approval.id)

    // GATE UTAMA: kalau update approval gagal, JANGAN lanjut mengubah PR/items
    // (sebelumnya bisa divergen: approval PENDING tapi PR APPROVED + masuk Purchase).
    if (appErr) {
      setNotice(`Gagal update approval: ${appErr.message}`)
      loadAll()
      return
    }

    let prErr = null
    let itemErr = null
    let syncErr = null
    if (approval.purchase_request_id) {
      const { error: e1 } = await supabase.from('purchase_requests').update({
        status: decision
      }).eq('id', approval.purchase_request_id)
      prErr = e1

      // Logika: PR disetujui => semua material di dalamnya ikut disetujui
      // (material yang sudah ORDERED tidak ditimpa). Error dicek supaya status
      // PR dan status material tidak pernah berbeda tanpa pemberitahuan.
      if (decision === 'APPROVED') {
        const { error: e2 } = await supabase.from('pr_items').update({ status: 'APPROVED' })
          .eq('pr_id', approval.purchase_request_id)
          .or('status.is.null,status.neq.ORDERED')
        itemErr = e2

        // Semua barang yang disetujui otomatis masuk modul Purchase
        // (RPC atomic — anti dobel walau approve bersamaan).
        if (!itemErr) {
          const { data: prItems, error: fetchItemsErr } = await supabase.from('pr_items')
            .select('*').eq('pr_id', approval.purchase_request_id)
          if (fetchItemsErr) {
            syncErr = fetchItemsErr.message
          } else {
            const syncErrors = []
            for (const it of (prItems || [])) {
              const sync = await ensureItemInPurchase(it)
              if (!sync.ok) syncErrors.push(sync.error)
            }
            if (syncErrors.length) syncErr = syncErrors.join('; ')
          }
        }
      }

      // PR ditolak / minta revisi => bersihkan baris Purchase yang BELUM diproses
      // (belum diterima, belum masuk gudang, belum ke tukang) supaya barang yang
      // tidak jadi tidak bisa lanjut ke stok. Yang sudah diproses tidak disentuh.
      if (decision === 'REJECTED' || decision === 'REVISI') {
        const { error: clErr } = await supabase.rpc('cleanup_unreceived_purchase', {
          p_pr_id: approval.purchase_request_id
        })
        if (clErr) {
          setNotice(`${label}: ${approval.pr_number || 'PR'} — peringatan, gagal membersihkan baris Purchase: ${clErr.message}`)
          loadAll()
          return
        }
      }
    }

    if (prErr) {
      setNotice(`Approval terupdate, tapi gagal update status PR: ${prErr.message}`)
    } else if (itemErr) {
      setNotice(`PR ${label.toLowerCase()}, tapi ada material yang gagal ikut diupdate: ${itemErr.message}`)
    } else if (syncErr) {
      setNotice(`PR ${label.toLowerCase()}, tapi ada barang yang gagal masuk modul Purchase: ${syncErr}`)
    } else {
      setNotice(`Pengajuan ${approval.pr_number || 'PR'} berhasil ${label}.`)
    }
    loadAll()
  }

  // ============================================================
  // ALUR PENGADAAN: order -> receiving -> handover
  // ============================================================

  // Approval "Revise" -> status REVISI pada approval + PR
  function reviseApproval(approval) {
    const gate = approvalGuard('revise')
    if (!gate.ok) { setNotice(gate.error); return }
    if (!supabase) return
    setNoteText('')
    setNoteModal({ approval, decision: 'REVISI' })
  }

  // Setujui material satu per satu (dipakai di modul Approval, panel Material).
  // Barang yang disetujui otomatis masuk ke modul Purchase (RPC atomic).
  // Guard actionBusy mencegah dobel-klik; guard sebenarnya tetap di DB (advisory lock).
  async function approveItem(prItem) {
    // t_50b783de: aksi ini menulis pr_items.status = APPROVED + membuat baris
    // Purchase lewat approval. Fail closed saat Approval OFF (tanpa RPC/write).
    const gate = approvalGuard('approve-item')
    if (!gate.ok) { setNotice(gate.error); return }
    if (!supabase || actionBusy) return
    const ok = window.confirm(`Setujui material "${prItem.item_name || prItem.kode}"? Barang akan otomatis masuk ke modul Purchase.`)
    if (!ok) return
    setActionBusy(true)
    try {
      // Sync ke Purchase DULU (idempotent): kalau sync gagal, status item
      // tidak berubah — tidak ada state "APPROVED tapi tidak ada di Purchase".
      const sync = await ensureItemInPurchase(prItem)
      if (!sync.ok) {
        setNotice(`Gagal menambah material ke modul Purchase: ${sync.error}`)
        loadAll()
        return
      }
      const { error } = await supabase.from('pr_items').update({ status: 'APPROVED' }).eq('id', prItem.id)
      if (error) { setNotice(`Gagal menyetujui material: ${error.message}`); loadAll(); return }
      setNotice(`Material "${prItem.item_name || prItem.kode}" disetujui dan masuk modul Purchase.`)
      loadAll()
    } finally {
      setActionBusy(false)
    }
  }

  // Tombol ✓ Selesai & Kirim: mengirim request lewat JALUR LEAN (tanpa approval).
  // t_a5a73034 — alur baru: status existing SUBMITTED + penanda [Jalur: LEAN],
  // TIDAK membuat approval_steps, TIDAK membuat cangkang nota, TIDAK mengubah
  // status item menjadi APPROVED.
  // t_50b783de (Approval OFF) — PR REJECTED yang DIPERBAIKI juga dikirim ulang
  // lewat jalur lean memakai ID & nomor yang SAMA (riwayat penolakan tetap
  // tersimpan). Selama modul Approval hidup, REJECTED tetap ke antrean approval
  // (handleFinishPr) supaya perilaku lama tidak berubah.
  async function finishPr(pr) {
    const isRejected = String(pr?.status || '').toUpperCase() === 'REJECTED'
    if (isRejected && isApprovalEnabled()) {
      return handleFinishPr(pr, {
        supabase,
        session,
        confirmFn: (msg) => window.confirm(msg),
        setNotice,
        loadAll,
        actionBusy,
        setActionBusy,
        lockRef: finishPrLockRef,
        sendPrAlert
      })
    }
    return submitLean(pr, {
      supabase,
      confirmFn: (msg) => window.confirm(msg),
      setNotice,
      loadAll,
      actionBusy,
      setActionBusy,
      lockRef: finishPrLockRef
    })
  }

  // Tutup sisa kebutuhan (jalur lean) — hanya catatan+alasan, qty asli tetap.
  async function closePrRemaining(pr, reason) {
    return closeRequestRemaining(pr, reason, {
      supabase,
      confirmFn: (msg) => window.confirm(msg),
      setNotice,
      loadAll,
      actionBusy,
      setActionBusy,
      lockRef: finishPrLockRef
    })
  }

  // Pastikan item PR punya baris di modul Purchase (receiving + receiving_items).
  // Idempotent DIJAMIN DB: RPC ensure_item_in_purchase memakai advisory lock per PR
  // + unique index receiving_items(receiving_id, pr_item_id). Dua user / dua klik
  // bersamaan tidak bisa membuat header atau item dobel.
  async function ensureItemInPurchase(prItem) {
    if (!supabase) return { ok: false, error: 'Supabase tidak tersedia' }
    try {
      const prId = prItem.pr_id
      const pr = (rows.requests || []).find(p => p.id === prId)
      if (!pr) return { ok: false, error: 'PR item tidak terhubung ke PR manapun.' }

      const { data, error } = await supabase.rpc('ensure_item_in_purchase', {
        p_pr_id: prId,
        p_pr_item_id: prItem.id,
        p_item_name: prItem.item_name || 'Item',
        p_unit: prItem.unit || 'Pcs',
        p_project_id: pr.project_id || null,
        p_delivery_note: `PO ${pr.pr_number || ''} - ${pr.title || ''}`.trim()
      })
      if (error) return { ok: false, error: error.message }
      if (!data || data.ok === false) return { ok: false, error: 'RPC gagal' }
      return { ok: true, recId: data.receiving_id, already: !!data.already }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  // Tombol "🛒 Sudah Order": tandai item ORDERED. Item sudah otomatis ada di
  // modul Purchase sejak disetujui (ensureItemInPurchase), jadi di sini hanya
  // memastikan keberadaannya (dedup) lalu update status.
  // t_50b783de: hanya dijangkau dari modul Approval → fail closed saat OFF.
  async function markPrItemOrdered(prItem) {
    const gate = approvalGuard('mark-ordered')
    if (!gate.ok) { setNotice(gate.error); return }
    if (!supabase || actionBusy) return
    const ok = window.confirm(`Tandai item "${prItem.item_name || prItem.kode}" sebagai SUDAH DIORDER? Item tetap terpantau di modul Purchase.`)
    if (!ok) return

    setActionBusy(true)
    try {
      // Sync DULU (idempotent), baru ubah status: kalau sync gagal, item tetap
      // APPROVED dan bisa dicoba lagi (tidak nyangkut ORDERED tanpa baris Purchase).
      const sync = await ensureItemInPurchase(prItem)
      if (!sync.ok) { setNotice(`Gagal menambah item ke modul Purchase: ${sync.error}`); loadAll(); return }

      const { error: itemErr } = await supabase.from('pr_items')
        .update({ status: 'ORDERED' })
        .eq('id', prItem.id)
      if (itemErr) { setNotice(`Gagal update item: ${itemErr.message}`); loadAll(); return }

      setNotice(`Item "${prItem.item_name || prItem.kode}" sudah diorder dan ada di modul Purchase.`)
      loadAll()
    } catch (err) {
      setNotice(`Terjadi kesalahan saat order item: ${err.message}`)
      loadAll()
    } finally {
      setActionBusy(false)
    }
  }

  // ============================================================
  // CATATAN (t_5196b689): fungsi legacy "Langkah 1 — Cek Fisik"
  // (markReceivingItemReceived) dan updateReceivingQty (mutation per
  // keystroke) SUDAH DIHAPUS. Seluruh input qty penerimaan kini lewat SATU
  // form "Terima Barang" (modules/receivings/receiptForm.jsx +
  // receiptSave.js) yang tervalidasi, submit tunggal, dan anti-dobel.
  // Alokasi akhir (Gudang/Tukang) tetap di moveToWarehouse/sendToTukang.
  // ============================================================

  async function deleteItem(pageTarget, item) {
    if (!supabase) return
    // ============================================================
    // SAFETY BARRIER RIWAYAT FISIK (defect run 237 — t_7bc6246b)
    // ============================================================
    // Tombol 🗑️ ada di SETIAP baris Serah Terima tanpa syarat. Di PostgreSQL
    // nyata (probe_run237_delete.mjs, 16/16) `delete from handovers` yang
    // PERSIS dilakukan di bawah ini:
    //   • menghapus `handover_items` lewat `on delete cascade` → bukti fisik
    //     serah terima hilang permanen;
    //   • TIDAK mengoreksi `receiving_items.qty_handed_over` → angka
    //     "sudah diserahkan" (5) tidak lagi cocok dengan rincian (0);
    //   • membuat `v_receipt_progress.belum_diserahkan` kembali penuh →
    //     barang yang SUDAH diterima tampil "belum diserahkan";
    //   • MEMBUKA kuota tukang → dokumen baru diterima RPC untuk barang yang
    //     sama (penyerahan fisik ganda yang tidak terlihat di total);
    //   • ditandai `qty_handed_over_mismatch` oleh checker integritas DB.
    // Hapus NOTA (Pembelian) juga ditolak FK `restrict`, tetapi admin hanya
    // melihat pesan mentah Postgres. Keduanya sekarang ditolak DI DEPAN dengan
    // sebab yang bisa dibaca, sebelum optimistic update — jadi semua jalur
    // hapus (ikon desktop, kartu mobile, pemanggilan programatik) tercakup.
    // ============================================================
    const del = deleteDecision(pageTarget, item, { handovers: rows.handovers || [] })
    if (!del.ok) {
      setNotice(del.reason)
      return
    }
    // Status CONFIRMED/SELESAI tanpa bukti fisik = status basi (bukan bukti).
    // Boleh dihapus, tetapi admin harus tahu yang hilang adalah status lama —
    // bukan bukti penyerahan. Konfirmasi ini TIDAK menghalangi pekerjaan sah.
    if (del.warn && !window.confirm(del.warn)) return
    // ============================================================
    // SAFETY BARRIER VENDOR (t_e626b674 — arahan DAT): konfirmasi
    // bertingkat SEBELUM konfirmasi generik. Vendor berrelasi dgn riwayat
    // transaksi pengadaan & acuan harga material; hapus vendor harus
    // disengaja, bukan satu ketukan yang salah. (UI kartu mobile & tabel
    // desktop Vendor sudah menjalankan gerbang pertamanya di
    // modules/vendors/view.jsx — gerbang di sini menjaga SEMUA jalur hapus.)
    // ============================================================
    if (pageTarget === 'vendors') {
      const namaVendor = item?.name || item?.code || 'vendor ini'
      const okWarning = window.confirm(
        'PERINGATAN: Menghapus vendor dapat mempengaruhi riwayat transaksi pengadaan ' +
        'dan acuan harga material terkait.\n\n' +
        `Apakah Anda benar-benar yakin ingin menghapus "${namaVendor}"?`
      )
      if (!okWarning) return
    }
    const typeLabel = pageTarget === 'vendors' ? 'Vendor' : (pageTarget === 'materials' ? 'Material' : (pageTarget === 'requests' ? 'Purchase Request' : (pageTarget === 'receivings' ? 'Pembelian' : (pageTarget === 'handovers' ? 'Serah Terima' : (pageTarget === 'projects' || pageTarget === 'past_projects' ? 'Project' : 'Data')))))
    
    // Sesuaikan penentuan itemName berdasarkan pageTarget
    let itemName
    if (pageTarget === 'vendors') {
      itemName = item.name || item.code || 'Item'
    } else if (pageTarget === 'materials') {
      itemName = item.item_name || item.kode || 'Item'
    } else if (pageTarget === 'projects' || pageTarget === 'past_projects') {
      itemName = item.name || item.kode || 'Item'
    } else if (pageTarget === 'requests') {
      itemName = item.pr_number || item.title || 'Item'
    } else if (pageTarget === 'receivings') {
      itemName = item.invoice_no || item.delivery_note || 'Item'
    } else if (pageTarget === 'handovers') {
      itemName = item.received_by || 'Item'
    } else {
      itemName = item.invoice_no || item.pr_number || item.delivery_note || item.received_by || item.name || item.kode || item.code || 'Item'
    }
    
    const ok = window.confirm(`Apakah Anda yakin ingin menghapus ${typeLabel.toLowerCase()} "${itemName}"?`)
    if (!ok) return

    const tableMap = {
      vendors: 'vendors',
      materials: 'materials',
      requests: 'purchase_requests',
      receivings: 'receivings',
      handovers: 'handovers',
      // t_50b783de: hapus baris approval_steps adalah konektor approval —
      // diblokir saat modul OFF (histori TIDAK boleh hilang lewat UI).
      approvals: 'approval_steps',
      projects: 'projects',
      past_projects: 'projects'
    }
    if (pageTarget === 'approvals' && !isApprovalEnabled()) {
      setNotice('Hapus data approval dinonaktifkan sementara. Riwayat approval lama tetap tersimpan.')
      return
    }
    const table = tableMap[pageTarget]
    if (!table) {
      setNotice(`Operasi hapus dibatalkan: target ${pageTarget} tidak diizinkan.`)
      return
    }
    
    // optimistic update
    setRows(prev => ({
      ...prev,
      [pageTarget]: (prev[pageTarget] || []).filter(x => x.id !== item.id)
    }))

    // Relasi FK sudah atomik di level database (ON DELETE CASCADE / SET NULL):
    // - hapus PR   -> item materialnya ikut terhapus, approval/receiving cascade
    // - hapus master -> tautan di item PR otomatis jadi NULL
    // Jadi cukup satu operasi delete; tidak ada pembersihan manual yang bisa
    // meninggalkan data setengah jalan bila delete utamanya gagal.
    try {
      const { error } = await supabase.from(table).delete().eq('id', item.id)
      if (error) {
        setNotice(`Gagal menghapus ${typeLabel.toLowerCase()}: ${error.message}`)
        loadAll()
      } else {
        setNotice(`${typeLabel} "${itemName}" berhasil dihapus.`)
        loadAll()
      }
    } catch (err) {
      setNotice(`Terjadi kesalahan saat menghapus: ${err.message}`)
      loadAll()
    }
  }

  if (loading) return <div className="center">Memuat aplikasi…</div>
  if (!session) return <Login email={email} password={password} setEmail={setEmail} setPassword={setPassword} login={login} error={error} configured={!!supabase} />

  const activeProjects = (rows.projects || []).filter(p => normalizeStatus(p.status) !== 'DONE')
  const pastProjects = (rows.projects || []).filter(p => normalizeStatus(p.status) === 'DONE')
  const currentRows = page === 'projects' ? activeProjects : (page === 'past_projects' ? pastProjects : (rows[page] || []))
  // t_31871b64: route lama `past_projects` TETAP berfungsi (link/bookmark
  // lama, kartu Dashboard, link dari modul lain). Ia dirender sebagai modul
  // Projects yang sama, hanya dengan tab "Selesai" langsung aktif — jadi
  // tidak ada data yang hilang dan tidak ada ID navigasi yang mati.
  // Modules yang dirender ModuleView selain Projects memakai tab default.
  const modulePage = page === 'past_projects' ? 'projects' : page
  // t_50b783de: rute Approval yang dipaksa lewat state/bookmark TIDAK
  // dirender sebagai modul — fallback aman (tanpa tabel, tanpa tombol aksi).
  const approvalBlocked = page === 'approvals' && !isApprovalEnabled()

  return (
    <main className="shell">
      <Sidebar page={page} setPage={goTo} session={session} logout={logout} role={role} />
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">OPERASIONAL INTERNAL</p>
            <h1>{page === 'dashboard' ? 'Dashboard' : (approvalBlocked ? 'Approval (nonaktif)' : labels[page])}</h1>
          </div>
          {/* Halaman modul admin punya tombol refresh SENDIRI di toolbar modulnya
              (satu tombol per halaman — permintaan user 11 Okt). Tombol global
              disembunyikan di sana supaya tidak ada 2-3 tombol refresh sekaligus.
              Resolusi konflik port Marketing (7ce9414): daftar HEAD dipertahankan
              UTUH (termasuk 'rap' yang ditambahkan integrasi S3) dan 'marketing'
              ditambahkan — jangan sampai port modul baru menghapus rute lain. */}
          {!['planning', 'project_finance', 'finance', 'tukang_upah', 'rab_boq', 'sales_invoice', 'rap', 'rap_compare', 'crm', 'labor_stock', 'marketing', 'settings'].includes(page) && (
            <button className="outline" onClick={loadAll}>↻ Perbarui</button>
          )}
        </header>
        {notice && <div className="notice">{notice}</div>}
        {approvalBlocked ? (
          // ============================================================
          // FALLBACK AMAN RUTE APPROVAL (t_50b783de)
          // ============================================================
          // Modul Approval purchasing dinonaktifkan sementara. Halaman ini
          // TIDAK merender tabel approval, TIDAK memuat approval_steps, dan
          // TIDAK menyediakan tombol setujui/tolak/revisi — hanya penjelasan
          // + jalan keluar ke modul yang masih aktif. Tidak ada data yang
          // dihapus/diubah; riwayat approval tetap tersimpan di database.
          <div className="panel empty" role="status" data-testid="approval-off-fallback">
            <h2 style={{ marginTop: 0 }}>Modul Approval dinonaktifkan sementara</h2>
            <p style={{ maxWidth: '640px', lineHeight: 1.6 }}>{APPROVAL_OFF_MESSAGE}</p>
            <p style={{ maxWidth: '640px', lineHeight: 1.6 }}>
              Request baru cukup dikirim dengan tombol <b>✓ Selesai &amp; Kirim</b> pada modul Purchase Request;
              admin langsung menindaklanjuti di modul <b>Pembelian</b>. Riwayat approval dan penolakan lama
              tetap tersimpan dan tidak diubah.
            </p>
            <div className="actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              <button type="button" onClick={() => setPage('requests')}>Buka Purchase Request</button>
              <button type="button" className="outline" onClick={() => setPage('receivings')}>Buka Pembelian</button>
              <button type="button" className="outline" onClick={() => setPage('dashboard')}>Ke Dashboard</button>
            </div>
          </div>
        ) : page === 'dashboard' ? (
          <Dashboard
            rows={rows}
            activeProjects={activeProjects}
            pastProjects={pastProjects}
            setPage={goTo}
            role={role}
          />
        ) : page === 'planning' ? (
          role === 'admin' ? (
            <Planning rows={rows} session={session} say={setNotice} setPage={setPage} refresh={loadAll} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'project_finance' ? (
          role === 'admin' ? (
            <ProjectFinance rows={rows} session={session} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'finance' ? (
          role === 'admin' ? (
            <Finance rows={rows} session={session} refresh={loadAll} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'tukang_upah' ? (
          role === 'admin' ? (
            <TukangUpah />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'rab_boq' ? (
          // RAB & BOQ (t_18564dce) — modul admin-only. Guard RENDER di sini:
          // pengguna biasa yang memaksa page='rab_boq' lewat manipulasi state
          // tetap mendapat panel "khusus administrator" — role TIDAK dibaca
          // dari input apapun, hanya dari profiles (server data) di atas.
          // Menu + kartu dashboard sudah disembunyikan untuk non-admin, dan
          // seluruh mutasi modul (insert projects) tunduk pada RLS database
          // sehingga guard ini bukan satu-satunya lapisan.
          role === 'admin' ? (
            <BoqModule projects={rows.projects || []} refresh={loadAll} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'sales_invoice' ? (
          role === 'admin' ? (
            <SalesInvoiceModule
              projects={rows.projects || []}
              allProjects={allProjects || []}
              say={setNotice}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'crm' ? (
          // ============================================================
          // MODUL CUSTOMER CRM (t_7253b859) — READ-ONLY
          // ============================================================
          // Halaman sendiri (source:'core' di registry), bukan tabel
          // ModuleView: tampilannya daftar + pencarian + form draf, bukan
          // CRUD generik. TIDAK ada tabel customers, TIDAK ada RPC, TIDAK
          // ada migrasi, TIDAK ada penulisan DB. Customer dari form hidup
          // sebagai draf memori halaman dan diberi label "Draf halaman".
          // Sumber data = prop `customers` (host) atau rows.customers; kalau
          // tidak ada yang dikirim, modul menampilkan panel capability
          // 'unavailable' — bukan daftar kosong yang terlihat seperti bug.
          // Guard admin sama seperti modul admin lainnya.
          role === 'admin' ? (
            <CrmModule
              rows={rows}
              customers={rows.customers}
              invoiceCounts={null}
              say={setNotice}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'labor_stock' ? (
          // ============================================================
          // MODUL ACTUAL LABOR & STOK (t_62e41e91) — READ-ONLY
          // ============================================================
          // Halaman sendiri (source:'core'), bukan tabel ModuleView: satu
          // halaman untuk dua ringkasan yang sudah ada di repo.
          //   1) ACTUAL LABOR — rows.tukang_projects (total_upah = aktual,
          //      sinkron Google Sheets tim finance) dibanding rows.
          //      project_plans (labor_cost = ESTIMASI rencana). Estimasi
          //      dan aktual TIDAK pernah dijumlahkan atau ditukar; selisih
          //      hanya dihitung bila keduanya ada.
          //   2) WORKSHOP STOCK — ringkasan rows.materials (memakai
          //      kembali modules/stock/logic.js supaya aturan "bukan 0"
          //      konsisten dengan modul Stok Workshop).
          // TIDAK ada tabel DB baru, TIDAK ada RPC, TIDAK ada migrasi,
          // TIDAK ada penulisan, dan formula finance TIDAK disentuh.
          // Sumber yang tidak dikirim host tampil sebagai panel capability
          // 'unavailable' — bukan angka 0 yang terbaca "aktual nol rupiah".
          // Guard admin sama seperti modul admin lainnya.
          role === 'admin' ? (
            <LaborStockModule
              rows={rows}
              laborRows={rows.tukang_projects}
              estimateRows={rows.project_plans}
              materials={rows.materials}
              say={setNotice}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'marketing' ? (
          // ============================================================
          // MODUL MARKETING / LEAD PIPELINE (t_31a1a9f9) — READ-ONLY
          // ============================================================
          // Halaman sendiri (source:'core'), bukan tabel ModuleView:
          // papan tahap New Lead → Qualified → RAB → Won/Lost dengan
          // filter + form draf. TIDAK ada tabel leads, TIDAK ada RPC,
          // TIDAK ada migrasi, TIDAK ada penulisan DB, dan formula
          // finance TIDAK disentuh. Lead dari form hidup sebagai draf
          // memori halaman dan diberi label "Draf halaman" di setiap
          // kartunya.
          // Sumber lead = prop `leads` (host) atau rows.leads. Host tidak
          // mengirim sumber sama sekali -> panel capability 'unavailable',
          // BUKAN papan kosong yang terlihat seperti bug. Lead bertahap
          // yang tidak dikenali ditaruh di ember "Tahap tidak diketahui"
          // — tidak dipaksa masuk New Lead.
          // Tautan CRM hanya bisa diselesaikan kalau host mengirim
          // `customers`; kalau tidak, halaman menulis "tidak dikirim",
          // BUKAN "tidak ditemukan". Guard admin sama seperti modul
          // admin lainnya.
          role === 'admin' ? (
            <MarketingModule
              rows={rows}
              leads={rows.leads}
              customers={rows.customers}
              say={setNotice}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'settings' ? (
          <Settings role={role} session={session} />
        ) : page === 'rap' ? (
          // RAP (t_71d95cfe) — rencana anggaran PELAKSANAAN internal,
          // admin-only (pola guard 3 lapis yang sama dengan RAB & BOQ).
          // Modul ini DRAFT-ONLY: tidak ada tabel RAP dan tidak ada tulisan
          // DB dari halaman ini (lihat docs/rap-contract.md). Guard render
          // di sini mencegah non-admin yang memaksa page='rap'.
          role === 'admin' ? (
            <RapModule
              projects={rows.projects || []}
              say={setNotice}
              setPage={setPage}
              session={session}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'rap_compare' ? (
          // ============================================================
          // MODUL PERBANDINGAN RAB vs RAP vs AKTUAL (t_a5ba5f73)
          // ============================================================
          // Read-only dari sisi DB: membaca rows.boq_items (acuan RAB)
          // dan rows.receiving_items (aktual dari nota). Draft RAP hanya
          // hidup di state komponen — tidak ada tabel/RPC/migrasi baru,
          // tidak ada localStorage, dan itu ditulis jelas di layar.
          // Guard admin sama seperti modul RAB & BOQ / Invoice.
          role === 'admin' ? (
            <RapCompareModule
              rows={rows}
              allProjects={rows.projects || []}
              say={setNotice}
            />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'stock' ? (
          // ============================================================
          // MODUL STOK WORKSHOP (t_02e5f5fd) — READ-ONLY
          // ============================================================
          // Halaman sendiri (source:'core' di registry), bukan tabel
          // ModuleView: tampilannya kumpulan kartu ringkas, bukan CRUD.
          // HANYA membaca rows.materials yang SUDAH dimuat loadAll() —
          // tidak ada query Supabase tambahan, tidak ada penulisan DB,
          // tidak ada perubahan schema. Angka stok tidak pernah diturunkan
          // dari status PR/header; yang tidak ada ditandai "Tidak tersedia".
          //
          // t_35cd0354 (integrasi): guard RENDER admin ditambahkan di sini.
          // Sebelumnya cabang ini tidak punya guard, jadi non-admin yang
          // memaksa page='stock' bisa membuka modul admin (menu memang
          // disembunyikan, tapi guard menu bukan satu-satunya lapisan —
          // pola sama dengan rab_boq/sales_invoice/rap/rap_compare/crm).
          role === 'admin' ? (
            <StockModule allMaterials={rows.materials || []} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
        ) : page === 'receivings' ? (
          // ============================================================
          // MODUL PURCHASE — HALAMAN SENDIRI (t_9109cf5e, arahan DAT)
          // ============================================================
          // Purchase BUKAN lagi tabel generik: ia punya dua tab (Siap Dibeli /
          // Riwayat Pembelian) dan dialog "Proses Pembelian". Dirender di sini
          // (source:'core' di registry) supaya tidak memaksa shell tabel
          // generik menampung state tab & checkbox — dan supaya tidak ada satu
          // pun tombol gudang/tukang/retur/refund yang tersisa dari alur lama.
          // Data & callback yang dipakai hanya baca (rows) + refresh/say.
          <PurchasePage rows={rows} refresh={loadAll} say={setNotice} />
        ) : (
          <Module
            page={modulePage}
            rows={currentRows}
            // t_31871b64: masuk lewat route lama `past_projects` = langsung
            // buka tab "Selesai". Lewat menu Projects = tab default 'active'.
            projectTab={page === 'past_projects' ? 'done' : 'active'}
            allProjects={rows.projects || []}
            allMaterials={rows.materials || []}
            allPrItems={rows.pr_items || []}
            allReceivingItems={rows.receiving_items || []}
            allRequests={rows.requests || []}
            allReceivings={rows.receivings || []}
            allVendors={rows.vendors || []}
            refresh={loadAll}
            say={setNotice}
            onStatusChange={updateProjectStatus}
            onReceivingStatusChange={updateReceivingStatus}
            onMoveToWarehouse={moveToWarehouse}
            onSendToTukang={sendToTukang}
            onMarkHandoverDelivered={markHandoverDelivered}
            onDecideApproval={decideApproval}
            onReviseApproval={reviseApproval}
            onApproveItem={approveItem}
            onFinishPr={finishPr}
            onCloseRemaining={closePrRemaining}
            onMarkPrItemOrdered={markPrItemOrdered}
            onDelete={deleteItem}
            setPage={setPage}
          />
        )}
      </section>
      {noteModal && (
        <div className="modal">
          <form className="dialog" onSubmit={submitNote}>
            <div className="dialoghead">
              <h2>{noteModal.decision === 'REJECTED' ? 'Tolak' : 'Minta Revisi'} — {noteModal.approval.pr_number || 'PR'}</h2>
              <button type="button" className="icon" onClick={() => setNoteModal(null)}>×</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              {noteModal.decision === 'REJECTED'
                ? 'Berikan alasan penolakan supaya pengaju tahu apa yang harus diperbaiki (boleh dikosongkan).'
                : 'Tuliskan hal yang perlu direvisi supaya pengaju tahu apa yang harus diubah (boleh dikosongkan).'}
            </p>
            <label>Catatan
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={4}
                placeholder={noteModal.decision === 'REJECTED' ? 'Contoh: harga dari vendor terlalu tinggi, cari vendor pembanding…' : 'Contoh: qty item 2 mohon dikurangi, sesuaikan dengan kebutuhan lapangan…'}
              />
            </label>
            <div className="actions">
              <button type="button" className="outline" onClick={() => setNoteModal(null)}>Batal</button>
              <button>{noteModal.decision === 'REJECTED' ? '✕ Tolak' : '✎ Kirim Revisi'}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
