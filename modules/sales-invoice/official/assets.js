// ============================================================
// modules/sales-invoice/official/assets.js — pemuat aset PDF template resmi
// ============================================================
// Di generator asli (Vite) aset diimpor lewat `?url`. Di Next.js aset statis
// disajikan dari `public/`, jadi di sini diambil dengan fetch ke path publik
// yang sama. Di Node (uji) fetch file:// tidak dipakai — pemanggil boleh
// mengirim byte sendiri lewat opsi `assets`.
// ============================================================

export const ASSET_URLS = Object.freeze({
  logoUrl: '/invoice-assets/noir-logo.jpg',
  fontRegularUrl: '/invoice-assets/Carlito-Regular.ttf',
  fontBoldUrl: '/invoice-assets/Carlito-Bold.ttf'
})

let cache = null

async function fetchBytes(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gagal memuat aset PDF: ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/** @returns {Promise<{logoBytes: Uint8Array, fontRegular: Uint8Array, fontBold: Uint8Array}>} */
export async function loadPdfAssets() {
  if (cache) return cache
  const [logoBytes, fontRegular, fontBold] = await Promise.all([
    fetchBytes(ASSET_URLS.logoUrl),
    fetchBytes(ASSET_URLS.fontRegularUrl),
    fetchBytes(ASSET_URLS.fontBoldUrl)
  ])
  cache = { logoBytes, fontRegular, fontBold }
  return cache
}
