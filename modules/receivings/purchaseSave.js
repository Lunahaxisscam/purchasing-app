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
import { normalizeAllocations, validateSplit } from './allocationLogic'
import { createActiveHandover } from '../handovers/createHandover'

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
//
// RUN 246 — `stableKey` (client_request_id): bila diberikan, hasilnya
// DETERMINISTIK untuk kunci itu. Ini yang membuat RETRY tidak mengarang nomor
// baru (defect R2: retry nota tanpa nomor dulu membuat nota kedua).
//
// PENTING: saat `stableKey` diberikan, SELURUH stamp diturunkan dari kunci —
// termasuk bagian "epoch". Kalau epoch tetap diambil dari jam sekarang, retry
// satu menit kemudian menghasilkan nomor BERBEDA dan defect R2 kembali. Jam
// hanya dipakai saat tidak ada kunci stabil.
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

function internalRefStamp(prefix = 'PH', now = Date.now(), stableKey = null) {
  const key = String(stableKey || '').trim()
  if (key) {
    const a = fnv1a(key, 0x811c9dc5).toString(36).toUpperCase().padStart(7, '0').slice(-7)
    const b = fnv1a(`v2:${key}`, 0x01000193).toString(36).toUpperCase().padStart(4, '0').slice(-4)
    return `${prefix}-${a}-${b}`
  }
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
    // PEMBAGIAN SATU BARIS → BEBERAPA PROYEK (acceptance 4).
    // Boundary yang SAMA dipakai semua kanal (admin & konektor): aturan split
    // ditegakkan di sini, bukan hanya di form. DB tetap penjaga terakhir.
    const allocs = normalizeAllocations(it?.allocations)
    if (allocs) {
      const split = validateSplit({ qty, allocations: allocs })
      if (!split.ok) return err(split.message, split.reason)
    }
    clean.push({
      prItemId: it?.prItemId ? String(it.prItemId) : null,
      prId: it?.prId ? String(it.prId) : null,
      // Kontrak DB: project_id XOR allocations. Baris split TIDAK membawa
      // project_id (header proyek juga NULL untuk split/mixed).
      projectId: allocs ? null : (it?.projectId ? String(it.projectId) : null),
      // Identitas material + alokasi split dibawa apa adanya. Validasi
      // kelengkapan material dilakukan SETELAH ini (butuh prItems untuk
      // menurunkan material dari baris PR), bukan di sini.
      materialId: it?.materialId ? String(it.materialId) : null,
      allocations: allocs,
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
//   clientRequestId   : kunci idempotensi STABIL per percobaan simpan.
//                       WAJIB dikirim pemanggil (form menyimpannya di state
//                       supaya retry memakai nilai yang sama). Bila kosong,
//                       dibuat sekali di sini — itu hanya menolong satu
//                       panggilan, TIDAK menolong retry dari UI. Karena itu
//                       form selalu mengirimnya.
//   capability        : hasil getPurchaseCapability(). Menentukan apakah
//                       jalur ATOMIK boleh dipakai. Tidak di-probe ulang di
//                       sini supaya satu simpan = satu keputusan.
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
  internalRefPrefix = 'PH',
  clientRequestId = null,
  capability = null
} = {}) {
  if (!client) return { ok: false, error: 'Supabase tidak tersedia.' }

  // --- 0a) GERBANG IZIN (kontrak v1) -------------------------------------
  // RPC kontrak v1 menolak non-admin dengan `{ok:false,reason:'forbidden'}`
  // dan TRIGGER menolak jalur multipart (`purchase_rpc_required`). Jadi bila
  // probe membuktikan sesi ini `forbidden`, jangan mencoba jalur lama lalu
  // menampilkan error SQL mentah — berhenti dengan pesan yang bisa dibaca.
  if (capability && capability.forbidden) {
    return {
      ok: false,
      reason: 'forbidden',
      error: 'Hanya admin yang boleh menyimpan nota pembelian. Akun ini tidak punya hak menulis nota.'
    }
  }

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
  // PENTING (run 246): referensi internal HARUS STABIL antar retry. Dulu
  // `internalRefStamp()` dipanggil di sini SETIAP kali, sehingga submit ulang
  // menghasilkan nomor berbeda → nota KEDUA + baris kedua + dokumen Handover
  // kedua (probe_r246_retry R2a/R2b/R2c MERAH). Sekarang:
  //   - `form.invoiceNo` yang sudah berisi PH-* dipakai apa adanya (form
  //     menyimpannya di state setelah percobaan pertama), atau
  //   - pemanggil memberi `internalRefId`/`clientRequestId` stabil.
  // Kalau tidak ada sama sekali, dibuat sekali di sini — dan hasilnya
  // DIKEMBALIKAN ke pemanggil (`internalRefId`) supaya percobaan berikutnya
  // bisa memakai nilai yang sama.
  let invoiceNo = header.invoiceNo
  let isInternalRef = false
  let internalRefId = null
  if (!invoiceNo) {
    isInternalRef = true
    internalRefId = String(clientRequestId || '').trim()
      ? internalRefStamp(internalRefPrefix, undefined, clientRequestId)
      : internalRefStamp(internalRefPrefix)
    invoiceNo = internalRefId
  }

  // --- 0b2) Jalur ATOMIK (bila skema mendukung) ---
  // Semua yang butuh konsistensi (header + baris typed + alokasi + antrean
  // Handover) ditulis SATU transaksi oleh RPC. Tidak ada penulisan sebagian
  // yang bisa membuat UI melaporkan "teralokasi" padahal tidak.
  //
  // Syarat: capability menyatakan READY. Kalau tidak, JANGAN coba-coba
  // memanggil RPC yang belum ada (kebisingan + pesan menyesatkan); jalur
  // lama dipakai dan hasilnya DIBERI LABEL JUJUR `allocationPersisted:false`.
  const capState = capability?.state || null
  const useAtomic = !!(capability && capability.allocationPersisted && capState === 'ready')

  if (useAtomic) {
    // Material per baris: baris PR MEWARISI material_id dari pr_items (exact,
    // bukan tebakan nama). Ini dilakukan di sini — bukan di form — supaya
    // semua kanal (admin & konektor) mendapat perlakuan yang sama.
    const prItemById = new Map((prItems || []).filter(p => p && p.id).map(p => [String(p.id), p]))
    const notaForAtomic = {
      ...nota,
      items: (nota.items || []).map(it => {
        const prIt = it.prItemId ? prItemById.get(String(it.prItemId)) : null
        return {
          ...it,
          materialId: it.materialId || prIt?.material_id || null
        }
      })
    }
    const atomic = await savePurchaseAtomic({
      client,
      nota: notaForAtomic,
      header,
      invoiceNo,
      isInternalRef,
      clientRequestId: clientRequestId || internalRefId || null,
      queueHandover,
      headerNoteSuffix,
      lineNoteSuffixes,
      projectIdOverride,
      prIdOverride
    })
    if (atomic) return atomic
    // `null` = RPC tidak bisa dipakai (mis. fungsi hilang di tengah jalan).
    // Jatuh ke jalur lama DI BAWAH dengan label jujur — bukan gagal total,
    // karena nota tetap harus tercatat (uang sudah keluar).
  }

  // --- 0c) Anti dobel: nota toko yang sama tidak boleh tercatat dua kali ---
  // Untuk nota TANPA nomor vendor, `invoiceNo` sekarang DETERMINISTIK terhadap
  // `clientRequestId` (lihat internalRefStamp), sehingga retry dengan kunci
  // yang sama akan MENEMUKAN nota pertama di sini dan berhenti sebagai
  // `duplicate_invoice` — bukan membuat nota kedua (defect R2 run 246).
  const dup = await findExistingNota({ client, vendorId: header.vendorId, invoiceNo })
  if (!dup.ok) return { ok: false, error: `Gagal memeriksa nota: ${dup.error}` }
  if (dup.existing) {
    // Retry dari percobaan yang SAMA bukan kesalahan pengguna: laporkan
    // sebagai `already` supaya UI tidak menyuruh admin "buka nota lain".
    const sameRequest = !!(clientRequestId && isInternalRef)
    return {
      ok: false,
      already: sameRequest,
      reason: sameRequest ? 'already_saved' : 'duplicate_invoice',
      existingId: dup.existing.id || null,
      // Referensi nota tetap dikembalikan supaya UI bisa menunjukkan notA
      // mana yang sudah ada (dan supaya kestabilan referensi internal bisa
      // dibuktikan, bukan diasumsikan).
      invoiceNo,
      isInternalRef,
      internalRefId: isInternalRef ? invoiceNo : null,
      clientRequestId: clientRequestId || internalRefId || null,
      error: sameRequest
        ? `Nota ini sudah tersimpan sebelumnya (${invoiceNo}). Tidak ada data yang ditulis ulang.`
        : `Nota ${invoiceNo} untuk toko ini sudah tercatat sebelumnya (Riwayat Pembelian). Buka nota itu alih-alih menyimpan ulang.`
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
  // barang diambil dari baris nota ini. Kegagalan di langkah ini TIDAK
  // membatalkan nota (uang sudah keluar) — dilaporkan apa adanya.
  //
  // REVIEW run 244 (BUG-W3): pintu ini dulu INSERT LANGSUNG tanpa penjaga,
  // dan pre-check-nya `.select('id').eq('receiving_id', …)` TANPA filter
  // `diserahkan_at`. Dua akibat nyata:
  //   W3a  dokumen kedua bisa dibuat dari sini (tidak dijaga sama sekali);
  //   W3b  setelah SEMUA dokumen dikonfirmasi, pre-check tetap menyimpulkan
  //        "sudah ada dokumen" sehingga nota berikutnya tidak pernah
  //        mendapat antrean serah terima bertahap.
  // Sekarang pintu ini lewat penjaga yang SAMA dengan form Tambah
  // (`insertUniqueActiveHandover`): baca DB (aktif saja), tolak bila ada
  // dokumen aktif, dan id deterministik supaya dua penulis bersamaan tidak
  // bisa sama-sama masuk.
  let handoverQueued = false
  let handoverError = ''
  if (!queueHandover) {
    // Konektor: nota/pembayaran BUKAN penerimaan fisik — tidak membuat dokumen
    // serah terima. Dicatat eksplisit supaya UI/laporan tidak menjawab "gagal".
    handoverError = ''
  } else try {
    const queued = await createActiveHandover({
      client,
      data: {
        receiving_id: receivingId,
        project_id: projectId,
        received_by: 'Belum ditentukan',
        handover_date: header.tanggal,
        status: 'DRAFT',
        note: null
      }
    })
    if (queued.ok) {
      handoverQueued = true
    } else if (queued.existingId || queued.raced) {
      // Nota ini SUDAH punya dokumen aktif (dibuat pintu lain / admin lain) —
      // antreannya ada, tidak ada yang perlu dibuat. Bukan kegagalan.
      handoverQueued = true
    } else {
      handoverError = queued.reason || 'Gagal membuat antrean Serah Terima.'
    }
  } catch (err) {
    handoverError = err.message
  }

  // --- 5) Readback — JUJUR tentang apa yang BENAR-BENAR tersimpan ---
  // RUN 246 (defect acceptance-4): blok ini dulu menghitung ringkasan alokasi
  // dari `saved` (state form), lalu mengembalikannya sebagai `alokasi`. UI
  // membacanya sebagai "biaya sudah masuk ke proyek", padahal tabel
  // `receiving_items` di jalur lama TIDAK punya kolom `project_id` — nol
  // alokasi tersimpan. Probe membuktikannya: setelah reload, 100% material
  // jatuh ke `unassignedMaterial` (1.250.000 dari nota lintas proyek 61+62).
  //
  // Sekarang: jalur lama TIDAK PERNAH mengklaim alokasi tersimpan.
  // `allocationPersisted: false` dan `alokasi: []` — UI wajib memberi tahu
  // admin bahwa pembagian proyek belum tercatat, bukan menampilkan angka
  // yang tidak ada di database.
  const alokasi = []
  const unassignedHint = (() => {
    const ids = new Set(saved.map(s => s.projectId).filter(Boolean))
    return ids.size
  })()

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
    internalRefId: isInternalRef ? invoiceNo : null,
    clientRequestId: clientRequestId || internalRefId || null,
    atomic: false,
    // Jalur lama: alokasi per baris TIDAK punya tempat di skema. Ini BUKAN
    // kegagalan simpan — nota tetap tercatat. Tapi klaim alokasi HARAM.
    allocationPersisted: false,
    allocationWarning: unassignedHint > 0
      ? `Pembagian ${unassignedHint} proyek pada nota ini BELUM tersimpan di database — skema alokasi per baris belum aktif. `
        + 'Catat pembagiannya di luar aplikasi sampai migrasi dijalankan, dan jangan menganggap biaya sudah masuk ke proyek.'
      : '',
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
// JALUR ATOMIK — satu transaksi untuk header + baris typed + alokasi + antrean
// --------------------------------------------------------
// Dipakai HANYA bila `capability.allocationPersisted` (probe membuktikan
// kolom typed, tabel alokasi, DAN RPC-nya ada). Kontrak RPC disepakati dengan
// schema owner (t_2b8dcab3, OPERATIONAL_CONTRACT_v1):
//
//   purchase_save_atomic(p_payload jsonb) -> jsonb
//   { client_request_id, vendor_id, invoice_no, purchased_date, note,
//     extra_cost, discount, receipt_url?, payment_proof_url?,
//     queue_handover?, items:[{ pr_item_id?, material_id, project_id?,
//       item_name, unit, quantity_received, unit_price, note?,
//       allocations?:[{project_id, qty}] }] }
//
// Return `null` bila RPC tidak bisa dipakai → pemanggil jatuh ke jalur lama
// DENGAN label jujur (nota tetap tercatat; alokasi tidak diklaim).
async function savePurchaseAtomic({
  client, nota, header, invoiceNo, isInternalRef, clientRequestId,
  queueHandover, headerNoteSuffix, lineNoteSuffixes, projectIdOverride, prIdOverride
}) {
  // Material per baris: baris PR mewarisi material_id dari pr_items (exact),
  // baris langsung wajib sudah membawa materialId dari form. TIDAK ditebak
  // dari nama — kalau tidak ada, serahkan null dan biarkan DB yang menolak
  // (kontrak: material_id REQUIRED untuk write v1).
  const items = (nota.items || []).map((it, idx) => {
    const lineSuffix = String(lineNoteSuffixes[idx] || '').trim()
    const allocs = Array.isArray(it.allocations) && it.allocations.length
      ? it.allocations.map(a => ({ project_id: a.projectId, qty: a.qty }))
      : null
    return {
      pr_item_id: it.prItemId || null,
      material_id: it.materialId || null,
      project_id: allocs ? null : (it.projectId || projectIdOverride || null),
      item_name: it.itemName,
      unit: it.unit || null,
      quantity_received: it.qty,
      unit_price: it.harga,
      note: lineSuffix || null,
      ...(allocs ? { allocations: allocs } : {})
    }
  })

  const payload = {
    client_request_id: clientRequestId,
    vendor_id: header.vendorId,
    invoice_no: invoiceNo,
    purchased_date: header.tanggal,
    note: [buildPurchaseNote({
      material: header.material,
      biayaLain: header.biayaLain,
      diskon: header.diskon,
      notaUrl: header.notaUrl,
      buktiNota: header.buktiNota,
      buktiTransfer: header.buktiTransfer,
      catatan: header.catatan,
      tahap: TAHAP_DIBELI
    }), String(headerNoteSuffix || '').trim()].filter(Boolean).join(' ').trim() || null,
    extra_cost: header.biayaLain,
    discount: header.diskon,
    ...(header.notaUrl ? { receipt_url: header.notaUrl } : {}),
    queue_handover: !!queueHandover,
    items
  }

  let res
  try {
    res = await client.rpc('purchase_save_atomic', { p_payload: payload })
  } catch (err) {
    // Jaringan/transport: JANGAN mengaku sukses dan JANGAN jatuh ke jalur lama
    // (itu akan menulis dua kali). Pemanggil harus mencoba lagi dengan
    // client_request_id yang SAMA — RPC idempoten.
    return {
      ok: false,
      reason: 'rpc_unreachable',
      error: `Gagal menghubungi penyimpanan atomik: ${err.message}. Coba lagi — permintaan ini tidak akan tercatat dua kali.`
    }
  }
  const { data, error } = res || {}
  if (error) {
    const code = String(error.code || '')
    const msg = String(error.message || '')
    // Fungsi hilang di tengah jalan → bukan kesalahan pengguna. Kembalikan
    // null supaya jalur lama dipakai dengan label jujur.
    if (code === 'PGRST202' || /Could not find the function/i.test(msg)) return null
    if (code === '42501') {
      return { ok: false, reason: 'forbidden', error: 'Hanya admin yang boleh menyimpan nota pembelian.' }
    }
    return { ok: false, error: `Gagal menyimpan nota: ${msg}` }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Penyimpanan tidak mengembalikan hasil yang bisa dibaca. Periksa Riwayat Pembelian sebelum menyimpan ulang.' }
  }
  if (data.ok === false) {
    const reason = String(data.reason || '')
    const messages = {
      duplicate_invoice: `Nota ${invoiceNo} untuk toko ini sudah tercatat sebelumnya (Riwayat Pembelian). Buka nota itu alih-alih menyimpan ulang.`,
      idempotency_conflict: 'Permintaan ini memakai kunci yang sama dengan nota yang sudah tersimpan, tetapi isinya berbeda. Buka Riwayat Pembelian untuk memeriksa nota yang sudah ada.',
      forbidden: 'Hanya admin yang boleh menyimpan nota pembelian.',
      material_unresolved: 'Ada barang yang belum terhubung ke master material. Pilih materialnya dulu — biaya tidak boleh masuk tanpa identitas material.',
      allocation_sum_mismatch: 'Jumlah pembagian qty antarproyek tidak sama dengan qty beli. Periksa kembali pembagiannya.',
      allocation_needs_two_projects: 'Pembagian baris ke proyek butuh minimal dua proyek berbeda.',
      item_qty: 'Ada qty barang yang tidak sah.',
      item_price: 'Ada harga satuan yang tidak sah (harus lebih dari 0).'
    }
    return {
      ok: false,
      reason: reason || 'rejected',
      error: messages[reason] || String(data.error || 'Penyimpanan menolak nota ini.')
    }
  }

  // READBACK: pakai baris DB yang dikembalikan RPC, BUKAN echo payload.
  const dbItems = Array.isArray(data.items) ? data.items : []
  const dbAllocs = Array.isArray(data.allocations) ? data.allocations : []

  // Ringkasan alokasi per proyek DIHITUNG DARI BARIS DB. Kalau RPC tidak
  // mengembalikan alokasi, ringkasan kosong — bukan dikarang dari form.
  const byProject = new Map()
  for (const a of dbAllocs) {
    const pid = a.project_id || null
    const cur = byProject.get(pid) || { projectId: pid, items: 0, material: 0 }
    cur.items += 1
    cur.material += Number(a.amount || 0)
    byProject.set(pid, cur)
  }
  for (const it of dbItems) {
    if (!it.project_id || dbAllocs.length) continue
    const pid = it.project_id
    const cur = byProject.get(pid) || { projectId: pid, items: 0, material: 0 }
    cur.items += 1
    cur.material += Math.round(Number(it.quantity_received || 0) * Number(it.unit_price || 0))
    byProject.set(pid, cur)
  }

  const vendorName = (header.vendorId && (data.vendor_name || '')) || ''
  const labelNota = isInternalRef ? `${invoiceNo} (ref. internal)` : invoiceNo
  const total = Number(data.total ?? header.total)

  return {
    ok: true,
    already: !!data.already,
    atomic: true,
    receivingId: data.receiving_id || null,
    handoverId: data.handover_id || null,
    handoverQueued: !!data.handover_id,
    handoverError: '',
    vendorName,
    invoiceNo,
    isInternalRef,
    internalRefId: isInternalRef ? invoiceNo : null,
    clientRequestId,
    // TANDA PALING PENTING: alokasi benar-benar tersimpan di DB.
    allocationPersisted: true,
    alokasi: [...byProject.values()],
    items: dbItems.map(it => ({
      id: it.id || null,
      receiving_id: it.receiving_id || null,
      pr_item_id: it.pr_item_id || null,
      material_id: it.material_id || null,
      item_name: it.item_name,
      unit: it.unit || null,
      quantity_received: Number(it.quantity_received || 0),
      unit_price: it.unit_price === null || it.unit_price === undefined ? null : Number(it.unit_price),
      projectId: it.project_id || null
    })),
    allocations: dbAllocs,
    itemCount: dbItems.length,
    material: Number(data.material ?? header.material),
    biayaLain: Number(data.extra_cost ?? header.biayaLain),
    diskon: Number(data.discount ?? header.diskon),
    total,
    message: data.already
      ? `Nota ${labelNota} sudah tersimpan sebelumnya — tidak ada data yang ditulis ulang.`
      : `Nota ${labelNota}${vendorName ? ` (${vendorName})` : ''} tersimpan: ${dbItems.length} barang, total ${new Intl.NumberFormat('id-ID').format(total)}. Alokasi proyek per barang ikut tersimpan.`
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
