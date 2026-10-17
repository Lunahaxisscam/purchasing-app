// ============================================================
// modules/handovers/queue.jsx — ANTREAN DISTRIBUSI FISIK (3 AKSI)
// ============================================================
// Banner antrean + kartu aksi per handover DRAFT yang notanya sudah lengkap.
// Aksi: Kirim ke Gudang | Kirim ke Tukang | Tandai Diserahkan.
// Logika murni (siapa boleh apa) ada di logic.js; penulisan DB di actions.js.
// File ini hanya tampilan + pemanggilan aksi lewat ctx.
//
// CATATAN STYLE: gaya ditulis inline di sini (objek JS), BUKAN di
// styles/globals.css. globals.css sedang dibentuk ulang oleh sesi paralel
// (lihat kanban card), jadi menambah kelas di sana = titik benturan.
// ============================================================

import { useState } from 'react'
import {
  ACTIONS,
  ACT_TERIMA,
  actionPlan,
  buildDistributionQueue,
  distributionLabel,
  summarizeDistribution
} from './logic'
import { runHandoverAction } from './actions'

// Gaya inline (hindari benturan dengan styles/globals.css milik sesi lain).
const S = {
  card: { border: '1px solid #2a2a35', borderRadius: 10, padding: 12, marginBottom: 10, background: '#16161f' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  title: { display: 'block', fontSize: 14 },
  sub: { display: 'block', fontSize: 12, opacity: 0.75, marginTop: 2 },
  tag: { fontSize: 11, border: '1px solid #3a3a48', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  btn: { fontSize: 13, padding: '7px 12px', cursor: 'pointer' },
  terima: { marginTop: 10, borderTop: '1px dashed #2a2a35', paddingTop: 10 },
  label: { display: 'block', fontSize: 12, marginBottom: 6 },
  input: { display: 'block', width: '100%', maxWidth: 280, marginTop: 4, padding: '6px 8px' },
  row: { display: 'flex', gap: 8, marginTop: 8 },
  banner: { marginBottom: 14 },
  bannerHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }
}

// ------------------------------------------------------------
// KARTU AKSI per baris
// ------------------------------------------------------------
// Ambil pr_items milik nota ini.
// CATATAN: ctx TIDAK mengekspos allPrItems (hanya prop komponen ModuleView,
// dan kontrak ctx tidak boleh diubah). Jadi rute: receiving -> PR asal (lewat
// allRequests yang ADA di ctx) -> pr_items lewat H.prItemsForPr.
function prItemsOf(ctx, receivingId) {
  if (!receivingId) return []
  const rec = (ctx.allReceivings || []).find(r => r && r.id === receivingId) || null
  const prId = rec && rec.purchase_request_id
  if (!prId) return []
  const pr = (ctx.allRequests || []).find(r => r && r.id === prId) || null
  if (!pr) return []
  return ctx.H?.prItemsForPr ? (ctx.H.prItemsForPr(pr.id) || []) : []
}

function ActionCard({ entry, ctx, onDone }) {
  const { refresh, H, say } = ctx
  const { handover, receiving } = entry
  const [busy, setBusy] = useState(false)
  const [showTerima, setShowTerima] = useState(false)
  const [receivedBy, setReceivedBy] = useState('')

  const items = receiving && H?.receivingItemsForReceiving ? H.receivingItemsForReceiving(receiving.id) : []
  const prItems = prItemsOf(ctx, receiving?.id)
  const summary = summarizeDistribution(handover, items, prItems)
  const plan = actionPlan(handover, summary, receiving?.alokasi, receiving)

  const run = async (action) => {
    if (busy) return
    if (action === ACT_TERIMA) {
      setShowTerima(true)
      return
    }
    setBusy(true)
    const res = await runHandoverAction(action, handover.id)
    setBusy(false)
    say(res.message)
    if (res.ok) {
      refresh()
      onDone && onDone()
    }
  }

  const submitTerima = async () => {
    if (busy) return
    setBusy(true)
    const res = await runHandoverAction(ACT_TERIMA, handover.id, { receivedBy })
    setBusy(false)
    if (res.ok) {
      setShowTerima(false)
      say(res.message)
      refresh()
      onDone && onDone()
    } else {
      say(res.message)
    }
  }

  return (
    <div style={S.card} data-testid={`queue-card-${handover.id}`}>
      <div style={S.head}>
        <div>
          <strong style={S.title} data-testid={`queue-title-${handover.id}`}>
            {handover.received_by || 'Serah Terima'}
          </strong>
          <span style={S.sub} data-testid={`queue-summary-${handover.id}`}>
            {distributionLabel(summary)}
          </span>
        </div>
        {receiving?.alokasi ? <span style={S.tag}>{receiving.alokasi}</span> : null}
      </div>

      <div style={S.actions}>
        {plan.map(a => (
          <button
            key={a.key}
            type="button"
            disabled={!a.ok || busy}
            data-testid={`queue-${a.testid}-${handover.id}`}
            title={a.reason || a.label}
            onClick={() => run(a.key)}
            style={S.btn}
          >
            <span aria-hidden="true">{a.icon}</span> {a.label}
          </button>
        ))}
      </div>

      {showTerima && (
        <div style={S.terima} data-testid={`queue-terima-form-${handover.id}`}>
          <label style={S.label}>
            Diterima oleh (opsional)
            <input
              type="text"
              style={S.input}
              value={receivedBy}
              onChange={e => setReceivedBy(e.target.value)}
              data-testid={`queue-terima-nama-${handover.id}`}
              placeholder="Nama penerima"
            />
          </label>
          <div style={S.row}>
            <button type="button" onClick={submitTerima} disabled={busy} data-testid={`queue-terima-ok-${handover.id}`}>
              Konfirmasi
            </button>
            <button type="button" className="outline" onClick={() => setShowTerima(false)}>
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// BANNER ANTREAN (slot ctx.banner / dispatcher handovers)
// ------------------------------------------------------------
export function renderHandoverQueue(ctx) {
  const { rows, allReceivings } = ctx
  if (!Array.isArray(rows)) return null
  const recById = new Map((allReceivings || []).map(r => [r.id, r]))
  const entries = buildDistributionQueue(rows).map(ho => ({
    handover: ho,
    receiving: ho.receiving_id ? (recById.get(ho.receiving_id) || null) : null
  }))
  if (!entries.length) return null

  return (
    <div style={S.banner} data-testid="handover-queue-banner">
      <div style={S.bannerHead}>
        <h3 style={{ margin: 0, fontSize: 15 }}>📦 Antrean Distribusi Fisik</h3>
        <span style={S.sub} data-testid="handover-queue-count">{entries.length} handover menunggu</span>
      </div>
      {entries.map(entry => (
        <ActionCard key={entry.handover.id} entry={entry} ctx={ctx} />
      ))}
    </div>
  )
}

export { ACTIONS }
