// ============================================================
// modules/handovers/receiptForm.jsx — "Terima Barang" per item (fisik)
// ============================================================
// ARAHAN DAT (continuation 18 Okt + 21 Okt): UI FISIK HIDUP HANYA DI HANDOVER.
// Purchase berhenti di "barang dibeli"; pencatatan kedatangan/kondisi/tujuan
// per barang terjadi di sini — bukan di modul Pembelian.
//
// SATU form, SATU submit, per barang:
//   datang · rusak · tujuan (Workshop / Tukang) · retur · foto (OPSIONAL)
// Disimpan lewat SATU RPC `receipt_apply_events` (idempoten). Tidak ada
// tulisan saat mengetik; tidak ada packing ke kolom note.
//
// DUA MODE (dipilih dari capability probe, BUKAN asumsi):
//   READY  — tabel + view ada: semua dimensi tersimpan permanen.
//   LEGACY — skema belum ada: form TETAP tampil, tetapi submit DIBLOK dengan
//            pesan gap eksplisit dan NOL tulisan. Tidak ada klaim "tersimpan".
//
// SEMANTIK QTY (COMPATIBILITY_CUTOVER.md t_03b41644):
//   sisa dihitung dari qty_arrived (DATANG) — bukan quantity_received (BELI).
// ============================================================
import React, { useMemo, useRef, useState } from 'react'
import {
  RETUR_NANTI, RETUR_SUPPLIER, RETUR_DIBUANG,
  buildRows, emptyEntry, validateForm, buildSavePlan, sisaByIdOf
} from '../receivings/receiptLogic'
import { buildEventDrafts } from '../receivings/receiptEventLogic'
import { applyReceiptEvents } from '../receivings/receiptEventSave'
import { capabilityMessage } from '../receivings/receiptCapability'

const num = (v) => {
  const n = Number(v)
  return isFinite(n) ? n : 0
}

