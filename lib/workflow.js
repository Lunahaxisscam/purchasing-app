// ============================================================
// Web data-exchanging layer: export & parse Excel tanpa library luar.
// Semua fungsi murni di browser, tidak butuh server, tidak menambah
// dependensi npm (build hanya memakai paket yang sudah ada di project).
// ============================================================

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

// --- Label header per kolom (konsisten dengan tabel di UI) ---
const HEADER_LABEL = {
  pr_number: 'No. PR',
  project_name: 'Project',
  title: 'Judul Kebutuhan',
  materials_summary: 'Item Material',
  priority: 'Prioritas',
  status: 'Status',
  notes: 'Catatan',
  created_at: 'Dibuat',
  step_number: 'Step',
  decided_at: 'Waktu Putusan',
  delivery_note: 'Surat Jalan / PO',
  invoice_no: 'No. Invoice',
  received_date: 'Tgl Terima',
  handover_date: 'Tgl Serah Terima',
  received_by: 'Diterima Oleh',
  name: 'Nama',
  kode: 'Kode',
  code: 'Kode',
  category: 'Kategori',
  qty: 'Qty',
  satuan: 'Satuan',
  unit: 'Satuan',
  contact: 'Kontak',
  phone: 'Kontak WA',
  store_link: 'Link Toko',
  supplier_category: 'Kategori Material' 
}

