/**
 * Shared PDF asset loading for the browser and for Node scripts.
 * Both callers pass byte arrays, so the renderer stays environment agnostic.
 */

import logoUrl from '../assets/noir-logo.jpg?url';
import fontRegularUrl from '../assets/fonts/Carlito-Regular.ttf?url';
import fontBoldUrl from '../assets/fonts/Carlito-Bold.ttf?url';

let cache = null;

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal memuat aset PDF: ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** @returns {Promise<{logoBytes: Uint8Array, fontRegular: Uint8Array, fontBold: Uint8Array}>} */
export async function loadPdfAssets() {
  if (cache) return cache;
  const [logoBytes, fontRegular, fontBold] = await Promise.all([
    fetchBytes(logoUrl),
    fetchBytes(fontRegularUrl),
    fetchBytes(fontBoldUrl),
  ]);
  cache = { logoBytes, fontRegular, fontBold };
  return cache;
}

export const ASSET_URLS = { logoUrl, fontRegularUrl, fontBoldUrl };
