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
// CATATAN Fase 2 (belum dikerjakan): logika simpan (save) per modul masih di
// shell CreateModal; pemindahannya direncanakan terpisah agar tidak
// mencampur refactor struktur dengan perubahan perilaku.
// ============================================================
import React from 'react'

export function formBody(ctx) {
  const {
    form, setForm, field, allProjects, allMaterials,
    prItemsList, materialSearch, setMaterialSearch,
    selectedMaterialId, setSelectedMaterialId, filteredMaterials,
    itemQty, setItemQty, addItemToPR, removeItemFromPR, updateItemQty,
    materialCategories, updateItemSupplier, updateItemVendor, vendorsForItem, updateItemPrice
  } = ctx
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
  )
}
