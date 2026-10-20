// ============================================================
// modules/handovers/physicalModal.js — SATU store state modal fisik
// ============================================================
// Kenapa store kecil ini ada:
//   Aksi fisik (Terima Barang / Retur / Konfirmasi serah terima) bisa dibuka
//   dari DUA tempat di modul Handover: banner antrean (queue.jsx) dan tombol
//   baris (view.jsx). Keduanya harus membuka MODAL YANG SAMA, dan modal itu
//   dirender SEKALI (di banner) supaya tidak dobel.
//
//   Shell `ModuleView` TIDAK diubah (file core milik Tech Lead): kita tidak
//   menambah state ke ctx. Sebagai gantinya modul ini memakai store eksternal
//   minimal yang dibaca lewat `useSyncExternalStore` — pola React resmi untuk
//   state di luar pohon komponen.
//
// Nilai `target`:
//   null                                   → tidak ada modal
//   { kind: 'receipt',  receiving }        → form Terima Barang
//   { kind: 'return',   receiving }        → form Retur barang rusak
//   { kind: 'confirm',  handover }         → konfirmasi fisik per barang
// ============================================================
import { useSyncExternalStore } from 'react'

let current = null
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return current
}

export function openPhysicalModal(target) {
  current = target || null
  emit()
}

export function closePhysicalModal() {
  current = null
  emit()
}

// Dipakai test / setelah simpan supaya state tidak menggantung.
export function resetPhysicalModal() {
  current = null
  emit()
}

// Hook React: komponen ikut re-render saat modal dibuka/ditutup.
export function usePhysicalModal() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// Hanya untuk test: membaca target aktif tanpa hook.
export function __peekForTest() {
  return current
}
