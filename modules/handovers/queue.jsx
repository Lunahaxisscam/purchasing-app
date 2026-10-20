// ============================================================
// modules/handovers/queue.jsx — ANTREAN DISTRIBUSI FISIK (3 AKSI UTAMA)
// ============================================================
// t_b03c5228 (S2/7, arahan DAT) — DIPADATKAN & TANGGUNG JAWAB DIPISAH:
//   Purchase berhenti di "barang dibeli". Modul ini SATU-SATUNYA tempat
//   keputusan fisik barang, dalam TIGA aksi satu baris:
//     📦 Masuk Stok Gudang · 👷 Serah Terima ke Tukang · ⚠ Bermasalah
//   "Bermasalah" (Retur/Refund) sengaja TIDAK ditonjolkan — ia jalan keluar
//   untuk barang cacat/salah kirim, bukan langkah normal.
//   Konfirmasi "barang sudah diterima di lokasi" tetap ada sebagai LANGKAH
//   PENUTUP (bukan aksi keempat yang setara) karena bukti fisik = diserahkan_at.
//
// Yang TIDAK ditampilkan (status teknis disembunyikan):
//   - kode status mentah (KE_GUDANG / KE_TUKANG / LANGSUNG_LAPANGAN,
//     DI_GUDANG / DI_TUKANG / RECEIVED, NORMAL / RETUR / REFUND) — nilai DB
//     tetap dipakai untuk penjaga tombol, tetapi user hanya melihat kalimat
//     manusia ("Tujuan: Tukang", "⚠ Nota bermasalah").
//
// Yang DIPERTAHANKAN (jangan hilang saat memadatkan):
//   - rincian barang (dari nota pembelian) + label jujur
//     "Rincian barang belum tersedia" bila memang tidak ada datanya.
//   - fallback data lama: handover tanpa receiving_id tetap tampil apa adanya,
//     aksinya dinonaktifkan dengan ALASAN yang bisa dibaca (bukan tombol mati
//     tanpa penjelasan).
//
// BATAS KONTRAK (jangan diubah tanpa Tech Lead):
//   - logic.js tetap SATU-SATUNYA sumber aturan aksi (actionPlan dst.).
//   - actions.js tetap SATU-SATUNYA penulis DB aksi gudang/tukang/terima.
//   - "Bermasalah" TIDAK menulis DB dari file ini: ia memakai handler yang
//     sudah ada di shell (ctx.onReceivingStatusChange → pages/index.js
//     updateReceivingStatus, kolom receivings.status + receivings.kendala).
//     Tidak ada kolom/tabel baru, tidak ada migrasi.
//
// CATATAN STYLE: gaya ditulis inline di sini (objek JS), BUKAN di
// styles/globals.css (file itu bukan milik modul ini).
// ============================================================

import React, { useState } from 'react'
import {
  ACTIONS,
  ACT_GUDANG,
  ACT_TUKANG,
  ACT_TERIMA,
  actionPlan,
  buildDistributionQueue,
  distributionLabel,
  summarizeDistribution
} from './logic'
import { runHandoverAction } from './actions'
import { RINCIAN_BELUM_TERSEDIA } from './display'
import { openPhysicalModal } from './physicalModal'
import { PhysicalModalHost } from './physicalHost'
import { getReceiptCapability } from '../receivings/receiptCapability'

