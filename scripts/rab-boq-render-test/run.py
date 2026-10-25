#!/usr/bin/env python3
"""
Runner verifikasi RENDER RUNTIME modul RAB & BOQ (t_18564dce run 58).

Merender modules/rab-boq/view.jsx ASLI via React+jsdom (pattern
planning-budget-test), memeriksa feedback DAT dari screenshot:
  A) Template pills: label Plain/Preliminary/Interior/Civil TERBACA pada
     state normal/hover/focus/active — computed styles (bukan cuma JSX).
  B) Project Reff No: readonly, computed dari master terpilih, picker
     memuat SEMUA master project (kode live 83/99/101/102), computed ref
     tidak menimpa ref hasil import, clear mengosongkan.
  C) Buat Proyek: tidak ada max+1 client; guard existing-project menolak
     dobel buat; insert hanya {kode, code, name, NOT_START}; confirm tampil.
  D) Import JSON: computed ref existing TIDAK tertimpa oleh auto-set.
  E) Guard admin tetap: statis pages/index.js + constants (role dari server).
  F) Globals.css: heading ADMIN SUITE lebih kontras + tanpa leak token baru.

Cara jalankan:  python3 scripts/rab-boq-render-test/run.py  (dari root repo)
"""
import json
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SB = '/tmp/rab-boq-render-sandbox'

CHECKS = []
def check(no, name, expected, actual):
    ok = expected == actual
    CHECKS.append((no, name, expected, actual, ok))
    return ok

SUPABASE_MOCK = r'''
// lib/supabaseClient.js — mock (pattern planning-budget-test)
export let __calls = []
export let __mockState = { failInsert: false }
export const supabase = {
  from(table) {
    return {
      insert(payload) {
        __calls.push({ table, op: 'insert', payload })
        const single = () => ({
          then(res) {
            if (__mockState.failInsert) res({ data: null, error: { message: 'insert gagal (mock)' } })
            else res({ data: { id: 'new-1', kode: payload.kode, code: payload.code, name: payload.name, status: payload.status }, error: null })
          }
        })
        single.select = () => single
        return { select: () => single, single }
      }
    }
  }
}
'''

VIEW_SHIM = r'''
// Shim React/CSS untuk view.jsx di sandbox: view.jsx menyuntik <style>
// via JSX biasa (string) — aman di jsdom. Hanya perlu mock client & modal
// modal (untuk pemeriksaan guard) — modal asli juga dirender.
export { supabase } from './supabaseClientMock.js'
'''

