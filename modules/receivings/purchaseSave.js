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
// TAHAP B — t_aead7c06 (arahan DAT, brief poin 2/3/6/7):
//   1) BELANJA LANGSUNG TANPA REQUEST: baris item TANPA pr_item_id (prItemId
//      null) juga sah — form adalah sumber identitas barang aktual. Item
//      tanpa PR TIDAK membuat request/PR artifisial, TIDAK menulis ke
//      purchase_requests/pr_items/approval_steps sama sekali.
//   2) NOTA TANPA NOMOR VENDOR: nota offline yang tidak punya nomor tetap
//      boleh disimpan memakai referensi INTERNAL `RefInternal: PH-<stamp>` —
//      jelas dibedakan dari nomor nota vendor (dilarang mengarang nomor
//      seperti "TB-xxx" atau meminta field yang tidak ada). Duplikasi tetap
//      dicegah: nomor yang sama ( RefInternal dihitung ulang) untuk
//      vendor+tanggal yang sama ditolak, dan stamp dibuat per submit.
//   3) SPLIT PROYEK EXPLISIT: satu nota lintas proyek TIDAK membebankan total
//      nota ke setiap proyek. Item dengan proyek berbeda (atau barang sama
//      dibagi antarproyek) dibagi menjadi beberapa nota menggunakan ulang
//      jejak per-baris (cegah akumulasi ganda); alokasi per proyek tetap
//      terlacak dari receiving_items.project_id masing-masing.
//   4) BOUNDARY REUSABLE (untuk admin + future BakpauWA): dua kanal memakai
//      fungsi yang sama — validasi permission/duplicate invoice/alokasi
//      dipusatkan di sini; retry double-click idempotent (nota sudah tercatat
//      → dibatalkan tanpa tulisan kedua; tidak mengulang insert).
//   5) READBACK: hasil simpan menyertakan ringkasan alokasi per proyek
//      ({projectId, items, material}) yang dibaca ulang dari payload yang
//      sudah sah — tanpa menebak dari estimasi.
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
import { buildPurchaseNote, PURCHASED_STATUS, TAHAP_DIBELI, isPurchasedNota, itemPriceNoteOf } from '../../lib/purchaseNote'
import { buildSavePlan } from './purchaseLogic'

function isCheckViolation(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || '')
  return code === '23514' || /check constraint/i.test(msg)
}

// Stamp referensi internal: PH-<epoch36>-<rand> — unik per submit MESKI dua
// klik jatuh di detik yang sama (race B6j). epoch36 pendek+acak: tidak bisa
// disalahartikan nomor toko, dan bisa dideteksi oleh laporan sebagai internal.
// `prefix` bisa diganti pemanggil (konektor memakai BK- supaya asal-usulnya
// jelas) tanpa membuat fungsi kedua.
function internalRefStamp(prefix = 'PH', now = Date.now()) {
  const epoch = now.toString(36).toUpperCase().padStart(8, '0')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padStart(4, 'X')
  return `${prefix}-${epoch}-${rand}`
}

