import React, { useState } from 'react'

export default function Login(p) {
  const [showPw, setShowPw] = useState(false)
  return (
    <main className="login">
      {/* Panel brand (kiri) — pakai <div> agar tidak terkena aturan global
          `aside` (sidebar 254px) / `.login section` (kartu 420px). */}
      <div className="login-brand" aria-hidden="true">
        <div className="login-brand-inner">
          <span className="login-brand-badge">NL</span>
          <p className="login-brand-name">NOIR LIVING</p>
          <h2 className="login-brand-head">Purchasing</h2>
          <p className="login-brand-sub">
            Satu pintu untuk purchase request, approval, purchase, dan handover —
            rapi, terlacak, dan siap diaudit.
          </p>
          <ul className="login-brand-points">
            <li>Alur pengadaan terstruktur per proyek</li>
            <li>Persetujuan berjenjang &amp; jejak audit</li>
            <li>Rekap biaya &amp; laba per proyek</li>
          </ul>
        </div>
        <div className="login-brand-glow" />
      </div>

      {/* Panel form (kanan) — brand cukup sekali di panel kiri. */}
      <div className="login-panel">
        <div className="login-form-col">
          <h1 className="login-title">Masuk</h1>
          <p className="muted login-sub">Gunakan akun yang diberikan administrator.</p>
          <form onSubmit={p.login}>
            <label>
              <span className="field-label">Email</span>
              <div className="field-wrap">
                <svg className="field-ico" viewBox="0 0 24 24" width="17" height="17" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  <path d="M3 6l9 7 9-7" />
                </svg>
                <input type="email" value={p.email} onChange={e => p.setEmail(e.target.value)} required
                  placeholder="nama@perusahaan.com" autoComplete="email" />
              </div>
            </label>
            <label>
              <span className="field-label">Password</span>
              <div className="field-wrap">
                <svg className="field-ico" viewBox="0 0 24 24" width="17" height="17" fill="none"
                  stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                <input type={showPw ? 'text' : 'password'} value={p.password}
                  onChange={e => p.setPassword(e.target.value)} required
                  placeholder="••••••••" autoComplete="current-password" />
                <button type="button" className="field-toggle" onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? 'Sembunyikan password' : 'Tampilkan password'}
                  title={showPw ? 'Sembunyikan password' : 'Tampilkan password'}>
                  {showPw ? (
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>
            {p.error && <p className="error">{p.error}</p>}
            <button className="login-submit" disabled={!p.configured}>
              {p.configured ? 'Masuk' : 'Supabase belum terhubung'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
