import React, { useState } from 'react'
import { navSections, labels } from '../lib/constants'

export default function Sidebar({ page, setPage, session, logout }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleNavClick = (id) => {
    setPage(id)
    setMobileMenuOpen(false)
  }

  return (
    <>
      {/* Mobile Top App Bar */}
      <div className="mobile-header">
        <div className="mobile-brand">
          <span className="logo-badge">NL</span>
          <div>
            <b>NOIR LIVING</b>
            <small>v1.2 Mobile • {labels[page] || page}</small>
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
          {navSections.map((sec, sIdx) => (
            <div key={sIdx} className="nav-group">
              {sIdx > 0 && <div className="nav-divider" />}
              {sec.items.map(([id, name]) => (
                <button
                  key={id}
                  type="button"
                  className={page === id ? 'active' : ''}
                  onClick={() => handleNavClick(id)}
                >
                  {name}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="account">
          <small>{session?.user?.email}</small>
          <button type="button" onClick={logout}>Keluar</button>
        </div>
      </aside>
    </>
  )
}
