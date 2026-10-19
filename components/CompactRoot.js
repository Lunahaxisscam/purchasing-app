import React, { useEffect, useRef } from 'react'
import compact from './compact-admin.module.css'

// ============================================================
// CompactRoot — pembungkus root modul Admin Suite (compact UI)
// ============================================================
// Tugas: memberi kelas scope CSS module (compact-admin.module.css) DAN
// menandai tabel agar bisa dirender sebagai blok berlabel saat layar
// sempit — tanpa mengubah satu pun data/struktur tabel asli.
//
// Yang ditambahkan HANYA atribut presentasi:
//   table[data-stack="wide"|"1"]  -> pemicu mode stacked di CSS
//   td[data-label="<judul kolom>"] -> label yang tampil di samping nilai
//   td[data-num]                   -> penanda sel angka (rata kanan)
//
// Tidak ada teks/elemen yang dihapus, tidak ada nilai yang diubah, tidak
// ada state React yang disentuh. Atribut yang sudah ditulis manual di JSX
// (data-label eksplisit) TIDAK ditimpa.
//
// Tabel dokumen cetak (portal .print-portal / .print-table) sengaja
// dilewati supaya output PDF/print tidak berubah sama sekali.
// ============================================================

const MONEY_RE = /^(-)?\s*(rp|idr)?\.?\s*\d[\d.,]*\s*%?$/i

function headerLabels(table) {
  const head = table.tHead
  if (!head || !head.rows.length) return null
  // Ambil baris header terakhir (header bertingkat: label paling spesifik).
  const row = head.rows[head.rows.length - 1]
  const labels = Array.from(row.cells).map(c => {
    const text = (c.textContent || '').replace(/\s+/g, ' ').trim()
    // Kolom aksi sering hanya punya aria-label (header visual kosong).
    return text || (c.getAttribute('aria-label') || '').trim()
  })
  return labels.length ? labels : null
}
/**
 * Tandai semua tabel di dalam `rootEl` supaya bisa stacked + berlabel.
 * Idempoten: aman dipanggil berkali-kali (observer / re-render).
 * @returns {number} jumlah tabel yang diproses
 */
export function decorateTables(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return 0
  let count = 0
  const tables = rootEl.querySelectorAll('table')
  for (let t = 0; t < tables.length; t += 1) {
    const table = tables[t]
    // Dokumen cetak / PDF: JANGAN disentuh.
    if (table.closest('.print-portal, .print-dialog, .print-modal')) continue
    if (table.classList.contains('print-table') || table.classList.contains('print-info')) continue
    // RAB & BOQ sudah punya aturan stacked sendiri (label + grid per sel);
    // menambah data-stack di sini akan menimpa layout editor-nya.
    if (table.closest('.boq-table-wrap')) continue
    if (table.getAttribute('data-stack') === 'off') continue

    const labels = headerLabels(table)
    if (!labels) {
      // Tabel tanpa <thead> (mis. daftar label|nilai 2 kolom seperti
      // "Rekap Pos Umum") tidak perlu mode stacked — cukup tabel rapat.
      if (!table.hasAttribute('data-stack')) table.setAttribute('data-stack', 'off')
      table.setAttribute('data-compact', '')
      continue
    }

    if (!table.hasAttribute('data-stack')) {
      table.setAttribute('data-stack', labels.length >= 8 ? 'wide' : '1')
    }
    // Penanda bahwa lapisan compact menormalkan lebar kolom tabel ini.
    table.setAttribute('data-compact', '')
    // Petunjuk lebar: kolom "No" sempit, kolom aksi cukup untuk tombol.
    // Hanya memengaruhi lebar kolom, bukan isi/data.
    const firstBodyRow = table.tBodies && table.tBodies[0] && table.tBodies[0].rows[0]
    const firstText = firstBodyRow && firstBodyRow.cells[0] ? (firstBodyRow.cells[0].textContent || '').trim() : ''
    if (/^\d{1,3}$/.test(firstText)) table.setAttribute('data-col-narrow', '')
    if (/aksi|action/i.test(labels[labels.length - 1] || '')) table.setAttribute('data-col-actions', '')

    const bodies = table.tBodies ? Array.from(table.tBodies) : []
    const footer = table.tFoot ? [table.tFoot] : []
    for (const section of [...bodies, ...footer]) {
      const rows = section.rows
      for (let r = 0; r < rows.length; r += 1) {
        const cells = rows[r].cells
        // Baris kosong "colspan" (empty state) dibiarkan apa adanya.
        if (cells.length === 1 && cells[0].colSpan > 1) continue
        let col = 0
        for (let c = 0; c < cells.length; c += 1) {
          const td = cells[c]
          const span = td.colSpan || 1
          // Label gabungan untuk sel yang menggabungkan beberapa kolom
          // (mis. baris TOTAL: "TOTAL" + nominal per kolom).
          const label = labels.slice(col, col + span).filter(Boolean).join(' / ')
          col += span
          if (td.hasAttribute('data-label')) continue
          const text = (td.textContent || '').trim()
          const hasControl = !!td.querySelector('input, select, textarea, button, a, img, svg')
          if (!text && !hasControl) {
            // Sel pengisi kosong (mis. kolom spacer di baris TOTAL):
            // tidak ada data yang hilang bila tidak dirender saat stacked.
            td.setAttribute('data-label', '')
            td.setAttribute('data-empty', '')
            continue
          }
          td.setAttribute('data-label', label)
          if (!td.hasAttribute('data-num') && text && text.length <= 24 && MONEY_RE.test(text)) {
            td.setAttribute('data-num', '')
          }
        }
      }
    }
    count += 1
  }
  return count
}

export default function CompactRoot({ className = '', children, ...rest }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    decorateTables(el)
    if (typeof MutationObserver !== 'function') return undefined
    // Tabel bisa muncul belakangan (ganti tab, buka detail, filter).
    const obs = new MutationObserver(() => decorateTables(el))
    obs.observe(el, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])

  return (
    <div ref={ref} className={`${className} ${compact.root}`.trim()} {...rest}>
      {children}
    </div>
  )
}
