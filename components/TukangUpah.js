import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { rupiah, formatDateTime, timeAgo } from '../lib/constants'

// ============================================================
// Modul UPAH TUKANG — khusus role admin (READ-ONLY).
// Menampilkan DASHBOARD dari Google Sheets per tukang (folder
// "BAKSO - ACCOUNTING", file "*_Simple_Upah_Kasbon" → tab Dashboard):
//   • Ringkasan: Total Hak Upah / Total Kasbon / Total Pelunasan / Sisa Saldo
//   • Tabel batch cut-off & tutup buku (periode, proyek, upah, kasbon,
//     sisa bersih, pelunasan, metode, saldo berjalan, status)
// Data disinkronkan daemon (pm2 tukang-upah-sync, read-only) ke tabel
// `tukang_dashboards` (RLS admin-only). Tombol "🔄 Refresh dari Drive"
// meminta sync on-demand via sync_status (id='tukang_upah').
// TIDAK ada input di modul ini — sumbernya Google Sheets milik tim finance.
//
// CATATAN UI (perbaikan 11 Okt): CSS global `th, td { white-space: nowrap
// !important }` membuat teks panjang MELUBER menimpa kolom lain (scrollWidth
// 968px vs sel 230px). Sel teks panjang WAJIB dibungkus <div class="cell-ellip">
// (ellipsis + title tooltip) — jangan mengandalkan inline style pada <td>,
// karena tidak bisa mengalahkan aturan !important itu.
// ============================================================

const STATUS_ID = 'tukang_upah'

