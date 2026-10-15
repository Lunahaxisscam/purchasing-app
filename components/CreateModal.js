import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { labels, statusOptions, receivingStatusOptions, normalizeStatus, buildReceivingNote, formatNominalInput, parseReceivingNote, prefixForCategory } from '../lib/constants' 
import { renderCreateForm } from '../modules/shared/renderCreateForm'

export default function Create({ page, allProjects = [], allMaterials = [], allVendors = [], existingRequests = [], allRequestsFull = [], editRow = null, editItems = [], allReceivings = [], close, refresh, say }) {
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

  // Kode material mengikuti KATEGORI (PLY/HPL/WPC/HWF/KEL/ALM/BHP).
  // Preview di form dihitung dari data yang sudah dimuat; kode final dihitung
  // ulang saat simpan (RPC atomic bila ada -> fallback hitung dari DB) supaya
  // tidak dobel walau 2 user menyimpan bersamaan.
  const nextMatKodeFor = (category) => {
    const prefix = prefixForCategory(category)
    const re = new RegExp('^' + prefix + '-(\\d+)$')
    const maxNum = (allMaterials || []).reduce((max, m) => {
      const match = String(m.kode || m.code || '').match(re)
      const n = match ? parseInt(match[1], 10) : NaN
      return isFinite(n) && n > max ? n : max
    }, 0)
    return prefix + '-' + String(maxNum + 1).padStart(4, '0')
  }

  // Alokasi kode final saat simpan: coba RPC atomic dulu (bila fungsi DB
  // tersedia), lalu fallback hitung dari data terbaru di DB.
  async function allocMaterialKode(category) {
    const prefix = prefixForCategory(category)
    try {
      const { data: rpcKode, error: rpcErr } = await supabase.rpc('next_material_kode_cat', { p_category: category })
      if (!rpcErr && rpcKode) return String(rpcKode)
    } catch (e) { /* RPC belum tersedia — lanjut fallback */ }
    const { data: allMats, error: kodeErr } = await supabase.from('materials').select('kode')
    if (kodeErr) throw new Error(kodeErr.message)
    const re = new RegExp('^' + prefix + '-(\\d+)$')
    const maxNum = (allMats || []).reduce((max, m) => {
      const match = String(m.kode || '').match(re)
      const n = match ? parseInt(match[1], 10) : NaN
      return isFinite(n) && n > max ? n : max
    }, 0)
    return prefix + '-' + String(maxNum + 1).padStart(4, '0')
  }

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
    category: editRow?.category || '',
    kode: '',
    qty: (editRow?.qty !== null && editRow?.qty !== undefined) ? String(editRow.qty) : '0',
    satuan: editRow?.satuan || editRow?.unit || 'Lembar',
    harga_acuan: (editRow?.harga_acuan !== null && editRow?.harga_acuan !== undefined && editRow?.harga_acuan !== '')
      ? formatNominalInput(String(Math.round(Number(editRow.harga_acuan))))
      : '',
    // Sprint 1 — stok BHP (mode edit ikut ter-prefill).
    // Ditampilkan ala Indonesia (koma desimal): 1.5 -> '1,5'.
    current_stock: (editRow?.current_stock !== null && editRow?.current_stock !== undefined)
      ? String(editRow.current_stock).replace('.', ',')
      : '0',
    min_stock: (editRow?.min_stock !== null && editRow?.min_stock !== undefined)
      ? String(editRow.min_stock).replace('.', ',')
      : '0',
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
    receiving_status: 'NORMAL',
    received_date: new Date().toISOString().slice(0, 10),
    nominal: '',
    nota_link: '',
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
    vendor_id: it.vendor_id || '',
    estimated_price: (it.estimated_price !== null && it.estimated_price !== undefined && it.estimated_price !== '')
      ? formatNominalInput(String(Math.round(Number(it.estimated_price))))
      : ''
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
        vendor_id: '',
        estimated_price: (mat.harga_acuan !== null && mat.harga_acuan !== undefined && mat.harga_acuan !== '')
          ? formatNominalInput(String(Math.round(Number(mat.harga_acuan))))
          : ''
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
  // Estimasi harga: diformat ribuan saat mengetik; disimpan sebagai integer rupiah.
  function updateItemPrice(idx, val) {
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, estimated_price: formatNominalInput(val) } : it))
  }
  const priceDigits = (v) => {
    const d = String(v ?? '').replace(/[^\d]/g, '')
    return d ? Number(d) : null
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
    if (saving) return
    setSaving(true)

    const tableMap = {
      projects: 'projects',
      vendors: 'vendors',
      materials: 'materials',
      requests: 'purchase_requests',
      receivings: 'receivings',
      handovers: 'handovers'
    }
    const table = tableMap[page]
    if (!table) {
      setSaving(false)
      say(`Modul ${page} tidak didukung untuk penyimpanan.`)
      return
    }

    try {
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
        for (let idx = 0; idx < prItemsList.length; idx++) {
          const it = prItemsList[idx]
          if (it.id) {
            const { error } = await supabase.from('pr_items').update({
              quantity: it.qty,
              unit: it.satuan,
              supplier_category: it.supplier_category || null,
              vendor_id: it.vendor_id || null,
              estimated_price: priceDigits(it.estimated_price),
              sort_order: idx
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
              vendor_id: it.vendor_id || null,
              estimated_price: priceDigits(it.estimated_price),
              sort_order: idx
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

      // PR baru dibuat sebagai DRAFT; masuk modul Approval lewat tombol ✓ Selesai.
      // Nomor PR diambil atomic dari DB (advisory lock) agar tidak dobel saat
      // dua user membuka form bersamaan; fallback ke nilai tampilan bila RPC gagal.
      let prNumberFinal = form.pr_number || nextPrNum
      {
        const { data: rpcPr, error: rpcPrErr } = await supabase.rpc('next_pr_number')
        if (!rpcPrErr && rpcPr) prNumberFinal = String(rpcPr)
      }
      data = {
        project_id: form.project_id || null,
        title: form.title,
        pr_number: prNumberFinal,
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
        const itemRecords = prItemsList.map((it, idx) => ({
          pr_id: insertedPR.id,
          material_id: it.material_id,
          item_name: it.name,
          kode: it.kode,
          unit: it.satuan,
          quantity: it.qty,
          status: 'PENDING_APPROVAL',
          supplier_category: it.supplier_category || null,
          vendor_id: it.vendor_id || null,
          estimated_price: priceDigits(it.estimated_price),
          sort_order: idx
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
      // Kode material otomatis mengikuti KATEGORI (PLY-0001, HWF-0124, dst).
      // Kategori wajib dipilih supaya kode tidak jatuh ke prefix cadangan.
      if (!form.category) {
        setSaving(false)
        say('Pilih Kategori dulu — kode material dibuat dari kategori.')
        return
      }
      let newKode = (isEdit && (editRow?.kode || editRow?.code)) || ''
      if (!newKode) {
        try {
          newKode = await allocMaterialKode(form.category)
        } catch (err) {
          setSaving(false)
          say(`Gagal membuat kode material: ${err.message}`)
          return
        }
      }
      // Acuan harga disimpan sebagai INTEGER rupiah (bukan desimal) supaya
      // round-trip edit tidak pernah menggeser nilai; kosong = null.
      const hargaDigits = String(form.harga_acuan ?? '').replace(/[^\d]/g, '').slice(0, 15)
      // Sprint 1 — stok BHP: current_stock & min_stock numeric (>= 0).
      // Parser format Indonesia: '1.234,5' / '1234,5' / '1.234' → angka benar.
      // (Input type=text agar tidak dinormalisasi browser — fix review F3.)
      const stokNum = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return 0
        // Buang titik ribuan, ganti koma desimal → titik; hanya digit/titik.
        const cleaned = s.replace(/\./g, '').replace(',', '.')
        if (!/^\d+(\.\d+)?$/.test(cleaned)) return 0
        const n = Number(cleaned)
        return isFinite(n) && n >= 0 ? n : 0
      }
      data = {
        name: form.name,
        category: form.category || null,
        kode: newKode,
        code: newKode,
        qty: form.qty || '0',
        satuan: form.satuan || 'Lembar',
        unit: form.satuan || 'Lembar',
        harga_acuan: hargaDigits ? Number(hargaDigits) : null,
        current_stock: stokNum(form.current_stock),
        min_stock: stokNum(form.min_stock)
      }
      // Mode EDIT material: UPDATE baris yang ada — bukan insert baru.
      // (Sebelumnya edit material ikut jatuh ke INSERT → gagal unique kode
      // atau membuat duplikat; diperbaiki di Sprint 1.)
      if (isEdit && editRow?.id) {
        const { error: upMatErr } = await supabase.from('materials').update(data).eq('id', editRow.id)
        setSaving(false)
        if (upMatErr) { say(upMatErr.message); return }
        say(`Material ${newKode} berhasil diperbarui.`)
        close(); refresh()
        return
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
      const st = String(form.receiving_status || 'NORMAL').toUpperCase()
      data = {
        purchase_request_id: form.pr_id || null,
        project_id: form.project_id || null,
        delivery_note: form.delivery_note,
        invoice_no: form.invoice_no || null,
        status: st,
        kendala: st === 'RETUR' ? 'RETUR' : (st === 'REFUND' ? 'REFUND' : null),
        received_date: form.received_date || new Date().toISOString().slice(0, 10),
        note: buildReceivingNote({ nominal: form.nominal, nota: form.nota_link, extra: form.notes })
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

    let { error } = await supabase.from(table).insert(data)
    // Retry sekali bila kode/nomor bentrok (unique index) karena balapan sesi lain:
    // ambil nomor baru dari RPC atomic, lalu insert ulang.
    if (error && String(error.code) === '23505') {
      let retryKode = null
      if (page === 'materials') {
        try { retryKode = await allocMaterialKode(form.category) } catch (e) { retryKode = null }
        if (retryKode) data = { ...data, kode: retryKode, code: retryKode }
      } else if (page === 'requests') {
        const { data: rp } = await supabase.rpc('next_pr_number')
        if (rp) data = { ...data, pr_number: String(rp) }
      }
      if (retryKode || page === 'requests') {
        const retry = await supabase.from(table).insert(data)
        error = retry.error
      }
    }
    setSaving(false)
    if (error) {
      say(error.message)
      return
    }
    say(`${labels[page]} berhasil ditambahkan.`)
    close()
    refresh()
    } catch (err) {
      setSaving(false)
      say(`Gagal menyimpan: ${err.message}`)
    }
  }

  return (
    <div className="modal">
      <form className={`dialog${page === 'requests' ? ' dialog-wide' : ''}`} onSubmit={save}>
        <div className="dialoghead">
          <h2>{isEdit ? 'Edit' : 'Tambah'} {labels[page]}</h2>
          <button type="button" className="icon" onClick={close}>×</button>
        </div>
        {/* ============================================================
            FORM BODY PER MODUL (Fase 1 modularisasi)
            Seluruh field form kini berada di modules/<modul>/form.jsx dan
            dirender lewat dispatcher modules/shared/renderCreateForm.jsx.
            Menambah/mengubah field satu modul = cukup edit folder modul itu.
            ============================================================ */}
        {renderCreateForm(page, {
          form, setForm, field, isEdit, editRow,
          allProjects, allMaterials, allVendors, allRequestsFull, allReceivings,
          materialCategories, nextMatKodeFor, formatNominalInput,
          prItemsList, materialSearch, setMaterialSearch,
          selectedMaterialId, setSelectedMaterialId, filteredMaterials,
          itemQty, setItemQty, addItemToPR, removeItemFromPR, updateItemQty,
          updateItemSupplier, updateItemVendor, vendorsForItem, updateItemPrice
        })}
        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </div>
  )
}