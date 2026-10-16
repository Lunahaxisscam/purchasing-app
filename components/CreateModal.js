import React, { useState, useMemo, useRef } from 'react'
import { labels, normalizeStatus, formatNominalInput, prefixForCategory, parseHandoverNote } from '../lib/constants' 
// ============================================================
// ESTIMATOR HARGA PR (t_ac0b39c0) — resolver SAMA dgn modul Material
// (makeAcuanHelpers, t_090127ad) agar angka acuan konsisten antar modul.
// ============================================================
import { makePrEstimator, parsePriceValue, prEstimateTotals, isVendorEligible } from '../modules/requests/estimator'
import { materialUnit } from '../modules/materials/acuan'
import { renderCreateForm } from '../modules/shared/renderCreateForm'
import { dispatchSave } from '../modules/shared/saveDispatcher'

export default function Create({ page, allProjects = [], allMaterials = [], allVendors = [], existingRequests = [], allRequestsFull = [], editRow = null, editItems = [], allReceivings = [], allPrItems = [], allReceivingItems = [], close, refresh, say }) {
  const isEdit = !!editRow
  // Nomor PR berikutnya dihitung dari SEMUA PR (bukan hasil filter), dan selalu
  // lebih besar dari nomor tertinggi yang sudah ada agar tidak pernah dobel
  // walaupun ada PR yang dihapus (dimemoize agar tidak reduce berulang saat render form).
  const nextPrNum = useMemo(() => {
    const maxNum = (allRequestsFull || []).reduce((max, p) => {
      const n = parseInt(String(p.pr_number || '').replace(/^\D+/, ''), 10)
      return isFinite(n) && n > max ? n : max
    }, 0)
    return 'PR-' + String(maxNum + 1).padStart(3, '0')
  }, [allRequestsFull])

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
    // Prefill mode EDIT Handover (fitur bukti foto 15 Okt 2026): tanpa ini,
    // edit handover jatuh ke INSERT dengan receiving_id kosong → gagal
    // (kolom handovers.receiving_id NOT NULL). Foto bukti TIDAK di-prefill ke
    // form.bukti_foto — undefined = "belum disentuh", save.js mempertahankan
    // foto lama dari note; yang di-prefill hanya teks catatannya.
    // t_b418827b: receiving_id hanya KONTEKS prefill; save.js mode edit TIDAK
    // membacanya dari form (FK dikunci dari editRow). Status handover tidak
    // lagi diedit dari form (handover_status tidak ada — konfirmasi fisik).
    receiving_id: (isEdit && page === 'handovers') ? (editRow?.receiving_id || '') : '',
    receiving_status: 'NORMAL',
    received_date: new Date().toISOString().slice(0, 10),
    nominal: '',
    nota_link: '',
    received_by: (isEdit && page === 'handovers') ? (editRow?.received_by || '') : '',
    handover_date: (isEdit && page === 'handovers')
      ? (editRow?.handover_date || new Date().toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10),
    notes: (isEdit && page === 'handovers') ? parseHandoverNote(editRow?.note).extra : (editRow?.notes || '')
  })
  const [saving, setSaving] = useState(false)
  // Ref guard anti-dobel (lihat komentar di save()) — instan, tidak menunggu render.
  const savingRef = useRef(false)
  const [materialSearch, setMaterialSearch] = useState('')
  // ============================================================
  // FILTER KATEGORI MATERIAL — area pemilih item (steer 2 DAT, t_ac0b39c0)
  // ============================================================
  // Filter ini hanya menyaring KATALOG di dropdown pemilih material (irisan
  // dgn search). Ia BUKAN: mengubah kategori item master, mengaktifkan
  // kategori vendor lain, atau menimpa kategori rencana beli.
  const [materialCategoryFilter, setMaterialCategoryFilter] = useState('')

  // State untuk Item Material di PR (1 pengadaan bisa banyak item)
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
  const [itemQty, setItemQty] = useState('1')
  // Mode edit: item lama PR dimuat ke daftar supaya bisa diubah qty / ditambah / dihapus.
  // estimated_price yang sudah tersimpan dipertahankan apa adanya (SNAPSHOT):
  // mode edit TIDAK menghitung ulang dari histori terbaru (arahan snapshot
  // t_ac0b39c0). Hanya item BARU tanpa harga yang diisi otomatis saat ditambah.
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
    // FILTER KATEGORI (steer 2 DAT): irisan dgn search — membatasi KATALOG
    // dropdown pemilih saja, bukan mengubah data/relasi apapun.
    let pool = allMaterials
    const cat = String(materialCategoryFilter || '').trim()
    if (cat) {
      const norm = cat.toLowerCase()
      pool = pool.filter(m => String(m.category || '').trim().toLowerCase() === norm)
    }
    if (!materialSearch.trim()) return pool.slice(0, 100)
    const q = materialSearch.toLowerCase().trim()
    return pool.filter(m =>
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.kode || m.code || '').toLowerCase().includes(q)
    ).slice(0, 200)
  }, [allMaterials, materialSearch, materialCategoryFilter])

  // ============================================================
  // ESTIMATOR HARGA PR (t_ac0b39c0) — resolver SAMA dgn modul Material
  // (makeAcuanHelpers, t_090127ad) agar angka acuan konsisten antar modul.
  //
  // allPrItems memakai data halaman PENUH: resolver acuan hanya menerima
  // histori yang benar-benar diterima fisik (receiving_items qty>0 via FK
  // pr_item_id — BUKAN pencocokan nama), jadi estimasi PR yang belum
  // diterima tidak pernah masuk histori.
  // ============================================================
  const Est = useMemo(() => makePrEstimator({
    allPrItems, allReceivingItems, allReceivings, allVendors
  }), [allPrItems, allReceivingItems, allReceivings, allVendors])

  // Acuan utk material+vendor (dipakai addItemToPR & updateItemVendor).
  function estimateForItem(material, vendorId) {
    return Est.estimateFor(material, { vendorId: vendorId || null })
  }

  // Harga acuan utk material + vendor → format input rupiah ('' bila tidak
  // ada acuan). TIDAK PERNAH mengarang 0 — "Belum ada acuan" = string kosong.
  function acuanPriceFormatted(material, vendorId) {
    const est = estimateForItem(material, vendorId)
    if (est.status !== 'OK' || est.price === null) return { text: '', est }
    return { text: formatNominalInput(String(Math.round(est.price))), est }
  }

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
      // ============================================================
      // AUTO-FILL SAAT ITEM DITAMBAHKAN (steer 1 DAT, t_ac0b39c0):
      // estimasi harga WAJIB sudah terisi begitu item masuk daftar, KECUALI
      // material belum punya sumber harga valid (maka dibiarkan kosong +
      // label "Belum ada acuan" — BUKAN angka 0 palsu).
      // Satuan beda TIDAK dikonversi: resolver menolak entri unit mismatch.
      // ============================================================
      const auto = acuanPriceFormatted(mat, '')
      setPrItemsList([...prItemsList, {
        material_id: mat.id,
        kode: mat.kode || mat.code || '—',
        name: mat.name,
        category: mat.category || '—',
        satuan: mat.satuan || mat.unit || 'Pcs',
        qty: Number(itemQty) || 1,
        supplier_category: mat.category || '',
        vendor_id: '',
        estimated_price: auto.text,
        // Metadata acuan (tampil di form; BELUM tersimpan ke DB — lihat
        // docs/pr-estimasi-policy.md; hanya estimated_price yang persist).
        est_source: auto.est?.status === 'OK' ? auto.est.source : 'NONE',
        est_vendor: auto.est?.status === 'OK' ? auto.est.vendor : null,
        est_date: auto.est?.status === 'OK' ? auto.est.date : null,
        est_unit: materialUnit(mat),
        est_price_per: auto.est?.status === 'OK' ? auto.est.price : null,
        est_manual: false // false = harga milik auto-acuan; true = milik user
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
    // Validasi qty (arahan t_ac0b39c0): finite & > 0 — nilai invalid TIDAK
    // diam-diam jadi 1 saat mengetik (mis. menghapus isi field), validasi
    // ketat tetap dijalankan di save(); state hanya menampung teks mentah
    // agar input terasa normal.
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, qty: isFinite(q) && q > 0 ? q : val } : it))
  }

  // Rencana beli per item: supplier (kategori) + vendor
  function updateItemSupplier(idx, val) {
    setPrItemsList(prItemsList.map((it, i) => i === idx ? { ...it, supplier_category: val } : it))
  }
  function updateItemVendor(idx, val) {
    // ============================================================
    // RECALC SAAT GANTI VENDOR (steer 1 DAT, t_ac0b39c0):
    // - Bila harga belum di-override user (est_manual=false) → estimasi
    //   dihitung ulang: HISTORIS vendor terpilih diprioritaskan (material +
    //   satuan sama dijaga resolver), fallback acuan terbaru valid.
    // - Bila harga milik user (est_manual=true) → TIDAK ditimpa diam-diam.
    // - Vendor referensi TIDAK otomatis menjadi vendor pesanan; ia hanya
    //   sumber harga acuan yang ditampilkan.
    // ============================================================
    setPrItemsList(prItemsList.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, vendor_id: val }
      if (it.est_manual) return next
      const mat = allMaterials.find(m => m.id === it.material_id)
      if (!mat) return next
      const auto = acuanPriceFormatted(mat, val)
      return {
        ...next,
        estimated_price: auto.text,
        est_source: auto.est?.status === 'OK' ? auto.est.source : 'NONE',
        est_vendor: auto.est?.status === 'OK' ? auto.est.vendor : null,
        est_date: auto.est?.status === 'OK' ? auto.est.date : null,
        est_price_per: auto.est?.status === 'OK' ? auto.est.price : null
      }
    }))
  }
  // Estimasi harga: diformat ribuan saat mengetik; disimpan sebagai integer rupiah.
  // Mengetik = harga milik USER (sumber Manual) — auto-acuan tidak lagi
  // menimpanya saat vendor berubah (arahan "tanpa overwrite diam-diam").
  function updateItemPrice(idx, val) {
    setPrItemsList(prItemsList.map((it, i) => {
      if (i !== idx) return it
      const formatted = formatNominalInput(val)
      return { ...it, estimated_price: formatted, est_manual: parsePriceValue(formatted) !== null }
    }))
  }
  // "Pakai acuan" — kembalikan harga item ke acuan auto (per vendor bila ada,
  // selain itu acuan terbaru valid). Metadata ikut diperbarui.
  function applyAcuanToItem(idx) {
    setPrItemsList(prItemsList.map((it, i) => {
      if (i !== idx) return it
      const mat = allMaterials.find(m => m.id === it.material_id)
      if (!mat) return it
      const auto = acuanPriceFormatted(mat, it.vendor_id)
      return {
        ...it,
        estimated_price: auto.text,
        est_source: auto.est?.status === 'OK' ? auto.est.source : 'NONE',
        est_vendor: auto.est?.status === 'OK' ? auto.est.vendor : null,
        est_date: auto.est?.status === 'OK' ? auto.est.date : null,
        est_price_per: auto.est?.status === 'OK' ? auto.est.price : null,
        est_manual: false
      }
    }))
  }
  const priceDigits = (v) => {
    const d = String(v ?? '').replace(/[^\d]/g, '')
    return d ? Number(d) : null
  }
  // ============================================================
  // VENDOR ELIGIBLE (aturan bisnis DAT, komentar t_ac0b39c0):
  // vendor hanya eligible utk kategori yang diaktifkan eksplisit di master
  // Vendor (vendors.supplier_category). Kategori pembanding = kategori
  // KANONIK master material — BUKAN dropdown bebas user (izin tidak boleh
  // diakali lewat pilihan kategori rencana beli).
  // Vendor lama yang tersimpan tapi tidak eligible TETAP ditampilkan
  // (penanda tidak-eligible di form) agar seleksi tidak hilang diam-diam;
  // validasi keras dijalankan saat save().
  // ============================================================
  function vendorsForItem(it) {
    const all = allVendors || []
    const mat = allMaterials.find(m => m.id === it.material_id)
    const cat = mat ? (mat.category || '') : ''
    const list = cat
      ? all.filter(v => isVendorEligible(v, cat))
      : []
    // Pertahankan vendor tersimpan (jika ada) walau tidak eligible —
    // ditandai tidak-eligible, tidak dihapus diam-diam.
    if (it.vendor_id && !list.some(v => v.id === it.vendor_id)) {
      const cur = all.find(v => v.id === it.vendor_id)
      if (cur) list.push(cur)
    }
    return list
  }
  function vendorEligibleForItem(it, vendorId) {
    if (!vendorId) return true
    const v = (allVendors || []).find(x => x.id === vendorId)
    if (!v) return true // vendor tidak dikenal: dibiarkan, validasi di save
    const mat = allMaterials.find(m => m.id === it.material_id)
    return isVendorEligible(v, mat ? (mat.category || '') : '')
  }

  // TOTAL ESTIMASI PR (update otomatis saat tambah/hapus/ubah qty/acuan).
  const totals = useMemo(() => prEstimateTotals(prItemsList), [prItemsList])

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
  //
  // ANTI DOBEL (audit t_905e0e5a G13): state `saving` saja tidak cukup —
  // dua Enter cepat sebelum render ulang bisa lolos. Ref guard menutup
  // jendela itu; tombol submit juga disabled saat menyimpan.
  // ============================================================
  async function save(e) {
    e.preventDefault()
    if (savingRef.current || saving) return
    savingRef.current = true
    setSaving(true)

    try {
      const { handled } = await dispatchSave(page, {
        page, form, isEdit, editRow, editItems, prItemsList,
        nextPrNum, allMaterials, allVendors,
        // Estimator PR (t_ac0b39c0): save butuh data acuan utk validasi
        // kelayakan vendor & harga nonnegatif — resolver SAMA dgn form.
        allPrItems, allReceivingItems, allReceivings,
        say, close, refresh, setSaving
      })
      if (!handled) {
        setSaving(false)
        say(`Modul ${page} tidak didukung untuk penyimpanan.`)
      }
    } finally {
      savingRef.current = false
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
          // Estimator PR (t_ac0b39c0): acuan, kelayakan vendor & total estimasi
          prItemsList, materialSearch, setMaterialSearch,
          materialCategoryFilter, setMaterialCategoryFilter,
          selectedMaterialId, setSelectedMaterialId, filteredMaterials,
          itemQty, setItemQty, addItemToPR, removeItemFromPR, updateItemQty,
          updateItemSupplier, updateItemVendor, vendorsForItem, updateItemPrice,
          applyAcuanToItem, vendorEligibleForItem, totals,
          estimateForItem, formatRupiahInput: formatNominalInput
        })}
        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </div>
  )
}