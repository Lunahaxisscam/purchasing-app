// ============================================================
// MODUL CRM CUSTOMER (t_7253b859) — selector customer
// ============================================================
// Selector yang bisa dipakai ulang oleh modul lain (mis. Sales Invoice).
// Mengikuti pola modal/selector yang sudah ada di modules/sales-invoice.
//
// ATURAN YANG DIPATUHI:
//   * Menampilkan status apa adanya — kalau tidak ada data, labelnya
//     "Belum ada customer terdata" dan option kosong (bukan opsi palsu
//     seperti "Pilih customer…" yang tetap bisa disubmit).
//   * Value yang terikat selalu customer.id, label memakai customerLabel().
//   * Tidak menulis ke mana pun — read-only terhadap data.
//   * Semua angka relasi tampil sebagai teks dari relationText() supaya
//     "tidak dikirim" tidak berubah jadi 0.
// ============================================================

import React from 'react'
import {
  customerLabel,
  customerKey,
  customerContact,
  customerCapability,
  UNAVAILABLE_LABEL,
  SELECTOR_EMPTY_LABEL,
  relationText,
  CAPABILITY_COPY
} from './logic'

/**
 * Selector customer dengan filter pencarian inline.
 *
 * Props:
 *   customers : array hasil readCustomers()/mergeCustomers()
 *   value     : customer.id yang dipilih (null/'' = belum pilih)
 *   onChange  : (id) => void — dipanggil dengan id, bukan object
 *   counts    : { <customer_id>: <jumlah invoice> } opsional (dari host)
 *   capability: 'unavailable' | 'empty' | 'ready' (default: turunan data)
 *   id        : id DOM untuk label/aria (default 'crm-selector')
 *   label     : teks label (default 'Pilih customer')
 *   required  : tampilkan penanda wajib (default false)
 *   data-testid: kunci test; derived value memakai <testid>-<customerKey>
 */
export default function CustomerSelector({
  customers = [],
  value = '',
  onChange,
  counts = null,
  capability,
  id = 'crm-selector',
  label = 'Pilih customer',
  required = false,
  dataTestId = 'crm-selector',
  compact = false,
  showRelation = false
}) {
  const rows = customers || []
  // capability turunan data kalau host tidak mengirim prop customers sama
  // sekali (undefined/null -> unavailable); selector memakai "empty" supaya
  // option kosong tetap konsisten dengan kemampuan sumber data.
  const cap = capability ?? (Array.isArray(customers) ? customerCapability(rows) : 'unavailable')
  const selectedId = value == null ? '' : String(value)
  const selected = rows.find(c => String(c.id) === selectedId) || null
  const copy = CAPABILITY_COPY[cap] || CAPABILITY_COPY.empty

  const rootClass = [
    'crm-selector',
    compact ? 'crm-selector--compact' : '',
    cap === 'unavailable' ? 'crm-selector--unavailable' : '',
    cap === 'empty' ? 'crm-selector--empty' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={rootClass} data-testid={dataTestId} data-capability={cap}>
      <label className='crm-selector__label' htmlFor={id}>
        {label}
        {required && <span className='crm-required' aria-hidden='true'>*</span>}
      </label>

      <select
        id={id}
        className='crm-selector__input'
        value={selectedId}
        onChange={e => onChange && onChange(e.target.value)}
        aria-describedby={cap !== 'ready' ? `${id}-capability` : undefined}
        data-testid={`${dataTestId}-input`}
      >
        {cap === 'unavailable' ? (
          <option value=''>Sumber customer belum tersedia</option>
        ) : cap === 'empty' ? (
          <option value=''>{SELECTOR_EMPTY_LABEL}</option>
        ) : (
          <>
            <option value=''>Pilih customer…</option>
            {rows.map(c => (
              <option key={c.id} value={c.id}>
                {customerLabel(c)}
              </option>
            ))}
          </>
        )}
      </select>

      {cap !== 'ready' && (
        <p className='crm-selector__hint' id={`${id}-capability`} data-testid={`${dataTestId}-capability`}>
          {copy.body}
        </p>
      )}

      {cap === 'ready' && selected && (
        <div className='crm-selector__detail' data-testid={`${dataTestId}-detail`}>
          <span className='crm-selector__detail-name'>{selected.name}</span>
          {customerContact(selected) === null ? (
            <span className='crm-selector__missing'>Kontak: {UNAVAILABLE_LABEL.toLowerCase()}</span>
          ) : (
            <span className='crm-selector__detail-contact'>{customerContact(selected)}</span>
          )}
          {showRelation && (
            <span className='crm-selector__relation' data-testid={`${dataTestId}-relation`}>
              {relationText(selected.id, counts)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// Diekspor supaya modul lain bisa memakai label yang sama.
export { customerKey }
