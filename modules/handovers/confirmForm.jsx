// ============================================================
// modules/handovers/confirmForm.jsx — Konfirmasi FISIK serah terima per item
// ============================================================
// "Sudah Diserahkan" hanya bermakna bila ada bukti fisik (`diserahkan_at`) —
// kontrak t_b418827b. Form ini memisahkan dua hal yang sebelumnya tercampur:
//   1) ALOKASI  (barang ditugaskan ke tukang saat penerimaan dicatat)
//   2) SERAH TERIMA FISIK (barang benar-benar diterima tukang/mandor)
//
// Alur:
//   - baris TIDAK diketik ulang: prefill dari event penerimaan
//     (`tujuan_tukang`) dikurangi yang sudah diserahkan (`handover_items`)
//     → penerima hanya memverifikasi jumlah fisik.
//   - penerima boleh beda per baris (beberapa penerima).
//   - konfirmasi menulis `handovers.status=CONFIRMED` + `diserahkan_at` +
//     baris `handover_items` lewat SATU RPC (idempoten: CAS
//     `diserahkan_at IS NULL` + unique (handover_id, receiving_event_id)).
//
// MODE LEGACY (skema belum ada): konfirmasi header saja (perilaku sekarang,
// `confirm.js`) dengan pesan jujur bahwa rincian per barang belum tersimpan.
// ============================================================
import React, { useEffect, useMemo, useState } from 'react'
import { handoverLinesFromEvents, validateHandoverLines } from '../receivings/receiptEventLogic'
import { loadReceivingEvents, loadDeliveredByEvent, confirmHandoverLines } from '../receivings/receiptEventSave'
import { capabilityMessage } from '../receivings/receiptCapability'
import { markHandoverDelivered } from './confirm'

const fmt = (v) => (v === undefined || v === null || v === '' ? '—' : v)

