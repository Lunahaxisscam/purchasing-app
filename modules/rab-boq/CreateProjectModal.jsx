// ============================================================
// modules/rab-boq/CreateProjectModal.jsx — Buat Proyek dari BOQ
// ============================================================
// Cakupan bisnis DAT (t_18564dce): BOQ hanya pintu awal membuat nomor
// proyek — TIDAK otomatis ke PR/Budgeting/Revenue, TIDAK mengaktifkan
// penawaran/draft apa pun. Komponen ini:
//   1. KODE PROJECT WAJIB DIISI MANUAL oleh admin — kode master project di
//      modul Projects bersifat manual/authoritative (live DB tidak kontinu:
//      83/99/101/102), jadi TIDAK ada tebakan "next number" max+1 dari client
//      (feedback DAT run 58, screenshot 1792153939917). Satu-satunya bantuan:
//      cek duplikat real-time terhadap daftar master terbaru. Numbering
//      otomatis server-side memerlukan RPC/UNIQUE (mutasi schema) — freeze
//      migrasi berlaku; gap didokumentasikan di README modul.
//   2. GUARD duplikasi: (a) kode yang diketik belum dipakai master lain;
//      (b) BOQ ini belum terikat Master Project existing (jangan dobel buat).
//   3. Konfirmasi EXPLISIT dua langkah: ringkasan mapping Master Project ->
//      window.confirm (pattern app: confirm sebelum aksi tulis).
//   4. INSERT ke tabel projects HANYA {kode, code, name, status NOT_START}
//      (mapping Master Project). Kolom lain tidak disentuh.
//   5. Gagal/ditolak = tidak ada penulisan apa pun.
// Keamanan: insert lewat supabase client sesi user (RLS projects berlaku);
// validasi role sudah dilakukan pages/index.js (halaman admin-only) DAN
// RLS database tetap pembatas terakhir.
// ============================================================
import React, { useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function CreateProjectModal({ boq, projects = [], selectedProject = null, onClose, onDone }) {
  const [name, setName] = useState(boq.projectName && boq.projectName !== 'New project' ? boq.projectName : '')
  const [kode, setKode] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const finalKode = (kode || '').trim()
  // Guard duplikasi (a): kode harus terisi DAN belum dipakai master lain.
  const duplicate = finalKode
    ? (projects || []).some(p => String(p.kode ?? p.code ?? '').trim() === finalKode)
    : false
  // Guard duplikasi (b): BOQ ini sudah terikat Master Project existing ->
  // jangan membuat proyek baru untuk reff yang sama.
  const alreadyLinked = !!selectedProject

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setError('')
    const projectName = (name || '').trim()
    if (alreadyLinked) {
      setError(`BOQ ini sudah terikat Master Project "${selectedProject.kode ?? selectedProject.code ?? ''} — ${selectedProject.name || ''}". Lepaskan tautan di Project Reff No bila memang ingin membuat proyek yang berbeda.`)
      return
    }
    if (!projectName) { setError('Nama project wajib diisi.'); return }
    if (!finalKode) { setError('Kode project wajib diisi — kode master authoritative, lihat daftar di modul Projects.'); return }
    if (duplicate) { setError(`Kode project "${finalKode}" sudah dipakai project lain. Gunakan kode lain.`); return }
    if (!supabase) { setError('Koneksi database tidak tersedia.'); return }

    // KONFIRMASI EKSPLISIT (wajib task): mapping ke Master Project diperlihatkan
    // utuh sebelum tulis. Tidak ada efek samping lain yang dijanjikan.
    const summary =
      `Buat Project baru di Master Project?\n\n` +
      `Kode Project : ${finalKode}\n` +
      `Nama Project : ${projectName}\n` +
      `Status awal  : Not Start\n` +
      `Dari BOQ     : ${boq.boqReff || '-'} (referensi saja, tidak ditulis ke tabel)\n\n` +
      `Proyek TIDAK otomatis membuat PR / Budgeting / Revenue. Lanjutkan?`
    if (!window.confirm(summary)) return

    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({ kode: finalKode, code: finalKode, name: projectName, status: 'NOT_START' })
        .select('id, kode, name, status')
        .single()
      if (error) {
        setError(error.message)
        setSaving(false)
        return
      }
      window.alert(`✅ Project "${data.name}" (kode ${data.kode}) dibuat dengan status Not Start.`)
      if (onDone) onDone(data)
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="modal">
      <form className="dialog" onSubmit={submit}>
        <div className="dialoghead">
          <h2>🏗️ Buat Proyek dari BOQ</h2>
          <button type="button" className="icon" onClick={onClose}>×</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: '13px' }}>
          BOQ ini hanya <b>pintu awal</b> membuat nomor proyek. Proyek dibuat di Master Project dengan
          status <b>Not Start</b> — <b>tidak</b> otomatis membuat PR, Budgeting, atau Revenue.
        </p>
        {alreadyLinked && (
          <div className="notice" style={{ background: 'var(--warn-tint, #f6f2e2)', borderColor: 'var(--warn-border, #d8cf9f)', color: '#6b5b1e', margin: 0 }}>
            ⚠️ BOQ ini sudah terikat Master Project <b>{selectedProject.kode ?? selectedProject.code ?? ''} — {selectedProject.name || ''}</b>.
            Membuat proyek baru untuk reff yang sama akan dobel — lepaskan tautan (tombol Lepas) bila memang proyeknya berbeda.
          </div>
        )}
        {error && (
          <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: 'var(--danger-border)', color: '#8a2425', margin: 0 }}>{error}</div>
        )}
        <label>Kode Project (wajib — authoritative, manual)
          <input
            type="text"
            value={kode}
            onChange={e => setKode(e.target.value)}
            placeholder="Sesuai penomoran master (contoh: 103)"
            required
          />
        </label>
        <div className="muted" style={{ marginTop: '-8px', marginBottom: '6px', fontSize: '12px' }}>
          Kode master bersifat <b>manual &amp; authoritative</b> (lihat modul Projects — live: 83, 99, 101, 102).
          {!finalKode && <span> Belum diisi.</span>}
          {finalKode && !duplicate && <span style={{ color: 'var(--ok, #3d6b3f)' }}> ✓ Kode belum terpakai.</span>}
          {finalKode && duplicate && <span style={{ color: 'var(--danger)' }}> ⚠️ Kode sudah dipakai — pilih kode lain.</span>}
          {' '}Penomoran otomatis server-side belum tersedia (butuh RPC/UNIQUE — freeze migrasi; gap di README modul).
        </div>
        <label>Nama Project
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Contoh: Interior Pantry & Storage Office"
            required
          />
        </label>
        <label>Referensi BOQ (readonly)
          <input type="text" value={boq.boqReff || '-'} readOnly aria-readonly="true" />
        </label>
        <label>Project Reff No BOQ (readonly)
          <input
            type="text"
            value={alreadyLinked ? (boq.projectReffNo || '-') : '— menjadi PRJ-<kode> setelah proyek dibuat'}
            readOnly aria-readonly="true"
          />
        </label>
        <label>Status awal (readonly)
          <input type="text" value="Not Start" readOnly aria-readonly="true" />
        </label>
        <div className="actions">
          <button type="button" className="outline" onClick={onClose}>Batal</button>
          <button disabled={saving || alreadyLinked || !finalKode || duplicate}>{saving ? 'Menyimpan…' : 'Buat Project'}</button>
        </div>
      </form>
    </div>
  )
}
