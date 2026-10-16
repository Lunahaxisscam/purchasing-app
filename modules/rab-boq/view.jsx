// ============================================================
// modules/rab-boq/view.jsx — MODUL RAB & BOQ (Admin Suite, admin-only)
// ============================================================
// Port UI dari source DAT perhitungan-rab-otomatis-2.html (1570 baris,
// payload version 5). Fungsi dijaga 1:1; state DOM source jadi state React.
// Perbedaan yang disengaja (dokumentasi di README modul):
//   1. Semua class CSS di-prefix `boq-` + scoped di blok <style> komponen
//      (tanpa override global app) — warna memakai design token olive app.
//   2. PERSISTENCE: source murni client-only (tanpa localStorage/server).
//      Perilaku dipertahankan: data hidup selama tab terbuka; keluar =
//      hilang. Backup = Save as Draft (JSON) -> Import JSON. TIDAK ada
//      "save" ke server supaya tidak fake-persistent (arahan task).
//   3. Tambahan admin-only: tombol "Buat Proyek dari BOQ" (modal terpisah
//      CreateProjectModal.jsx) — explicit confirm, hanya insert Master
//      Project {kode, name, NOT_START}, TANPA link ke PR/Budget/Revenue.
//   4. Import JSON diberi sanitizer + limit (boqCalc.js) di atas perilaku
//      source (XSS/limits/type validation).
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  num, calcCostArea, calcCostPart, calcItem, breakdownTotal, calcTotals,
  thousand, rupiahFromK, normalizeItem, defaultBreakdown,
  IMPORT_MAX_BYTES, sanitizeItems, sanitizeNotes, sanitizeTemplateChoices, sanitizeChoice
} from './boqCalc'
import {
  blankItem, plainChoiceSeed, standardNoteSeed, templates,
  buildTemplateChoiceSeed, TEMPLATE_NAMES, itemOptionsFor, masterProjectReff,
  incrementReference, todayJakarta
} from './lib'
import { buildBoqPdf, downloadBlob } from './pdf'
import { buildBoqCsv } from './csvExport'
import CreateProjectModal from './CreateProjectModal'

const clone = (v) => JSON.parse(JSON.stringify(v))

function initialMeta() {
  return {
    boqReff: 'BOQ-001',
    projectReffNo: '',
    revisionNumber: 'REV00',
    projectName: 'New project',
    clientName: '',
    projectLocation: '',
    estimateDate: todayJakarta(),
    marginMode: 'markup',
    marginRate: 20,
    discountType: 'percent',
    adjustmentEnabled: true,
    taxEnabled: true,
    taxRate: 11,
    showAdjustmentPdf: true
  }
}

