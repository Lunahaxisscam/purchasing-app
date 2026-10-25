// save_integration_test.mjs — Integrasi Seed Form Lapangan -> Save DRAFT PR
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createMockClient } from './mock-supabaseClient.mjs'

const SB = process.cwd()

const { supabase: mockSupabase } = await import(pathToFileURL(path.join(SB, 'dist/lib/supabaseClient.mjs')).href)

const {
  convertFieldFormToPrSeed
} = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/field-form/adapter.mjs')).href)

const {
  save: prSave
} = await import(pathToFileURL(path.join(SB, 'dist/modules/requests/save.mjs')).href)

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`  ✓ ${message}`)
}

console.log('=== PENGUJIAN INTEGRASI SIMPAN: SEED FORM LAPANGAN -> PR SAVE BOUNDARY ===\n')

const mockMaterials = [
  { id: 'm_ply18', kode: 'PLY-0001', name: 'Triplek Polos 18mm', category: 'Plywood & Board', satuan: 'Lembar', harga_acuan: 250000 },
  { id: 'm_sekrup_3', kode: 'BHP-0001', name: 'Sekrup 3 cm', category: 'Bahan Habis Pakai', satuan: 'Pcs', harga_acuan: 200 }
]

const mockProjects = [
  { id: 'p1', kode: '99', name: 'Project Baroni', status: 'ON_GOING' }
]

// 1. Buat seed dari Form Lapangan
const conversion = convertFieldFormToPrSeed({
  header: {
    project_id: 'p1',
    title: 'Pengadaan Baroni dari Lapangan',
    date: '2026-10-20',
    produced_by: 'Workshop Tangerang',
    notes: 'Kebutuhan urgent rangka panggung'
  },
  rowsState: {
    kd_triplek_polos_18mm: { qty: '6', remarks: 'Rangka utama' },
    prod_sekrup_3cm: { qty: '150', remarks: 'Fastener' }
  },
  allMaterials: mockMaterials,
  allProjects: mockProjects
})

assert(conversion.success === true, 'Seed dari Form Lapangan berhasil dibuat')
assert(conversion.prItemsList.length === 2, 'Seed memiliki 2 item')

// 2. Jalankan save boundary existing
let noticeMsg = ''
let closed = false
let refreshed = false

await prSave({
  form: conversion.form,
  isEdit: false,
  editRow: null,
  editItems: [],
  prItemsList: conversion.prItemsList,
  nextPrNum: 'PR-101',
  allMaterials: mockMaterials,
  allVendors: [],
  allPrItems: [],
  allReceivingItems: [],
  allReceivings: [],
  say: (msg) => { noticeMsg = msg },
  close: () => { closed = true },
  refresh: () => { refreshed = true },
  setSaving: () => {}
})

// Periksa state Supabase client yang di-mock
const savedPRs = mockSupabase._state.purchase_requests
assert(savedPRs.length === 1, 'Tepat 1 record purchase_requests disimpan')
const pr = savedPRs[0]
assert(pr.status === 'DRAFT', 'Status PR tersimpan adalah DRAFT')
assert(pr.project_id === 'p1', 'project_id tersimpan sesuai input')
assert(pr.title === 'Pengadaan Baroni dari Lapangan', 'title tersimpan sesuai input')
assert(pr.notes.includes('Tanggal Lapangan: 2026-10-20'), 'notes memuat tanggal lapangan')
assert(pr.notes.includes('Diproduksi: Workshop Tangerang'), 'notes memuat diproduksi')
assert(pr.notes.includes('Rangka utama'), 'notes memuat remarks item')

const savedItems = mockSupabase._state.pr_items
assert(savedItems.length === 2, 'Tepat 2 record pr_items disimpan')
assert(savedItems.every(it => it.status === 'PENDING_APPROVAL'), 'Semua pr_items berstatus PENDING_APPROVAL')
assert(savedItems.every(it => it.pr_id === pr.id), 'Semua pr_items terhubung ke ID PR yang sama')

const plyItem = savedItems.find(it => it.material_id === 'm_ply18')
assert(plyItem && plyItem.quantity === 6 && plyItem.unit === 'Lembar', 'Item Triplek quantity=6 unit=Lembar')
assert(plyItem.estimated_price === 250000, 'Estimasi harga integer tersimpan')

const sekrupItem = savedItems.find(it => it.material_id === 'm_sekrup_3')
assert(sekrupItem && sekrupItem.quantity === 150 && sekrupItem.unit === 'Pcs', 'Item Sekrup quantity=150 unit=Pcs')

assert(closed === true, 'Dialog modal ditutup setelah simpan')
assert(refreshed === true, 'Refresh terpanggil setelah simpan')
assert(noticeMsg.includes('berhasil dibuat'), 'Pemberitahuan sukses muncul')

console.log('\n--- PENGUJIAN INTEGRASI SIMPAN LULUS ---')