function toHeader(col) {
  return HEADER_LABEL[col] || String(col).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtValue(v, col) {
  if (v === null || v === undefined || v === '') return ''
  if (col === 'created_at' || col === 'decided_at' || col === 'received_date' || col === 'handover_date') {
    const d = new Date(v)
    if (!isNaN(d.getTime())) {
      return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear()
    }
  }
  return v
}

function pickColumns(rows, columns) {
  return (columns && columns.length ? columns : Object.keys((rows && rows[0]) || { a: 1 }))
    .filter(c => !['id', 'password'].includes(c))
}

// ============================================================
// Pembuat file XLSX (zip arsip minimal, tanpa library)
// ============================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

function toBytes(str) {
  return new TextEncoder().encode(str)
}

function zipStore(files) {
  // files: [{ name, data: Uint8Array }] — metode "store" (tanpa kompresi)
  const chunks = []
  const central = []
  let offset = 0

  const u16 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff])
  const u32 = (n) => new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff])

  for (const f of files) {
    const nameBytes = toBytes(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes
    ]
    chunks.push(new Uint8Array(local))
    chunks.push(f.data)

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset),
      ...nameBytes
    ]))

    offset += local.length + size
  }

  const centralBytes = central.reduce((acc, c) => {
    const merged = new Uint8Array(acc.length + c.length)
    merged.set(acc); merged.set(c, acc.length)
    return merged
  }, new Uint8Array(0))

  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralBytes.length), ...u32(offset), ...u16(0)
  ]

  const all = [...chunks.map(c => [...c]), [...centralBytes], end]
  const total = all.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // buang karakter kontrol yang membuat XML tidak valid
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colLetter(index) {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function buildSheetXml(matrix) {
  const rowsCount = matrix.length
  let rows = ''
  matrix.forEach((cells, r) => {
    let row = '<row r="' + (r + 1) + '">'
    cells.forEach((v, c) => {
      const ref = colLetter(c) + (r + 1)
      if (v === null || v === undefined || v === '') return
      if (typeof v === 'number' && isFinite(v)) {
        row += '<c r="' + ref + '"><v>' + v + '</v></c>'
      } else {
        row += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(v) + '</t></is></c>'
      }
    })
    row += '</row>'
    rows += row
  })
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="A1:' + colLetter(Math.max(0, (matrix[0] || []).length - 1)) + rowsCount + '"/>' +
    '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    '<sheetData>' + rows + '</sheetData>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    '</worksheet>'
}

function buildWorkbookXml(sheetNames) {
  let sheets = ''
  sheetNames.forEach((n, i) => {
    sheets += '<sheet name="' + xmlEscape(String(n).slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '" />'
  })
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + sheets + '</sheets></workbook>'
}

function buildWorkbookRels(sheetCount) {
  let rels = ''
  for (let i = 0; i < sheetCount; i++) {
    rels += '<Relationship Id="rId' + (i + 1) + '" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      'Target="worksheets/sheet' + (i + 1) + '.xml"/>'
  }
  rels += '<Relationship Id="rId' + (sheetCount + 1) + '" ' +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
    'Target="styles.xml"/>'
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>'
}

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const CONTENT_TYPES = (sheetCount) => {
  let overrides = '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
  for (let i = 0; i < sheetCount; i++) {
    overrides += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  }
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    overrides + '</Types>'
}

/** Bikin file .xlsx dari array of sheets: [{ name, matrix }] */
function buildXlsx(sheets) {
  const files = [
    { name: '[Content_Types].xml', data: toBytes(CONTENT_TYPES(sheets.length)) },
    { name: '_rels/.rels', data: toBytes(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: toBytes(buildWorkbookXml(sheets.map(s => s.name))) },
    { name: 'xl/_rels/workbook.xml.rels', data: toBytes(buildWorkbookRels(sheets.length)) },
    { name: 'xl/styles.xml', data: toBytes(STYLES_XML) }
  ]
  sheets.forEach((s, i) => {
    files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: toBytes(buildSheetXml(s.matrix)) })
  })
  return zipStore(files)
}

// ============================================================
// Ekspor
// ============================================================

function matrixFrom(rows, columns) {
  const cols = pickColumns(rows, columns)
  return [
    cols.map(toHeader),
    ...(rows || []).map(r => cols.map(c => fmtValue(r[c], c)))
  ]
}

export function exportToExcel(rows, columns, filenameBase) {
  const blob = new Blob([buildXlsx([{ name: 'Data', matrix: matrixFrom(rows, columns) }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  triggerDownload(blob, `${filenameBase}-${stamp()}.xlsx`)
}

export function exportToCsv(rows, columns, filenameBase) {
  const cols = pickColumns(rows, columns)
  const esc = v => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`
  const lines = [cols.map(c => esc(toHeader(c))).join(',')]
  for (const r of (rows || [])) lines.push(cols.map(c => esc(fmtValue(r[c], c))).join(','))
  triggerDownload(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${filenameBase}-${stamp()}.csv`)
}

export function exportWorkbook(sheets, filenameBase) {
  const built = sheets.map(([name, rows, columns]) => ({ name: name || 'Sheet', matrix: matrixFrom(rows, columns) }))
  const blob = new Blob([buildXlsx(built)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  triggerDownload(blob, `${filenameBase}-${stamp()}.xlsx`)
}

// ============================================================
// Template impor item PR
// ============================================================

const IMPORT_HEADERS = ['Kode Material', 'Nama Material', 'Qty', 'Satuan']

export function downloadPrImportTemplate(masterList = []) {
  const dataMatrix = [IMPORT_HEADERS]
  for (const m of (masterList || []).slice(0, 400)) {
    dataMatrix.push([m.kode || m.code || '', m.name || '', '', m.satuan || m.unit || 'Pcs'])
  }
  const guide = [
    ['CARA PAKAI TEMPLATE IMPORT ITEM PURCHASE REQUEST'],
    [''],
    ['1. Isi Sheet "Data Material": kolom Kode Material, Nama Material, Qty (wajib), Satuan (opsional).'],
    ['2. Kode Material bisa dikosongkan (mengisi Nama saja) asal Nama sama persis dengan master material.'],
    ['3. Qty diisi angka, contoh: 5 / 12 / 20.5'],
    ['4. Jangan mengubah urutan/nama kolom header (baris pertama).'],
    ['5. Simpan file, lalu di form PR klik "Import Excel" dan pilih file ini.'],
    [''],
    ['Kolom wajib'],
    ['  - Qty'],
    ['Kolom opsional'],
    ['  - Kode Material (tambah akurasi pemilihan bila nama material kembar)'],
    ['  - Satuan (bila kosong, otomatis memakai satuan dari master material)']
  ]
  const blob = new Blob([buildXlsx([
    { name: 'Data Material', matrix: dataMatrix },
    { name: 'Petunjuk', matrix: guide }
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  triggerDownload(blob, `Template-Import-Item-PR-${stamp()}.xlsx`)
}

// ============================================================
// Pembaca XLSX di browser — dibutuhkan untuk fitur Import Excel.
// XLSX = zip berisi XML; zip bisa memakai metode simpan biasa (store)
// atau deflate. Keduanya dibaca di sini.
// ============================================================

function unzipXlsx(arrayBuffer) {
  const files = {}
  const u8 = new Uint8Array(arrayBuffer)
  let p = 0
  while (p + 30 <= u8.length) {
    const sig = (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0
    if (sig !== 0x04034b50) break
    const flags = u8[p + 6] | (u8[p + 7] << 8)
    const method = u8[p + 8] | (u8[p + 9] << 8)
    const compSize = (u8[p + 18] | (u8[p + 19] << 8) | (u8[p + 20] << 16) | (u8[p + 21] << 24)) >>> 0
    const uncompSize = (u8[p + 22] | (u8[p + 23] << 8) | (u8[p + 24] << 16) | (u8[p + 25] << 24)) >>> 0
    const nameLen = u8[p + 26] | (u8[p + 27] << 8)
    const extraLen = u8[p + 28] | (u8[p + 29] << 8)
    const nameStart = p + 30
    const dataStart = nameStart + nameLen + extraLen
    const name = new TextDecoder().decode(u8.subarray(nameStart, nameStart + nameLen))
    const raw = u8.subarray(dataStart, dataStart + compSize)

    let out
    if (method === 0) {
      out = raw
    } else if (method === 8) {
      out = inflateRaw(raw, uncompSize)
    } else {
      out = new Uint8Array(0)
    }
    files[name] = out

    p = dataStart + compSize
    if ((flags & 0x08) && compSize === 0) break
  }
  return files
}

// ---- Raw DEFLATE decoder (RFC 1951) — cukup untuk XML di dalam XLSX ----
const LENGTH_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258]
const LENGTH_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577]
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]

function inflateRaw(data, expectedSize) {
  let bitPos = 0
  const readBit = () => {
    const b = (data[bitPos >> 3] >> (bitPos & 7)) & 1
    bitPos++
    return b
  }
  const readBits = (n) => {
    let v = 0
    for (let i = 0; i < n; i++) v |= readBit() << i
    return v
  }

  let buffer = new Uint8Array(Math.max(65536, expectedSize || 0))
  let pos = 0
  const putByte = (b) => {
    if (pos >= buffer.length) {
      const bigger = new Uint8Array(buffer.length * 2)
      bigger.set(buffer)
      buffer = bigger
    }
    buffer[pos++] = b
  }

  const buildHuffman = (lengths) => {
    const maxBits = Math.max(0, ...lengths)
    const counts = new Array(maxBits + 1).fill(0)
    for (const l of lengths) if (l) counts[l]++
    const offsets = new Array(maxBits + 1).fill(0)
    for (let i = 1; i <= maxBits; i++) offsets[i] = offsets[i - 1] + counts[i - 1]
    const symbols = new Array(lengths.length).fill(0)
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i
    return { counts, symbols, maxBits }
  }
  const decodeSym = (h) => {
    let code = 0, first = 0, index = 0
    for (let len = 1; len <= h.maxBits; len++) {
      code |= readBit()
      const count = h.counts[len]
      if (code - first < count) return h.symbols[index + (code - first)]
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    return -1
  }

  const FIXED_LIT = (() => {
    const lengths = new Array(288).fill(0)
    for (let i = 0; i <= 143; i++) lengths[i] = 8
    for (let i = 144; i <= 255; i++) lengths[i] = 9
    for (let i = 256; i <= 279; i++) lengths[i] = 7
    for (let i = 280; i <= 287; i++) lengths[i] = 8
    return buildHuffman(lengths)
  })()
  const FIXED_DIST = buildHuffman(new Array(30).fill(5))

  for (;;) {
    const bFinal = readBit()
    const bType = readBits(2)

    if (bType === 0) {
      bitPos = (bitPos + 7) & ~7
      const p8 = bitPos >> 3
      const len = data[p8] | (data[p8 + 1] << 8)
      for (let i = 0; i < len; i++) putByte(data[p8 + 4 + i])
      bitPos += 32
    } else if (bType === 1 || bType === 2) {
      let litH, distH
      if (bType === 1) {
        litH = FIXED_LIT
        distH = FIXED_DIST
      } else {
        const hlit = readBits(5) + 257
        const hdist = readBits(5) + 1
        const hclen = readBits(4) + 4
        const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]
        const cl = new Array(19).fill(0)
        for (let i = 0; i < hclen; i++) cl[order[i]] = readBits(3)
        const clH = buildHuffman(cl)
        const lengths = new Array(hlit + hdist).fill(0)
        let i = 0
        while (i < hlit + hdist) {
          const s = decodeSym(clH)
          if (s < 16) lengths[i++] = s
          else if (s === 16) {
            const prev = lengths[i - 1] || 0
            const rep = readBits(2) + 3
            for (let k = 0; k < rep; k++) lengths[i++] = prev
          } else if (s === 17) {
            const rep = readBits(3) + 3
            for (let k = 0; k < rep; k++) lengths[i++] = 0
          } else {
            const rep = readBits(7) + 11
            for (let k = 0; k < rep; k++) lengths[i++] = 0
          }
        }
        litH = buildHuffman(lengths.slice(0, hlit))
        distH = buildHuffman(lengths.slice(hlit))
      }

      for (;;) {
        const s = decodeSym(litH)
        if (s < 0) break
        if (s < 256) {
          putByte(s)
        } else if (s === 256) {
          break
        } else {
          const li = s - 257
          const length = LENGTH_BASE[li] + readBits(LENGTH_EXTRA[li])
          const ds = decodeSym(distH)
          const dist = DIST_BASE[ds] + readBits(DIST_EXTRA[ds])
          const start = pos - dist
          for (let k = 0; k < length; k++) putByte(buffer[start + k])
        }
      }
    }

    if (bFinal) break
  }
  return buffer.subarray(0, pos)
}

function decodeXml(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function colFromLetter(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readXlsxMatrix(arrayBuffer) {
  const files = unzipXlsx(arrayBuffer)

  let shared = []
  if (files['xl/sharedStrings.xml']) {
    const xml = new TextDecoder().decode(files['xl/sharedStrings.xml'])
    const siBlocks = xml.match(/<si[\s\S]*?<\/si>/g) || []
    shared = siBlocks.map(si => {
      const texts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1]))
      return texts.join('')
    })
  }

  // Cari sheet pertama: urutkan berdasarkan nomor pada nama file worksheet
  const sheetFiles = Object.keys(files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)\.xml/)[1], 10)
      const nb = parseInt(b.match(/sheet(\d+)\.xml/)[1], 10)
      return na - nb
    })
  const sheetName = sheetFiles[0] || 'xl/worksheets/sheet1.xml'
  const xml = new TextDecoder().decode(files[sheetName])

  const matrix = []
  const rowMatches = xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) || []
  for (const rowXml of rowMatches) {
    const cells = {}
    let maxCol = -1
    const cellMatches = rowXml.match(/<c [^>]*>[\s\S]*?<\/c>|<c [^>]*\/>/g) || []
    for (const cellXml of cellMatches) {
      const refMatch = cellXml.match(/r="([A-Z]+)(\d+)"/)
      if (!refMatch) continue
      const colIdx = colFromLetter(refMatch[1])
      if (colIdx > maxCol) maxCol = colIdx
      const type = (cellXml.match(/t="([^"]+)"/) || [])[1] || 'n'
      const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/)
      const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)
      let value = ''
      if (type === 's') {
        value = shared[Number(vMatch ? vMatch[1] : 0)] ?? ''
      } else if (type === 'inlineStr') {
        value = tMatch ? decodeXml(tMatch[1]) : ''
      } else {
        value = vMatch ? decodeXml(vMatch[1]) : (tMatch ? decodeXml(tMatch[1]) : '')
      }
      cells[colIdx] = value
    }
    const rowArr = []
    for (let c = 0; c <= maxCol; c++) rowArr.push(cells[c] === undefined ? '' : cells[c])
    matrix.push(rowArr)
  }
  return matrix
}

