// ============================================================
// modules/upah-kasbon/view.jsx — Upah & Kasbon (staging)
// ============================================================
// TAHAP 2 (24 Okt 2026, keputusan DAT): Supabase = DATABASE MASTER,
// tanpa sync Google Sheets. Prototipe (v8, logika teruji 41/41)
// tetap dipakai apa adanya, tetapi penyimpanannya sekarang Supabase:
//
//   - view.jsx menginjeksi KLIEN Supabase milik aplikasi ke
//     window.__UPAH_SUPABASE__ sebelum iframe dirender. Iframe
//     same-origin membacanya, jadi memakai SESI LOGIN & RLS yang
//     sama (admin-only) — tanpa kredensial baru, tanpa CDN.
//   - public/upah-kasbon-sync.js: diff state -> operasi DB
//     (insert/update/delete berurutan, junction totalan ikut).
//   - Data master: upah_tukang, upah_projects, upah_items,
//     upah_kasbon, upah_totalan (+ 2 junction). Migrasi:
//     migrations/2026-10-24_upah_kasbon_master.sql
//   - Gagal memuat database -> modul baca-saja (fail-closed),
//     TIDAK ada fallback diam-diam ke localStorage.
//
// Tab lama "Upah Tukang" (read-only, hasil sync Sheets) sengaja
// tetap ada sampai DAT menyatakan modul ini siap menggantikan.
// ============================================================

import React, { useEffect } from 'react'
import { supabase } from '../../lib/supabaseClient'

const PROTO_URL = '/upah-kasbon-prototype.html'

// Injeksi klien HARUS terjadi sebelum iframe dimuat. useEffect berjalan
// setelah React commit — iframe sudah mulai fetch HTML prototipe, jadi
// prototipe bisa membaca window.parent.__UPAH_SUPABASE__ yang masih kosong
// dan terlanjur masuk mode legacy (localStorage). Karena itu dipasang di
// module scope: modul ini dieksekusi saat import, jauh sebelum render.
if (typeof window !== 'undefined' && supabase) {
  window.__UPAH_SUPABASE__ = supabase
}

export default function UpahKasbonPage() {
  useEffect(() => {
    // jaring pengaman: bila modul di-import sebelum klien siap (mis. env
    // diisi belakangan), pasang lagi saat mount.
    try {
      if (typeof window !== 'undefined' && supabase) {
        window.__UPAH_SUPABASE__ = supabase
      }
    } catch (e) { /* iframe akan tampil mode legacy + banner status */ }
  }, [])

  return (
    <div className="upah-kasbon-wrap">
      <iframe
        src={PROTO_URL}
        title="Modul Upah & Kasbon"
        className="upah-kasbon-frame"
        onLoad={(e) => {
          try {
            if (typeof window !== 'undefined' && supabase) {
              window.__UPAH_SUPABASE__ = supabase
            }
            e.currentTarget.contentWindow?.bootMaster?.()
          } catch (err) {}
        }}
      />
    </div>
  )
}
