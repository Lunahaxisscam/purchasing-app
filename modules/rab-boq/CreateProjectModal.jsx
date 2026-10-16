// ============================================================
// modules/rab-boq/CreateProjectModal.jsx — Buat Proyek dari BOQ
// ============================================================
// Cakupan bisnis DAT (t_18564dce): BOQ hanya pintu awal membuat nomor
// proyek — TIDAK otomatis ke PR/Budgeting/Revenue, TIDAK mengaktifkan
// penawaran/draft apa pun. Komponen ini:
//   1. Menampilkan pratinjau kode proyek berikutnya (readonly) — dihitung
//      dari daftar projects yang dimuat (pattern CreateModal nextPrNum).
//      ADMIN TETAP BISA MENIMPA dengan kode manual (master projects/kode
//      di modul Project diisi manual — tidak ada generator server-side).
//   2. Konfirmasi EXPLISIT dua langkah: modal ringkasan -> konfirmasi
//      akhir via window.confirm (pattern app: window.confirm sebelum aksi).
//   3. INSERT ke tabel projects HANYA {kode, name, status NOT_START}
//      (mapping Master Project). Kolom lain tidak disentuh.
//   4. Gagal/ditolak = tidak ada penulisan apa pun.
// Keamanan: insert lewat supabase client sesi user (RLS projects berlaku);
// validasi role sudah dilakukan pages/index.js (halaman admin-only) DAN
// RLS database tetap pembatas terakhir.
// ============================================================
import React, { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function CreateProjectModal({ boq, projects = [], onClose, onDone }) {
  // Pratinjau kode: nomor berikutnya > max kode angka existing (pattern
  // nextPrNum di CreateModal). Ini HANYA pratinjau — admin bisa menimpa;
  // cek duplikat tetap dilakukan saat submit terhadap daftar terbaru.
  const nextKodePreview = useMemo(() => {
    const maxNum = (projects || []).reduce((max, p) => {
      const n = parseInt(String(p.kode ?? p.code ?? '').replace(/^\D+/, ''), 10)
      return isFinite(n) && n > max ? n : max
    }, 0)
    return String(maxNum + 1).padStart(2, '0')
  }, [projects])

  const [name, setName] = useState(boq.projectName && boq.projectName !== 'New project' ? boq.projectName : '')
  const [kode, setKode] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const finalKode = (kode || '').trim() || nextKodePreview
  const duplicate = (projects || []).some(p => String(p.kode ?? p.code ?? '').trim() === finalKode)

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setError('')
    const projectName = (name || '').trim()
    if (!projectName) { setError('Nama project wajib diisi.'); return }
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
        {error && (
          <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: 'var(--danger-border)', color: '#8a2425', margin: 0 }}>{error}</div>
        )}
        <label>Kode Project
          <input
            type="text"
            value={kode}
            onChange={e => setKode(e.target.value)}
            placeholder={`Kosongkan untuk otomatis: ${nextKodePreview}`}
          />
        </label>
        <div className="muted" style={{ marginTop: '-8px', marginBottom: '6px', fontSize: '12px' }}>
          Pratinjau berikutnya: <b>{nextKodePreview}</b> (dihitung dari kode project terbesar yang sudah ada).
          {!duplicate && <span> Belum terpakai.</span>}
          {duplicate && <span style={{ color: 'var(--danger)' }}> ⚠️ Kode sudah dipakai — pilih kode lain.</span>}
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
        <label>Status awal (readonly)
          <input type="text" value="Not Start" readOnly aria-readonly="true" />
        </label>
        <div className="actions">
          <button type="button" className="outline" onClick={onClose}>Batal</button>
          <button disabled={saving}>{saving ? 'Menyimpan…' : 'Buat Project'}</button>
        </div>
      </form>
    </div>
  )
}
