import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDateTime, timeAgo } from '../lib/constants'

// ============================================================
// Modul SETTINGS — khusus role admin.
// Tab 1: Log Aktivitas  — audit trail otomatis (trigger DB).
// Tab 2: Credential & Pengguna — daftar akun + role + kelola akun:
//        • + Tambah Akun        (RPC admin_create_user — email auto-confirmed)
//        • 👁 Lihat Password    (RPC admin_get_user_password; password tercatat
//                                saat akun dibuat/diubah lewat halaman ini.
//                                Akun lama → "(belum tercatat)", set ulang dulu.)
//        • Ubah Password        (RPC admin_set_user_password — bcrypt + catat)
//        • Ubah Role            (RPC admin_set_user_role — tidak bisa diri sendiri)
// Semua RPC guard admin di database (SECURITY DEFINER + cek profiles.role).
// ============================================================

const ACTION_LABEL = {
  INSERT: 'Dibuat',
  UPDATE: 'Diubah',
  DELETE: 'Dihapus'
}

const ENTITY_LABEL = {
  purchase_requests: 'Purchase Request',
  pr_items: 'Item PR',
  approval_steps: 'Approval',
  receivings: 'Purchase',
  receiving_items: 'Item Purchase',
  handovers: 'Handover',
  projects: 'Project',
  materials: 'Material',
  vendors: 'Vendor',
  profiles: 'Pengguna'
}

function actionBadgeClass(action) {
  if (action === 'INSERT') return 'badge status-APPROVED'
  if (action === 'DELETE') return 'badge status-REJECTED'
  return 'badge status-PENDING'
}

