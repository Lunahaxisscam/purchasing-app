import React from 'react'
import { format } from '../lib/constants'

// Link toko vendor: bisa dibuka langsung di tab baru; tanpa http(s):// otomatis ditambah.
export function StoreLink({ value }) {
  const v = String(value || '').trim()
  if (!v) return <>{format(value)}</>
  const href = /^https?:\/\//i.test(v) ? v : `https://${v}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={v}
      style={{ color: '#1a73e8', textDecoration: 'underline', display: 'inline-block', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
    >
      {v.replace(/^https?:\/\//i, '')}
    </a>
  )
}

// Kontak WA: nomor valid (>= 8 digit) dibuka ke wa.me; selain itu tampil teks biasa.
export function WaContact({ value }) {
  const v = String(value || '').trim()
  if (!v) return <>{format(value)}</>
  const digits = v.replace(/\D/g, '')
  if (digits.length < 8) return <>{format(value)}</>
  return (
    <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8', textDecoration: 'underline' }}>
      {v}
    </a>
  )
}
