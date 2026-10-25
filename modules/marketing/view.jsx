// ============================================================
// modules/marketing/view.jsx — PROTOTYPE MARKETING LEAD PIPELINE
// (t_31a1a9f9)
// ============================================================
// Halaman admin-only, READ-ONLY dari sisi DB: tidak ada INSERT/UPDATE,
// tidak ada tabel baru, tidak ada RPC, tidak ada localStorage.
//
// DARI MANA DATANYA (jujur, tidak dikarang):
// - Lead    : prop `leads` dari host (pages/index.js) atau rows.leads
//             bila host sudah memuatnya lewat loadAll(). Tidak ada
//             sumber? -> capability 'unavailable', dan halaman BILANG
//             itu — bukan papan kosong yang terlihat seperti bug.
// - Customer: prop `customers` (data CRM yang dikirim host). Tidak
//             dikirim -> tautan CRM ditulis "tidak dikirim", BUKAN
//             "tidak ditemukan".
// - Lead baru dari form = DRAF di memori halaman, diberi label
//             "Draf halaman" di setiap kartunya. Tidak ada yang tersimpan.
//
// KEJUJURAN ANGKA & TAHAP:
// - Aksi berikutnya yang kosong = "Belum ada aksi berikutnya", bukan
//   string kosong yang terbaca "tidak ada tindakan".
// - Tanggal aksi yang lewat ditandai "Terlambat" — tidak dihitung 0.
// - Lead dengan tahap yang tidak dikenali ditaruh di ember "Tahap
//   tidak diketahui" — tidak dipaksa masuk New Lead supaya bisa
//   diperbaiki, bukan dihilangkan.
// - Tidak ada lead contoh. Papan kosong berarti kosong.
// ============================================================
import React, { useMemo, useState } from 'react'
import CompactRoot from '../../components/CompactRoot'
import {
  readLeads,
  mergeLeads,
  filterLeads,
  summarizeLeads,
  leadCapability,
  leadSource,
  leadCampaign,
  nextActionText,
  nextActionDue,
  formatDateId,
  customerLink,
  customerLinkText,
  leadKey,
  leadKeyIsUnique,
  leadRowKey,
  leadStage,
  stageLabel,
  stageSelectOptions,
  sourceOptions,
  campaignOptions,
  validateLead,
  emptyForm,
  LEAD_FIELDS,
  STAGE_BUCKETS,
  DATA_LIMITATIONS,
  CAPABILITY_COPY,
  UNAVAILABLE_LABEL,
  DRAFT_LABEL,
  EMPTY_LABEL,
  NEXT_ACTION_UNKNOWN,
  toCsv
} from './logic'

// Kartu tampil per kolom sebelum tombol "Tampilkan semua".
const VISIBLE_PER_STAGE = 6

function fieldText(v, empty = UNAVAILABLE_LABEL) {
  const s = String(v ?? '').trim()
  return s === '' ? empty : s
}

const DUE_COPY = {
  overdue: 'Terlambat',
  today: 'Hari ini',
  later: 'Terjadwal',
  none: null
}