const S = {
  note: { fontSize: '11.5px', borderRadius: '7px', padding: '7px 10px', lineHeight: 1.45, margin: 0 },
  line: { border: '1px solid #d5e0dc', borderRadius: '8px', padding: '9px 11px', background: '#fbfdfc' },
  lineHead: { display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', fontSize: '12px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginTop: '6px' },
  field: { fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' },
  hint: { fontSize: '11px', color: '#556b65' },
  err: { color: '#c93b2b', fontSize: '12px', fontWeight: 600 }
}

export default function HandoverConfirmForm({ handover, capability = null, say, refresh, close }) {
  const ready = !!capability?.ready
  const [loading, setLoading] = useState(ready)
  const [loadError, setLoadError] = useState('')
  const [prefill, setPrefill] = useState([])
  const [lines, setLines] = useState([])
  const [penerimaHeader, setPenerimaHeader] = useState(handover?.received_by || '')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!ready || !handover?.receiving_id) { setLoading(false); return }
      setLoading(true)
      const ev = await loadReceivingEvents({ receivingId: handover.receiving_id })
      if (cancelled) return
      if (!ev.ok) { setLoadError(ev.error); setLoading(false); return }
      const ids = (ev.events || []).map(e => e.id)
      const del = await loadDeliveredByEvent({ eventIds: ids })
      if (cancelled) return
      if (!del.ok) { setLoadError(del.error); setLoading(false); return }
      const pf = handoverLinesFromEvents(ev.events || [], del.delivered || {})
      setPrefill(pf)
      setLines(pf.map(p => ({
        receiving_event_id: p.receiving_event_id,
        item_name: p.item_name,
        satuan: p.satuan,
        qty_alokasi: p.qty_alokasi,
        qty_sudah_diserahkan: p.qty_sudah_diserahkan,
        qty_diserahkan: p.qty_diserahkan,
        penerima: p.penerima || handover?.received_by || '',
        catatan: ''
      })))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [ready, handover?.receiving_id, handover?.id])

  const totals = useMemo(() => {
    const total = lines.reduce((s, l) => s + (Number(l.qty_diserahkan) || 0), 0)
    return { baris: lines.length, total }
  }, [lines])

  const validation = ready
    ? validateHandoverLines(lines, prefill)
    : { ok: true, errors: [], lines: [] }

  function setLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setErrorMsg('')
    if (ready) {
      if (!validation.ok) { setErrorMsg(validation.errors[0]); return }
      setSaving(true)
      try {
        const res = await confirmHandoverLines({ handover, lines: validation.lines })
        if (!res.ok) { setErrorMsg(res.error); return }
        say?.(res.already
          ? 'Serah terima ini sudah ditandai diserahkan sebelumnya — tidak ada data yang digandakan.'
          : `Serah terima tersimpan: ${res.inserted} baris barang diserahkan (${totals.total} unit).`)
        close?.()
        refresh?.()
      } finally {
        setSaving(false)
      }
      return
    }
    // LEGACY: konfirmasi header saja — rincian TIDAK diklaim tersimpan.
    setSaving(true)
    try {
      const res = await markHandoverDelivered({ handover })
      if (!res.ok) { setErrorMsg(res.error); return }
      say?.(res.already
        ? 'Serah terima ini sudah ditandai diserahkan sebelumnya.'
        : 'Serah terima ditandai sudah diserahkan (waktu penyerahan tercatat). Rincian per barang belum tersimpan — menunggu migrasi skema.')
      close?.()
      refresh?.()
    } finally {
      setSaving(false)
    }
  }

  const label = handover?.received_by || handover?.project_name || 'Serah Terima'

  return (
    <div className="modal">
      <form className="dialog dialog-wide" onSubmit={submit} data-testid="handover-confirm-form">
        <div className="dialoghead">
          <h2>✓ Konfirmasi Serah Terima — {label}</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '12.5px' }}>
          Tandai hanya setelah barang <b>benar-benar diterima</b> tukang/mandor di lokasi.
          Alokasi ke tukang saat penerimaan <b>bukan</b> bukti serah terima.
        </p>

        <div
          data-testid="handover-confirm-capability"
          style={{
            ...S.note,
            background: ready ? '#e6f4ea' : '#fef6e7',
            border: `1px solid ${ready ? '#ceead6' : '#fcdfa6'}`,
            color: ready ? '#137333' : '#7a4a08'
          }}
        >
          {ready
            ? 'Rincian per barang AKTIF: baris di bawah diisi otomatis dari penerimaan (alokasi ke tukang) dikurangi yang sudah diserahkan — Anda hanya memverifikasi jumlah fisik.'
            : `${capabilityMessage(capability)} Konfirmasi di sini hanya mencatat waktu penyerahan (header), tanpa rincian barang.`}
        </div>

        {loading && <div className="muted" style={{ fontSize: '12px' }}>Memuat rincian penerimaan…</div>}
        {loadError && (
          <div data-testid="handover-confirm-load-error" style={{ color: '#c93b2b', fontSize: '12px' }}>
            Gagal memuat rincian penerimaan: {loadError}. Konfirmasi tidak bisa menampilkan rincian — jangan lanjutkan bila ragu.
          </div>
        )}

        {ready && !loading && !loadError && lines.length === 0 && (
          <div data-testid="handover-confirm-empty" style={{ ...S.note, background: '#fef6e7', border: '1px solid #fcdfa6', color: '#7a4a08' }}>
            Tidak ada barang berstatus <b>alokasi ke tukang</b> yang belum diserahkan pada penerimaan ini.
            Bila barang dikirim langsung ke tukang tanpa dicatat di Terima Barang, catat dulu alokasinya —
            atau konfirmasi header saja (tanpa rincian) bila memang tidak ada rincian yang bisa dicatat.
          </div>
        )}

        {ready && lines.length > 0 && (
          <div data-testid="handover-confirm-lines" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {lines.map((l, i) => (
              <div key={l.receiving_event_id} style={S.line}>
                <div style={S.lineHead}>
                  <b>{l.item_name}</b>
                  <span style={S.hint}>
                    Alokasi ke tukang: <b>{fmt(l.qty_alokasi)}{l.satuan ? ` ${l.satuan}` : ''}</b>
                    {Number(l.qty_sudah_diserahkan) > 0 ? <> · sudah diserahkan: <b>{l.qty_sudah_diserahkan}</b></> : null}
                  </span>
                </div>
                <div style={S.grid}>
                  <label style={S.field}>
                    Jumlah diserahkan {l.satuan ? `(${l.satuan})` : ''}
                    <input
                      type="number" min="0" step="any" inputMode="decimal"
                      value={l.qty_diserahkan}
                      data-testid={`hc-qty-${l.receiving_event_id}`}
                      onChange={e => setLine(i, 'qty_diserahkan', e.target.value)}
                    />
                  </label>
                  <label style={S.field}>
                    Penerima (nama)
                    <input
                      type="text" value={l.penerima} placeholder="Contoh: Pak Joko (Mandor)"
                      data-testid={`hc-penerima-${l.receiving_event_id}`}
                      onChange={e => setLine(i, 'penerima', e.target.value)}
                    />
                  </label>
                  <label style={S.field}>
                    Catatan (opsional)
                    <input
                      type="text" value={l.catatan} placeholder="mis. 1 lembar sobek"
                      data-testid={`hc-catatan-${l.receiving_event_id}`}
                      onChange={e => setLine(i, 'catatan', e.target.value)}
                    />
                  </label>
                </div>
              </div>
            ))}
            <div style={{ fontSize: '11.5px', color: '#1f3a34' }} data-testid="handover-confirm-summary">
              <b>Ringkasan:</b> {totals.baris} baris · total diserahkan <b>{totals.total}</b>
            </div>
          </div>
        )}

        {/* LEGACY: penerima header tetap bisa diubah; rincian tidak diklaim. */}
        {!ready && (
          <label style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            Diterima oleh (nama)
            <input type="text" value={penerimaHeader} onChange={e => setPenerimaHeader(e.target.value)} data-testid="hc-header-penerima" />
          </label>
        )}

        {(!validation.ok || errorMsg) && (
          <div data-testid="handover-confirm-error" style={S.err}>
            {errorMsg || validation.errors[0]}
          </div>
        )}

        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button
            type="submit"
            disabled={saving || (ready && (!validation.ok || loading || !!loadError))}
            data-testid="handover-confirm-submit"
          >
            {saving ? 'Menyimpan…' : '✓ Tandai Sudah Diserahkan'}
          </button>
        </div>
      </form>
    </div>
  )
}
