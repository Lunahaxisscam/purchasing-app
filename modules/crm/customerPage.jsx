// ============================================================
// modules/crm/customerPage.jsx — CUSTOMER CRM (Tersimpan di database)
// ============================================================
// Tahap 1 alur penjualan (keputusan DAT 24 Okt 2026):
//   * Customer cukup 3 hal: NAMA · WA · STATUS (Prospek | Customer).
//   * 1 customer boleh punya BANYAK project — tetap SATU akun customer.
//     Relasi disimpan di `projects.customer_id` (bukan kolom project di
//     tabel customer), jadi menautkan project tidak menduplikasi customer.
//   * Prospek berubah jadi CUSTOMER saat INVOICE DITERBITKAN. Perubahan
//     otomatis itu menyusul di Tahap 3 (modul invoice); untuk sekarang
//     status bisa diubah manual dari halaman ini.
//
// PERBEDAAN dengan modules/crm/view.jsx (versi lama, baca-saja):
//   Versi lama sengaja TIDAK menulis DB (draf memori halaman) karena tabel
//   `customers` belum ada. Sekarang tabelnya ADA (migrasi
//   migrations/2026-10-24_sales_customers.sql), jadi halaman ini menulis
//   sungguhan dan menyatakan apa adanya bila penulisan gagal.
// ============================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export const STATUS_PROSESPEK = 'PROSPEK'
export const STATUS_CUSTOMER = 'CUSTOMER'

export const STATUS_OPTIONS = [
  { value: STATUS_PROSESPEK, label: 'Prospek' },
  { value: STATUS_CUSTOMER, label: 'Customer' }
]

// WA disimpan apa adanya yang diketik (biar terbaca manusia), tetapi
// pembanding duplikat memakai digit saja dengan 62 -> 0.
export function normalizeWa(v) {
  const d = String(v || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('62')) return '0' + d.slice(2)
  return d
}

export function validateCustomer(form, { existing = [], editingId = null } = {}) {
  const errors = {}
  const nama = String(form?.nama || '').trim()
  if (!nama) errors.nama = 'Nama customer wajib diisi.'
  else if (nama.length > 120) errors.nama = 'Nama maksimal 120 karakter.'
  const wa = String(form?.wa || '').trim()
  if (wa && normalizeWa(wa).length < 8) errors.wa = 'Nomor WA terlihat kurang lengkap.'
  const status = String(form?.status || '').toUpperCase()
  if (![STATUS_PROSESPEK, STATUS_CUSTOMER].includes(status)) errors.status = 'Status tidak dikenal.'
  if (nama) {
    const dup = existing.find(
      (c) => String(c.id) !== String(editingId || '') &&
        String(c.nama || '').trim().toLowerCase() === nama.toLowerCase()
    )
    if (dup) errors.nama = `Sudah ada customer bernama "${dup.nama}". Buka data itu alih-alih menambah baru.`
  }
  return { ok: Object.keys(errors).length === 0, errors }
}

export function projectsOf(customerId, projects = []) {
  if (!customerId) return []
  return (projects || []).filter((p) => String(p.customer_id || '') === String(customerId))
}

const EMPTY = { nama: '', wa: '', alamat: '', status: STATUS_PROSESPEK }

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 14 },
  toolbar: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 },
  badge: (tone) => ({
    display: 'inline-block', fontSize: 11, fontWeight: 700, borderRadius: 999,
    padding: '3px 9px', letterSpacing: '0.02em',
    background: tone === 'customer' ? '#e6f4ea' : '#fef6e7',
    color: tone === 'customer' ? '#137333' : '#7a4a08',
    border: `1px solid ${tone === 'customer' ? '#ceead6' : '#fcdfa6'}`
  }),
  warn: { background: '#fef6e7', border: '1px solid #fcdfa6', color: '#7a4a08', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, margin: 0 },
  err: { background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, margin: 0 },
  ok: { background: '#e6f4ea', border: '1px solid #ceead6', color: '#137333', borderRadius: 8, padding: '8px 11px', fontSize: 12.5, margin: 0 },
  sub: { display: 'block', fontSize: 11, color: '#68746b', marginTop: 2 }
}

