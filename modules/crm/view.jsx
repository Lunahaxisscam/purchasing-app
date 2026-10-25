// ============================================================
// modules/crm/view.jsx — CUSTOMER CRM MINIMAL (t_7253b859)
// ============================================================
// Halaman admin-only, READ-ONLY dari sisi DB: tidak ada INSERT/UPDATE,
// tidak ada tabel baru, tidak ada RPC, tidak ada localStorage.
//
// DARI MANA DATANYA (jujur, tidak dikarang):
// - Customer : prop `customers` dari host (pages/index.js) atau
//              rows.customers bila host sudah memuatnya lewat loadAll().
//              Tidak ada sumber? -> capability 'unavailable', dan
//              halaman BILANG itu — bukan daftar kosong yang terlihat
//              seperti bug.
// - Hitungan rujukan invoice: prop `invoiceCounts` = { <customer_id>: n }.
//              Tidak dikirim -> "Relasi invoice tidak dikirim ke halaman ini",
//              BUKAN 0 (0 akan terbaca "tidak pernah dirujuk").
// - Customer baru dari form = DRAF di memori halaman, diberi label
//              "Draf halaman" di setiap barisnya. Tidak ada yang tersimpan.
//
// KEJUJURAN ANGKA:
// - Kontak kosong = "Tidak tersedia", bukan string kosong yang terbaca
//   seperti "tidak perlu dihubungi".
// - Tidak ada customer contoh. Kosong berarti kosong.
// ============================================================
import React, { useMemo, useState } from 'react'
import CompactRoot from '../../components/CompactRoot'
import {
  readCustomers,
  mergeCustomers,
  filterCustomers,
  summarizeCustomers,
  customerCapability,
  customerContact,
  customerSource,
  customerKey,
  customerRowKey,
  customerLabel,
  sourceOptions,
  relationCount,
  relationText,
  validateCustomer,
  emptyForm,
  CUSTOMER_FIELDS,
  DATA_LIMITATIONS,
  CAPABILITY_COPY,
  UNAVAILABLE_LABEL,
  DRAFT_LABEL,
  SELECTOR_EMPTY_LABEL,
  toCsv
} from './logic'

const VISIBLE = 8

// Teks field untuk tabel & detail drawer — satu tempat.
function fieldText(c, key) {
  const v = String(c?.[key] ?? '').trim()
  return v === '' ? UNAVAILABLE_LABEL : v
}

