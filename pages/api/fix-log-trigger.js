import { Client } from 'pg'

// ============================================================
// ENDPOINT PERBAIKAN ONE-TIME (sementara — akan dihapus setelah dipakai).
// Memperbaiki fungsi trigger log_activity() yang rusak: referensi kolom
// langsung (NEW.role / NEW.status / dst) membuat SEMUA insert gagal di
// tabel yang tidak punya kolom tsb. Versi baru memakai to_jsonb() sehingga
// aman untuk tabel apa pun, dan tidak pernah menggagalkan transaksi utama.
//
// Dilindungi token rahasia (env FIX_TOKEN / query ?token=).
// ============================================================

const FIX_TOKEN = process.env.FIX_LOG_TRIGGER_TOKEN || 'fix-NorQlnM1o1P0SQIv1f2kO9vUlKm3anrDafNM8tytook'

const NEW_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_email text;
  v_detail text;
  v_changes text[];
  v_key text;
  v_new_val text;
  v_old_val text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
    v_old := NULL;
  ELSE
    v_row := to_jsonb(NEW);
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  END IF;

  -- email user yang sedang login (null untuk operasi server/anon)
  BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;
  v_email := COALESCE(v_email, 'system');

  IF TG_OP = 'UPDATE' THEN
    v_changes := ARRAY[]::text[];
    FOR v_key IN SELECT jsonb_object_keys(v_row) LOOP
      IF v_key IN ('updated_at') THEN CONTINUE; END IF;
      v_new_val := v_row->>v_key;
      v_old_val := v_old->>v_key;
      IF v_new_val IS DISTINCT FROM v_old_val THEN
        v_changes := v_changes || (v_key || ': ' || COALESCE(left(v_old_val, 40), '—') || ' → ' || COALESCE(left(v_new_val, 40), '—'));
      END IF;
    END LOOP;
    IF array_length(v_changes, 1) IS NULL THEN
      v_detail := 'Tanpa perubahan nilai';
    ELSE
      v_detail := array_to_string(v_changes, '; ');
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_detail := 'Data baru' || COALESCE(' — ' || left(v_row->>'name', 60), COALESCE(' — ' || left(v_row->>'title', 60), ''));
  ELSE
    v_detail := 'Data dihapus';
  END IF;

  INSERT INTO public.activity_logs (action, entity, user_email, detail)
  VALUES (TG_OP, TG_TABLE_NAME, v_email, left(v_detail, 500));

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Logging TIDAK boleh menggagalkan transaksi utama.
  RETURN COALESCE(NEW, OLD);
END;
$fn$;
`

export default async function handler(req, res) {
  if (!FIX_TOKEN) return res.status(403).json({ error: 'FIX_LOG_TRIGGER_TOKEN belum diset' })
  const provided = req.headers['x-fix-token'] || req.query.token
  if (provided !== FIX_TOKEN) return res.status(401).json({ error: 'Unauthorized' })

  const connectionString = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING
  if (!connectionString) return res.status(500).json({ error: 'No POSTGRES_URL' })

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    const out = {}

    // 1) Info: definisi lama + kolom activity_logs
    const oldDef = await client.query(`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'log_activity' LIMIT 1`)
    out.old_function = oldDef.rows[0] ? oldDef.rows[0].def.slice(0, 2500) : null
    const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='activity_logs' ORDER BY ordinal_position`)
    out.activity_logs_columns = cols.rows.map(r => r.column_name)

    // 2) Terapkan perbaikan
    await client.query(NEW_FUNCTION_SQL)
    out.function_replaced = true

    // 3) Uji: insert + delete dummy project (self-cleaning)
    try {
      await client.query(`INSERT INTO public.projects (kode, code, name, status) VALUES ('__FIXTEST__','__FIXTEST__','__FIXTEST_TRIGGER__','NOT_START')`)
      out.test_insert = 'OK'
      await client.query(`DELETE FROM public.projects WHERE kode = '__FIXTEST__'`)
      out.test_cleanup = 'OK'
    } catch (e) {
      out.test_insert = 'FAILED: ' + e.message
    }

    // 4) Cek trigger masih terpasang
    const trg = await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = (SELECT oid FROM pg_proc WHERE proname='log_activity' LIMIT 1)`)
    out.triggers_using_function = trg.rows[0].n

    await client.end()
    return res.status(200).json({ ok: true, ...out })
  } catch (err) {
    try { await client.end() } catch (e) {}
    return res.status(500).json({ ok: false, error: err.message })
  }
}
