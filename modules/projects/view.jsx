// ============================================================
// modules/projects/view.jsx — Project / Past Project
// ============================================================
// SELURUH blok di file ini diekstrak VERBATIM dari components/ModuleView.js
// pada Fase 1 modularisasi (perilaku tidak diubah). Mulai sekarang file ini
// adalah SATU-SATUNYA tempat kode UI Project / Past Project diubah — agent lain tidak perlu
// menyentuh file modul lain. Lihat docs/owners.md.
//
// ctx (konteks) disediakan shell ModuleView: H (helper item dari
// modules/shared/itemHelpers), state filter, state UI, columns, dan callback
// halaman dari pages/index.js.
// ============================================================
import React from 'react'
import { format, normalizeStatus } from '../../lib/constants'

// ============================================================
// TAB AKTIF / SELESAI (t_31871b64 — Sprint 1, arahan DAT)
// ============================================================
// Projects + Past Project dulu dua menu terpisah. Sekarang SATU modul
// dengan dua tab: "Aktif" dan "Selesai" (status DONE). Ini menambah
// `projectTab` di ctx (disediakan shell ModuleView) — BUKAN ganti
// `projectFilter` yang sudah ada. Filter tab lama tetap berfungsi
// seperti sebelumnya dan hanya memfilter DI DALAM tab yang aktif.
//
// PENTING — tabel `rows` yang diterima shell tetap SELURUH dataset
// sesuai filter aktif (aktif atau DONE). Aksi hapus & status di dalam
// tab mana pun tetap bekerja; tab tidak menyembunyikan data, hanya
// mengelompokkan tampilannya.
// ============================================================
const PROJECT_TAB_ACTIVE = 'active'
const PROJECT_TAB_DONE = 'done'

export function projectTabOf(ctx) {
  return ctx?.projectTab === PROJECT_TAB_DONE ? PROJECT_TAB_DONE : PROJECT_TAB_ACTIVE
}

// Baris yang boleh tampil di tab yang aktif. Dipakai bersama oleh
// tabel desktop (baris generik) dan kartu mobile supaya keduanya
// konsisten — bukan hanya salah satu.
export function rowsForProjectTab(rows, ctx) {
  const list = rows || []
  return projectTabOf(ctx) === PROJECT_TAB_DONE
    ? list.filter(p => normalizeStatus(p.status) === 'DONE')
    : list.filter(p => normalizeStatus(p.status) !== 'DONE')
}

// --- Filter tabs ---
export function filters(ctx) {
  const { allProjects, projectFilter, setProjectFilter } = ctx
  const active = allProjects.filter(p => normalizeStatus(p.status) !== 'DONE')
  const done = allProjects.filter(p => normalizeStatus(p.status) === 'DONE')
  const { projectTab, setProjectTab } = ctx
  const source = projectTab === PROJECT_TAB_DONE ? done : active
  const countOf = (fn) => source.filter(fn).length
  return (
    <>
      <div className="filter-tabs">
        <button
          type="button"
          className={`pill ${projectTab === PROJECT_TAB_ACTIVE ? 'active' : ''}`}
          onClick={() => setProjectTab(PROJECT_TAB_ACTIVE)}
        >
          Aktif ({active.length})
        </button>
        <button
          type="button"
          className={`pill ${projectTab === PROJECT_TAB_DONE ? 'active' : ''}`}
          onClick={() => setProjectTab(PROJECT_TAB_DONE)}
        >
          Selesai ({done.length})
        </button>
      </div>
      <div className="filter-tabs">
        <button
          type="button"
          className={`pill ${projectFilter === 'active' ? 'active' : ''}`}
          onClick={() => setProjectFilter('active')}
        >
          Semua ({source.length})
        </button>
        <button
          type="button"
          className={`pill ${projectFilter === 'ON_GOING' ? 'active' : ''}`}
          onClick={() => setProjectFilter('ON_GOING')}
        >
          On Going ({countOf(p => normalizeStatus(p.status) === 'ON_GOING')})
        </button>
        <button
          type="button"
          className={`pill ${projectFilter === 'NOT_START' ? 'active' : ''}`}
          onClick={() => setProjectFilter('NOT_START')}
        >
          Not Start ({countOf(p => normalizeStatus(p.status) === 'NOT_START')})
        </button>
        <button
          type="button"
          className={`pill ${projectFilter === 'all' ? 'active' : ''}`}
          onClick={() => setProjectFilter('all')}
        >
          Tanpa Filter ({source.length})
        </button>
      </div>
    </>
  )
}

// --- Cell tabel desktop: dropdown status project ---
export function renderCell(h, r, rawVal, ctx) {
  const { onStatusChange } = ctx
  if (h === 'status') {
    return (
      <select
        className={`status-select status-${normalizeStatus(r.status)}`}
        value={normalizeStatus(r.status)}
        onChange={e => onStatusChange(r, e.target.value)}
      >
        <option value="NOT_START">Not Start</option>
        <option value="ON_GOING">On Going</option>
        <option value="DONE">Done</option>
      </select>
    )
  }
  return null
}

// --- Aksi per baris (desktop) ---
export function rowActions(r, ctx) {
  const { title, page, onDelete } = ctx
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
        <button
          type="button"
          className="btn-delete"
          onClick={() => onDelete(page, r)}
          title={`Hapus ${title}`}
        >
          Hapus
        </button>
      </div>
    </td>
  )
}

// --- Kartu mobile ---
export function mobileCard(r, ctx) {
  const { onStatusChange } = ctx
  return (
    <>
      <div className="mobile-card-header">
        <div>
          <b className="mobile-card-title">{r.kode || r.code || '—'}</b>
          <div className="mobile-card-sub">{r.name}</div>
        </div>
        <select
          className={`status-select status-${normalizeStatus(r.status)}`}
          value={normalizeStatus(r.status)}
          onChange={e => onStatusChange(r, e.target.value)}
        >
          <option value="NOT_START">Not Start</option>
          <option value="ON_GOING">On Going</option>
          <option value="DONE">Done</option>
        </select>
      </div>
      <div className="mobile-card-body">
        <div className="mobile-card-row">
          <span className="mobile-label">Tanggal:</span>
          <span className="mobile-val">{format(r.created_at)}</span>
        </div>
      </div>
    </>
  )
}
