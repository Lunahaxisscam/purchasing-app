// ============================================================
// modules/vendors/categories.js — kategori vendor multi-kategori
// ============================================================
// Task t_e626b674 (arahan DAT): vendor bisa men-suplai LEBIH DARI 1 kategori
// material. Format penyimpanan kompatibel mundur TANPA migrasi DB:
//
//   - vendors.supplier_category (scalar text existing) tetap satu-satunya
//     kolom; isi barunya = SATU STRING dipisah koma ("Plywood & Board, HPL & Edging").
//   - Format lama (string kategori tunggal) tetap terbaca apa adanya.
//   - Bila DAT kelak menyetujui kolom supplier_categories text[]/jsonb,
//     vendorActiveCategories di modules/requests/estimator.js sudah membaca
//     array — parse di sini tahan ketiga bentuk (array / JSON string / koma).
//
// File ini SATU-SATUNYA tempat util kategori vendor; view/form/save Vendor
// memakai fungsi dari sini agar format tampil & tersimpan konsisten.
// ============================================================

// Kategori NON-kategori yang dulu dipakai sebagai placeholder ("Vendor")
// — jangan dianggap kategori sungguhan saat parsing.
const NON_CATEGORY = new Set(['Vendor'])

// Trim + buang kosong; dedupe case-insensitive tapi pertahankan ejaan pertama.
export function cleanCategoryList(list) {
  const seen = new Set()
  const out = []
  for (const raw of (list || [])) {
    const c = String(raw ?? '').trim()
    if (!c) continue
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

// Parse kategori aktif vendor dari BENTUK APAPUN:
//   - array                       -> dipakai langsung
//   - JSON string array           -> di-parse (tahan data jsonb lama)
//   - string dipisah koma         -> dipecah per koma
//   - string tunggal / placeholder-> satu kategori (atau kosong)
// Selalu mengembalikan ARRAY string bersih (bisa kosong).
export function parseVendorCategories(value) {
  if (Array.isArray(value)) return cleanCategoryList(value)
  const s = String(value ?? '').trim()
  if (!s) return []
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      if (Array.isArray(arr)) return cleanCategoryList(arr)
    } catch { /* bukan JSON valid — perlakukan sbg teks biasa */ }
  }
  if (NON_CATEGORY.has(s)) return []
  return cleanCategoryList(s.split(','))
}

// Bentuk tersimpan kanonik: string dipisah ", " (kompatibel kolom scalar).
// (save.js membersihkan dgn cleanCategoryList lalu join; fungsi ini disediakan
// sbg util kanonik bila modul lain butuh bentuk tersimpan yang sama.)
export function joinVendorCategories(list) {
  return cleanCategoryList(list).join(', ')
}

// CATATAN: komponen CHIP (JSX) sengaja TIDAK di file ini — Next.js (SWC)
// tidak mengompilasi JSX di file .js. Chip dirender oleh komponen
// vendorCategoryChips() di modules/vendors/view.jsx yang memakai parser di
// atas; format tampil & tersimpan tetap satu-sumber lewat parseVendorCategories.
