import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Login from '../components/Login'
import Sidebar from '../components/Sidebar'
import Dashboard from '../components/Dashboard'
import Finance from '../components/Finance'
import Module from '../components/ModuleView'
import { labels, normalizeStatus, orderSpecFor } from '../lib/constants' 

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
  const [actionBusy, setActionBusy] = useState(false)
  const [noteModal, setNoteModal] = useState(null)
  const [noteText, setNoteText] = useState('')
  // Role user: 'admin' (semua modul + Finance) atau 'user' (tanpa Finance).
  // Diambil dari tabel profiles (kolom role) saat sesi aktif; default 'user'
  // supaya kalau gagal baca, modul admin tidak pernah tampil ke non-admin.
  const [role, setRole] = useState('user') 

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
    const up = String(newStatus || '').toUpperCase()
    const kendala = up === 'RETUR' ? 'RETUR' : (up === 'REFUND' ? 'REFUND' : null)

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
  async function moveToWarehouse(receiving) {
    if (!supabase || actionBusy) return
    const label = receiving.invoice_no || receiving.delivery_note || 'Penerimaan'
    if (receiving.masuk_gudang) { setNotice('Barang penerimaan ini sudah masuk Stok Gudang.'); return }

    const items = (rows.receiving_items || []).filter(it => it.receiving_id === receiving.id)
    if (!items.length) {
      setNotice('Penerimaan ini belum punya item — tandai item "Sudah Diterima" dulu sebelum masuk gudang.')
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
  async function sendToTukang(receiving) {
    if (!supabase || actionBusy) return
    const label = receiving.invoice_no || receiving.delivery_note || 'Penerimaan'
    if (receiving.alokasi === 'KE_TUKANG' || receiving.tukang_at) { setNotice('Barang penerimaan ini sudah dikirim ke tukang.'); return }
    const receiverInput = window.prompt(`Kirim barang dari "${label}" langsung ke tukang?\nMasukkan nama tukang / penerima barang:`, 'Tukang')
    if (receiverInput === null) return
    const receivedBy = receiverInput.trim() || 'Tukang'

    const items = (rows.receiving_items || []).filter(it => it.receiving_id === receiving.id)
    const itemDesc = items
      .filter(it => Number(it.quantity_received || 0) > 0)
      .map(it => `${it.item_name} ${Number(it.quantity_received || 0)} ${it.unit || ''}`.replace(/\s+/g, ' ').trim())
      .join('; ')

    setActionBusy(true)
    try {
      let handledByRpc = false
      try {
        const { data, error } = await supabase.rpc('send_receiving_to_tukang', { p_receiving_id: receiving.id, p_label: label })
        if (!error && data && data.ok) {
          handledByRpc = true
          // Perbarui received_by pada handover bila sebelumnya terisi default
          await supabase.from('handovers').update({ received_by: receivedBy }).eq('receiving_id', receiving.id).eq('received_by', 'Belum ditentukan')
        }
      } catch (rpcErr) {
        // Fallback ke operasi client-side jika RPC tidak tersedia
      }

      if (!handledByRpc) {
        const now = new Date().toISOString()
        const { error: hoErr } = await supabase.from('handovers').insert({
          receiving_id: receiving.id,
          project_id: receiving.project_id || null,
          received_by: receivedBy,
          handover_date: now.slice(0, 10),
          status: 'DRAFT',
          note: `Barang dari penerimaan ${label} dikirim langsung ke tukang.${itemDesc ? ` Item: ${itemDesc}.` : ''}`
        })
        if (hoErr) { setNotice(`Gagal membuat handover: ${hoErr.message}`); return }

        const { error } = await supabase.from('receivings').update({ alokasi: 'KE_TUKANG', tukang_at: now }).eq('id', receiving.id)
        if (error) { setNotice(`Handover dibuat, tapi gagal update alokasi: ${error.message}`); loadAll(); return }
      }

      setNotice(`Barang "${label}" dikirim ke tukang (${receivedBy}) dan masuk ke modul Handover.`)
      loadAll()
    } catch (err) {
      setNotice(`Terjadi kesalahan saat kirim ke tukang: ${err.message}`)
      loadAll()
    } finally {
      setActionBusy(false)
    }
  }

  // Handover: tandai "sudah diserahkan". Waktu diserahkan (diserahkan_at) disimpan
  // untuk report total cost aktual per project — belum ditampilkan di UI.
  async function markHandoverDelivered(handover) {
    if (!supabase) return
    const ok = window.confirm('Tandai serah terima ini sebagai SUDAH DISERAHKAN?')
    if (!ok) return
    const { error } = await supabase.from('handovers').update({
      status: 'CONFIRMED',
      diserahkan_at: new Date().toISOString()
    }).eq('id', handover.id)
    if (error) { setNotice(`Gagal menandai sudah diserahkan: ${error.message}`); return }
    setNotice('Serah terima ditandai sudah diserahkan.')
    loadAll()
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
    if (!supabase || actionBusy) return
    const now = new Date().toISOString()
    const label = decision === 'APPROVED' ? 'DISETUJUI' : (decision === 'REJECTED' ? 'DITOLAK' : 'DIMINTA REVISI')
    const baseNote = decision === 'APPROVED' ? 'Disetujui oleh Direksi / PM' : (decision === 'REJECTED' ? 'Ditolak oleh Direksi / PM' : 'Diminta revisi oleh Direksi / PM')
    const note = userNote ? `${baseNote} — ${userNote}` : baseNote

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
    if (!supabase) return
    setNoteText('')
    setNoteModal({ approval, decision: 'REVISI' })
  }

  // Setujui material satu per satu (dipakai di modul Approval, panel Material).
  // Barang yang disetujui otomatis masuk ke modul Purchase (RPC atomic).
  // Guard actionBusy mencegah dobel-klik; guard sebenarnya tetap di DB (advisory lock).
  async function approveItem(prItem) {
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
  async function markPrItemOrdered(prItem) {
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
  // LANGKAH 1 — CEK FISIK item receiving (qty terima + catatan).
  // Fungsi ini TIDAK membuat tiket handover: alokasi akhir (Gudang/Tukang)
  // dilakukan terpisah di Langkah 2 pada level penerimaan (moveToWarehouse /
  // sendToTukang). Barang yang dicek bisa saja dialokasikan ke Gudang,
  // jadi jangan pernah auto-insert ke tabel handovers di sini.
  // ============================================================
  async function markReceivingItemReceived(recItem) {
    if (!supabase) return
    const now = new Date().toISOString()
    const qtyInput = Number(recItem.quantity_received || 0)
    // Qty yang dipakai: isian user bila diisi, kalau kosong pakai qty yang dipesan di PR
    const prItemForQty = (rows.pr_items || []).find(p => p.id === recItem.pr_item_id)
    const orderedQty = Number(prItemForQty?.quantity || 0)
    const qtyFinal = qtyInput > 0 ? qtyInput : orderedQty

    if (!(qtyFinal > 0)) {
      setNotice(`Isi dulu jumlah barang yang benar-benar diterima untuk "${recItem.item_name}" sebelum cek fisik.`)
      return
    }

    try {
      const { error: riErr } = await supabase.from('receiving_items')
        .update({ quantity_received: qtyFinal, note: `DITERIMA ${now.slice(0, 10)}` })
        .eq('id', recItem.id)
      if (riErr) { setNotice(`Gagal update item: ${riErr.message}`); return }

      const unit = recItem.unit || ''
      if (orderedQty > 0 && qtyFinal < orderedQty) {
        setNotice(`Cek fisik "${recItem.item_name}": PARSIAL — diterima ${qtyFinal} ${unit} dari ${orderedQty} dipesan (sisa ${orderedQty - qtyFinal}). Alokasi akhir dilakukan di Langkah 2 pada baris penerimaan.`)
      } else {
        setNotice(`Cek fisik "${recItem.item_name}": LENGKAP — diterima ${qtyFinal} ${unit}${orderedQty > 0 ? ` dari ${orderedQty} dipesan` : ''}. Lanjutkan alokasi akhir (Ke Gudang / Ke Tukang) di Langkah 2.`)
      }
      loadAll()
    } catch (err) {
      setNotice(`Terjadi kesalahan saat memproses penerimaan item: ${err.message}`)
      loadAll()
    }
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
    const typeLabel = pageTarget === 'vendors' ? 'Vendor' : (pageTarget === 'materials' ? 'Material' : (pageTarget === 'requests' ? 'Purchase Request' : (pageTarget === 'receivings' ? 'Purchase' : (pageTarget === 'handovers' ? 'Serah Terima' : (pageTarget === 'projects' || pageTarget === 'past_projects' ? 'Project' : 'Data')))))
    const itemName = item.invoice_no || item.pr_number || item.delivery_note || item.received_by || item.name || item.kode || item.code || 'Item'
    const ok = window.confirm(`Apakah Anda yakin ingin menghapus ${typeLabel.toLowerCase()} "${itemName}"?`)
    if (!ok) return

    const tableMap = {
      vendors: 'vendors',
      materials: 'materials',
      requests: 'purchase_requests',
      receivings: 'receivings',
      handovers: 'handovers',
      approvals: 'approval_steps',
      projects: 'projects',
      past_projects: 'projects'
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

  return (
    <main className="shell">
      <Sidebar page={page} setPage={setPage} session={session} logout={logout} role={role} />
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
            role={role}
          />
        ) : page === 'finance' ? (
          role === 'admin' ? (
            <Finance rows={rows} />
          ) : (
            <div className="panel empty">Halaman ini khusus administrator.</div>
          )
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
            onSendToTukang={sendToTukang}
            onMarkHandoverDelivered={markHandoverDelivered}
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