// --- CSV / TSV ---
function parseDelimited(text, delim) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * Baca file Excel/CSV -> daftar item PR { material_id, name, qty, satuan, kode }
 * Item yang cocok dengan master material di-return, sisanya masuk errors.
 */
export function parsePrItemsFile(arrayBuffer, fileName, masterList = []) {
  const isCsv = /\.csv$/i.test(fileName || '')
  let rows
  if (isCsv) {
    const text = new TextDecoder().decode(arrayBuffer)
    rows = parseDelimited(text, text.includes(';') && !text.includes(',') ? ';' : ',')
  } else {
    rows = readXlsxMatrix(arrayBuffer)
  }

  if (!rows || !rows.length) return { items: [], errors: ['File kosong atau tidak terbaca.'] }

  let headerIdx = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = (rows[i] || []).map(c => String(c || '').toLowerCase()).join(' ')
    if (joined.includes('qty') || joined.includes('kuantitas')) { headerIdx = i; break }
  }
  const header = (rows[headerIdx] || []).map(c => String(c || '').trim())

  const idxKode = detectColumn(header, ['kode material', 'kode', 'code'])
  const idxNama = detectColumn(header, ['nama material', 'nama', 'material', 'item'])
  const idxQty = detectColumn(header, ['qty', 'kuantitas', 'jumlah'])
  const idxSatuan = detectColumn(header, ['satuan', 'unit', 'uom'])

  const errors = []
  const warnings = []

  if (idxQty === -1) errors.push(`Kolom "Qty" tidak ditemukan. Header terbaca: ${header.filter(Boolean).join(', ')}`)
  if (idxNama === -1 && idxKode === -1) errors.push('Kolom "Nama Material" atau "Kode Material" tidak ditemukan.')
  if (errors.length) return { items: [], errors, warnings }

  const byKode = new Map()
  const byName = new Map()
  for (const m of (masterList || [])) {
    const k1 = String(m.kode || m.code || '').trim().toLowerCase()
    if (k1) byKode.set(k1, m)
    const k2 = normalizeName(m.name)
    if (k2 && !byName.has(k2)) byName.set(k2, m)
  }

  const items = []
  const matchedIds = new Set()

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every(c => String(c || '').trim() === '')) continue
    const nama = idxNama >= 0 ? String(row[idxNama] || '').trim() : ''
    const kode = idxKode >= 0 ? String(row[idxKode] || '').trim() : ''
    const qtyRaw = idxQty >= 0 ? row[idxQty] : ''
    const qty = Number(String(qtyRaw).replace(',', '.'))
    const satuan = idxSatuan >= 0 ? String(row[idxSatuan] || '').trim() : ''

    if (!nama && !kode) { warnings.push(`Baris ${i + 1}: tidak ada nama/kode material, dilewati.`); continue }
    if (!isFinite(qty) || qty <= 0) { errors.push(`Baris ${i + 1} ("${nama || kode}"): Qty tidak valid ("${qtyRaw}").`); continue }

    let mat = null
    if (kode) mat = byKode.get(kode.toLowerCase())
    if (!mat && nama) mat = byName.get(normalizeName(nama))
    if (!mat && kode) {
      const k2 = normalizeName(kode)
      for (const [key, m] of byKode) { if (normalizeName(key) === k2) { mat = m; break } }
    }

    if (!mat) {
      errors.push(`Baris ${i + 1} ("${nama || kode}"): tidak ditemukan di master material.`)
      continue
    }

    if (matchedIds.has(mat.id)) {
      const prev = items.find(x => x.material_id === mat.id)
      if (prev) prev.qty = Number((Number(prev.qty) + qty).toFixed(4))
      continue
    }
    matchedIds.add(mat.id)
    items.push({
      material_id: mat.id,
      kode: mat.kode || mat.code || '—',
      name: mat.name,
      category: mat.category || '—',
      satuan: satuan || mat.satuan || mat.unit || 'Pcs',
      qty: Number(qty.toFixed(4))
    })
  }

  return { items, errors, warnings, fileName: fileName || 'file' }
}

function detectColumn(headerRow, patterns) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '').toLowerCase().trim()
    if (patterns.some(p => h === p || h.includes(p))) return i
  }
  return -1
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
