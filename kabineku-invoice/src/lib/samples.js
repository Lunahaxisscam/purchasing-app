/**
 * Synthetic demo data for sample PDFs. Every value here is invented for
 * testing and is labelled CONTOH. No customer, project, invoice number, bank
 * account or signer from the reference workbook is reused.
 */

import { createEmptyInvoice, createLine, createTerm } from './model.js';

const SYNTHETIC_ISSUER = {
  name: 'Noir Studio (contoh)',
  address: 'Jl. Contoh Sintetis No. 1, Jakarta',
  contact: 'contoh@example.test · +62 000 0000 0000',
};

const SYNTHETIC_PAYMENT = {
  transferVia: 'Bank Contoh — IDR',
  bankLines: '000-000-0000 A/N NAMA CONTOH (rekening fiktif untuk pratinjau)',
  instructions: 'Pembayaran dianggap sah setelah dana diterima di rekening penerbit. Nomor referensi wajib dicantumkan pada berita transfer.',
};

function base(overrides) {
  const inv = createEmptyInvoice(new Date('2026-05-02T00:00:00Z'));
  return {
    ...inv,
    billTo: {
      projectOwner: 'PT Pelanggan Contoh',
      address: 'Jl. Fiktif Raya No. 88, Jakarta Barat',
      projectRef: 'Proyek Contoh Interior (sintetis)',
    },
    issuer: SYNTHETIC_ISSUER,
    payment: SYNTHETIC_PAYMENT,
    signature: { signerName: 'Nama Penandatangan (contoh)', signerTitle: 'Direktur (contoh)' },
    notes: 'Dokumen contoh untuk pengujian generator. Bukan tagihan nyata dan tidak untuk ditagihkan.',
    ...overrides,
  };
}

/** Draft case: incomplete invoice, no number, no bank, no signer — proves the DRAF path. */
export function sampleDraft() {
  const inv = createEmptyInvoice(new Date('2026-05-02T00:00:00Z'));
  return {
    ...inv,
    id: 'sample_draft',
    invoiceNo: '',
    invoiceDate: '2026-05-02',
    billTo: {
      projectOwner: 'Calon Pelanggan (contoh)',
      address: 'Alamat belum lengkap (contoh)',
      projectRef: 'Draf proyek (sintetis)',
    },
    issuer: {
      name: 'Noir Studio (contoh)',
      address: '',
      contact: '',
    },
    lines: [
      createLine({ desc: 'Pekerjaan yang uraiannya masih akan dilengkapi', qty: '1', unit: 'ls', unitPrice: '5.000.000' }),
      createLine({ desc: '', qty: '1', unit: 'ls', unitPrice: '' }),
    ],
    tax: { enabled: false, mode: 'percent', rate: '', amount: '', label: '' },
    payment: { transferVia: '', bankLines: '', instructions: '' },
    signature: { signerName: '', signerTitle: '' },
    notes: 'Ini DRAF: nomor invoice, rekening, dan penandatangan belum diisi. Tidak untuk dikirim.',
  };
}

/** Normal case: 4 lines incl. signed adjustments, tax enabled with a user rate. */
export function sampleNormal() {
  return base({
    id: 'sample_normal',
    invoiceNo: 'CONTOH/NL26/0001',
    invoiceDate: '2026-05-02',
    dueDate: '2026-05-16',
    lines: [
      createLine({ desc: 'Down Payment (50%) — pekerjaan interior ruang tamu', qty: '1', unit: 'ls', unitPrice: '21.650.000' }),
      createLine({ kind: 'adjustment', desc: 'Adjustment cermin kamar mandi (pengurangan)', qty: '1', unit: 'ls', unitPrice: '-200.000' }),
      createLine({ kind: 'adjustment', desc: 'Additional full body mirror uk. 40×180 cm', qty: '2', unit: 'pcs', unitPrice: '200.000' }),
      createLine({ desc: 'Biaya pengiriman & pemasangan area Jakarta', qty: '1', unit: 'ls', unitPrice: '850.000' }),
    ],
    paymentSchedule: {
      enabled: true,
      totalProject: '43.300.000',
      terms: [
        createTerm({ label: 'Term 1', percent: '50', amount: '21.650.000' }),
        createTerm({ label: 'Term 2', percent: '40', amount: '17.320.000' }),
        createTerm({ label: 'Term 3', percent: '10', amount: '4.330.000' }),
      ],
    },
    tax: { enabled: true, mode: 'percent', rate: '2,5', amount: '', label: '' },
  });
}