const S = {
  note: { fontSize: '11.5px', borderRadius: '7px', padding: '7px 10px', lineHeight: 1.45, margin: 0 },
  line: { border: '1px solid #d5e0dc', borderRadius: '8px', padding: '9px 11px', background: '#fbfdfc' },
  lineHead: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', fontSize: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginTop: '6px' },
  field: { fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' },
  hint: { fontSize: '11px', color: '#556b65' },
  err: { color: '#c93b2b', fontSize: '11px', marginTop: '3px' },
  warn: { fontSize: '10.5px', color: '#8a6d1f', background: '#fdf8ea', border: '1px solid #f0dcb4', borderRadius: '4px', padding: '5px 8px' }
}

export default function ReceiptForm({ receiving, items = [], orderedFor, capability = null, say, refresh, close }) {
  const ready = !!capability?.ready
  const rows = useMemo(() => buildRows(items, orderedFor), [items, orderedFor])
  const [entries, setEntries] = useState(() => {
    const init = {}
    for (const r of rows) init[r.id] = emptyEntry()
    return init
  })
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  // Ref guard: dua klik/Enter dalam frame yang sama tetap satu submit.
  const busyRef = useRef(false)

  const setField = (itemId, field, value) => {
    setEntries(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || emptyEntry()), [field]: value } }))
  }

  const v = validateForm(rows, entries, { ledgerReady: ready })
  const plan = buildSavePlan(rows, entries)
  const label = receiving?.invoice_no || receiving?.delivery_note || 'Penerimaan'

  async function submit(e) {
    e.preventDefault()
    if (busyRef.current || saving) return
    if (!v.valid) {
      const first = v.globalErrors[0]
        || Object.values(v.itemErrors).flatMap(x => Object.values(x))[0]
        || 'Periksa kembali isian yang ditandai.'
      setErrorMsg(first)
      return
    }
    if (plan.length === 0) {
      setErrorMsg('Isi minimal satu jumlah datang pada item yang benar-benar diterima.')
      return
    }
    setErrorMsg('')

    // ---- MODE LEGACY: belum ada tabel → blokir, NOL tulisan ----
    if (!ready) {
      setErrorMsg(`Belum dapat disimpan — ${capabilityMessage(capability)} Data belum ditulis sama sekali.`)
      return
    }

    busyRef.current = true
    setSaving(true)
    try {
      const drafts = buildEventDrafts(rows, entries, { receivingId: receiving.id })
      const res = await applyReceiptEvents({
        receiving,
        drafts,
        sisaById: sisaByIdOf(rows)
      })
      if (!res.ok) { setErrorMsg(res.error); return }
      const extra = res.alreadyApplied > 0 ? ` (${res.alreadyApplied} sudah pernah tercatat, tidak digandakan)` : ''
      say?.(`Penerimaan tersimpan: ${res.applied} barang${extra}. Qty datang tersimpan terpisah dari qty beli.`)
      close?.()
      refresh?.()
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="modal">
      <form className="dialog dialog-wide" onSubmit={submit} data-testid="receipt-form">
        <div className="dialoghead">
          <h2>📥 Terima Barang — {label}</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '12.5px' }}>
          Catat barang yang <b>benar-benar datang</b>. Jumlah <b>dibeli</b> dan jumlah <b>datang</b> disimpan
          terpisah — mencatat kedatangan tidak mengubah nilai pembelian.
        </p>

        <div
          data-testid="receipt-capability"
          style={{
            ...S.note,
            background: ready ? '#e6f4ea' : '#fef6e7',
            border: `1px solid ${ready ? '#ceead6' : '#fcdfa6'}`,
            color: ready ? '#137333' : '#7a4a08'
          }}
        >
          {ready
            ? 'Penyimpanan per barang AKTIF: kedatangan, kondisi rusak, tujuan, dan retur tersimpan permanen.'
            : capabilityMessage(capability)}
        </div>

        {rows.length === 0 && (
          <div data-testid="receipt-empty" style={{ ...S.note, background: '#eef3f1', border: '1px solid #cbd8d4', color: '#1f3a34' }}>
            Nota ini belum punya rincian barang, jadi tidak ada yang bisa diterima per barang.
          </div>
        )}

        {rows.map(row => {
          const entry = entries[row.id] || emptyEntry()
          const errs = v.itemErrors[row.id] || {}
          const datang = num(entry.datang)
          const rusak = num(entry.rusak)
          const baik = Math.max(0, datang - rusak)
          return (
            <div key={row.id} style={S.line} data-testid={`receipt-line-${row.id}`}>
              <div style={S.lineHead}>
                <b>{row.item_name}</b>
                <span style={S.hint}>
                  dibeli <b>{row.boughtKnown ? row.bought : '—'}</b>{row.unit ? ` ${row.unit}` : ''}
                  {' · '}sudah datang <b>{row.prevCum}</b>
                  {row.sisa !== null ? <> {' · '}sisa {row.boughtKnown ? 'yang bisa diterima' : 'pesanan'} <b>{row.sisa}</b></> : null}
                </span>
              </div>

              {row.notBought && (
                <div style={{ ...S.warn, marginTop: '6px' }} data-testid={`rc-notbought-${row.id}`}>
                  <b>Belum dibeli.</b> Baris ini dibuat otomatis saat PR disetujui dan qty belinya masih 0 —
                  kedatangan tidak bisa dicatat sebelum barangnya benar-benar dibeli di modul Pembelian.
                </div>
              )}

              <div style={S.grid}>
                <label style={S.field}>
                  Jumlah datang {row.unit ? `(${row.unit})` : ''}
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    value={entry.datang}
                    data-testid={`rc-datang-${row.id}`}
                    onChange={e => setField(row.id, 'datang', e.target.value)}
                  />
                </label>
                <label style={S.field}>
                  Dari itu, rusak
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    value={entry.rusak}
                    data-testid={`rc-rusak-${row.id}`}
                    onChange={e => setField(row.id, 'rusak', e.target.value)}
                  />
                </label>
                <label style={S.field}>
                  Tujuan: Workshop
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    value={entry.ws}
                    data-testid={`rc-ws-${row.id}`}
                    onChange={e => setField(row.id, 'ws', e.target.value)}
                  />
                </label>
                <label style={S.field}>
                  Tujuan: Tukang
                  <input
                    type="number" min="0" step="any" inputMode="decimal"
                    value={entry.tukang}
                    data-testid={`rc-tukang-${row.id}`}
                    onChange={e => setField(row.id, 'tukang', e.target.value)}
                  />
                </label>
              </div>

              <div style={S.grid}>
                <label style={S.field}>
                  Nama penerima tukang
                  <input
                    type="text"
                    value={entry.penerima}
                    placeholder="wajib bila ada barang ke tukang"
                    data-testid={`rc-penerima-${row.id}`}
                    onChange={e => setField(row.id, 'penerima', e.target.value)}
                  />
                </label>
                <label style={S.field}>
                  Barang rusak
                  <select
                    value={entry.retur}
                    data-testid={`rc-retur-${row.id}`}
                    onChange={e => setField(row.id, 'retur', e.target.value)}
                  >
                    <option value={RETUR_NANTI}>Tentukan nanti — barang TIDAK bisa diretur lewat aplikasi</option>
                    <option value={RETUR_SUPPLIER}>Kembalikan ke supplier</option>
                    <option value={RETUR_DIBUANG}>Dibuang</option>
                  </select>
                </label>
                <label style={S.field}>
                  Foto bukti (opsional)
                  <input
                    type="file"
                    accept="image/*"
                    data-testid={`rc-foto-${row.id}`}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      setField(row.id, 'foto', f ? { nama: f.name } : null)
                    }}
                  />
                </label>
              </div>

              {entry.retur === RETUR_DIBUANG && (
                <label style={{ ...S.field, flexDirection: 'row', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    checked={!!entry.konfirmasiBuang}
                    data-testid={`rc-konfirmasi-${row.id}`}
                    onChange={e => setField(row.id, 'konfirmasiBuang', e.target.checked)}
                  />
                  Saya konfirmasi barang ini benar-benar dibuang.
                </label>
              )}

              <div style={{ ...S.hint, marginTop: '5px' }} data-testid={`rc-hitung-${row.id}`}>
                baik = datang − rusak = <b>{datang ? baik : 0}</b>
                {row.unit ? ` ${row.unit}` : ''}
                {row.sisa !== null && datang > 0 ? ` · belum datang: ${Math.max(0, row.sisa - datang)}` : ''}
              </div>

              {/* Barang rusak yang dibiarkan "Tentukan nanti" TIDAK punya saldo
                  retur (retur_qty 0) → tidak bisa diretur sampai diputuskan.
                  Dikatakan di sini, bukan baru ketahuan di modal retur. */}
              {rusak > 0 && entry.retur === RETUR_NANTI && (
                <div style={S.warn} data-testid={`rc-warn-nanti-${row.id}`}>
                  {rusak} rusak dibiarkan <b>tanpa keputusan</b> — barang ini belum bisa diretur
                  sampai Anda memilih "Kembalikan ke supplier" atau "Dibuang".
                </div>
              )}

              {Object.keys(errs).length > 0 && (
                <div style={S.err} data-testid={`rc-err-${row.id}`}>{Object.values(errs)[0]}</div>
              )}
            </div>
          )
        })}

        {errorMsg && (
          <div data-testid="receipt-error" style={{ color: '#c93b2b', fontSize: '12px', fontWeight: 600 }}>{errorMsg}</div>
        )}

        <div style={S.warn}>
          Foto bukti <b>opsional</b> untuk semua kondisi (termasuk rusak/dibuang). Retur tidak mengurangi
          jumlah yang sudah diterima dan tidak membuat biaya baru.
        </div>

        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button
            type="submit"
            disabled={saving || plan.length === 0}
            data-testid="receipt-submit"
          >
            {saving ? 'Menyimpan…' : '📥 Simpan Penerimaan'}
          </button>
        </div>
      </form>
    </div>
  )
}