// Gaya inline (hindari benturan dengan styles/globals.css milik sesi lain).
const S = {
  card: { border: '1px solid #2a2a35', borderRadius: 10, padding: 12, marginBottom: 10, background: '#16161f' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  title: { display: 'block', fontSize: 14 },
  sub: { display: 'block', fontSize: 12, opacity: 0.75, marginTop: 2 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'flex-end' },
  tag: { fontSize: 11, border: '1px solid #3a3a48', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' },
  warnTag: { fontSize: 11, border: '1px solid #a15309', color: '#e8a33d', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  btn: { fontSize: 13, padding: '7px 12px', cursor: 'pointer' },
  subtleBtn: {
    fontSize: 11.5,
    padding: '4px 9px',
    cursor: 'pointer',
    background: 'transparent',
    color: '#b9a17a',
    border: '1px dashed #4a4136',
    borderRadius: 6,
    lineHeight: 1.2
  },
  panel: { flexBasis: '100%', border: '1px solid #3a3a48', borderRadius: 8, padding: 10, marginTop: 2, background: '#12121a' },
  panelText: { fontSize: 11.5, lineHeight: 1.45, opacity: 0.9 },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  finish: { marginTop: 10, borderTop: '1px dashed #2a2a35', paddingTop: 10 },
  finishLabel: { display: 'block', fontSize: 11.5, opacity: 0.75, marginBottom: 6 },
  detailToggle: { marginTop: 10, background: 'transparent', border: 'none', color: '#8fb0a6', fontSize: 11.5, cursor: 'pointer', padding: 0 },
  detail: { marginTop: 6, borderTop: '1px dashed #2a2a35', paddingTop: 8, fontSize: 11.5, lineHeight: 1.5 },
  detailLine: { display: 'block', opacity: 0.9 },
  banner: { marginBottom: 14 },
  bannerHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 },
  label: { display: 'block', fontSize: 12, marginBottom: 6 },
  input: { display: 'block', width: '100%', maxWidth: 280, marginTop: 4, padding: '6px 8px' }
}

// ------------------------------------------------------------
// LABEL MANUSIA untuk nilai teknis (dipakai juga oleh view.jsx)
// ------------------------------------------------------------
// Nilai `receivings.alokasi` adalah kode DB. User tidak boleh melihat kode
// mentah ("KE_TUKANG") — cukup tujuannya.
export function alokasiLabel(alokasi) {
  const up = String(alokasi || '').trim().toUpperCase()
  if (up === 'KE_GUDANG') return 'Gudang'
  if (up === 'KE_TUKANG') return 'Tukang'
  if (up === 'LANGSUNG_LAPANGAN') return 'Langsung ke lapangan'
  return ''
}

// Apakah nota sudah ditandai bermasalah (Retur/Refund/Rusak) — dibaca dari
// kolom yang SUDAH ADA (receivings.status / receivings.kendala).
export function isProblemNoted(receiving) {
  if (!receiving) return false
  const st = String(receiving.status || '').toUpperCase()
  const kd = String(receiving.kendala || '').toUpperCase()
  return !!kd || st === 'RETUR' || st === 'REFUND' || st === 'RUSAK' || st.startsWith('KENDALA')
}

// ------------------------------------------------------------
// RENCANA AKSI "BERMASALAH" (retur / refund)
// ------------------------------------------------------------
// Mengembalikan { ok, reason }. reason selalu kalimat yang bisa dibaca user:
// bila aksi tidak bisa dijalankan, UI menampilkan ALASANNYA (bukan tombol
// mati tanpa penjelasan, dan bukan klaim palsu bahwa sudah tersimpan).
//
// Aturan (semua berasal dari keterbatasan nyata, bukan pilihan gaya):
//   1. Tidak ada nota (data lama / handover orphan) -> tidak ada yang bisa
//      ditandai. TIDAK mengarahkan ke modul Purchase: Purchase berhenti di
//      "barang dibeli" dan form penerimaan fisik sudah dibuang (arahan DAT).
//      Instruksi = rekonsiliasi manual yang jujur di Handover.
//   2. Nota sudah bermasalah -> jangan tandai dua kali.
//   3. Handler shell tidak tersedia -> jangan berpura-pura bisa menulis.
//   4. Nota tanpa rincian barang -> tidak jelas barang mana yang bermasalah.
//   5. Nota multi-item -> `updateReceivingStatus` di shell MENOLAK mengubah
//      status parent (bisa meng-override kondisi barang anak); pencatatan
//      per barang menunggu skema. Ditampilkan apa adanya + jalur rekonsiliasi.
//
// REVISI integrasi t_35cd0354 (temuan Brooklyn REVIEW-02 P1): semua alasan
// yang dulu berbunyi "catat lewat modul Purchase" DIGANTI instruksi
// reconciliation manual di Handover, karena modul Purchase sudah tidak punya
// form fisik. Teks ini juga dipakai assertion test (lihat
// scripts/handover-compact-test/queue_ui_test.mjs A11l/A11m).
export const RECON_NOTE = 'Catat masalahnya di kolom Catatan handover ini, lalu eskalasi ke admin untuk rekonsiliasi manual dengan supplier (nota koreksi/kredit).'

// `ledgerReady` = tabel ledger per barang (receiving_events/handover_items/
// return_lines) sudah ADA. Saat true, retur per barang TIDAK lagi diblokir
// oleh keterbatasan skema — modal retur mengambil baris dari event rusak.
// Saat false, perilaku lama dipertahankan apa adanya (alasan jujur, nol tulis).
export function problemPlan(receiving, itemCount = 0, hasHandler = true, ledgerReady = false) {
  if (!receiving) {
    return { ok: false, reason: `Dokumen ini belum terhubung ke nota pembelian, jadi tidak ada barang yang bisa diretur. ${RECON_NOTE}` }
  }
  if (isProblemNoted(receiving)) {
    return { ok: false, reason: 'Nota ini sudah ditandai bermasalah (Retur/Refund) — tidak bisa ditandai dua kali.' }
  }
  // Ledger per barang aktif → retur dicatat per barang lewat modal (bukan
  // status header), jadi batas "satu item per nota" tidak berlaku lagi.
  if (ledgerReady) {
    return { ok: true, reason: '', perLine: true }
  }
  if (!hasHandler) {
    return { ok: false, reason: 'Aksi bermasalah tidak tersedia di tampilan ini (pencatatan status nota hanya dari halaman utama).' }
  }
  const n = Number(itemCount) || 0
  if (!n) {
    return { ok: false, reason: `Nota ini belum punya rincian barang, jadi tidak jelas barang mana yang bermasalah. ${RECON_NOTE}` }
  }
  if (n >= 2) {
    return { ok: false, reason: `Nota multi-item: Retur/Refund dicatat per barang, dan penyimpanan per barang belum aktif (menunggu persetujuan skema). ${RECON_NOTE}` }
  }
  return { ok: true, reason: '' }
}

// Pilihan tindakan bermasalah. Kunci = nilai kolom receivings.status yang
// sudah dipakai sistem (NORMAL/RETUR/REFUND) — tidak ada nilai baru.
export const PROBLEM_OPTIONS = [
  { key: 'RETUR', label: '↩ Retur ke Supplier' },
  { key: 'REFUND', label: '💸 Refund' }
]

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

function ActionCard({ entry, ctx, onDone, cap }) {
  const { refresh, H, say } = ctx
  const { handover, receiving } = entry
  const [busy, setBusy] = useState(false)
  const [showTerima, setShowTerima] = useState(false)
  const [receivedBy, setReceivedBy] = useState('')
  const [showProblem, setShowProblem] = useState(false)
  const [showDetail, setShowDetail] = useState(false)

  const items = receiving && H?.receivingItemsForReceiving ? H.receivingItemsForReceiving(receiving.id) : []
  const prItems = prItemsOf(ctx, receiving?.id)
  const summary = summarizeDistribution(handover, items, prItems)
  const plan = actionPlan(handover, summary, receiving?.alokasi, receiving)
  const dest = alokasiLabel(receiving?.alokasi)
  const problemNoted = isProblemNoted(receiving)
  const ledgerReady = !!cap?.ready
  const returnReady = !!cap?.returnReady
  const problem = problemPlan(receiving, items.length, typeof ctx.onReceivingStatusChange === 'function', returnReady)

  // Lapisan tampilan DI ATAS actionPlan (logic.js tidak diubah):
  //  a) nota yang sudah bermasalah tidak ditawari distribusi — sejalan dengan
  //     penjaga DB yang sudah ada (RPC `receive_to_warehouse` menolak nota
  //     Retur/Refund), jadi tombol mati di sini tidak menutup jalur nyata;
  //  b) handover tanpa nota pembelian (data lama / orphan) tidak punya barang
  //     untuk dipindahkan. Sebelumnya tombolnya AKTIF dan aksi akan "berhasil"
  //     tanpa mengubah apa pun (loadContext → receiving null → 0 baris) —
  //     klaim palsu. Sekarang nonaktif dengan alasan yang bisa dibaca.
  const gated = plan.map(a => {
    // ---- DEFECT run 206: "Tandai Diserahkan" mati total di mode READY ----
    // `actionPlan` (logic.js) menentukan aksi TERIMA dari `summary.done`, yaitu
    // status `pr_items` (DI_GUDANG/DI_TUKANG) — dimensi DISTRIBUSI legacy.
    // Sejak alokasi ke tukang dicatat per barang di form Terima Barang
    // (`receiving_events.tujuan_tukang`), `pr_items.status` TIDAK ikut berubah.
    // Akibatnya tombol penutup selalu nonaktif ("Belum ada barang yang
    // didistribusikan") padahal ada 2 barang menunggu diserahkan — dan
    // satu-satunya jalan membuka konfirmasi per barang jadi buntu.
    // Di mode READY kebenaran bukti fisik ada di event + kuota tukang yang
    // divalidasi RPC `handover_confirm`; modalnya sendiri yang memutuskan
    // (termasuk menolak bila tidak ada baris). Jadi gerbangnya diserahkan ke
    // modal — bukan ditebak dari status nota.
    if (a.key === ACT_TERIMA && ledgerReady) {
      if (handover?.diserahkan_at) return a
      // Tidak disaring lagi di sini: modal konfirmasi sudah punya jalur yang
      // benar untuk SEMUA keadaan — baris prefill bila ada alokasi tukang,
      // panel "tidak ada alokasi" + konfirmasi header-only bila tidak ada,
      // dan penolakan jelas bila rincian gagal dimuat. Menyaring lagi di sini
      // hanya menutup jalan keluar yang sudah diperbaiki di run 190.
      return { ...a, ok: true, reason: 'Buka konfirmasi per barang — jumlah fisik diverifikasi di sana.' }
    }
    if (a.key !== ACT_GUDANG && a.key !== ACT_TUKANG) return a
    if (problemNoted) {
      return { ...a, ok: false, reason: 'Nota sudah ditandai bermasalah (Retur/Refund) — barang tidak didistribusikan.' }
    }
    if (!receiving) {
      return { ...a, ok: false, reason: 'Belum terhubung ke nota pembelian — tidak ada barang yang bisa didistribusikan. Rekonsiliasi manual: catat di Catatan handover lalu eskalasi ke admin.' }
    }
    return a
  })

  // Baris aksi fisik: 2 aksi utama (gudang + tukang) lalu Bermasalah sebagai
  // aksi ketiga yang tidak ditonjolkan. "Tandai diserahkan" dipisah menjadi
  // langkah penutup di bawah kartu.
  const primary = gated.filter(a => a.key === ACT_GUDANG || a.key === ACT_TUKANG)
  const finish = gated.find(a => a.key === ACT_TERIMA)

  const run = async (action) => {
    if (busy) return
    if (action === ACT_TERIMA) {
      // Ledger per barang AKTIF → konfirmasi per item (prefill dari penerimaan,
      // bukan mengetik ulang). LEGACY → form header lama di bawah.
      if (ledgerReady) {
        openPhysicalModal({ kind: 'confirm', handover })
        return
      }
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
    // Nama penerima WAJIB (temuan Brooklyn REVIEW-02 P1): bukti serah terima
    // tanpa nama tidak bisa dipertanggungjawabkan. Tidak mengirim request
    // sama sekali bila kosong — bukan sekadar tombol yang dinonaktifkan.
    if (!receivedBy.trim()) {
      say('Nama penerima wajib diisi sebelum menandai diserahkan.')
      return
    }
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

  // Bermasalah: bila ledger per barang AKTIF, buka modal Retur yang mengambil
  // baris dari event rusak (tanpa ketik ulang, anti double-retur). Bila belum,
  // perilaku lama dipertahankan: status header lewat handler shell.
  const tandaiBermasalah = async (key) => {
    if (busy || !problem.ok) return
    if (typeof ctx.onReceivingStatusChange !== 'function') return
    setBusy(true)
    try {
      await ctx.onReceivingStatusChange(receiving, key)
    } finally {
      setBusy(false)
      setShowProblem(false)
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
        <div style={S.tags}>
          {/* Tujuan dalam bahasa manusia — bukan kode DB (KE_TUKANG dst.). */}
          {dest ? <span style={S.tag} data-testid={`queue-dest-${handover.id}`}>Tujuan: {dest}</span> : null}
          {problemNoted ? (
            <span style={S.warnTag} data-testid={`queue-problem-badge-${handover.id}`}>⚠ Nota bermasalah</span>
          ) : null}
        </div>
      </div>

      {/* ---- LANGKAH 1: BARANG DATANG (per barang) --------------------------
          Dipisah dari 3 aksi distribusi karena ini TAHAP BERBEDA: mencatat
          kedatangan/kondisi/tujuan, bukan memindahkan barang. DAT: UI fisik
          hanya di Handover, jadi pintu input ini ada di sini — bukan di
          modul Pembelian (yang berhenti di "barang dibeli"). */}
      {receiving && (
        <div style={{ ...S.finish, marginTop: 0, marginBottom: 10 }} data-testid={`queue-receipt-block-${handover.id}`}>
          <span style={S.finishLabel}>Langkah 1 — catat barang yang benar-benar datang (per barang):</span>
          <button
            type="button"
            disabled={busy}
            data-testid={`queue-terima-barang-${handover.id}`}
            title="Catat kedatangan per barang: jumlah datang, rusak, tujuan, retur"
            onClick={() => openPhysicalModal({ kind: 'receipt', receiving })}
            style={S.btn}
          >
            📥 Terima Barang
          </button>
        </div>
      )}

      {/* ---- 3 AKSI DISTRIBUSI FISIK ----------------------------------------
          Satu baris aksi = tanggung jawab fisik modul ini:
          📦 Gudang · 👷 Tukang · ⚠ Bermasalah.
          "Bermasalah" sengaja TIDAK ditonjolkan (border putus-putus, font lebih
          kecil, tanpa warna aksi) sesuai arahan DAT — ia jalan keluar untuk
          barang cacat/salah kirim, bukan langkah normal.
          "Tandai Diserahkan" TIDAK di sini: itu bukti fisik penerimaan, jadi
          ditampilkan sebagai langkah penutup di bawah (lihat S.finish). */}
      <div style={S.actions} data-testid={`queue-primary-${handover.id}`}>
        {primary.map(a => (
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
        {/* Aksi sekunder: retur/refund — tidak menyolok, tapi tetap terjangkau */}
        <button
          type="button"
          disabled={busy}
          data-testid={`queue-problem-${handover.id}`}
          title={problem.reason || 'Barang cacat / salah kirim dari toko'}
          onClick={() => setShowProblem(v => !v)}
          style={S.subtleBtn}
        >
          ⚠ Bermasalah
        </button>
      </div>

      {showProblem && (
        <div style={S.panel} data-testid={`queue-problem-panel-${handover.id}`}>
          {problem.ok ? (
            <>
              <div style={S.panelText}>
                {problem.perLine
                  ? 'Barang rusak dicatat PER BARANG dari penerimaan — tidak perlu mengetik ulang nama atau jumlah. Buka form retur untuk memilih barang yang benar-benar dikembalikan.'
                  : 'Tandai nota ini bermasalah? Barang tidak didistribusikan; status nota dicatat sebagai Retur/Refund.'}
              </div>
              <div style={S.row}>
                {problem.perLine ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-testid={`queue-problem-retur-${handover.id}`}
                    onClick={() => { setShowProblem(false); openPhysicalModal({ kind: 'return', receiving }) }}
                  >
                    ↩ Buka Form Retur (per barang)
                  </button>
                ) : PROBLEM_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={busy}
                    data-testid={`queue-problem-${opt.key.toLowerCase()}-${handover.id}`}
                    onClick={() => tandaiBermasalah(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
                <button type="button" className="outline" onClick={() => setShowProblem(false)}>
                  Batal
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Label jujur: aksi tidak bisa dijalankan + alasannya. */}
              <div style={S.panelText} data-testid={`queue-problem-blocked-${handover.id}`}>
                {problem.reason}
              </div>
              <div style={S.row}>
                <button type="button" className="outline" onClick={() => setShowProblem(false)}>
                  Tutup
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- langkah penutup: bukti fisik barang sudah diterima ---- */}
      <div style={S.finish} data-testid={`queue-finish-${handover.id}`}>
        <span style={S.finishLabel}>Langkah penutup — setelah barang benar-benar diterima di lokasi:</span>
        {finish ? (
          <button
            type="button"
            disabled={!finish.ok || busy}
            data-testid={`queue-${finish.testid}-${handover.id}`}
            title={finish.reason || finish.label}
            onClick={() => run(finish.key)}
            style={S.btn}
          >
            <span aria-hidden="true">{finish.icon}</span> {finish.label}
          </button>
        ) : null}
        {showTerima && (
          <div data-testid={`queue-terima-form-${handover.id}`} style={{ marginTop: 8 }}>
            <label style={S.label}>
              Diterima oleh (wajib — nama tukang/penerima)
              <input
                type="text"
                style={S.input}
                value={receivedBy}
                onChange={e => setReceivedBy(e.target.value)}
                data-testid={`queue-terima-nama-${handover.id}`}
                placeholder="Nama penerima"
                aria-required="true"
              />
            </label>
            {!receivedBy.trim() && (
              <div style={{ ...S.panelText, color: '#a15309' }} data-testid={`queue-terima-wajib-${handover.id}`}>
                Nama penerima wajib diisi supaya bukti serah terima bisa dipertanggungjawabkan.
              </div>
            )}
            <div style={S.row}>
              <button type="button" onClick={submitTerima} disabled={busy || !receivedBy.trim()} data-testid={`queue-terima-ok-${handover.id}`}>
                Konfirmasi
              </button>
              <button type="button" className="outline" onClick={() => setShowTerima(false)}>
                Batal
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---- rincian barang (dipertahankan; label jujur bila tidak ada data) ---- */}
      <button
        type="button"
        style={S.detailToggle}
        data-testid={`queue-detail-${handover.id}`}
        onClick={() => setShowDetail(v => !v)}
        title="Lihat barang dari nota pembelian"
      >
        {showDetail ? '▲ Tutup rincian barang' : '▾ Rincian barang'}
      </button>
      {showDetail && (
        <div style={S.detail} data-testid={`queue-detail-panel-${handover.id}`}>
          {/* Tujuan TIDAK diulang di sini — sudah ada satu badge di header.
              Satu nilai fisik = satu tempat tampil (tidak ada field ganda). */}
          <span style={S.detailLine}>
            Nota: {receiving?.invoice_no || receiving?.delivery_note || '—'}
          </span>
          {items.length ? (
            <>
              {items.map(it => (
                <span key={it.id} style={S.detailLine}>
                  • {it.item_name || '—'} — {Number(it.quantity_received || 0)}{it.unit ? ` ${it.unit}` : ''} <em style={{ opacity: 0.7 }}>(qty beli di nota)</em>
                </span>
              ))}
              {/* Angka di atas = qty BELI, bukan jumlah yang diserahkan.
                  Jumlah serah terima per item belum punya tabel (handover_items). */}
              <span style={{ ...S.detailLine, opacity: 0.7 }}>
                Jumlah serah terima per item belum tercatat terpisah — konfirmasi fisik tetap per dokumen.
              </span>
            </>
          ) : (
            <span style={S.detailLine} data-testid={`queue-items-unavailable-${handover.id}`}>
              {RINCIAN_BELUM_TERSEDIA}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// BANNER ANTREAN (slot ctx.banner / dispatcher handovers)
// ------------------------------------------------------------
// Banner ini juga HOST modal fisik (Terima Barang / Retur / Konfirmasi per
// barang). Satu tempat render supaya modal tidak dobel ketika aksi dipicu
// dari banner maupun dari tombol baris di view.jsx (keduanya memakai store
// `physicalModal`).
export function renderHandoverQueue(ctx) {
  return <HandoverQueueBanner ctx={ctx} />
}

function HandoverQueueBanner({ ctx }) {
  const { rows, allReceivings } = ctx
  // Probe kemampuan skema (READ-ONLY). null = belum diperiksa; UI memakai
  // perilaku LEGACY sampai probe selesai (tidak pernah mengklaim tersimpan).
  const [cap, setCap] = React.useState(null)
  React.useEffect(() => {
    let cancelled = false
    getReceiptCapability().then(c => { if (!cancelled) setCap(c) })
    return () => { cancelled = true }
  }, [])

  if (!Array.isArray(rows)) return null
  const recById = new Map((allReceivings || []).map(r => [r.id, r]))
  const entries = buildDistributionQueue(rows).map(ho => ({
    handover: ho,
    receiving: ho.receiving_id ? (recById.get(ho.receiving_id) || null) : null
  }))
  // PENTING: host modal TIDAK boleh ikut hilang saat antrean kosong. Tombol
  // 📥 di aksi baris (view.jsx) tetap aktif dan menulis ke store `physicalModal`;
  // kalau host hanya dirender di dalam banner yang `return null`, klik itu tidak
  // menghasilkan apa pun (modal "mati" tanpa pesan). Jadi host dirender di luar
  // guard antrean — banner boleh kosong, host tetap ada.
  const host = <PhysicalModalHost ctx={ctx} />
  if (!entries.length) return host

  return (
    <div style={S.banner} data-testid="handover-queue-banner">
      <div style={S.bannerHead}>
        <h3 style={{ margin: 0, fontSize: 15 }}>📦 Antrean Distribusi Fisik</h3>
        <span style={S.sub} data-testid="handover-queue-count">{entries.length} handover menunggu</span>
      </div>
      {!cap?.ready && (
        <div
          data-testid="handover-capability"
          style={{ ...S.panel, marginBottom: 10, fontSize: '11.5px', lineHeight: 1.45, color: '#e8c98a' }}
        >
          Penyimpanan per barang (kedatangan/rusak/tujuan/retur) belum aktif —{' '}
          {(cap?.missing || []).filter(Boolean).join('; ') || 'memeriksa skema…'}. Antrean tetap bisa dipakai untuk
          distribusi dokumen; tidak ada data per barang yang diklaim tersimpan.
        </div>
      )}
      {entries.map(entry => (
        <ActionCard key={entry.handover.id} entry={entry} ctx={ctx} cap={cap} />
      ))}
      <PhysicalModalHost ctx={ctx} />
    </div>
  )
}

export { ACTIONS }