/** Stress case: long multi-paragraph descriptions + 34 lines. */
export function sampleStress() {
  const longDesc =
    'Pekerjaan custom kitchen set lengkap termasuk kabinet bawah dan atas, finishing HPL doff motif linen, ' +
    'engsel soft close, rel laci full extension, handle aluminium, cutting profil, perakitan di workshop, ' +
    'pengiriman ke lokasi, dan pemasangan oleh tim instalasi. Termasuk penyesuaian ukuran di lokasi apabila ' +
    'dimensi dinding berbeda dari gambar kerja yang disetujui, tanpa biaya tambahan selama selisih di bawah 2 cm. ' +
    'Tidak termasuk pekerjaan kelistrikan, plumbing, dan pemindahan jalur pipa.';
  const longNote =
    'Catatan: warna dan tekstur material dapat berbeda sedikit dari sampel karena proses produksi. ' +
    'Garansi engsel dan rel 12 bulan, garansi struktur 24 bulan.';

  const lines = [];
  lines.push(
    createLine({
      desc: longDesc,
      note: longNote,
      qty: '1',
      unit: 'ls',
      unitPrice: '18.750.000',
    }),
  );
  lines.push(
    createLine({
      desc:
        'Wardrobe 3 pintu dengan cermin internal, tinggi 240 cm, lebar 180 cm, kedalaman 60 cm — ' +
        'termasuk sekat, laci internal, dan lampu LED sensor pada setiap pintu',
      qty: '1',
      unit: 'unit',
      unitPrice: '9.400.000',
    }),
  );
  lines.push(
    createLine({
      desc:
        'Nakas gantung 2 unit, finishing cat duco putih, handle kuningan, ' +
        'dipasang pada dinding beton dengan dynabolt',
      qty: '2',
      unit: 'unit',
      unitPrice: '1.275.000',
    }),
  );
  lines.push(createLine({ kind: 'adjustment', desc: 'Diskon kontrak proyek (kesepakatan tertulis)', qty: '1', unit: 'ls', unitPrice: '-1.500.000' }));
  for (let i = 1; i <= 30; i += 1) {
    const names = [
      'Panel dinding WPC motif kayu',
      'Rak buku floating custom',
      'Meja kerja dengan laci',
      'Kabinet bawah wastafel',
      'Cermin dinding dengan frame',
      'Lampu gantung dekoratif',
    ];
    lines.push(
      createLine({
        desc: `${names[(i - 1) % names.length]} — item ${i} (uraian panjang untuk uji pagination)`,
        note: i % 7 === 0 ? 'Termasuk pemasangan dan pengecekan level.' : '',
        qty: i % 3 === 0 ? '2,5' : String(1 + (i % 4)),
        unit: i % 5 === 0 ? 'm²' : i % 4 === 0 ? 'set' : 'pcs',
        unitPrice: String(125000 + i * 37500),
      }),
    );
  }
  return base({
    id: 'sample_stress',
    invoiceNo: 'CONTOH/NL26/0002',
    invoiceDate: '2026-08-26',
    dueDate: '2026-09-09',
    lines,
    paymentSchedule: {
      enabled: true,
      totalProject: '250.000.000',
      terms: [
        createTerm({ label: 'Term 1', percent: '50', amount: '125.000.000' }),
        createTerm({ label: 'Term 2', percent: '40', amount: '100.000.000' }),
        createTerm({ label: 'Term 3', percent: '10', amount: '25.000.000' }),
      ],
    },
    tax: { enabled: true, mode: 'percent', rate: '1,5', amount: '', label: '' },
    notes:
      'Dokumen stres-test: 34 baris, uraian multi-paragraf, dan satuan non-ASCII (m², ×, —, é). ' +
      'Bukan tagihan nyata; hanya untuk memverifikasi pagination dan tidak ada baris yang terpotong.',
  });
}
