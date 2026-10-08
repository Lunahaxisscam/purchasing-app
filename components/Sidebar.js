import React from 'react'
import { navSections } from '../lib/constants'

export default function Sidebar({ page, setPage, session, logout }) {
  return (
    <aside>
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
                className={page === id ? 'active' : ''}
                onClick={() => setPage(id)}
              >
                {name}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="account">
        <small>{session?.user?.email}</small>
        <button onClick={logout}>Keluar</button>
      </div>
    </aside>
  )
}
