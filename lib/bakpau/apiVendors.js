// ============================================================
// lib/bakpau/apiVendors.js — TAMBAH VENDOR VIA API BAKPAU (SERVER-ONLY)
// ============================================================
// Izin DAT (2026-11-12): Bakpau boleh MENAMBAH vendor baru lewat API
// resmi (scope purchasing:vendors:write + saklar env terpisah), dengan
// aturan:
//   * nama wajib; duplikat (case-insensitive) DITOLAK 409 — tidak ada
//     vendor kembar yang mengacaukan laporan per-vendor;
//   * insert via klien service (tabel vendors + trigger trg_activity_log
//     di DB sudah mencatat jejak audit otomatis per baris);
//   * kolom mengikuti form admin (modules/vendors/save.js): name, phone,
//     store_link, supplier_category, contact — tidak ada kolom baru;
//   * balasan sukses memuat vendor_id hasil readback exact.
// ============================================================

import { API_REASON } from './apiAuth.js'

const LIMITS = Object.freeze({
  NAME_MIN: 2,
  NAME_MAX: 120,
  PHONE_MAX: 40,
  STORE_LINK_MAX: 300,
  CATEGORY_MAX: 200,
  CONTACT_MAX: 200
})

function bad(error, code = 'invalid_payload', status = 422) {
  return { ok: false, status, code, error }
}

// ------------------------------------------------------------
// Validasi payload tambah vendor (murni, tanpa DB)
// Input API: { name, phone?, storeLink?, supplierCategory?, contact? }
// ------------------------------------------------------------
export function buildVendorInsertArgs(json = {}) {
  const name = String(json.name || '').trim()
  if (name.length < LIMITS.NAME_MIN) {
    return bad('Nama vendor wajib diisi (minimal 2 karakter).')
  }
  if (name.length > LIMITS.NAME_MAX) {
    return bad(`Nama vendor terlalu panjang (maks ${LIMITS.NAME_MAX} karakter).`)
  }

  const phone = String(json.phone || '').trim()
  if (phone.length > LIMITS.PHONE_MAX) {
    return bad(`Nomor telepon terlalu panjang (maks ${LIMITS.PHONE_MAX}).`)
  }

  const storeLink = String(json.storeLink || '').trim()
  if (storeLink.length > LIMITS.STORE_LINK_MAX) {
    return bad(`Link toko terlalu panjang (maks ${LIMITS.STORE_LINK_MAX}).`)
  }

  // Multi-kategori dipisah koma — format yang sama dengan form admin
  // (modules/vendors/save.js membersihkan trim/dedupe; lakukan hal serupa).
  const seen = new Set()
  const kategori = String(json.supplierCategory || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .join(', ')
  if (kategori.length > LIMITS.CATEGORY_MAX) {
    return bad(`Kategori terlalu panjang (maks ${LIMITS.CATEGORY_MAX}).`)
  }

  const contact = String(json.contact || '').trim()
  if (contact.length > LIMITS.CONTACT_MAX) {
    return bad(`Kontak PIC terlalu panjang (maks ${LIMITS.CONTACT_MAX}).`)
  }

  return {
    ok: true,
    args: {
      name,
      phone: phone || null,
      store_link: storeLink || null,
      supplier_category: kategori || null,
      contact: contact || null
    }
  }
}

// ------------------------------------------------------------
// Simpan vendor (dedupe -> insert -> readback exact)
// client = klien service server (service_role). Activity log ditulis
// otomatis oleh trigger DB — kode ini tidak menulis log kedua.
// ------------------------------------------------------------
export async function saveVendor({ client, args } = {}) {
  if (!client || typeof client.from !== 'function') {
    return { ok: false, status: 503, code: API_REASON.NO_SERVICE_CREDENTIALS, error: 'Klien DB server tidak tersedia.' }
  }

  // Duplikat case-insensitive: satu vendor, satu identitas.
  let dupe
  try {
    dupe = await client.from('vendors').select('id, name').ilike('name', args.name).maybeSingle()
  } catch {
    return { ok: false, status: 500, code: 'vendor_save_failed', error: 'Pemeriksaan vendor gagal — tidak ada data ditulis.' }
  }
  const { data: existing, error: dupeErr } = dupe || {}
  if (dupeErr) {
    return { ok: false, status: 500, code: 'vendor_save_failed', error: 'Pemeriksaan vendor gagal — tidak ada data ditulis.' }
  }
  if (existing && existing.id) {
    return {
      ok: false,
      status: 409,
      code: 'duplicate_vendor',
      error: `Vendor dengan nama yang sama sudah ada: ${existing.name}.`,
      vendorId: existing.id
    }
  }

  let ins
  try {
    ins = await client.from('vendors').insert(args).select('id, name, supplier_category').single()
  } catch {
    return { ok: false, status: 500, code: 'vendor_save_failed', error: 'Penyimpanan vendor gagal.' }
  }
  const { data: row, error: insErr } = ins || {}
  if (insErr || !row || !row.id) {
    return { ok: false, status: 500, code: 'vendor_save_failed', error: 'Penyimpanan vendor gagal.' }
  }

  return {
    ok: true,
    data: {
      vendorId: row.id,
      name: row.name,
      supplierCategory: row.supplier_category || null
    }
  }
}
