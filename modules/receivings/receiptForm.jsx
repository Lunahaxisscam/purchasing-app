// ============================================================
// modules/receivings/receiptForm.jsx — Modal "Terima Barang" (satu alur)
// ============================================================
// Menggantikan panel legacy "Langkah 1 — Cek Fisik Item" + toggle
// "Lihat X item" (arahan DAT: HAPUS, bukan ganti judul). SATU tombol
// "Terima Barang" membuka form per item; input TIDAK menulis DB saat
// mengetik — semua tersimpan sekali lewat tombol "Simpan Penerimaan".
//
// DUA MODE (dipilih dari capability probe, bukan dari asumsi):
//   1) READY  — tabel `receiving_events` + `handover_items` ADA:
//      submit memanggil RPC `receipt_apply_events` (datang/rusak/tujuan/retur
//      per barang tersimpan permanen; qty kumulatif dijaga RPC).
//   2) LEGACY — skema belum ada:
//      perilaku lama dipertahankan: dimensi rusak/tujuan diblok dengan pesan
//      gap eksplisit, NOL tulisan (bukan packing ke kolom note), dan qty
//      datang murni masih bisa disimpan lewat compare-and-swap lama.
//      Ini mencegah "ilusi tersimpan".
//
// ANTI DOBEL: busyRef + tombol disabled + idempotency key deterministik
// (`client_event_id`) + CAS lama untuk mode legacy.
// ============================================================
import React, { useMemo, useRef, useState } from 'react'
import {
  RETUR_NANTI, RETUR_SUPPLIER, RETUR_DIBUANG,
  buildRows, emptyEntry, computeItem, validateForm, buildSavePlan
} from './receiptLogic'
import { saveReceipt, loadItemsFromPr } from './receiptSave'
import { buildEventDrafts } from './receiptEventLogic'
import { applyReceiptEvents } from './receiptEventSave'
import { capabilityMessage } from './receiptCapability'
import { dataUrlByteSize, validateHandoverFotoSize } from '../../lib/constants'

const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : v)