export default function CrmModule({
  rows = {},
  customers,
  invoiceCounts = null,
  say = () => {}
}) {
  // Sumber customer: prop dulu, lalu rows.customers. undefined/null =
  // host tidak mengirim sumber sama sekali.
  const raw = customers !== undefined && customers !== null ? customers : rows?.customers
  const capability = useMemo(() => customerCapability(raw), [raw])
  const hostRows = useMemo(() => readCustomers(raw), [raw])

  const [drafts, setDrafts] = useState([])
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [expanded, setExpanded] = useState(false)
  const [detailKey, setDetailKey] = useState(null)
  const [editing, setEditing] = useState(null) // draft yang sedang diedit
  const [form, setForm] = useState(emptyForm())
  const [errors, setErrors] = useState({})
  const [warnings, setWarnings] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState(null)

  const all = useMemo(() => mergeCustomers(hostRows, drafts), [hostRows, drafts])
  const filtered = useMemo(() => filterCustomers({ customers: all, query, source }), [all, query, source])
  const summary = useMemo(() => summarizeCustomers(all), [all])
  const sources = useMemo(() => sourceOptions(all), [all])
  const copy = CAPABILITY_COPY[capability] || CAPABILITY_COPY.empty

  const visibleRows = expanded ? filtered : filtered.slice(0, VISIBLE)
  const detail = useMemo(() => {
    const found = all.find(c => customerRowKey(c) === detailKey)
    if (!found) return null
    return {
      key: customerRowKey(found),
      name: found.name,
      contact: customerContact(found),
      source: customerSource(found),
      origin: found.origin,
      fields: CUSTOMER_FIELDS.map(f => ({ label: f.label, value: fieldText(found, f.key) })),
      relation: relationText(found.id, invoiceCounts),
      relationCount: relationCount(found.id, invoiceCounts),
      created_at: found.created_at ?? null
    }
  }, [all, detailKey, invoiceCounts])

  const countsKnown = invoiceCounts !== null && invoiceCounts !== undefined

  function resetForm() {
    setForm(emptyForm())
    setErrors({})
    setWarnings([])
    setEditing(null)
  }

  function openAdd() {
    resetForm()
    setShowForm(true)
    setNotice(null)
  }

  function openEdit(c) {
    setForm({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      source: c.source || '',
      notes: c.notes || ''
    })
    setEditing(c)
    setShowForm(true)
    setErrors({})
    setWarnings([])
    setNotice(null)
  }

  function submitForm(e) {
    if (e && e.preventDefault) e.preventDefault()
    const check = validateCustomer(form, { existing: all, editingId: editing?.id ?? null })
    setErrors(check.errors)
    setWarnings(check.warnings)
    if (!check.ok) return

    const row = {
      id: editing?.id ?? `draft-${Date.now()}`,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      source: form.source.trim(),
      notes: form.notes.trim()
    }

    if (editing) {
      setDrafts(prev => prev.map(d => (String(d.id) === String(editing.id) ? row : d)))
      setNotice(`Perubahan untuk "${row.name}" hanya di memori halaman — tidak tersimpan ke server.`)
      say(`Draft customer "${row.name}" diperbarui (memori halaman saja).`)
    } else {
      setDrafts(prev => [...prev, row])
      setNotice(`"${row.name}" ditambahkan sebagai ${DRAFT_LABEL} — hanya di memori halaman, hilang saat halaman dimuat ulang.`)
      say(`Customer "${row.name}" ditambahkan sebagai draf memori halaman.`)
    }
    // Warnings TIDAK direset di sini: peringatan "Data mirip customer"
    // harus tetap terbaca setelah form tertutup (dipakai untuk review
    // draft baru), sampai aksi berikutnya menggantinya.
    setErrors({})
    resetFormFields()
    setShowForm(false)
  }

  function resetFormFields() {
    setForm(emptyForm())
    setEditing(null)
  }

  function resetForm() {
    resetFormFields()
    setErrors({})
    setWarnings([])
  }

  function removeDraft(c) {
    setDrafts(prev => prev.filter(d => String(d.id) !== String(c.id)))
    setNotice(`Draf "${c.name}" dihapus dari memori halaman.`)
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
    a.download = 'customer-crm.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
  }

  return (
    <CompactRoot className="crm-root" data-testid="crm-root" data-capability={capability}>
      <div className="crm-intro">
        <div className="crm-intro-copy">
          <strong>Customer CRM</strong>
          <span>
            Daftar customer untuk Noir Living: siapa yang perlu dihubungi, dari mana
            datangnya, dan riwayat singkatnya. Halaman ini membaca data yang dikirim ke
            aplikasi — tidak menulis ke database.
          </span>
        </div>
        <div className="crm-header-actions">
          <span className="crm-badge-draft">Baca — tidak ada penulisan ke DB</span>
          <button
            type="button"
            className="crm-btn"
            onClick={downloadCsv}
            disabled={filtered.length === 0}
            data-testid="crm-csv"
          >
            Unduh CSV
          </button>
        </div>
      </div>

      {/* PANEL KEMAMPUAN — kalau sumber belum ada, ini yang harus terlihat
          lebih dulu. Daftar kosong tanpa penjelasan terbaca seperti bug. */}
      {capability !== 'ready' && (
        <div className={`crm-capability crm-capability--${capability}`} data-testid="crm-capability">
          <strong data-testid="crm-capability-title">{copy.title}</strong>
          <span data-testid="crm-capability-body">{copy.body}</span>
        </div>
      )}

      <div className="crm-kpi-grid">
        <div className="crm-kpi-card">
          <span className="crm-kpi-lbl">Customer terdata</span>
          <b className="crm-kpi-val" data-testid="crm-kpi-total">{summary.total}</b>
          <small className="crm-kpi-sub">
            {hostRows.length} dari data yang dikirim · {drafts.length} draf halaman
          </small>
        </div>
        <div className="crm-kpi-card">
          <span className="crm-kpi-lbl">Punya kontak</span>
          <b className="crm-kpi-val" data-testid="crm-kpi-contact">{summary.withContact}</b>
          <small className="crm-kpi-sub">WA atau email terisi</small>
        </div>
        <div className="crm-kpi-card">
          <span className="crm-kpi-lbl">Tanpa kontak</span>
          <b
            className={summary.withoutContact > 0 ? 'crm-kpi-val crm-c-warn' : 'crm-kpi-val'}
            data-testid="crm-kpi-nocontact"
          >
            {summary.withoutContact}
          </b>
          <small className="crm-kpi-sub">kontak belum terisi</small>
        </div>
        <div className="crm-kpi-card">
          <span className="crm-kpi-lbl">Relasi invoice</span>
          <b className="crm-kpi-val" data-testid="crm-kpi-relation">
            {countsKnown ? 'Dikirim host' : 'Tidak dikirim'}
          </b>
          <small className="crm-kpi-sub">
            {countsKnown
              ? 'hitungan rujukan invoice tersedia'
              : 'modul tidak menghitung 0 untuk data yang tidak dikirim'}
          </small>
        </div>
      </div>

      <div className="crm-toolbar">
        <label className="crm-field">
          <span>Cari customer</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Nama, WA, email, alamat, atau sumber"
            data-testid="crm-search"
          />
        </label>
        <label className="crm-field">
          <span>Sumber</span>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            data-testid="crm-filter-source"
          >
            <option value="all">Semua sumber</option>
            {sources.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="crm-btn"
          onClick={() => { setShowForm(v => !v); setErrors({}); setWarnings([]) }}
          data-testid="crm-add-toggle"
        >
          {showForm ? 'Tutup form' : 'Tambah customer'}
        </button>
      </div>

      {notice && (
        <div className="crm-notice" role="status" data-testid="crm-notice">{notice}</div>
      )}

      {/* Peringatan duplikat DI LUAR form: setelah submit sukses form
          tertutup, peringatan harus tetap terbaca — bukan hilang
          bersama form-nya. */}
      {warnings.length > 0 && (
        <ul className="crm-warnings" data-testid="crm-warnings">
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}

      {/* FORM TAMBAH/EDIT — draf memori halaman saja. */}
      {showForm && (
        <form className="crm-form" onSubmit={submitForm} data-testid="crm-form">
          <div className="crm-form-head">
            <strong>{editing ? `Ubah "${editing.name}"` : 'Customer baru'}</strong>
            <span className="crm-form-badge">{DRAFT_LABEL}</span>
          </div>
          <div className="crm-form-grid">
            {CUSTOMER_FIELDS.map(f => (
              <label key={f.key} className={`crm-field crm-field--${f.type}`}>
                <span>
                  {f.label}
                  {f.required && <span className="crm-required" aria-hidden="true">*</span>}
                </span>
                {f.type === 'textarea' ? (
                  <textarea
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    rows={3}
                    data-testid={`crm-input-${f.key}`}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  />
                ) : (
                  <input
                    type={f.type}
                    value={form[f.key]}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    data-testid={`crm-input-${f.key}`}
                    aria-invalid={errors[f.key] ? 'true' : undefined}
                  />
                )}
                {errors[f.key] && (
                  <small className="crm-error" data-testid={`crm-error-${f.key}`}>{errors[f.key]}</small>
                )}
              </label>
            ))}
          </div>
          <div className="crm-form-actions">
            <button type="submit" className="crm-btn crm-btn--primary" data-testid="crm-submit">
              {editing ? 'Simpan perubahan (memori)' : 'Tambah ke daftar (memori)'}
            </button>
            <button
              type="button"
              className="crm-btn"
              onClick={() => { resetForm(); setShowForm(false) }}
              data-testid="crm-cancel"
            >
              Batal
            </button>
            <span className="crm-form-note">
              Tidak ada tabel {`customers`} yang dibuat atau ditulis — perubahan hanya hidup di halaman ini.
            </span>
          </div>
        </form>
      )}

      {/* TABEL CUSTOMER */}
      {filtered.length === 0 ? (
        <div className="crm-empty" data-testid="crm-empty">
          {capability === 'unavailable'
            ? 'Sumber customer belum tersedia. Tidak ada customer contoh yang ditampilkan.'
            : all.length === 0
              ? SELECTOR_EMPTY_LABEL + '.'
              : 'Tidak ada customer yang cocok dengan pencarian ini.'}
        </div>
      ) : (
        <>
          <div className="crm-table-wrap">
            <table className="crm-table" data-testid="crm-table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Kontak</th>
                  <th>Sumber</th>
                  <th>Relasi invoice</th>
                  <th>Asal data</th>
                  <th aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(c => {
                  const key = customerRowKey(c)
                  const slug = customerKey(c)
                  const contact = customerContact(c)
                  const isDraft = c.origin === 'draft'
                  return (
                    <tr
                      key={key}
                      className={detailKey === key ? 'crm-row crm-row-active' : 'crm-row'}
                      data-testid={`crm-row-${slug}`}
                      data-origin={c.origin}
                      onClick={() => setDetailKey(detailKey === key ? null : key)}
                    >
                      <td>
                        <span className="crm-row-open" aria-hidden="true">
                          {detailKey === key ? '▾' : '▸'}
                        </span>{' '}
                        {c.name}
                      </td>
                      <td>
                        {contact === null
                          ? <span className="crm-missing">{UNAVAILABLE_LABEL}</span>
                          : contact}
                      </td>
                      <td>{customerSource(c) ?? <span className="crm-missing">{UNAVAILABLE_LABEL}</span>}</td>
                      <td data-testid={`crm-relation-${slug}`}>{relationText(c.id, invoiceCounts)}</td>
                      <td>
                        <span className={isDraft ? 'crm-pill crm-pill-draft' : 'crm-pill crm-pill-host'}>
                          {isDraft ? DRAFT_LABEL : 'Data host'}
                        </span>
                      </td>
                      <td className="crm-actions">
                        {isDraft ? (
                          <>
                            <button
                              type="button"
                              className="crm-btn-mini"
                              onClick={e => { e.stopPropagation(); openEdit(c) }}
                              data-testid={`crm-edit-${slug}`}
                            >
                              Ubah
                            </button>
                            <button
                              type="button"
                              className="crm-btn-mini crm-btn-mini--danger"
                              onClick={e => { e.stopPropagation(); removeDraft(c) }}
                              data-testid={`crm-delete-${slug}`}
                            >
                              Hapus
                            </button>
                          </>
                        ) : (
                          <span className="crm-readonly" data-testid={`crm-readonly-${slug}`}>Baca saja</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {filtered.length > VISIBLE && (
            <button
              type="button"
              className="crm-btn-more"
              onClick={() => setExpanded(v => !v)}
              data-testid="crm-toggle"
            >
              {expanded ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${filtered.length} customer`}
            </button>
          )}

          {/* DRAWER DETAIL — sumber tiap field yang ditampilkan di baris. */}
          {detail && (
            <aside className="crm-drawer" data-testid="crm-drawer" data-row={detail.key}>
              <div className="crm-drawer-head">
                <strong>{detail.name}</strong>
                <button
                  type="button"
                  className="crm-drawer-close"
                  onClick={() => setDetailKey(null)}
                  data-testid="crm-drawer-close"
                  aria-label="Tutup detail"
                >
                  ✕
                </button>
              </div>
              <dl className="crm-drawer-list">
                {detail.fields.map(f => (
                  <div key={f.label} className="crm-drawer-row">
                    <dt>{f.label}</dt>
                    <dd data-present={f.value === UNAVAILABLE_LABEL ? 'no' : 'yes'}>{f.value}</dd>
                  </div>
                ))}
                <div className="crm-drawer-row">
                  <dt>Relasi invoice</dt>
                  <dd data-testid="crm-drawer-relation">{detail.relation}</dd>
                </div>
                <div className="crm-drawer-row">
                  <dt>Asal data</dt>
                  <dd>{detail.origin === 'draft' ? `${DRAFT_LABEL} (memori halaman)` : 'Baris yang dikirim host — baca saja'}</dd>
                </div>
              </dl>
              <p className="crm-drawer-note">
                Kontak tidak terisi ditulis &ldquo;{UNAVAILABLE_LABEL}&rdquo; — bukan dibiarkan kosong
                supaya tidak terbaca seperti &ldquo;tidak perlu dihubungi&rdquo;.
              </p>
            </aside>
          )}
        </>
      )}

      {/* SELECTOR CONTOH — modul lain bisa pakai komponen yang sama. */}
      <div className="crm-selector-demo" data-testid="crm-selector-demo">
        <strong>Contoh pemakaian selector</strong>
        <span>
          Modul lain (mis. Invoice Penjualan) bisa memanggil{' '}
          <code>&lt;CustomerSelector customers=&#123;rows.customers&#125; /&gt;</code> dari{' '}
          <code>modules/crm/selector.jsx</code>. Pilihan yang tersedia persis data di atas —
          tidak ada pilihan contoh yang bisa disubmit tanpa data.
        </span>
        <div className="crm-selector-demo-box">
          <select className="crm-selector__input" disabled data-testid="crm-selector-demo-input">
            {capability === 'ready'
              ? filtered.slice(0, 5).map(c => (
                <option key={c.id} value={c.id}>{customerLabel(c)}</option>
              ))
              : <option value="">{SELECTOR_EMPTY_LABEL}</option>}
          </select>
        </div>
      </div>

      <div className="crm-limitations" data-testid="crm-limitations">
        <strong>Batasan tampilan ini</strong>
        <ul>
          {DATA_LIMITATIONS.map(l => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </CompactRoot>
  )
}
