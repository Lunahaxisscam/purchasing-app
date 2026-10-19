// ============================================================
// modules/requests/form.jsx — form Tambah/Edit Purchase Request (PR)
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/CreateModal.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Field form {label} diubah
// HANYA di file ini.
//
// Kontrak: formBody(ctx) mengembalikan potongan JSX (fragment) yang dirender
// shell CreateModal. ctx berisi form, setForm, field, isEdit, editRow, dst.
// yang disediakan shell — lihat components/CreateModal.js.
//
// ============================================================
// t_cde1b8ad (arahan DAT — "Ringkas alur PR & Purchase") — FORM PR RINGKAS
// ============================================================
// PR = PERMINTAAN BARANG dari lapangan. Isinya cukup:
//   Project · Judul · Prioritas · Material · Qty · Estimasi Harga.
// Yang DIHILANGKAN dari tampilan utama (bukan dihapus dari data):
//   - Pemilih "Rencana beli: Kategori + Vendor" per item  →  dipindah ke
//     modul Purchase (di sana admin memilih toko AKTUAL saat mencatat nota).
//     Kontrolnya TIDAK dibuang: ia dilipat di dalam <details> "Rencana toko
//     (opsional)" supaya (a) data vendor_id/supplier_category yang sudah
//     tersimpan tetap terlihat & bisa dikoreksi, dan (b) PR lama yang
//     vendornya tidak lagi eligible tetap bisa disimpan (kalau kontrol ini
//     dihilangkan total, validasi save() jadi jalan buntu yang tak bisa
//     diperbaiki user — lihat modules/requests/save.js).
//   - Catatan Tambahan  →  dilipat, default TERTUTUP (opsional).
// SKEMA DB TIDAK BERUBAH: pr_items.vendor_id & supplier_category tetap
// ditulis apa adanya oleh save.js (nilai lama dipertahankan; item baru
// menyimpan null karena PR tidak lagi menanyakan toko).
// ============================================================
// ESTIMATOR HARGA PR (t_ac0b39c0 — arahan DAT)
// ============================================================
// - Harga estimasi OTOMATIS terisi SAAT item dipilih/ditambahkan (di shell
//   CreateModal.addItemToPR via resolver acuan t_090127ad). Item tanpa
//   sumber harga valid tampil kosong + label "Belum ada acuan" — TIDAK
//   PERNAH diisi 0 palsu.
// - Setiap baris item menampilkan: harga per satuan (input), sumber acuan
//   (✅ Historis / 📍 Master / ✍️ Manual), vendor referensi & tanggal bila
//   nyata tersedia, subtotal qty × harga, dan tombol "Pakai acuan" bila
//   harga sudah di-override user.
// - Ganti vendor (di lipatan "Rencana toko") menghitung ulang harga BILA
//   harga belum milik user (est_manual) — tidak pernah menimpa input user
//   diam-diam.
// - Footer: Total Estimasi PR (Σ qty × harga satuan). Item tanpa acuan
//   TIDAK dihitung 0 — total diberi label "belum lengkap" + daftar item
//   yang belum punya acuan.
// - SATUAN & SNAPSHOOT: satuan item mengikuti master material (tanpa
//   konversi tanpa faktor valid). Harga yang tersimpan = pr_items
//   .estimated_price (snapshot saat save); sumber/vendor/tanggal acuan
//   BELUM tersimpan (lihat docs/pr-estimasi-policy.md).
// ============================================================
import React from 'react'
import { rupiah } from '../../lib/constants'

