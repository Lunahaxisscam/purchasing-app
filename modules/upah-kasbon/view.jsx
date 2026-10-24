// ============================================================
// modules/upah-kasbon/view.jsx — Upah & Kasbon (staging)
// ============================================================
// STATUS: tahap 1 integrasi (24 Okt 2026, arahan DAT "masukkan ke staging
// 3001 di modul upah kasbon").
//
// KENAPA IFRAME, BUKAN REACT PORT LANGSUNG:
// Prototipe dari DAT (`modul-upah-kasbon.html`, v8) adalah 1.102 baris
// HTML + vanilla JS dengan logika yang SUDAH diuji 41/41 assertion
// (total proyek, potongan kasbon per entri, hak bersih, saldo, status,
// arsip proyek lunas, anti-dobel totalan). Menulis ulang ke React dalam
// satu langkah berisiko mengubah perilaku yang sudah terbukti.
//
// Jadi tahap 1 = prototipe dijalankan APA ADANYA di dalam panel app
// (sumber: /public/upah-kasbon-prototype.html). Keuntungannya: yang diuji
// DAT di staging = persis yang dia uji di browser lokal.
//
// TAHAP 2 (belum dikerjakan): port ke view.jsx React asli memakai
// `logic.js` (sudah ada di folder ini, TIDAK perlu diubah) + `store.js`
// diganti Supabase. Lihat README.md bagian "Kontrak integrasi".
//
// CATATAN DATA: prototipe menyimpan ke localStorage browser, BUKAN ke
// tabel Supabase. Tabel `tukang_*` sengaja tidak disentuh karena masih
// diisi sync Google Sheets (konflik sumber data — SPEC.md risiko #1).
// Artinya: data di modul ini TIDAK terlihat oleh user/perangkat lain.
// ============================================================

import React from 'react'

const PROTO_URL = '/upah-kasbon-prototype.html'

export default function UpahKasbonPage() {
  return (
    <div className="upah-kasbon-wrap">
      <div className="upah-kasbon-note">
        <b>Upah &amp; Kasbon</b> — modul input upah borongan, kasbon, dan
        totalan/slip tukang. Data tersimpan di <b>browser ini</b> (localStorage),
        belum ke database. Gunakan <b>Ekspor JSON</b> di dalam modul untuk cadangan.
      </div>
      <iframe
        src={PROTO_URL}
        title="Modul Upah & Kasbon"
        className="upah-kasbon-frame"
      />
    </div>
  )
}
