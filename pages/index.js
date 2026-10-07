import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { exportToExcel, exportToCsv, exportWorkbook, downloadPrImportTemplate, parsePrItemsFile } from '../lib/workflow'

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
  { value: 'SELESAI', label: 'Selesai (Langsung ke Proyek)', group: 'Normal' },
  { value: 'MASUK_GUDANG', label: '📦 Masuk ke Gudang (Stok WS)', group: 'Normal' },
  { value: 'OTW', label: 'OTW (Dalam Pengiriman)', group: 'Normal' },
  { value: 'PENDING', label: 'Pending (Belum Dikirim)', group: 'Normal' },
  { value: 'RUSAK', label: '⚠️ Rusak (Barang Rusak)', group: 'Kendala' },
  { value: 'RETUR', label: '⚠️ Retur (Retur ke Vendor)', group: 'Kendala' }
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
        const orderCol = table === 'materials' ? 'kode' : (table === 'approval_steps' ? 'step_number' : 'created_at')
        const ascending = table === 'materials' || table === 'approval_steps'
        const { data } = await supabase.from(table).select('*').order(orderCol, { ascending })
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
      setNotice(`Status receiving "${receiving.delivery_note || 'Data'}" berhasil diubah ke "${label}".`)
      loadAll()
    }
  }

  async function moveToWarehouse(receiving) {
    if (!supabase) return
    const ok = window.confirm(`Apakah Anda yakin ingin memasukkan barang dari "${receiving.delivery_note || 'Penerimaan'}" ke Stok Gudang Workshop?`)
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
      setNotice(`Barang "${receiving.delivery_note || 'Data'}" berhasil dimasukkan ke Stok Gudang Workshop.`)
      loadAll()
    }
  }

  async function decideApproval(approval, decision) {
    if (!supabase) return
    const now = new Date().toISOString()
    const label = decision === 'APPROVED' ? 'DISETUJUI' : 'DITOLAK'
    const ok = window.confirm(`Apakah Anda yakin ingin menandai pengajuan "${approval.pr_number || 'PR'}" sebagai ${label}?`)
    if (!ok) return

    const { error: appErr } = await supabase.from('approval_steps').update({
      status: decision,
      decided_at: now,
      note: decision === 'APPROVED' ? 'Disetujui oleh Direksi / PM' : 'Ditolak'
    }).eq('id', approval.id)

    if (approval.purchase_request_id) {
      await supabase.from('purchase_requests').update({
        status: decision
      }).eq('id', approval.purchase_request_id)
    }

    if (appErr) {
      setNotice(`Gagal update approval: ${appErr.message}`)
    } else {
      setNotice(`Pengajuan ${approval.pr_number || 'PR'} berhasil ${label}.`)
      loadAll()
    }
  }

  // ============================================================
  // ALUR PENGADAAN: order -> receiving -> handover
  // ============================================================

  // Approval "Revise" -> status REVISI pada approval + PR
  async function reviseApproval(approval) {
    if (!supabase) return
    const ok = window.confirm(`Tandai pengajuan "${approval.pr_number || 'PR'}" sebagai REVISI (dikembalikan ke pengaju)?`)
    if (!ok) return
    const now = new Date().toISOString()
    const { error: appErr } = await supabase.from('approval_steps').update({
      status: 'REVISI',
      decided_at: now,
      note: 'Diminta revisi oleh Direksi / PM'
    }).eq('id', approval.id)
    if (approval.purchase_request_id) {
      await supabase.from('purchase_requests').update({ status: 'REVISI' }).eq('id', approval.purchase_request_id)
    }
    if (appErr) setNotice(`Gagal: ${appErr.message}`)
    else { setNotice(`Pengajuan ${approval.pr_number || 'PR'} ditandai REVISI.`); loadAll() }
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
    const qty = Number(recItem.quantity_received || 0)

    const receiving = (rows.receivings || []).find(r => r.id === recItem.receiving_id)
    const prItem = (rows.pr_items || []).find(p => p.id === recItem.pr_item_id)
    const pr = prItem ? (rows.requests || []).find(p => p.id === prItem.pr_id) : null
    const projectId = receiving?.project_id || pr?.project_id || null

    // 1. Tandai item sudah diterima (pakai status text pada receiving_items via 'note' + qty_received ditandai)
    const { error: riErr } = await supabase.from('receiving_items')
      .update({ quantity_received: qty > 0 ? qty : null, note: `DITERIMA ${now.slice(0, 10)}` })
      .eq('id', recItem.id)
    if (riErr) { setNotice(`Gagal update item: ${riErr.message}`); return }

    // 2. Buat handover utk item ini
    const { error: hoErr } = await supabase.from('handovers').insert({
      receiving_id: recItem.receiving_id,
      project_id: projectId,
      received_by: 'Belum ditentukan',
      handover_date: now.slice(0, 10),
      status: 'DRAFT',
      note: `Item diterima: ${recItem.item_name} (${recItem.quantity_received || '?'} ${recItem.unit || ''}). Dari PR ${pr?.pr_number || '-'}.`
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
    const itemName = item.delivery_note || item.pr_number || item.received_by || item.name || item.kode || item.code || 'Item'
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
            refresh={loadAll}
            say={setNotice}
            onStatusChange={updateProjectStatus}
            onReceivingStatusChange={updateReceivingStatus}
            onMoveToWarehouse={moveToWarehouse}
            onDecideApproval={decideApproval}
            onReviseApproval={reviseApproval}
            onMarkPrItemOrdered={markPrItemOrdered}
            onMarkReceivingItemReceived={markReceivingItemReceived}
            onUpdateReceivingQty={updateReceivingQty}
            onDelete={deleteItem}
            setPage={setPage}
          />
        )}
      </section>
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
              ['Purchase Request', rows.requests || [], headersFor('requests', rows.requests || [])],
              ['PR Items', rows.pr_items || [], ['pr_id', 'material_id', 'item_name', 'kode', 'unit', 'quantity', 'estimated_price', 'status']],
              ['Approval', rows.approvals || [], headersFor('approvals', rows.approvals || [])],
              ['Receiving', rows.receivings || [], headersFor('receivings', rows.receivings || [])],
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

function Module({ page, rows, allProjects, allMaterials = [], refresh, say, onStatusChange, onReceivingStatusChange, onMoveToWarehouse, onDecideApproval, onReviseApproval, onMarkPrItemOrdered, onMarkReceivingItemReceived, onUpdateReceivingQty, onDelete, setPage }) {
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
  const title = labels[page]

  // --- Helper alur item (dipakai modul Approval & Receiving) ---
  const prItemsForPr = (prId) => (rows.pr_items || []).filter(it => it.pr_id === prId)
  const approvalItems = (approval) => prItemsForPr(approval.purchase_request_id)
  const approvalItemCount = (approval) => approvalItems(approval).length
  const receivingItemsForReceiving = (recId) => (rows.receiving_items || []).filter(it => it.receiving_id === recId)

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
                className={`pill ${prFilter === 'URGENT' ? 'active' : ''}`}
                onClick={() => setPrFilter('URGENT')}
                style={rows.some(r => r.priority === 'URGENT') ? { borderColor: '#c93b2b', color: '#c93b2b', fontWeight: 'bold' } : {}}
              >
                🚨 Urgent ({rows.filter(r => r.priority === 'URGENT').length})
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
                Selesai Langsung ({rows.filter(r => r.status === 'SELESAI' && !r.masuk_gudang).length})
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
          {page !== 'dashboard' && (
            <span style={{ display: 'inline-flex', gap: '6px' }}>
              <button
                type="button"
                className="outline"
                title="Unduh Excel (.xlsx)"
                onClick={() => exportToExcel(displayRows, headersFor(page, displayRows), `Purchasing-${page}`)}
                style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '8px 12px' }}
              >
                📊 XLSX
              </button>
              <button
                type="button"
                className="outline"
                title="Unduh CSV (.csv)"
                onClick={() => exportToCsv(displayRows, headersFor(page, displayRows), `Purchasing-${page}`)}
                style={{ whiteSpace: 'nowrap', fontSize: '12px', padding: '8px 12px' }}
              >
                📄 CSV
              </button>
            </span>
          )}
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
      {open && (
        <Create
          page={page}
          allProjects={allProjects}
          allMaterials={allMaterials}
          existingRequests={displayRows}
          close={() => setOpen(false)}
          refresh={refresh}
          say={say}
        />
      )}
      <div className="panel table">
        <table>
          <thead>
            <tr>
              {columns.map(h => (
                <th key={h}>{pretty(h)}</th>
              ))}
              {(hasDeleteAction || page === 'approvals') && (
                <th style={{ width: page === 'approvals' ? '140px' : '90px', textAlign: 'center' }}>Aksi</th>
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
                              value={['KENDALA_RUSAK', 'RUSAK'].includes(r.status) ? 'RUSAK' : (['KENDALA_RETUR', 'RETUR'].includes(r.status) ? 'RETUR' : (r.status || 'PENDING'))}
                              onChange={e => onReceivingStatusChange(r, e.target.value)}
                            >
                              <optgroup label="Status Normal">
                                <option value="SELESAI">Selesai (Langsung Proyek)</option>
                                <option value="MASUK_GUDANG">📦 Masuk ke Gudang (Stok WS)</option>
                                <option value="OTW">OTW (Dalam Pengiriman)</option>
                                <option value="PENDING">Pending (Belum Dikirim)</option>
                              </optgroup>
                              <optgroup label="Pilihan Kendala">
                                <option value="RUSAK">⚠️ Rusak (Barang Rusak)</option>
                                <option value="RETUR">⚠️ Retur (Retur ke Vendor)</option>
                              </optgroup>
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
                        ) : (
                          format(rawVal)
                        )}
                      </td>
                    )
                  })}
                  {page === 'approvals' && (
                    <td style={{ textAlign: 'center' }}>
                      {r.status === 'PENDING' ? (
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
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                          <span className={`badge status-${r.status}`}>{r.status}</span>
                          {r.status === 'APPROVED' && approvalItemCount(r) > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedApproval(expandedApproval === r.id ? null : r.id)}
                              style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '4px', padding: '3px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, color: '#1f3a34' }}
                            >
                              {expandedApproval === r.id ? '▲ Tutup item' : `▼ Item & Order (${approvalItemCount(r)})`}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                  {hasDeleteAction && (
                    <td style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn-delete"
                        onClick={() => onDelete(page, r)}
                        title={`Hapus ${title}`}
                      >
                        Hapus
                      </button>
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
                {page === 'approvals' && expandedApproval === r.id && r.status === 'APPROVED' && (
                  <tr>
                    <td colSpan={columns.length + 2} style={{ background: '#fbfdfc', padding: '10px 12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: '#1f3a34' }}>
                        📋 Item disetujui — tandai yang sudah dipesan ke supplier
                      </div>
                      {approvalItems(r).length === 0 ? (
                        <p className="muted" style={{ fontSize: '11px' }}>Tidak ada item pada PR ini.</p>
                      ) : (
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', width: '90px' }}>Kode</th>
                              <th style={{ padding: '4px 6px' }}>Nama Item</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Qty</th>
                              <th style={{ padding: '4px 6px', width: '70px' }}>Satuan</th>
                              <th style={{ padding: '4px 6px', width: '100px' }}>Status</th>
                              <th style={{ padding: '4px 6px', width: '110px', textAlign: 'center' }}>Aksi</th>
                            </tr>
                          </thead>
                          <tbody>
                            {approvalItems(r).map(it => {
                              const isOrdered = String(it.status || '').toUpperCase() === 'ORDERED'
                              return (
                                <tr key={it.id} style={{ borderBottom: '1px solid #e1e7e4' }}>
                                  <td style={{ padding: '4px 6px' }}><b>{it.kode || '—'}</b></td>
                                  <td style={{ padding: '4px 6px' }}>{it.item_name}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.quantity}</td>
                                  <td style={{ padding: '4px 6px' }}>{it.unit || '—'}</td>
                                  <td style={{ padding: '4px 6px' }}>
                                    <span className={`badge ${isOrdered ? 'status-APPROVED' : 'status-DRAFT'}`} style={{ fontSize: '10px' }}>
                                      {isOrdered ? '✓ Sudah Order' : 'Belum Diorder'}
                                    </span>
                                  </td>
                                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                    {isOrdered ? (
                                      <span style={{ fontSize: '10px', color: '#137333' }}>→ ke Receiving</span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => onMarkPrItemOrdered(it)}
                                        style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '10px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                      >
                                        🛒 Sudah Order
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
    vendors: ['name', 'phone', 'contact', 'created_at'],
    materials: ['kode', 'name', 'category', 'qty', 'satuan'],
    requests: ['pr_number', 'project_name', 'title', 'materials_summary', 'priority', 'status', 'notes', 'created_at'],
    approvals: ['pr_number', 'project_name', 'title', 'step_number', 'status', 'note', 'decided_at'],
    receivings: ['delivery_note', 'project_name', 'invoice_no', 'status', 'received_date', 'note'],
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
  if (x === 'category') return 'Category'
  if (x === 'qty') return 'Qty'
  if (x === 'satuan' || x === 'unit') return 'Satuan'
  if (x === 'contact') return 'Kontak'
  if (x === 'pr_number') return 'No. PR'
  if (x === 'project_name') return 'Project'
  if (x === 'title') return 'Judul Kebutuhan'
  if (x === 'materials_summary') return 'Item Material'
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

function Create({ page, allProjects = [], allMaterials = [], existingRequests = [], close, refresh, say }) {
  const nextPrNum = 'PR-' + String((existingRequests || []).length + 1).padStart(3, '0')
  const [form, setForm] = useState({
    name: '',
    status: 'ON_GOING',
    category: '',
    kode: '',
    qty: '0',
    satuan: 'Lembar',
    phone: '',
    contact: '',
    title: '',
    pr_number: nextPrNum,
    project_id: allProjects.find(p => normalizeStatus(p.status) !== 'DONE')?.id || allProjects[0]?.id || '',
    notes: '',
    priority: 'NORMAL',
    delivery_note: '',
    invoice_no: '',
    receiving_status: 'SELESAI',
    received_date: new Date().toISOString().slice(0, 10),
    received_by: '',
    handover_status: 'CONFIRMED',
    handover_date: new Date().toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [materialSearch, setMaterialSearch] = useState('')
  const fileInputRef = useRef(null)

  // State untuk Item Material di PR (1 pengadaan bisa banyak item)
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [itemQty, setItemQty] = useState('1')
  const [prItemsList, setPrItemsList] = useState([])

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
        qty: Number(itemQty) || 1
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

  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportMsg('')
    try {
      const buf = await file.arrayBuffer()
      const { items, errors, warnings } = parsePrItemsFile(buf, file.name, allMaterials)
      if (!items.length) {
        setImportMsg(`❌ Tidak ada item yang bisa diimpor. ${errors.slice(0, 4).join(' | ')}`)
      } else {
        // gabungkan dengan item yang sudah ada
        const merged = [...prItemsList]
        for (const it of items) {
          const idx = merged.findIndex(x => x.material_id === it.material_id)
          if (idx !== -1) merged[idx].qty = Number(merged[idx].qty) + Number(it.qty)
          else merged.push(it)
        }
        setPrItemsList(merged)
        const errTxt = errors.length ? ` ⚠️ ${errors.length} baris dilewati.` : ''
        setImportMsg(`✅ ${items.length} item berhasil diimpor dari "${file.name}".${errTxt}${errors.length ? ' Detail: ' + errors.slice(0, 3).join(' | ') : ''}`)
      }
      if (warnings.length && items.length) setImportMsg(m => `${m} ${warnings.slice(0, 2).join(' | ')}`)
    } catch (err) {
      setImportMsg(`❌ Gagal membaca file: ${err.message}`)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      requests: 'purchase_requests'
    }[page]

    let data = {}
    if (page === 'requests') {
      const summary = prItemsList.length
        ? prItemsList.map(it => `${it.qty} ${it.satuan || ''} ${it.name}`).join(', ')
        : (form.title || '—')

      // PR yang baru dibuat langsung SUBMITTED agar otomatis masuk modul Approval
      data = {
        project_id: form.project_id || null,
        title: form.title,
        pr_number: form.pr_number || nextPrNum,
        priority: form.priority || 'NORMAL',
        status: 'SUBMITTED',
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
          status: 'PENDING_APPROVAL'
        }))
        const { error: itemErr } = await supabase.from('pr_items').insert(itemRecords)
        if (itemErr) {
          setSaving(false)
          say(`PR tersimpan, tapi gagal simpan item: ${itemErr.message}`)
          close(); refresh()
          return
        }
      }

      // Auto-buat 1 approval step PENDING (Step 1: Direksi / PM)
      if (insertedPR) {
        const { error: appErr } = await supabase.from('approval_steps').insert({
          purchase_request_id: insertedPR.id,
          step_number: 1,
          status: 'PENDING',
          note: `Menunggu persetujuan Direksi / PM untuk PR ${data.pr_number}`
        })
        if (appErr) {
          setSaving(false)
          say(`PR ${data.pr_number} tersimpan, tapi gagal membuat approval otomatis: ${appErr.message}`)
          close(); refresh()
          return
        }
      }

      setSaving(false)
      say(`Purchase Request ${data.pr_number} berhasil dibuat (${prItemsList.length} item) dan otomatis masuk Approval (menunggu persetujuan).`)
      close()
      refresh()
      return
    } else if (page === 'materials') {
      data = {
        name: form.name,
        category: form.category || null,
        kode: form.kode || null,
        code: form.kode || null,
        qty: form.qty || '0',
        satuan: form.satuan || 'Lembar',
        unit: form.satuan || 'Lembar'
      }
    } else if (page === 'vendors') {
      data = {
        name: form.name,
        phone: form.phone || null,
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
      <form className="dialog" onSubmit={save}>
        <div className="dialoghead">
          <h2>Tambah {labels[page]}</h2>
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
            {field('pr_number', 'Nomor PR', 'text', true)}
            <label>Prioritas
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="NORMAL">NORMAL</option>
                <option value="URGENT">URGENT</option>
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

              {/* IMPORT DARI EXCEL */}
              <div style={{ marginTop: '10px', padding: '8px 10px', background: '#f6f9f8', border: '1px dashed #b9cdc7', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="outline"
                  style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
                  onClick={() => downloadPrImportTemplate(allMaterials)}
                >
                  ⬇ Template Excel
                </button>
                <button
                  type="button"
                  style={{ fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  📤 Import Excel
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={handleImportFile}
                />
                <small style={{ color: '#5b6b66', flex: 1, minWidth: '180px' }}>
                  Import banyak item sekaligus. Kolom: Kode/Nama Material, Qty, Satuan.
                </small>
              </div>
              {importMsg && (
                <p style={{ fontSize: '11px', margin: '6px 0 0', padding: '6px 8px', background: '#f7faf9', borderRadius: '4px', border: '1px solid #e1e7e4' }}>
                  {importMsg}
                </p>
              )}

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
                        <tr key={it.material_id || idx} style={{ borderBottom: '1px solid #e1e7e4' }}>
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
            {field('kode', 'Kode Material', 'text', false)}
            {field('name', 'Nama Material', 'text', true)}
            {field('category', 'Kategori', 'text', false)}
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
            {field('phone', 'Nomor Telepon', 'text', false)}
            {field('contact', 'Kontak / Email', 'text', false)}
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
            {field('delivery_note', 'Surat Jalan / No. PO', 'text', true)}
            {field('invoice_no', 'No. Invoice', 'text', false)}
            <label>Tujuan Alokasi / Opsi Gudang
              <select value={form.receiving_status || 'SELESAI'} onChange={e => setForm({ ...form, receiving_status: e.target.value })}>
                <optgroup label="Status Normal">
                  <option value="SELESAI">Selesai (Langsung ke Proyek)</option>
                  <option value="MASUK_GUDANG">📦 Masukkan ke Gudang (Stok WS)</option>
                  <option value="OTW">OTW (Dalam Pengiriman)</option>
                  <option value="PENDING">Pending (Belum Dikirim)</option>
                </optgroup>
                <optgroup label="Pilihan Kendala">
                  <option value="RUSAK">⚠️ Rusak (Barang Rusak)</option>
                  <option value="RETUR">⚠️ Retur (Retur ke Vendor)</option>
                </optgroup>
              </select>
            </label>
            {field('received_date', 'Tanggal Diterima', 'date', false)}
            {field('notes', 'Catatan Penerimaan', 'text', false)}
          </>
        )}
        {page === 'handovers' && (
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