// Sumber harga item PR utk form: estimasi harga yang DIKETIK USER = sumber
// "Manual"; yang terisi otomatis memakai sumber acuan dari resolver
// (HISTORIS/MASTER/PR_ESTIMATE) — metadata disimpan di field est_* pada item.
function sourceLabelFor(it) {
  if (it.est_manual) {
    return (
      <span className="acuan-badge acuan-badge-manual" title="Harga diketik manual oleh user — tidak akan ditimpa otomatis">
        ✍️ Manual
      </span>
    )
  }
  if (it.est_source === 'HISTORIS') {
    return (
      <span className="acuan-badge acuan-badge-historis" title="Harga beli AKTUAL terverifikasi dari nota/purchase line valid (satuan sama, tanpa ongkir/admin)">
        ✅ Historis (pembelian)
      </span>
    )
  }
  if (it.est_source === 'MASTER') {
    return (
      <span className="acuan-badge acuan-badge-master" title="Acuan harga dari master material (tanpa tanggal/vendor)">
        📍 Master
      </span>
    )
  }
  if (it.est_source === 'PR_ESTIMATE') {
    // P1 t_e88c28fb: harga dari estimasi PR terdahulu (barangnya sudah
    // diterima) TIDAK boleh berlabel "Historis/Terealisasi" — barang
    // diterima tidak membuktikan estimasi = harga beli aktual.
    return (
      <span className="acuan-badge acuan-badge-estimate" title="Harga dari estimasi PR terdahulu yang barangnya sudah diterima — BUKAN harga beli aktual (nota bisa berbeda)">
        ⚠️ Estimasi PR terdahulu
      </span>
    )
  }
  // Item ber-harga tanpa metadata sumber = snapshot tersimpan yang di-reopen
  // (metadata sumber belum tersimpan — skema price_* menunggu keputusan DAT).
  // BUKAN "Belum ada acuan": harganya jelas ada, hanya sumbernya yang tak
  // tercatat. Jangan mengklaim sumber spesifik.
  const hasSavedPrice = it.estimated_price !== null && it.estimated_price !== undefined && String(it.estimated_price) !== ''
  if (hasSavedPrice) {
    return (
      <span className="acuan-badge" style={{ background: '#eef4f0', color: '#33544a', border: '1px solid #cfe0d6' }} title="Harga tersimpan (snapshot) — metadata sumber acuan belum tersimpan (menunggu keputusan skema)">
        📌 Tersimpan (snapshot)
      </span>
    )
  }
  return (
    <span className="acuan-badge" style={{ background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }} title="Belum ada sumber harga valid">
      Belum ada acuan
    </span>
  )
}

// Nama vendor tersimpan per item (utk ringkasan lipatan "Rencana toko").
// Murni tampilan: membaca state form, tidak menulis apa pun.
function vendorNameOf(it, allVendors) {
  if (!it.vendor_id) return ''
  const v = (allVendors || []).find(x => x.id === it.vendor_id)
  return v?.name || ''
}

