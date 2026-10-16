// ============================================================
// modules/shared/itemHelpers.js
// Helper item lintas modul — diekstrak VERBATIM dari ModuleView.js
// (Fase 1 modularisasi). Semua fungsi menutup (closure) atas data yang
// sudah dimuat halaman; TIDAK ada query Supabase di sini.
//
// Dipakai oleh: requests, approvals, receivings (+ mobile card).
// ============================================================

export function makeItemHelpers({ allPrItems = [], allVendors = [], allMaterials = [], allReceivingItems = [], allRequests = [] }) {
  // Indeks Map O(1) untuk lookup instan antar-relasi pengadaan
  const prMap = new Map()
  const prItemById = new Map()
  for (const it of (allPrItems || [])) {
    if (it.id) prItemById.set(it.id, it)
    if (it.pr_id) {
      let list = prMap.get(it.pr_id)
      if (!list) {
        list = []
        prMap.set(it.pr_id, list)
      }
      list.push(it)
    }
  }

  const recMap = new Map()
  for (const it of (allReceivingItems || [])) {
    if (it.receiving_id) {
      let list = recMap.get(it.receiving_id)
      if (!list) {
        list = []
        recMap.set(it.receiving_id, list)
      }
      list.push(it)
    }
  }

  const vendorMap = new Map((allVendors || []).map(v => [v.id, v]))
  const materialMap = new Map((allMaterials || []).map(m => [m.id, m]))
  const reqMap = new Map((allRequests || []).map(r => [r.id, r]))

  const prItemsForPr = (prId) => prMap.get(prId) || []
  const vendorName = (vendorId) => vendorMap.get(vendorId)?.name || ''
  const approvalItems = (approval) => prItemsForPr(approval?.purchase_request_id)
  const receivingItemsForReceiving = (recId) => recMap.get(recId) || []

  // --- Poin 2: progres penerimaan (parsial vs lengkap) ---
  const orderedQtyFor = (it) => {
    const prItem = prItemById.get(it?.pr_item_id)
    const n = Number(prItem?.quantity)
    return isFinite(n) && n > 0 ? n : null
  }

  // Status qty per item. PENTING (audit t_905e0e5a G1): rec > ordered TIDAK
  // lagi dilaporkan "LENGKAP" — diberi key OVER agar over-receipt terlihat,
  // bukan diterima diam-diam. Over-receipt dicegah di form Terima Barang
  // (receiptLogic) sampai ada kebijakan eksplisit.
  const itemReceiveStatus = (it) => {
    const rec = Number(it.quantity_received || 0)
    const ordered = orderedQtyFor(it)
    if (!(rec > 0)) return { key: 'BELUM', rec, ordered, text: `Belum Diterima (0 / ${ordered || 0})` }
    if (ordered !== null && rec > ordered) return { key: 'OVER', rec, ordered, text: `⚠ Melebihi pesanan (${rec} / ${ordered} — lebih ${rec - ordered})` }
    if (ordered === null || rec >= ordered) return { key: 'LENGKAP', rec, ordered: ordered === null ? rec : ordered, text: `✓ Lengkap (${rec} / ${ordered === null ? rec : ordered})` }
    return { key: 'PARSIAL', rec, ordered, text: `⏳ Parsial (${rec} / ${ordered} — Sisa ${ordered - rec})` }
  }

  const itemBadgeStyle = (key) => key === 'LENGKAP'
    ? { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
    : key === 'PARSIAL'
      ? { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' }
      : { background: '#f3f5f6', color: '#556260', border: '1px solid #d6dcde' }

  const receivingProgress = (recId, kendala) => {
    const items = receivingItemsForReceiving(recId)
    if (!items.length) return null
    const statuses = items.map(itemReceiveStatus)
    const doneCount = statuses.filter(s => s.key === 'LENGKAP').length
    return {
      statuses,
      doneCount,
      total: statuses.length,
      allDone: doneCount === statuses.length,
      anyReceived: statuses.some(s => s.rec > 0),
      // Dimensi qty ≠ dimensi status nota (audit G9): nota kendala (Retur/
      // Refund) dengan qty penuh TIDAK boleh tampil hijau "LENGKAP".
      kendala: !!kendala
    }
  }

  // Status persetujuan per material: ORDERED (sudah dipesan) > APPROVED (disetujui) > PENDING (menunggu)
  const itemState = (it) => {
    const s = String(it?.status || '').toUpperCase()
    if (s === 'ORDERED') return 'ORDERED'
    if (s === 'APPROVED') return 'APPROVED'
    return 'PENDING'
  }

  // Baris item utk modul Approval: pakai pr_items; jika kosong (data lama),
  // fallback ke ringkasan material PR supaya barang yang perlu di-approve tetap terlihat.
  // Satu sumber data utk kolom Item Material + QTY (modul Approval) supaya baris
  // kedua kolom TIDAK PERNAH meleset: setiap entri { text, qty } dipakai bersama.
  const approvalItemRows = (approval) => {
    const items = approvalItems(approval)
    if (items.length) {
      return items.map(it => {
        // Kolom Item Material HANYA nama item (kategori & vendor tidak menempel).
        const text = String(it.item_name || it.kode || '').trim() || '—'
        const q = (it.quantity ?? '') === '' ? '' : `${it.quantity ?? ''} ${it.unit || ''}`.trim()
        return { text, qty: q || '—' }
      })
    }
    const pr = reqMap.get(approval.purchase_request_id)
    const s = String(pr?.materials_summary || '').trim()
    if (!s) return []
    // Data lama: ringkasan "4 Lembar Triplek" — pisahkan qty utk kolom QTY.
    return s.split(',').map(x => x.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.*)$/)
      return m ? { text: m[3], qty: `${m[1]} ${m[2]}` } : { text: line, qty: '—' }
    })
  }

  const approvalItemLines = (approval) => approvalItemRows(approval).map(r => r.text)
  const approvalItemQtys = (approval) => approvalItemRows(approval).map(r => r.qty)

  // Satu sumber data untuk kolom Item Material + Qty + Vendor (modul PR) supaya
  // baris antar kolom tidak pernah meleset. Kolom Item Material HANYA nama item;
  // Qty & Vendor punya kolomnya sendiri. Fallback ke ringkasan teks utk data lama.
  const requestItemRows = (pr) => {
    const items = prItemsForPr(pr.id)
    if (items.length) {
      return items.map(it => {
        const name = String(it.item_name || it.kode || '—').trim() || '—'
        const unit = String(it.unit || '').trim()
        const qtyVal = (it.quantity ?? '') === '' ? '' : it.quantity
        const qtyText = qtyVal === '' ? '—' : `${qtyVal} ${unit}`.replace(/\s+/g, ' ').trim()
        const supplier = String(it.supplier_category || '').trim()
        const vendor = vendorName(it.vendor_id)
        // Estimasi harga: dari pr_items.estimated_price; fallback ke harga acuan material.
        const mat = materialMap.get(it.material_id)
        const rawPrice = (it.estimated_price !== null && it.estimated_price !== undefined && it.estimated_price !== '')
          ? it.estimated_price
          : (mat ? mat.harga_acuan : null)
        const numPrice = (rawPrice === null || rawPrice === undefined || rawPrice === '') ? null : Number(rawPrice)
        const estPrice = numPrice !== null && isFinite(numPrice) ? numPrice : null
        return { name, text: name, qty: qtyVal, qtyText: qtyText || '—', unit, supplier, vendor, estPrice }
      })
    }
    const s = String(pr.materials_summary || '').trim()
    if (!s) return []
    return s.split(',').map(x => x.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.*)$/)
      return m
        ? { name: m[3], text: m[3], qty: m[1], qtyText: `${m[1]} ${m[2]}`, unit: m[2], supplier: '', vendor: '', estPrice: null }
        : { name: line, text: line, qty: '', qtyText: '—', unit: '', supplier: '', vendor: '', estPrice: null }
    })
  }

  const requestItemLines = (pr) => {
    const rows = requestItemRows(pr)
    return rows.length ? rows.map(r => r.text) : ['—']
  }

  return {
    prItemsForPr,
    vendorName,
    approvalItems,
    receivingItemsForReceiving,
    orderedQtyFor,
    itemReceiveStatus,
    itemBadgeStyle,
    receivingProgress,
    itemState,
    approvalItemRows,
    approvalItemLines,
    approvalItemQtys,
    requestItemRows,
    requestItemLines
  }
}
