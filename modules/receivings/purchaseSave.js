// ============================================================
// modules/receivings/purchaseSave.js — SIMPAN SATU NOTA BELANJA
// ============================================================
// Menulis ke tabel yang SUDAH ADA (tanpa migrasi):
//   receivings        : satu baris = satu nota toko (vendor, no. nota, tgl,
//                       status DIBELI, catatan terstruktur)
//   receiving_items   : satu baris = satu barang di nota itu
//                       (quantity_received = qty BELI, note = [Harga: n])
//
// MENGAPA TIDAK MEMBUAT HEADER BARU SELALU:
// alur Approval sudah membuat "cangkang" nota otomatis per PR
// (RPC ensure_item_in_purchase) beserta baris item qty 0. Saat admin membeli,
// baris item itu DIPINDAHKAN/DIPAKAI ULANG — bukan diduplikasi — supaya satu
// barang tidak punya dua baris penerimaan (yang akan mengacaukan acuan harga
// dan laporan). Header cangkang yang ditinggal kosong otomatis TIDAK tampil di
// tab mana pun (tidak punya no. nota & bukan DIBELI), jadi dibiarkan apa
// adanya — tidak ada penghapusan data.
//
// IDEMPOTEN / ANTI DOBEL:
//   1) Sebelum menulis, dicari nota DIBELI dengan vendor + no. nota yang sama.
//      Bila ada -> dibatalkan (bukan menimpa, bukan menggandakan).
//   2) Form memakai ref guard + tombol disabled selama menyimpan.
//   3) Bila penulisan header berhasil tapi item gagal, pesan menyebut nota
//      mana yang perlu diperiksa (tidak ada klaim "selesai").
//
// STATUS DIBELI: kolom `receivings.status` bisa dibatasi CHECK constraint
// (skema dikelola task t_03b41644). Karena itu penulisan status dicoba
// 'DIBELI' lebih dulu; bila ditolak constraint, nota tetap ditandai lewat
// penanda [Tahap: DIBELI] di catatan (lihat lib/purchaseNote.js) dan pesan
// hasil menyebutkan hal itu apa adanya.
// ============================================================
import { supabase } from '../../lib/supabaseClient'
import { buildPurchaseNote, PURCHASED_STATUS, TAHAP_DIBELI, isPurchasedNota } from '../../lib/purchaseNote'
import { buildSavePlan } from './purchaseLogic'

function isCheckViolation(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === '23514' || /check constraint/i.test(msg)
}

