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
import { capabilityMessage, capabilityState } from '../receivings/receiptCapability'
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
  // TIGA keadaan (defect run 212 / BUG-R1): `null` = probe BELUM SELESAI,
  // BUKAN LEGACY. Di LEGACY form ini MENULIS `diserahkan_at` tanpa rincian dan
  // mengunci dokumen permanen (CAS), jadi jendela probe tidak boleh dianggap
  // LEGACY. Hanya `ready:false` yang benar-benar hasil probe (skema belum ada)
  // yang boleh memakai jalur tulis header.
  const capState = capabilityState(capability)
  const ready = capState === 'ready'
  const legacy = capState === 'legacy'
  const pending = capState === 'unknown' || capState === 'error'
  // `loadedFor` = kunci pemuatan yang SUDAH selesai (berhasil atau gagal).
  // Dulu `loading` diinisialisasi `useState(ready)`; saat capability berubah
  // null→ready (jendela probe) `loading` tetap false selama satu render,
  // sehingga panel "tidak ada alokasi" + tombol header-only SEMPAT aktif
  // sebelum baris termuat — admin bisa mengunci dokumen tanpa rincian.
  // Sekarang `loading` diturunkan dari kunci: tidak ada frame yang mengklaim
  // "tidak ada baris" sebelum pemuatan untuk receiving INI benar-benar selesai.
  const loadKey = ready && handover?.receiving_id ? `${handover.id}:${handover.receiving_id}` : ''
  const [loadedFor, setLoadedFor] = useState('')
  const [loadError, setLoadError] = useState('')
  const [prefill, setPrefill] = useState([])
  const [lines, setLines] = useState([])
  const [penerimaHeader, setPenerimaHeader] = useState(handover?.received_by || '')
  const [errorMsg, setErrorMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const key = loadKey
    async function load() {
      if (!key) return
      setLoadError('')
      const ev = await loadReceivingEvents({ receivingId: handover.receiving_id })
      if (cancelled) return
      if (!ev.ok) { setLoadError(ev.error); setLoadedFor(key); return }
      const ids = (ev.events || []).map(e => e.id)
      const del = await loadDeliveredByEvent({ eventIds: ids })
      if (cancelled) return
      if (!del.ok) { setLoadError(del.error); setLoadedFor(key); return }
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
      setLoadedFor(key)
    }
    load()
    return () => { cancelled = true }
  }, [loadKey, handover?.receiving_id, handover?.id])

  // Turunan, bukan state: tidak ada frame "sudah selesai memuat" yang salah.
  const loading = !!loadKey && loadedFor !== loadKey

  const totals = useMemo(() => {
    const total = lines.reduce((s, l) => s + (Number(l.qty_diserahkan) || 0), 0)
    const filled = lines.filter(l => Number(l.qty_diserahkan) > 0).length
    return { baris: lines.length, total, filled }
  }, [lines])

  const validation = ready
    ? validateHandoverLines(lines, prefill)
    : { ok: true, errors: [], lines: [], skipped: [], remainder: 0 }
  // Baris yang dilewati / diserahkan sebagian. RPC mengunci dokumen ini, jadi
  // sisanya HARUS dicatat lewat dokumen Serah Terima baru — dikatakan di sini,
  // bukan setelah admin menekan Simpan dan kehilangan sisanya (run 202).
  const sisaInfo = useMemo(() => {
    const list = validation.skipped || []
    const total = Number(validation.remainder) || 0
    return { list, total, ada: list.length > 0 }
  }, [validation])

  function setLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  // Konfirmasi TANPA rincian: hanya waktu penyerahan (status + diserahkan_at).
  // Dipakai saat READY tetapi tidak ada baris alokasi tukang untuk di-prefill —
  // jalur yang sebelumnya mati (defect run 190). Nama penerima WAJIB, sama
  // seperti jalur LEGACY, supaya bukti serah terima tetap bisa
  // dipertanggungjawabkan.
  async function submitHeaderOnly() {
    if (saving) return
    setErrorMsg('')
    const nama = String(penerimaHeader || '').trim()
    if (!nama) { setErrorMsg('Nama penerima wajib diisi sebelum menandai diserahkan.'); return }
    setSaving(true)
    try {
      const res = await markHandoverDelivered({ handover, receivedBy: nama })
      if (!res.ok) { setErrorMsg(res.error); return }
      say?.(res.already
        ? 'Serah terima ini sudah ditandai diserahkan sebelumnya.'
        : 'Serah terima ditandai sudah diserahkan (waktu penyerahan tercatat). Rincian per barang tidak ditulis karena tidak ada alokasi ke tukang pada penerimaan ini.')
      close?.()
      refresh?.()
    } finally {
      setSaving(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setErrorMsg('')
    // JENDELA PROBE (run 212 / BUG-R1): capability belum diketahui atau probe
    // gagal → JANGAN menulis apa pun. Dulu jalur LEGACY dipakai di sini dan
    // mengunci dokumen tanpa rincian, permanen.
    if (pending) {
      setErrorMsg(capabilityMessage(capability))
      return
    }
    if (ready) {
      if (!validation.ok) { setErrorMsg(validation.errors[0]); return }
      setSaving(true)
      try {
        const res = await confirmHandoverLines({ handover, lines: validation.lines })
        if (!res.ok) { setErrorMsg(res.error); return }
        // Sisa yang belum diserahkan HARUS disebut: dokumen ini terkunci setelah
        // simpan, jadi sisanya hanya bisa dicatat lewat dokumen baru (run 202).
        const sisaMsg = sisaInfo.ada
          ? ` Sisa ${sisaInfo.total} unit belum diserahkan — catat lewat dokumen Serah Terima BARU untuk penerimaan yang sama (dokumen ini sudah terkunci).`
          : ''
        say?.(res.already
          ? 'Serah terima ini sudah ditandai diserahkan sebelumnya — tidak ada data yang digandakan.'
          : `Serah terima tersimpan: ${res.inserted} baris barang diserahkan (${totals.total} unit).${sisaMsg}`)
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
      const res = await markHandoverDelivered({ handover, receivedBy: String(penerimaHeader || '').trim() })
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
          data-capability-state={capState}
          style={{
            ...S.note,
            background: ready ? '#e6f4ea' : (pending ? '#eef3f1' : '#fef6e7'),
            border: `1px solid ${ready ? '#ceead6' : (pending ? '#cbd8d4' : '#fcdfa6')}`,
            color: ready ? '#137333' : (pending ? '#1f3a34' : '#7a4a08')
          }}
        >
          {ready
            ? 'Rincian per barang AKTIF: baris di bawah diisi otomatis dari penerimaan (alokasi ke tukang) dikurangi yang sudah diserahkan — Anda hanya memverifikasi jumlah fisik. Kosongkan jumlah untuk barang yang BELUM benar-benar diterima; baris itu dilewati, bukan dipaksa nol.'
            : pending
              ? capabilityMessage(capability)
              : `${capabilityMessage(capability)} Konfirmasi di sini hanya mencatat waktu penyerahan (header), tanpa rincian barang.`}
        </div>

        {/* Jendela probe / probe gagal: dikatakan apa adanya, dan tombol tulis
            di bawah NONAKTIF. Tidak ada jalur tulis yang tersembunyi. */}
        {pending && (
          <div data-testid="handover-confirm-waiting" style={{ ...S.note, background: '#eef3f1', border: '1px solid #cbd8d4', color: '#1f3a34' }}>
            {capState === 'unknown'
              ? 'Memeriksa kesiapan skema… tombol simpan akan aktif setelah pemeriksaan selesai. Tidak ada data yang ditulis sekarang.'
              : 'Pemeriksaan skema gagal — tutup lalu buka lagi form ini. Tidak ada data yang ditulis.'}
          </div>
        )}

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
            atau konfirmasi header saja (tanpa rincian) lewat tombol di bawah bila memang tidak ada rincian yang bisa dicatat.
          </div>
        )}

        {/* KONFIRMASI TANPA RINCIAN — jalur keluar yang NYATA.
            Defect run 190: teks di atas menyuruh "konfirmasi header saja",
            tetapi satu-satunya tombol submit membaca `validation.ok`, yang
            selalu false saat tidak ada baris → tombol mati dan tidak ada
            input header. Akibatnya handover tanpa alokasi tukang (termasuk
            handover lama tanpa receiving_id) TIDAK BISA dikonfirmasi sama
            sekali di mode READY — padahal mode LEGACY bisa.
            Tombol ini eksplisit: ia mencatat `diserahkan_at` + status saja,
            dan mengatakannya apa adanya (tidak mengklaim rincian tersimpan). */}
        {ready && !loading && !loadError && lines.length === 0 && (
          <div data-testid="handover-confirm-headeronly" style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px dashed #d5e0dc', paddingTop: '10px' }}>
            <label style={S.field}>
              Diterima oleh (nama) — wajib untuk konfirmasi tanpa rincian
              <input
                type="text"
                value={penerimaHeader}
                placeholder="Contoh: Pak Joko (Mandor)"
                data-testid="hc-header-penerima"
                onChange={e => setPenerimaHeader(e.target.value)}
              />
            </label>
            <div style={S.hint}>
              Tombol ini mencatat <b>waktu penyerahan</b> saja. Rincian per barang
              TIDAK ditulis karena tidak ada alokasi ke tukang pada penerimaan ini.
            </div>
            <button
              type="button"
              data-testid="handover-confirm-headeronly-submit"
              disabled={saving || !penerimaHeader.trim()}
              onClick={submitHeaderOnly}
            >
              {saving ? 'Menyimpan…' : '✓ Tandai Sudah Diserahkan (tanpa rincian)'}
            </button>
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
              {sisaInfo.ada ? <> · <b>{sisaInfo.total} unit belum diserahkan</b></> : null}
            </div>
            {/* Peringatan SEBELUM simpan (run 202): dokumen ini dikunci saat
                disimpan (RPC CAS `diserahkan_at`), jadi sisa hanya bisa dicatat
                lewat dokumen Serah Terima BARU. Dulu hal ini baru ketahuan
                setelah simpan — atau lebih buruk, admin mengisi qty palsu agar
                bisa menyimpan. */}
            {sisaInfo.ada && (
              <div data-testid="handover-confirm-remainder" style={{ ...S.note, background: '#fdf8ea', border: '1px solid #f0dcb4', color: '#7a4a08' }}>
                <b>{sisaInfo.list.length} baris belum diserahkan penuh ({sisaInfo.total} unit):</b>
                <ul style={{ margin: '5px 0 0', paddingLeft: '18px' }}>
                  {sisaInfo.list.map(s => (
                    <li key={`${s.receiving_event_id}-${s.partial ? 'p' : 's'}`}>
                      {s.item_name} — sisa {s.qty_sisa}{s.satuan ? ` ${s.satuan}` : ''}
                      {s.partial ? ' (diserahkan sebagian)' : ' (dilewati)'}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: '5px' }}>
                  Setelah disimpan, dokumen ini <b>terkunci</b>. Sisa di atas dicatat lewat
                  <b> dokumen Serah Terima baru</b> untuk penerimaan yang sama — buat dari menu
                  Serah Terima setelah ini. Kosongkan jumlah bila barangnya memang belum diterima
                  (jangan diisi angka supaya bisa menyimpan).
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEGACY: penerima header tetap bisa diubah; rincian tidak diklaim.
            HANYA saat probe benar-benar selesai (legacy) — bukan saat probe
            masih berjalan (pending), karena di jendela itu tidak boleh ada
            jalur tulis sama sekali. */}
        {legacy && (
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
            disabled={saving || pending || (ready && (!validation.ok || loading || !!loadError))}
            title={pending ? capabilityMessage(capability) : undefined}
            data-testid="handover-confirm-submit"
          >
            {pending ? 'Memeriksa kesiapan skema…' : (saving ? 'Menyimpan…' : '✓ Tandai Sudah Diserahkan')}
          </button>
        </div>
      </form>
    </div>
  )
}