// Warna badge status batch (mengikuti konvensi sheet: Lunas / Berjalan / catatan)
function batchStatusStyle(status) {
  const s = String(status || '').toLowerCase()
  if (s.includes('lunas')) return { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
  if (s.includes('berjalan')) return { background: '#e8f0fe', color: '#1a56c4', border: '1px solid #c6dafc' }
  if (s.includes('balanced')) return { background: '#e6f4ea', color: '#137333', border: '1px solid #ceead6' }
  return { background: '#fef6e7', color: '#a15309', border: '1px solid #fcdfa6' }
}

// Status panjang dari sheet diringkas untuk badge; teks lengkap via tooltip (title).
function shortStatus(s) {
  const t = String(s || '').trim()
  if (!t) return '—'
  if (t.length <= 16) return t
  const low = t.toLowerCase()
  if (low.includes('ditahan')) return '⚠️ Ditahan'
  if (low.includes('belum')) return '⏳ Belum final'
  return t.slice(0, 14) + '…'
}

// Format rupiah dengan tanda minus di depan "Rp": -Rp 97 (lebih baku dari "Rp -97").
function fmtRp(v) {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return n < 0 ? `-${rupiah(Math.abs(n))}` : rupiah(n)
}

// Sel teks panjang: dibungkus div ellipsis (lihat catatan UI di atas).
function EllipCell({ text, wide = false, small = false, muted = false }) {
  const cls = `cell-ellip${wide ? ' cell-ellip-wide' : ''}${small ? ' cell-ellip-sm' : ''}`
  const style = muted ? { fontSize: '12px', color: '#556b65' } : undefined
  return <div className={cls} style={style} title={text || ''}>{text || '—'}</div>
}

export default function TukangUpah() {
  const [tukangKey, setTukangKey] = useState('')
  const [rows, setRows] = useState([])
  const [sync, setSync] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const pollRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    if (!supabase) return
    if (!silent) setLoading(true)
    setError('')
    try {
      const [dashRes, syncRes] = await Promise.all([
        supabase.from('tukang_dashboards').select('*').order('tukang_key', { ascending: true }),
        supabase.from('sync_status').select('*').eq('id', STATUS_ID).maybeSingle()
      ])
      if (dashRes.error) setError(dashRes.error.message)
      else setRows(dashRes.data || [])
      if (!syncRes.error && syncRes.data) setSync(syncRes.data)
    } catch (e) {
      setError(e.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Pilih tukang pertama otomatis.
  useEffect(() => {
    if (!tukangKey && rows.length) setTukangKey(rows[0].tukang_key)
  }, [rows, tukangKey])

  // Bersihkan polling saat unmount.
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // "🔄 Refresh dari Drive": tulis permintaan ke sync_status; daemon memproses.
  // Setelah sync selesai, data DB dimuat ulang otomatis.
  async function requestRefresh() {
    if (!supabase || refreshing) return
    setRefreshing(true)
    try {
      const prevSynced = sync?.last_synced_at || null
      // Baris sync_status (id='tukang_upah') dibuat oleh daemon saat sync pertama.
      // RLS sync_status: authenticated hanya boleh UPDATE kolom requested_at/request_by.
      const { error: upErr } = await supabase.from('sync_status').update({
        requested_at: new Date().toISOString(),
        request_by: 'admin'
      }).eq('id', STATUS_ID)
      if (upErr) {
        setError(`Gagal meminta sync: ${upErr.message}`)
        setRefreshing(false)
        return
      }
      setSync(prev => ({ ...(prev || {}), requested_at: new Date().toISOString() }))

      let tries = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        tries += 1
        const { data } = await supabase.from('sync_status').select('*').eq('id', STATUS_ID).maybeSingle()
        if (data) setSync(data)
        const done = data && data.last_synced_at && data.last_synced_at !== prevSynced
        if (done || tries >= 18) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setRefreshing(false)
          if (done) load(true)
        }
      }, 5000)
    } catch (e) {
      setError(`Gagal meminta sync: ${e.message}`)
      setRefreshing(false)
    }
  }

  const tukang = rows.find(r => r.tukang_key === tukangKey) || null

  const batches = useMemo(() => {
    if (!tukang || !Array.isArray(tukang.batches)) return []
    return tukang.batches
  }, [tukang])

  // Saldo berjalan: pakai nilai dari sheet; fallback hitung dari ringkasan.
  const saldo = useMemo(() => {
    if (!tukang) return null
    if (tukang.saldo_berjalan !== null && tukang.saldo_berjalan !== undefined) return Number(tukang.saldo_berjalan)
    const hak = Number(tukang.total_hak_upah) || 0
    const kasbon = Number(tukang.total_kasbon) || 0
    const pelunasan = Number(tukang.total_pelunasan) || 0
    return hak - kasbon + pelunasan
  }, [tukang])

  return (
    <>
      {/* Toolbar: pilih tukang + refresh dari Drive */}
      <div className="toolbar" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'grid', gap: '6px', fontSize: '12px', fontWeight: 700, color: '#3b504b' }}>
            Pilih Tukang ({rows.length} tersedia)
            <select
              value={tukangKey}
              onChange={e => setTukangKey(e.target.value)}
              style={{ minWidth: '280px', padding: '9px 13px', fontSize: '13px' }}
            >
              {rows.length === 0 && <option value="">— belum ada data tukang —</option>}
              {rows.map(r => (
                <option key={r.tukang_key} value={r.tukang_key}>
                  {r.tukang_name || r.tukang_key}
                </option>
              ))}
            </select>
          </label>
          {tukang && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge status-APPROVED" style={{ fontSize: '11px' }}>{tukang.tukang_name || tukang.tukang_key}</span>
              {tukang.unit_bisnis && <span className="badge status-DRAFT" style={{ fontSize: '11px' }}>{tukang.unit_bisnis}</span>}
            </div>
          )}
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn-finish"
            onClick={requestRefresh}
            disabled={refreshing}
            style={{ opacity: refreshing ? 0.7 : 1, padding: '9px 14px', fontSize: '13px' }}
            title="Minta daemon menarik dashboard terbaru dari Google Sheets (read-only). Setelah selesai, tabel di bawah otomatis dimuat ulang."
          >
            {refreshing ? '⏳ Sinkronisasi…' : '🔄 Refresh dari Drive'}
          </button>
        </div>
      </div>

      {sync?.last_status === 'ERROR' && (
        <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>
          ⚠️ Sync terakhir gagal: {sync.last_message || 'Terjadi kesalahan'}
        </div>
      )}
      {error && (
        <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>
          Gagal memuat data: {error}
        </div>
      )}

      {loading ? (
        <div className="panel empty">Memuat dashboard upah tukang…</div>
      ) : !tukang ? (
        <div className="panel empty">
          Belum ada data dashboard tukang. Klik &quot;🔄 Refresh dari Drive&quot; untuk menarik dari Google Sheets,
          atau pastikan file dashboard tukang sudah ada di folder BAKSO - ACCOUNTING.
        </div>
      ) : (
        <>
          {/* Kartu ringkasan 4 angka (sama dengan baris ringkasan di sheet) */}
          <div className="cards">
            <div className="card" title="Total hak upah pekerjaan dari seluruh batch">
              <span>💼 Total Hak Upah</span>
              <strong style={{ fontSize: '22px' }}>{fmtRp(tukang.total_hak_upah)}</strong>
              <small>total upah borongan seluruh periode</small>
            </div>
            <div className="card" title="Total kasbon yang sudah diambil tukang">
              <span>💸 Total Kasbon</span>
              <strong style={{ fontSize: '22px' }}>{fmtRp(tukang.total_kasbon)}</strong>
              <small>kasbon diambil s/d periode terakhir</small>
            </div>
            <div className="card" title="Total pelunasan yang sudah dibayarkan">
              <span>✅ Total Pelunasan</span>
              <strong style={{ fontSize: '22px' }}>{fmtRp(tukang.total_pelunasan)}</strong>
              <small>pembayaran pelunasan tercatat</small>
            </div>
            <div className="card" title="Sisa saldo berjalan tukang (hak − kasbon + pelunasan)">
              <span>⚖️ Sisa Saldo Berjalan</span>
              <strong style={{ fontSize: '22px', color: saldo === null ? '#9aa8a4' : (saldo < 0 ? '#b91c1c' : '#0d6e38') }}>
                {saldo === null ? '—' : fmtRp(saldo)}
              </strong>
              <small>
                {sync?.last_synced_at ? `terakhir sync ${timeAgo(sync.last_synced_at)}` : 'belum pernah sync'}
              </small>
            </div>
          </div>

          {/* Tabel batch cut-off */}
          <div className="panel table desktop-table-view">
            <h2 style={{ marginBottom: '10px' }}>📋 Rekapitulasi Cut-Off &amp; Tutup Buku — {tukang.tukang_name || tukang.tukang_key}</h2>
            <table className="upah-table">
              <thead>
                <tr>
                  <th style={{ width: '34px' }}>No</th>
                  <th style={{ width: '200px' }}>Periode Cut-Off</th>
                  <th style={{ width: '260px' }}>Daftar Proyek Utama</th>
                  <th style={{ textAlign: 'right' }} title="Total Upah (Rp)">Upah</th>
                  <th style={{ textAlign: 'right' }} title="Total Kasbon (Rp)">Kasbon</th>
                  <th style={{ textAlign: 'right' }} title="Sisa Bersih / Hak (Rp)">Sisa Hak</th>
                  <th style={{ textAlign: 'right' }} title="Pelunasan Dibayar (Rp)">Pelunasan</th>
                  <th style={{ width: '150px' }} title="Metode Pelunasan">Metode</th>
                  <th style={{ textAlign: 'right' }} title="Sisa Saldo Berjalan (Rp)">Saldo Berjalan</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.length ? batches.map(b => (
                  <tr key={b.no}>
                    <td><b>{b.no}</b></td>
                    <td><EllipCell text={b.periode} /></td>
                    <td><EllipCell text={b.proyek} wide muted /></td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(b.total_upah)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(b.total_kasbon)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: (b.sisa_bersih || 0) < 0 ? '#b91c1c' : '#0d6e38' }}>
                      {fmtRp(b.sisa_bersih)}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(b.pelunasan)}</td>
                    <td><EllipCell text={b.metode} small /></td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: (b.saldo_berjalan || 0) < 0 ? '#b91c1c' : '#0d6e38' }}>
                      {fmtRp(b.saldo_berjalan)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span
                        className="badge badge-truncate"
                        style={{ fontSize: '10px', ...batchStatusStyle(b.status) }}
                        title={b.status || ''}
                      >
                        {shortStatus(b.status)}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className="empty">Belum ada batch cut-off untuk tukang ini.</td></tr>
                )}
              </tbody>
              {tukang.total_row && (
                <tfoot>
                  <tr style={{ background: '#f7faf9', fontWeight: 800 }}>
                    <td colSpan={3} style={{ textAlign: 'right' }}>TOTAL KESELURUHAN BATCH</td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(tukang.total_row.total_upah)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(tukang.total_row.total_kasbon)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(tukang.total_row.sisa_bersih)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtRp(tukang.total_row.pelunasan)}</td>
                    <td></td>
                    <td></td>
                    <td style={{ textAlign: 'center' }}>
                      {tukang.total_row.status && (
                        <span
                          className="badge badge-truncate"
                          style={{ fontSize: '10px', ...batchStatusStyle(tukang.total_row.status) }}
                          title={tukang.total_row.status}
                        >
                          {shortStatus(tukang.total_row.status)}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            <p className="muted" style={{ fontSize: '11px', marginTop: '10px', marginBottom: 0 }}>
              Sumber: Google Sheets <b>{tukang.tukang_name || tukang.tukang_key}</b> — tab Dashboard (folder BAKSO - ACCOUNTING).
              {tukang.synced_at ? ` Data per ${formatDateTime(tukang.synced_at)}.` : ''} Read-only — perubahan dilakukan di Google Sheets, lalu klik &quot;🔄 Refresh dari Drive&quot;. Arahkan kursor ke sel untuk melihat teks lengkap.
            </p>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {batches.length ? batches.map(b => (
              <div className="mobile-card" key={b.no}>
                <div className="mobile-card-header">
                  <div>
                    <b className="mobile-card-title">Batch {b.no}</b>
                    <div className="mobile-card-sub">{b.periode || '—'}</div>
                  </div>
                  <span className="badge" style={{ fontSize: '10px', ...batchStatusStyle(b.status) }}>{shortStatus(b.status)}</span>
                </div>
                <div className="mobile-card-body">
                  {b.proyek && <div className="mobile-card-row"><span className="mobile-label">Proyek:</span><span className="mobile-val">{b.proyek}</span></div>}
                  <div className="mobile-card-row"><span className="mobile-label">Upah:</span><span className="mobile-val">{fmtRp(b.total_upah)}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Kasbon:</span><span className="mobile-val">{fmtRp(b.total_kasbon)}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Sisa Hak:</span><span className="mobile-val" style={{ fontWeight: 700, color: (b.sisa_bersih || 0) < 0 ? '#b91c1c' : '#0d6e38' }}>{fmtRp(b.sisa_bersih)}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Pelunasan:</span><span className="mobile-val">{fmtRp(b.pelunasan)}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Metode:</span><span className="mobile-val">{b.metode || '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Saldo:</span><span className="mobile-val" style={{ fontWeight: 700, color: (b.saldo_berjalan || 0) < 0 ? '#b91c1c' : '#0d6e38' }}>{fmtRp(b.saldo_berjalan)}</span></div>
                </div>
              </div>
            )) : <div className="panel empty">Belum ada batch cut-off untuk tukang ini.</div>}
          </div>
        </>
      )}
    </>
  )
}
