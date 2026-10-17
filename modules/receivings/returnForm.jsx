// ============================================================
// modules/receivings/returnForm.jsx — Retur dari barang RUSAK (tanpa ketik ulang)
// ============================================================
// Masalah lama: membuat retur berarti mengetik ulang nama barang & qty dari
// awal (rawan salah dan bisa menggandakan angka). Di sini baris retur DIAMBIL
// dari event penerimaan yang mencatat `qty_rusak` > 0, dikurangi yang sudah
// pernah diretur (`return_lines`). User hanya memilih aksi
// (kembalikan / minta ganti / refund / buang) dan mencentang baris.
//
// Mode LEGACY (skema belum ada): form tetap tampil sebagai RENCANA read-only
// dari qty rusak yang diketahui (bila ada) TAPI submit diblok dengan pesan
// jujur — tidak ada tulisan, tidak ada klaim tersimpan.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react'
import { returLinesFromEvents } from './receiptEventLogic'
import { loadReceivingEvents, loadReturnedByEvent, createReturnCase } from './receiptEventSave'
import { capabilityMessage } from './receiptCapability'

const RESOLUTIONS = [
  { id: 'RETURN', label: 'Kembalikan ke supplier' },
  { id: 'REPLACE', label: 'Minta barang pengganti' },
  { id: 'REFUND', label: 'Minta refund (uang kembali)' },
  { id: 'DISCARD', label: 'Dibuang (tidak dikembalikan)' }
]

const fmt = (v) => (v === undefined || v === null || v === '' ? '—' : v)

