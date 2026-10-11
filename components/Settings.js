import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatDateTime, timeAgo } from '../lib/constants'

// ============================================================
// Modul SETTINGS — khusus role admin.
// Tab 1: Log Aktivitas  — audit trail otomatis (trigger DB) dari
//        perubahan PR / Approval / Purchase / Handover / Master data.
// Tab 2: Credential & Pengguna — daftar akun + role, dengan kontrol
//        ubah role (diproses via RPC admin_set_user_role di database;
//        hanya admin yang boleh, tidak bisa ubah diri sendiri).
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
              <b> User</b> hanya modul operasional (tanpa Finance/Settings). Perubahan role langsung tersimpan ke database
              dan tercatat di Log Aktivitas.
            </p>
          </div>
          <div className="panel table desktop-table-view">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: '210px' }}>Nama Lengkap</th>
                  <th style={{ width: '110px' }}>Role</th>
                  <th style={{ width: '130px' }}>Dibuat</th>
                  <th style={{ width: '170px' }}>Ubah Role</th>
                </tr>
              </thead>
              <tbody>
                {usersLoading ? (
                  <tr><td colSpan={5} className="empty">Memuat daftar akun…</td></tr>
                ) : users.length ? users.map(u => {
                  const isSelf = session?.user?.id === u.id
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
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={5} className="empty">{usersError ? 'Tidak bisa menampilkan daftar akun.' : 'Belum ada akun.'}</td></tr>
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
                  </div>
                </div>
              )
            }) : <div className="panel empty">Belum ada akun.</div>}
          </div>
        </>
      )}
    </>
  )
}
