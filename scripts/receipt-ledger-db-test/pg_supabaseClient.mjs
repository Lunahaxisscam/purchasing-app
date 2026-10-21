// ============================================================
// pg_supabaseClient.mjs — supabase client untuk probe PG NYATA (BUKAN produksi)
// ============================================================
// Dipakai HANYA oleh probe r252. Tujuannya: modul produksi (`receiptEventSave`,
// `duplicateGuardDb`, `createHandover`, `dbErrorText`) dijalankan VERBATIM di
// atas PostgreSQL 16 sungguhan, bukan mock yang selalu menjawab "ok".
//
// Yang diemulasi hanya bentuk API Supabase yang dipakai modul:
//   from(table).select().eq().in().is().maybeSingle()
//   from(table).update(patch).eq().is().select()
//   from(table).delete().eq().select()
//   rpc(fn, params)
//
// Peran sesi diset `authenticated` + `request.jwt.claim.sub` = admin uji,
// sehingga trigger/RLS/GRANT yang sesungguhnya ikut diuji.
// ============================================================
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PGURL = process.env.PGURL
const UID = process.env.PGUID || '90000000-0000-0000-0000-000000000001'

let Client = null
let client = null
let ready = null

function pg() {
  if (!PGURL) throw new Error('PGURL tidak diset — probe PG membutuhkan koneksi.')
  if (!Client) Client = require('pg').Client
  if (!client) client = new Client({ connectionString: PGURL })
  return client
}

async function conn() {
  const c = pg()
  if (!ready) {
    ready = (async () => {
      await c.connect()
      await c.query('set role authenticated')
      await c.query(`select set_config('request.jwt.claim.sub',$1,false)`, [UID])
    })()
  }
  await ready
  return c
}

const ident = (k) => `"${String(k).replace(/"/g, '')}"`

function build(st) {
  const cols = st.cols === '*' ? '*' : String(st.cols).split(',').map(x => x.trim()).filter(Boolean).join(', ')
  let where = ''
  const vals = []
  for (const f of st.filters) {
    if (f.op === 'is') { where += `${where ? ' and ' : ' where '}${ident(f.col)} is null`; continue }
    if (f.op === 'in') { vals.push(f.vals); where += `${where ? ' and ' : ' where '}${ident(f.col)} = any($${vals.length})`; continue }
    vals.push(f.val)
    where += `${where ? ' and ' : ' where '}${ident(f.col)} = $${vals.length}`
  }
  if (st.kind === 'update') {
    const sets = []
    for (const [k, v] of Object.entries(st.patch)) { vals.push(v); sets.push(`${ident(k)} = $${vals.length}`) }
    return { sql: `update public.${st.table} set ${sets.join(', ')}${where} returning ${cols}`, vals }
  }
  if (st.kind === 'delete') return { sql: `delete from public.${st.table}${where} returning ${cols}`, vals }
  return { sql: `select ${cols} from public.${st.table}${where} limit 500`, vals }
}

async function run(st) {
  const db = await conn()
  const { sql, vals } = build(st)
  try {
    const r = await db.query(sql, vals)
    return { data: st.single ? (r.rows[0] || null) : r.rows, error: null }
  } catch (e) {
    return { data: null, error: { code: e.code, message: e.message, details: e.detail || '' } }
  }
}

function makeBuilder(table) {
  const st = { kind: 'select', table, cols: '*', filters: [], patch: {}, single: false }
  const api = {
    select(columns) { if (typeof columns === 'string') st.cols = columns; return api },
    limit() { return api },
    order() { return api },
    eq(col, val) { st.filters.push({ col, val, op: 'eq' }); return api },
    in(col, vals) { st.filters.push({ col, vals, op: 'in' }); return api },
    is(col, val) { st.filters.push({ col, val, op: 'is' }); return api },
    neq(col, val) { st.filters.push({ col, val, op: 'neq' }); return api },
    update(patch) { st.kind = 'update'; st.patch = patch; return api },
    delete() { st.kind = 'delete'; return api },
    insert(rows) { st.kind = 'insert'; st.rows = rows; return api },
    maybeSingle() { st.single = true; return api },
    single() { st.single = true; return api },
    then(res, rej) { return Promise.resolve(run(st)).then(res, rej) },
    catch(rej) { return Promise.resolve(run(st)).catch(rej) }
  }
  return api
}

export const supabase = {
  from: (table) => makeBuilder(table),
  async rpc(fn, params) {
    const db = await conn()
    const keys = Object.keys(params || {})
    const args = keys.map((k, i) => `${k} => $${i + 1}${params[k] !== null && typeof params[k] === 'object' ? '::jsonb' : ''}`)
    const vals = keys.map(k => (params[k] !== null && typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]))
    try {
      const { rows } = await db.query(`select public.${fn}(${args.join(', ')}) as out`, vals)
      return { data: rows[0]?.out ?? null, error: null }
    } catch (e) {
      return { data: null, error: { code: e.code, message: e.message } }
    }
  }
}

export async function __close() {
  if (client) { try { await client.end() } catch (e) { /* abaikan */ } }
}
