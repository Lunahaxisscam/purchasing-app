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
// - Ganti vendor menghitung ulang harga BILA harga belum milik user
//   (est_manual) — tidak pernah menimpa input user diam-diam.
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
// (HISTORIS/MASTER) — metadata disimpan di field est_* pada item.
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
      <span className="acuan-badge acuan-badge-historis" title="Harga terealisasi dari pembelian yang benar-benar diterima (satuan sama, tanpa ongkir/admin)">
        ✅ Historis
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
  return (
    <span className="acuan-badge" style={{ background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }} title="Belum ada sumber harga valid">
      Belum ada acuan
    </span>
  )
}

export function formBody(ctx) {
  const {
    form, setForm, field, allProjects, allMaterials,
    prItemsList, materialSearch, setMaterialSearch,
    materialCategoryFilter, setMaterialCategoryFilter,
    selectedMaterialId, setSelectedMaterialId, filteredMaterials,
    itemQty, setItemQty, addItemToPR, removeItemFromPR, updateItemQty,
    updateItemSupplier, updateItemVendor, vendorsForItem, updateItemPrice,
    applyAcuanToItem, vendorEligibleForItem, totals,
    materialCategories
  } = ctx

  // Kategori utk filter katalog — daftar kategori master material.
  const catOptions = materialCategories || []
  // Item yang belum punya acuan/harga (utk label "belum lengkap").
  const missingPrice = (prItemsList || []).filter(it => {
    const d = String(it.estimated_price ?? '').replace(/[^\d]/g, '')
    return !d
  })

  return (
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
          <div style={{ marginTop: '10px', maxHeight: '240px', overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
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
                    <td style={{ padding: '4px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', color: '#71817d', fontWeight: 600 }}>🛒 Rencana beli:</span>
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
                        <label style={{ margin: 0, fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: '#485653' }}>
                          Estimasi Harga
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Rp…"
                            value={it.estimated_price || ''}
                            onChange={e => updateItemPrice(idx, e.target.value)}
                            style={{ width: '90px', padding: '2px 4px', fontSize: '10px' }}
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
                        {vendorNotEligible && (
                          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600 }}>
                            ⚠️ vendor tidak aktif utk kategori material ini (lihat modul Vendor)
                          </span>
                        )}
                        {unitPrice === null && (
                          <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 600 }}>
                            Belum ada acuan — isi estimasi manual
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  </React.Fragment>
                  )
                })}
                {/* ===== TOTAL ESTIMASI PR (t_ac0b39c0) ===== */}
                <tr>
                  <td colSpan={4} style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#1f3a34', borderTop: '2px solid #1f3a34' }}>
                    Total Estimasi:
                  </td>
                  <td style={{ padding: '6px', textAlign: 'right', whiteSpace: 'nowrap', borderTop: '2px solid #1f3a34' }}>
                    <b style={{ fontSize: '12px', color: '#137333' }}>{rupiah(totals?.total ?? 0)}</b>
                  </td>
                  <td style={{ borderTop: '2px solid #1f3a34' }} />
                </tr>
              </tbody>
            </table>
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
            <small style={{ display: 'block', color: '#71817d', fontSize: '9.5px', marginTop: '4px' }}>
              Harga estimasi = harga satuan material murni (tanpa ongkir/admin). Sumber acuan belum tersimpan permanen ke DB (lihat catatan pada modul Material).
            </small>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: '11px', marginTop: '6px', marginBottom: 0 }}>
            💡 Belum ada item. Pilih material di atas lalu "+ Tambah Item", atau import dari Excel.
          </p>
        )}
      </div>

      {field('notes', 'Catatan Tambahan', 'text', false)}
    </>
  )
}
