// ============================================================
// modules/receivings/attachments.js — LAMPIRAN BUKTI BELANJA
// ============================================================
// Foto nota/struk & bukti transfer disimpan sebagai data-URL base64 DI DALAM
// kolom catatan nota (pola yang sama dengan bukti foto Handover) karena:
//   - Supabase Storage proyek ini belum punya bucket (dicek read-only:
//     `listBuckets` -> kosong), jadi upload file belum punya tempat resmi;
//   - skema DB dibekukan (tidak ada kolom lampiran baru dari task ini).
//
// BATAS UKURAN: 1 MB per lampiran (byte data-URL sebenarnya). Bila browser
// mendukung canvas, gambar diperkecil dulu (maks 1600 px, JPEG 0.8) supaya
// foto kamera HP tetap muat — hasilnya tetap diperiksa terhadap batas.
// Tanpa canvas (mis. lingkungan uji), file dipakai apa adanya lalu divalidasi.
//
// Semua fungsi di sini aman dipanggil tanpa DOM: bagian browser dijaga
// `typeof` supaya file ini bisa diuji di sandbox tanpa merusak build SSR.
// ============================================================

export const ATTACHMENT_MAX_BYTES = 1024 * 1024 // 1 MB per lampiran
export const ATTACHMENT_MAX_DIM = 1600

// Ukuran byte sebenarnya dari data-URL base64 (padding '=' bukan data).
export function dataUrlByteSize(dataUrl) {
  const s = String(dataUrl || '')
  const comma = s.indexOf(',')
  if (!/^data:/i.test(s) || comma < 0) return 0
  const b64 = s.slice(comma + 1)
  const pad = (b64.match(/=+$/) || [''])[0].length
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad)
}

// Pesan peringatan ukuran ('' = valid).
export function validateAttachmentSize(sizeBytes, maxBytes = ATTACHMENT_MAX_BYTES) {
  const n = Number(sizeBytes)
  if (!isFinite(n) || n <= 0) return ''
  if (n > maxBytes) {
    const mb = (n / (1024 * 1024)).toFixed(2).replace('.', ',')
    const limit = (maxBytes / (1024 * 1024)).toFixed(0)
    return `⚠️ Ukuran file ${mb} MB melebihi batas ${limit} MB. Pilih foto yang lebih kecil.`
  }
  return ''
}

// Label ramah ukuran file.
export function sizeLabel(bytes) {
  const n = Number(bytes)
  if (!isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`
}

// Apakah nilai lampiran berupa gambar yang bisa dipratinjau?
export function isImageDataUrl(v) {
  return /^data:image\//i.test(String(v || ''))
}

// Baca file -> data-URL, diperkecil bila canvas tersedia.
// Mengembalikan { ok, dataUrl, size, error }.
export function readAttachment(file, { maxBytes = ATTACHMENT_MAX_BYTES } = {}) {
  return new Promise(resolve => {
    if (!file) { resolve({ ok: false, error: 'Tidak ada file yang dipilih.' }); return }
    const reader = new FileReader()
    reader.onerror = () => resolve({ ok: false, error: '⚠️ Gagal membaca file. Coba pilih ulang.' })
    reader.onload = () => {
      const raw = String(reader.result || '')
      const rawErr = validateAttachmentSize(dataUrlByteSize(raw), maxBytes)
      if (rawErr) { resolve({ ok: false, error: rawErr }); return }

      const finish = (dataUrl) => {
        const size = dataUrlByteSize(dataUrl)
        const err = validateAttachmentSize(size, maxBytes)
        if (err) { resolve({ ok: false, error: err }); return }
        resolve({ ok: true, dataUrl, size })
      }

      // Perkecil hanya bila file > 60% batas dan canvas tersedia.
      if (dataUrlByteSize(raw) < maxBytes * 0.6 || !canUseCanvas()) { finish(raw); return }
      downscale(raw)
        .then(out => finish(out || raw))
        .catch(() => finish(raw))
    }
    reader.readAsDataURL(file)
  })
}

function canUseCanvas() {
  try {
    if (typeof document === 'undefined') return false
    const c = document.createElement('canvas')
    return !!(c && typeof c.getContext === 'function' && c.getContext('2d'))
  } catch (e) {
    return false
  }
}

function downscale(dataUrl) {
  return new Promise((resolve, reject) => {
    try {
      const img = document.createElement('img')
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width
          const h = img.naturalHeight || img.height
          if (!w || !h) { resolve(dataUrl); return }
          const scale = Math.min(1, ATTACHMENT_MAX_DIM / Math.max(w, h))
          const cw = Math.max(1, Math.round(w * scale))
          const ch = Math.max(1, Math.round(h * scale))
          const canvas = document.createElement('canvas')
          canvas.width = cw
          canvas.height = ch
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(dataUrl); return }
          ctx.drawImage(img, 0, 0, cw, ch)
          resolve(canvas.toDataURL('image/jpeg', 0.8))
        } catch (e) { resolve(dataUrl) }
      }
      img.onerror = () => reject(new Error('gambar tidak bisa dibaca'))
      img.src = dataUrl
    } catch (e) { reject(e) }
  })
}