export default function Settings({ role = 'user', session }) {
  const [tab, setTab] = useState('logs')
  const [logs, setLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState('')
  const [entityFilter, setEntityFilter] = useState('all')
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [busyUserId, setBusyUserId] = useState(null)

  // --- state fitur kelola akun ---
  const [revealed, setRevealed] = useState({})          // {userId: {password, found} | 'loading'}
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ email: '', full_name: '', role: 'user', password: '' })
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const [pwModal, setPwModal] = useState(null)          // {user}
  const [pwForm, setPwForm] = useState({ password: '', confirm: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')

  const loadLogs = useCallback(async () => {
    if (!supabase) return
    setLogsLoading(true)
    setLogsError('')
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
      if (error) setLogsError(error.message)
      else setLogs(data || [])
    } catch (e) {
      setLogsError(e.message)
    } finally {
      setLogsLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    if (!supabase) return
    setUsersLoading(true)
    setUsersError('')
    try {
      const { data, error } = await supabase.rpc('admin_list_users')
      if (error) setUsersError(error.message)
      else if (data && data.ok === false) setUsersError(data.reason === 'not_admin' ? 'Hanya admin yang dapat melihat daftar akun.' : 'Gagal memuat daftar akun.')
      else setUsers((data && data.users) || [])
    } catch (e) {
      setUsersError(e.message)
    } finally {
      setUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (role !== 'admin') return
    loadLogs()
    loadUsers()
  }, [role, loadLogs, loadUsers])

  async function changeRole(user, newRole) {
    if (!supabase || busyUserId) return
    if (user.role === newRole) return
    const label = newRole === 'admin' ? 'Admin' : 'User'
    const ok = window.confirm(`Ubah role akun "${user.email}" menjadi ${label}?`)
    if (!ok) return
    setBusyUserId(user.id)
    try {
      const { data, error } = await supabase.rpc('admin_set_user_role', {
        p_target_id: user.id,
        p_new_role: newRole
      })
      if (error) {
        window.alert(`Gagal mengubah role: ${error.message}`)
      } else if (data && data.ok === false) {
        const reasons = {
          not_admin: 'Hanya admin yang dapat mengubah role.',
          self: 'Tidak bisa mengubah role akun Anda sendiri.',
          invalid_role: 'Role tidak valid.',
          not_found: 'Akun tidak ditemukan.',
          not_authenticated: 'Sesi tidak valid, silakan login ulang.'
        }
        window.alert(reasons[data.reason] || `Gagal mengubah role (${data.reason}).`)
      } else {
        await loadUsers()
        await loadLogs()
      }
    } catch (e) {
      window.alert(`Gagal mengubah role: ${e.message}`)
    } finally {
      setBusyUserId(null)
    }
  }

  // ---- Lihat / sembunyikan password (per akun) ----
  async function toggleReveal(user) {
    if (revealed[user.id]) {
      setRevealed(prev => { const n = { ...prev }; delete n[user.id]; return n })
      return
    }
    setRevealed(prev => ({ ...prev, [user.id]: 'loading' }))
    try {
      const { data, error } = await supabase.rpc('admin_get_user_password', { p_target_id: user.id })
      if (error) {
        window.alert(`Gagal mengambil password: ${error.message}`)
        setRevealed(prev => { const n = { ...prev }; delete n[user.id]; return n })
        return
      }
      if (data && data.ok === false) {
        window.alert(data.reason === 'not_admin' ? 'Hanya admin yang dapat melihat password.' : `Gagal mengambil password (${data.reason}).`)
        setRevealed(prev => { const n = { ...prev }; delete n[user.id]; return n })
        return
      }
      setRevealed(prev => ({ ...prev, [user.id]: { password: data.password || null, found: !!data.found, updated_at: data.updated_at || null } }))
    } catch (e) {
      window.alert(`Gagal mengambil password: ${e.message}`)
      setRevealed(prev => { const n = { ...prev }; delete n[user.id]; return n })
    }
  }

  // ---- Tambah akun ----
  function openAdd() {
    setAddForm({ email: '', full_name: '', role: 'user', password: '' })
    setAddError('')
    setShowAddModal(true)
  }

  async function submitAdd(e) {
    e.preventDefault()
    if (!supabase || addBusy) return
    if (!addForm.email.trim()) { setAddError('Email wajib diisi.'); return }
    if (addForm.password.length < 8) { setAddError('Password minimal 8 karakter.'); return }
    setAddBusy(true)
    setAddError('')
    try {
      const { data, error } = await supabase.rpc('admin_create_user', {
        p_email: addForm.email.trim(),
        p_password: addForm.password,
        p_full_name: addForm.full_name.trim(),
        p_role: addForm.role
      })
      if (error) { setAddError(error.message); return }
      if (data && data.ok === false) {
        const reasons = {
          not_admin: 'Hanya admin yang dapat menambah akun.',
          invalid_email: 'Format email tidak valid.',
          weak_password: 'Password minimal 8 karakter.',
          invalid_role: 'Role tidak valid.',
          email_exists: 'Email sudah terdaftar.',
          not_authenticated: 'Sesi tidak valid, silakan login ulang.'
        }
        setAddError(reasons[data.reason] || `Gagal menambah akun (${data.reason}).`)
        return
      }
      setShowAddModal(false)
      await loadUsers()
      await loadLogs()
      window.alert(`✅ Akun ${addForm.email.trim()} berhasil dibuat. Password tercatat — bisa dilihat lewat tombol 👁 Lihat di tabel.`)
    } catch (e) {
      setAddError(e.message)
    } finally {
      setAddBusy(false)
    }
  }

  // ---- Ubah password ----
  function openPw(user) {
    setPwForm({ password: '', confirm: '' })
    setPwError('')
    setPwModal({ user })
  }

  async function submitPw(e) {
    e.preventDefault()
    if (!supabase || pwBusy || !pwModal) return
    if (pwForm.password.length < 8) { setPwError('Password minimal 8 karakter.'); return }
    if (pwForm.password !== pwForm.confirm) { setPwError('Konfirmasi password tidak sama.'); return }
    setPwBusy(true)
    setPwError('')
    try {
      const { data, error } = await supabase.rpc('admin_set_user_password', {
        p_target_id: pwModal.user.id,
        p_new_password: pwForm.password
      })
      if (error) { setPwError(error.message); return }
      if (data && data.ok === false) {
        const reasons = {
          not_admin: 'Hanya admin yang dapat mengubah password.',
          weak_password: 'Password minimal 8 karakter.',
          not_found: 'Akun tidak ditemukan.',
          not_authenticated: 'Sesi tidak valid, silakan login ulang.'
        }
        setPwError(reasons[data.reason] || `Gagal mengubah password (${data.reason}).`)
        return
      }
      setPwModal(null)
      // segarkan cache reveal akun tsb supaya tombol 👁 menampilkan password baru
      setRevealed(prev => { const n = { ...prev }; delete n[pwModal.user.id]; return n })
      await loadUsers()
      await loadLogs()
      window.alert(`✅ Password ${pwModal.user.email} berhasil diubah dan tercatat.`)
    } catch (e) {
      setPwError(e.message)
    } finally {
      setPwBusy(false)
    }
  }

  if (role !== 'admin') {
    return <div className="panel empty">Halaman ini khusus administrator.</div>
  }

  const entities = Array.from(new Set(logs.map(l => l.entity).filter(Boolean)))
  const filteredLogs = entityFilter === 'all' ? logs : logs.filter(l => l.entity === entityFilter)

  return (
    <>
      <div className="toolbar">
        <div className="filter-tabs">
          <button type="button" className={`pill ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
            📋 Cek Log Aktivitas {logs.length ? `(${logs.length})` : ''}
          </button>
          <button type="button" className={`pill ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
            👤 Atur Credential / Pengguna {users.length ? `(${users.length})` : ''}
          </button>
        </div>
        <div className="toolbar-actions">
          {tab === 'logs' && entities.length > 0 && (
            <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
              <option value="all">Semua modul</option>
              {entities.map(en => (
                <option key={en} value={en}>{ENTITY_LABEL[en] || en}</option>
              ))}
            </select>
          )}
          {tab === 'users' && (
            <button type="button" className="btn-create-module" onClick={openAdd}>
              + Tambah Akun
            </button>
          )}
          <button
            type="button"
            className="outline"
            onClick={() => (tab === 'logs' ? loadLogs() : loadUsers())}
          >
            ↻ Perbarui
          </button>
        </div>
      </div>

      {tab === 'logs' ? (
        <>
          {logsError && <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>Gagal memuat log: {logsError}</div>}
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Waktu</th>
                  <th style={{ width: '200px' }}>Pengguna</th>
                  <th style={{ width: '90px' }}>Aksi</th>
                  <th style={{ width: '150px' }}>Modul</th>
                  <th>Detail Perubahan</th>
                </tr>
              </thead>
              <tbody>
                {logsLoading ? (
                  <tr><td colSpan={5} className="empty">Memuat log aktivitas…</td></tr>
                ) : filteredLogs.length ? filteredLogs.map(l => (
                  <tr key={l.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600 }}>{formatDateTime(l.created_at)}</div>
                      <div style={{ fontSize: '11px', color: '#9aa8a4' }}>{timeAgo(l.created_at)}</div>
                    </td>
                    <td style={{ fontSize: '12.5px', wordBreak: 'break-all' }}>{l.user_email || '—'}</td>
                    <td><span className={actionBadgeClass(l.action)}>{ACTION_LABEL[l.action] || l.action}</span></td>
                    <td>{ENTITY_LABEL[l.entity] || l.entity || '—'}</td>
                    <td style={{ whiteSpace: 'normal', fontSize: '12.5px' }}>{l.detail || '—'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="empty">{logsError ? 'Tidak bisa menampilkan log.' : 'Belum ada aktivitas tercatat. Log akan terisi otomatis saat ada perubahan data (PR, Approval, Purchase, dll).'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {logsLoading ? (
              <div className="panel empty">Memuat log aktivitas…</div>
            ) : filteredLogs.length ? filteredLogs.map(l => (
              <div className="mobile-card" key={l.id}>
                <div className="mobile-card-header">
                  <div>
                    <b className="mobile-card-title">{ENTITY_LABEL[l.entity] || l.entity || 'Aktivitas'}</b>
                    <div className="mobile-card-sub">{formatDateTime(l.created_at)} • {timeAgo(l.created_at)}</div>
                  </div>
                  <span className={actionBadgeClass(l.action)}>{ACTION_LABEL[l.action] || l.action}</span>
                </div>
                <div className="mobile-card-body">
                  <div className="mobile-card-row"><span className="mobile-label">Pengguna:</span><span className="mobile-val">{l.user_email || '—'}</span></div>
                  <div className="mobile-card-row"><span className="mobile-label">Detail:</span><span className="mobile-val">{l.detail || '—'}</span></div>
                </div>
              </div>
            )) : <div className="panel empty">Belum ada aktivitas tercatat.</div>}
          </div>
        </>
      ) : (
        <>
          {usersError && <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}>Gagal memuat akun: {usersError}</div>}
          <div className="panel" style={{ marginBottom: '18px', padding: '16px 22px' }}>
            <p className="muted" style={{ margin: 0 }}>
              Daftar akun aktif beserta rolenya. <b>Admin</b> dapat mengakses seluruh modul termasuk Finance &amp; Settings;
              <b> User</b> hanya modul operasional (tanpa Finance/Settings). Semua perubahan tersimpan ke database dan tercatat di Log Aktivitas.
              <br />
              🔑 <b>Lihat Password</b>: password tampil untuk akun yang dibuat/diubah lewat halaman ini. Akun lama yang belum tercatat → klik
              &quot;Ubah Password&quot; untuk menetapkan yang baru.
            </p>
          </div>
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: '180px' }}>Nama Lengkap</th>
                  <th style={{ width: '100px' }}>Role</th>
                  <th style={{ width: '130px' }}>Dibuat</th>
                  <th style={{ width: '220px' }}>Password</th>
                  <th style={{ width: '170px' }}>Ubah Role</th>
                  <th style={{ width: '150px' }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr><td colSpan={7} className="empty">Memuat daftar akun…</td></tr>
                ) : users.length ? users.map(u => {
                  const isSelf = session?.user?.id === u.id
                  const rev = revealed[u.id]
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600, wordBreak: 'break-all' }}>{u.email || '—'}{isSelf ? ' (Anda)' : ''}</td>
                      <td>{u.full_name || '—'}</td>
                      <td>
                        <span className={u.role === 'admin' ? 'badge status-APPROVED' : 'badge status-DRAFT'}>
                          {u.role === 'admin' ? '★ Admin' : 'User'}
                        </span>
                      </td>
                      <td>{formatDateTime(u.created_at)}</td>
                      <td>
                        {rev === 'loading' ? (
                          <span className="muted" style={{ fontSize: '12px' }}>⏳ Memuat…</span>
                        ) : rev && rev.found ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <code style={{ background: '#f3f5f6', padding: '3px 8px', borderRadius: '6px', fontSize: '12px' }}>{rev.password}</code>
                            <button type="button" className="icon" title="Sembunyikan" onClick={() => toggleReveal(u)}>🙈</button>
                          </span>
                        ) : rev && !rev.found ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className="muted" style={{ fontSize: '11.5px' }}>(belum tercatat — set ulang)</span>
                            <button type="button" className="icon" title="Sembunyikan" onClick={() => toggleReveal(u)}>🙈</button>
                          </span>
                        ) : (
                          <button type="button" className="outline" style={{ fontSize: '11.5px', padding: '5px 10px' }} onClick={() => toggleReveal(u)}>
                            👁 Lihat
                          </button>
                        )}
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="muted" style={{ fontSize: '12px' }}>— (akun sendiri)</span>
                        ) : (
                          <select
                            value={u.role}
                            disabled={busyUserId === u.id}
                            onChange={e => changeRole(u, e.target.value)}
                            className="status-select"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <button type="button" className="outline" style={{ fontSize: '11.5px', padding: '5px 10px', whiteSpace: 'nowrap' }} onClick={() => openPw(u)}>
                          🔑 Ubah Password
                        </button>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={7} className="empty">{usersError ? 'Tidak bisa menampilkan daftar akun.' : 'Belum ada akun.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Kartu mobile */}
          <div className="mobile-cards-view">
            {usersLoading ? (
              <div className="panel empty">Memuat daftar akun…</div>
            ) : users.length ? users.map(u => {
              const isSelf = session?.user?.id === u.id
              const rev = revealed[u.id]
              return (
                <div className="mobile-card" key={u.id}>
                  <div className="mobile-card-header">
                    <div>
                      <b className="mobile-card-title" style={{ wordBreak: 'break-all' }}>{u.email || '—'}</b>
                      <div className="mobile-card-sub">{u.full_name || '—'}</div>
                    </div>
                    <span className={u.role === 'admin' ? 'badge status-APPROVED' : 'badge status-DRAFT'}>
                      {u.role === 'admin' ? '★ Admin' : 'User'}
                    </span>
                  </div>
                  <div className="mobile-card-body">
                    <div className="mobile-card-row"><span className="mobile-label">Dibuat:</span><span className="mobile-val">{formatDateTime(u.created_at)}</span></div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Password:</span>
                      <span className="mobile-val">
                        {rev === 'loading' ? '⏳ Memuat…' : rev && rev.found ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <code style={{ background: '#f3f5f6', padding: '2px 6px', borderRadius: '6px', fontSize: '12px' }}>{rev.password}</code>
                            <button type="button" className="icon" onClick={() => toggleReveal(u)}>🙈</button>
                          </span>
                        ) : rev && !rev.found ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span className="muted" style={{ fontSize: '11.5px' }}>(belum tercatat)</span>
                            <button type="button" className="icon" onClick={() => toggleReveal(u)}>🙈</button>
                          </span>
                        ) : (
                          <button type="button" className="outline" style={{ fontSize: '11.5px', padding: '4px 9px' }} onClick={() => toggleReveal(u)}>👁 Lihat</button>
                        )}
                      </span>
                    </div>
                    {!isSelf && (
                      <div className="mobile-card-row">
                        <span className="mobile-label">Ubah Role:</span>
                        <span className="mobile-val">
                          <select
                            value={u.role}
                            disabled={busyUserId === u.id}
                            onChange={e => changeRole(u, e.target.value)}
                            className="status-select"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </span>
                      </div>
                    )}
                    <div className="mobile-card-row">
                      <span className="mobile-label">Aksi:</span>
                      <span className="mobile-val">
                        <button type="button" className="outline" style={{ fontSize: '11.5px', padding: '4px 9px' }} onClick={() => openPw(u)}>🔑 Ubah Password</button>
                      </span>
                    </div>
                  </div>
                </div>
              )
            }) : <div className="panel empty">Belum ada akun.</div>}
          </div>
        </>
      )}

      {/* ============ MODAL: Tambah Akun ============ */}
      {showAddModal && (
        <div className="modal">
          <form className="dialog" onSubmit={submitAdd}>
            <div className="dialoghead">
              <h2>+ Tambah Akun Baru</h2>
              <button type="button" className="icon" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              Akun langsung aktif (email terkonfirmasi otomatis). Password tercatat dan bisa dilihat admin lewat tombol 👁 Lihat di tabel.
            </p>
            {addError && (
              <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', margin: 0 }}>{addError}</div>
            )}
            <label>Email
              <input
                type="email"
                value={addForm.email}
                onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                placeholder="nama@perusahaan.com"
                required
              />
            </label>
            <label>Nama Lengkap
              <input
                type="text"
                value={addForm.full_name}
                onChange={e => setAddForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Contoh: Staff Gudang"
              />
            </label>
            <label>Role
              <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))}>
                <option value="user">User — modul operasional saja</option>
                <option value="admin">Admin — semua modul + Finance &amp; Settings</option>
              </select>
            </label>
            <label>Password (min. 8 karakter)
              <input
                type="text"
                value={addForm.password}
                onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Password untuk akun ini"
                required
                minLength={8}
              />
            </label>
            <div className="actions">
              <button type="button" className="outline" onClick={() => setShowAddModal(false)}>Batal</button>
              <button disabled={addBusy}>{addBusy ? '⏳ Menyimpan…' : '+ Buat Akun'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ============ MODAL: Ubah Password ============ */}
      {pwModal && (
        <div className="modal">
          <form className="dialog" onSubmit={submitPw}>
            <div className="dialoghead">
              <h2>🔑 Ubah Password — {pwModal.user.email}</h2>
              <button type="button" className="icon" onClick={() => setPwModal(null)}>×</button>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
              Password baru langsung aktif untuk login akun ini, dan tercatat supaya admin bisa melihatnya lewat tombol 👁 Lihat.
            </p>
            {pwError && (
              <div className="notice" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b', margin: 0 }}>{pwError}</div>
            )}
            <label>Password Baru (min. 8 karakter)
              <input
                type="text"
                value={pwForm.password}
                onChange={e => setPwForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Password baru"
                required
                minLength={8}
              />
            </label>
            <label>Ulangi Password Baru
              <input
                type="text"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="Ketik ulang password baru"
                required
                minLength={8}
              />
            </label>
            <div className="actions">
              <button type="button" className="outline" onClick={() => setPwModal(null)}>Batal</button>
              <button disabled={pwBusy}>{pwBusy ? '⏳ Menyimpan…' : '🔑 Simpan Password'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
