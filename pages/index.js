import React, { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { exportWorkbook } from '../lib/workflow'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabase = url && key ? createClient(url, key) : null

const navSections = [
  {
    items: [
      ['dashboard', 'Dashboard'],
      ['projects', 'Projects'],
      ['vendors', 'Vendors'],
      ['materials', 'Materials']
    ]
  },
  {
    items: [
      ['requests', 'Purchase Request'],
      ['approvals', 'Approval'],
      ['receivings', 'Receiving'],
      ['handovers', 'Handover']
    ]
  },
  {
    items: [
      ['past_projects', 'Past Project']
    ]
  }
]

const modules = navSections.flatMap(s => s.items)

const labels = {
  projects: 'Project',
  vendors: 'Vendor',
  materials: 'Material',
  requests: 'Purchase Request',
  approvals: 'Approval',
  receivings: 'Receiving',
  handovers: 'Handover',
  past_projects: 'Past Project'
}

const statusOptions = [
  { value: 'NOT_START', label: 'Not Start' },
  { value: 'ON_GOING', label: 'On Going' },
  { value: 'DONE', label: 'Done' }
]

const receivingStatusOptions = [
  { value: 'SELESAI', label: '✓ Diterima', group: 'Normal' },
  { value: 'MASUK_GUDANG', label: '📦 Masuk Gudang', group: 'Normal' },
  { value: 'MENUNGGU_BARANG', label: '⏳ Menunggu Barang', group: 'Lama' },
  { value: 'OTW', label: 'OTW (Dalam Pengiriman)', group: 'Lama' },
  { value: 'PENDING', label: 'Pending (Belum Dikirim)', group: 'Lama' },
  { value: 'RUSAK', label: '⚠️ Rusak', group: 'Lama' },
  { value: 'RETUR', label: '⚠️ Retur ke Vendor', group: 'Lama' }
]

function isReceivingKendala(s) {
  if (!s) return false
  const up = String(s).toUpperCase()
  return up === 'RUSAK' || up === 'RETUR' || up.startsWith('KENDALA')
}

function prettyReceivingStatus(s) {
  const up = String(s || '').toUpperCase()
  if (up === 'RUSAK' || up === 'KENDALA_RUSAK') return '⚠️ Rusak'
  if (up === 'RETUR' || up === 'KENDALA_RETUR') return '⚠️ Retur ke Vendor'
  const match = receivingStatusOptions.find(o => o.value === s)
  if (match) return match.label
  return s
}

function normalizeStatus(s) {
  if (!s) return 'NOT_START'
  const up = String(s).toUpperCase().trim().replace(/[\s-]+/g, '_')
  if (up === 'DONE') return 'DONE'
  if (up === 'ON_GOING' || up === 'ONGOING' || up === 'ACTIVE') return 'ON_GOING'
  if (up === 'NOT_START' || up === 'NOT_STARTED' || up === 'PLANNING') return 'NOT_START'
  return up
}

function prettyStatus(s) {
  const norm = normalizeStatus(s)
  const found = statusOptions.find(o => o.value === norm)
  return found ? found.label : s
}

// Kolom urutan baca per tabel — harus ada di schema live.
// pr_items TIDAK punya kolom created_at (schema live), jadi dibaca tanpa ORDER BY;
// jangan mengarang kronologi dari UUID. Tabel lain tetap seperti semula.
function orderSpecFor(table) {
  if (table === 'materials') return { column: 'kode', ascending: true }
  if (table === 'approval_steps') return { column: 'step_number', ascending: true }
  if (table === 'pr_items') return null
  return { column: 'created_at', ascending: false }
}

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
    receiving_items: []
  })
  const [notice, setNotice] = useState('')
  const [noteModal, setNoteModal] = useState(null)
  const [noteText, setNoteText] = useState('')

  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) loadAll()
  }, [session])

  async function loadAll() {
    if (!supabase) return
    const specs = [
      ['projects', 'projects'],
      ['vendors', 'vendors'],
      ['materials', 'materials'],
      ['requests', 'purchase_requests'],
      ['approvals', 'approval_steps'],
      ['receivings', 'receivings'],
      ['handovers', 'handovers'],
      ['pr_items', 'pr_items'],
      ['receiving_items', 'receiving_items']
    ]
    const result = { ...rows }
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
        const { data } = spec ? await base.order(spec.column, { ascending: spec.ascending }) : await base
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

  async function updateReceivingStatus(receiving, newStatus) {
    if (!supabase) return
    const isKendala = isReceivingKendala(newStatus)
    const kendalaType = isKendala ? (newStatus.includes('RUSAK') ? 'RUSAK' : 'RETUR') : null
    const isGudang = newStatus === 'MASUK_GUDANG'

    setRows(prev => ({
      ...prev,
      receivings: (prev.receivings || []).map(r => r.id === receiving.id ? {
        ...r,
        status: newStatus,
        kendala: kendalaType,
        masuk_gudang: isGudang ? true : (newStatus === 'SELESAI' ? false : r.masuk_gudang),
        alokasi: isGudang ? 'MASUK_GUDANG' : (newStatus === 'SELESAI' ? 'LANGSUNG_LAPANGAN' : r.alokasi)
      } : r)
    }))

    const updatePayload = {
      status: newStatus,
      kendala: kendalaType
    }
    if (isGudang) {
      updatePayload.masuk_gudang = true
      updatePayload.alokasi = 'MASUK_GUDANG'
      updatePayload.gudang_at = new Date().toISOString()
    } else if (newStatus === 'SELESAI') {
      updatePayload.masuk_gudang = false
      updatePayload.alokasi = 'LANGSUNG_LAPANGAN'
    }

    const { error } = await supabase.from('receivings').update(updatePayload).eq('id', receiving.id)

    if (error) {
      setNotice(`Gagal update status receiving: ${error.message}`)
      loadAll()
    } else {
      const label = prettyReceivingStatus(newStatus)
      setNotice(`Status receiving "${receiving.invoice_no || receiving.delivery_note || 'Data'}" berhasil diubah ke "${label}".`)
      loadAll()
    }
  }

  async function moveToWarehouse(receiving) {
    if (!supabase) return
    const ok = window.confirm(`Apakah Anda yakin ingin memasukkan barang dari "${receiving.invoice_no || receiving.delivery_note || 'Penerimaan'}" ke Stok Gudang Workshop?`)
    if (!ok) return

    const now = new Date().toISOString()
    const { error } = await supabase.from('receivings').update({
      status: 'MASUK_GUDANG',
      alokasi: 'MASUK_GUDANG',
      masuk_gudang: true,
      gudang_at: now
    }).eq('id', receiving.id)

    if (error) {
      setNotice(`Gagal memasukkan ke gudang: ${error.message}`)
    } else {
      setNotice(`Barang "${receiving.invoice_no || receiving.delivery_note || 'Data'}" berhasil dimasukkan ke Stok Gudang Workshop.`)
      loadAll()
    }
  }

  // Tolak / Revisi membuka dialog catatan dulu; Setujui langsung konfirmasi.
  function decideApproval(approval, decision) {
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
    if (!supabase) return
    const now = new Date().toISOString()
    const label = decision === 'APPROVED' ? 'DISETUJUI' : (decision === 'REJECTED' ? 'DITOLAK' : 'DIMINTA REVISI')
    const baseNote = decision === 'APPROVED' ? 'Disetujui oleh Direksi / PM' : (decision === 'REJECTED' ? 'Ditolak oleh Direksi / PM' : 'Diminta revisi oleh Direksi / PM')
    const note = userNote ? `${baseNote} — ${userNote}` : baseNote

    const { error: appErr } = await supabase.from('approval_steps').update({
      status: decision,
      decided_at: now,
      note
    }).eq('id', approval.id)

    let prErr = null
    let itemErr = null
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
      }
    }

    if (appErr) {
      setNotice(`Gagal update approval: ${appErr.message}`)
      loadAll()
    } else if (prErr) {
      setNotice(`Approval terupdate, tapi gagal update status PR: ${prErr.message}`)
      loadAll()
    } else if (itemErr) {
      setNotice(`PR disetujui, tapi ada material yang gagal ikut disetujui: ${itemErr.message}`)
      loadAll()
    } else {
      setNotice(`Pengajuan ${approval.pr_number || 'PR'} berhasil ${label}.`)
      loadAll()
    }
  }

  // ============================================================
  // ALUR PENGADAAN: order -> receiving -> handover
  // ============================================================

  // Approval "Revise" -> status REVISI pada approval + PR
  function reviseApproval(approval) {
    if (!supabase) return
    setNoteText('')
    setNoteModal({ approval, decision: 'REVISI' })
  }

  // Setujui material satu per satu (dipakai di modul Approval, panel Material)
  async function approveItem(prItem) {
    if (!supabase) return
    const ok = window.confirm(`Setujui material "${prItem.item_name || prItem.kode}"?`)
    if (!ok) return
    const { error } = await supabase.from('pr_items').update({ status: 'APPROVED' }).eq('id', prItem.id)
    if (error) { setNotice(`Gagal menyetujui material: ${error.message}`); return }
    setNotice(`Material "${prItem.item_name || prItem.kode}" disetujui.`)
    loadAll()
  }

  // Tombol ✓ Selesai (modul PR): kirim PR ke modul Approval.
  // Approval disiapkan DULU; status PR baru diubah setelahnya supaya PR tidak
  // pernah nyangkut SUBMITTED tanpa baris approval (kasus yang pernah terjadi).
  async function finishPr(pr) {
    if (!supabase) return
    const ok = window.confirm(`Tandai PR "${pr.pr_number || pr.title || ''}" selesai dan kirim ke modul Approval?`)
    if (!ok) return

    // 1. Siapkan approval step PENDING. approver_id WAJIB diisi (NOT NULL di DB):
    //    pakai user yang sedang login; fallback ke profil pertama (mis. admin).
    const { data: steps } = await supabase.from('approval_steps')
      .select('id').eq('purchase_request_id', pr.id).order('step_number', { ascending: true })

    if (steps && steps.length) {
      // PR yang pernah direvisi: aktifkan kembali step lama.
      const { error: stErr } = await supabase.from('approval_steps').update({
        status: 'PENDING',
        decided_at: null,
        note: `Menunggu persetujuan Direksi / PM untuk ${pr.pr_number || 'PR'}`
      }).eq('id', steps[0].id)
      if (stErr) { setNotice(`Gagal mengaktifkan approval: ${stErr.message}`); return }
    } else {
      let approverId = session?.user?.id || null
      if (!approverId) {
        // Deterministik: profil paling awal (biasanya admin pertama).
        const { data: profs, error: profErr } = await supabase.from('profiles')
          .select('id').order('created_at', { ascending: true }).limit(1)
        if (profErr) { setNotice(`Gagal membaca profil approver: ${profErr.message}`); return }
        approverId = (profs && profs[0] && profs[0].id) || null
      }
      if (!approverId) { setNotice('Tidak ada profil approver — hubungi administrator.'); return }
      const { error: stErr } = await supabase.from('approval_steps').insert({
        purchase_request_id: pr.id,
        approver_id: approverId,
        step_number: 1,
        status: 'PENDING',
        note: `Menunggu persetujuan Direksi / PM untuk ${pr.pr_number || 'PR'}`
      })
      if (stErr) { setNotice(`Gagal membuat approval: ${stErr.message}`); return }
    }

    // 2. Baru ubah status PR -> SUBMITTED.
    const { error: prErr } = await supabase.from('purchase_requests').update({ status: 'SUBMITTED' }).eq('id', pr.id)
    if (prErr) { setNotice(`Approval siap, tapi gagal update status PR: ${prErr.message}`); loadAll(); return }

    setNotice(`PR ${pr.pr_number || ''} selesai dan sudah masuk modul Approval (menunggu persetujuan).`)
    loadAll()
  }

  // Item PR di-approve -> tandai "sudah diorder" + pindahkan ke Receiving
  async function markPrItemOrdered(prItem) {
    if (!supabase) return
    const ok = window.confirm(`Tandai item "${prItem.item_name || prItem.kode}" sebagai SUDAH DIORDER? Item akan masuk ke modul Receiving.`)
    if (!ok) return
    const now = new Date().toISOString()

    const prId = prItem.pr_id
    const pr = (rows.requests || []).find(p => p.id === prId)
    if (!pr) { setNotice('PR item tidak terhubung ke PR manapun.'); return }

    // 1. Update status item jadi ORDERED
    const { error: itemErr } = await supabase.from('pr_items')
      .update({ status: 'ORDERED' })
      .eq('id', prItem.id)
    if (itemErr) { setNotice(`Gagal update item: ${itemErr.message}`); return }

    // 2. Cari/buat receivings utk PR ini (satu header per PR)
    let recId = null
    const { data: existingRecs } = await supabase.from('receivings')
      .select('*').eq('purchase_request_id', prId).order('created_at', { ascending: true })
    if (existingRecs && existingRecs.length) {
      recId = existingRecs[0].id
    } else {
      const { data: newRec, error: recErr } = await supabase.from('receivings').insert({
        purchase_request_id: prId,
        project_id: pr.project_id || null,
        status: 'MENUNGGU_BARANG',
        delivery_note: `PO ${pr.pr_number || ''} - ${pr.title || ''}`.trim(),
        note: `Dibuat otomatis dari PR ${pr.pr_number || ''} (item diorder di supplier).`
      }).select().single()
      if (recErr) { setNotice(`Gagal membuat receiving: ${recErr.message}`); return }
      recId = newRec.id
    }

    // 3. Tambahkan item ini ke receiving_items
    const { error: riErr } = await supabase.from('receiving_items').insert({
      receiving_id: recId,
      pr_item_id: prItem.id,
      item_name: prItem.item_name || 'Item',
      quantity_received: 0,
      unit: prItem.unit || 'Pcs'
    })
    if (riErr) { setNotice(`Gagal menambah item receiving: ${riErr.message}`); return }

    // 4. Titip status ordered di kolom status item juga pada purchase_requests summary (best-effort, no schema change)
    setNotice(`Item "${prItem.item_name || prItem.kode}" sudah diorder dan masuk ke modul Receiving.`)
    loadAll()
  }

  // Item di receiving -> tandai "sudah diterima", lalu pindah ke Handover
  async function markReceivingItemReceived(recItem) {
    if (!supabase) return
    const ok = window.confirm(`Tandai barang "${recItem.item_name}" sudah DITERIMA? Item akan masuk daftar Handover.`)
    if (!ok) return
    const now = new Date().toISOString()
    const qtyInput = Number(recItem.quantity_received || 0)
    // Qty yang dipakai: isian user bila diisi, kalau kosong pakai qty yang dipesan di PR
    const prItemForQty = (rows.pr_items || []).find(p => p.id === recItem.pr_item_id)
    const qtyFinal = qtyInput > 0 ? qtyInput : Number(prItemForQty?.quantity || 0)

    const receiving = (rows.receivings || []).find(r => r.id === recItem.receiving_id)
    const prItem = (rows.pr_items || []).find(p => p.id === recItem.pr_item_id)
    const pr = prItem ? (rows.requests || []).find(p => p.id === prItem.pr_id) : null
    const projectId = receiving?.project_id || pr?.project_id || null

    // 1. Tandai item sudah diterima (qty terima + penanda di kolom note)
    const { error: riErr } = await supabase.from('receiving_items')
      .update({ quantity_received: qtyFinal, note: `DITERIMA ${now.slice(0, 10)}` })
      .eq('id', recItem.id)
    if (riErr) { setNotice(`Gagal update item: ${riErr.message}`); return }

    // 2. Buat handover utk item ini
    // Catatan memuat nama item di depan agar selalu terbaca di tabel & ekspor,
    // karena tabel handovers tidak punya kolom khusus nama barang.
    const { error: hoErr } = await supabase.from('handovers').insert({
      receiving_id: recItem.receiving_id,
      project_id: projectId,
      received_by: 'Belum ditentukan',
      handover_date: now.slice(0, 10),
      status: 'DRAFT',
      note: `Item: ${recItem.item_name} — diterima ${qtyFinal || '?'} ${recItem.unit || ''} (dari PR ${pr?.pr_number || '-'}).`
    })
    if (hoErr) { setNotice(`Gagal membuat handover: ${hoErr.message}`); return }

    setNotice(`Barang "${recItem.item_name}" sudah diterima dan masuk ke daftar Handover.`)
    loadAll()
  }

  // Update qty terima (dipakai di modul Receiving saat user isi qty)
  async function updateReceivingQty(recItem, newQty) {
    if (!supabase) return
    const qty = Number(newQty)
    if (!isFinite(qty) || qty < 0) return
    setRows(prev => ({
      ...prev,
      receiving_items: (prev.receiving_items || []).map(x => x.id === recItem.id ? { ...x, quantity_received: qty } : x)
    }))
    const { error } = await supabase.from('receiving_items').update({ quantity_received: qty }).eq('id', recItem.id)
    if (error) { setNotice(`Gagal update qty: ${error.message}`); loadAll() }
  }

  async function deleteItem(pageTarget, item) {
    if (!supabase) return
    const typeLabel = pageTarget === 'vendors' ? 'Vendor' : (pageTarget === 'materials' ? 'Material' : (pageTarget === 'requests' ? 'Purchase Request' : (pageTarget === 'receivings' ? 'Receiving' : (pageTarget === 'handovers' ? 'Serah Terima' : (pageTarget === 'projects' || pageTarget === 'past_projects' ? 'Project' : 'Data')))))
    const itemName = item.invoice_no || item.pr_number || item.delivery_note || item.received_by || item.name || item.kode || item.code || 'Item'
    const ok = window.confirm(`Apakah Anda yakin ingin menghapus ${typeLabel.toLowerCase()} "${itemName}"?`)
    if (!ok) return

    const table = {
      vendors: 'vendors',
      materials: 'materials',
      requests: 'purchase_requests',
      receivings: 'receivings',
      handovers: 'handovers',
      approvals: 'approval_steps',
      projects: 'projects',
      past_projects: 'projects'
    }[pageTarget] || pageTarget
    
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
    const { error } = await supabase.from(table).delete().eq('id', item.id)
    if (error) {
      setNotice(`Gagal menghapus ${typeLabel.toLowerCase()}: ${error.message}`)
      loadAll()
    } else {
      setNotice(`${typeLabel} "${itemName}" berhasil dihapus.`)
      loadAll()
    }
  }

  if (loading) return <div className="center">Memuat aplikasi…</div>
  if (!session) return <Login email={email} password={password} setEmail={setEmail} setPassword={setPassword} login={login} error={error} configured={!!supabase} />

  const activeProjects = (rows.projects || []).filter(p => normalizeStatus(p.status) !== 'DONE')
  const pastProjects = (rows.projects || []).filter(p => normalizeStatus(p.status) === 'DONE')
  const currentRows = page === 'projects' ? activeProjects : (page === 'past_projects' ? pastProjects : (rows[page] || []))

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>NL</span>
          <div>
            <b>NOIR LIVING</b>
            <small>Purchasing</small>
          </div>
        </div>
        <nav>
          {navSections.map((sec, sIdx) => (
            <div key={sIdx} className="nav-group">
              {sIdx > 0 && <div className="nav-divider" />}
              {sec.items.map(([id, name]) => (
                <button className={page === id ? 'active' : ''} onClick={() => setPage(id)} key={id}>
                  {name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <small>{session.user.email}</small>
          <button onClick={logout}>Keluar</button>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">OPERASIONAL INTERNAL</p>
            <h1>{page === 'dashboard' ? 'Dashboard' : labels[page]}</h1>
          </div>
          <button className="outline" onClick={loadAll}>↻ Perbarui</button>
        </header>
        {notice && <div className="notice">{notice}</div>}
        {page === 'dashboard' ? (
          <Dashboard
            rows={rows}
            activeProjects={activeProjects}
            pastProjects={pastProjects}
            setPage={setPage}
          />
        ) : (
          <Module
            page={page}
            rows={currentRows}
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
            onDecideApproval={decideApproval}
            onReviseApproval={reviseApproval}
            onApproveItem={approveItem}
            onFinishPr={finishPr}
            onMarkPrItemOrdered={markPrItemOrdered}
            onMarkReceivingItemReceived={markReceivingItemReceived}
            onUpdateReceivingQty={updateReceivingQty}
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

function Login(p) {
  return (
    <main className="login">
      <section>
        <div className="logo">NL</div>
        <p className="eyebrow">NOIR LIVING</p>
        <h1>Purchasing</h1>
        <p className="muted">Masuk untuk mengelola purchase request, approval, receiving, dan handover.</p>
        <form onSubmit={p.login}>
          <label>Email
            <input type="email" value={p.email} onChange={e => p.setEmail(e.target.value)} required placeholder="nama@perusahaan.com" />
          </label>
          <label>Password
            <input type="password" value={p.password} onChange={e => p.setPassword(e.target.value)} required placeholder="••••••••" />
          </label>
          {p.error && <p className="error">{p.error}</p>}
          <button disabled={!p.configured}>{p.configured ? 'Masuk' : 'Supabase belum terhubung'}</button>
        </form>
        <small>Akun dibuat oleh administrator.</small>
      </section>
    </main>
  )
}

function Dashboard({ rows, activeProjects, pastProjects, setPage }) {
  const cards = [
    ['projects', 'Project aktif', activeProjects.length],
    ['past_projects', 'Past Project', pastProjects.length],
    ['requests', 'Purchase Request', rows.requests?.length || 0],
    ['approvals', 'Menunggu approval', rows.approvals?.filter(a => a.status === 'PENDING').length || 0],
    ['receivings', 'Receiving', rows.receivings?.length || 0]
  ]
  return (
    <>
      <div className="cards">
        {cards.map(([k, t, count]) => (
          <button className="card" onClick={() => setPage(k)} key={k}>
            <span>{t}</span>
            <strong>{count}</strong>
            <small>Lihat detail →</small>
          </button>
        ))}
      </div>
      <div className="panel">
        <h2>Aktivitas terbaru</h2>
        <p className="muted">Data terbaru akan tampil di masing-masing menu. Gunakan Purchase Request untuk memulai pengadaan.</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
          <button
            type="button"
            className="outline"
            style={{ fontSize: '12px', padding: '8px 12px' }}
            onClick={() => exportWorkbook([
              ['Projects', rows.projects || [], headersFor('projects', rows.projects || [])],
              ['Vendors', rows.vendors || [], headersFor('vendors', rows.vendors || [])],
              ['Materials', rows.materials || [], headersFor('materials', rows.materials || [])],
              ['Purchase Request', rows.requests || [], ['priority', 'pr_number', 'project_name', 'title', 'materials_summary', 'status', 'notes', 'created_at']],
              ['PR Items', rows.pr_items || [], ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'estimated_price', 'status', 'supplier_category', 'vendor_id']],
              ['Approval', rows.approvals || [], ['pr_number', 'project_name', 'title', 'step_number', 'status', 'note', 'decided_at']],
              ['Receiving', rows.receivings || [], ['invoice_no', 'project_name', 'delivery_note', 'status', 'received_date', 'note']],
              ['Receiving Items', rows.receiving_items || [], ['receiving_id', 'pr_item_id', 'item_name', 'quantity_received', 'unit', 'note', 'created_at']],
              ['Handover', rows.handovers || [], headersFor('handovers', rows.handovers || [])]
            ], 'Purchasing-Seluruh-Data')}
          >
            📦 Export Semua Data (Excel)
          </button>
        </div>
      </div>
    </>
  )
}

function Module({ page, rows, allProjects, allMaterials = [], allPrItems = [], allReceivingItems = [], allRequests = [], allReceivings = [], allVendors = [], refresh, say, onStatusChange, onReceivingStatusChange, onMoveToWarehouse, onDecideApproval, onReviseApproval, onApproveItem, onFinishPr, onMarkPrItemOrdered, onMarkReceivingItemReceived, onUpdateReceivingQty, onDelete, setPage }) {
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('active')
  const [receivingFilter, setReceivingFilter] = useState('all')
  const [prFilter, setPrFilter] = useState('all')
  const [approvalFilter, setApprovalFilter] = useState('all')
  const [materialFilter, setMaterialFilter] = useState('all')
  const [vendorFilter, setVendorFilter] = useState('all')
  const [handoverFilter, setHandoverFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedApproval, setExpandedApproval] = useState(null)
  const [expandedReceiving, setExpandedReceiving] = useState(null)
  const [openNoteId, setOpenNoteId] = useState(null)
  const [editRow, setEditRow] = useState(null)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')
  const title = labels[page]

  // Reset urutan saat pindah modul (set kolom tiap modul berbeda)
  useEffect(() => {
    setSortKey(null)
    setSortDir('asc')
  }, [page])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  // --- Helper alur item (dipakai modul Approval & Receiving) ---
  // CATATAN: item dibaca dari prop terpisah (allPrItems/allReceivingItems) karena
  // `rows` pada komponen ini adalah array baris modul aktif, bukan objek semua tabel.
  const prItemsForPr = (prId) => (allPrItems || []).filter(it => it.pr_id === prId)
  const vendorName = (vendorId) => ((allVendors || []).find(v => v.id === vendorId) || {}).name || ''
  const approvalItems = (approval) => prItemsForPr(approval.purchase_request_id)
  const receivingItemsForReceiving = (recId) => (allReceivingItems || []).filter(it => it.receiving_id === recId)

  // Status persetujuan per material: ORDERED (sudah dipesan) > APPROVED (disetujui) > PENDING (menunggu)
  const itemState = (it) => {
    const s = String(it?.status || '').toUpperCase()
    if (s === 'ORDERED') return 'ORDERED'
    if (s === 'APPROVED') return 'APPROVED'
    return 'PENDING'
  }

  // Baris item utk modul Approval: pakai pr_items; jika kosong (data lama),
  // fallback ke ringkasan material PR supaya barang yang perlu di-approve tetap terlihat.
  const approvalItemLines = (approval) => {
    const items = approvalItems(approval)
    if (items.length) {
      return items
        .map(it => `${it.quantity ?? ''} ${it.unit || ''} ${it.item_name || it.kode || ''}`.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    }
    const pr = (allRequests || []).find(p => p.id === approval.purchase_request_id)
    const s = String(pr?.materials_summary || '').trim()
    if (!s) return []
    return s.split(',').map(x => x.trim()).filter(Boolean)
  }

  // Daftar baris item material sebuah PR (dipakai modul Purchase Request):
  // utamakan pr_items yang lengkap; fallback ke ringkasan teks bila item tidak ada.
  const requestItemLines = (pr) => {
    const items = prItemsForPr(pr.id)
    if (items.length) {
      return items
        .map(it => {
          const base = `${it.quantity ?? ''} ${it.unit || ''} ${it.item_name || it.kode || ''}`.replace(/\s+/g, ' ').trim()
          const bits = []
          if (it.supplier_category) bits.push(`Supplier: ${it.supplier_category}`)
          const v = vendorName(it.vendor_id)
          if (v) bits.push(`Vendor: ${v}`)
          return bits.length ? `${base} — ${bits.join(' · ')}` : base
        })
        .filter(Boolean)
    }
    const s = String(pr.materials_summary || '').trim()
    if (!s) return ['—']
    return s.split(',').map(x => x.trim()).filter(Boolean)
  }

  let displayRows = rows
  if (page === 'projects') {
    if (projectFilter === 'all') displayRows = allProjects
    else if (projectFilter === 'NOT_START') displayRows = allProjects.filter(p => normalizeStatus(p.status) === 'NOT_START')
    else if (projectFilter === 'ON_GOING') displayRows = allProjects.filter(p => normalizeStatus(p.status) === 'ON_GOING')
    else displayRows = allProjects.filter(p => normalizeStatus(p.status) !== 'DONE')
  } else if (page === 'requests') {
    if (prFilter === 'DRAFT') displayRows = rows.filter(r => r.status === 'DRAFT')
    else if (prFilter === 'SUBMITTED') displayRows = rows.filter(r => r.status === 'SUBMITTED')
    else if (prFilter === 'APPROVED') displayRows = rows.filter(r => r.status === 'APPROVED')
    else if (prFilter === 'REVISI') displayRows = rows.filter(r => r.status === 'REVISI')
    else if (prFilter === 'REJECTED') displayRows = rows.filter(r => r.status === 'REJECTED')
    else if (prFilter === 'URGENT') displayRows = rows.filter(r => r.priority === 'URGENT')
  } else if (page === 'approvals') {
    if (approvalFilter === 'PENDING') displayRows = rows.filter(r => r.status === 'PENDING')
    else if (approvalFilter === 'APPROVED') displayRows = rows.filter(r => r.status === 'APPROVED')
    else if (approvalFilter === 'REVISI') displayRows = rows.filter(r => r.status === 'REVISI')
    else if (approvalFilter === 'REJECTED') displayRows = rows.filter(r => r.status === 'REJECTED')
  } else if (page === 'receivings') {
    if (receivingFilter === 'SELESAI') displayRows = rows.filter(r => r.status === 'SELESAI' && !r.masuk_gudang)
    else if (receivingFilter === 'MASUK_GUDANG') displayRows = rows.filter(r => r.status === 'MASUK_GUDANG' || r.masuk_gudang)
    else if (receivingFilter === 'OTW') displayRows = rows.filter(r => r.status === 'OTW')
    else if (receivingFilter === 'RUSAK') displayRows = rows.filter(r => String(r.status).toUpperCase().includes('RUSAK'))
    else if (receivingFilter === 'RETUR') displayRows = rows.filter(r => String(r.status).toUpperCase().includes('RETUR'))
    else if (receivingFilter === 'kendala') displayRows = rows.filter(r => isReceivingKendala(r.status))
  } else if (page === 'materials') {
    if (materialFilter === 'Lainnya') displayRows = rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category))
    else if (materialFilter !== 'all') displayRows = rows.filter(r => r.category === materialFilter)
  } else if (page === 'vendors') {
    if (vendorFilter === 'HAS_PHONE') displayRows = rows.filter(r => !!r.phone)
    else if (vendorFilter === 'HAS_CONTACT') displayRows = rows.filter(r => !!r.contact)
  } else if (page === 'handovers') {
    if (handoverFilter === 'CONFIRMED') displayRows = rows.filter(r => r.status === 'CONFIRMED' || r.status === 'SELESAI')
    else if (handoverFilter === 'DRAFT') displayRows = rows.filter(r => r.status !== 'CONFIRMED' && r.status !== 'SELESAI')
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim()
    displayRows = displayRows.filter(row => {
      return Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    })
  }

  // Urutkan berdasar kolom yang diklik (klik ulang untuk balik arah)
  if (sortKey) {
    const dir = sortDir === 'desc' ? -1 : 1
    const valOf = (row) => (sortKey === 'kode' ? (row.kode || row.code) : row[sortKey])
    displayRows = [...displayRows].sort((a, b) => {
      const va = valOf(a)
      const vb = valOf(b)
      if (va === null || va === undefined) return (vb === null || vb === undefined) ? 0 : 1
      if (vb === null || vb === undefined) return -1
      const sa = String(va).trim()
      const sb = String(vb).trim()
      const na = Number(sa)
      const nb = Number(sb)
      if (sa !== '' && sb !== '' && isFinite(na) && isFinite(nb)) return (na - nb) * dir
      return sa.localeCompare(sb, 'id', { numeric: true, sensitivity: 'base' }) * dir
    })
  }

  const columns = headersFor(page, displayRows)
  const hasDeleteAction = ['vendors', 'materials', 'requests', 'receivings', 'handovers', 'projects', 'past_projects'].includes(page)

  return (
    <>
      <div className="toolbar">
        <div>
          <p className="muted">
            {displayRows.length} data tersedia {page === 'past_projects' && '(Project dengan status DONE)'}
          </p>
          {page === 'projects' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${projectFilter === 'active' ? 'active' : ''}`}
                onClick={() => setProjectFilter('active')}
              >
                Aktif ({allProjects.filter(p => normalizeStatus(p.status) !== 'DONE').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'ON_GOING' ? 'active' : ''}`}
                onClick={() => setProjectFilter('ON_GOING')}
              >
                On Going ({allProjects.filter(p => normalizeStatus(p.status) === 'ON_GOING').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'NOT_START' ? 'active' : ''}`}
                onClick={() => setProjectFilter('NOT_START')}
              >
                Not Start ({allProjects.filter(p => normalizeStatus(p.status) === 'NOT_START').length})
              </button>
              <button
                type="button"
                className={`pill ${projectFilter === 'all' ? 'active' : ''}`}
                onClick={() => setProjectFilter('all')}
              >
                Semua ({allProjects.length})
              </button>
            </div>
          )}
          {page === 'requests' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${prFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPrFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'DRAFT' ? 'active' : ''}`}
                onClick={() => setPrFilter('DRAFT')}
              >
                Draft ({rows.filter(r => r.status === 'DRAFT').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'SUBMITTED' ? 'active' : ''}`}
                onClick={() => setPrFilter('SUBMITTED')}
              >
                Submitted ({rows.filter(r => r.status === 'SUBMITTED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'APPROVED' ? 'active' : ''}`}
                onClick={() => setPrFilter('APPROVED')}
              >
                Approved ({rows.filter(r => r.status === 'APPROVED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'REVISI' ? 'active' : ''}`}
                onClick={() => setPrFilter('REVISI')}
              >
                Revisi ({rows.filter(r => r.status === 'REVISI').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'REJECTED' ? 'active' : ''}`}
                onClick={() => setPrFilter('REJECTED')}
              >
                Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
              </button>
              <button
                type="button"
                className={`pill ${prFilter === 'URGENT' ? 'active' : ''}`}
                onClick={() => setPrFilter('URGENT')}
                style={rows.some(r => r.priority === 'URGENT') ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
              >
                🚨 Prioritas ({rows.filter(r => r.priority === 'URGENT').length})
              </button>
            </div>
          )}
          {page === 'approvals' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${approvalFilter === 'all' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'PENDING' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('PENDING')}
                style={rows.some(r => r.status === 'PENDING') ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
              >
                ⏳ Menunggu ({rows.filter(r => r.status === 'PENDING').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'APPROVED' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('APPROVED')}
              >
                ✓ Disetujui ({rows.filter(r => r.status === 'APPROVED').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'REVISI' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('REVISI')}
              >
                ✎ Revisi ({rows.filter(r => r.status === 'REVISI').length})
              </button>
              <button
                type="button"
                className={`pill ${approvalFilter === 'REJECTED' ? 'active' : ''}`}
                onClick={() => setApprovalFilter('REJECTED')}
              >
                ✕ Ditolak ({rows.filter(r => r.status === 'REJECTED').length})
              </button>
            </div>
          )}
          {page === 'receivings' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${receivingFilter === 'all' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'SELESAI' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('SELESAI')}
              >
                ✓ Diterima ({rows.filter(r => r.status === 'SELESAI' && !r.masuk_gudang).length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'MASUK_GUDANG' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('MASUK_GUDANG')}
                style={rows.some(r => r.status === 'MASUK_GUDANG' || r.masuk_gudang) ? { borderColor: '#137333', color: '#137333', fontWeight: 'bold' } : {}}
              >
                📦 Di Gudang ({rows.filter(r => r.status === 'MASUK_GUDANG' || r.masuk_gudang).length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'OTW' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('OTW')}
              >
                OTW ({rows.filter(r => r.status === 'OTW').length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'RUSAK' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('RUSAK')}
                style={rows.some(r => String(r.status).toUpperCase().includes('RUSAK')) ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
              >
                ⚠️ Rusak ({rows.filter(r => String(r.status).toUpperCase().includes('RUSAK')).length})
              </button>
              <button
                type="button"
                className={`pill ${receivingFilter === 'RETUR' ? 'active' : ''}`}
                onClick={() => setReceivingFilter('RETUR')}
                style={rows.some(r => String(r.status).toUpperCase().includes('RETUR')) ? { borderColor: '#d97706', color: '#d97706', fontWeight: 'bold' } : {}}
              >
                ⚠️ Retur ({rows.filter(r => String(r.status).toUpperCase().includes('RETUR')).length})
              </button>
            </div>
          )}
          {page === 'materials' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${materialFilter === 'all' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Plywood & Board' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Plywood & Board')}
              >
                Plywood & Board ({rows.filter(r => r.category === 'Plywood & Board').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'HPL & Edging' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('HPL & Edging')}
              >
                HPL & Edging ({rows.filter(r => r.category === 'HPL & Edging').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Hardware & Fitting' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Hardware & Fitting')}
              >
                Hardware & Fitting ({rows.filter(r => r.category === 'Hardware & Fitting').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Bahan Habis Pakai' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Bahan Habis Pakai')}
              >
                Bahan Habis Pakai ({rows.filter(r => r.category === 'Bahan Habis Pakai').length})
              </button>
              <button
                type="button"
                className={`pill ${materialFilter === 'Lainnya' ? 'active' : ''}`}
                onClick={() => setMaterialFilter('Lainnya')}
              >
                Lainnya ({rows.filter(r => !['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai'].includes(r.category)).length})
              </button>
            </div>
          )}
          {page === 'vendors' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${vendorFilter === 'all' ? 'active' : ''}`}
                onClick={() => setVendorFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${vendorFilter === 'HAS_PHONE' ? 'active' : ''}`}
                onClick={() => setVendorFilter('HAS_PHONE')}
              >
                Ada Telepon ({rows.filter(r => !!r.phone).length})
              </button>
              <button
                type="button"
                className={`pill ${vendorFilter === 'HAS_CONTACT' ? 'active' : ''}`}
                onClick={() => setVendorFilter('HAS_CONTACT')}
              >
                Ada Kontak/Email ({rows.filter(r => !!r.contact).length})
              </button>
            </div>
          )}
          {page === 'handovers' && (
            <div className="filter-tabs">
              <button
                type="button"
                className={`pill ${handoverFilter === 'all' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('all')}
              >
                Semua ({rows.length})
              </button>
              <button
                type="button"
                className={`pill ${handoverFilter === 'CONFIRMED' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('CONFIRMED')}
              >
                ✓ Confirmed ({rows.filter(r => r.status === 'CONFIRMED' || r.status === 'SELESAI').length})
              </button>
              <button
                type="button"
                className={`pill ${handoverFilter === 'DRAFT' ? 'active' : ''}`}
                onClick={() => setHandoverFilter('DRAFT')}
              >
                Draft ({rows.filter(r => r.status !== 'CONFIRMED' && r.status !== 'SELESAI').length})
              </button>
            </div>
          )}
        </div>
        <div className="toolbar-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="search"
            placeholder="🔍 Cari..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              borderRadius: '8px',
              border: '1px solid #d5dedb',
              width: '160px',
              background: '#ffffff'
            }}
          />
          {page === 'past_projects' && (
            <button type="button" className="outline" onClick={() => setPage('projects')}>
              ← Ke Project Aktif
            </button>
          )}
          {['projects', 'vendors', 'materials', 'requests', 'receivings', 'handovers'].includes(page) && (
            <button onClick={() => setOpen(true)}>+ Tambah {title}</button>
          )}
        </div>
      </div>
      {(open || editRow) && (
        <Create
          page={page}
          editRow={editRow}
          editItems={editRow ? prItemsForPr(editRow.id) : []}
          allReceivings={allReceivings}
          allProjects={allProjects}
          allMaterials={allMaterials}
          allVendors={allVendors}
          existingRequests={displayRows}
          allRequestsFull={allRequests}
          close={() => { setOpen(false); setEditRow(null) }}
          refresh={refresh}
          say={say}
        />
      )}
      <div className="panel table">
        <table className={page === 'materials' ? 'materials-table' : (page === 'requests' ? 'requests-table' : (page === 'approvals' ? 'approvals-table' : undefined))}>
          <thead>
            <tr>
              {columns.map(h => (
                <th
                  key={h}
                  onClick={() => h !== 'items' && toggleSort(h)}
                  style={{ cursor: h === 'items' ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  title={h === 'items' ? undefined : 'Klik untuk urutkan'}
                >
                  {page === 'requests' && h === 'priority' ? (
                    <span className="prio-dot prio-header" title="Prioritas — klik untuk urutkan" />
                  ) : pretty(h)}
                  {sortKey === h ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {(hasDeleteAction || page === 'approvals') && (
                <th style={{ width: page === 'approvals' ? '140px' : (page === 'requests' ? '150px' : '90px'), textAlign: 'center' }}>Aksi</th>
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.length ? (
              displayRows.map((r, i) => (
                <React.Fragment key={r.id || i}>
                <tr>
                  {columns.map(h => {
                    const rawVal = h === 'kode' ? (r.kode || r.code) : (h === 'qty' ? (r.qty ?? 0) : r[h])
                    return (
                      <td key={h}>
                        {['projects', 'past_projects'].includes(page) && h === 'status' ? (
                          <select
                            className={`status-select status-${normalizeStatus(r.status)}`}
                            value={normalizeStatus(r.status)}
                            onChange={e => onStatusChange(r, e.target.value)}
                          >
                            <option value="NOT_START">Not Start</option>
                            <option value="ON_GOING">On Going</option>
                            <option value="DONE">Done</option>
                          </select>
                        ) : page === 'receivings' && h === 'status' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <select
                              className={`status-select ${isReceivingKendala(r.status) ? 'status-kendala' : (r.status === 'MASUK_GUDANG' || r.masuk_gudang ? 'status-gudang' : 'status-normal')}`}
                              value={r.status === 'MASUK_GUDANG' || r.masuk_gudang ? 'MASUK_GUDANG' : (r.status === 'SELESAI' ? 'SELESAI' : (r.status || 'SELESAI'))}
                              onChange={e => onReceivingStatusChange(r, e.target.value)}
                            >
                              {r.status && !['SELESAI', 'MASUK_GUDANG'].includes(r.status) && (
                                <option value={r.status} disabled>{prettyReceivingStatus(r.status)} (status lama)</option>
                              )}
                              <option value="SELESAI">✓ Diterima</option>
                              <option value="MASUK_GUDANG">📦 Masuk Gudang</option>
                            </select>
                            {r.status === 'MASUK_GUDANG' || r.masuk_gudang ? (
                              <span style={{ fontSize: '11px', color: '#137333', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                ✓ Tersimpan di Gudang
                              </span>
                            ) : r.status === 'SELESAI' ? (
                              <button
                                type="button"
                                onClick={() => onMoveToWarehouse(r)}
                                style={{
                                  background: '#e6f4ea',
                                  color: '#137333',
                                  border: '1px solid #ceead6',
                                  borderRadius: '4px',
                                  padding: '3px 6px',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  width: 'fit-content'
                                }}
                                title="Simpan barang ke stok gudang workshop"
                              >
                                📦 + Masukkan ke Gudang
                              </button>
                            ) : null}
                          </div>
                        ) : page === 'vendors' && h === 'phone' ? (
                          <WaContact value={rawVal} />
                        ) : page === 'vendors' && h === 'store_link' ? (
                          <StoreLink value={rawVal} />
                        ) : page === 'approvals' && h === 'items' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {approvalItemLines(r).length ? approvalItemLines(r).map((line, idx) => (
                              <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>
                                • {line}
                              </span>
                            )) : <span className="muted" style={{ fontSize: '12px' }}>—</span>}
                          </div>
                        ) : page === 'requests' && h === 'pr_number' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <b>{format(rawVal)}</b>
                              <button
                                type="button"
                                className={`note-dot ${String(r.notes || '').trim() ? 'note-dot-on' : ''}`}
                                title={String(r.notes || '').trim() || 'Tidak ada catatan'}
                                aria-label="Catatan PR"
                                onClick={() => setOpenNoteId(openNoteId === r.id ? null : r.id)}
                              />
                            </div>
                            <small style={{ color: '#9aa8a4', fontSize: '10px', fontWeight: 500 }}>{format(r.created_at)}</small>
                            {openNoteId === r.id && (
                              <div className="note-pop">{String(r.notes || '').trim() || 'Tidak ada catatan.'}</div>
                            )}
                          </div>
                        ) : page === 'requests' && h === 'priority' ? (
                          <span
                            className={`prio-dot ${String(r.priority || '').toUpperCase() === 'URGENT' ? 'prio-urgent' : 'prio-normal'}`}
                            title={String(r.priority || '').toUpperCase() === 'URGENT' ? 'Prioritas' : 'Standard'}
                          />
                        ) : ['requests', 'approvals'].includes(page) && h === 'project_name' ? (
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(rawVal || '')}>
                            {format(rawVal)}
                          </div>
                        ) : ['requests', 'approvals'].includes(page) && (h === 'notes' || h === 'note') ? (
                          <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.4, fontSize: '12px' }}>
                            {format(rawVal)}
                          </div>
                        ) : h === 'title' ? (
                          <div
                            style={{ maxWidth: ['requests', 'approvals'].includes(page) ? '100%' : '170px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                            title={String(rawVal || '')}
                          >
                            {format(rawVal)}
                          </div>
                        ) : page === 'materials' && h === 'name' ? (
                          <div className="cell-name" title={String(rawVal || '')}>{format(rawVal)}</div>
                        ) : h === 'materials_summary' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {requestItemLines(r).map((line, idx) => (
                              <span key={idx} style={{ fontSize: '12px', lineHeight: 1.45, whiteSpace: 'normal', paddingLeft: '12px', textIndent: '-12px' }}>
                                • {line}
                              </span>
                            ))}
                          </div>
                        ) : (
                          format(rawVal)
                        )}
                      </td>
                    )
                  })}
                  {page === 'approvals' && (
                    <td style={{ textAlign: 'center' }}>
                      {r.status === 'PENDING' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => onDecideApproval(r, 'APPROVED')}
                            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✓ Setujui
                          </button>
                          <button
                            type="button"
                            onClick={() => onDecideApproval(r, 'REJECTED')}
                            style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✕ Tolak
                          </button>
                          <button
                            type="button"
                            onClick={() => onReviseApproval(r)}
                            style={{ background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
                          >
                            ✎ Revisi
                          </button>
                        </div>
                        {approvalItemLines(r).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
                            style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                          >
                            {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
                          </button>
                        )}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                          <span className={`badge status-${r.status}`}>{r.status}</span>
                          {approvalItemLines(r).length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
                              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                            >
                              {expandedApproval === r.id ? '▲ Tutup material' : `▼ Material (${approvalItemLines(r).length})`}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                  {hasDeleteAction && (
                    <td style={{ textAlign: 'center' }}>
                      {page === 'requests' ? (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                          {['DRAFT', 'REVISI'].includes(String(r.status || '').toUpperCase()) && (
                            <button
                              type="button"
                              className="btn-finish"
                              onClick={() => onFinishPr(r)}
                              title={`Selesai — kirim ${r.pr_number || title} ke modul Approval`}
                              style={{ fontSize: '9px', padding: '3px 6px', whiteSpace: 'nowrap' }}
                            >
                              ✓ Selesai
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-edit icon-btn"
                            onClick={() => setEditRow(r)}
                            title={`Edit ${r.pr_number || title}`}
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            className="btn-delete icon-btn"
                            onClick={() => onDelete(page, r)}
                            title={`Hapus ${r.pr_number || title}`}
                          >
                            🗑️
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-delete"
                          onClick={() => onDelete(page, r)}
                          title={`Hapus ${title}`}
                        >
                          Hapus
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {page === 'receivings' && receivingItemsForReceiving(r.id).length > 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1f3a34' }}>
                          📦 Item yang diorder — isi qty terima lalu tandai "Sudah Diterima"
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedReceiving(expandedReceiving === r.id ? null : r.id)}
                          style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                        >
                          {expandedReceiving === r.id ? '▲ Tutup item' : `▼ Lihat ${receivingItemsForReceiving(r.id).length} item`}
                        </button>
                      </div>
                      {expandedReceiving === r.id && (
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', width: '60px' }}>No</th>
                              <th style={{ padding: '4px 6px' }}>Nama Item</th>
                              <th style={{ padding: '4px 6px', width: '120px' }}>Qty Diterima</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                              <th style={{ padding: '4px 6px', width: '130px', textAlign: 'center' }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receivingItemsForReceiving(r.id).map((it, i) => {
                              const isReceived = String(it.note || '').toUpperCase().startsWith('DITERIMA')
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                  <td style={{ padding: '4px 6px' }}>{i + 1}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                                  <td style={{ padding: '4px 6px' }}>
                                    <input
                                      type="number"
                                      min="0"
                                      value={it.quantity_received ?? ''}
                                      placeholder="0"
                                      disabled={isReceived}
                                      onChange={e => onUpdateReceivingQty(it, e.target.value)}
                                      style={{ width: '70px', padding: '2px 4px', fontSize: '11px' }}
                                    />
                                  </td>
                                  <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                    {isReceived ? (
                                      <span style={{ fontSize: '10px', color: '#137333', fontWeight: 600 }}>✓ Sudah diterima → Handover</span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => onMarkReceivingItemReceived(it)}
                                        style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        ✓ Sudah Diterima
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                {page === 'approvals' && expandedApproval === r.id && (
                  <tr>
                    <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#1f3a34' }}>
                        📋 Material — setujui per barang{r.status === 'APPROVED' ? ', lalu tandai yang sudah dipesan ke supplier' : ''}
                      </div>
                      {approvalItems(r).length === 0 ? (
                        <div>
                          {approvalItemLines(r).length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                              {approvalItemLines(r).map((line, i) => (
                                <span key={i} style={{ fontSize: '11px', lineHeight: 1.45, paddingLeft: '12px', textIndent: '-12px' }}>• {line}</span>
                              ))}
                            </div>
                          )}
                          <p className="muted" style={{ fontSize: '11px', margin: 0 }}>
                            Rincian per barang belum tersimpan untuk PR lama ini — gunakan tombol ✓ Setujui untuk menyetujui seluruh PR.
                          </p>
                        </div>
                      ) : (
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', width: '90px' }}>Kode</th>
                              <th style={{ padding: '4px 6px' }}>Nama Item</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Qty</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                              <th style={{ padding: '4px 6px', width: '110px' }}>Status</th>
                              <th style={{ padding: '4px 6px', width: '150px', textAlign: 'center' }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {approvalItems(r).map(it => {
                              const st = itemState(it)
                              const canApprove = st === 'PENDING' && (r.status === 'PENDING' || r.status === 'APPROVED')
                              const canOrder = st === 'APPROVED' && r.status === 'APPROVED'
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                  <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
                                  <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                                  <td style={{ padding: '4px 6px' }}>
                                    <span className={`badge ${st === 'ORDERED' ? 'status-APPROVED' : (st === 'APPROVED' ? 'badge-item-approved' : 'status-PENDING')}`} style={{ fontSize: '10px' }}>
                                      {st === 'ORDERED' ? '✓ Sudah Order' : (st === 'APPROVED' ? '✓ Disetujui' : '⏳ Menunggu')}
                                    </span>
                                  </td>
                                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                    {st === 'ORDERED' ? (
                                      <span style={{ fontSize: '10px', color: '#137333' }}>→ ke Receiving</span>
                                    ) : canOrder ? (
                                      <button
                                        type="button"
                                        onClick={() => onMarkPrItemOrdered(it)}
                                        style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        🛒 Sudah Order
                                      </button>
                                    ) : canApprove ? (
                                      <button
                                        type="button"
                                        onClick={() => onApproveItem(it)}
                                        style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        ✓ Setujui
                                      </button>
                                    ) : st === 'APPROVED' ? (
                                      <span style={{ fontSize: '10px', color: '#b45309', whiteSpace: 'nowrap' }}>⏳ Menunggu PR disetujui</span>
                                    ) : (
                                      <span style={{ fontSize: '10px', color: '#71817d' }}>—</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length + (hasDeleteAction || page === 'approvals' ? 1 : 0)} className="empty">
                  Belum ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function headersFor(page, rows) {
  const defaults = {
    projects: ['kode', 'name', 'status', 'created_at'],
    past_projects: ['kode', 'name', 'status', 'created_at'],
    vendors: ['name', 'phone', 'store_link', 'supplier_category'],
    materials: ['kode', 'name', 'category', 'qty', 'satuan'],
    requests: ['priority', 'pr_number', 'project_name', 'title', 'materials_summary', 'status'],
    approvals: ['pr_number', 'project_name', 'title', 'items', 'step_number', 'status', 'note', 'decided_at'],
    receivings: ['invoice_no', 'project_name', 'status', 'received_date', 'note'],
    handovers: ['project_name', 'received_by', 'status', 'handover_date', 'note']
  }
  if (['materials', 'vendors', 'projects', 'past_projects', 'requests', 'approvals', 'receivings', 'handovers'].includes(page)) {
    return defaults[page]
  }
  return rows[0]
    ? Object.keys(rows[0]).filter(x => !['id', 'password'].includes(x)).slice(0, 6)
    : defaults[page]
}

function pretty(x) {
  if (x === 'kode') return 'Kode'
  if (x === 'name') return 'Nama'
  if (x === 'category') return 'Kategori'
  if (x === 'qty') return 'Qty'
  if (x === 'satuan' || x === 'unit') return 'Satuan'
  if (x === 'contact') return 'Kontak'
  if (x === 'phone') return 'Kontak WA'
  if (x === 'store_link') return 'Link Toko'
  if (x === 'supplier_category') return 'Supplier'
  if (x === 'pr_number') return 'No. PR'
  if (x === 'project_name') return 'Project'
  if (x === 'title') return 'Judul Kebutuhan'
  if (x === 'materials_summary' || x === 'items') return 'Item Material'
  if (x === 'step_number') return 'Step'
  if (x === 'delivery_note') return 'Surat Jalan / PO'
  if (x === 'invoice_no') return 'No. Invoice'
  if (x === 'received_date') return 'Tgl Terima'
  if (x === 'handover_date') return 'Tgl Serah Terima'
  if (x === 'received_by') return 'Diterima Oleh'
  if (x === 'priority') return 'Prioritas'
  if (x === 'status') return 'Status'
  if (x === 'notes' || x === 'note') return 'Catatan'
  if (x === 'decided_at') return 'Waktu Putusan'
  return String(x).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function format(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toLocaleDateString('id-ID')
  }
  return String(v)
}

// Link toko vendor: bisa dibuka langsung di tab baru; tanpa http(s):// otomatis ditambah.
function StoreLink({ value }) {
  const v = String(value || '').trim()
  if (!v) return <>{format(value)}</>
  const href = /^https?:\/\//i.test(v) ? v : `https://${v}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={v}
      style={{ color: '#1a73e8', textDecoration: 'underline', display: 'inline-block', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
    >
      {v.replace(/^https?:\/\//i, '')}
    </a>
  )
}

// Kontak WA: nomor valid (>= 8 digit) dibuka ke wa.me; selain itu tampil teks biasa.
function WaContact({ value }) {
  const v = String(value || '').trim()
  if (!v) return <>{format(value)}</>
  const digits = v.replace(/\D/g, '')
  if (digits.length < 8) return <>{format(value)}</>
  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8', textDecoration: 'underline' }}>
      {v}
    </a>
  )
}

function Create({ page, allProjects = [], allMaterials = [], allVendors = [], existingRequests = [], allRequestsFull = [], editRow = null, editItems = [], allReceivings = [], close, refresh, say }) {
  const isEdit = !!editRow
  // Nomor PR berikutnya dihitung dari SEMUA PR (bukan hasil filter), dan selalu
  // lebih besar dari nomor tertinggi yang sudah ada agar tidak pernah dobel
  // walaupun ada PR yang dihapus.
  const nextPrNum = (() => {
    const maxNum = (allRequestsFull || []).reduce((max, p) => {
      const n = parseInt(String(p.pr_number || '').replace(/^\D+/, ''), 10)
      return isFinite(n) && n > max ? n : max
    }, 0)
    return 'PR-' + String(maxNum + 1).padStart(3, '0')
  })()

  // Kode material berikutnya (hanya untuk tampilan di form). Kode final dihitung
  // ulang saat simpan agar tidak dobel bila ada penambahan dari sesi lain.
  const nextMatNum = (() => {
    const maxNum = (allMaterials || []).reduce((max, m) => {
      const match = String(m.kode || m.code || '').match(/^MAT-(\d+)$/)
      const n = match ? parseInt(match[1], 10) : NaN
      return isFinite(n) && n > max ? n : max
    }, 0)
    return 'MAT-' + String(maxNum + 1).padStart(4, '0')
  })()

  // Data validation kategori: dropdown berisi kategori yang ada di master material
  // (kategori utama tampil lebih dulu, sisanya urut alfabetis).
  const materialCategories = useMemo(() => {
    const known = ['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai']
    const set = new Set((allMaterials || []).map(m => (m.category || '').trim()).filter(Boolean))
    if (!set.size) {
      const fallback = ['Plywood & Board', 'HPL & Edging', 'Hardware & Fitting', 'Bahan Habis Pakai', 'Aluminium & Profil', 'Kelistrikan & Lampu', 'WPC & Panel']
      fallback.forEach(c => set.add(c))
    }
    const rest = [...set].filter(c => !known.includes(c)).sort((a, b) => a.localeCompare(b, 'id'))
    return [...known.filter(c => set.has(c)), ...rest]
  }, [allMaterials])

  const [form, setForm] = useState({
    name: editRow?.name || '',
    status: editRow?.status || 'ON_GOING',
    category: '',
    kode: '',
    qty: '0',
    satuan: 'Lembar',
    phone: '',
    contact: '',
    title: editRow?.title || '',
    pr_number: editRow?.pr_number || nextPrNum,
    project_id: editRow?.project_id || (allProjects.find(p => normalizeStatus(p.status) !== 'DONE')?.id || allProjects[0]?.id || ''),
    notes: editRow?.notes || '',
    priority: editRow?.priority || 'NORMAL',
    delivery_note: '',
    invoice_no: '',
    pr_id: '',
    receiving_id: '',
    receiving_status: 'SELESAI',
    received_date: new Date().toISOString().slice(0, 10),
    received_by: '',
    handover_status: 'CONFIRMED',
    handover_date: new Date().toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  const [materialSearch, setMaterialSearch] = useState('')

  // State untuk Item Material di PR (1 pengadaan bisa banyak item)
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [itemQty, setItemQty] = useState('1')
  // Mode edit: item lama PR dimuat ke daftar supaya bisa diubah qty / ditambah / dihapus.
  const [prItemsList, setPrItemsList] = useState(() => (editItems || []).map(it => ({
    id: it.id,
    material_id: it.material_id,
    kode: it.kode || '',
    name: it.item_name || '',
    category: '',
    satuan: it.unit || 'Pcs',
    qty: it.quantity ?? 1,
    supplier_category: it.supplier_category || '',
    vendor_id: it.vendor_id || ''
  })))

  const filteredMaterials = useMemo(() => {
    if (!materialSearch.trim()) return allMaterials.slice(0, 100)
    const q = materialSearch.toLowerCase().trim()
    return allMaterials.filter(m =>
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.kode || m.code || '').toLowerCase().includes(q)
    ).slice(0, 200)
  }, [allMaterials, materialSearch])

  function addItemToPR() {
    if (!selectedMaterialId) return
    const mat = allMaterials.find(m => m.id === selectedMaterialId)
    if (!mat) return

    const existingIdx = prItemsList.findIndex(it => it.material_id === mat.id)
    if (existingIdx !== -1) {
      const updated = [...prItemsList]
      updated[existingIdx].qty = Number(updated[existingIdx].qty) + (Number(itemQty) || 1)
      setPrItemsList(updated)
    } else {
      setPrItemsList([...prItemsList, {
        material_id: mat.id,
        kode: mat.kode || mat.code || '—',
        name: mat.name,
        category: mat.category || '—',
        satuan: mat.satuan || mat.unit || 'Pcs',
        qty: Number(itemQty) || 1,
        supplier_category: mat.category || '',
        vendor_id: ''
      }])
    }
    setItemQty('1')
    setSelectedMaterialId('')
    setMaterialSearch('')
  }

  function removeItemFromPR(idx) {
    setPrItemsList(prItemsList.filter((_, i) => i !== idx))
  }

  function updateItemQty(idx, val) {
    const q = Number(val)
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, qty: isFinite(q) && q > 0 ? q : 1 } : it))
  }

  // Rencana beli per item: supplier (kategori) + vendor
  function updateItemSupplier(idx, val) {
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, supplier_category: val } : it))
  }
  function updateItemVendor(idx, val) {
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, vendor_id: val } : it))
  }
  // Vendor yang cocok dengan kategori supplier diprioritaskan; jika tidak ada yang cocok, tampilkan semua.
  function vendorsForItem(it) {
    const all = allVendors || []
    const cat = String(it.supplier_category || '').trim().toLowerCase()
    let list = all
    if (cat) {
      const match = all.filter(v => String(v.supplier_category || '').trim().toLowerCase() === cat)
      if (match.length) list = match
    }
    if (it.vendor_id && !list.some(v => v.id === it.vendor_id)) {
      const cur = all.find(v => v.id === it.vendor_id)
      if (cur) list = [...list, cur]
    }
    return list
  }

  const field = (name, label, type = 'text', required = false) => (
    <label>
      {label}
      <input
        type={type}
        value={form[name] || ''}
        onChange={e => setForm({ ...form, [name]: e.target.value })}
        required={required}
      />
    </label>
  )

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    const table = {
      projects: 'projects',
      vendors: 'vendors',
      materials: 'materials',
      requests: 'purchase_requests',
      receivings: 'receivings',
      handovers: 'handovers'
    }[page]

    let data = {}
    if (page === 'requests') {
      const summary = prItemsList.length
        ? prItemsList.map(it => `${it.qty} ${it.satuan || ''} ${it.name}`).join(', ')
        : (form.title || '—')

      // Mode EDIT: perbarui PR yang ada + sinkronkan item (tanpa membuat approval baru)
      if (isEdit) {
        const { error: upErr } = await supabase.from('purchase_requests').update({
          project_id: form.project_id || null,
          title: form.title,
          pr_number: form.pr_number,
          priority: form.priority || 'NORMAL',
          materials_summary: summary,
          notes: form.notes || form.title
        }).eq('id', editRow.id)
        if (upErr) { setSaving(false); say(upErr.message); return }

        // Sinkronkan pr_items: hapus yang dibuang (kecuali sudah diorder),
        // update item lama, dan insert item baru.
        const keptIds = prItemsList.filter(it => it.id).map(it => it.id)
        const removed = (editItems || []).filter(oi => !keptIds.includes(oi.id))
        let skipped = 0
        let itemErrMsg = ''
        for (const oi of removed) {
          if (String(oi.status || '').toUpperCase() === 'ORDERED') { skipped++; continue }
          const { error } = await supabase.from('pr_items').delete().eq('id', oi.id)
          if (error && !itemErrMsg) itemErrMsg = error.message
        }
        for (const it of prItemsList) {
          if (it.id) {
            const { error } = await supabase.from('pr_items').update({
              quantity: it.qty,
              unit: it.satuan,
              supplier_category: it.supplier_category || null,
              vendor_id: it.vendor_id || null
            }).eq('id', it.id)
            if (error && !itemErrMsg) itemErrMsg = error.message
          } else {
            const { error } = await supabase.from('pr_items').insert({
              pr_id: editRow.id,
              material_id: it.material_id,
              item_name: it.name,
              kode: it.kode,
              unit: it.satuan,
              quantity: it.qty,
              status: 'PENDING_APPROVAL',
              supplier_category: it.supplier_category || null,
              vendor_id: it.vendor_id || null
            })
            if (error && !itemErrMsg) itemErrMsg = error.message
          }
        }

        setSaving(false)
        if (itemErrMsg) {
          say(`PR ${form.pr_number} diperbarui, tapi ada masalah pada item: ${itemErrMsg}`)
        } else {
          say(`Purchase Request ${form.pr_number} berhasil diperbarui (${prItemsList.length} item).${skipped ? ` ${skipped} item sudah diorder tidak ikut dihapus.` : ''}`)
        }
        close(); refresh()
        return
      }

      // PR baru dibuat sebagai DRAFT; masuk modul Approval lewat tombol ✓ Selesai
      data = {
        project_id: form.project_id || null,
        title: form.title,
        pr_number: form.pr_number || nextPrNum,
        priority: form.priority || 'NORMAL',
        status: 'DRAFT',
        materials_summary: summary,
        notes: form.notes || form.title
      }

      const { data: insertedPR, error: prErr } = await supabase.from('purchase_requests').insert(data).select().single()
      if (prErr) {
        setSaving(false)
        say(prErr.message)
        return
      }

      if (prItemsList.length && insertedPR) {
        const itemRecords = prItemsList.map(it => ({
          pr_id: insertedPR.id,
          material_id: it.material_id,
          item_name: it.name,
          kode: it.kode,
          unit: it.satuan,
          quantity: it.qty,
          status: 'PENDING_APPROVAL',
          supplier_category: it.supplier_category || null,
          vendor_id: it.vendor_id || null
        }))
        const { error: itemErr } = await supabase.from('pr_items').insert(itemRecords)
        if (itemErr) {
          setSaving(false)
          say(`PR tersimpan, tapi gagal simpan item: ${itemErr.message}`)
          close(); refresh()
          return
        }
      }

      setSaving(false)
      say(`Purchase Request ${data.pr_number} berhasil dibuat (${prItemsList.length} item). Klik "✓ Selesai" pada baris PR untuk mengirim ke modul Approval.`)
      close()
      refresh()
      return
    } else if (page === 'materials') {
      // Kode material otomatis (MAT-XXXX): dihitung saat simpan dari nomor
      // tertinggi di database supaya tidak pernah dobel.
      let newKode = (isEdit && (editRow?.kode || editRow?.code)) || ''
      if (!newKode) {
        const { data: allMats, error: kodeErr } = await supabase.from('materials').select('kode')
        if (kodeErr) {
          setSaving(false)
          say(`Gagal membuat kode material: ${kodeErr.message}`)
          return
        }
        const maxNum = (allMats || []).reduce((max, m) => {
          const match = String(m.kode || '').match(/^MAT-(\d+)$/)
          const n = match ? parseInt(match[1], 10) : NaN
          return isFinite(n) && n > max ? n : max
        }, 0)
        newKode = 'MAT-' + String(maxNum + 1).padStart(4, '0')
      }
      data = {
        name: form.name,
        category: form.category || null,
        kode: newKode,
        code: newKode,
        qty: form.qty || '0',
        satuan: form.satuan || 'Lembar',
        unit: form.satuan || 'Lembar'
      }
    } else if (page === 'vendors') {
      data = {
        name: form.name,
        phone: form.phone || null,
        store_link: form.store_link || null,
        supplier_category: form.supplier_category || null,
        contact: form.contact || null
      }
    } else if (page === 'projects') {
      data = {
        kode: form.kode || null,
        code: form.kode || null,
        name: form.name,
        status: form.status
      }
    } else if (page === 'receivings') {
      const isKendala = isReceivingKendala(form.receiving_status || 'SELESAI')
      const isGudang = form.receiving_status === 'MASUK_GUDANG'
      data = {
        purchase_request_id: form.pr_id || null,
        project_id: form.project_id || null,
        delivery_note: form.delivery_note,
        invoice_no: form.invoice_no || null,
        status: form.receiving_status || 'SELESAI',
        kendala: isKendala ? (form.receiving_status || '').replace('KENDALA_', '') : null,
        alokasi: isGudang ? 'MASUK_GUDANG' : 'LANGSUNG_LAPANGAN',
        masuk_gudang: isGudang,
        gudang_at: isGudang ? new Date().toISOString() : null,
        received_date: form.received_date || new Date().toISOString().slice(0, 10),
        note: form.notes || null
      }
    } else if (page === 'handovers') {
      data = {
        receiving_id: form.receiving_id || null,
        project_id: form.project_id || null,
        received_by: form.received_by,
        status: form.handover_status || 'CONFIRMED',
        handover_date: form.handover_date || new Date().toISOString().slice(0, 10),
        note: form.notes || null
      }
    }

    const { error } = await supabase.from(table).insert(data)
    setSaving(false)
    if (error) {
      say(error.message)
      return
    }
    say(`${labels[page]} berhasil ditambahkan.`)
    close()
    refresh()
  }

  return (
    <div className="modal">
      <form className={`dialog${page === 'requests' ? ' dialog-wide' : ''}`} onSubmit={save}>
        <div className="dialoghead">
          <h2>{isEdit ? 'Edit' : 'Tambah'} {labels[page]}</h2>
          <button type="button" className="icon" onClick={close}>×</button>
        </div>
        {page === 'requests' && (
          <>
            <label>Project
              <select
                value={form.project_id}
                onChange={e => setForm({ ...form, project_id: e.target.value })}
                required
              >
                <option value="">-- Pilih Project --</option>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.kode ? `[${p.kode}] ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </label>
            {field('title', 'Judul Kebutuhan', 'text', true)}
            <label>Prioritas
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="NORMAL">Standard</option>
                <option value="URGENT">Prioritas</option>
              </select>
            </label>

            {/* ITEM MATERIAL — 1 pengadaan bisa banyak item */}
            <div className="material-picker-box">
              <label style={{ fontWeight: 600, color: '#1f3a34', marginBottom: '6px', display: 'block' }}>
                📦 Item Material ({prItemsList.length} item)
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: '8px', alignItems: 'end' }}>
                <label style={{ margin: 0, fontSize: '12px' }}>Pilih dari Master Material ({allMaterials.length})
                  <input
                    type="text"
                    placeholder="🔍 Cari nama / kode material…"
                    value={materialSearch}
                    onChange={e => setMaterialSearch(e.target.value)}
                    style={{ marginBottom: '4px' }}
                  />
                  <select
                    value={selectedMaterialId}
                    onChange={e => setSelectedMaterialId(e.target.value)}
                  >
                    <option value="">-- Pilih Material --</option>
                    {filteredMaterials.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.kode ? `[${m.kode}] ` : ''}{m.name} ({m.satuan || 'Pcs'})
                      </option>
                    ))}
                  </select>
                  {materialSearch && (
                    <small style={{ color: '#5b6b66' }}>{filteredMaterials.length} hasil{filteredMaterials.length >= 200 ? ' (maks 200, perbanyak kata kunci)' : ''}</small>
                  )}
                </label>
                <label style={{ margin: 0, fontSize: '12px' }}>Qty
                  <input
                    type="number"
                    min="1"
                    value={itemQty}
                    onChange={e => setItemQty(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="outline"
                  style={{ height: '36px', whiteSpace: 'nowrap', padding: '0 12px', fontSize: '12px' }}
                  onClick={addItemToPR}
                  disabled={!selectedMaterialId}
                >
                  + Tambah Item
                </button>
              </div>

              {prItemsList.length > 0 ? (
                <div style={{ marginTop: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                        <th style={{ padding: '4px 6px' }}>Kode</th>
                        <th style={{ padding: '4px 6px' }}>Nama Material</th>
                        <th style={{ padding: '4px 6px', width: '60px' }}>Qty</th>
                        <th style={{ padding: '4px 6px', width: '60px' }}>Satuan</th>
                        <th style={{ padding: '4px 6px', width: '40px', textAlign: 'center' }}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prItemsList.map((it, idx) => (
                        <React.Fragment key={it.material_id || idx}>
                        <tr style={{ borderBottom: '1px dashed #e1e7e4' }}>
                          <td style={{ padding: '4px 6px' }}><b>{it.kode}</b></td>
                          <td style={{ padding: '4px 6px' }}>{it.name}</td>
                          <td style={{ padding: '4px 6px' }}>
                            <input
                              type="number"
                              min="1"
                              value={it.qty}
                              onChange={e => updateItemQty(idx, e.target.value)}
                              style={{ width: '52px', padding: '2px 4px', fontSize: '11px' }}
                            />
                          </td>
                          <td style={{ padding: '4px 6px' }}>{it.satuan || '—'}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                            <button
                              type="button"
                              className="btn-delete"
                              style={{ padding: '2px 5px', fontSize: '10px' }}
                              onClick={() => removeItemFromPR(idx)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #e1e7e4' }}>
                          <td colSpan={5} style={{ padding: '3px 6px 6px', background: '#fafcfb' }}>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 600 }}>🛒 Rencana beli:</span>
                              <label style={{ margin: 0, fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: '#485653' }}>
                                Supplier
                                <select
                                  value={it.supplier_category || ''}
                                  onChange={e => updateItemSupplier(idx, e.target.value)}
                                  style={{ width: 'auto', maxWidth: '150px', padding: '2px 4px', fontSize: '10px' }}
                                >
                                  <option value="">-- Kategori --</option>
                                  {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </label>
                              <label style={{ margin: 0, fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: '#485653' }}>
                                Vendor
                                <select
                                  value={it.vendor_id || ''}
                                  onChange={e => updateItemVendor(idx, e.target.value)}
                                  style={{ width: 'auto', maxWidth: '150px', padding: '2px 4px', fontSize: '10px' }}
                                >
                                  <option value="">-- Pilih Vendor --</option>
                                  {vendorsForItem(it).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                </select>
                              </label>
                            </div>
                          </td>
                        </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: '11px', marginTop: '6px', marginBottom: 0 }}>
                  💡 Belum ada item. Pilih material di atas lalu "+ Tambah Item", atau import dari Excel.
                </p>
              )}
            </div>

            {field('notes', 'Catatan Tambahan', 'text', false)}
          </>
        )}
        {page === 'materials' && (
          <>
            <label>Kode Material (otomatis)
              <input
                type="text"
                value={isEdit ? (editRow?.kode || editRow?.code || '') : nextMatNum}
                readOnly
                disabled
                style={{ background: '#f1f5f3', color: '#5b6b66', fontWeight: 600, cursor: 'not-allowed' }}
              />
            </label>
            {field('name', 'Nama Material', 'text', true)}
            <label>Kategori
              <select value={form.category || ''} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="">-- Pilih Kategori --</option>
                {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {field('qty', 'Qty', 'number', false)}
            <label>Satuan
              <select value={form.satuan || 'Lembar'} onChange={e => setForm({ ...form, satuan: e.target.value })}>
                <option value="Lembar">Lembar</option>
                <option value="Batang">Batang</option>
                <option value="Kaleng">Kaleng</option>
                <option value="Roll">Roll</option>
                <option value="Meter">Meter</option>
                <option value="Pcs">Pcs</option>
                <option value="Box">Box</option>
                <option value="Set">Set</option>
                <option value="Botol">Botol</option>
                <option value="Blek">Blek</option>
                <option value="Kg">Kg</option>
                <option value="Liter">Liter</option>
                <option value="Pasang">Pasang</option>
                <option value="Kotak">Kotak</option>
                <option value="Bungkus">Bungkus</option>
              </select>
            </label>
          </>
        )}
        {page === 'vendors' && (
          <>
            {field('name', 'Nama Vendor', 'text', true)}
            {field('phone', 'Kontak WA (No. WhatsApp)', 'text', false)}
            {field('store_link', 'Link Toko (URL)', 'text', false)}
            <label>Supplier — Kategori Material
              <select value={form.supplier_category || ''} onChange={e => setForm({ ...form, supplier_category: e.target.value })}>
                <option value="">-- Pilih Kategori --</option>
                {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {field('contact', 'Kontak / Email (opsional)', 'text', false)}
          </>
        )}
        {page === 'projects' && (
          <>
            {field('kode', 'Kode Project (Nomor)', 'text', true)}
            {field('name', 'Nama Project', 'text', true)}
            <label>Status
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="NOT_START">Not Start</option>
                <option value="ON_GOING">On Going</option>
                <option value="DONE">Done</option>
              </select>
            </label>
          </>
        )}
        {page === 'receivings' && (
          <>
            <label>Purchase Request (PR)
              <select
                value={form.pr_id || ''}
                onChange={e => {
                  const pr = (allRequestsFull || []).find(p => p.id === e.target.value)
                  setForm({ ...form, pr_id: e.target.value, project_id: pr?.project_id || form.project_id })
                }}
                required
              >
                <option value="">-- Pilih PR --</option>
                {(allRequestsFull || []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.pr_number} — {p.title || ''} {p.status ? `(${p.status})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>Project (otomatis dari PR, bisa diubah)
              <select
                value={form.project_id}
                onChange={e => setForm({ ...form, project_id: e.target.value })}
                required
              >
                <option value="">-- Pilih Project --</option>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.kode ? `[${p.kode}] ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </label>
            {field('invoice_no', 'No. Invoice', 'text', true)}
            {field('delivery_note', 'Surat Jalan / No. PO (opsional)', 'text', false)}
            <label>Status Penerimaan
              <select value={form.receiving_status || 'SELESAI'} onChange={e => setForm({ ...form, receiving_status: e.target.value })}>
                <option value="SELESAI">✓ Diterima (Langsung ke Proyek)</option>
                <option value="MASUK_GUDANG">📦 Masuk Gudang (Stok WS)</option>
              </select>
            </label>
            {field('received_date', 'Tanggal Diterima', 'date', false)}
            {field('notes', 'Catatan Penerimaan', 'text', false)}
          </>
        )}
        {page === 'handovers' && (
          <>
            <label>Penerimaan (Receiving)
              <select
                value={form.receiving_id || ''}
                onChange={e => {
                  const rec = (allReceivings || []).find(r => r.id === e.target.value)
                  setForm({ ...form, receiving_id: e.target.value, project_id: rec?.project_id || form.project_id })
                }}
                required
              >
                <option value="">-- Pilih Penerimaan --</option>
                {(allReceivings || []).map(r => (
                  <option key={r.id} value={r.id}>
                    {r.invoice_no || r.delivery_note || 'Penerimaan'} — {r.project_name || ''}
                  </option>
                ))}
              </select>
            </label>
            <label>Project (otomatis dari penerimaan, bisa diubah)
              <select
                value={form.project_id}
                onChange={e => setForm({ ...form, project_id: e.target.value })}
                required
              >
                <option value="">-- Pilih Project --</option>
                {allProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.kode ? `[${p.kode}] ` : ''}{p.name}
                  </option>
                ))}
              </select>
            </label>
            {field('received_by', 'Diterima Oleh (Mandor / Tukang Lapangan)', 'text', true)}
            <label>Status Serah Terima
              <select value={form.handover_status || 'CONFIRMED'} onChange={e => setForm({ ...form, handover_status: e.target.value })}>
                <option value="CONFIRMED">CONFIRMED (Sudah Diserahkan)</option>
                <option value="DRAFT">DRAFT</option>
              </select>
            </label>
            {field('handover_date', 'Tanggal Serah Terima', 'date', false)}
            {field('notes', 'Catatan Serah Terima', 'text', false)}
          </>
        )}
        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </div>
  )
}