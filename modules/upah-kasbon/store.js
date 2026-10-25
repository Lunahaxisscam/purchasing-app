// ============================================================
// modules/upah-kasbon/store.js — LAPISAN PENYIMPANAN MODUL (v2)
// ============================================================
// SATU-SATUNYA file yang diganti saat modul digabung ke Purchasing App:
//   - Sekarang (modul terpisah): localStorage browser.
//   - Saat integrasi: ganti isi load/save di bawah dengan Supabase
//     (pola lib/supabaseClient.js app).
//
// v2 = MULTI-TUKANG. State berisi banyak dataset, SATU per tukang,
// dipisahkan oleh `key` (= tukang_key di app: 'asep', 'pujon', ...).
// Pemetaan ke tabel app — semua tabel tukang_* memang sudah berkelompok
// per tukang_key, jadi strukturnya 1:1:
//   dataset.key/.name/.unit  -> tukang_dashboards (tukang_key, tukang_name, unit_bisnis)
//   dataset.projects         -> tukang_projects   (tukang_key, project_name, total_upah, status)
//   dataset.upahItems        -> tukang_upah_items (tukang_key, project_name, pekerjaan,
//                               ukuran, harga_satuan, upah_rincian, total_proyek, catatan)
//   dataset.kasbon           -> tukang_kasbon     (tukang_key, tanggal, jenis, deskripsi,
//                               metode, nominal, bukti)
//   dataset.totalans         -> tukang_totalan + tukang_totalan_items (BARU,
//                               lihat migrations/2026-10-22_tukang_totalan.DRAFT.sql)
//   dataset.projectOverrides -> nilai total manual per proyek
//     PERINGATAN (SPEC.md): tabel tukang_* saat ini diisi sync Google Sheets
//     yang menimpa per siklus — putuskan sumber data per tukang sebelum
//     form menulis ke tabel yang sama.
//
// Bentuk state (JSON) TIDAK berubah antara lokal & Supabase:
//   { version:2, activeKey,
//     tukangs: [ dataset, ... ] }
//   dataset = { key, name, unit,
//     projects:[{id,name,projectId,status,arsipManual}],  // projectId = relasi ke master projects(id); name = snapshot historis; arsipManual: true=paksa arsip, false=tahan aktif, kosong=otomatis dari totalan lunas
//     upahItems:[{id,projectId,pekerjaan,ukuran,satuanUkuran,hargaSatuan,upahRincian,catatan}],
//     kasbon:[{id,tanggal,jenis,deskripsi,metode,nominal,bukti}],
//     totalans:[{id,no,tanggal,seq,projectIds,pembayaranAktual,kasbonIds}],  // kasbonIds = entri kasbon yg dipilih utk dipotong di totalan itu
//     projectOverrides:{projectId: nominal}, seq, idCounter }
// ============================================================

export const STORE_KEY = 'modulUpahKasbon.v2'
export const STORE_KEY_V1 = 'modulUpahKasbon.v1'

export function slugKey(name) {
  return (name || 'tukang').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'tukang'
}

export function blankDataset(key, name, unit) {
  return {
    key, name: name || 'Tukang', unit: unit || 'Noir Living',
    projects: [], upahItems: [], kasbon: [], totalans: [], projectOverrides: {},
    seq: 0, idCounter: 0
  }
}

export function blankState() {
  return { version: 2, activeKey: 'asep', tukangs: [blankDataset('asep', 'Asep', 'Noir Living')] }
}

export function loadState(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return blankState()
  try {
    const s = JSON.parse(store.getItem(STORE_KEY))
    if (s && Array.isArray(s.tukangs) && s.tukangs.length) return Object.assign(blankState(), s)
  } catch (e) { /* lanjut ke migrasi v1 */ }
  try { // migrasi v1 (satu tukang) -> v2
    const v1 = JSON.parse(store.getItem(STORE_KEY_V1))
    if (v1 && v1.tukang) {
      const d = blankDataset(slugKey(v1.tukang.name), v1.tukang.name, v1.tukang.unit)
      Object.assign(d, {
        projects: v1.projects || [], upahItems: v1.upahItems || [], kasbon: v1.kasbon || [],
        totalans: v1.totalans || [], projectOverrides: v1.projectOverrides || {},
        seq: v1.seq || 0, idCounter: v1.idCounter || 0
      })
      return { version: 2, activeKey: d.key, tukangs: [d] }
    }
  } catch (e) { /* data rusak -> mulai dari kosong */ }
  return blankState()
}

export function saveState(state, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (store) store.setItem(STORE_KEY, JSON.stringify(state))
}
