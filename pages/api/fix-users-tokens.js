import { Client } from 'pg'

// ============================================================
// ENDPOINT PERBAIKAN ONE-TIME (sementara — dihapus setelah dipakai).
// Memperbaiki bug RPC admin_create_user: kolom token di auth.users
// (confirmation_token, recovery_token, email_change, email_change_token_new,
// dst) TIDAK punya DEFAULT dan GoTrue crash "Database error querying schema"
// saat login bila nilainya NULL. Fix:
//   1. Isi kolom token = '' untuk SEMUA user yang NULL (termasuk akun test).
//   2. CREATE OR REPLACE admin_create_user — versi baru mengisi token '' saat insert.
//
// Dilindungi token rahasia (env FIX_USERS_TOKEN / query ?token=).
// ============================================================

const FIX_TOKEN = process.env.FIX_USERS_TOKEN || 'fix-UsrTok-9mK2pQ7wL4xZ8nR3vB6tY1sD5hJ0aC'

const FIX_SQL = `
UPDATE auth.users SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, '')
WHERE confirmation_token IS NULL
   OR recovery_token IS NULL
   OR email_change IS NULL
   OR email_change_token_new IS NULL
   OR email_change_token_current IS NULL
   OR phone_change IS NULL
   OR phone_change_token IS NULL
   OR reauthentication_token IS NULL;
`

const CREATE_USER_FN = `
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email text, p_password text, p_full_name text, p_role text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_role text;
  v_email text;
  v_uid uuid := gen_random_uuid();
  v_has_provider_id boolean;
  v_min int := 8;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_admin'); END IF;

  v_email := lower(trim(COALESCE(p_email, '')));
  IF v_email = '' OR v_email !~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;
  IF p_password IS NULL OR length(p_password) < v_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'weak_password', 'min_length', v_min);
  END IF;
  IF COALESCE(p_role, 'user') NOT IN ('admin', 'user') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_role');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email_exists');
  END IF;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', COALESCE(NULLIF(trim(p_full_name), ''), split_part(v_email, '@', 1))),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
  ) INTO v_has_provider_id;

  IF v_has_provider_id THEN
    EXECUTE $sql$
      INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
      VALUES ('email', $1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid())
    $sql$ USING v_uid, v_email;
  ELSE
    EXECUTE $sql$
      INSERT INTO auth.identities (user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
      VALUES ($1, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now(), gen_random_uuid())
    $sql$ USING v_uid, v_email;
  END IF;

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_uid, COALESCE(NULLIF(trim(p_full_name), ''), split_part(v_email, '@', 1)), COALESCE(p_role, 'user'));

  INSERT INTO public.user_credentials (user_id, password_text, updated_at, updated_by)
  VALUES (v_uid, p_password, now(),
          COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), 'admin'));

  RETURN jsonb_build_object('ok', true, 'id', v_uid, 'email', v_email);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'email_exists');
END $fn$;
`

export default async function handler(req, res) {
  if (!FIX_TOKEN) return res.status(403).json({ error: 'FIX_USERS_TOKEN belum diset' })
  const provided = req.headers['x-fix-token'] || req.query.token
  if (provided !== FIX_TOKEN) return res.status(401).json({ error: 'Unauthorized' })

  const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!pgUrl) return res.status(500).json({ error: 'POSTGRES_URL tidak tersedia di env Vercel' })

  // WAJIB: strip sslmode dari connection string (self-signed cert di Vercel).
  const u = new URL(pgUrl)
  u.searchParams.delete('sslmode')
  const client = new Client({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } })

  try {
    await client.connect()
    const r1 = await client.query(FIX_SQL)
    const r2 = await client.query(CREATE_USER_FN)

    // Verifikasi: hitung user yang masih punya token NULL (harus 0)
    const chk = await client.query(`
      SELECT COUNT(*)::int AS null_tokens FROM auth.users
      WHERE confirmation_token IS NULL OR recovery_token IS NULL
         OR email_change IS NULL OR email_change_token_new IS NULL
    `)

    return res.status(200).json({
      ok: true,
      tokens_fixed: r1.rowCount,
      fn_created: !!r2,
      null_tokens_remaining: chk.rows[0].null_tokens
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  } finally {
    try { await client.end() } catch (e) { /* noop */ }
  }
}