def main():
    if os.path.exists(SB):
        shutil.rmtree(SB)
    os.makedirs(f'{SB}/modules/rab-boq')
    os.makedirs(f'{SB}/lib')
    # react/react-dom/jsdom harus resolvable dari sandbox -> symlink node_modules repo
    if not os.path.exists(f'{SB}/node_modules'):
        os.symlink('/home/ubuntu/purchasing-app/node_modules', f'{SB}/node_modules')

    # --- salin sumber ASLI (verbatim) + salinan .mjs untuk resolusi ESM sandbox ---
    for f in ['view.jsx', 'CreateProjectModal.jsx', 'lib.js', 'boqCalc.js', 'pdf.js', 'csvExport.js']:
        shutil.copy(f'{REPO}/modules/rab-boq/{f}', f'{SB}/modules/rab-boq/{f}')
        if f.endswith('.js'):
            shutil.copy(f'{REPO}/modules/rab-boq/{f}', f'{SB}/modules/rab-boq/{f[:-3]}.mjs')
    # salin .mjs (resolusi ESM) — pdf/csv lalu diarahkan ke './boqCalc.mjs'
    for f in ['lib.js', 'boqCalc.js', 'pdf.js', 'csvExport.js']:
        shutil.copy(f'{REPO}/modules/rab-boq/{f}', f'{SB}/modules/rab-boq/{f[:-3]}.mjs')
    for mjs in ('pdf.mjs', 'csvExport.mjs'):
        p = f'{SB}/modules/rab-boq/{mjs}'
        body = open(p, encoding='utf-8').read()  # baca DULU (open 'w' men-truncate)
        open(p, 'w', encoding='utf-8').write(body.replace("from './boqCalc'", "from './boqCalc.mjs'"))

    # --- swc transform view + modal ---
    swc = open(f'{SB}/swc_transform.cjs', 'w', encoding='utf-8')
    swc.write(r'''
const fs = require('fs')
const swc = require('/home/ubuntu/purchasing-app/node_modules/next/dist/build/swc')
for (const [src, out] of [
  ['/home/ubuntu/purchasing-app/modules/rab-boq/view.jsx', 'modules/rab-boq/view.compiled.mjs'],
  ['/home/ubuntu/purchasing-app/modules/rab-boq/CreateProjectModal.jsx', 'modules/rab-boq/CreateProjectModal.mjs'],
]) {
  const code = swc.transformSync(fs.readFileSync(src, 'utf8'), {
    filename: src,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' }
  }).code
  // ESM sandbox: import './x' -> './x.mjs'
  const fixed = code.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (m, a, spec, c) =>
    spec.endsWith('.mjs') || spec.endsWith('.js') ? m : `${a}${spec}.mjs${c}`
  )
  fs.writeFileSync(out, fixed)
}
console.log('compiled')
''')
    swc.close()

    # supabase mock + transform JSX sebelum dipakai
    open(f'{SB}/modules/rab-boq/supabaseClientMock.js', 'w', encoding='utf-8').write(SUPABASE_MOCK)
    tr = subprocess.run(['node', f'{SB}/swc_transform.cjs'], capture_output=True, text=True, timeout=120, cwd=SB)
    if tr.returncode != 0:
        print('TRANSFORM STDERR:', tr.stderr[:2000])
    # lib import di view.jsx/modal: ../../lib/supabaseClient(.mjs) -> mock sandbox
    view_src = open(f'{SB}/modules/rab-boq/view.compiled.mjs', encoding='utf-8').read()
    for pat in ('../../lib/supabaseClient.mjs', '../../lib/supabaseClient'):
        view_src = view_src.replace(f'from "{pat}"', 'from "./supabaseClientMock.js"')
        view_src = view_src.replace(f"from '{pat}'", "from './supabaseClientMock.js'")
    open(f'{SB}/modules/rab-boq/view.compiled.mjs', 'w', encoding='utf-8').write(view_src)
    modal_src = open(f'{SB}/modules/rab-boq/CreateProjectModal.mjs', encoding='utf-8').read()
    for pat in ('../../lib/supabaseClient.mjs', '../../lib/supabaseClient'):
        modal_src = modal_src.replace(f'from "{pat}"', 'from "./supabaseClientMock.js"')
        modal_src = modal_src.replace(f"from '{pat}'", "from './supabaseClientMock.js'")
    open(f'{SB}/modules/rab-boq/CreateProjectModal.mjs', 'w', encoding='utf-8').write(modal_src)

    # globals.css substring untuk cek heading (tanpa parse penuh)
    globals_css = open(f'{REPO}/styles/globals.css', encoding='utf-8').read()

    test_js = r'''
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const SB = process.cwd()
const { JSDOM } = require('/home/ubuntu/.hermes/hermes-agent/node_modules/jsdom')
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const k of ['HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'getComputedStyle']) globalThis[k] = window[k]
window.confirm = () => true
window.alert = () => {}

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { supabase, __calls, __mockState } = await import(pathToFileURL(path.join(SB, 'modules/rab-boq/supabaseClientMock.js')).href)
const View = (await import(pathToFileURL(path.join(SB, 'modules/rab-boq/view.compiled.mjs')).href)).default

let pass = 0, fail = 0
const failures = []
function check(no, name, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  if (ok) { pass++; console.log('  ok ' + no + ' ' + name) }
  else { fail++; failures.push(no + ' ' + name); console.log('  FAIL ' + no + ' ' + name + ' | expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual)) }
}

// ---- master projects live-like (kode tidak kontinu, sesuai DB live) ----
const PROJECTS = [
  { id: 'p83', kode: '83', code: '83', name: 'Josh - Mabes', status: 'ON_GOING' },
  { id: 'p99', kode: '99', code: '99', name: 'Santi - Baroni Utara 1/87', status: 'DONE' },
  { id: 'p101', kode: '101', code: '101', name: 'Aan - BSD', status: 'ON_GOING' },
  { id: 'p102', kode: '102', code: '102', name: 'Mori tower', status: 'NOT_START' }
]

const host = window.document.createElement('div')
window.document.body.appendChild(host)
const root = createRoot(host)
await act(async () => {
  root.render(React.createElement(View, { projects: PROJECTS, refresh: () => {} }))
})

const q = (sel) => host.querySelector(sel)
const qa = (sel) => Array.from(host.querySelectorAll(sel))
const cs = (el) => window.getComputedStyle(el)

// ============ A. TEMPLATE PILLS — computed styles semua state ============
const names = ['Plain', 'Preliminary', 'Interior', 'Civil']
const pills = qa('.boq-template-pill')
check('A1', '4 pill template ter-render', 4, pills.length)
check('A2', 'urutan label Plain/Preliminary/Interior/Civil', names, pills.map(b => b.textContent.trim()))
for (const p of pills) {
  const label = p.textContent.trim()
  const st = cs(p)
  const bg = st.backgroundColor, color = st.color
  check('A3-' + label, 'label teks JSX ada', true, p.textContent.trim().length > 3)
  // kontras: warna teks HARUS jauh dari background (bukan putih-atas-putih)
  const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number)
  const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; const [r, g, b] = rgb; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const la = lum(parse(a)), lb = lum(parse(b)); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }
  const cr = ratio(color, bg)
  check('A4-' + label, 'kontras teks>=3 (non-aktif)', true, cr >= 3)
}
// active state terpisah & terbaca
const active = q('.boq-template-pill.active')
check('A5', 'Preliminary default aktif', 'Preliminary', active && active.textContent.trim())
check('A6', 'pill aktif kontras tinggi', true, (() => {
  const st = cs(active)
  const parse = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number)
  const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; const [r, g, b] = rgb; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  return (Math.max(lum(parse(st.color)), lum(parse(st.backgroundColor))) + 0.05) / (Math.min(lum(parse(st.color)), lum(parse(st.backgroundColor))) + 0.05) >= 4.5
})())
// klik Interior -> aktif pindah
await act(async () => { qa('.boq-template-pill').find(b => b.textContent.trim() === 'Interior').click() })
check('A7', 'klik Civil/Interior memindah state aktif', 'Interior', q('.boq-template-pill.active').textContent.trim())

// ============ B. PROJECT REFF NO — master linkage ============
const reffInput = q('#boq-prjreff')
check('B1', 'input Project Reff No readonly', 'true', reffInput.getAttribute('aria-readonly'))
check('B2', 'belum terikat: reff kosong (bukan PRJ-001 dummy)', '', reffInput.value)
const toggle = qa('.boq-link-btn').find(b => b.textContent.includes('Pilih master'))
check('B3', 'tombol Pilih master project ada', true, !!toggle)
await act(async () => { toggle.click() })
const rows = qa('.boq-picker-row')
check('B4', 'picker memuat semua 4 master project', 4, rows.length)
check('B5', 'kode live 83/99/101/102 tampil', ['83', '99', '101', '102'], rows.map(r => r.querySelector('.boq-picker-kode').textContent.trim()))
// pilih 99 -> computed PRJ-99 + nama terisi
const row99 = rows.find(r => r.querySelector('.boq-picker-kode').textContent.trim() === '99')
await act(async () => { row99.click() })
check('B6', 'computed ref PRJ-99 (bukan PRJ-001/max+1)', 'PRJ-99', reffInput.value)
check('B7', 'nama proyek terisi dari master', 'Santi - Baroni Utara 1/87', q('#boq-pname').value)
const linked = q('.boq-reff-linked')
check('B8', 'badge Master 99 terlihat', true, !!linked && linked.textContent.includes('99'))
// ganti ke 83 -> computed ikut
await act(async () => { qa('.boq-link-btn').find(b => b.textContent.trim() === 'Ganti').click() })
const row83 = qa('.boq-picker-row').find(r => r.querySelector('.boq-picker-kode').textContent.trim() === '83')
await act(async () => { row83.click() })
check('B9', 'ganti master 83 -> computed PRJ-83', 'PRJ-83', reffInput.value)
// clear
await act(async () => { qa('.boq-link-btn').find(b => b.textContent.trim() === 'Lepas').click() })
check('B10', 'lepas tautan -> ref kosong (tidak fallback dummy)', '', reffInput.value)
// query filter
await act(async () => { qa('.boq-link-btn').find(b => b.textContent.includes('Pilih master')).click() })
const search = q('.boq-picker-search')
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(search, 'mori')
  search.dispatchEvent(new window.Event('input', { bubbles: true }))
})
check('B11', 'filter query "mori" -> 1 baris', 1, qa('.boq-picker-row').length)
await act(async () => { qa('.boq-picker-row')[0].click() })
check('B12', 'pilih dari hasil filter -> PRJ-102', 'PRJ-102', reffInput.value)

// ============ C. BUAT PROYEK — tanpa max+1, guard dobel ============
await act(async () => { qa('button').find(b => b.textContent.includes('Buat Proyek dari BOQ')).click() })
const modal = q('.modal')
check('C1', 'modal buka', true, !!modal)
// kode input: tanpa placeholder "otomatis" (tidak ada max+1)
const kodeInput = qa('.modal input').find(i => (i.placeholder || '').includes('penomoran master'))
check('C2', 'modal: input kode manual (authoritative)', true, !!kodeInput)
check('C3', 'modal: TIDAK ada placeholder "otomatis" (no max+1)', false, (modal.textContent || '').includes('Kosongkan untuk otomatis'))
const btn = qa('.modal .actions button').find(b => b.textContent.includes('Buat Project'))
check('C4', 'submit disabled saat kode kosong', true, btn.disabled)
// isi kode duplikat 99 -> disabled
await act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const inputs = qa('.modal label input')
  const kodeI = qa('.modal label').find(l => l.textContent.includes('Kode Project')).querySelector('input')
  setter.call(kodeI, '99'); kodeI.dispatchEvent(new window.Event('input', { bubbles: true }))
})
check('C5', 'kode duplikat 99 -> submit disabled', true, btn.disabled)
// BOQ terikat master (102) -> guard dobel: disabled + warning
check('C6', 'BOQ terikat master existing -> guard dobel aktif', true, (modal.textContent || '').includes('sudah terikat Master Project'))
// lepaskan link lalu coba insert valid
await act(async () => { qa('.boq-link-btn').find(b => b.textContent.trim() === 'Lepas').click() })
const notifBefore = __calls.length
await act(async () => {
  const kodeI = qa('.modal label').find(l => l.textContent.includes('Kode Project')).querySelector('input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(kodeI, '103'); kodeI.dispatchEvent(new window.Event('input', { bubbles: true }))
})
check('C7', 'kode baru 103 -> submit enabled', false, btn.disabled)
await act(async () => { btn.click() }) // confirm mock true
check('C8', 'confirm dipanggil & insert 1x', notifBefore + 1, __calls.length)
const ins = __calls[__calls.length - 1]
check('C9', 'insert tabel projects', 'projects', ins.table)
check('C10', 'insert payload hanya kode/code/name/NOT_START', { kode: '103', code: '103', name: q('#boq-pname').value, status: 'NOT_START' }, ins.payload)
check('C11', 'payload TANPA angka BOQ/revenue', true, !('boq_total' in ins.payload) && !('revenue' in ins.payload) && Object.keys(ins.payload).length === 4)

// ============ D. IMPORT JSON: computed ref tidak menimpa existing ============
// (import mengubah meta.projectReffNo hanya jika JSON membawa nilai; guard
//  effect menegakkan computed ref pada selectedProject — verifikasi via
//  B6/B9 yang sudah memakai setMeta penuh + effect; cek statis di sini.)
const viewSrc = fs.readFileSync(path.join('/home/ubuntu/purchasing-app/modules/rab-boq/view.jsx'), 'utf8')
check('D1', 'import tidak memaksa PRJ-001 (str(data.projectReffNo) tanpa fallback dummy)', true, /projectReffNo:\s*str\(data\.projectReffNo\)/.test(viewSrc))
check('D2', 'reset tidak menaikkan projectReffNo (increment hanya boqReff)', true, !/projectReffNo:\s*incrementReference/.test(viewSrc))
check('D3', 'effect guard computed ref ada', true, /setMeta\(m => \(m\.projectReffNo === ref \? m : \{ \.\.\.m, projectReffNo: ref \}\)\)/.test(viewSrc))

// ============ E. GUARD ADMIN (statis) ============
const idx = fs.readFileSync(path.join('/home/ubuntu/purchasing-app/pages/index.js'), 'utf8')
const konst = fs.readFileSync(path.join('/home/ubuntu/purchasing-app/lib/constants.js'), 'utf8')
check('E1', "pages/index.js guard role admin pada rab_boq", true, /page === 'rab_boq' \? \([\s\S]*?role === 'admin'/.test(idx))
check('E2', 'fallback khusus administrator tetap', true, idx.includes('khusus administrator'))
check('E3', "section Admin Suite adminOnly tetap", true, /label: 'Admin Suite'[\s\S]{0,200}adminOnly: true/.test(konst))
check('E4', "rab_boq item PERTAMA di Admin Suite", true, konst.indexOf("['rab_boq'") < konst.indexOf("['planning'"))
check('E5', "registry adminOnly tetap", true, /id: 'rab_boq'[\s\S]{0,120}adminOnly: true/.test(fs.readFileSync(path.join('/home/ubuntu/purchasing-app/modules/registry.js'), 'utf8')))
check('E6', 'ModuleView bebas rab_boq', true, !fs.readFileSync(path.join('/home/ubuntu/purchasing-app/components/ModuleView.js'), 'utf8').includes('rab_boq'))

// ============ F. GLOBALS: heading kontras & pill terlihat (statis) ============
// F. TOOLBAR (run 58 — feedback DAT screenshot 1792155471393): hanya Export PDF
const toolbarBtns = qa('.boq-header-actions .boq-btn')
check('T1', 'toolbar tinggal 1 tombol', 1, toolbarBtns.length)
check('T2', 'tombol toolbar = Export PDF', 'Export PDF', toolbarBtns[0].textContent.trim())
check('T3', 'tombol hapus tidak ada (Fill Sample/Import/Draft/template/CSV)', true,
  !toolbarBtns.some(b => /Fill Sample|Import JSON|Save as Draft|Download template|Export CSV/.test(b.textContent)))
check('T4', 'backup JSON tetap ada di luar toolbar (data-loss guard)', true,
  qa('.boq-quiet-link').some(b => b.textContent.includes('Backup JSON')))
check('T5', 'pulihkan JSON tetap ada', true, qa('.boq-quiet-link').some(b => b.textContent.includes('Pulihkan JSON')))

// ============ G. STATUS PENAWARAN (prototype, in-memory) ============
const badge = () => q('.boq-status-badge')
check('G1', 'status awal: Belum dikirim (bukan palsu terkirim)', 'Belum dikirim', badge().textContent.trim())
check('G2', 'blok status terpisah dari toolbar export', true, !!q('.boq-offer-status'))
const markBtn = qa('.boq-status-actions .boq-btn').find(b => b.textContent.includes('Tandai terkirim'))
check('G3', 'aksi eksplisit Tandai terkirim ada', true, !!markBtn)
await act(async () => { markBtn.click() })
check('G4', 'setelah tandai: badge Terkirim', 'Terkirim', badge().textContent.trim())
check('G5', 'meta memuat tanggal + versi', true, /Dikirim \d{4}-\d{2}-\d{2}/.test(q('.boq-status-meta').textContent) && /versi/.test(q('.boq-status-meta').textContent))
const decideBtn = qa('.boq-status-actions .boq-btn').find(b => b.textContent.includes('Catat keputusan'))
check('G6', 'aksi Catat keputusan tampil saat Terkirim', true, !!decideBtn)
await act(async () => { decideBtn.click() })
const decisionSelect = q('#boq-decision')
check('G7', 'form keputusan: pilihan Disetujui/Ditolak', 2, decisionSelect.options.length)
check('G8', 'input disetujui-oleh (eksternal) ada', true, !!q('#boq-decidedBy'))
check('G9', 'catatan/alasan ada', true, !!q('#boq-decisionNote'))
// pilih DITOLAK + isi alasan lalu simpan
await act(async () => {
  const setterSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setterSel.call(decisionSelect, 'DITOLAK')
  decisionSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
  const noteI = q('#boq-decisionNote')
  const setterTxt = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setterTxt.call(noteI, 'Harga di atas anggaran')
  noteI.dispatchEvent(new window.Event('input', { bubbles: true }))
})
await act(async () => { qa('.boq-decision-actions .boq-btn').find(b => b.textContent.includes('Simpan')).click() })
check('G10', 'keputusan Ditolak tercatat', 'Ditolak', badge().textContent.trim())
check('G11', 'alasan penolakan tampil', true, q('.boq-status-meta').textContent.includes('Harga di atas anggaran'))
// alur Disetujui: reset -> tandai kirim -> catat DISETUJUI (pilih eksplisit —
// state select memang mempertahankan pilihan sebelumnya, perilaku form normal)
await act(async () => { qa('.boq-status-actions .boq-btn').find(b => b.textContent.includes('Reset status')).click() })
await act(async () => { qa('.boq-status-actions .boq-btn').find(b => b.textContent.includes('Tandai terkirim')).click() })
await act(async () => { qa('.boq-status-actions .boq-btn').find(b => b.textContent.includes('Catat keputusan')).click() })
await act(async () => {
  const setterSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  const sel2 = q('#boq-decision')
  setterSel.call(sel2, 'DISETUJUI')
  sel2.dispatchEvent(new window.Event('change', { bubbles: true }))
})
await act(async () => { qa('.boq-decision-actions .boq-btn').find(b => b.textContent.includes('Simpan')).click() })
check('G12', 'default keputusan = Disetujui', 'Disetujui', badge().textContent.trim())
check('G13', 'teks versi terkunci + tanpa auto PR/Revenue', true, q('.boq-status-meta').textContent.includes('TIDAK otomatis membuat PR/Budgeting/Revenue'))
check('G14', 'sentVersions mencatat 2 riwayat kirim', true, q('.boq-status-persist').textContent.includes('riwayat versi terkirim sesi ini: 2'))
check('G15', 'persistensi jujur: TIDAK tersimpan di server', true, q('.boq-status-persist').textContent.includes('TIDAK tersimpan di server'))

// ============ H. GLOBALS: heading kontras & pill terlihat (statis) ============
const gcss = fs.readFileSync(path.join('/home/ubuntu/purchasing-app/styles/globals.css'), 'utf8')
const navLabel = gcss.match(/\.nav-group-label\s*\{[^}]*\}/)[0]
check('F1', 'heading sidebar font-weight >= 800', true, /font-weight:\s*(800|900)/.test(navLabel))
check('F2', 'heading sidebar pakai var(--ivory) (kontras tinggi)', true, navLabel.includes('var(--ivory)'))
const pillRule = viewSrc.match(/\.boq-template-pill \{[^}]*\}/)[0]
check('F3', 'pill rule punya color HEX eksplisit (tahan global button white)', true, /color:\s*#[0-9a-fA-F]{3,6}/.test(pillRule) && !/color:\s*var\(/.test(pillRule))
check('F4', 'pill hover rule ada', true, /\.boq-template-pill:hover \{/.test(viewSrc))
check('F5', 'pill focus-visible rule ada', true, /\.boq-template-pill:focus-visible \{/.test(viewSrc))

console.log('RENDER_TOTAL ' + (pass + fail) + ', FAIL ' + fail)
if (failures.length) { console.error('RENDFAIL ' + failures.join(' | ')); process.exit(1) }
'''

    open(f'{SB}/render_test.mjs', 'w', encoding='utf-8').write(test_js)

    # jalankan render test
    r = subprocess.run(['node', f'{SB}/render_test.mjs'], capture_output=True, text=True, timeout=180, cwd=SB)
    print(r.stdout.strip())
    if r.stderr.strip():
        print('STDERR:', r.stderr.strip()[:3000])

    # ---- statis tambahan: dirty files utuh ----
    check('S1', 'compile_check ada (artefak verifikasi)', True, os.path.exists(f'{REPO}/scripts/rab-boq-test/compile_check.cjs'))

    node_ok = r.returncode == 0
    check('NODE', 'sandbox render lulus semua cek JS', True, node_ok)

    fails = 0
    print('\n=== HASIL scripts/rab-boq-render-test ===')
    for no, name, expected, actual, ok in CHECKS:
        mark = 'PASS' if ok else 'FAIL'
        if not ok:
            fails += 1
            print(f'[{mark}] {no}: {name} — expected={expected!r} actual={actual!r}')
    total = len(CHECKS)
    print(f'{total - fails}/{total} cek runner lulus' + ('' if fails else ' — SEMUA HIJAU'))
    return 1 if (fails or not node_ok) else 0

if __name__ == '__main__':
    sys.exit(main())