// Cari nota DIBELI lain dengan vendor + no. nota sama (anti dobel).
async function findExistingNota({ vendorId, invoiceNo }) {
  try {
    const { data, error } = await supabase
      .from('receivings')
      .select('id, invoice_no, vendor_id, status, note')
      .eq('invoice_no', invoiceNo)
      .limit(10)
    if (error) return { ok: false, error: error.message }
    const hit = (data || []).find(r => String(r.vendor_id || '') === String(vendorId || '') && isPurchasedNota(r))
    return { ok: true, existing: hit || null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

export async function savePurchase({ form, receivings = [], receivingItems = [], prItems = [], requests = [], vendors = [] } = {}) {
  if (!supabase) return { ok: false, error: 'Supabase tidak tersedia.' }
  const plan = buildSavePlan(form)
  const { header, items } = plan
  if (!header.vendorId) return { ok: false, error: 'Toko / Vendor wajib dipilih.' }
  if (!header.invoiceNo) return { ok: false, error: 'No. Invoice / No. Nota toko wajib diisi.' }
  if (!items.length) return { ok: false, error: 'Tidak ada barang dengan harga yang bisa disimpan.' }

  // --- 0) Anti dobel: nota toko yang sama tidak boleh tercatat dua kali ---
  const dup = await findExistingNota({ vendorId: header.vendorId, invoiceNo: header.invoiceNo })
  if (!dup.ok) return { ok: false, error: `Gagal memeriksa nota: ${dup.error}` }
  if (dup.existing) {
    return {
      ok: false,
      reason: 'duplicate_invoice',
      error: `Nota ${header.invoiceNo} untuk toko ini sudah tercatat sebelumnya (Riwayat Pembelian). Buka nota itu alih-alih menyimpan ulang.`
    }
  }

  // --- 1) Petakan baris item yang sudah ada (cangkang dari Approval) ---
  const itemByPrItem = new Map()
  for (const ri of (receivingItems || [])) {
    if (ri?.pr_item_id) itemByPrItem.set(ri.pr_item_id, ri)
  }
  const shellIds = [...new Set(items
    .map(it => itemByPrItem.get(it.prItemId)?.receiving_id)
    .filter(Boolean))]
  const shellHeader = shellIds.length === 1 ? (receivings || []).find(r => r.id === shellIds[0]) || null : null
  // JANGAN memakai ulang header yang SUDAH menjadi nota selesai. Satu cangkang
  // Approval mewakili satu PR, jadi bila admin membeli sebagian barang hari ini
  // dan sisanya besok (atau ke toko lain), keduanya menunjuk cangkang yang sama.
  // Tanpa penjagaan ini, nota hari ini DITIMPA nota besok: nomor nota, toko,
  // tanggal, dan nominal nota pertama hilang dari Riwayat — uang yang sudah
  // keluar lenyap dari catatan. Nota yang sudah selesai = header yang sudah
  // DIBELI atau sudah bernomor; dalam kasus itu nota baru dibuat terpisah dan
  // baris item dipindahkan ke header baru (satu barang tetap satu baris).
  const shellIsFinishedNota = !!shellHeader && (
    isPurchasedNota(shellHeader) || !!String(shellHeader.invoice_no || '').trim()
  )
  const reuseId = shellHeader && !shellIsFinishedNota ? shellHeader.id : null
  const reuseRow = reuseId ? shellHeader : null

  // PR/proyek hanya bisa diisi bila SELURUH barang di nota ini satu PR/proyek.
  // Sumber jejak: baris item (pr_item_id → receiving_items.pr_id) bila ada,
  // ATAU jejak yang dibawa form dari tab Siap Dibeli (form.items[].prId /
  // projectId). Nota tanpa cangkang tidak punya receiving_items lama, jadi
  // tanpa jalur kedua header kehilangan PR/proyeknya dan Handover-nya kosong.
  const prIds = new Set()
  const projectIds = new Set()
  for (const it of items) {
    const ri = itemByPrItem.get(it.prItemId)
    const prOfItem = ri?.pr_id || it.prId
    if (prOfItem) prIds.add(prOfItem)
    const rec = ri ? (receivings || []).find(r => r.id === ri.receiving_id) : null
    const projOfItem = rec?.project_id || it.projectId
    if (projOfItem) projectIds.add(projOfItem)
  }
  const prId = prIds.size === 1 ? [...prIds][0] : null
  const projectId = projectIds.size === 1 ? [...projectIds][0] : null

  const note = buildPurchaseNote({
    material: header.material,
    biayaLain: header.biayaLain,
    diskon: header.diskon,
    notaUrl: header.notaUrl,
    buktiNota: header.buktiNota,
    buktiTransfer: header.buktiTransfer,
    catatan: header.catatan,
    tahap: TAHAP_DIBELI
  })

  const baseHeader = {
    vendor_id: header.vendorId,
    invoice_no: header.invoiceNo,
    // delivery_note: kolom lama dipakai sebagai "Surat Jalan / No. PO". Nota
    // belanja tidak punya surat jalan, tapi kolom ini diisi teks jelas supaya
    // tidak melanggar NOT NULL dan tetap terbaca di modul lain (Handover
    // menampilkan delivery_note sebagai label sumber).
    delivery_note: `Nota ${header.invoiceNo}`,
    received_date: header.tanggal,
    // note: kolom catatan lama — selalu string (bukan null) supaya aman bila
    // kolomnya NOT NULL di skema.
    note: note || '',
    kendala: null
  }

  // --- 2) Header nota: pakai ulang cangkang tunggal, atau buat baru ---
  let receivingId = reuseId
  let statusWritten = PURCHASED_STATUS
  let statusFallback = false

  if (receivingId) {
    // Cangkang milik PR: lengkapi menjadi nota nyata. FK PR/proyek hanya
    // DITULIS bila nilainya jelas (satu PR/proyek) — kalau nota memuat barang
    // dari beberapa PR, FK lama TIDAK dikosongkan (jejak tidak boleh hilang).
    const patch = { ...baseHeader }
    if (prId) patch.purchase_request_id = prId
    if (projectId) patch.project_id = projectId
    let { error } = await supabase.from('receivings').update({ ...patch, status: PURCHASED_STATUS }).eq('id', receivingId)
    if (error && isCheckViolation(error)) {
      statusFallback = true
      statusWritten = String(reuseRow?.status || 'NORMAL')
      const retry = await supabase.from('receivings').update(patch).eq('id', receivingId)
      error = retry.error
    }
    if (error) return { ok: false, error: `Gagal menyimpan nota: ${error.message}` }
  } else {
    const row = {
      ...baseHeader,
      purchase_request_id: prId,
      project_id: projectId,
      status: PURCHASED_STATUS,
      alokasi: null,
      masuk_gudang: false
    }
    let { data, error } = await supabase.from('receivings').insert(row).select()
    if (error && isCheckViolation(error)) {
      statusFallback = true
      statusWritten = 'NORMAL'
      const retry = await supabase.from('receivings').insert({ ...row, status: 'NORMAL' }).select()
      data = retry.data
      error = retry.error
    }
    if (error) return { ok: false, error: `Gagal membuat nota: ${error.message}` }
    receivingId = data?.[0]?.id || null
    if (!receivingId) return { ok: false, error: 'Nota tersimpan tetapi ID nota tidak terbaca — buka ulang Riwayat Pembelian untuk memeriksa.' }
  }

  // --- 3) Baris barang ---
  const saved = []
  for (const it of items) {
    const existing = itemByPrItem.get(it.prItemId)
    const payload = {
      receiving_id: receivingId,
      pr_item_id: it.prItemId,
      item_name: it.itemName,
      unit: it.unit || null,
      quantity_received: it.qty,
      note: it.itemNote
    }
    // Pakai ulang baris HANYA bila baris itu memang milik nota yang sedang
    // ditulis, atau bila ia masih baris cangkang kosong (qty 0 — belum pernah
    // mencatat pembelian). Baris yang sudah mencatat pembelian nyata di nota
    // LAIN tidak boleh dipindahkan/ditimpa: nota lama harus tetap punya
    // rincian barangnya. Dalam kasus itu dibuat baris baru — satu barang boleh
    // punya beberapa baris pembelian (nota berbeda, harga & tanggal berbeda),
    // dan itu justru sumber acuan harga historis yang jujur.
    const existingQty = Number(existing?.quantity_received || 0)
    const canReuseRow = !!existing?.id && (
      String(existing.receiving_id || '') === String(receivingId || '')
      || !isFinite(existingQty) || existingQty <= 0
    )
    if (canReuseRow) {
      const { error } = await supabase.from('receiving_items').update(payload).eq('id', existing.id)
      if (error) {
        return {
          ok: false,
          partial: true,
          receivingId,
          saved,
          error: `Nota ${header.invoiceNo} tersimpan, tetapi barang "${it.itemName}" gagal disimpan (${error.message}). Buka Riwayat Pembelian dan periksa nota ini — jangan simpan ulang.`
        }
      }
      saved.push({ ...it, itemRowId: existing.id, reused: true })
    } else {
      const { data, error } = await supabase.from('receiving_items').insert(payload).select()
      if (error) {
        return {
          ok: false,
          partial: true,
          receivingId,
          saved,
          error: `Nota ${header.invoiceNo} tersimpan, tetapi barang "${it.itemName}" gagal disimpan (${error.message}). Buka Riwayat Pembelian dan periksa nota ini — jangan simpan ulang.`
        }
      }
      saved.push({ ...it, itemRowId: data?.[0]?.id || null, reused: false })
    }
  }

  const vendorName = (vendors || []).find(v => v.id === header.vendorId)?.name || ''

  // --- 4) Antrean Handover (otomatis) ---
  // Barang yang sudah dibeli harus muncul di modul Handover untuk distribusi
  // fisik. Skema handover masih HEADER-level (tabel `handover_items` belum
  // ada), jadi yang dibuat adalah SATU dokumen DRAFT per nota — isinya rincian
  // barang diambil dari baris nota ini. Idempoten: bila nota ini sudah punya
  // dokumen handover, tidak dibuat lagi. Kegagalan di langkah ini TIDAK
  // membatalkan nota (uang sudah keluar) — dilaporkan apa adanya.
  let handoverQueued = false
  let handoverError = ''
  try {
    const { data: existingHo, error: hoReadErr } = await supabase
      .from('handovers')
      .select('id')
      .eq('receiving_id', receivingId)
      .limit(1)
    if (hoReadErr) {
      handoverError = hoReadErr.message
    } else if (existingHo && existingHo.length) {
      handoverQueued = true
    } else {
      const { error: hoErr } = await supabase.from('handovers').insert({
        receiving_id: receivingId,
        project_id: projectId,
        received_by: 'Belum ditentukan',
        handover_date: header.tanggal,
        status: 'DRAFT',
        note: null
      })
      if (hoErr) handoverError = hoErr.message
      else handoverQueued = true
    }
  } catch (err) {
    handoverError = err.message
  }

  return {
    ok: true,
    receivingId,
    status: statusWritten,
    statusFallback,
    handoverQueued,
    handoverError,
    vendorName,
    invoiceNo: header.invoiceNo,
    itemCount: saved.length,
    totals: plan.totals,
    reusedHeader: !!reuseId,
    message: `Nota ${header.invoiceNo}${vendorName ? ` (${vendorName})` : ''} tersimpan: ${saved.length} barang, total ${new Intl.NumberFormat('id-ID').format(plan.totals.total)}.`
      + (handoverQueued ? ' Barang masuk antrean Serah Terima.' : '')
      + (statusFallback ? ' Penanda tahap disimpan di catatan nota (kolom status belum menerima nilai DIBELI).' : '')
      + (handoverError ? ` ⚠️ Antrean Serah Terima belum terbuat otomatis (${handoverError}) — tambahkan dokumen serah terima manual di modul Serah Terima.` : '')
  }
}
