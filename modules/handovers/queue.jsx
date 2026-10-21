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
import { capabilityState, getReceiptCapability } from '../receivings/receiptCapability'

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

// `ledgerState` = keadaan capability (lihat capabilityState di
// receivings/receiptCapability): 'ready' | 'legacy' | 'unknown' | 'error' |
// 'partial'. Saat 'ready', retur per barang TIDAK lagi diblokir oleh
// keterbatasan skema — modal retur mengambil baris dari event rusak.
//
// DEFECT run 219 / BUG-S3: parameter ini dulu bernama `ledgerReady` dan diisi
// `!!cap?.returnReady` dari queue. Boolean dua keadaan itu membuat jendela
// probe (`null`), probe GAGAL, dan migrasi SEBAGIAN semuanya jatuh ke jalur
// LEGACY — yaitu MENULIS `receivings.status` — padahal di keadaan itu retur
// per baris sudah ada di `return_cases`/`return_lines`. Sekarang keadaan tidak
// diketahui TIDAK PERNAH menawarkan jalur tulis: ia ditolak dengan alasan.
//
// Kompatibilitas: `true` = ready (pemanggil lama), `'legacy'` (default) =
// perilaku lama. `false`/`null`/`undefined` sengaja TIDAK dianggap legacy —
// itu bunyi "belum diketahui" dan harus berhenti, bukan menulis.
export function problemPlan(receiving, itemCount = 0, hasHandler = true, ledgerState = 'legacy') {
  const st = ledgerState === true ? 'ready'
    : (typeof ledgerState === 'string' && ledgerState ? ledgerState : 'unknown')
  if (!receiving) {
    return { ok: false, reason: `Dokumen ini belum terhubung ke nota pembelian, jadi tidak ada barang yang bisa diretur. ${RECON_NOTE}` }
  }
  if (isProblemNoted(receiving)) {
    return { ok: false, reason: 'Nota ini sudah ditandai bermasalah (Retur/Refund) — tidak bisa ditandai dua kali.' }
  }
  // Ledger per barang aktif → retur dicatat per barang lewat modal (bukan
  // status header), jadi batas "satu item per nota" tidak berlaku lagi.
  if (st === 'ready') {
    return { ok: true, reason: '', perLine: true }
  }
  // Keadaan yang TIDAK BOLEH menulis: probe belum selesai, probe gagal, atau
  // migrasi sebagian (data per barang sudah ada, read-model belum siap).
  if (st === 'unknown' || st === 'error' || st === 'partial') {
    return {
      ok: false,
      reason: st === 'partial'
        ? `Pencatatan retur per barang sudah ADA di database, tetapi pemeriksaan skema belum lengkap — jadi jalur status nota dimatikan supaya riwayat retur tidak tertimpa. ${RECON_NOTE}`
        : `Kesiapan skema belum bisa dipastikan — pencatatan status nota dimatikan sementara supaya tidak menimpa riwayat retur per barang. ${RECON_NOTE}`
    }
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
// SATU gerbang tulis untuk SEMUA aksi kartu antrean
// ------------------------------------------------------------
// DEFECT run 219 / BUG-S1: dulu tombol digerbangi di `gated` (map) dan
// `run()` punya salinan aturan sendiri. Dua salinan itu bisa menyimpang, dan
// memang menyimpang: banner memakai tiga keadaan sementara tombol memakai
// `!!cap?.ready` dua keadaan. Sekarang aturannya SATU fungsi murni — dipakai
// untuk menonaktifkan tombol DAN untuk menolak di jalur tulis (pertahanan
// kedua bila ada klik programatik / test lama).
//
// Mengembalikan '' bila aksi boleh menulis, atau alasan yang bisa dibaca.
//
//   action \\ state | ready | legacy | unknown | error | partial
//   ACT_GUDANG/TUKANG | TOLAK | BOLEH  | TOLAK   | TOLAK | TOLAK
//   ACT_TERIMA        | BOLEH | BOLEH  | TOLAK   | TOLAK | TOLAK
//
// ACT_TERIMA BOLEH di ready (modal per barang) dan legacy (form header lama,
// satu-satunya jalur). Di unknown/error/partial keduanya berbahaya: modal
// confirmForm sudah menolak sendiri, dan form header MENULIS tanpa rincian
// lalu mengunci dokumen permanen (CAS `diserahkan_at IS NULL`).
export function writeBlockReason(actionKey, capState) {
  const st = capState === true ? 'ready'
    : (typeof capState === 'string' && capState ? capState : 'unknown')
  const partial = st === 'partial'
  const unknownish = st === 'unknown' || st === 'error' || partial
  if (actionKey === ACT_TERIMA) {
    if (st === 'ready' || st === 'legacy') return ''
    return partial
      ? 'Rincian serah terima per barang sudah ADA di database, tetapi pemeriksaan skema belum lengkap — konfirmasi dikunci supaya dokumen tidak terkunci tanpa rincian. Minta admin menyelesaikan migrasi.'
      : 'Kesiapan skema masih diperiksa / pemeriksaan gagal — konfirmasi dikunci supaya dokumen tidak terkunci tanpa rincian. Coba lagi sebentar lagi.'
  }
  if (actionKey === ACT_GUDANG || actionKey === ACT_TUKANG) {
    if (st === 'legacy') return ''
    if (st === 'ready') {
      return actionKey === ACT_GUDANG
        ? 'Tujuan barang sudah dicatat PER BARANG di Terima Barang (Workshop/Tukang). Aksi borongan ini akan menimpa tujuan per barang, jadi tidak dipakai saat pencatatan per barang aktif.'
        : 'Tujuan ke tukang dicatat PER BARANG di Terima Barang, lalu bukti fisiknya lewat konfirmasi per barang. Aksi borongan ini akan menimpa tujuan per barang, jadi tidak dipakai saat pencatatan per barang aktif.'
    }
    return partial
      ? 'Tujuan per barang sudah ADA di database (migrasi belum lengkap). Aksi borongan akan menimpanya — minta admin menyelesaikan migrasi lalu pakai Terima Barang.'
      : 'Kesiapan skema masih diperiksa / pemeriksaan gagal — aksi borongan dikunci supaya tujuan per barang tidak tertimpa. Coba lagi sebentar lagi.'
  }
  // Aksi lain (mis. panel Bermasalah) punya gerbangnya sendiri.
  return unknownish ? '' : ''
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
  // DEFECT run 219 / BUG-S1: satu model keadaan, dipakai SEMUA jalur di kartu
  // ini (dulu `ledgerReady = !!cap?.ready` dan banner memakai tiga keadaan →
  // banner bilang "memeriksa"/"GAGAL" sementara tombol di bawahnya MENULIS).
  const capState = capabilityState(cap)
  const ledgerReady = capState === 'ready'
  // LEGACY = satu-satunya keadaan yang boleh memakai jalur tulis lama (status
  // header / aksi borongan). `unknown`, `error`, dan `partial` TIDAK boleh.
  const legacyWritable = capState === 'legacy'
  const problem = problemPlan(receiving, items.length, typeof ctx.onReceivingStatusChange === 'function', capState)

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
    if (a.key === ACT_TERIMA) {
      if (handover?.diserahkan_at) return a
      if (ledgerReady) {
        // Tidak disaring lagi di sini: modal konfirmasi sudah punya jalur yang
        // benar untuk SEMUA keadaan — baris prefill bila ada alokasi tukang,
        // panel "tidak ada alokasi" + konfirmasi header-only bila tidak ada,
        // dan penolakan jelas bila rincian gagal dimuat. Menyaring lagi di sini
        // hanya menutup jalan keluar yang sudah diperbaiki di run 190.
        return { ...a, ok: true, reason: 'Buka konfirmasi per barang — jumlah fisik diverifikasi di sana.' }
      }
      // DEFECT run 219 / BUG-S1: satu-satunya jalur yang tersisa di non-READY
      // adalah form header INLINE yang MENULIS `diserahkan_at` + status
      // CONFIRMED tanpa rincian, dan dokumen terkunci permanen (CAS). Itu hanya
      // sah bila skema memang BELUM ADA (legacy).
      const block = writeBlockReason(a.key, capState)
      if (block) return { ...a, ok: false, reason: block }
      return a
    }
    if (a.key !== ACT_GUDANG && a.key !== ACT_TUKANG) return a
    // ---- DEFECT run 212 / BUG-R2 + run 219 / BUG-S1: aksi BORONGAN --------
    // `actions.js` menulis `pr_items.status` untuk SEMUA baris nota sekaligus.
    // Di mode READY tujuan barang dicatat PER BARANG di ledger
    // (`receiving_events.tujuan_ws` / `tujuan_tukang`), jadi satu klik borongan
    // MENIMPA keputusan per barang (mis. Cat Duco tujuan Tukang ikut jadi
    // DI_GUDANG). Di `unknown`/`error`/`partial` hal yang sama bisa terjadi
    // karena `receiving_events` mungkin SUDAH berisi. Hanya LEGACY yang boleh
    // memakai tombol ini (satu-satunya jalur di sana).
    const block = writeBlockReason(a.key, capState)
    if (block) return { ...a, ok: false, reason: block }
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
      // Pertahanan kedua (run 219 / BUG-S1): SATU gerbang yang sama dengan
      // tombol. Jalur tulis header menolak sendiri di luar LEGACY, supaya tidak
      // ada klik programatik/test lama yang mengunci dokumen tanpa rincian di
      // jendela probe atau saat migrasi belum lengkap.
      const block = writeBlockReason(ACT_TERIMA, capState)
      if (block) { say(block); return }
      setShowTerima(true)
      return
    }
    // Pertahanan kedua (run 212 / BUG-R2 + run 219 / BUG-S1): tombolnya sudah
    // nonaktif di READY dan di keadaan yang tidak diketahui, tetapi jalur tulis
    // ini juga menolak sendiri — supaya tidak ada jalan (mis. klik programatik
    // / test lama) yang menimpa tujuan per barang.
    if (action === ACT_GUDANG || action === ACT_TUKANG) {
      const block = writeBlockReason(action, capState)
      if (block) { say(block); return }
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
            {!legacyWritable
              // DEFECT run 212 / BUG-R2 (lanjutan): di READY, `pr_items.status`
              // TIDAK lagi ditulis oleh aksi mana pun (tujuan barang dicatat di
              // `receiving_events`), jadi angka "x dari y barang didistribusikan"
              // akan SELALU 0 dan menyesatkan. Jangan menampilkan angka dari
              // dimensi yang sudah tidak dipakai — katakan di mana kebenarannya.
              // Run 219: sama untuk `unknown`/`error`/`partial`, karena di
              // keadaan itu aksi borongan juga dikunci (tidak ada yang menulis
              // `pr_items.status`), jadi angkanya tetap 0 dan menyesatkan.
              ? (ledgerReady
                ? 'Distribusi dicatat per barang — lihat Terima Barang (tujuan) & konfirmasi fisik'
                : 'Distribusi tidak dicatat dari layar ini sampai kesiapan skema terverifikasi — lihat Terima Barang')
              : distributionLabel(summary)}
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
                  Pesannya dibedakan per mode (defect run 208): kalimat lama
                  "jumlah serah terima per item belum tercatat terpisah —
                  konfirmasi fisik tetap per dokumen" BENAR di mode LEGACY,
                  tetapi SALAH di mode READY: di sana rincian per barang
                  benar-benar ditulis (`handover_items`) dan dibaca halaman.
                  Menampilkan kalimat "belum ada" di mode READY membuat admin
                  mengira fitur yang sudah berjalan tidak ada. */}
              {ledgerReady ? (
                <span style={S.detailLine} data-testid={`queue-items-perline-ready-${handover.id}`} >
                  Angka di atas adalah <b>qty beli</b>, bukan qty diserahkan. Jumlah yang benar-benar
                  diserahkan per barang dicatat lewat <b>konfirmasi fisik per barang</b> (aksi
                  &quot;Tandai Diserahkan&quot;) dan tampil di kolom 📦 Barang setelah tersimpan.
                </span>
              ) : capState === 'partial' ? (
                // Run 219 / BUG-S2: jangan bilang "belum tercatat" saat tabel
                // ledger SUDAH ada dan berisi. Itu membuat admin mengira datanya
                // hilang, lalu memakai aksi borongan yang menimpanya.
                <span style={S.detailLine} data-testid={`queue-items-perline-partial-${handover.id}`} >
                  Angka di atas adalah <b>qty beli</b>. Catatan per barang (tujuan/rusak/serah terima)
                  sudah ada di database, tetapi pemeriksaan skema belum lengkap — rinciannya belum
                  bisa ditampilkan dari layar ini sampai migrasi diselesaikan admin.
                </span>
              ) : (
                <span style={{ ...S.detailLine, opacity: 0.7 }}>
                  Jumlah serah terima per item belum tercatat terpisah — konfirmasi fisik tetap per dokumen.
                </span>
              )}
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
    getReceiptCapability()
      .then(c => { if (!cancelled) setCap(c || { ready: false, returnReady: false, probeFailed: true, missing: ['probe tidak mengembalikan hasil'] }) })
      .catch(err => {
        if (!cancelled) setCap({ ready: false, returnReady: false, probeFailed: true, missing: [String(err?.message || err || 'probe gagal')] })
      })
    return () => { cancelled = true }
  }, [])

  if (!Array.isArray(rows)) return null
  // Run 219 / BUG-S1: SATU turunan keadaan, dipakai banner DAN setiap kartu.
  // Sebelumnya banner memakai tiga keadaan sendiri sementara kartu memakai
  // `!!cap?.ready` — banner bisa bilang "GAGAL" sementara tombol menulis.
  const capState = capabilityState(cap)
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
          data-capability-state={capState}
          style={{ ...S.panel, marginBottom: 10, fontSize: '11.5px', lineHeight: 1.45, color: '#e8c98a' }}
        >
          {capState === 'unknown'
            ? 'Memeriksa kesiapan penyimpanan per barang… antrean tetap bisa dipakai untuk distribusi dokumen; tidak ada data per barang yang diklaim tersimpan.'
            : capState === 'error'
              ? <>Pemeriksaan kesiapan skema <b>GAGAL</b> — {(cap?.missing || []).filter(Boolean).join('; ') || 'tidak diketahui'}. Tidak ada data per barang yang ditulis; jangan anggap fitur ini aktif.</>
              : capState === 'partial'
                // Run 219 / BUG-S2: jangan pernah menyebut "belum aktif" saat
                // tabel ledger SUDAH ADA dan berisi data per barang.
                ? <>Migrasi skema <b>BELUM LENGKAP</b> — {(cap?.missing || []).filter(Boolean).join('; ') || 'objek lain belum siap'}.
                    Catatan per barang yang sudah ada <b>tidak</b> ditampilkan dan <b>tidak</b> ditulis dari layar ini;
                    aksi borongan dimatikan supaya tidak menimpa tujuan per barang. Minta admin menyelesaikan migrasi.</>
                : <>Penyimpanan per barang (kedatangan/rusak/tujuan/retur) belum aktif —{' '}
                    {(cap?.missing || []).filter(Boolean).join('; ') || 'skema belum tersedia'}. Antrean tetap bisa dipakai untuk
                    distribusi dokumen; tidak ada data per barang yang diklaim tersimpan.</>}
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
