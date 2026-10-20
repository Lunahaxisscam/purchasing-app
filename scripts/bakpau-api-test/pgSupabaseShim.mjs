// ============================================================
// pgSupabaseShim.mjs — klien "Supabase-like" di atas `pg` (HARNESS SAJA)
// ============================================================
// Tujuan: menjalankan jalur CREATE API Bakpau terhadap PostgreSQL NYATA
// (cluster terisolasi), bukan mock. Hanya operasi yang benar-benar dipakai
// boundary bersama + ledger yang diimplementasikan, sehingga tidak ada
// perilaku tersembunyi yang bisa menutupi bug.
//
// BUKAN file produksi. Tidak pernah menyentuh Supabase.
// ============================================================

import pg from 'pg'

const { Pool } = pg

export function createPgClient({ connectionString }) {
  const pool = new Pool({ connectionString, max: 4 })
  const log = []
  const state = { failNextInsert: null }

  function ident(name) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`identifier tidak sah: ${name}`)
    return `"${name}"`
  }

  function colsOf(cols) {
    const c = String(cols || '*').trim()
    if (c === '*' || c === '') return '*'
    return c.split(',').map(s => ident(s.trim())).join(', ')
  }

  function makeBuilder(table) {
    const st = { table, op: 'select', data: null, filters: [], inFilter: null, limit: null, range: null, order: null, returning: false }

    const api = {
      select(cols) {
        if (st.op === 'insert' || st.op === 'update') st.returning = true
        else st.cols = colsOf(cols)
        return api
      },
      insert(d) { st.op = 'insert'; st.data = d; return api },
      update(d) { st.op = 'update'; st.data = d; return api },
      delete() { st.op = 'delete'; return api },
      eq(col, val) { st.filters.push({ col, val, op: '=' }); return api },
      neq(col, val) { st.filters.push({ col, val, op: '<>' }); return api },
      in(col, vals) { st.inFilter = { col, vals }; return api },
      is(col, val) { st.filters.push({ col, val, op: val === null ? 'IS NULL' : 'IS' }); return api },
      ilike(col, val) { st.filters.push({ col, val, op: 'ILIKE' }); return api },
      or() { return api },
      not() { return api },
      order(col, opts) { st.order = { col, asc: !(opts && opts.ascending === false) }; return api },
      limit(n) { st.limit = n; return api },
      range(from, to) { st.range = [from, to]; return api },
      single() { return exec(st) },
      maybeSingle() { return exec(st) },
      then(res, rej) { return exec(st).then(res, rej) },
      catch(rej) { return exec(st).catch(rej) }
    }
    return api
  }

  function whereClause(st, params) {
    const parts = []
    for (const f of st.filters) {
      if (f.op === 'IS NULL' || f.op === 'IS') { parts.push(`${ident(f.col)} ${f.op} ${f.op === 'IS NULL' ? '' : 'NULL'}`.trim()); continue }
      if (f.op === 'ILIKE') { params.push(String(f.val)); parts.push(`${ident(f.col)} ILIKE $${params.length}`); continue }
      params.push(f.val)
      parts.push(`${ident(f.col)} ${f.op} $${params.length}`)
    }
    if (st.inFilter) {
      params.push(st.inFilter.vals)
      parts.push(`${ident(st.inFilter.col)} = ANY($${params.length})`)
    }
    return parts.length ? ` WHERE ${parts.join(' AND ')}` : ''
  }

  async function exec(st) {
    const params = []
    let sql = ''
    try {
      if (st.op === 'select') {
        const where = whereClause(st, params)
        sql = `SELECT ${st.cols || '*'} FROM ${ident(st.table)}${where}`
        if (st.order) sql += ` ORDER BY ${ident(st.order.col)} ${st.order.asc ? 'ASC' : 'DESC'}`
        if (st.range) sql += ` LIMIT ${st.range[1] - st.range[0] + 1} OFFSET ${st.range[0]}`
        else if (st.limit) sql += ` LIMIT ${Number(st.limit)}`
      } else if (st.op === 'insert') {
        const rows = Array.isArray(st.data) ? st.data : [st.data]
        const keys = Object.keys(rows[0])
        const tuples = rows.map(r => {
          const ph = keys.map(k => { params.push(r[k] === undefined ? null : r[k]); return `$${params.length}` })
          return `(${ph.join(', ')})`
        })
        sql = `INSERT INTO ${ident(st.table)} (${keys.map(ident).join(', ')}) VALUES ${tuples.join(', ')} RETURNING *`
      } else if (st.op === 'update') {
        const keys = Object.keys(st.data)
        const sets = keys.map(k => { params.push(st.data[k] === undefined ? null : st.data[k]); return `${ident(k)} = $${params.length}` })
        const where = whereClause(st, params)
        sql = `UPDATE ${ident(st.table)} SET ${sets.join(', ')}${where} RETURNING *`
      } else if (st.op === 'delete') {
        const where = whereClause(st, params)
        sql = `DELETE FROM ${ident(st.table)}${where} RETURNING *`
      }
      log.push({ op: st.op, table: st.table, sql })
      const res = await pool.query(sql, params)
      return { data: res.rows.map(r => normalizeRow(r, res.fields)), error: null, count: res.rowCount }
    } catch (err) {
      log.push({ op: st.op, table: st.table, sql, error: err.message })
      return { data: null, error: { code: err.code, message: err.message, details: err.detail } }
    }
  }

  // PostgREST mengembalikan DATE sebagai "YYYY-MM-DD" dan TIMESTAMP sebagai
  // string ISO — bukan objek Date. Shim menormalkan supaya perbandingan
  // readback di kode produksi berperilaku SAMA dengan produksi.
  function normalizeRow(row, fields) {
    const out = { ...row }
    for (const f of fields || []) {
      const v = out[f.name]
      if (!(v instanceof Date)) continue
      if (f.dataTypeID === 1082) {
        const y = v.getFullYear()
        const m = String(v.getMonth() + 1).padStart(2, '0')
        const d = String(v.getDate()).padStart(2, '0')
        out[f.name] = `${y}-${m}-${d}`
      } else {
        out[f.name] = v.toISOString()
      }
    }
    return out
  }

  return {
    from: table => makeBuilder(table),
    rpc: async () => ({ data: null, error: { message: 'rpc tidak dipakai di harness ini' } }),
    __log: log,
    __state: state,
    async __query(sql, params = []) { return pool.query(sql, params) },
    async __end() { await pool.end() }
  }
}