export default function CustomerCrmPage({ rows = {}, refresh, say }) {
  const projects = rows.projects || []
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [linkProjectId, setLinkProjectId] = useState('')

  const load = useCallback(async () => {
    if (!supabase) { setLoadError('Koneksi Supabase belum tersedia.'); setLoading(false); return }
    setLoading(true)
    setLoadError('')
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) {
        setLoadError(
          /could not find the table|does not exist|PGRST205/i.test(error.message)
            ? 'Tabel customers belum ada di database. Migrasi 2026-10-24_sales_customers.sql belum dijalankan.'
            : `Gagal memuat customer: ${error.message}`
        )
        setCustomers([])
        return
      }
      setCustomers(data || [])
    } catch (e) {
      setLoadError(`Gagal memuat customer: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const key = q.trim().toLowerCase()
    return customers.filter((c) => {
      if (filter !== 'all' && String(c.status || '').toUpperCase() !== filter) return false
      if (!key) return true
      return [c.nama, c.wa, c.alamat].some((x) => String(x || '').toLowerCase().includes(key))
    })
  }, [customers, q, filter])

  const counts = useMemo(() => {
    const total = customers.length
    const customer = customers.filter((c) => String(c.status).toUpperCase() === STATUS_CUSTOMER).length
    return { total, customer, prospek: total - customer }
  }, [customers])

  function openAdd() {
    setForm(EMPTY); setEditing(null); setErrors({}); setShowForm(true); setNotice(null)
  }

  function openEdit(c) {
    setForm({ nama: c.nama || '', wa: c.wa || '', alamat: c.alamat || '', status: String(c.status || STATUS_PROSESPEK).toUpperCase() })
    setEditing(c); setErrors({}); setShowForm(true); setNotice(null)
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const check = validateCustomer(form, { existing: customers, editingId: editing?.id })
    setErrors(check.errors)
    if (!check.ok) return
    setBusy(true)
    setNotice(null)
    const payload = {
      nama: form.nama.trim(),
      wa: form.wa.trim() || null,
      alamat: form.alamat.trim() || null,
      status: String(form.status || STATUS_PROSESPEK).toUpperCase()
    }
    try {
      if (editing) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editing.id)
        if (error) { setNotice({ tone: 'err', text: `Gagal menyimpan: ${error.message}` }); return }
        setNotice({ tone: 'ok', text: `Data "${payload.nama}" tersimpan.` })
      } else {
        const { error } = await supabase.from('customers').insert(payload)
        if (error) { setNotice({ tone: 'err', text: `Gagal menambah customer: ${error.message}` }); return }
        setNotice({ tone: 'ok', text: `Customer "${payload.nama}" ditambahkan (${payload.status === STATUS_CUSTOMER ? 'Customer' : 'Prospek'}).` })
      }
      setShowForm(false); setEditing(null); setForm(EMPTY); setErrors({})
      await load()
      say?.(`CRM: ${payload.nama} tersimpan.`)
    } catch (err) {
      setNotice({ tone: 'err', text: `Gagal menyimpan: ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(c) {
    if (busy) return
    const next = String(c.status).toUpperCase() === STATUS_CUSTOMER ? STATUS_PROSESPEK : STATUS_CUSTOMER
    setBusy(true)
    try {
      const { error } = await supabase.from('customers').update({ status: next }).eq('id', c.id)
      if (error) { setNotice({ tone: 'err', text: `Gagal mengubah status: ${error.message}` }); return }
      setNotice({ tone: 'ok', text: `"${c.nama}" sekarang ${next === STATUS_CUSTOMER ? 'Customer' : 'Prospek'}.` })
      await load()
    } finally { setBusy(false) }
  }

  async function removeCustomer(c) {
    if (busy) return
    const linked = projectsOf(c.id, projects).length
    const msg = linked
      ? `Hapus customer "${c.nama}"? ${linked} project akan DILEPAS (project tetap ada, hanya tidak lagi tertaut).`
      : `Hapus customer "${c.nama}"?`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('customers').delete().eq('id', c.id)
      if (error) { setNotice({ tone: 'err', text: `Gagal menghapus: ${error.message}` }); return }
      setNotice({ tone: 'ok', text: `Customer "${c.nama}" dihapus.` })
      await load()
    } finally { setBusy(false) }
  }

  async function linkProject(c) {
    if (!linkProjectId || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('projects').update({ customer_id: c.id }).eq('id', linkProjectId)
      if (error) { setNotice({ tone: 'err', text: `Gagal menautkan project: ${error.message}` }); return }
      const p = projects.find((x) => String(x.id) === String(linkProjectId))
      setNotice({ tone: 'ok', text: `Project "${p?.name || linkProjectId}" ditautkan ke "${c.nama}".` })
      setLinkProjectId('')
      await load()
      refresh?.()
    } finally { setBusy(false) }
  }

  async function unlinkProject(c, p) {
    if (busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('projects').update({ customer_id: null }).eq('id', p.id)
      if (error) { setNotice({ tone: 'err', text: `Gagal melepas project: ${error.message}` }); return }
      setNotice({ tone: 'ok', text: `Project "${p.name}" dilepas dari "${c.nama}" (project tetap ada).` })
      await load()
      refresh?.()
    } finally { setBusy(false) }
  }

  const noticeStyle = notice ? (notice.tone === 'err' ? S.err : notice.tone === 'warn' ? S.warn : S.ok) : null
  const unlinked = projects.filter((p) => !p.customer_id)

  return (
    <div className="ops-container" style={S.wrap} data-testid="crm-page">
      <div className="panel" style={{ padding: '14px 18px' }}>
        <b>Customer CRM</b>
        <div style={{ fontSize: 12.5, color: '#4a5a54', marginTop: 4 }}>
          Data customer tersimpan di database. Satu akun customer bisa punya banyak project —
          project menempel ke customer, bukan customer diduplikasi.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['Total customer', counts.total, 'semua data'],
          ['Customer', counts.customer, 'sudah transaksi'],
          ['Prospek', counts.prospek, 'belum jadi customer']
        ].map(([label, val, sub]) => (
          <div key={label} className="panel" style={{ padding: '10px 16px', minWidth: 150 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#68746b' }}>{label}</div>
            <b style={{ fontSize: 22 }} data-testid={`crm-count-${label.split(' ')[0].toLowerCase()}`}>{val}</b>
            <small style={S.sub}>{sub}</small>
          </div>
        ))}
      </div>

      <div className="panel" style={S.toolbar}>
        <label style={S.field}>
          Cari customer
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nama, WA, atau alamat…"
            data-testid="crm-search"
          />
        </label>
        <label style={S.field}>
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="crm-filter-status">
            <option value="all">Semua</option>
            <option value={STATUS_PROSESPEK}>Prospek</option>
            <option value={STATUS_CUSTOMER}>Customer</option>
          </select>
        </label>
        <button type="button" onClick={openAdd} data-testid="crm-add">+ Tambah Customer</button>
        <button type="button" className="outline" onClick={load} disabled={loading} data-testid="crm-reload">
          {loading ? 'Memuat…' : '↻ Muat ulang'}
        </button>
      </div>

      {loadError && <p style={S.err} data-testid="crm-load-error">{loadError}</p>}
      {notice && <p style={noticeStyle} role="status" data-testid="crm-notice">{notice.text}</p>}

      {showForm && (
        <form className="panel" onSubmit={submit} style={{ padding: '14px 18px' }} data-testid="crm-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <b>{editing ? `Ubah "${editing.nama}"` : 'Customer baru'}</b>
            <button type="button" className="icon" onClick={() => { setShowForm(false); setEditing(null) }} aria-label="Tutup">×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <label style={S.field}>
              Nama customer *
              <input
                type="text" value={form.nama} required
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
                placeholder="Contoh: Bu Santi"
                data-testid="crm-input-nama"
              />
              {errors.nama && <small style={{ color: '#c93b2b' }} data-testid="crm-error-nama">{errors.nama}</small>}
            </label>
            <label style={S.field}>
              No. WhatsApp
              <input
                type="tel" value={form.wa}
                onChange={(e) => setForm({ ...form, wa: e.target.value })}
                placeholder="08xxxxxxxxxx"
                data-testid="crm-input-wa"
              />
              {errors.wa && <small style={{ color: '#c93b2b' }} data-testid="crm-error-wa">{errors.wa}</small>}
            </label>
            <label style={S.field}>
              Alamat proyek (opsional)
              <input
                type="text" value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
                placeholder="Contoh: Cluster Dakota 8 No. 3, Tangerang"
                data-testid="crm-input-alamat"
              />
            </label>
            <label style={S.field}>
              Status
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                data-testid="crm-input-status"
              >
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={busy} data-testid="crm-submit">
              {busy ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan customer'}
            </button>
            <button type="button" className="outline" onClick={() => { setShowForm(false); setEditing(null); setErrors({}) }}>Batal</button>
          </div>
        </form>
      )}

      <div className="panel table desktop-table-view">
        <table className="purchase-table crm-table" data-testid="crm-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Alamat</th>
              <th style={{ width: '150px' }}>No. WhatsApp</th>
              <th style={{ width: '110px' }}>Status</th>
              <th style={{ width: '150px' }}>Proyek</th>
              <th style={{ width: '140px' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  {loading ? 'Memuat customer…' : loadError ? 'Tidak bisa menampilkan customer.' : customers.length ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada customer. Klik "+ Tambah Customer" untuk mulai.'}
                </td>
              </tr>
            ) : filtered.map((c) => {
              const linked = projectsOf(c.id, projects)
              const isCustomer = String(c.status).toUpperCase() === STATUS_CUSTOMER
              const open = String(openId) === String(c.id)
              return (
                <tr key={c.id} data-testid={`crm-row-${c.id}`}>
                  {/* NAMA — sengaja SPAN, bukan <button>: aturan global
                      `button { color: white }` membuat nama putih di atas
                      latar putih (tidak terbaca). Span mewarisi warna sel. */}
                  <td>
                    <span
                      className="crm-name-toggle"
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenId(open ? null : c.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : c.id) } }}
                      data-testid={`crm-expand-${c.id}`}
                      title="Klik untuk lihat / tautkan project"
                    >
                      <span className="crm-caret" aria-hidden="true">{open ? '▾' : '▸'}</span> {c.nama}
                    </span>
                    {open && (
                      <div style={{ marginTop: 8, fontSize: 12 }} data-testid={`crm-projects-${c.id}`}>
                        {linked.length === 0 ? (
                          <span style={{ color: '#5a6b64' }}>Belum ada project tertaut.</span>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {linked.map((p) => (
                              <li key={p.id} style={{ marginBottom: 3 }}>
                                {p.kode ? `[${p.kode}] ` : ''}{p.name}
                                <small style={{ color: '#5a6b64' }}> · {p.status || '—'}</small>
                                <button
                                  type="button"
                                  className="outline"
                                  style={{ marginLeft: 6, fontSize: 10.5, padding: '2px 6px' }}
                                  onClick={() => unlinkProject(c, p)}
                                  disabled={busy}
                                  data-testid={`crm-unlink-${p.id}`}
                                >
                                  Lepas
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={linkProjectId}
                            onChange={(e) => setLinkProjectId(e.target.value)}
                            style={{ fontSize: 11.5 }}
                            data-testid={`crm-link-select-${c.id}`}
                          >
                            <option value="">Tautkan project…</option>
                            {unlinked.map((p) => (
                              <option key={p.id} value={p.id}>{p.kode ? `[${p.kode}] ` : ''}{p.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            disabled={!linkProjectId || busy}
                            onClick={() => linkProject(c)}
                            data-testid={`crm-link-btn-${c.id}`}
                          >
                            Tautkan
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="crm-cell-alamat">{c.alamat || <span className="crm-muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{c.wa || <span className="crm-muted">—</span>}</td>
                  <td>
                    <span style={S.badge(isCustomer ? 'customer' : 'prospek')} data-testid={`crm-status-${c.id}`}>
                      {isCustomer ? 'Customer' : 'Prospek'}
                    </span>
                  </td>
                  <td className="crm-cell-project">
                    {linked.length ? (
                      <span title={linked.map((p) => p.name).join(', ')}>
                        {linked.length} proyek
                      </span>
                    ) : <span className="crm-muted">—</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      <button type="button" className="outline" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => openEdit(c)} disabled={busy} data-testid={`crm-edit-${c.id}`}>Edit</button>
                      <button type="button" className="outline crm-btn-hapus" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => removeCustomer(c)} disabled={busy} data-testid={`crm-delete-${c.id}`}>Hapus</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Kartu mobile */}
      <div className="mobile-cards-view">
        {filtered.map((c) => {
          const linked = projectsOf(c.id, projects)
          const isCustomer = String(c.status).toUpperCase() === STATUS_CUSTOMER
          return (
            <div className="mobile-card" key={c.id}>
              <div className="mobile-card-header">
                <b className="mobile-card-title">{c.nama}</b>
                <span style={S.badge(isCustomer ? 'customer' : 'prospek')}>{isCustomer ? 'Customer' : 'Prospek'}</span>
              </div>
              <div className="mobile-card-body">
                <div className="mobile-card-row"><span className="mobile-label">Alamat</span><span className="mobile-val">{c.alamat || '—'}</span></div>
                <div className="mobile-card-row"><span className="mobile-label">WA</span><span className="mobile-val">{c.wa || '—'}</span></div>
                <div className="mobile-card-row"><span className="mobile-label">Proyek</span><span className="mobile-val">{linked.length ? linked.map((p) => p.name).join(', ') : 'Belum ada'}</span></div>
              </div>
              <div className="mobile-card-actions" style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="outline" onClick={() => openEdit(c)} disabled={busy}>Edit</button>
                <button type="button" className="outline crm-btn-hapus" onClick={() => removeCustomer(c)} disabled={busy}>Hapus</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
