// ============================================================
// api_fixtures.mjs — FIXTURES SINTETIS BERLABEL untuk harness API
// ============================================================
// SEMUA data FIKTIF. Tidak ada nama pelanggan, nota, atau token nyata.
// Token uji dibuat saat runtime dari nilai acak (bukan token produksi).
// ============================================================

import crypto from 'node:crypto'

export const SYNTH = { _synthetic: true }

export const PROJECTS = [
  { ...SYNTH, id: '11111111-1111-4111-8111-111111111111', kode: '101', code: '101', name: 'SINTETIS Proyek Alpha', status: 'ON_GOING' },
  { ...SYNTH, id: '22222222-2222-4222-8222-222222222222', kode: '83', code: '83', name: 'SINTETIS Proyek Bravo', status: 'ON_GOING' }
]

export const VENDORS = [
  { ...SYNTH, id: '33333333-3333-4333-8333-333333333333', name: 'SINTETIS Toko A-12', phone: '0800', supplier_category: 'Kayu' },
  { ...SYNTH, id: '44444444-4444-4444-8444-444444444444', name: 'SINTETIS Toko A12', phone: '0801', supplier_category: 'Kayu' },
  { ...SYNTH, id: '55555555-5555-4555-8555-555555555555', name: 'SINTETIS Toko Cat', phone: '0802', supplier_category: 'Cat' }
]

export const MATERIALS = [
  { ...SYNTH, id: '66666666-6666-4666-8666-666666666666', kode: 'PLY-0021', code: 'PLY-0021', name: 'SINTETIS Triplek 9mm', category: 'Plywood', unit: 'Lembar', satuan: 'Lembar', harga_acuan: 120000, current_stock: 0, min_stock: 0 }
]

export const REQUESTS = [
  { ...SYNTH, id: '77777777-7777-4777-8777-777777777777', pr_number: 'PR-2026-0001', project_id: PROJECTS[0].id, status: 'APPROVED', priority: 'URGENT', title: 'SINTETIS Kebutuhan 1', materials_summary: 'Triplek', notes: '' },
  { ...SYNTH, id: '88888888-8888-4888-8888-888888888888', pr_number: 'PR-2026-0002', project_id: PROJECTS[1].id, status: 'APPROVED', priority: 'NORMAL', title: 'SINTETIS Kebutuhan 2', materials_summary: 'Cat', notes: '' }
]

export const PR_ITEMS = [
  { ...SYNTH, id: '99999999-9999-4999-8999-999999999999', pr_id: REQUESTS[0].id, material_id: MATERIALS[0].id, vendor_id: null, quantity: 10, estimated_price: 120000, status: 'PENDING_APPROVAL', item_name: 'SINTETIS Triplek 9mm', kode: 'PLY-0021', unit: 'Lembar', supplier_category: 'Plywood', sort_order: 0 },
  { ...SYNTH, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pr_id: REQUESTS[0].id, material_id: null, vendor_id: null, quantity: 5, estimated_price: 65000, status: 'PENDING_APPROVAL', item_name: 'SINTETIS Semen 50kg', kode: 'SEM-0001', unit: 'Sak', supplier_category: 'Material', sort_order: 1 }
]

export const RECEIVING_ITEMS_SEED = [
  // PR item 1 sudah dibeli 4 dari 10 (sisa 6) — dipakai uji "sisa".
  { ...SYNTH, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', receiving_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', pr_item_id: PR_ITEMS[0].id, item_name: 'SINTETIS Triplek 9mm', unit: 'Lembar', quantity_received: 4, note: '[Harga: 120000]' }
]

export const MASTERS = {
  projects: PROJECTS,
  vendors: VENDORS,
  requests: REQUESTS,
  prItems: PR_ITEMS,
  receivingItems: RECEIVING_ITEMS_SEED
}

// --- Token uji: dibuat runtime, hanya hash yang masuk env ---
export const TEST_KEY_ID = 'baktests'
export const TEST_SECRET = crypto.randomBytes(32).toString('base64url')
export const TEST_TOKEN = `bpk.${TEST_KEY_ID}.${TEST_SECRET}`
export const TEST_HASH = crypto.createHash('sha256').update(TEST_SECRET, 'utf8').digest('hex')

export const TEST_KEY_ID_RO = 'baktread'
export const TEST_SECRET_RO = crypto.randomBytes(32).toString('base64url')
export const TEST_TOKEN_RO = `bpk.${TEST_KEY_ID_RO}.${TEST_SECRET_RO}`
export const TEST_HASH_RO = crypto.createHash('sha256').update(TEST_SECRET_RO, 'utf8').digest('hex')

export const ENV = {
  BAKPAU_API_TOKENS: `${TEST_KEY_ID}:${TEST_HASH}:purchasing:read+purchasing:create,` +
    `${TEST_KEY_ID_RO}:${TEST_HASH_RO}:purchasing:read`,
  BAKPAU_API_REVOKED: '',
  BAKPAU_NOTIFY_ENABLED: '1'
}

export function authHeaders(token = TEST_TOKEN) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

export const NOW = Date.now()

// Payload create yang SAH (semua field eksplisit; tidak ada tebakan).
export function validCreatePayload(overrides = {}) {
  return {
    idempotencyKey: 'sintetis-nota-0001',
    provenance: {
      sourceType: 'foto_nota',
      sourceRef: 'sintetis/file-0001.jpg',
      extractedBy: 'SINTETIS agen ekstraksi',
      extractedAt: new Date(NOW).toISOString()
    },
    purchase: {
      vendorId: VENDORS[0].id,
      date: '2026-10-20',
      invoiceNo: 'SINT-NOTA-0001',
      projectId: PROJECTS[0].id,
      biayaLain: 0,
      diskon: 0,
      statedTotal: 240000,
      items: [
        { itemName: 'SINTETIS Triplek 9mm', qty: 2, harga: 120000, unit: 'Lembar', projectId: PROJECTS[0].id }
      ]
    },
    ...overrides
  }
}