export default function MarketingModule({
  rows = {},
  leads,
  customers,
  today,
  say = () => {}
}) {
  // Sumber lead: prop dulu, lalu rows.leads. undefined/null = host tidak
  // mengirim sumber sama sekali.
  const raw = leads !== undefined && leads !== null ? leads : rows?.leads
  const crmRaw = customers !== undefined && customers !== null ? customers : rows?.customers
  const capability = useMemo(() => leadCapability(raw), [raw])
  const crmKnown = Array.isArray(crmRaw)
  const hostRows = useMemo(() => readLeads(raw), [raw])
  const crmRows = useMemo(() => (crmKnown ? crmRaw : []), [crmKnown, crmRaw])

  const [drafts, setDrafts] = useState([])
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState('all')
  const [source, setSource] = useState('all')
  const [campaign, setCampaign] = useState('all')
  const [detailKey, setDetailKey] = useState(null)
  const [expandedStage, setExpandedStage] = useState(null)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [errors, setErrors] = useState({})
  const [warnings, setWarnings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState(null)

  const all = useMemo(() => mergeLeads(hostRows, drafts), [hostRows, drafts])
  // null = host tidak mengirim data CRM sama sekali. Bukan [] — array
  // kosong membuat customerLink mengira data dikirim lalu kosong
  // (unresolved), padahal yang benar "tidak dikirim" (unknown).
  const crmForLink = useMemo(() => (crmKnown ? crmRows : undefined), [crmKnown, crmRows])
  const filtered = useMemo(
    () => filterLeads({ leads: all, query, stage, source, campaign }),
    [all, query, stage, source, campaign]
  )
  const summary = useMemo(() => summarizeLeads(all, today), [all, today])
  const counts = useMemo(() => {
    const out = {}
    for (const b of STAGE_BUCKETS) out[b.key] = 0
    for (const l of filtered) {
      const k = leadStage(l)
      out[k === null ? 'unknown' : k] += 1
    }
    return out
  }, [filtered])
  const sources = useMemo(() => sourceOptions(all), [all])
  const campaigns = useMemo(() => campaignOptions(all), [all])
  const copy = CAPABILITY_COPY[capability] || CAPABILITY_COPY.empty

  const detail = useMemo(() => {
    const found = all.find(l => leadRowKey(l) === detailKey)
    if (!found) return null
    const link = customerLink(found, crmForLink)
    return {
      key: leadRowKey(found),
      name: found.name,
      stage: stageLabel(leadStage(found)),
      source: leadSource(found),
      campaign: leadCampaign(found),
      nextAction: nextActionText(found),
      nextActionDate: formatDateId(found.next_action_date),
      due: nextActionDue(found, today),
      link,
      fields: LEAD_FIELDS.map(f => ({
        key: f.key,
        label: f.label,
        value:
          f.key === 'stage' ? stageLabel(leadStage(found))
            : f.key === 'next_action_date' ? (formatDateId(found.next_action_date) ?? UNAVAILABLE_LABEL)
              : f.key === 'next_action' ? (nextActionText(found) ?? NEXT_ACTION_UNKNOWN)
                : f.key === 'customer_id' ? fieldText(found.customer_id, 'Belum ditautkan')
                  : fieldText(found[f.key])
      })),
      notes: found.notes,
      created_at: found.created_at ?? null,
      origin: found.origin
    }
  }, [all, detailKey, crmRows, today])

  function resetForm() {
    setForm(emptyForm())
    setErrors({})
    setWarnings([])
    setEditing(null)
  }

  function openAdd(stageKey = 'new_lead') {
    resetForm()
    setForm(prev => ({ ...prev, stage: stageKey }))
    setShowForm(true)
    setNotice(null)
  }

  function openEdit(l) {
    setForm({
      name: l.name || '',
      stage: leadStage(l) ?? '',
      source: l.source || '',
      campaign: l.campaign || '',
      next_action: l.next_action || '',
      next_action_date: l.next_action_date || '',
      customer_id: l.customer_id || '',
      notes: l.notes || ''
    })
    setEditing(l)
    setShowForm(true)
    setErrors({})
    setWarnings([])
    setNotice(null)
  }

  function submitForm(e) {
    if (e && e.preventDefault) e.preventDefault()
    const check = validateLead(form, { existing: all, editingId: editing?.id ?? null })
    setErrors(check.errors)
    setWarnings(check.warnings)
    if (!check.ok) return

    const stageKey = String(form.stage || '').trim() || 'new_lead'
    const row = {
      id: editing?.id ?? `draft-${Date.now()}-${drafts.length}`,
      name: form.name.trim(),
      stage: stageKey,
      source: form.source.trim(),
      campaign: form.campaign.trim(),
      next_action: form.next_action.trim(),
      next_action_date: form.next_action_date.trim(),
      customer_id: form.customer_id.trim(),
      notes: form.notes.trim()
    }

    if (editing) {
      const editingKey = leadRowKey(mergeLeads([], [editing])[0])
      setDrafts(prev => prev.map(d => (leadRowKey(mergeLeads([], [d])[0]) === editingKey ? row : d)))
      setNotice(`Perubahan untuk "${row.name}" hanya di memori halaman — tidak tersimpan ke server.`)
      say(`Draft lead "${row.name}" diperbarui (memori halaman saja).`)
    } else {
      setDrafts(prev => [...prev, row])
      setNotice(`"${row.name}" ditambahkan sebagai ${DRAFT_LABEL} — hanya di memori halaman, hilang saat halaman dimuat ulang.`)
      say(`Lead "${row.name}" ditambahkan sebagai draf memori halaman.`)
    }
    setErrors({})
    setForm(emptyForm())
    setEditing(null)
    setShowForm(false)
  }

  function removeDraft(l) {
    const key = leadRowKey(l)
    setDrafts(prev => prev.filter(d => leadRowKey(mergeLeads([], [d])[0]) !== key))
    setNotice(`Draf "${l.name}" dihapus dari memori halaman.`)
    if (detailKey === key) setDetailKey(null)
  }

  function downloadCsv() {
    const csv = toCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    // jsdom (harness test) tidak punya createObjectURL — unduhan via
    // data: URL, tetap jalan di browser sungguhan dan bisa diuji headless.
    const url = typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    const a = document.createElement('a')
    a.href = url
    a.download = 'marketing-leads.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
  }

  return (
    <CompactRoot className="mk-root" data-testid="mk-root" data-capability={capability}>
      <div className="mk-intro">
        <div className="mk-intro-copy">
          <strong>Marketing Lead Pipeline</strong>
          <span>
            Papan prototype untuk lead marketing: New Lead &rarr; Qualified &rarr; RAB &rarr; Won/Lost,
            dengan tag sumber/kampanye, aksi berikutnya, dan tautan ke customer CRM. Halaman ini
            membaca data yang dikirim ke aplikasi — tidak menulis ke database.
          </span>
        </div>
        <div className="mk-header-actions">
          <span className="mk-badge-draft">Baca — tidak ada penulisan ke DB</span>
          <button
            type="button"
            className="mk-btn"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            data-testid="mk-csv"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {/* PANEL KEMAMPUAN — kalau sumber belum ada, ini yang harus terlihat
          lebih dulu. Papan kosong tanpa penjelasan terbaca seperti bug. */}
      {capability !== 'ready' && (
        <div className={`mk-capability mk-capability--${capability}`} data-testid="mk-capability">
          <strong data-testid="mk-capability-title">{copy.title}</strong>
          <span data-testid="mk-capability-body">{copy.body}</span>
        </div>
      )}

      <div className="mk-kpi-grid">
        <div className="mk-kpi-card">
          <span className="mk-kpi-lbl">Lead terdata</span>
          <b className="mk-kpi-val" data-testid="mk-kpi-total">{summary.total}</b>
          <small className="mk-kpi-sub">
            {hostRows.length} dari data yang dikirim · {drafts.length} draf halaman
          </small>
        </div>
        <div className="mk-kpi-card">
          <span className="mk-kpi-lbl">Lead terbuka</span>
          <b className="mk-kpi-val" data-testid="mk-kpi-open">{summary.open}</b>
          <small className="mk-kpi-sub">New Lead, Qualified, RAB</small>
        </div>
        <div className="mk-kpi-card">
          <span className="mk-kpi-lbl">Won / Lost</span>
          <b className="mk-kpi-val" data-testid="mk-kpi-wonlost">{summary.won} / {summary.lost}</b>
          <small className="mk-kpi-sub">tahap penutupan</small>
        </div>
        <div className="mk-kpi-card">
          <span className="mk-kpi-lbl">Aksi terlambat</span>
          <b
            className={summary.overdue > 0 ? 'mk-kpi-val mk-c-warn' : 'mk-kpi-val'}
            data-testid="mk-kpi-overdue"
          >
            {summary.overdue}
          </b>
          <small className="mk-kpi-sub">
            {summary.noNextAction} lead belum ada aksi berikutnya
          </small>
        </div>
      </div>

      <div className="mk-toolbar">
        <label className="mk-field">
          <span>Cari lead</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nama, sumber, kampanye, aksi, catatan, atau ID customer"
            data-testid="mk-search"
          />
        </label>
        <label className="mk-field">
          <span>Tahap</span>
          <select
            value={stage}
            onChange={e => setStage(e.target.value)}
            data-testid="mk-filter-stage"
          >
            <option value="all">Semua tahap</option>
            {STAGE_BUCKETS.map(b => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span>Sumber</span>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            data-testid="mk-filter-source"
          >
            <option value="all">Semua sumber</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="mk-field">
          <span>Kampanye</span>
          <select
            value={campaign}
            onChange={e => setCampaign(e.target.value)}
            data-testid="mk-filter-campaign"
          >
            <option value="all">Semua kampanye</option>
            {campaigns.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mk-btn"
          onClick={() => { setShowForm(v => !v); setErrors({}); setWarnings([]) }}
          data-testid="mk-add-toggle"
        >
          {showForm ? 'Tutup form' : 'Tambah lead'}
        </button>
      </div>

      {notice && (
        <div className="mk-notice" role="status" data-testid="mk-notice">{notice}</div>
      )}

      {/* Peringatan duplikat DI LUAR form: setelah submit sukses form
          tertutup, peringatan harus tetap terbaca — bukan hilang
          bersama form-nya. */}
      {warnings.length > 0 && (
        <ul className="mk-warnings" data-testid="mk-warnings">
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}

      {/* FORM TAMBAH/EDIT — draf memori halaman saja. */}
      {showForm && (
        <form className="mk-form" onSubmit={submitForm} data-testid="mk-form">
          <div className="mk-form-head">
            <strong>{editing ? `Ubah "${editing.name}"` : 'Lead baru'}</strong>
            <span className="mk-form-badge">{DRAFT_LABEL}</span>
          </div>
          <div className="mk-form-grid">
            {LEAD_FIELDS.map(f => (
              <label key={f.key} className={`mk-field mk-field--${f.type}`}>
                <span>
                  {f.label}
                  {f.required && <span className="mk-required" aria-hidden="true">*</span>}
                </span>
                {f.type === 'textarea' ? (
                  <textarea
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={3}
                    data-testid={`mk-input-${f.key}`}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  />
                ) : f.type === 'select' ? (
                  <select
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    data-testid={`mk-input-${f.key}`}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  >
                    {stageSelectOptions().map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    data-testid={`mk-input-${f.key}`}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  />
                )}
                {errors[f.key] && (
                  <small className="mk-error" data-testid={`mk-error-${f.key}`}>{errors[f.key]}</small>
                )}
              </label>
            ))}
          </div>
          <div className="mk-form-actions">
            <button type="submit" className="mk-btn mk-btn--primary" data-testid="mk-submit">
              {editing ? 'Simpan perubahan (memori)' : 'Tambah ke papan (memori)'}
            </button>
            <button
              type="button"
              className="mk-btn"
              onClick={() => { resetForm(); setShowForm(false) }}
              data-testid="mk-cancel"
            >
              Batal
            </button>
            <span className="mk-form-note">
              Tidak ada tabel {`leads`} yang dibuat atau ditulis — perubahan hanya hidup di halaman ini.
            </span>
          </div>
        </form>
      )}

      {/* PAPAN PIPELINE — ember per tahap. */}
      {filtered.length === 0 ? (
        <div className="mk-empty" data-testid="mk-empty">
          {capability === 'unavailable'
            ? 'Sumber lead belum tersedia. Tidak ada lead contoh yang ditampilkan.'
            : all.length === 0
              ? EMPTY_LABEL + '.'
              : 'Tidak ada lead yang cocok dengan filter ini.'}
        </div>
      ) : (
        <div className="mk-board" data-testid="mk-board">
          {STAGE_BUCKETS.map((bucket) => {
            const inBucket = filtered.filter(l => (leadStage(l) ?? 'unknown') === bucket.key)
            const isExpanded = expandedStage === bucket.key
            const visible = isExpanded ? inBucket : inBucket.slice(0, VISIBLE_PER_STAGE)
            return (
              <section
                className="mk-column"
                key={bucket.key}
                data-testid={`mk-column-${bucket.key}`}
                data-stage={bucket.key}
              >
                <header className="mk-column-head">
                  <span className="mk-column-title">{bucket.label}</span>
                  <span className="mk-column-count" data-testid={`mk-count-${bucket.key}`}>
                    {counts[bucket.key] ?? 0}
                  </span>
                </header>
                {bucket.key === 'unknown' && inBucket.length > 0 && (
                  <p className="mk-column-note">
                    Lead di sini punya tahap yang tidak dikenali — perbaiki dari daftar tahap yang sah,
                    bukan dipaksa masuk New Lead.
                  </p>
                )}
                {inBucket.length === 0 ? (
                  <p className="mk-column-empty" data-testid={`mk-column-empty-${bucket.key}`}>
                    {bucket.key === 'unknown' ? 'Tidak ada lead bertahap asing.' : `Tidak ada lead di ${bucket.label}.`}
                  </p>
                ) : (
                  <>
                    <div className="mk-card-list">
                      {visible.map((l) => {
                        const key = leadRowKey(l)
                        // slug harus unik per kartu: dua baris boleh bernama
                        // sama (contoh: draf yang mengulang nama lead host),
                        // dan data-testid kembar membuat test — dan manusia
                        // yang memakai DevTools — tidak bisa membedakannya.
                        // Dasar slug = nama; kalau nama kembar, tambahkan
                        // potongan id supaya tetap beda dan tetap stabil
                        // (tidak bergantung urutan ember).
                        const base = leadKey(l)
                        const slug = leadKeyIsUnique(l, filtered)
                          ? base
                          : `${base}--${String(l?.id ?? 'noid').replace(/[^a-z0-9]+/gi, '').slice(0, 6) || 'x'}`
                        const isDraft = l.origin === 'draft'
                        const link = customerLink(l, crmForLink)
                        const action = nextActionText(l)
                        const due = nextActionDue(l, today)
                        const dueCopy = DUE_COPY[due]
                        return (
                          <article
                            className="mk-card"
                            key={key}
                            data-testid={`mk-card-${slug}`}
                            data-origin={l.origin}
                            data-stage={bucket.key}
                            data-link={link.state}
                            onClick={() => setDetailKey(detailKey === key ? null : key)}
                          >
                            <div className="mk-card-head">
                              <strong className="mk-card-name">{l.name}</strong>
                              {isDraft
                                ? <span className="mk-pill mk-pill-draft">{DRAFT_LABEL}</span>
                                : <span className="mk-pill mk-pill-host">Data host</span>}
                            </div>
                            <dl className="mk-card-meta">
                              <div className="mk-card-row">
                                <dt>Sumber</dt>
                                <dd>
                                  {leadSource(l) === null
                                    ? <span className="mk-missing">{UNAVAILABLE_LABEL}</span>
                                    : leadSource(l)}
                                </dd>
                              </div>
                              <div className="mk-card-row">
                                <dt>Kampanye</dt>
                                <dd>
                                  {leadCampaign(l) === null
                                    ? <span className="mk-missing">{UNAVAILABLE_LABEL}</span>
                                    : leadCampaign(l)}
                                </dd>
                              </div>
                              <div className="mk-card-row">
                                <dt>Aksi berikutnya</dt>
                                <dd data-testid={`mk-action-${slug}`}>
                                  {action === null
                                    ? <span className="mk-missing">{NEXT_ACTION_UNKNOWN}</span>
                                    : action}
                                  {dueCopy && (
                                    <>
                                      {' '}
                                      <span className={`mk-due mk-due--${due}`} data-testid={`mk-due-${slug}`}>
                                        {dueCopy}
                                        {formatDateId(l.next_action_date) ? ` · ${formatDateId(l.next_action_date)}` : ''}
                                      </span>
                                    </>
                                  )}
                                </dd>
                              </div>
                              <div className="mk-card-row">
                                <dt>Tautan CRM</dt>
                                <dd data-testid={`mk-link-${slug}`} className={`mk-link mk-link--${link.state}`}>
                                  {link.text}
                                </dd>
                              </div>
                            </dl>
                            <div className="mk-card-actions">
                              {isDraft ? (
                                <>
                                  <button
                                    type="button"
                                    className="mk-btn-mini"
                                    onClick={e => { e.stopPropagation(); openEdit(l) }}
                                    data-testid={`mk-edit-${slug}`}
                                  >
                                    Ubah
                                  </button>
                                  <button
                                    type="button"
                                    className="mk-btn-mini mk-btn-mini--danger"
                                    onClick={e => { e.stopPropagation(); removeDraft(l) }}
                                    data-testid={`mk-delete-${slug}`}
                                  >
                                    Hapus
                                  </button>
                                </>
                              ) : (
                                <span className="mk-readonly" data-testid={`mk-readonly-${slug}`}>Baca saja</span>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                    {inBucket.length > VISIBLE_PER_STAGE && (
                      <button
                        type="button"
                        className="mk-btn-more"
                        onClick={() => setExpandedStage(isExpanded ? null : bucket.key)}
                        data-testid={`mk-toggle-${bucket.key}`}
                      >
                        {isExpanded
                          ? 'Tampilkan lebih sedikit'
                          : `Tampilkan semua ${inBucket.length} lead`}
                      </button>
                    )}
                  </>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* DRAWER DETAIL — sumber tiap nilai yang ditampilkan di kartu. */}
      {detail && (
        <aside className="mk-drawer" data-testid="mk-drawer" data-row={detail.key}>
          <div className="mk-drawer-head">
            <strong>{detail.name}</strong>
            <button
              type="button"
              className="mk-drawer-close"
              onClick={() => setDetailKey(null)}
              data-testid="mk-drawer-close"
              aria-label="Tutup detail"
            >
              ✕
            </button>
          </div>
          <dl className="mk-drawer-list">
            {detail.fields.map(f => (
              <div key={f.key} className="mk-drawer-row">
                <dt>{f.label}</dt>
                <dd
                  data-present={f.value === UNAVAILABLE_LABEL || f.value === NEXT_ACTION_UNKNOWN ? 'no' : 'yes'}
                  data-testid={`mk-drawer-${f.key}`}
                >
                  {f.value}
                </dd>
              </div>
            ))}
            <div className="mk-drawer-row">
              <dt>Tautan CRM</dt>
              <dd data-testid="mk-drawer-link" className={`mk-link mk-link--${detail.link.state}`}>
                {detail.link.text}
              </dd>
            </div>
            <div className="mk-drawer-row">
              <dt>Asal data</dt>
              <dd>
                {detail.origin === 'draft' ? `${DRAFT_LABEL} (memori halaman)` : 'Baris yang dikirim host — baca saja'}
              </dd>
            </div>
          </dl>
          <p className="mk-drawer-note">
            Aksi berikutnya yang belum ada ditulis &ldquo;{NEXT_ACTION_UNKNOWN}&rdquo; — bukan dibiarkan
            kosong supaya tidak terbaca seperti &ldquo;tidak ada tindakan&rdquo;. Tautan CRM hanya bisa
            diselesaikan kalau host mengirim data customer; kalau tidak, halaman menulis
            &ldquo;tidak dikirim&rdquo;, bukan &ldquo;tidak ditemukan&rdquo;.
          </p>
        </aside>
      )}

      {/* CONTOH PEMAKAIAN SELECTOR — modul lain bisa pakai pola yang sama. */}
      <div className="mk-selector-demo" data-testid="mk-selector-demo">
        <strong>Contoh pemakaian tautan CRM</strong>
        <span>
          Modul lain (mis. Invoice Penjualan) bisa menautkan lead ke customer lewat{' '}
          <code>customer_id</code> yang sama dengan <code>customer.id</code> dari{' '}
          <code>modules/crm/selector.jsx</code>. Pilihan yang tersedia persis data CRM yang dikirim
          host — tidak ada pilihan contoh yang bisa disubmit tanpa data.
        </span>
        <div className="mk-selector-demo-box">
          <select className="mk-selector__input" disabled data-testid="mk-selector-demo-input">
            {crmKnown && crmRows.length > 0
              ? crmRows.slice(0, 5).map(c => (
                <option key={c.id} value={c.id}>{c.name ?? c.customer_name ?? c.nama ?? String(c.id)}</option>
              ))
              : <option value="">
                {crmKnown ? 'Belum ada customer terdata' : 'Data customer CRM tidak dikirim ke halaman ini'}
              </option>}
          </select>
        </div>
      </div>

      <div className="mk-limitations" data-testid="mk-limitations">
        <strong>Batasan tampilan ini</strong>
        <ul>
          {DATA_LIMITATIONS.map(l => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </CompactRoot>
  )
}

// Diekspor supaya modul lain bisa memakai teks yang sama.
export { customerLinkText }
