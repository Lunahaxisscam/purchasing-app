// ============================================================
// modules/handovers/display.js — logika murni Handover (tanpa React / tanpa DB)
// ============================================================
// Dipakai oleh view.jsx / form.jsx / rincian.jsx dan diuji VERBATIM oleh
// scripts/handover-flow-test (sandbox, tanpa DB).
//
// KONTRAK (arahan DAT t_b418827b + kontrak parent t_5196b689):
// 1) "Sudah Diserahkan" HANYA bila `diserahkan_at` terisi. Status CONFIRMED
//    tanpa diserahkan_at BUKAN bukti fisik (bukti live c14802de) — jangan
//    pernah mengklaim sudah diserahkan karena alokasi/pilihan saja.
// 2) Rincian barang per item BELUM punya tabel (`handover_items` menunggu
//    izin DAT). Data tanpa rincian terstruktur diberi label
//    "Rincian barang belum tersedia" — JANGAN menebak jumlah serah terima
//    dari data Purchase (`quantity_received` kumulatif termasuk rusak dan
//    bisa berubah). Karena itu angka penerimaan TIDAK ditampilkan sebagai
//    rincian serah terima di modul Handover.
// 3) Saat skema disetujui dan handover punya baris item sendiri
//    (`handover.items`), baris itulah yang ditampilkan: nama, jumlah
//    diserahkan, satuan.
// ============================================================
import { isHandoverDelivered } from '../../lib/constants'

export const RINCIAN_BELUM_TERSEDIA = 'Rincian barang belum tersedia'

// Catatan untuk data lama: status bilang CONFIRMED/SELESAI tapi tidak ada
// catatan waktu penyerahan — tampilkan apa adanya, jangan dipercaya sebagai
// bukti fisik (audit t_905e0e5a A3).
export function legacyStatusNote(h) {
  if (!h || isHandoverDelivered(h)) return ''
  const s = String(h.status || '').toUpperCase()
  if (s === 'CONFIRMED' || s === 'SELESAI') {
    return `Status lama "${s}" tanpa catatan waktu penyerahan — belum dihitung "Sudah Diserahkan".`
  }
  return ''
}

export function statusInfo(h) {
  const delivered = isHandoverDelivered(h)
  return {
    delivered,
    label: delivered ? 'Sudah Diserahkan' : 'Belum Diserahkan',
    legacyNote: legacyStatusNote(h),
    diserahkanAt: (h && h.diserahkan_at) || null
  }
}

// Referensi dokumen sumber: Purchase (penerimaan) + PR asal, dari receiving_id.
export function sourceRefs(handover, { allReceivings = [], allRequests = [] } = {}) {
  const rec = (allReceivings || []).find(x => x && x.id === handover?.receiving_id) || null
  const pr = rec && rec.purchase_request_id
    ? (allRequests || []).find(x => x && x.id === rec.purchase_request_id) || null
    : null
  return {
    receiving: rec,
    receivingLabel: rec ? (rec.invoice_no || rec.delivery_note || 'Penerimaan') : '',
    deliveryNote: (rec && rec.delivery_note) || '',
    invoiceNo: (rec && rec.invoice_no) || '',
    alokasi: (rec && rec.alokasi) || null,
    prNumber: (pr && pr.pr_number) || null,
    prTitle: (pr && pr.title) || null
  }
}

// Rincian barang satu handover.
// - Bila handover punya baris item sendiri (`items` — setelah skema
//   handover_items disetujui DAT), itu SUMBER jumlah yang diserahkan.
// - Sebelum itu: label "Rincian barang belum tersedia" — TANPA angka tebakan.
export function rincianInfo(handover) {
  const structured = Array.isArray(handover && handover.items) ? handover.items.filter(Boolean) : []
  if (structured.length) {
    return {
      available: true,
      source: 'HANDOVER',
      label: '',
      rows: structured.map(it => ({
        name: String(it.item_name || it.name || '—'),
        qty: Number(it.qty_diserahkan !== undefined && it.qty_diserahkan !== null ? it.qty_diserahkan : (it.quantity || 0)),
        unit: String(it.satuan || it.unit || ''),
        qtyLabel: 'diserahkan'
      })),
      notice: ''
    }
  }
  return {
    available: false,
    source: 'NONE',
    label: RINCIAN_BELUM_TERSEDIA,
    rows: [],
    notice: handover?.receiving_id
      ? 'Pencatatan jumlah serah terima per item belum aktif di versi ini (menunggu persetujuan perbaikan skema). Jumlah dari data Purchase tidak dipakai karena bisa berubah dan masih bercampur barang rusak.'
      : 'Data ini belum terhubung ke penerimaan. Pencatatan jumlah serah terima per item juga belum aktif di versi ini.'
  }
}

// Ringkasan untuk sel daftar "Barang".
export function rincianCell(handover) {
  const info = rincianInfo(handover)
  if (info.available) {
    const names = info.rows.map(x => x.name).filter(Boolean)
    const ringkas = names.length > 2
      ? `${names.slice(0, 2).join(', ')} +${names.length - 2} lainnya`
      : names.join(', ')
    return { unavailable: false, count: info.rows.length, text: `${info.rows.length} item — ${ringkas}` }
  }
  return { unavailable: true, count: 0, text: RINCIAN_BELUM_TERSEDIA }
}

// ============================================================
// PROTOTYPE rincian penyerahan per item (memori sesi saja).
// TIDAK PERNAH menulis ke DB / kolom note — menunggu izin DAT untuk tabel
// handover_items (lihat docs/handover-gap-proposal.md). Fungsi murni di sini
// supaya bisa diuji: dukungan parsial, sisa belum diserahkan, tanpa hitung
// ganda, dan beberapa penerima.
// ============================================================

// Validasi satu baris isian prototype terhadap sisa yang belum diserahkan.
// `entries` = entri prototype yang SUDAH tercatat untuk handover ini (lintas
// baris/beberapa serah terima) — supaya tidak menghitung ganda.
export function validatePrototypeRow({ refItemId, qty, penerima }, refItems, entries) {
  const ref = (refItems || []).find(x => x && x.id === refItemId)
  if (!ref) return { ok: false, error: 'Pilih barang dulu.' }
  const q = Number(qty)
  if (!isFinite(q) || q <= 0) return { ok: false, error: 'Jumlah harus angka lebih dari 0.' }
  const received = Number(ref.quantity_received || 0)
  const used = (entries || [])
    .filter(e => e.refItemId === ref.id)
    .reduce((s, e) => s + Number(e.qty || 0), 0)
  const available = Math.max(0, received - used)
  if (q > available + 1e-9) {
    return { ok: false, error: `Melebihi sisa yang belum diserahkan (sisa ${available}${ref.unit ? ' ' + ref.unit : ''}).` }
  }
  return { ok: true, ref, qty: q, available }
}

// Total per item: diterima / tercatat (prototype) / sisa belum diserahkan.
export function prototypeTotals(entries, refItems) {
  const list = entries || []
  return (refItems || []).map(ref => {
    const received = Number(ref.quantity_received || 0)
    const used = list
      .filter(e => e.refItemId === ref.id)
      .reduce((s, e) => s + Number(e.qty || 0), 0)
    return {
      refItemId: ref.id,
      name: ref.item_name || '—',
      unit: ref.unit || '',
      received,
      used,
      sisa: Math.max(0, received - used)
    }
  })
}