export function formBody(ctx) {
  const {
    form, setForm, allProjects, allMaterials, allVendors,
    prItemsList, materialSearch, setMaterialSearch,
    materialCategoryFilter, setMaterialCategoryFilter,
    selectedMaterialId, setSelectedMaterialId, filteredMaterials,
    itemQty, setItemQty, addItemToPR, removeItemFromPR, updateItemQty,
    updateItemSupplier, updateItemVendor, vendorsForItem, updateItemPrice,
    applyAcuanToItem, vendorEligibleForItem, totals,
    materialCategories, isEdit, inputMode, setInputMode, fieldFormState
  } = ctx

  // Kategori utk filter katalog — daftar kategori master material.
  const catOptions = materialCategories || []
  // Item yang belum punya acuan/harga (utk label "belum lengkap").
  const missingPrice = (prItemsList || []).filter(it => {
    const d = String(it.estimated_price ?? '').replace(/[^\d]/g, '')
    return !d
  })
  // Item yang masih menyimpan rencana toko (data lama) — dipakai utk
  // memberi tahu bahwa nilai itu DIPERTAHANKAN, bukan dihapus.
  const itemsWithToko = (prItemsList || []).filter(it => it.vendor_id)
  const notesText = String(form.notes || '')

  return (
    <>
      {/* ============================================================
          t_cde1b8ad — GAYA TER-SCOPE untuk tabel item PR (styled-jsx)
          ============================================================
          styles/globals.css punya aturan MOBILE global ber-!important:
            @media (max-width: 900px) {
              table { min-width: 820px }
              th { padding: 12px 14px !important; white-space: nowrap !important }
              td { padding: 12px 14px !important }
            }
          Tabel item PR jadi 820px dan harus digeser ke samping di HP.
          File CSS bersama itu bukan milik card ini, jadi penawarnya ditaruh
          di sini dan HANYA berlaku untuk tabel di dalam .material-picker-box
          pada form PR. Kolom tetap 6 (kode/nama/qty/satuan/subtotal/aksi),
          hanya padding & nowrap-nya yang dilonggarkan agar nama material
          boleh wrap — informasi tidak ada yang dihapus. */}
      <style jsx>{`
        :global(.material-picker-box .pr-items-table) {
          min-width: 0 !important;
          width: 100% !important;
          table-layout: auto !important;
        }
        :global(.material-picker-box .pr-items-table th),
        :global(.material-picker-box .pr-items-table td) {
          padding: 4px 5px !important;
          white-space: normal !important;
          overflow-wrap: anywhere;
          font-size: 11px !important;
        }
        :global(.material-picker-box .pr-items-table td.pr-num) {
          white-space: nowrap !important;
          text-align: right;
        }
        :global(.material-picker-box .pr-items-table input[type="number"]) {
          min-width: 0 !important;
          width: 48px !important;
        }
      `}</style>

      {/* ============================================================
          KONTEKS ALUR (t_cde1b8ad): satu kalimat supaya user paham PR
          berhenti di permintaan barang — toko dipilih saat Purchase.
          ============================================================ */}
      <div
        className="pr-form-note"
        style={{
          background: '#f4f7f5', border: '1px solid #dde7e1', borderRadius: '8px',
          padding: '7px 10px', fontSize: '11.5px', color: '#485653', lineHeight: 1.45,
          marginBottom: '8px'
        }}
      >
        🧾 <b>PR = permintaan barang.</b> Cukup isi proyek, judul, prioritas, material, qty &
        estimasi. <b>Toko/vendor aktual dipilih di modul Purchase</b> saat nota dicatat.
      </div>

      {/* Banner / switch ke Form Lapangan bila baru tambah PR */}
      {!isEdit && setInputMode && (
        <div
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: fieldFormState?.seeded ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${fieldFormState?.seeded ? '#bbf7d0' : '#e2e8f0'}`,
            borderRadius: '8px', padding: '6px 10px', fontSize: '11px',
            marginBottom: '8px', flexWrap: 'wrap', gap: '6px'
          }}
        >
          <span style={{ color: fieldFormState?.seeded ? '#166534' : '#475569', fontWeight: 500 }}>
            {fieldFormState?.seeded
              ? `✓ Data dari Form Lapangan berhasil dimuat (${prItemsList.length} item). Anda dapat memeriksa atau menambah item.`
              : `📋 Tersedia mode input cepat berbasis Form Lapangan (template PDF).`}
          </span>
          <button
            type="button"
            className="outline btn-switch-field-form"
            style={{ fontSize: '10.5px', padding: '2px 8px' }}
            onClick={() => setInputMode('field-form')}
          >
            {fieldFormState?.seeded ? '← Kembali ke Form Lapangan' : 'Buka Form Lapangan 📋'}
          </button>
        </div>
      )}

      {/* Header form SATU BARIS desktop (steer DAT t_ac0b39c0): Project (kiri
          ~40%) + Judul Kebutuhan (kanan ~60%) — tetap DUA field terpisah,
          tidak digabung input. Mobile (<=640px) stack agar readable. */}
      <div className="pr-header-row">
        <label style={{ margin: 0 }}>Project
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
        <label style={{ margin: 0 }}>
          Judul Kebutuhan
          <input
            type="text"
            value={form.title || ''}
            onChange={e => setForm({ ...form, title: e.target.value })}
            required
          />
        </label>
      </div>
      <label>Prioritas
        <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
          <option value="NORMAL">Standard</option>
          <option value="URGENT">Prioritas</option>
        </select>
      </label>

      {/* ITEM MATERIAL — 1 pengadaan bisa banyak item.
          t_cde1b8ad: minWidth:0 pada kotak ini + kontainer item wajib — tanpa
          itu lebar min-content tabel item (≈820px) merambat ke grid dialog dan
          membuat dialog bergulir horizontal di layar sempit. */}
      <div className="material-picker-box" style={{ minWidth: 0, maxWidth: '100%' }}>
        <label style={{ fontWeight: 600, color: '#1f3a34', marginBottom: '6px', display: 'block' }}>
          📦 Item Material ({prItemsList.length} item)
        </label>

        {/* ============================================================
            AREA PEMILIH ITEM (steer 2 DAT, t_ac0b39c0):
            baris 1 = search (diperkecil, desktop) + filter kategori sejajar;
            baris 2 = dropdown material + Qty + tombol Tambah.
            Mobile (<=640px): stack vertikal nyaman dgn lebar penuh.
            Filter kategori hanya menyaring KATALOG pemilih — bukan mengubah
            kategori item master / izin vendor.
            ============================================================ */}
        <div className="pr-picker-row-2" style={{ marginBottom: '8px' }}>
          <label style={{ margin: 0, fontSize: '12px' }}>Pilih dari Master Material ({allMaterials.length})
            <input
              type="text"
              placeholder="🔍 Cari nama / kode material…"
              value={materialSearch}
              onChange={e => setMaterialSearch(e.target.value)}
              style={{ marginBottom: '4px' }}
            />
          </label>
          <label style={{ margin: 0, fontSize: '12px' }}>Kategori
            <select
              value={materialCategoryFilter || ''}
              onChange={e => setMaterialCategoryFilter(e.target.value)}
              style={{ marginBottom: '0px' }}
              title="Saring katalog material di dropdown — tidak mengubah data apapun"
            >
              <option value="">Semua Kategori</option>
              {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="pr-picker-row-3">
          <label style={{ margin: 0, fontSize: '12px' }}>
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
            {(materialSearch || materialCategoryFilter) && (
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
          <React.Fragment>
          {/* Total + warning + disclaimer DI LUAR area scroll — Total Estimasi
              PR wajib selalu terlihat tanpa scroll daftar item (review run 86).
              t_cde1b8ad: overflowX juga di-scroll di dalam kotaknya sendiri
              supaya tabel item tidak pernah mendorong lebar body (mobile). */}
          <div style={{ marginTop: '10px', maxHeight: '240px', overflowY: 'auto', overflowX: 'auto' }}>
            <table className="pr-items-table" style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#eef3f1', textAlign: 'left' }}>
                  <th style={{ padding: '4px 6px' }}>Kode</th>
                  <th style={{ padding: '4px 6px' }}>Nama Material</th>
                  <th style={{ padding: '4px 6px', width: '60px' }}>Qty</th>
                  <th style={{ padding: '4px 6px', width: '60px' }}>Satuan</th>
                  <th style={{ padding: '4px 6px', width: '96px', textAlign: 'right' }}>Subtotal</th>
                  <th style={{ padding: '4px 6px', width: '40px', textAlign: 'center' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {prItemsList.map((it, idx) => {
                  const digits = String(it.estimated_price ?? '').replace(/[^\d]/g, '')
                  const unitPrice = digits ? Number(digits) : null
                  const qtyNum = Number(it.qty)
                  const subtotal = (unitPrice !== null && isFinite(qtyNum) && qtyNum > 0)
                    ? Math.round(unitPrice * qtyNum)
                    : null
                  const vendorNotEligible = !vendorEligibleForItem(it, it.vendor_id)
                  const savedVendor = vendorNameOf(it, allVendors)
                  return (
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
                    <td className="pr-num" style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {subtotal !== null
                        ? <b style={{ color: '#137333' }}>{rupiah(subtotal)}</b>
                        : <span className="muted">—</span>}
                    </td>
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
                    <td colSpan={6} style={{ padding: '3px 6px 6px', background: '#fafcfb' }}>
                      {/* ===== BARIS 1 (selalu terlihat): ESTIMASI HARGA =====
                          Hanya harga & acuan yang tampil di muka — ini inti PR.
                          t_cde1b8ad: pemilih Kategori/Vendor TIDAK lagi di sini. */}
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ margin: 0, fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: '#485653' }}>
                          💰 Estimasi Harga
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Rp…"
                            value={it.estimated_price || ''}
                            onChange={e => updateItemPrice(idx, e.target.value)}
                            style={{ width: '96px', padding: '2px 4px', fontSize: '10px' }}
                          />
                        </label>
                        <button
                          type="button"
                          className="outline"
                          style={{ padding: '2px 6px', fontSize: '10px', fontWeight: 600 }}
                          onClick={() => applyAcuanToItem(idx)}
                          title="Isi ulang harga dari acuan terbaru (histori vendor terpilih → acuan terbaru)"
                        >
                          ↺ Pakai acuan
                        </button>
                        <span style={{ fontSize: '10px', color: '#71817d' }}>
                          {subtotal !== null ? <>Subtotal <b style={{ color: '#137333' }}>{rupiah(subtotal)}</b></> : 'Subtotal —'}
                        </span>
                      </div>
                      {/* Sumber acuan + vendor referensi + tanggal (bila nyata) */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                        {sourceLabelFor(it)}
                        {it.est_vendor && (
                          <span style={{ fontSize: '10px', color: '#485653' }}>
                            🏷️ ref: <b>{it.est_vendor}</b>
                          </span>
                        )}
                        {it.est_date && (
                          <span style={{ fontSize: '10px', color: '#485653' }}>
                            📅 {String(it.est_date).slice(0, 10)}
                          </span>
                        )}
                        {it.est_source === 'HISTORIS' && it.est_price_per !== null && digits && Number(digits) !== it.est_price_per && (
                          <span style={{ fontSize: '10px', color: '#b45309' }}>
                            harga acuan terakhir {rupiah(it.est_price_per)}/{it.est_unit || it.satuan || ''}
                          </span>
                        )}
                        {it.est_source === 'PR_ESTIMATE' && it.est_vendor && (
                          <span style={{ fontSize: '10px', color: '#556260' }}>
                            vendor referensi PR — belum tentu supplier aktual
                          </span>
                        )}
                        {vendorNotEligible && (
                          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600 }}>
                            ⚠️ vendor tersimpan tidak aktif utk kategori material ini (lihat modul Vendor)
                          </span>
                        )}
                        {unitPrice === null && (
                          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600 }}>
                            Belum ada acuan — isi estimasi manual
                          </span>
                        )}
                      </div>
                      {/* ===== BARIS 2 (LIPAT, default tertutup): RENCANA TOKO =====
                          t_cde1b8ad: pemilihan toko dipindah ke Purchase. Kontrol
                          ini tetap ada HANYA untuk melihat/mengoreksi data lama &
                          memutus jalan buntu validasi vendor (save.js menolak vendor
                          yang tidak eligible). Tidak ada field wajib di sini. */}
                      <details className="pr-item-toko" style={{ marginTop: '5px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: '10px', fontWeight: 600, color: '#5b6b66', listStyle: 'revert' }}>
                          🏷️ Rencana toko (opsional){savedVendor ? ` — tersimpan: ${savedVendor}` : ' — tidak dipilih di PR'}
                        </summary>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', color: '#71817d' }}>
                            Toko aktual dicatat di Purchase. Isian di sini hanya rencana/referensi lama.
                          </span>
                          <label style={{ margin: 0, fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: '#485653' }}>
                            Kategori
                            <select
                              value={it.supplier_category || ''}
                              onChange={e => updateItemSupplier(idx, e.target.value)}
                              style={{ width: 'auto', maxWidth: '150px', padding: '2px 4px', fontSize: '10px' }}
                            >
                              <option value="">-- Pilih Kategori --</option>
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
                      </details>
                    </td>
                  </tr>
                  </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* ===== TOTAL ESTIMASI PR (t_ac0b39c0) — di luar area scroll =====
              t_cde1b8ad: dulu ini <table> (6 kolom, tanpa table-layout). Lebar
              min-content-nya (≈820px) merambat ke grid dialog dan membuat
              SELURUH dialog form PR bergulir horizontal di layar 390px.
              Bahkan dengan table-layout:fixed, kontribusi min-content tabel
              tetap ≈820px karena width:100% tidak punya acuan pasti di dalam
              grid auto. Karena itu bentuknya diganti BARIS FLEX (tanpa tabel
              sama sekali) — satu-satunya bentuk yang benar-benar tidak punya
              min-content lebar. Isi & posisi tidak berubah: Total tetap DI
              LUAR area scroll item supaya selalu terlihat (review run 86).
              Harness pr-estimator & pr-purchase-compact diperbarui untuk
              memeriksa elemen `.pr-total-row` (bukan lagi <tr>). */}
          <div
            className="pr-total-row"
            style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end',
              gap: '10px', flexWrap: 'wrap', marginTop: '4px', paddingTop: '6px',
              borderTop: '2px solid #1f3a34', minWidth: 0, maxWidth: '100%'
            }}
          >
            <span style={{ fontWeight: 700, color: '#1f3a34', fontSize: '11.5px' }}>Total Estimasi:</span>
            <b style={{ fontSize: '13px', color: '#137333', whiteSpace: 'nowrap' }}>
              {rupiah(totals?.total ?? 0)}
            </b>
          </div>
            {/* Label "belum lengkap" — item tanpa acuan TIDAK dihitung 0 */}
            {totals && !totals.complete && (
              <div style={{ marginTop: '6px', background: '#fdf8ea', border: '1px dashed #f0dcb4', borderRadius: '6px', padding: '6px 10px', fontSize: '10.5px', color: '#b45309', fontWeight: 600 }}>
                ⚠️ Total estimasi BELUM LENGKAP — {totals.unknown} item belum punya harga/acuan:
                <ul style={{ margin: '3px 0 0 16px', padding: 0 }}>
                  {missingPrice.map((it, i) => (
                    <li key={i} style={{ fontWeight: 500 }}>{it.name || it.kode}</li>
                  ))}
                </ul>
              </div>
            )}
            {/* Data lama: rencana toko tersimpan TIDAK dihapus — dinyatakan
                terus terang supaya tidak terlihat seperti data hilang. */}
            {itemsWithToko.length > 0 && (
              <small style={{ display: 'block', color: '#556260', fontSize: '9.5px', marginTop: '4px' }}>
                ℹ️ {itemsWithToko.length} item menyimpan rencana toko dari data lama — nilainya dipertahankan
                (buka "Rencana toko" pada baris item untuk melihat/mengubah).
              </small>
            )}
            <small style={{ display: 'block', color: '#71817d', fontSize: '9.5px', marginTop: '4px' }}>
              Harga estimasi = harga satuan material murni (tanpa ongkir/admin). Sumber acuan belum tersimpan permanen ke DB (lihat catatan pada modul Material).
            </small>
          </React.Fragment>
        ) : (
          <p className="muted" style={{ fontSize: '11px', marginTop: '6px', marginBottom: 0 }}>
            💡 Belum ada item. Pilih material di atas lalu "+ Tambah Item", atau import dari Excel.
          </p>
        )}
      </div>

      {/* ============================================================
          CATATAN — OPSIONAL & DILIPAT (t_cde1b8ad)
          ============================================================
          Nilai form.notes TETAP dikirim ke save.js seperti sebelumnya
          (purchase_requests.notes). Kalau dibiarkan kosong, save.js memakai
          judul PR sebagai catatan (perilaku lama, tidak diubah). Lipatan
          dibuka otomatis bila memang sudah ada catatan tersimpan, supaya
          data lama tidak tampak hilang. */}
      <details className="pr-notes-box" open={!!notesText.trim()} style={{ marginTop: '10px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#485653', listStyle: 'revert' }}>
          📝 Catatan (opsional){notesText.trim() ? ' — ada catatan tersimpan' : ''}
        </summary>
        <label style={{ marginTop: '6px' }}>
          Catatan Tambahan
          <textarea
            rows={2}
            value={notesText}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            placeholder="Contoh: material untuk kamar utama, ambil dari sisa proyek sebelumnya"
          />
        </label>
      </details>
    </>
  )
}