export default function BoqModule({ projects = [], refresh }) {
  const [meta, setMeta] = useState(initialMeta)
  const [items, setItems] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('Preliminary')
  // t_18564dce run 58 (feedback DAT screenshot 1792153939917): Project Reff No
  // terikat ke Master Project — pilih dari master, JANGAN free text/dummy.
  const [selectedProject, setSelectedProject] = useState(null)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [projectQuery, setProjectQuery] = useState('')
  // ===== Status penawaran (run 58 — feedback DAT): PROTOTYPE in-memory.
  // Persist butuh dukungan DB — freeze migrasi; usulan spec minimal ada di
  // README modul. Tidak ada klaim tersimpan/autosave; ekspor PDF BUKAN bukti
  // terkirim — status 'TERKIRIM' hanya dicatat admin setelah pengiriman nyata.
  const [offerStatus, setOfferStatus] = useState({ status: 'DRAFT' })
  const [sentVersions, setSentVersions] = useState([])
  const [showDecisionForm, setShowDecisionForm] = useState(false)
  const [decisionResult, setDecisionResult] = useState('DISETUJUI')
  const [decisionBy, setDecisionBy] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [templateChoices, setTemplateChoices] = useState(() => buildTemplateChoiceSeed())
  const [plainChoices, setPlainChoices] = useState(() => buildTemplateChoiceSeed()['Preliminary'])
  const [plainAdding, setPlainAdding] = useState(false)
  const [newChoiceName, setNewChoiceName] = useState('')
  const [customChoiceCounter, setCustomChoiceCounter] = useState(0)
  const [noteOptions, setNoteOptions] = useState(() => standardNoteSeed.slice())
  const [activeNotes, setActiveNotes] = useState([])
  const [noteAdding, setNoteAdding] = useState(false)
  const [customNote, setCustomNote] = useState('')
  const [selectedNote, setSelectedNote] = useState('')
  const [toast, setToast] = useState('')
  const [projectModal, setProjectModal] = useState(false)
  const toastTimer = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  function showToast(message) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  const setMetaField = (key, value) => setMeta(m => ({ ...m, [key]: value }))

  const totals = useMemo(() => calcTotals({
    items, marginMode: meta.marginMode, marginRate: meta.marginRate,
    discountType: meta.discountType, adjustmentEnabled: meta.adjustmentEnabled,
    taxEnabled: meta.taxEnabled, taxRate: meta.taxRate
  }), [items, meta])

  // updateTotals source line 874-895: label profit + disabled state input.
  const profitName = totals.mode === 'gross' ? 'Gross margin' : (totals.mode === 'discount' ? 'Discount' : 'Markup')
  const hasTypeChoice = totals.mode !== 'gross'
  const isNominal = hasTypeChoice && totals.adjustmentType === 'nominal'

  const availableItems = useMemo(() => itemOptionsFor({ selectedTemplate, plainChoices, items }), [selectedTemplate, plainChoices, items])
  const availableNotes = noteOptions.filter(n => activeNotes.indexOf(n) < 0)

  function getPayload() {
    return {
      version: 5,
      priceUnit: 'thousand IDR (000)',
      boqReff: meta.boqReff,
      projectReffNo: meta.projectReffNo,
      revisionNumber: meta.revisionNumber,
      projectName: meta.projectName,
      clientName: meta.clientName,
      projectLocation: meta.projectLocation,
      estimateDate: meta.estimateDate,
      marginMode: meta.marginMode,
      marginRate: num(meta.marginRate),
      discountType: meta.discountType,
      adjustmentEnabled: meta.adjustmentEnabled,
      taxEnabled: meta.taxEnabled,
      taxRate: num(meta.taxRate),
      showAdjustmentPdf: meta.showAdjustmentPdf,
      selectedTemplate: selectedTemplate,
      noteOptions: clone(noteOptions),
      activeNotes: clone(activeNotes),
      templateChoices: clone(templateChoices),
      items: clone(items),
      // run 58: status penawaran prototype ikut di-backup agar pulih JSON
      // tidak kehilangan catatan TERKIRIM/DISETUJUI/DITOLAK sesi itu.
      offerStatus: offerStatus
    }
  }

  function applyTemplate(name) {
    // source applyTemplate line 897-905: items TIDAK dihapus saat ganti template.
    setSelectedTemplate(name)
    setPlainAdding(false)
    setPlainChoices(templateChoices[name] || [])
    showToast(name === 'Plain'
      ? 'Plain mode selected; existing BOQ items were kept'
      : (name === 'Interior'
        ? 'Interior items are available in the ITEM dropdown'
        : `Work item choices for “${name}” are now displayed`))
  }

  function pickProject(p) {
    setSelectedProject(p)
    setProjectQuery('')
    setShowProjectPicker(false)
    setMeta(m => ({
      ...m,
      projectReffNo: masterProjectReff(p),
      projectName: (p && p.name) || m.projectName
    }))
    showToast(`Linked to Master Project ${(p && (p.kode ?? p.code)) || ''} — ${(p && p.name) || ''}`)
  }
  function clearProjectLink() {
    setSelectedProject(null)
    setShowProjectPicker(false)
    setMeta(m => ({ ...m, projectReffNo: '' }))
    showToast('Project link cleared')
  }
  const filteredProjects = (projects || []).filter(p => {
    if (!projectQuery.trim()) return true
    const q = projectQuery.trim().toLowerCase()
    return String(p.name || '').toLowerCase().includes(q) ||
      String(p.kode ?? p.code ?? '').toLowerCase().includes(q)
  })
  const projectReffComputed = selectedProject ? masterProjectReff(selectedProject) : ''
  // Guard: ref yang tampil SELALU hasil compute dari master terpilih.
  useEffect(() => {
    if (selectedProject) {
      const ref = masterProjectReff(selectedProject)
      setMeta(m => (m.projectReffNo === ref ? m : { ...m, projectReffNo: ref }))
    }
  }, [selectedProject, projects])

  // ----- status penawaran handlers (run 58 — feedback DAT) -----
  // Versi = snapshot titik kirim (kecil, in-memory): revision + BOQ reff +
  // total quotation saat 'Tandai terkirim'. Disetujui mengunci versi tsb;
  // riwayat kirim terpisah dari meta sehingga revisi lanjut tidak menimpanya.
  function markSent() {
    const t = calcTotals({
      items,
      marginMode: meta.marginMode,
      marginRate: meta.marginRate,
      discountType: meta.discountType,
      adjustmentEnabled: meta.adjustmentEnabled,
      taxEnabled: meta.taxEnabled,
      taxRate: meta.taxRate
    })
    const version = {
      revision: meta.revisionNumber || 'REV00',
      boqReff: meta.boqReff,
      grand: rupiahFromK(t.grand),
      sentAt: todayJakarta(),
      sentBy: (typeof session !== 'undefined' && session?.user?.email) || 'admin'
    }
    setOfferStatus({ status: 'TERKIRIM', ...version, version })
    setSentVersions(prev => [...prev, version])
    setShowDecisionForm(false)
    showToast(`Tercatat TERKIRIM versi ${version.revision} (${version.sentAt}) — pastikan penawaran sudah benar-benar dikirim ke klien`)
  }
  function backToDraft() {
    setOfferStatus({ status: 'DRAFT' })
    setShowDecisionForm(false)
    setDecisionNote('')
    setDecisionBy('')
    showToast('Status kembali ke draft (prototype in-memory)')
  }
  function saveDecision() {
    const result = decisionResult === 'DITOLAK' ? 'DITOLAK' : 'DISETUJUI'
    setOfferStatus(s => ({
      ...s,
      status: result,
      decidedAt: todayJakarta(),
      decidedBy: decisionBy.trim().slice(0, 200),
      note: decisionNote.trim().slice(0, 2000),
      version: s.version || null
    }))
    setShowDecisionForm(false)
    showToast(result === 'DISETUJUI'
      ? 'Disetujui tercatat — versi terkunci (riwayat versi terkirim tidak ditimpa; tidak auto PR/Revenue)'
      : 'Ditolak tercatat — buat revisi/versi baru lalu kirim ulang')
  }

  // ----- item handlers (source body listeners line 1222-1286) -----
  function updateItemField(index, key, value) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [key]: ['qty', 'price'].indexOf(key) >= 0 ? num(value) : value } : it))
  }
  function updateCostField(itemIndex, partIndex, key, value) {
    setItems(prev => prev.map((it, i) => {
      if (i !== itemIndex) return it
      const breakdown = it.breakdown.map((p, j) => j === partIndex ? { ...p, [key]: key === 'name' ? value : num(value) } : p)
      return { ...it, breakdown }
    }))
  }
  function onItemSelect(index, value) {
    if (value === '__manual__') {
      setItems(prev => prev.map((it, i) => i === index ? { ...it, manualItem: true, item: '' } : it))
    } else {
      setItems(prev => prev.map((it, i) => i === index ? { ...it, manualItem: false, item: value } : it))
    }
  }
  function toggleBreakdown(index) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, breakdownOpen: !it.breakdownOpen } : it))
  }
  function addCostComponent(index) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, breakdown: [...it.breakdown, { name: 'New component', length: 1, width: 1, qty: 1, unitPrice: 0 }] } : it))
  }
  function removeCostComponent(index, partIndex) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, breakdown: it.breakdown.filter((_, j) => j !== partIndex) } : it))
  }
  function deleteItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }
  function addItem() {
    setItems(prev => [...prev, normalizeItem(clone(blankItem))])
  }
  function duplicateLast() {
    // source duplicateBtn line 1386-1395
    if (!items.length) { showToast('There are no items to duplicate'); return }
    const copy = clone(items[items.length - 1])
    delete copy.choiceId
    copy.item = copy.item ? copy.item + ' (copy)' : 'Item copy'
    copy.breakdownOpen = false
    setItems(prev => [...prev, copy])
    showToast('The last item was duplicated')
  }

  // ----- plain choices (source line 1291-1332) -----
  function togglePlainChoice(choiceId, checked) {
    const choice = plainChoices.find(c => c.id === choiceId)
    if (!choice) return
    if (checked) {
      const item = normalizeItem({ item: choice.name, area: selectedTemplate, specs: choice.specs || '', qty: 1, unit: choice.unit || 'ls', price: 0, choiceId: choice.id })
      setItems(prev => [...prev, item])
    } else {
      setItems(prev => prev.filter(it => it.choiceId !== choiceId))
    }
  }
  function addCustomChoice() {
    const name = (newChoiceName || '').trim()
    if (!name) { showToast('Enter an item name first'); return }
    const nextCounter = customChoiceCounter + 1
    setCustomChoiceCounter(nextCounter)
    setPlainChoices(prev => [...prev, { id: 'custom-' + selectedTemplate.toLowerCase() + '-' + nextCounter, name, unit: 'unit' }])
    setPlainAdding(false)
    setNewChoiceName('')
    showToast('Custom item added to the choices')
  }

  // ----- notes (source line 1333-1366) -----
  function addSelectedNote() {
    if (!selectedNote) { showToast('Choose Notes wording first'); return }
    if (activeNotes.indexOf(selectedNote) < 0) setActiveNotes(prev => [...prev, selectedNote])
    showToast('Wording added to Notes')
  }
  function addCustomNote() {
    const note = (customNote || '').trim()
    if (!note) { showToast('Enter Notes wording first'); return }
    if (noteOptions.indexOf(note) < 0) setNoteOptions(prev => [...prev, note])
    if (activeNotes.indexOf(note) < 0) setActiveNotes(prev => [...prev, note])
    setNoteAdding(false)
    setCustomNote('')
    showToast('Custom wording saved and selected')
  }
  function removeNote(index) {
    setActiveNotes(prev => prev.filter((_, i) => i !== index))
  }

  // ----- sample data (source line 1396-1428) -----
  function fillSampleData() {
    const seed = buildTemplateChoiceSeed()
    setSelectedTemplate('Plain')
    setTemplateChoices(seed)
    setPlainChoices(seed['Plain'])
    setPlainAdding(false)
    setNoteOptions(standardNoteSeed.slice())
    setActiveNotes([standardNoteSeed[2], standardNoteSeed[3], standardNoteSeed[5]])
    setNoteAdding(false)
    setItems([
      normalizeItem({ item: 'Mobilization and cleaning', area: 'All Area', specs: 'Work area protection and final cleaning', qty: 1, unit: 'ls', price: 3500, breakdown: [{ name: 'Labor', length: 1, width: 1, qty: 2, unitPrice: 1000 }, { name: 'Protective materials', length: 1, width: 1, qty: 3, unitPrice: 500 }] }),
      normalizeItem({ item: 'Upper cabinet', area: 'Pantry', specs: '18 mm plywood, HPL finish, PVC edging', qty: 4.2, unit: 'm¹', price: 2750, breakdown: [] }),
      normalizeItem({ item: 'Countertop', area: 'Pantry', specs: '12 mm solid surface, neutral color', qty: 1, unit: 'ls', price: 3132, breakdown: [{ name: 'Material solid surface', length: 3.6, width: 0.6, qty: 1, unitPrice: 1100 }, { name: 'Fabrication & installation', length: 3.6, width: 0.6, qty: 1, unitPrice: 350 }] }),
      normalizeItem({ item: 'Hardware', area: 'Pantry', specs: 'Soft-close hinges and runners', qty: 1, unit: 'set', price: 7800, breakdown: [] }),
      normalizeItem({ item: 'Delivery & installation', area: 'Jakarta Selatan', specs: 'Delivery, handling, and installation', qty: 1, unit: 'ls', price: 4500, breakdown: [] })
    ])
    setMeta(m => ({
      ...m,
      clientName: 'PT Cakrawala Kreatif',
      projectLocation: 'Jakarta Selatan',
      projectName: 'Interior Pantry & Storage Office',
      revisionNumber: 'Rev 001',
      estimateDate: todayJakarta(),
      marginMode: 'markup',
      marginRate: 20,
      discountType: 'percent',
      adjustmentEnabled: true,
      taxEnabled: true,
      taxRate: 11,
      showAdjustmentPdf: true
    }))
    showToast('Sample data is ready for simulation and PDF export')
  }

  // ----- reset (source line 1429-1451) — nomor reff naik, data kosong -----
  function resetAll() {
    setSelectedTemplate('Plain')
    setItems([])
    const seed = buildTemplateChoiceSeed()
    setTemplateChoices(seed)
    setPlainChoices(seed['Plain'])
    setPlainAdding(false)
    setNoteOptions(standardNoteSeed.slice())
    setActiveNotes([])
    setNoteAdding(false)
    setMeta(m => ({
      ...m,
      boqReff: incrementReference(m.boqReff, 'BOQ-001'),
      revisionNumber: 'REV00',
      projectName: 'New project',
      clientName: '',
      projectLocation: '',
      adjustmentEnabled: true,
      showAdjustmentPdf: true
    }))
    showToast('Breakdown and project data cleared')
  }

  // ----- draft/template/CSV/PDF (source line 1452-1543 + 944) -----
  function saveDraft() {
    const payload = getPayload()
    downloadBlob(JSON.stringify(payload, null, 2), 'application/json', safeName(payload.projectName) + '-draft.json')
    showToast('Draft downloaded. Keep the JSON file to continue later')
  }
  function saveTemplate() {
    const payload = getPayload()
    downloadBlob(JSON.stringify(payload, null, 2), 'application/json', safeName(payload.projectName) + '-template.json')
    showToast('JSON template downloaded')
  }
  function safeName(name) {
    return (name || 'rab').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'rab'
  }
  function exportCsv() {
    const payload = getPayload()
    const csv = buildBoqCsv(payload, items)
    downloadBlob(csv, 'text/csv;charset=utf-8', safeName(payload.projectName) + '.csv')
    showToast('BOQ exported to CSV')
  }
  function exportPdf() {
    try {
      const payload = getPayload()
      const bytes = buildBoqPdf(payload, items)
      downloadBlob(bytes, 'application/pdf', safeName(payload.projectName) + '-boq.pdf')
      showToast('A4 BOQ PDF created successfully')
    } catch (error) {
      showToast('The PDF could not be created. Check the data and try again.')
    }
  }

  // ----- import (source line 1462-1514) + sanitizer boqCalc -----
  function onImportFile(e) {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    if (file.size > IMPORT_MAX_BYTES) {
      showToast(`File terlalu besar (maks ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB)`)
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        if (!Array.isArray(data.items)) throw new Error('Item format not found')
        const sanitizedItems = sanitizeItems(data.items).map(entry => {
          const normalized = normalizeItem(entry)
          if (data.version === 1) normalized.price = num(entry.price) / 1000
          return normalized
        })
        setItems(sanitizedItems)
        setTemplateChoices(sanitizeTemplateChoices(data.templateChoices))
        const tpl = TEMPLATE_NAMES.indexOf(data.selectedTemplate) >= 0 ? data.selectedTemplate : 'Plain'
        setSelectedTemplate(tpl)
        setPlainChoices(sanitizeTemplateChoices(data.templateChoices)[tpl])
        // noteOptions: seed dulu, tambahkan opsi dari file (source line 1484-1487)
        const opts = standardNoteSeed.slice()
        sanitizeNotes(data.noteOptions).forEach(note => { if (opts.indexOf(note) < 0) opts.push(note) })
        setNoteOptions(opts)
        const actives = sanitizeNotes(data.activeNotes)
        actives.forEach(note => { if (opts.indexOf(note) < 0) opts.push(note) })
        setNoteOptions(opts)
        setActiveNotes(actives)
        setNoteAdding(false)
        // run 58: pulihkan status penawaran prototype (hanya nilai enum yang
        // dikenal; tidak pernah menganggap TERKIRIM/DISETUJUI bila file rusak).
        const os = data.offerStatus
        const osStatus = os && ['DRAFT', 'TERKIRIM', 'DISETUJUI', 'DITOLAK'].indexOf(os.status) >= 0 ? os.status : 'DRAFT'
        setOfferStatus(osStatus === 'DRAFT'
          ? { status: 'DRAFT' }
          : { status: osStatus, sentAt: str(os.sentAt), sentBy: str(os.sentBy), decidedAt: str(os.decidedAt), decidedBy: str(os.decidedBy), note: str(os.note), version: os.version || null })
        setMeta(m => ({
          ...m,
          boqReff: str(data.boqReff) || 'BOQ-001',
          revisionNumber: str(data.revisionNumber) || 'REV00',
          projectName: str(data.projectName) || 'New project',
          projectReffNo: str(data.projectReffNo),
          clientName: str(data.clientName),
          projectLocation: str(data.projectLocation),
          estimateDate: str(data.estimateDate),
          marginMode: ['markup', 'gross', 'discount'].indexOf(data.marginMode) >= 0 ? data.marginMode : 'markup',
          marginRate: num(data.marginRate),
          discountType: data.discountType === 'nominal' ? 'nominal' : 'percent',
          adjustmentEnabled: data.adjustmentEnabled !== false,
          taxEnabled: data.taxEnabled !== false,
          taxRate: num(data.taxRate),
          showAdjustmentPdf: data.showAdjustmentPdf !== false
        }))
        showToast('Template imported successfully')
      } catch (error) {
        showToast('The file is not a valid BOQ template')
      }
      e.target.value = ''
    }
    reader.readAsText(file)
  }
  const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : '')

  // ----- margin control handlers (source line 1371-1385) -----
  function onDiscountTypeChange(value) {
    setMeta(m => {
      const next = { ...m, discountType: value }
      if (value === 'nominal' && num(m.marginRate) <= 99) next.marginRate = 0
      if (value === 'percent' && num(m.marginRate) > 99) next.marginRate = 20
      return next
    })
  }
  function onMarginModeChange(value) {
    setMeta(m => {
      const next = { ...m, marginMode: value }
      if (value === 'gross' && num(m.marginRate) > 99) next.marginRate = 20
      return next
    })
  }

  const plainPanelVisible = selectedTemplate && selectedTemplate !== 'Plain' && selectedTemplate !== 'Interior'

  return (
    <div className="boq-root">
      <style>{boqScopedCss}</style>

      {/* ===== Toolbar (run 58 — feedback DAT screenshot 1792155471393): hanya
    Export PDF. Tombol Fill Sample Data / Import JSON / Save as Draft /
    Download template / Export CSV DIHAPUS dari toolbar beserta helper-nya.
    DATA-LOSS RISIKO dijelaskan eksplisit di bawah (tidak ada autosave/server);
    backup JSON masih mungkin via tautan kecil di baris status (bukan toolbar)
    agar tombol toolbar bersih sesuai arahan DAT tanpa memutus jalur pemulihan. ===== */}
      <div className="boq-utility">
        <div className="boq-utility-copy">
          <strong>Quotation sheet</strong>
          <span>Build your BOQ and calculate costs on one page.</span>
        </div>
        <div className="boq-header-tools">
          <div className="boq-header-actions">
            <button type="button" className="boq-btn boq-btn-primary" onClick={exportPdf}>Export PDF</button>
          </div>
        </div>
      </div>

      {/* ===== Status penawaran (run 58 — feedback DAT): alur bisnis
          Belum dikirim -> Terkirim -> Disetujui/Ditolak. EXPORT PDF BUKAN bukti
          terkirim: 'Tandai terkirim' dicatat admin EKSPLISIT setelah pengiriman
          nyata (email/WA di luar sistem) — tidak ada kirim otomatis. Keputusan
          mencatat tanggal + siapa (eksternal bila ada) + catatan alasan;
          Disetujui mengunci versi (revisi lanjut = versi baru, riwayat versi
          terkirim tidak ditimpa). PROTOTYPE: status hanya di memori halaman —
          snapshot/status BUTUH dukungan DB (freeze migrasi; usulan spec minimal
          di README modul). Tidak ada klaim tersimpan/autosave. ===== */}
      <div className="boq-offer-status" data-testid="boq-offer-status">
        <div className="boq-offer-status-head">
          <strong>Status penawaran</strong>
          <span className={'boq-status-badge boq-status-' + (offerStatus.status || 'DRAFT')}>
            {offerStatus.status === 'TERKIRIM' ? 'Terkirim' : offerStatus.status === 'DISETUJUI' ? 'Disetujui' : offerStatus.status === 'DITOLAK' ? 'Ditolak' : 'Belum dikirim'}
          </span>
        </div>
        <div className="boq-status-meta">
          {offerStatus.status === 'DRAFT' && <span>Belum dikirim — penawaran masih draft lokal. Ekspor PDF, kirim manual, lalu catat statusnya di sini.</span>}
          {offerStatus.status === 'TERKIRIM' && (
            <span>
              Dikirim {offerStatus.sentAt || '—'} oleh {offerStatus.sentBy || '—'} · versi {offerStatus.version?.revision || meta.revisionNumber}
              {offerStatus.version?.grand ? ` · total ${offerStatus.version.grand}` : ''} · menunggu keputusan klien.
            </span>
          )}
          {offerStatus.status === 'DISETUJUI' && (
            <span>
              ✓ Disetujui {offerStatus.decidedAt || '—'}{offerStatus.decidedBy ? ` oleh (eksternal): ${offerStatus.decidedBy}` : ''} · versi terkunci {offerStatus.version?.revision || meta.revisionNumber} — revisi lanjut dibuat sebagai versi baru, riwayat tidak ditimpa. Status ini TIDAK otomatis membuat PR/Budgeting/Revenue (RAB final existing tetap sumber finance).
            </span>
          )}
          {offerStatus.status === 'DITOLAK' && (
            <span>
              ✗ Ditolak {offerStatus.decidedAt || '—'}{offerStatus.decidedBy ? ` oleh (eksternal): ${offerStatus.decidedBy}` : ''}{offerStatus.note ? ` · alasan: ${offerStatus.note}` : ''} · buat revisi/versi baru lalu kirim ulang.
            </span>
          )}
        </div>
        <div className="boq-status-actions">
          {offerStatus.status === 'DRAFT' && (
            <button type="button" className="boq-btn" onClick={markSent}>Tandai terkirim</button>
          )}
          {offerStatus.status === 'TERKIRIM' && (
            <>
              <button type="button" className="boq-btn boq-btn-primary" onClick={() => setShowDecisionForm(v => !v)}>Catat keputusan</button>
              <button type="button" className="boq-btn boq-btn-ghost" onClick={backToDraft}>Batalkan (kembali draft)</button>
            </>
          )}
          {(offerStatus.status === 'DISETUJUI' || offerStatus.status === 'DITOLAK') && (
            <button type="button" className="boq-btn boq-btn-ghost" onClick={backToDraft} title="Prototype: reset status — implementasi final butuh tabel status di DB (freeze migrasi)">Reset status (prototype)</button>
          )}
        </div>
        {showDecisionForm && offerStatus.status === 'TERKIRIM' && (
          <div className="boq-decision-form">
            <div className="boq-control-row">
              <div className="boq-compact-field">
                <label htmlFor="boq-decision">Keputusan</label>
                <select id="boq-decision" value={decisionResult} onChange={e => setDecisionResult(e.target.value)}>
                  <option value="DISETUJUI">Disetujui</option>
                  <option value="DITOLAK">Ditolak</option>
                </select>
              </div>
              <div className="boq-compact-field">
                <label htmlFor="boq-decidedBy">Disetujui/ditolak oleh (eksternal)</label>
                <input id="boq-decidedBy" value={decisionBy} onChange={e => setDecisionBy(e.target.value)} placeholder="Nama klien/pihak eksternal (opsional)" autoComplete="off" />
              </div>
            </div>
            <div className="boq-compact-field">
              <label htmlFor="boq-decisionNote">{decisionResult === 'DITOLAK' ? 'Alasan penolakan' : 'Catatan keputusan'}</label>
              <textarea id="boq-decisionNote" value={decisionNote} onChange={e => setDecisionNote(e.target.value)} rows={2} />
            </div>
            <div className="boq-decision-actions">
              <button type="button" className="boq-btn boq-btn-primary" onClick={saveDecision}>Simpan keputusan</button>
              <button type="button" className="boq-btn boq-btn-ghost" onClick={() => setShowDecisionForm(false)}>Batal</button>
            </div>
          </div>
        )}
        <div className="boq-status-persist">
          <span>
            Data BOQ &amp; status ada di halaman ini saja — <b>TIDAK tersimpan di server</b> (belum ada dukungan DB; freeze migrasi){sentVersions.length > 0 ? ` · riwayat versi terkirim sesi ini: ${sentVersions.length}` : ''}. Backup manual:
          </span>
          <button type="button" className="boq-quiet-link" onClick={saveDraft} title="Unduh seluruh isi BOQ (termasuk status penawaran prototype) sebagai file JSON">⬇ Backup JSON</button>
          <button type="button" className="boq-quiet-link" onClick={() => fileRef.current && fileRef.current.click()} title="Pulihkan dari file JSON hasil Backup">⬆ Pulihkan JSON</button>
        </div>
      </div>

      <div className="boq-workspace">
        {/* ================= EDITOR ================= */}
        <div className="boq-card boq-editor">
          <header className="boq-doc-head">
            <div className="boq-brand-mark" aria-label="Noir Living">
              <div className="boq-mark">n<span className="boq-logo-dot">.</span><small>IR</small></div>
              <div className="boq-brand-label">Interior Design<br />&amp; Build</div>
            </div>
            <div className="boq-doc-title">
              <div className="boq-company">Noir Living</div>
              <div className="boq-discipline">Interior Design &amp; Build</div>
              <h1>Build On Quantity</h1>
              <input
                className="boq-revision-input"
                value={meta.revisionNumber}
                onChange={e => setMetaField('revisionNumber', e.target.value)}
                aria-label="Revision number"
                autoComplete="off"
              />
            </div>
          </header>

          <div className="boq-project-fields">
            <div className="boq-field"><label htmlFor="boq-clientName">Customer Name</label>
              <input id="boq-clientName" placeholder="Customer name" value={meta.clientName} onChange={e => setMetaField('clientName', e.target.value)} autoComplete="off" /></div>
            <div className="boq-field"><label htmlFor="boq-location">Project Location</label>
              <input id="boq-location" placeholder="Project location" value={meta.projectLocation} onChange={e => setMetaField('projectLocation', e.target.value)} autoComplete="off" /></div>
            <div className="boq-field"><label htmlFor="boq-pname">Project Name</label>
              <input id="boq-pname" value={meta.projectName} onChange={e => setMetaField('projectName', e.target.value)} autoComplete="off" /></div>
            {/* t_18564dce run 58 (feedback DAT screenshot 1792153939917): Project
                Reff No terikat Master Project — readonly, computed PRJ-<kode master>.
                Tidak ada free text/dummy; pilih master via panel di bawah ini. */}
            <div className="boq-field boq-field-reff">
              <label htmlFor="boq-prjreff">Project Reff No</label>
              <input id="boq-prjreff" value={meta.projectReffNo} readOnly aria-readonly="true" aria-live="polite" placeholder="Pilih master project" />
              <div className="boq-reff-link">
                {selectedProject ? (
                  <>
                    <span className="boq-reff-linked" title={`Master Project ${selectedProject.kode ?? selectedProject.code ?? ''} — ${selectedProject.name || ''}`}>
                      ⧉ Master {String(selectedProject.kode ?? selectedProject.code ?? '')} · {selectedProject.name || ''}
                    </span>
                    <button type="button" className="boq-link-btn" onClick={() => setShowProjectPicker(v => !v)}>Ganti</button>
                    <button type="button" className="boq-link-btn" onClick={clearProjectLink}>Lepas</button>
                  </>
                ) : (
                  <button type="button" className="boq-link-btn" onClick={() => setShowProjectPicker(v => !v)} aria-expanded={showProjectPicker}>
                    {showProjectPicker ? 'Tutup' : '⌄ Pilih master project…'}
                  </button>
                )}
              </div>
            </div>
            <div className="boq-field"><label htmlFor="boq-reff">BOQ Reff</label>
              <input id="boq-reff" value={meta.boqReff} readOnly aria-readonly="true" /></div>
            <div className="boq-field"><label htmlFor="boq-date">Quotation Date</label>
              <input id="boq-date" type="date" value={meta.estimateDate} onChange={e => setMetaField('estimateDate', e.target.value)} /></div>
          </div>

          <div className="boq-template-strip">
            <div className="boq-template-label"><strong>Start from a template</strong></div>
            <div className="boq-templates">
              {TEMPLATE_NAMES.map(name => (
                <button
                  key={name}
                  type="button"
                  className={'boq-template-pill' + (selectedTemplate === name ? ' active' : '')}
                  onClick={() => applyTemplate(name)}
                >{name}</button>
              ))}
            </div>
          </div>

          {showProjectPicker && (
            /* t_18564dce run 58 — picker Master Project untuk Project Reff No.
               Sumber data: rows.projects (tabel projects, server) — bukan input manual.
               Kode 2-3 digit live (83/99/101/102); query memfilter nama/kode. */
            <div className="boq-project-picker">
              <div className="boq-picker-head">
                <input
                  className="boq-picker-search"
                  placeholder="Cari master project (nama / kode)…"
                  value={projectQuery}
                  onChange={e => setProjectQuery(e.target.value)}
                  aria-label="Cari master project"
                  autoComplete="off"
                />
                <span className="boq-picker-count">{filteredProjects.length} project</span>
              </div>
              <div className="boq-picker-list" role="listbox" aria-label="Daftar master project">
                {filteredProjects.length === 0 && (
                  <div className="boq-picker-empty">Tidak ada master project yang cocok.</div>
                )}
                {filteredProjects.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={selectedProject && selectedProject.id === p.id}
                    className={'boq-picker-row' + (selectedProject && selectedProject.id === p.id ? ' selected' : '')}
                    onClick={() => pickProject(p)}
                  >
                    <span className="boq-picker-kode">{String(p.kode ?? p.code ?? '')}</span>
                    <span className="boq-picker-name">{p.name || '(tanpa nama)'}</span>
                    <span className="boq-picker-status">{p.status || ''}</span>
                    <span className="boq-picker-ref">{masterProjectReff(p)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {plainPanelVisible && (
            <div className="boq-plain-choices show">
              <p className="boq-choice-heading">Choose {selectedTemplate} work items to add to the BOQ</p>
              <div className="boq-choice-grid">
                {plainChoices.map(choice => (
                  <label className="boq-choice-card" key={choice.id}>
                    <input
                      type="checkbox"
                      checked={items.some(it => it.choiceId === choice.id)}
                      onChange={e => togglePlainChoice(choice.id, e.target.checked)}
                      aria-label={choice.name}
                    />
                    <span>{choice.name}</span>
                  </label>
                ))}
                <button type="button" className="boq-choice-add" onClick={() => setPlainAdding(true)}>＋ Add item</button>
                {plainAdding && (
                  <div className="boq-choice-form show">
                    <input
                      value={newChoiceName}
                      onChange={e => setNewChoiceName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomChoice() } }}
                      placeholder="Custom item name"
                      autoComplete="off"
                      autoFocus
                    />
                    <div>
                      <button type="button" className="boq-btn boq-btn-primary" onClick={addCustomChoice}>Add</button>{' '}
                      <button type="button" className="boq-btn boq-btn-ghost" onClick={() => { setPlainAdding(false); setNewChoiceName('') }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="boq-unit-note">
            <strong>in thousand IDR (000)</strong>
          </div>

          <div className="boq-table-wrap">
            <table aria-label="Build on quantity">
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>NO</th>
                  <th style={{ width: '18%' }}>ITEM</th>
                  <th style={{ width: '14%' }}>AREA</th>
                  <th style={{ width: '24%' }}>GENERAL SPECS.</th>
                  <th style={{ width: '8%' }}>Vol</th>
                  <th style={{ width: '8%' }}>MEA</th>
                  <th style={{ width: '12%' }}>PRICE</th>
                  <th style={{ width: '12%' }}>TOTAL</th>
                  <th aria-label="Actions" style={{ width: '64px' }}></th>
                </tr>
              </thead>
              <tbody>
                {!items.length ? (
                  <tr><td className="boq-empty-row" colSpan={9}>No items yet. Add the first row to start building the BOQ.</td></tr>
                ) : items.map((item, i) => {
                  const useManual = item.manualItem === true || !item.item || availableItems.indexOf(item.item) < 0
                  const referencePrice = breakdownTotal(item)
                  const pricePlaceholder = referencePrice > 0 ? 'Reference: ' + thousand(referencePrice) : '0'
                  return (
                    <ItemRow
                      key={item.choiceId ? item.choiceId : 'row-' + i}
                      item={item}
                      index={i}
                      availableItems={availableItems}
                      useManual={useManual}
                      pricePlaceholder={pricePlaceholder}
                      units={['ls', 'm²', 'm¹', 'unit', 'point', 'set', 'day', 'kg']}
                      onField={updateItemField}
                      onSelect={onItemSelect}
                      onCostField={updateCostField}
                      onToggleBreakdown={toggleBreakdown}
                      onAddCost={addCostComponent}
                      onRemoveCost={removeCostComponent}
                      onDelete={deleteItem}
                    />
                  )
                })}
              </tbody>
            </table>
            <button type="button" className="boq-btn boq-btn-ghost boq-add-row" onClick={addItem}>＋ Add item</button>
          </div>

          {/* ===== Notes ===== */}
          <section className="boq-notes-section" aria-labelledby="boq-notes-title">
            <div className="boq-notes-head">
              <h2 id="boq-notes-title">Notes</h2>
              <span>Choose the wording to include</span>
            </div>
            <div className="boq-note-picker">
              <select value={selectedNote} onChange={e => setSelectedNote(e.target.value)} aria-label="Choose Notes wording">
                <option value="">Choose wording...</option>
                {availableNotes.map(note => <option key={note} value={note}>{note}</option>)}
              </select>
              <button type="button" className="boq-btn boq-btn-primary" onClick={addSelectedNote} disabled={availableNotes.length === 0}>Add</button>
              <button type="button" className="boq-btn boq-btn-ghost boq-custom-note-trigger" onClick={() => setNoteAdding(v => !v)}>＋ Custom wording</button>
            </div>
            {noteAdding && (
              <div className="boq-custom-note-form show">
                <input
                  value={customNote}
                  onChange={e => setCustomNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomNote() } }}
                  placeholder="Enter new Notes wording"
                  autoComplete="off"
                  autoFocus
                />
                <button type="button" className="boq-btn boq-btn-primary" onClick={addCustomNote}>Save wording</button>
              </div>
            )}
            <ol className="boq-active-notes">
              {activeNotes.map((note, index) => (
                <li className="boq-active-note" key={note + '-' + index}>
                  <span className="boq-active-note-number">{index + 1}.</span>
                  <span>{note}</span>
                  <button type="button" className="boq-remove-note" onClick={() => removeNote(index)} aria-label="Remove note">×</button>
                </li>
              ))}
            </ol>
            {!activeNotes.length && <p className="boq-notes-empty">No Notes selected yet.</p>}
          </section>
        </div>

        {/* ================= SIDE ================= */}
        <aside className="boq-side">
          <section className="boq-card boq-summary">
            <h2>BOQ Summary</h2>
            <div className="boq-sum-row"><span>Work total</span><strong>{rupiahFromK(totals.base)}</strong></div>
            <div className="boq-sum-row">
              <span id="boq-profit-label">{totals.mode === 'gross' ? profitName : `${profitName} (${isNominal ? rupiahFromK(totals.nominalAdjustmentK) : thousand(totals.adjustmentValue) + '%'})`}</span>
              <strong>{rupiahFromK(totals.margin)}</strong>
            </div>
            <div className="boq-sum-row"><span>PPN</span><strong>{rupiahFromK(totals.tax)}</strong></div>
            <div className="boq-grand">
              <span>Quotation total</span>
              <strong>{rupiahFromK(totals.grand)}</strong>
              <small>Shown in full IDR</small>
            </div>
          </section>

          <section className="boq-card boq-controls">
            <h2>Settings</h2>
            <div className="boq-control-row">
              <div className="boq-compact-field">
                <label htmlFor="boq-marginMode">Profit method</label>
                <select id="boq-marginMode" value={meta.marginMode} onChange={e => onMarginModeChange(e.target.value)} disabled={!totals.adjustmentEnabled}>
                  <option value="markup">Markup on cost</option>
                  <option value="gross">Gross margin</option>
                  <option value="discount">Discount</option>
                </select>
              </div>
              <div className="boq-compact-field">
                <label htmlFor="boq-marginRate">{isNominal ? profitName + ' (Rp)' : profitName + ' %'}</label>
                <input
                  id="boq-marginRate"
                  type="number"
                  value={meta.marginRate}
                  min="0"
                  max={isNominal ? '' : '99'}
                  step={isNominal ? '1000' : '0.1'}
                  onChange={e => setMetaField('marginRate', num(e.target.value))}
                  disabled={!totals.adjustmentEnabled}
                />
              </div>
            </div>
            {hasTypeChoice && (
              <div className="boq-compact-field boq-discount-type-field">
                <label htmlFor="boq-discountType">{profitName} type</label>
                <select id="boq-discountType" value={meta.discountType} onChange={e => onDiscountTypeChange(e.target.value)} disabled={!totals.adjustmentEnabled}>
                  <option value="percent">Percentage (%)</option>
                  <option value="nominal">Nominal (Rp)</option>
                </select>
              </div>
            )}
            <div className="boq-toggle-wrap">
              <label className="boq-toggle">
                <input type="checkbox" checked={meta.adjustmentEnabled} onChange={e => setMetaField('adjustmentEnabled', e.target.checked)} aria-label="Apply markup or discount" />
                <span className="boq-slider"></span>
              </label>
              <span className="boq-toggle-label">Apply markup/discount</span>
            </div>
            <div className="boq-control-row">
              <div className="boq-toggle-wrap">
                <label className="boq-toggle">
                  <input type="checkbox" checked={meta.taxEnabled} onChange={e => setMetaField('taxEnabled', e.target.checked)} aria-label="Apply PPN" />
                  <span className="boq-slider"></span>
                </label>
                <span className="boq-toggle-label">Apply PPN</span>
              </div>
              <div className="boq-compact-field">
                <label htmlFor="boq-taxRate">PPN %</label>
                <input
                  id="boq-taxRate"
                  type="number"
                  value={meta.taxRate}
                  min="0"
                  max="100"
                  step="0.1"
                  onChange={e => setMetaField('taxRate', num(e.target.value))}
                  disabled={!meta.taxEnabled}
                />
              </div>
            </div>
            <div className="boq-toggle-wrap">
              <label className="boq-toggle">
                <input type="checkbox" checked={meta.showAdjustmentPdf} onChange={e => setMetaField('showAdjustmentPdf', e.target.checked)} aria-label="Show markup or discount in PDF" />
                <span className="boq-slider"></span>
              </label>
              <span className="boq-toggle-label">Show markup/discount in PDF</span>
            </div>

            {/* ===== Tambahan admin-only: Buat Proyek dari BOQ ===== */}
            <div className="boq-create-project-wrap">
              <button type="button" className="boq-btn boq-btn-primary" style={{ width: '100%' }} onClick={() => setProjectModal(true)}>
                🏗️ Buat Proyek dari BOQ
              </button>
              <small className="boq-file-note">
                Hanya membuat nomor proyek di Master Project (status Not Start). Tidak otomatis ke PR/Budgeting/Revenue.
              </small>
            </div>

            <div className="boq-side-actions">
              <button type="button" className="boq-btn" onClick={resetAll}>Reset</button>
              <button type="button" className="boq-btn" onClick={duplicateLast}>Duplicate item</button>
            </div>
            <p className="boq-file-note">Use the + button on each item to add a cost breakdown. Download the JSON file to keep the current template layout and settings.</p>
          </section>
        </aside>
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
      <div className={'boq-toast' + (toast ? ' show' : '')} role="status" aria-live="polite">{toast}</div>

      {projectModal && (
        <CreateProjectModal
          boq={{ boqReff: meta.boqReff, projectName: meta.projectName, projectReffNo: meta.projectReffNo }}
          projects={projects}
          selectedProject={selectedProject}
          refresh={refresh}
          onClose={() => setProjectModal(false)}
        />
      )}
    </div>
  )
}

// ============================================================
// ItemRow — baris item + breakdown panel (source renderItems line
// 800-830 + renderBreakdown 778-798, dirender React tanpa innerHTML).
// ============================================================
function ItemRow({ item, index, availableItems, useManual, pricePlaceholder, units, onField, onSelect, onCostField, onToggleBreakdown, onAddCost, onRemoveCost, onDelete }) {
  return (
    <>
      <tr className="boq-item-row" data-label-row={index + 1}>
        <td className="boq-row-number" data-label="No">{index + 1}</td>
        <td data-label="Item">
          <div className="boq-item-picker">
            <select
              value={useManual ? '__manual__' : item.item}
              onChange={e => onSelect(index, e.target.value)}
              aria-label="Choose item"
            >
              <option value="">Choose item</option>
              {availableItems.map(name => <option key={name} value={name}>{name}</option>)}
              <option value="__manual__">Other / manual entry...</option>
            </select>
            {useManual && (
              <input
                className="boq-item-manual"
                value={item.item}
                onChange={e => onField(index, 'item', e.target.value)}
                placeholder="Enter item name"
                aria-label="Manual item name"
              />
            )}
            <div className="boq-item-picker-actions">
              <button
                type="button"
                className={'boq-cost-toggle' + (item.breakdownOpen ? ' active' : '')}
                onClick={() => onToggleBreakdown(index)}
                aria-expanded={item.breakdownOpen ? 'true' : 'false'}
                title="Cost breakdown"
                aria-label={(item.breakdownOpen ? 'Close' : 'Open') + ' cost breakdown ' + (item.item || 'item')}
              >{item.breakdownOpen ? '−' : '+'}</button>
            </div>
          </div>
        </td>
        <td data-label="Area"><input value={item.area} onChange={e => onField(index, 'area', e.target.value)} placeholder="Area" aria-label="Area" /></td>
        <td data-label="General specs."><input value={item.specs} onChange={e => onField(index, 'specs', e.target.value)} placeholder="Material / specifications" aria-label="General specs" /></td>
        <td data-label="Vol"><input className="boq-num" type="number" min="0" step="0.01" value={item.qty} onChange={e => onField(index, 'qty', e.target.value)} aria-label="Volume" /></td>
        <td data-label="MEA">
          <select value={item.unit} onChange={e => onField(index, 'unit', e.target.value)} aria-label="Unit">
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </td>
        <td data-label="Price (000)">
          <div className="boq-price-stack">
            <input
              className="boq-num"
              type="number"
              min="0"
              step="1"
              value={num(item.price) > 0 ? item.price : ''}
              onChange={e => onField(index, 'price', e.target.value)}
              placeholder={pricePlaceholder}
              aria-label="Price in thousand IDR; breakdown subtotal is reference only"
            />
          </div>
        </td>
        <td className="boq-num boq-subtotal" data-label="Total">{thousand(calcItem(item))}</td>
        <td>
          <div className="boq-row-actions">
            <button type="button" className="boq-delete-row" onClick={() => onDelete(index)} title="Delete item" aria-label={'Delete ' + (item.item || 'item')}>×</button>
          </div>
        </td>
      </tr>
      {item.breakdownOpen && (
        <tr className="boq-breakdown-row">
          <td colSpan={9}>
            <div className="boq-breakdown-panel">
              <div className="boq-breakdown-head">
                <strong>Unit cost breakdown</strong>
                <span>Amount = P × L × Qty × Unit Price (000)</span>
              </div>
              <div className="boq-cost-list">
                <div className="boq-cost-head">
                  <span>Description</span><span>P</span><span>L</span><span>P×L</span><span>Qty</span><span>Unit Price</span><span>Amount</span><span></span>
                </div>
                {item.breakdown.map((part, partIndex) => (
                  <div className="boq-cost-row" key={partIndex}>
                    <div className="boq-cost-cell" data-label="Description">
                      <input value={part.name} onChange={e => onCostField(index, partIndex, 'name', e.target.value)} aria-label="Cost component name" />
                    </div>
                    <div className="boq-cost-cell" data-label="P">
                      <input className="boq-cost-number" type="number" min="0" step="0.01" value={part.length} onChange={e => onCostField(index, partIndex, 'length', e.target.value)} aria-label="Length" />
                    </div>
                    <div className="boq-cost-cell" data-label="L">
                      <input className="boq-cost-number" type="number" min="0" step="0.01" value={part.width} onChange={e => onCostField(index, partIndex, 'width', e.target.value)} aria-label="Width" />
                    </div>
                    <div className="boq-cost-cell boq-cost-area" data-label="P×L">{thousand(calcCostArea(part))}</div>
                    <div className="boq-cost-cell" data-label="Qty">
                      <input className="boq-cost-number" type="number" min="0" step="0.01" value={part.qty} onChange={e => onCostField(index, partIndex, 'qty', e.target.value)} aria-label="Component quantity" />
                    </div>
                    <div className="boq-cost-cell" data-label="Unit Price (000)">
                      <input className="boq-cost-number" type="number" min="0" step="1" value={part.unitPrice} onChange={e => onCostField(index, partIndex, 'unitPrice', e.target.value)} aria-label="Unit price in thousand IDR" />
                    </div>
                    <div className="boq-cost-cell boq-cost-total" data-label="Amount (000)">{thousand(calcCostPart(part))}</div>
                    <button type="button" className="boq-remove-cost" onClick={() => onRemoveCost(index, partIndex)} aria-label={'Remove component ' + part.name}>×</button>
                  </div>
                ))}
              </div>
              <div className="boq-cost-subtotal"><span>Breakdown subtotal</span><strong>{thousand(breakdownTotal(item))}</strong></div>
              <button type="button" className="boq-btn boq-btn-ghost boq-add-cost" onClick={() => onAddCost(index)}>＋ Add component</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ============================================================
// SCOPED CSS — semua selector di-prefix .boq- (tanpa global override).
// Palet memakai design token app (olive/ivory) — sama keluarga warna
// dengan source (brand #969b7c = --olive-400, brand-deep = --olive-800).
// ============================================================
const boqScopedCss = `
.boq-root { --boq-paper:#fcfcf8; --boq-surface:#ffffff; --boq-surface-2:#f1f2eb; --boq-ink:#20251f; --boq-muted:#667064; --boq-line:#d5d9ce; --boq-line-strong:#b9c0b2; --boq-brand:#969b7c; --boq-brand-dark:#60664d; --boq-brand-deep:#3d4435; --boq-brand-soft:#e7e9de; --boq-focus:#71824f; --boq-danger:#a3493f; --boq-shadow:0 22px 60px rgba(38,44,34,.10); --boq-radius:14px; color:var(--boq-ink); }
.boq-root button { cursor:pointer; }
/* t_18564dce run 58 (feedback DAT screenshot 1792155666579): global rules
   "aside{background:var(--sidebar-bg);color:#e6e7dc}" dan rule "header"/
   "label" di styles/globals.css bocor ke elemen semantik milik modul
   (<aside class="boq-side"> kartu Settings, <header class="boq-header-actions">,
   <label> toggle) sehingga teks Settings/Apply markup/Apply PPN/Show in PDF
   tampak samar (pucat di atas terang). Netralkan SCOPED di .boq-root agar
   tidak mengubah sidebar asli di luar modul. */
.boq-root aside.boq-side { background:transparent; color:var(--boq-ink); padding:0; box-shadow:none; width:auto; flex-direction:column; }
.boq-root aside.boq-side .boq-card { background:var(--boq-surface); color:var(--boq-ink); }
.boq-root header.boq-header-actions { background:transparent; color:var(--boq-ink); margin-bottom:0; padding:0; }
/* Tipografi lokal BOQ (feedback DAT): heading jelas, label tegas, helper
   tetap keterbacaan nyata — tanpa mengubah tipografi global app. */
.boq-root .boq-controls h2 { font-weight:700; color:var(--boq-ink); }
.boq-root .boq-toggle-label { color:var(--boq-ink); font-weight:600; }
.boq-root .boq-toggle-wrap .boq-compact-field label { color:var(--boq-brand-dark); font-weight:600; }
.boq-root .boq-file-note { color:var(--boq-muted); font-weight:500; }
/* t_18564dce run 58 (feedback DAT screenshot 1792155471393): toolbar hanya
   Export PDF — blok status penawaran menggantikan helper draft di utility bar.
   Status: badge berwarna jelas (Belum dikirim/Terkirim/Disetujui/Ditolak),
   aksi eksplisit di blok sendiri (bukan di toolbar export), persistensi
   dijelaskan jujur + backup/pulih JSON kecil (pemulihan data tetap ada). */
.boq-offer-status { margin:0 0 14px; padding:12px 15px; border:1px solid var(--boq-line); border-left:4px solid var(--boq-brand-dark); border-radius:10px; background:var(--boq-surface-2); }
.boq-offer-status-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.boq-offer-status-head strong { font-size:12px; font-weight:700; color:var(--boq-ink); letter-spacing:.02em; text-transform:uppercase; }
.boq-status-badge { display:inline-block; padding:3px 10px; border-radius:99px; font-size:10.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
.boq-status-DRAFT { background:#eceee3; color:#4a5140; border:1px solid #c9cfc0; }
.boq-status-TERKIRIM { background:#e7edf2; color:#31506b; border:1px solid #b9cbda; }
.boq-status-DISETUJUI { background:#e2ecdd; color:#2f5233; border:1px solid #b4cbae; }
.boq-status-DITOLAK { background:#f3e2df; color:#7c3029; border:1px solid #ddb1aa; }
.boq-status-meta { margin:7px 0 9px; font-size:11.5px; line-height:1.5; color:var(--boq-ink); font-weight:500; }
.boq-status-actions { display:flex; gap:8px; flex-wrap:wrap; }
.boq-decision-form { margin-top:10px; padding:10px 11px; border:1px solid var(--boq-line-strong); border-radius:8px; background:var(--boq-surface); }
.boq-decision-actions { display:flex; gap:8px; margin-top:8px; }
.boq-status-persist { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px; padding-top:9px; border-top:1px dashed var(--boq-line-strong); font-size:10.5px; color:var(--boq-muted); font-weight:500; }
.boq-quiet-link { min-height:24px; padding:2px 8px; border:0; border-radius:6px; background:transparent; color:var(--boq-brand-dark); font-size:10.5px; font-weight:700; text-decoration:underline; text-underline-offset:2px; }
.boq-quiet-link:hover { color:var(--boq-brand-deep); background:var(--boq-brand-soft); }
.boq-quiet-link:focus-visible { outline:2px solid var(--boq-focus); outline-offset:1px; }
.boq-utility { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-bottom:14px; }
.boq-utility-copy strong { display:block; font-weight:700; font-size:17px; letter-spacing:-.01em; }
.boq-utility-copy span { color:var(--text-muted); font-size:12px; }
.boq-header-tools { display:grid; gap:5px; justify-items:end; }
.boq-header-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.boq-draft-note { margin:0; color:var(--text-muted); font-size:10px; text-align:right; }
.boq-btn { min-height:40px; padding:9px 13px; border:1px solid var(--boq-line-strong); border-radius:8px; background:var(--boq-surface); color:var(--boq-ink); font-size:12px; font-weight:700; transition:border-color .18s ease, background .18s ease, color .18s ease; }
.boq-btn:hover { border-color:var(--boq-brand-dark); color:var(--boq-brand-dark); }
.boq-btn.boq-btn-primary { background:var(--boq-brand-deep); border-color:var(--boq-brand-deep); color:#fff; }
.boq-btn.boq-btn-primary:hover { background:var(--boq-brand-dark); border-color:var(--boq-brand-dark); color:#fff; }
.boq-btn.boq-btn-ghost { background:transparent; }
.boq-btn:disabled { opacity:.5; cursor:not-allowed; }
.boq-workspace { display:grid; grid-template-columns:minmax(0,1fr) 322px; gap:16px; align-items:start; }
.boq-card { background:var(--boq-paper); border:1px solid var(--boq-line); box-shadow:var(--boq-shadow); }
.boq-editor { overflow:hidden; border-radius:var(--boq-radius); }
.boq-doc-head { min-height:136px; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:24px 28px; background:var(--boq-brand); color:#fff; }
.boq-brand-mark { display:flex; align-items:center; gap:14px; }
.boq-mark { width:58px; font-size:33px; font-weight:700; line-height:.72; letter-spacing:-.06em; }
.boq-mark .boq-logo-dot { display:inline-block; margin-left:1px; font-size:.72em; letter-spacing:0; }
.boq-mark small { display:block; margin-left:10px; margin-top:5px; font-size:15px; letter-spacing:.04em; }
.boq-brand-label { font-size:15px; font-weight:600; line-height:1.3; letter-spacing:-.01em; opacity:.92; }
.boq-doc-title { text-align:right; }
.boq-doc-title .boq-company { font-size:13px; font-weight:600; }
.boq-doc-title .boq-discipline { font-size:12px; opacity:.9; }
.boq-doc-title h1 { margin:4px 0 2px; font-size:clamp(25px,3vw,38px); font-weight:500; line-height:1; letter-spacing:-.035em; }
.boq-revision-input { width:88px; min-height:28px; padding:3px 6px; border:1px solid rgba(255,255,255,.42); border-radius:5px; background:rgba(255,255,255,.10); color:#fff; font-size:11px; font-weight:700; letter-spacing:.04em; text-align:right; }
.boq-revision-input::placeholder { color:rgba(255,255,255,.72); }
.boq-project-fields { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); border-bottom:1px solid var(--boq-line); }
.boq-field { min-width:0; padding:13px 12px; border-right:1px solid var(--boq-line); }
.boq-field:last-child { border-right:0; }
.boq-field label, .boq-compact-field label { display:block; margin:0 0 5px; color:var(--text-muted); font-size:10px; font-weight:700; letter-spacing:.055em; text-transform:uppercase; }
.boq-field input { width:100%; min-height:32px; padding:4px 0; border:0; border-bottom:1px solid transparent; border-radius:0; background:transparent; font-weight:600; }
.boq-field input:focus { border-bottom-color:var(--boq-focus); outline:none; box-shadow:none; }
/* t_18564dce run 58: baris tautan Master Project di bawah input Project Reff No.
   (grid 6 kolom existing dipertahankan — baris link tumbuh ke bawah, bukan
   menambah kolom, sehingga tidak merusak layout rapat milik source). */
.boq-field-reff .boq-reff-link { display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap; }
.boq-field-reff .boq-reff-linked { font-size:10px; font-weight:700; color:var(--boq-brand-dark); letter-spacing:.02em; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.boq-link-btn { min-height:24px; padding:2px 8px; border:1px solid var(--boq-line-strong); border-radius:6px; background:var(--boq-surface); color:var(--boq-brand-dark); font-size:10px; font-weight:700; }
.boq-link-btn:hover { border-color:var(--boq-brand-dark); background:var(--boq-brand-soft); color:var(--boq-brand-deep); }
.boq-link-btn:focus-visible { outline:2px solid var(--boq-focus); outline-offset:1px; }
/* Picker Master Project: panel dropdown scoped (data = rows.projects). */
.boq-project-picker { border-bottom:1px solid var(--boq-line); background:var(--boq-paper); padding:12px 15px; }
.boq-picker-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.boq-picker-search { flex:1 1 auto; min-width:0; min-height:34px; padding:6px 10px; border:1px solid var(--boq-line-strong); border-radius:7px; background:var(--boq-surface); color:var(--boq-ink); font-size:12px; }
.boq-picker-search:focus { border-color:var(--boq-focus); outline:none; box-shadow:none; }
.boq-picker-count { flex:0 0 auto; font-size:10px; font-weight:700; color:var(--boq-muted); text-transform:uppercase; letter-spacing:.05em; }
.boq-picker-list { max-height:220px; overflow-y:auto; border:1px solid var(--boq-line); border-radius:8px; background:var(--boq-surface); }
.boq-picker-row { display:grid; grid-template-columns:44px minmax(0,1fr) auto auto; gap:8px; align-items:center; width:100%; text-align:left; padding:8px 10px; border:0; border-bottom:1px solid var(--boq-line); border-radius:0; background:var(--boq-surface); color:var(--boq-ink); font-size:11px; font-weight:600; }
.boq-picker-row:last-child { border-bottom:0; }
.boq-picker-row:hover { background:var(--boq-brand-soft); color:var(--boq-brand-deep); }
.boq-picker-row:focus-visible { outline:2px solid var(--boq-focus); outline-offset:-2px; }
.boq-picker-row.selected { background:var(--boq-brand-deep); color:#fff; }
.boq-picker-kode { font-weight:800; font-variant-numeric:tabular-nums; }
.boq-picker-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.boq-picker-status { font-size:9px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--boq-muted); }
.boq-picker-row.selected .boq-picker-status { color:#d9dcc4; }
.boq-picker-ref { font-size:10px; font-weight:700; color:var(--boq-brand-dark); font-variant-numeric:tabular-nums; }
.boq-picker-row.selected .boq-picker-ref { color:#fff; }
.boq-picker-empty { padding:12px 10px; font-size:11px; color:var(--boq-muted); }
.boq-template-strip { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 15px; border-bottom:1px solid var(--boq-line); background:var(--boq-surface-2); }
.boq-template-label strong { font-size:12px; }
.boq-templates { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
/* t_18564dce run 58 (feedback DAT, screenshot 1792153924456): label template
   harus TERBACA pada semua state. Bug sebelumnya: global "button { color: white }"
   (styles/globals.css) menimpa warna teks pill non-aktif -> putih di atas
   permukaan putih. Fix scoped: warna teks HEX EKSPLISIT (bukan var()) supaya
   tidak bisa jatuh ke inherit global di environment mana pun — nilai sama
   dengan token .boq-root (di atas), modul tidak punya tema lain. */
.boq-template-pill { padding:6px 10px; border:1px solid #b9c0b2; border-radius:7px; background:#ffffff; color:#20251f; font-size:11px; font-weight:700; }
.boq-template-pill:hover { border-color:#60664d; background:#e7e9de; color:#3d4435; }
.boq-template-pill:focus-visible { outline:2px solid #71824f; outline-offset:1px; }
.boq-template-pill.active { background:#3d4435; border-color:#3d4435; color:#ffffff; }
.boq-template-pill.active:hover { background:#60664d; border-color:#60664d; color:#ffffff; }
.boq-plain-choices { padding:14px 15px; border-bottom:1px solid var(--boq-line); background:var(--boq-paper); }
.boq-choice-heading { margin:0 0 10px; color:var(--text-muted); font-size:10px; font-weight:700; letter-spacing:.045em; text-transform:uppercase; }
.boq-choice-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
.boq-choice-card { position:relative; display:flex; align-items:center; gap:9px; min-height:52px; padding:10px 11px; border:1px solid var(--boq-line); border-radius:8px; background:var(--boq-surface); cursor:pointer; font-size:11px; font-weight:700; line-height:1.3; }
.boq-choice-card:has(input:checked) { border-color:var(--boq-brand-dark); background:var(--boq-brand-soft); color:var(--boq-brand-deep); }
.boq-choice-card input { width:17px; height:17px; flex:0 0 auto; accent-color:var(--boq-brand-dark); }
.boq-choice-add { min-height:52px; padding:10px 11px; border:1px dashed var(--boq-line-strong); border-radius:8px; background:transparent; color:var(--boq-brand-dark); font-size:11px; font-weight:700; }
.boq-choice-add:hover { border-color:var(--boq-brand-dark); background:var(--boq-brand-soft); }
.boq-choice-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:7px; grid-column:1 / -1; }
.boq-choice-form input { min-height:38px; }
.boq-choice-form .boq-btn { min-height:38px; }
.boq-unit-note { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 15px 5px; }
.boq-unit-note strong { color:var(--boq-brand-dark); font-size:12px; text-decoration:underline; text-underline-offset:3px; }
.boq-table-wrap { padding:0 15px 16px; }
.boq-table-wrap table { width:100%; border-collapse:collapse; table-layout:fixed; }
.boq-table-wrap th { padding:10px 6px; border-top:2px dashed var(--boq-brand-dark); border-bottom:2px dashed var(--boq-brand-dark); border-right:1px solid var(--boq-line); font-size:10px; font-weight:700; letter-spacing:.035em; text-align:center; }
.boq-table-wrap th:last-child { border-right:0; }
.boq-table-wrap td { padding:7px 5px; border-bottom:1px solid var(--boq-line); vertical-align:middle; }
.boq-table-wrap td input, .boq-table-wrap td select { width:100%; min-height:36px; padding:7px 8px; border:1px solid transparent; border-radius:5px; background:transparent; font-size:12px; color:var(--boq-ink); }
.boq-table-wrap td input:hover, .boq-table-wrap td select:hover, .boq-table-wrap td input:focus, .boq-table-wrap td select:focus { border-color:var(--boq-line-strong); background:var(--boq-surface); outline:none; }
.boq-item-picker { display:grid; gap:5px; }
.boq-item-picker select { font-weight:700; }
.boq-item-picker-actions { display:flex; align-items:center; justify-content:flex-start; }
.boq-item-manual { border-color:var(--boq-line-strong) !important; background:var(--boq-surface) !important; }
.boq-row-number { color:var(--text-muted); text-align:center; font-size:11px; font-weight:700; }
.boq-num { text-align:right; font-variant-numeric:tabular-nums; }
.boq-subtotal { color:var(--boq-brand-deep); font-weight:700; font-size:12px; white-space:nowrap; }
.boq-row-actions { display:flex; align-items:center; justify-content:center; gap:2px; }
.boq-cost-toggle, .boq-delete-row { width:28px; height:28px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--text-muted); font-size:15px; font-weight:700; }
.boq-cost-toggle:hover, .boq-cost-toggle.active { background:var(--boq-brand-soft); color:var(--boq-brand-dark); }
.boq-delete-row:hover { background:rgba(163,73,63,.12); color:var(--boq-danger); }
.boq-breakdown-row td { padding:0 5px 10px 42px; border-bottom:1px solid var(--boq-line); }
.boq-breakdown-panel { padding:12px; border:1px solid var(--boq-line); border-radius:8px; background:var(--boq-surface-2); }
.boq-breakdown-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
.boq-breakdown-head strong { font-size:11px; }
.boq-breakdown-head span { color:var(--text-muted); font-size:9px; }
.boq-cost-list { display:grid; gap:6px; }
.boq-cost-head, .boq-cost-row { display:grid; grid-template-columns:minmax(170px,2.2fr) repeat(4,minmax(48px,.42fr)) minmax(88px,.78fr) minmax(88px,.78fr) 28px; gap:5px; align-items:center; }
.boq-cost-head { padding:0 1px 3px; color:var(--text-muted); font-size:8px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
.boq-cost-head span:not(:first-child) { text-align:right; }
.boq-cost-row input { width:100%; min-height:32px; padding:5px 6px; font-size:11px; border:1px solid var(--boq-line); border-radius:5px; background:var(--boq-surface); color:var(--boq-ink); }
.boq-cost-row input:focus { border-color:var(--boq-focus); outline:none; }
.boq-cost-number { text-align:right; }
.boq-cost-area, .boq-cost-total { padding-right:6px; color:var(--boq-brand-deep); font-size:11px; font-weight:700; text-align:right; font-variant-numeric:tabular-nums; }
.boq-cost-area { color:var(--text-muted); }
.boq-cost-subtotal { display:flex; align-items:center; justify-content:flex-end; gap:18px; margin-top:8px; padding:9px 35px 0 8px; border-top:1px solid var(--boq-line); font-size:11px; }
.boq-cost-subtotal span { color:var(--text-muted); font-weight:700; }
.boq-cost-subtotal strong { min-width:96px; color:var(--boq-brand-deep); text-align:right; font-variant-numeric:tabular-nums; }
.boq-remove-cost { width:28px; height:28px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--text-muted); font-size:16px; }
.boq-remove-cost:hover { background:rgba(163,73,63,.12); color:var(--boq-danger); }
.boq-add-cost { margin-top:8px; min-height:32px; padding:6px 9px; }
.boq-empty-row { padding:34px 10px; color:var(--text-muted); text-align:center; }
.boq-add-row { margin-top:11px; }
.boq-notes-section { padding:16px 15px 18px; border-top:1px solid var(--boq-line); background:var(--boq-surface-2); }
.boq-notes-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:10px; }
.boq-notes-head h2 { margin:0; font-size:16px; letter-spacing:-.02em; }
.boq-notes-head span { color:var(--text-muted); font-size:10px; }
.boq-note-picker { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:7px; align-items:center; }
.boq-note-picker select { min-height:40px; border:1px solid var(--boq-line); border-radius:7px; background:var(--boq-surface); color:var(--boq-ink); padding:8px 10px; }
.boq-custom-note-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:7px; margin-top:8px; }
.boq-custom-note-form input { min-height:38px; border:1px solid var(--boq-line); border-radius:7px; padding:8px 10px; background:var(--boq-surface); color:var(--boq-ink); }
.boq-active-notes { display:grid; gap:6px; margin:12px 0 0; padding:0; list-style:none; }
.boq-active-note { display:grid; grid-template-columns:22px minmax(0,1fr) 30px; gap:7px; align-items:start; padding:9px 9px 9px 7px; border-bottom:1px solid var(--boq-line); background:var(--boq-paper); font-size:11px; line-height:1.45; }
.boq-active-note-number { color:var(--boq-brand-dark); font-weight:700; text-align:center; }
.boq-remove-note { width:28px; height:28px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--text-muted); font-size:16px; }
.boq-remove-note:hover { background:rgba(163,73,63,.12); color:var(--boq-danger); }
.boq-notes-empty { margin:11px 0 0; color:var(--text-muted); font-size:11px; }
.boq-side { position:sticky; top:16px; display:grid; gap:12px; }
.boq-summary, .boq-controls { padding:18px; border-radius:12px; }
.boq-summary { background:var(--boq-brand-deep); border-color:var(--boq-brand-deep); color:#fff; }
.boq-summary h2, .boq-controls h2 { margin:0 0 14px; font-size:18px; letter-spacing:-.02em; }
.boq-sum-row { display:flex; justify-content:space-between; gap:14px; padding:7px 0; font-size:12px; }
.boq-sum-row span:first-child { opacity:.72; }
.boq-sum-row strong { text-align:right; font-variant-numeric:tabular-nums; }
.boq-grand { margin-top:10px; padding-top:14px; border-top:1px solid rgba(255,255,255,.25); }
.boq-grand span { display:block; margin-bottom:4px; font-size:11px; opacity:.72; }
.boq-grand strong { display:block; font-size:27px; line-height:1.08; font-variant-numeric:tabular-nums; }
.boq-grand small { display:block; margin-top:5px; font-size:10px; opacity:.68; }
.boq-control-row { display:grid; grid-template-columns:1fr 84px; gap:10px; align-items:end; margin-bottom:11px; }
.boq-discount-type-field { margin:-2px 0 11px; }
.boq-compact-field select { width:100%; min-height:39px; padding:8px 10px; border:1px solid var(--boq-line); border-radius:7px; background:var(--boq-surface); color:var(--boq-ink); }
.boq-compact-field input { width:100%; min-height:39px; padding:8px 10px; border:1px solid var(--boq-line); border-radius:7px; background:var(--boq-surface); color:var(--boq-ink); }
.boq-toggle-wrap { display:flex; align-items:center; gap:8px; padding-bottom:8px; }
.boq-toggle { position:relative; width:38px; height:22px; display:inline-block; flex:0 0 auto; }
.boq-toggle input { width:0; height:0; opacity:0; }
.boq-slider { position:absolute; inset:0; border-radius:99px; background:var(--boq-line-strong); transition:.2s; }
.boq-slider::after { content:""; position:absolute; left:3px; top:3px; width:16px; height:16px; border-radius:50%; background:var(--boq-surface); box-shadow:0 1px 3px rgba(0,0,0,.22); transition:.2s; }
.boq-toggle input:checked + .boq-slider { background:var(--boq-brand-dark); }
.boq-toggle input:checked + .boq-slider::after { transform:translateX(16px); }
.boq-toggle-label { font-size:12px; font-weight:700; }
.boq-create-project-wrap { margin:6px 0 11px; padding:10px; border:1px dashed var(--boq-brand-dark); border-radius:8px; background:var(--boq-brand-soft); }
.boq-side-actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:13px; }
.boq-file-note { margin:11px 0 0; color:var(--text-muted); font-size:10px; line-height:1.45; display:block; }
.boq-toast { position:fixed; right:18px; bottom:18px; z-index:60; max-width:min(360px,calc(100vw - 36px)); padding:11px 14px; border-radius:8px; background:var(--boq-ink); color:var(--boq-paper); box-shadow:var(--boq-shadow); font-size:12px; font-weight:700; opacity:0; pointer-events:none; transform:translateY(10px); transition:.2s; }
.boq-toast.show { opacity:1; transform:translateY(0); }
@media (max-width:1120px) {
  .boq-workspace { grid-template-columns:1fr; }
  .boq-side { position:static; grid-template-columns:1fr 1fr; }
}
@media (max-width:820px) {
  .boq-utility { align-items:stretch; flex-direction:column; }
  .boq-header-tools { justify-items:stretch; }
  .boq-header-actions { justify-content:stretch; }
  .boq-header-actions .boq-btn { flex:1; }
  .boq-draft-note { text-align:left; }
  .boq-doc-head { min-height:126px; padding:20px; }
  .boq-brand-label { display:none; }
  .boq-project-fields { grid-template-columns:1fr 1fr; }
  .boq-field:nth-child(2n) { border-right:0; }
  .boq-field:nth-child(-n+4) { border-bottom:1px solid var(--boq-line); }
  .boq-template-strip { align-items:flex-start; flex-direction:column; }
  .boq-templates { justify-content:flex-start; }
  .boq-choice-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .boq-note-picker { grid-template-columns:1fr auto; }
  .boq-custom-note-trigger { grid-column:1 / -1; justify-self:start; }
  .boq-side { grid-template-columns:1fr; }
  .boq-table-wrap { padding:0 11px 13px; }
  .boq-table-wrap thead { display:none; }
  .boq-table-wrap table, .boq-table-wrap tbody { display:block; }
  .boq-item-row { position:relative; display:grid; grid-template-columns:54px 1fr 1fr; gap:8px; padding:14px 0; border-bottom:1px solid var(--boq-line); }
  .boq-item-row td { display:block; padding:0; border:0; }
  .boq-item-row td::before { content:attr(data-label); display:block; min-height:14px; margin:0 0 4px 2px; color:var(--text-muted); font-size:9px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
  .boq-item-row td:nth-child(1) { grid-row:span 2; }
  .boq-item-row td:nth-child(2), .boq-item-row td:nth-child(3), .boq-item-row td:nth-child(4) { grid-column:2 / -1; }
  .boq-item-row td:nth-child(7) { grid-column:2 / -1; }
  .boq-item-row td:nth-child(8) { grid-column:2 / -1; display:flex; align-items:center; justify-content:space-between; padding:5px 8px; background:var(--boq-surface-2); border-radius:6px; }
  .boq-item-row td:nth-child(8)::before { content:"Total"; margin:0; }
  .boq-item-row td:last-child { position:absolute; right:1px; top:8px; }
  .boq-breakdown-row { display:block; }
  .boq-breakdown-row td { display:block; padding:0 0 12px; border:0; }
  .boq-cost-head { display:none; }
  .boq-cost-row { grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px 9px; padding:9px; border:1px solid var(--boq-line); border-radius:7px; background:var(--boq-surface); }
  .boq-cost-cell::before { content:attr(data-label); display:block; margin:0 0 4px 1px; color:var(--text-muted); font-size:8px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
  .boq-cost-cell:first-child { grid-column:1 / -1; }
  .boq-cost-total { align-self:end; min-height:34px; padding:9px 7px 0; border-bottom:1px solid var(--boq-line); }
  .boq-cost-row .boq-remove-cost { align-self:end; justify-self:end; }
  .boq-cost-subtotal { padding-right:8px; }
  .boq-item-manual { font-weight:700; }
  .boq-empty-row { display:block; }
}
@media (max-width:520px) {
  .boq-doc-head { align-items:flex-start; min-height:118px; }
  .boq-mark { width:50px; font-size:30px; }
  .boq-doc-title h1 { font-size:23px; }
  .boq-project-fields { grid-template-columns:1fr; }
  .boq-field { border-right:0; border-bottom:1px solid var(--boq-line); }
  .boq-field:last-child { border-bottom:0; }
  .boq-choice-grid { grid-template-columns:1fr; }
  .boq-choice-form { grid-template-columns:1fr; }
  .boq-note-picker { grid-template-columns:1fr; }
  .boq-custom-note-form { grid-template-columns:1fr; }
  .boq-cost-row { grid-template-columns:1fr 1fr; }
  .boq-breakdown-head { align-items:flex-start; flex-direction:column; gap:2px; }
  .boq-unit-note { align-items:flex-start; flex-direction:column; gap:3px; }
  .boq-item-row { grid-template-columns:42px 1fr 1fr; }
}
@media (prefers-reduced-motion:reduce) { .boq-root * { transition:none !important; } }
`
