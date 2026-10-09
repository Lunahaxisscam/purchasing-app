import React, { useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { labels, statusOptions, receivingStatusOptions, normalizeStatus, buildReceivingNote, formatNominalInput, parseReceivingNote, prefixForCategory } from '../lib/constants' 

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
    category: '',
    kode: '',
    qty: '0',
    satuan: 'Lembar',
    harga_acuan: (editRow?.harga_acuan !== null && editRow?.harga_acuan !== undefined && editRow?.harga_acuan !== '')
      ? formatNominalInput(String(Math.round(Number(editRow.harga_acuan))))
      : '',
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
      data = {
        name: form.name,
        category: form.category || null,
        kode: newKode,
        code: newKode,
        qty: form.qty || '0',
        satuan: form.satuan || 'Lembar',
        unit: form.satuan || 'Lembar',
        harga_acuan: hargaDigits ? Number(hargaDigits) : null
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
            <label>Kategori
              <select
                required
                value={form.category || ''}
                onChange={e => setForm({ ...form, category: e.target.value })}
              >
                <option value="">-- Pilih Kategori --</option>
                {materialCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Kode Material (otomatis dari kategori)
              <input
                type="text"
                value={isEdit ? (editRow?.kode || editRow?.code || '') : (form.category ? nextMatKodeFor(form.category) : '— pilih kategori dulu —')}
                readOnly
                disabled
                style={{ background: '#f1f5f3', color: '#5b6b66', fontWeight: 600, cursor: 'not-allowed' }}
              />
            </label>
            {isEdit && (
              <small style={{ color: '#5b6b66', marginTop: '-6px' }}>
                Kode dibuat sekali saat material dibuat — mengubah kategori tidak mengubah kode.
              </small>
            )}
            {field('name', 'Nama Material', 'text', true)}
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
            <label>Acuan Harga (Rp)
              <input
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 250.000"
                value={form.harga_acuan || ''}
                onChange={e => setForm({ ...form, harga_acuan: formatNominalInput(e.target.value) })}
              />
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
            <label>Total Nominal Riil (Rp)
              <input
                type="text"
                inputMode="numeric"
                placeholder="Contoh: 450.000"
                value={form.nominal || ''}
                onChange={e => setForm({ ...form, nominal: formatNominalInput(e.target.value) })}
              />
            </label>
            <label>Foto / Link Nota Toko (URL Google Drive, link WA, foto, atau no. resi)
              <input
                type="text"
                placeholder="https://drive.google.com/… atau no. resi"
                value={form.nota_link || ''}
                onChange={e => setForm({ ...form, nota_link: e.target.value })}
              />
            </label>
            <label>Status Penerimaan
              <select value={form.receiving_status || 'NORMAL'} onChange={e => setForm({ ...form, receiving_status: e.target.value })}>
                <option value="NORMAL">✓ Normal</option>
                <option value="RETUR">⚠️ Retur</option>
                <option value="REFUND">⚠️ Refund</option>
              </select>
            </label>
            {field('received_date', 'Tanggal Diterima', 'date', false)}
            {field('notes', 'Catatan Penerimaan', 'text', false)}
          </>
        )}
        {page === 'handovers' && (
          <>
            <label>Penerimaan (Purchase)
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