export default function ReturnForm({ receiving, capability = null, say, refresh, close }) {
  const ready = !!capability?.returnReady
  const [loading, setLoading] = useState(ready)
  const [loadError, setLoadError] = useState('')
  const [rows, setRows] = useState([])
  const [picked, setPicked] = useState({})
  const [resolution, setResolution] = useState('RETURN')
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!ready) { setLoading(false); return }
      setLoading(true)
      const ev = await loadReceivingEvents({ receivingId: receiving?.id })
      if (cancelled) return
      if (!ev.ok) { setLoadError(ev.error); setLoading(false); return }
      // ANTI DOUBLE-RETUR: baca qty yang SUDAH diretur dari return_lines.
      // Kalau gagal dibaca, JANGAN menawarkan baris (lebih aman) — kalau tidak,
      // membuka modal dua kali mencatat retur yang sama dua kali.
      const ids = (ev.events || []).map(e => e.id)
      const ret = await loadReturnedByEvent({ eventIds: ids })
      if (cancelled) return
      if (!ret.ok) {
        setLoadError(`Tidak bisa memeriksa riwayat retur: ${ret.error}`)
        setRows([])
        setPicked({})
        setLoading(false)
        return
      }
      const lines = returLinesFromEvents(ev.events || [], { alreadyReturned: ret.returned || {} })
      setRows(lines)
      const init = {}
      for (const l of lines) init[l.receiving_event_id] = true
      setPicked(init)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [ready, receiving?.id])

  const chosen = useMemo(() => rows.filter(r => picked[r.receiving_event_id]), [rows, picked])
  const totalQty = useMemo(() => chosen.reduce((s, r) => s + (Number(r.qty) || 0), 0), [chosen])

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setErrorMsg('')
    if (!ready) {
      setErrorMsg(`Retur per barang belum bisa disimpan: ${capabilityMessage(capability)}`)
      return
    }
    if (!chosen.length) { setErrorMsg('Pilih minimal satu barang rusak yang akan diretur.'); return }
    setSaving(true)
    try {
      const res = await createReturnCase({ receiving, lines: chosen, resolution, reason })
      if (!res.ok) { setErrorMsg(res.error); return }
      say?.(`Retur tercatat: ${chosen.length} baris · total ${totalQty}. Status: ${RESOLUTIONS.find(r => r.id === resolution)?.label || resolution}.`)
      close?.()
      refresh?.()
    } finally {
      setSaving(false)
    }
  }

  const label = receiving?.invoice_no || receiving?.delivery_note || 'Penerimaan'

  return (
    <div className="modal">
      <form className="dialog dialog-wide" onSubmit={submit} data-testid="return-form">
        <div className="dialoghead">
          <h2>↩ Retur Barang Rusak — {label}</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '12.5px' }}>
          Barang diambil dari catatan penerimaan yang menyatakan <b>rusak</b> — tidak perlu mengetik ulang
          nama atau jumlah. Pilih tindakan, lalu centang baris yang benar-benar diretur.
        </p>

        <div
          data-testid="return-capability"
          style={{
            fontSize: '11.5px', borderRadius: '7px', padding: '7px 10px', lineHeight: 1.45,
            background: ready ? '#e6f4ea' : '#fef6e7',
            border: `1px solid ${ready ? '#ceead6' : '#fcdfa6'}`,
            color: ready ? '#137333' : '#7a4a08'
          }}
        >
          {ready
            ? 'Retur AKTIF: baris diambil dari catatan rusak per penerimaan; status retur tersimpan dan qty tidak dihitung ganda.'
            : capabilityMessage(capability)}
        </div>

        {loading && <div className="muted" style={{ fontSize: '12px' }}>Memuat barang rusak…</div>}
        {loadError && (
          <div style={{ color: '#c93b2b', fontSize: '12px' }}>Gagal memuat barang rusak: {loadError}</div>
        )}

        {!loading && !loadError && rows.length === 0 && (
          <div data-testid="return-empty" style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#1f3a34' }}>
            Tidak ada barang rusak yang tercatat pada penerimaan ini.
            {ready
              ? ' Catat dulu jumlah rusak di form Terima Barang.'
              : ' (Pencatatan jumlah rusak per barang belum aktif — menunggu migrasi skema.)'}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                Tindakan
                <select value={resolution} onChange={e => setResolution(e.target.value)} data-testid="return-resolution">
                  {RESOLUTIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px', flex: '1 1 240px' }}>
                Alasan / catatan (opsional)
                <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="mis. penyok saat pengiriman" data-testid="return-reason" />
              </label>
            </div>

            <div data-testid="return-lines" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {rows.map(r => (
                <label
                  key={r.receiving_event_id}
                  data-testid={`return-line-${r.receiving_event_id}`}
                  style={{ display: 'flex', gap: '8px', alignItems: 'center', border: '1px solid #d5e0dc', borderRadius: '7px', padding: '7px 10px', background: '#fbfdfc', fontSize: '12px' }}
                >
                  <input
                    type="checkbox"
                    checked={!!picked[r.receiving_event_id]}
                    onChange={e => setPicked(prev => ({ ...prev, [r.receiving_event_id]: e.target.checked }))}
                  />
                  <span style={{ flex: 1 }}><b>{r.item_name}</b></span>
                  <span style={{ fontSize: '11.5px', color: '#556b65' }}>
                    rusak <b>{fmt(r.qty_rusak)}{r.satuan ? ` ${r.satuan}` : ''}</b>
                    {r.qty_sudah_retur > 0 ? <> · sudah diretur {r.qty_sudah_retur}</> : null}
                    {' '}· akan diretur <b>{fmt(r.qty)}{r.satuan ? ` ${r.satuan}` : ''}</b>
                  </span>
                </label>
              ))}
            </div>

            <div style={{ fontSize: '11.5px', color: '#1f3a34' }} data-testid="return-summary">
              <b>Ringkasan retur:</b> {chosen.length} baris · total {totalQty} unit · tindakan{' '}
              <b>{RESOLUTIONS.find(r => r.id === resolution)?.label}</b>
            </div>
            <div style={{ fontSize: '10.5px', color: '#8a6d1f', background: '#fdf8ea', border: '1px solid #f0dcb4', borderRadius: '4px', padding: '5px 8px' }}>
              Retur tidak mengurangi jumlah yang sudah diterima dan tidak membuat biaya baru — kalau supplier mengganti
              barang, catat penerimaan pengganti sebagai penerimaan baru (hindari hitung ganda).
            </div>
          </>
        )}

        {errorMsg && (
          <div data-testid="return-error" style={{ color: '#c93b2b', fontSize: '12px', fontWeight: 600 }}>{errorMsg}</div>
        )}

        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button type="submit" disabled={saving || !rows.length || (ready && !chosen.length)} data-testid="return-submit">
            {saving ? 'Menyimpan…' : '↩ Simpan Retur'}
          </button>
        </div>
      </form>
    </div>
  )
}