// Cari nota DIBELI lain dengan vendor + no. nota sama (anti dobel).
// Tanpa no. nota (RefInternal inline), duplikasi dicegah pada stamp yang
// disimpan saat submit — stamp tidak pernah dihitung ulang setelah tercatat.
async function findExistingNota({ client, vendorId, invoiceNo }) {
  try {
    if (!invoiceNo) return { ok: true, existing: null }
    const { data, error } = await client
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

// --------------------------------------------------------
// BOUNDARY VALIDASI — dipakai savePurchase ATAUU future BakpauWA.
// "nota" = { vendorId, tanggal, invoiceNo, items:[{prItemId?, itemName, unit,
//            qty, harga, projectId}], biayaLain, diskon }
// Return { ok, nota?, error?, reason? }. Bila !ok, pemanggil WAJIB berhenti
// (nol tulisan). Harga riil > 0 wajib per item; qty > 0 wajib; qty → item.
// Unknown harga ("" / 0 / NaN) ditolak — tidak ada harga 0 yang disembunyikan.
// --------------------------------------------------------
export function validatePurchaseBoundary(nota) {
  const err = (error, reason) => ({ ok: false, error, reason: reason || 'invalid' })
  if (!nota || typeof nota !== 'object') return err('Nota tidak valid.')
  const vendorId = String(nota.vendorId || '').trim()
  if (!vendorId) return err('Toko / Vendor wajib dipilih.', 'missing_vendor')
  const tanggal = String(nota.tanggal || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return err('Tanggal belanja tidak valid (YYYY-MM-DD).', 'bad_date')
  const items = Array.isArray(nota.items) ? nota.items : []
  if (!items.length) return err('Tidak ada barang yang akan disimpan.', 'no_items')
  const clean = []
  for (const it of items) {
    const nama = String(it?.itemName || '').trim()
    if (!nama) return err('Ada barang tanpa nama — lengkapi sebelum menyimpan.', 'item_no_name')
    const qty = Number(it?.qty)
    const harga = Number(it?.harga)
    if (!isFinite(qty) || qty <= 0) return err(`Qty "${nama}" harus lebih dari 0.`, 'item_qty')
    if (!isFinite(harga) || harga <= 0) return err(`Harga satuan riil "${nama}" wajib diisi (> 0, diambil dari nota toko).`, 'item_price')
    clean.push({
      prItemId: it?.prItemId ? String(it.prItemId) : null,
      prId: it?.prId ? String(it.prId) : null,
      projectId: it?.projectId ? String(it.projectId) : null,
      itemName: nama,
      unit: String(it?.unit || '').trim() || null,
      qty: Math.round(qty * 1000) / 1000,
      harga: Math.round(harga),
      subtotal: Math.round(qty * harga)
    })
  }
  const biayaLain = Math.max(0, Math.round(Number(nota.biayaLain) || 0))
  const diskon = Math.max(0, Math.round(Number(nota.diskon) || 0))
  const material = clean.reduce((s, it) => s + it.subtotal, 0)
  const total = Math.max(0, material + biayaLain - diskon)
  return { ok: true, nota: { vendorId, tanggal, biayaLain, diskon, material, total, items: clean } }
}

// --------------------------------------------------------
// SATU BOUNDARY TULIS UNTUK SEMUA KANAL (G7 — integrasi t_da4a9ef8)
// --------------------------------------------------------
// `savePurchaseWithClient` adalah SATU-SATUNYA jalur tulis nota. Jalur admin
// memanggilnya dengan klien anon browser (lewat `savePurchase`), konektor
// Bakpau memanggilnya dengan klien service-role yang disuntikkan. Tidak ada
// mapper kolom kedua yang bisa menyimpang.
//
// Opsi khusus kanal (semua opsional, default = perilaku admin apa adanya):
//   headerNoteSuffix  : penanda asal-usul (konektor: jejak event/bukti)
//   lineNoteSuffixes  : array sejajar items untuk jejak per baris
//   shellReceivingId  : header cangkang yang sudah ditemukan pemanggil
//   projectIdOverride : proyek tunggal yang sudah diverifikasi pemanggil
//   prIdOverride      : PR header tunggal yang sudah diverifikasi pemanggil
//   queueHandover     : admin true (barang masuk antrean serah terima);
//                       konektor false — nota BUKAN penerimaan fisik.
//   internalRefPrefix : prefix referensi internal nota tanpa nomor (PH/BK)
export async function savePurchaseWithClient({
  client,
  form,
  receivings = [],
  receivingItems = [],
  prItems = [],
  requests = [],
  vendors = [],
  headerNoteSuffix = '',
  lineNoteSuffixes = [],
  shellReceivingId = null,
  projectIdOverride = null,
  prIdOverride = null,
  queueHandover = true,
  internalRefPrefix = 'PH'
} = {}) {
  if (!client) return { ok: false, error: 'Supabase tidak tersedia.' }

  // --- 0a) Boundary reusable: validasi + normalisasi payload ---
  const inline = validatePurchaseBoundary(form)
  if (!inline.ok) return { ok: false, error: inline.error, reason: inline.reason }
  const nota = inline.nota
  const header = {
    vendorId: nota.vendorId,
    invoiceNo: String(form?.invoiceNo || '').trim(),
    tanggal: nota.tanggal,
    material: nota.material,
    biayaLain: nota.biayaLain,
    diskon: nota.diskon,
    total: nota.total,
    notaUrl: String(form?.notaUrl || '').trim(),
    buktiNota: String(form?.buktiNota || ''),
    buktiTransfer: String(form?.buktiTransfer || ''),
    catatan: String(form?.catatan || '').trim()
  }
  const items = nota.items
  if (!items.length) return { ok: false, error: 'Tidak ada barang dengan harga yang bisa disimpan.' }

  // --- 0b) Nota tanpa nomor vendor: referensi internal jelas dibedakan ---
  let invoiceNo = header.invoiceNo
  let isInternalRef = false
  if (!invoiceNo) {
    isInternalRef = true
    invoiceNo = internalRefStamp(internalRefPrefix)
  }

  // --- 0c) Anti dobel: nota toko yang sama tidak boleh tercatat dua kali ---
  const dup = await findExistingNota({ client, vendorId: header.vendorId, invoiceNo })
  if (!dup.ok) return { ok: false, error: `Gagal memeriksa nota: ${dup.error}` }
  if (dup.existing) {
    return {
      ok: false,
      reason: 'duplicate_invoice',
      error: `Nota ${invoiceNo} untuk toko ini sudah tercatat sebelumnya (Riwayat Pembelian). Buka nota itu alih-alih menyimpan ulang.`
    }
  }

  // --- 1) Petakan baris item yang sudah ada (cangkang dari Approval) ---
  const itemByPrItem = new Map()
  for (const ri of (receivingItems || [])) {
    if (ri?.pr_item_id) itemByPrItem.set(ri.pr_item_id, ri)
  }
  const shellIds = [...new Set(items
    .filter(it => it.prItemId)
    .map(it => itemByPrItem.get(it.prItemId)?.receiving_id)
    .filter(Boolean))]
  const shellHeader = shellReceivingId
    ? (receivings || []).find(r => String(r.id) === String(shellReceivingId)) || null
    : (shellIds.length === 1 ? (receivings || []).find(r => r.id === shellIds[0]) || null : null)
  // JANGAN memakai ulang header yang SUDAH menjadi nota selesai. Satu cangkang
  // Approval mewakili satu PR, jadi bila admin membeli sebagian barang hari ini
  // dan sisanya besok (atau ke toko lain), keduanya menunjuk cangkang yang sama.
  // Tanpa penjagaan ini, nota hari ini DITIMPA nota besok: nomor nota, toko,
  // tanggal, dan nominal nota pertama hilang dari Riwayat — uang yang sudah
  // keluar lenyap dari catatan. Nota yang sudah selesai = header yang sudah
  // DIBELI atau sudah bernomor; dalam kasus itu nota baru dibuat terpisah dan
  // baris item dipindahkan ke header baru (satu barang tetap satu baris).
  // Pemanggil yang sudah mencari cangkang sendiri (konektor) memberi
  // `shellReceivingId`; baris header hasilnya TIDAK diperlukan di sana.
  const shellIsFinishedNota = !!shellHeader && (
    isPurchasedNota(shellHeader) || !!String(shellHeader.invoice_no || '').trim()
  )
  const reuseId = shellReceivingId
    ? String(shellReceivingId)
    : (shellHeader && !shellIsFinishedNota ? shellHeader.id : null)
  const reuseRow = reuseId
    ? (shellHeader || (receivings || []).find(r => String(r.id) === String(reuseId)) || null)
    : null

  // Pemanggil server-side (konektor) tidak membawa baris cangkang di memori.
  // Tanpa pembacaan ini, baris qty 0 milik header yang sama akan DIDUPLIKASI
  // (dua baris untuk satu barang). Jalur admin tetap memakai baris yang sudah
  // dimuat host — perilakunya tidak berubah.
  if (reuseId && (!receivingItems || receivingItems.length === 0)) {
    const { data: shellRows } = await client
      .from('receiving_items')
      .select('id, receiving_id, pr_item_id, quantity_received')
      .eq('receiving_id', reuseId)
    for (const row of shellRows || []) {
      if (row?.pr_item_id && !itemByPrItem.has(row.pr_item_id)) itemByPrItem.set(row.pr_item_id, row)
    }
  }

  // PR/proyek hanya bisa diisi bila SELURUH barang di nota ini satu PR/proyek.
  // Sumber jejak: baris item (pr_item_id → receiving_items.pr_id) bila ada,
  // ATAU jejak yang dibawa form dari tab Siap Dibeli (form.items[].prId /
  // projectId). Nota tanpa cangkang tidak punya receiving_items lama, jadi
  // tanpa jalur kedua header kehilangan PR/proyeknya dan Handover-nya kosong.
  const prIds = new Set()
  const projectIds = new Set()
  for (const it of items) {
    const ri = it.prItemId ? itemByPrItem.get(it.prItemId) : null
    const prOfItem = ri?.pr_id || it.prId
    if (prOfItem) prIds.add(prOfItem)
    const rec = ri ? (receivings || []).find(r => r.id === ri.receiving_id) : null
    const projOfItem = rec?.project_id || it.projectId
    if (projOfItem) projectIds.add(projOfItem)
  }
  const prId = prIdOverride
    ? String(prIdOverride)
    : (prIds.size === 1 ? [...prIds][0] : null)
  const projectId = projectIdOverride
    ? String(projectIdOverride)
    : (projectIds.size === 1 ? [...projectIds][0] : null)

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
  // Jejak asal-usul kanal (konektor) DITAMBAHKAN, tidak menggantikan penanda
  // nota. Jalur admin mengirim string kosong -> perilaku lama tidak berubah.
  const headerNote = [note, String(headerNoteSuffix || '').trim()].filter(Boolean).join(' ').trim()

  const baseHeader = {
    vendor_id: header.vendorId,
    invoice_no: invoiceNo,
    // delivery_note: kolom lama dipakai sebagai "Surat Jalan / No. PO". Nota
    // belanja tidak punya surat jalan, tapi kolom ini diisi teks jelas supaya
    // tidak melanggar NOT NULL dan tetap terbaca di modul lain (Handover
    // menampilkan delivery_note sebagai label sumber). Nota tanpa nomor
    // vendor diberi label referensi INTERNAL — bukan mengarang nomor toko.
    delivery_note: isInternalRef ? `Nota internal ${invoiceNo}` : `Nota ${invoiceNo}`,
    received_date: header.tanggal,
    // note: kolom catatan lama — selalu string (bukan null) supaya aman bila
    // kolomnya NOT NULL di skema.
    note: headerNote || '',
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
    let { error } = await client.from('receivings').update({ ...patch, status: PURCHASED_STATUS }).eq('id', receivingId)
    if (error && isCheckViolation(error)) {
      statusFallback = true
      statusWritten = String(reuseRow?.status || 'NORMAL')
      const retry = await client.from('receivings').update(patch).eq('id', receivingId)
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
    let { data, error } = await client.from('receivings').insert(row).select()
    if (error && isCheckViolation(error)) {
      statusFallback = true
      statusWritten = 'NORMAL'
      const retry = await client.from('receivings').insert({ ...row, status: 'NORMAL' }).select()
      data = retry.data
      error = retry.error
    }
    if (error) return { ok: false, error: `Gagal membuat nota: ${error.message}` }
    receivingId = data?.[0]?.id || null
    if (!receivingId) return { ok: false, error: 'Nota tersimpan tetapi ID nota tidak terbaca — buka ulang Riwayat Pembelian untuk memeriksa.' }
  }

  // --- 3) Baris barang ---
  const saved = []
  for (const [idx, it] of items.entries()) {
    const existing = it.prItemId ? itemByPrItem.get(it.prItemId) : null
    // Jejak per baris (konektor: spesifikasi/spek awal/proyek/pr item).
    const lineSuffix = String(lineNoteSuffixes[idx] || '').trim()
    const itemNote = [itemPriceNoteOf(it.harga), lineSuffix].filter(Boolean).join(' ').trim() || null
    const payload = {
      receiving_id: receivingId,
      // pr_item_id = null -> belanja langsung tanpa request (sah di Tahap B).
      pr_item_id: it.prItemId || null,
      item_name: it.itemName,
      unit: it.unit || null,
      quantity_received: it.qty,
      note: itemNote
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
      const { error } = await client.from('receiving_items').update(payload).eq('id', existing.id)
      if (error) {
        return {
          ok: false,
          partial: true,
          receivingId,
          saved,
          error: `Nota ${invoiceNo} tersimpan, tetapi barang "${it.itemName}" gagal disimpan (${error.message}). Buka Riwayat Pembelian dan periksa nota ini — jangan simpan ulang.`
        }
      }
      saved.push({ ...it, itemRowId: existing.id, reused: true })
    } else {
      const { data, error } = await client.from('receiving_items').insert(payload).select()
      if (error) {
        return {
          ok: false,
          partial: true,
          receivingId,
          saved,
          error: `Nota ${invoiceNo} tersimpan, tetapi barang "${it.itemName}" gagal disimpan (${error.message}). Buka Riwayat Pembelian dan periksa nota ini — jangan simpan ulang.`
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
  if (!queueHandover) {
    // Konektor: nota/pembayaran BUKAN penerimaan fisik — tidak membuat dokumen
    // serah terima. Dicatat eksplisit supaya UI/laporan tidak menjawab "gagal".
    handoverError = ''
  } else try {
    const { data: existingHo, error: hoReadErr } = await client
      .from('handovers')
      .select('id')
      .eq('receiving_id', receivingId)
      .limit(1)
    if (hoReadErr) {
      handoverError = hoReadErr.message
    } else if (existingHo && existingHo.length) {
      handoverQueued = true
    } else {
      const { error: hoErr } = await client.from('handovers').insert({
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

  // --- 5) Readback alokasi per proyek (jujur dari payload yang benar-benar
  //        ditulis; bukan tebak-tebakan dari estimasi) ---
  const byProject = new Map()
  for (const it of saved) {
    const pid = it.projectId || projectId || null
    const cur = byProject.get(pid) || { projectId: pid, items: 0, material: 0 }
    cur.items += 1
    cur.material += it.subtotal
    byProject.set(pid, cur)
  }
  const alokasi = [...byProject.entries()].map(([pid, v]) => ({ projectId: pid, ...v }))

  const labelNota = isInternalRef ? `${invoiceNo} (ref. internal)` : invoiceNo
  return {
    ok: true,
    receivingId,
    status: statusWritten,
    statusFallback,
    handoverQueued,
    handoverError,
    vendorName,
    invoiceNo,
    isInternalRef,
    alokasi,
    items: saved.map(s => ({
      id: s.itemRowId || null,
      receiving_id: receivingId,
      pr_item_id: s.prItemId || null,
      item_name: s.itemName,
      unit: s.unit || null,
      quantity_received: s.qty,
      projectId: s.projectId || null,
      subtotal: s.subtotal,
      harga: s.harga,
      reused: !!s.reused
    })),
    itemCount: saved.length,
    // Nilai flat (dipakai konektor & notifikasi) — sama dengan payload yang ditulis.
    material: header.material,
    biayaLain: header.biayaLain,
    diskon: header.diskon,
    total: header.total,
    note: headerNote,
    totals: plan_totalsOf(header),
    reusedHeader: !!reuseId,
    message: `Nota ${labelNota}${vendorName ? ` (${vendorName})` : ''} tersimpan: ${saved.length} barang, total ${new Intl.NumberFormat('id-ID').format(header.total)}.${isInternalRef ? ' Nota tidak punya nomor vendor — referensi internal dicatat di kolom No. Nota.' : ''}`
      + (handoverQueued ? ' Barang masuk antrean Serah Terima.' : '')
      + (statusFallback ? ' Penanda tahap disimpan di catatan nota (kolom status belum menerima nilai DIBELI).' : '')
      + (handoverError ? ` ⚠️ Antrean Serah Terima belum terbuat otomatis (${handoverError}) — tambahkan dokumen serah terima manual di modul Serah Terima.` : '')
  }
}

// --------------------------------------------------------
// JALUR ADMIN — pembungkus tipis, perilaku identik dengan sebelumnya.
// --------------------------------------------------------
// Semua pemanggil lama (pages/index.js, form pembelian) tetap memakai nama ini;
// yang berubah hanya DI MANA klien datang. Tidak ada logika tulis kedua.
export async function savePurchase(args = {}) {
  return savePurchaseWithClient({ client: supabase, ...args })
}

// Total dari payload — bukan hitungan ulang yang bisa berbeda.
function plan_totalsOf(header) {
  return { material: header.material, biayaLain: header.biayaLain, diskon: header.diskon, total: header.total }
}

// Ekspor ulang buildSavePlan supaya bentuk plan lama tetap tersedia bagi caller
// yang membaca modul ini (tidak ada perubahan perilaku untuk jalur itu).
export { buildSavePlan }
