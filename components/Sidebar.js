import React, { useState } from 'react'
import { navSections, labels } from '../lib/constants'

// Ikon SVG inline (stroke-based, 18px) — memberi isyarat visual per menu
// supaya navigasi tidak terasa seperti daftar teks polos. Murni dekoratif:
// tidak mengubah id menu, alur, role, maupun schema.
const ICONS = {
  dashboard: <path d="M3 3h7v7H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 14h7v7H3z" />,
  projects: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  vendors: <path d="M3 9l1.5-5h15L21 9M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18M9 20v-5h6v5" />,
  materials: <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />,
  requests: <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 13h6M9 17h6" />,
  approvals: <path d="M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  receivings: <path d="M6 6h15l-1.5 9h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />,
  handovers: <path d="M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11" />,
  past_projects: <path d="M3 8h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM2 4h20v4H2zM10 13h4" />,
  rab_boq: <path d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 11h3M8 15h3M15 11v6M13 15h4" />,
  planning: <path d="M3 3v18h18M7 15l3-4 3 3 5-7" />,
  project_finance: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  finance: <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  tukang_upah: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
}

function NavIcon({ id }) {
  const d = ICONS[id]
  if (!d) return <span className="nav-ico nav-ico-dot" aria-hidden="true" />
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {d}
    </svg>
  )
}

export default function Sidebar({ page, setPage, session, logout, role = 'user' }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavClick = (id) => {
    setPage(id)
    setMobileMenuOpen(false)
  }

  // Section bertanda adminOnly (mis. Finance) hanya tampil untuk role admin.
  const visibleSections = navSections.filter(sec => !sec.adminOnly || role === 'admin')

  // Inisial untuk avatar akun (maks 2 huruf).
  const email = session?.user?.email || ''
  const initials = email ? email.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() : 'NL'

  return (
    <>
      {/* Mobile Top App Bar */}
      <div className="mobile-header">
        <div className="mobile-brand">
          <span className="logo-badge">NL</span>
          <div>
            <b>NOIR LIVING</b>
            <small>Purchasing • {labels[page] || page}</small>
          </div>
        </div>
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar: Desktop persistent, Mobile off-canvas drawer */}
      <aside className={`app-sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span>NL</span>
          <div>
            <b>NOIR LIVING</b>
            <small>Purchasing</small>
          </div>
        </div>
        <nav>
          {visibleSections.map((sec, sIdx) => (
            <div key={sIdx} className="nav-group">
              {sIdx > 0 && <div className="nav-divider" />}
              {sec.label && <div className="nav-group-label">{sec.label}</div>}
              {sec.items.map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  className={page === id ? 'active' : ''}
                  onClick={() => handleNavClick(id)}
                  title={name}
                >
                  <NavIcon id={id} />
                  <span className="nav-label">{name}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <div className="account-card">
            <span className="account-avatar" aria-hidden="true">{initials}</span>
            <div className="account-meta">
              <small className="account-email" title={email}>{email || 'Pengguna'}</small>
              <small className={`account-role ${role === 'admin' ? 'is-admin' : ''}`}>
                {role === 'admin' ? '★ Admin' : 'User'}
              </small>
            </div>
          </div>
          <button type="button" className="account-logout" onClick={logout}>Keluar</button>
        </div>
      </aside>
    </>
  )
}