export default function ReceiptForm({ receiving, items, prItems = [], orderedFor, say, refresh, close, capability = null }) {
  const rows = useMemo(() => buildRows(items, orderedFor), [items, orderedFor])
  const ready = !!capability?.ready
  const [entries, setEntries] = useState(() => {
    const init = {}
    for (const r of rows) init[r.id] = emptyEntry()
    return init
  })
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [fotoError, setFotoError] = useState({})
  const [loadingItems, setLoadingItems] = useState(false)
  // Ref guard: dua klik/Enter dalam frame yang sama sebelum state `saving`
  // ter-render tetap hanya memicu satu submit.
  const busyRef = useRef(false)

  const setField = (itemId, field, value) => {
    setEntries(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || emptyEntry()), [field]: value } }))
  }

  const v = validateForm(rows, entries)
  const label = receiving?.invoice_no || receiving?.delivery_note || 'Penerimaan'
  const plan = buildSavePlan(rows, entries)
  // Dimensi per barang (rusak / tujuan / retur) diminta user?
  const needsLedger = v.schemaBlocks.length > 0
  // Mode READY: semua dimensi bisa disimpan. Mode LEGACY: submit tetap
  // diblokir di handler (pesan gap eksplisit, nol tulisan) — tombol TIDAK
  // di-disable supaya user mendapat penjelasan saat menekan (perilaku
  // kontrak t_5196b689 dipertahankan).
  const blockedBySchema = !ready && needsLedger
  // Tombol submit: nonaktif saat menyimpan, tanpa data, atau form invalid
  // (mencegah double submit & payload setengah jadi).
  const canSubmit = !saving && plan.length > 0 && v.valid

  function pickFoto(itemId, file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      const size = dataUrlByteSize(dataUrl)
      const err = validateHandoverFotoSize(size)
      if (err) { setFotoError(prev => ({ ...prev, [itemId]: err })); return }
      setFotoError(prev => ({ ...prev, [itemId]: '' }))
      // Foto TIDAK dikirim sebagai base64 ke DB (arsip Drive belum aktif):
      // hanya nama file sebagai referensi jujur; lihat catatan di UI.
      setField(itemId, 'foto', { nama: file.name || 'foto', dataUrl })
    }
    reader.readAsDataURL(file)
  }

  // Nota lama tanpa rincian item (audit A1): aksi eksplisit memuat item dari PR.
  async function muatItemDariPr() {
    if (saving || loadingItems) return
    setLoadingItems(true)
    setErrorMsg('')
    const res = await loadItemsFromPr({ receiving, prItems, existingItems: items })
    setLoadingItems(false)
    if (!res.ok) { setErrorMsg(res.error); return }
    if (res.already) { say?.('Semua item PR sudah ada di nota ini.'); return }
    say?.(`${res.added} item dimuat dari PR. Isi jumlah datang lalu Simpan Penerimaan.`)
    refresh?.()
  }

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

    // ---- MODE LEGACY: dimensi belum bisa disimpan → blokir, nol tulisan ----
    if (blockedBySchema) {
      setErrorMsg(`Belum dapat disimpan — ${v.schemaBlocks[0]} Data belum ditulis sama sekali; menunggu persetujuan perbaikan skema (receiving_events / handover_items).`)
      return
    }

    busyRef.current = true
    setSaving(true)
    try {
      if (ready) {
        // ---- MODE READY: satu RPC atomik untuk semua dimensi ----
        const drafts = buildEventDrafts(rows, entries, { receivingId: receiving?.id })
        const sisaById = {}
        for (const r of rows) if (r.sisa !== null) sisaById[r.id] = r.sisa
        const res = await applyReceiptEvents({ receiving, drafts, sisaById })
        if (!res.ok) { setErrorMsg(res.error || 'Gagal menyimpan penerimaan.'); return }
        const total = drafts.reduce((s, d) => s + Number(d.qty_datang || 0), 0)
        const dup = res.alreadyApplied ? ` · ${res.alreadyApplied} baris sudah pernah tersimpan (tidak digandakan)` : ''
        say?.(`Penerimaan tersimpan: ${res.applied} baris barang, total datang ${total}${dup}.`)
        close?.()
        refresh?.()
        return
      }

      // ---- MODE LEGACY tanpa dimensi: qty kumulatif via CAS ----
      const res = await saveReceipt({ receiving, plan })
      if (!res.ok) {
        setErrorMsg(res.error || 'Gagal menyimpan penerimaan.')
        return
      }
      const total = plan.reduce((s, p) => s + p.datang, 0)
      say?.(`Penerimaan tersimpan: ${plan.length} item, total datang ${total}${res.dateFilled ? ' · tgl terima diisi' : ''}.`)
      close?.()
      refresh?.()
    } catch (err) {
      setErrorMsg(`Terjadi kesalahan saat menyimpan: ${err.message}`)
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <div className="modal">
      <form className="dialog dialog-wide" onSubmit={submit} data-testid="receipt-form">
        <div className="dialoghead">
          <h2>📦 Terima Barang — {label}</h2>
          <button type="button" className="icon" onClick={close} aria-label="Tutup">×</button>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: '12.5px' }}>
          Isi <b>jumlah datang</b> per item. Jumlah rusak (bila ada) dipisahkan dari jumlah baik;
          jumlah baik boleh dibagi ke Workshop dan/atau diserahkan ke Tukang. Tidak ada yang
          tersimpan sebelum <b>Simpan Penerimaan</b> ditekan.
        </p>

        {/* Status penyimpanan per barang — jujur, dari capability probe. */}
        <div
          data-testid="receipt-capability"
          style={{
            fontSize: '11.5px', borderRadius: '7px', padding: '7px 10px', lineHeight: 1.45,
            background: ready ? '#e6f4ea' : '#fef6e7',
            border: `1px solid ${ready ? '#ceead6' : '#fcdfa6'}`,
            color: ready ? '#137333' : '#7a4a08'
          }}
        >
          {ready
            ? 'Penyimpanan per barang AKTIF: kondisi (baik/rusak), tujuan (Workshop/Tukang), dan status retur dicatat per barang.'
            : capabilityMessage(capability)}
        </div>

        {rows.length === 0 && (
          <div data-testid="receipt-empty" style={{ background: '#fef6e7', border: '1px solid #fcdfa6', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#7a4a08' }}>
            Nota ini belum punya rincian barang (dibuat lewat form Purchase manual).
            {receiving?.purchase_request_id
              ? ' Muat item dari PR terkait supaya jumlah datang bisa dicatat.'
              : ' Nota tidak terhubung ke PR — hubungi admin untuk melengkapi rincian.'}
            {receiving?.purchase_request_id && (
              <div style={{ marginTop: '8px' }}>
                <button type="button" onClick={muatItemDariPr} disabled={saving || loadingItems} data-testid="btn-load-from-pr" style={{ background: '#1f3a34', color: '#fff', border: 'none', borderRadius: '4px', padding: '6px 10px', fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}>
                  {loadingItems ? 'Memuat…' : '⬇ Muat item dari PR'}
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {rows.map(row => {
            const entry = entries[row.id] || emptyEntry()
            const errs = v.itemErrors[row.id] || {}
            const c = v.itemComputed[row.id] || computeItem(row, entry)
            const hasRusak = isFinite(c.r) && c.r > 0
            const retur = entry.retur || RETUR_NANTI
            return (
              <div key={row.id} data-testid={`receipt-item-${row.id}`} style={{ border: '1px solid #d5e0dc', borderRadius: '8px', padding: '10px 12px', background: '#fbfdfc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: '13px' }}>{row.item_name}</b>
                  <span style={{ fontSize: '11.5px', color: '#556b65' }}>
                    Dipesan: <b>{fmt(row.ordered)}{row.unit ? ` ${row.unit}` : ''}</b>
                    {row.ordered !== null && row.prevCum > 0 ? <> · Sudah diterima: <b>{row.prevCum}{row.unit ? ` ${row.unit}` : ''}</b></> : null}
                    {row.sisa !== null ? <> · Sisa: <b>{row.sisa}{row.unit ? ` ${row.unit}` : ''}</b></> : null}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginTop: '8px' }}>
                  <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    Jumlah datang {row.unit ? `(${row.unit})` : ''}
                    <input
                      type="number" min="0" step="any" inputMode="decimal"
                      value={entry.datang} placeholder="0"
                      data-testid={`datang-${row.id}`}
                      onChange={e => setField(row.id, 'datang', e.target.value)}
                    />
                    {errs.datang && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.datang}</span>}
                  </label>
                  <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    Jumlah rusak {row.unit ? `(${row.unit})` : ''}
                    <input
                      type="number" min="0" step="any" inputMode="decimal"
                      value={entry.rusak} placeholder="0"
                      data-testid={`rusak-${row.id}`}
                      onChange={e => setField(row.id, 'rusak', e.target.value)}
                    />
                    {errs.rusak && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.rusak}</span>}
                  </label>
                  <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    Simpan di Workshop
                    <input
                      type="number" min="0" step="any" inputMode="decimal"
                      value={entry.ws} placeholder="0"
                      data-testid={`ws-${row.id}`}
                      onChange={e => setField(row.id, 'ws', e.target.value)}
                    />
                    {errs.ws && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.ws}</span>}
                  </label>
                  <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    Serahkan ke Tukang
                    <input
                      type="number" min="0" step="any" inputMode="decimal"
                      value={entry.tukang} placeholder="0"
                      data-testid={`tukang-${row.id}`}
                      onChange={e => setField(row.id, 'tukang', e.target.value)}
                    />
                    {errs.tukang && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.tukang}</span>}
                  </label>
                </div>

                {(c.tk > 0 || errs.penerima) && (
                  <label style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '8px' }}>
                    Nama penerima tukang (wajib)
                    <input
                      type="text" value={entry.penerima} placeholder="Contoh: Pak Joko (Mandor)"
                      data-testid={`penerima-${row.id}`}
                      onChange={e => setField(row.id, 'penerima', e.target.value)}
                    />
                    {errs.penerima && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.penerima}</span>}
                  </label>
                )}

                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '8px', fontSize: '11.5px', color: '#1f3a34' }}>
                  <span>Baik: <b data-testid={`baik-${row.id}`}>{isFinite(c.baik) ? c.baik : '—'}</b>{row.unit ? ` ${row.unit}` : ''}</span>
                  <span>Belum datang: <b data-testid={`belum-${row.id}`}>{c.belum === null ? '—' : c.belum}</b>{row.unit && c.belum !== null ? ` ${row.unit}` : ''}</span>
                  <span>Tujuan terisi: <b>{isFinite(c.tujuan) ? c.tujuan : '—'}</b> / {isFinite(c.baik) ? c.baik : '—'}</span>
                </div>
                {errs.tujuan && <div style={{ color: '#c93b2b', fontSize: '11px', marginTop: '3px' }}>{errs.tujuan}</div>}

                {hasRusak && (
                  <div style={{ marginTop: '10px', padding: '8px 10px', background: '#fef6e7', border: '1px solid #fcdfa6', borderRadius: '6px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#a15309', marginBottom: '5px' }}>
                      Barang rusak: {c.r}{row.unit ? ` ${row.unit}` : ''} — tidak masuk stok / tidak ikut diserahkan
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '11.5px' }}>
                      <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="radio" name={`retur-${row.id}`} checked={retur === RETUR_NANTI} onChange={() => setField(row.id, 'retur', RETUR_NANTI)} />
                        Tentukan nanti
                      </label>
                      <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="radio" name={`retur-${row.id}`} checked={retur === RETUR_SUPPLIER} onChange={() => setField(row.id, 'retur', RETUR_SUPPLIER)} data-testid={`retur-supplier-${row.id}`} />
                        Kembalikan ke Supplier (menunggu dikembalikan)
                      </label>
                      <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <input type="radio" name={`retur-${row.id}`} checked={retur === RETUR_DIBUANG} onChange={() => setField(row.id, 'retur', RETUR_DIBUANG)} data-testid={`retur-buang-${row.id}`} />
                        Dibuang
                      </label>
                    </div>
                    {retur === RETUR_SUPPLIER && (
                      <div style={{ fontSize: '11px', color: '#a15309', marginTop: '4px' }}>
                        Status dicatat sebagai <b>menunggu dikembalikan</b> — bukan berarti sudah dikembalikan ke supplier.
                      </div>
                    )}
                    {retur === RETUR_DIBUANG && (
                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '11.5px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                          📷 Bukti foto (opsional, maks 2MB)
                          <input
                            type="file" accept="image/*"
                            data-testid={`foto-${row.id}`}
                            onChange={e => pickFoto(row.id, e.target.files?.[0])}
                          />
                        </label>
                        {entry.foto?.dataUrl && (
                          <img src={entry.foto.dataUrl} alt="Pratinjau bukti foto barang dibuang" style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #cbd8d4' }} />
                        )}
                        {fotoError[row.id] && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{fotoError[row.id]}</span>}
                        {/* KOREKSI DAT (16 Okt): foto tidak memblokir transaksi.
                            Arsip Drive (PLAYFIELD/BROKOLI - OPERATIONS/Arsip Bukti
                            Purchasing, persiapan t_79391975) BELUM terintegrasi —
                            jangan mengklaim foto sudah tersimpan. */}
                        <div data-testid={`foto-note-${row.id}`} style={{ fontSize: '10.5px', color: '#8a6d1f', background: '#fdf8ea', border: '1px solid #f0dcb4', borderRadius: '4px', padding: '4px 7px' }}>
                          {entry.foto
                            ? 'Pratinjau saja — arsip foto (Drive) belum aktif di sistem ini, jadi foto ini belum tersimpan permanen. Yang disimpan hanya NAMA file sebagai rujukan; transaksi tetap bisa disimpan tanpa foto.'
                            : 'Foto tidak wajib. Kalau memilih foto, arsip otomatis ke Drive belum aktif — foto belum tersimpan permanen dan transaksi tetap bisa disimpan tanpa foto.'}
                        </div>
                        <label style={{ fontSize: '11.5px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input type="checkbox" checked={!!entry.konfirmasiBuang} onChange={e => setField(row.id, 'konfirmasiBuang', e.target.checked)} />
                          Saya konfirmasi barang ini benar-benar dibuang.
                        </label>
                        {errs.konfirmasiBuang && <span style={{ color: '#c93b2b', fontSize: '11px' }}>{errs.konfirmasiBuang}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Ringkasan akhir — satu-satunya tempat angka digabung */}
        <div data-testid="receipt-summary" style={{ background: '#eef3f1', border: '1px solid #cbd8d4', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#1f3a34' }}>
          <b>Ringkasan penerimaan ini:</b> {v.summary.itemTerisi} item terisi · datang <b>{v.summary.totalDatang}</b> ·
          rusak <b>{v.summary.totalRusak}</b> · baik <b>{v.summary.totalBaik}</b> · ke Workshop <b>{v.summary.totalWs}</b> ·
          ke Tukang <b>{v.summary.totalTukang}</b> · belum datang <b>{v.summary.totalBelum}</b>.
        </div>

        {/* Gap skema HANYA ditampilkan di mode legacy (di mode READY dimensi
            ini tersimpan — tidak ada alasan menakut-nakuti user). */}
        {!ready && v.schemaBlocks.length > 0 && (
          <div data-testid="schema-gap-note" style={{ background: '#fef6e7', border: '1px solid #fcdfa6', borderRadius: '8px', padding: '10px 12px', fontSize: '11.5px', color: '#7a4a08' }}>
            <b>⚠️ Butuh persetujuan perbaikan skema (tidak ada data yang ditulis setengah):</b>
            <ul style={{ margin: '5px 0 0 18px', padding: 0 }}>
              {v.schemaBlocks.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
            <div style={{ marginTop: '5px' }}>
              Usulan: tabel <code>receiving_events</code> (datang/rusak/tujuan/retur per event, append-only) +
              <code> handover_items</code> (rincian barang per penyerahan). Tanpa persetujuan DAT, dimensi ini belum disimpan.
            </div>
          </div>
        )}

        {(errorMsg || v.globalErrors.length > 0) && (
          <div data-testid="receipt-error" style={{ color: '#c93b2b', fontSize: '12px', fontWeight: 600 }}>
            {errorMsg || v.globalErrors[0]}
          </div>
        )}

        <div className="actions">
          <button type="button" className="outline" onClick={close}>Batal</button>
          <button type="submit" disabled={!canSubmit} data-testid="receipt-submit">
            {saving ? 'Menyimpan…' : 'Simpan Penerimaan'}
          </button>
        </div>
      </form>
    </div>
  )
}
