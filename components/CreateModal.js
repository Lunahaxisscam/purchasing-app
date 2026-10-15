import React, { useState, useMemo } from 'react'
import { labels, normalizeStatus, formatNominalInput, prefixForCategory } from '../lib/constants' 
import { renderCreateForm } from '../modules/shared/renderCreateForm'
import { dispatchSave } from '../modules/shared/saveDispatcher'

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

  // Alokasi kode final material (allocMaterialKode) kini berada di
  // modules/materials/save.js — shell tidak lagi menyimpan logika simpan.

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

  // ============================================================
  // SIMPAN PER MODUL (Fase 2 modularisasi)
  // Seluruh logika save() kini berada di modules/<modul>/save.js dan
  // dipanggil lewat dispatcher modules/shared/saveDispatcher.js.
  // Menambah/mengubah cara simpan satu modul = cukup edit folder modul itu.
  // Shell ini hanya menyediakan state form + ctx (kontrak dijaga Tech Lead).
  // ============================================================
  async function save(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)

    const { handled } = await dispatchSave(page, {
      page, form, isEdit, editRow, editItems, prItemsList,
      nextPrNum, allMaterials, allVendors,
      say, close, refresh, setSaving
    })
    if (!handled) {
      setSaving(false)
      say(`Modul ${page} tidak didukung untuk penyimpanan.`)
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