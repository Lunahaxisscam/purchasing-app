-- ============================================================
-- MIGRASI: Settings — Kelola Akun (tambah akun, lihat & ubah password)
-- Tanggal  : 11 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Permintaan user: "tambahkan fitur lihat password, ubah password, dan tambah akun"
--
-- CATATAN KEAMANAN (dibaca dulu):
--   * Auth Supabase menyimpan password sebagai HASH (tidak bisa dibaca ulang).
--     Karena itu fitur "Lihat Password" menampilkan password dari tabel
--     `user_credentials` — password yang DICATAT saat dibuat/diubah lewat
--     halaman Settings ini. Akun lama (dibuat sebelum fitur ini) tidak punya
--     catatan → tampil "(belum tercatat)" dan bisa di-set ulang via Ubah Password.
--   * `user_credentials` KHUSUS ADMIN (RLS) dan hanya diakses via RPC guard admin.
--   * Semua RPC di bawah: SECURITY DEFINER + guard admin + search_path aman.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) TABEL: user_credentials (catatan password utk fitur Lihat Password)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_credentials (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    password_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

-- Tidak ada policy untuk client — akses HANYA via RPC SECURITY DEFINER di bawah.
REVOKE ALL ON public.user_credentials FROM anon, authenticated;

-- ------------------------------------------------------------
-- 2) RPC: admin_list_users (DIPERBARUI — tambah has_password & password_updated_at)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_admin'); END IF;
  RETURN jsonb_build_object('ok', true, 'users', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'email', u.email, 'full_name', p.full_name, 'role', p.role, 'created_at', p.created_at,
        'has_password', (uc.user_id IS NOT NULL),
        'password_updated_at', uc.updated_at
      ) ORDER BY p.created_at)
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.user_credentials uc ON uc.user_id = p.id), '[]'::jsonb));
END $fn$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) RPC: admin_get_user_password — tampilkan password tercatat (admin-only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_user_password(p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_role text; v_pw text; v_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_admin'); END IF;
  SELECT password_text, updated_at INTO v_pw, v_at FROM public.user_credentials WHERE user_id = p_target_id;
  IF v_pw IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;
  RETURN jsonb_build_object('ok', true, 'found', true, 'password', v_pw, 'updated_at', v_at);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_get_user_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_password(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) RPC: admin_set_user_password — ubah password akun + catat (admin-only)
--    Hash memakai bcrypt via pgcrypto (schema extensions).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_target_id uuid, p_new_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_role text; v_email text; v_min int := 8;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated'); END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'admin' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_admin'); END IF;
  IF p_new_password IS NULL OR length(p_new_password) < v_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'weak_password', 'min_length', v_min);
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = p_target_id;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = p_target_id;

  INSERT INTO public.user_credentials (user_id, password_text, updated_at, updated_by)
  VALUES (p_target_id, p_new_password, now(),
          COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), 'admin'))
  ON CONFLICT (user_id) DO UPDATE
    SET password_text = EXCLUDED.password_text,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object('ok', true, 'email', v_email);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_set_user_password(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5) RPC: admin_create_user — buat akun baru (admin-only, email auto-confirmed)
--    Insert ke auth.users + identities + profiles + user_credentials.
--    Tahan terhadap DUA skema identities (provider_id baru / provider lama).
-- ------------------------------------------------------------
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
  IF v_email = '' OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
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

  -- 1. auth.users (email langsung terkonfirmasi — dibuat oleh admin)
  --    PENTING: kolom token (confirmation_token, recovery_token, email_change,
  --    email_change_token_new) TIDAK punya DEFAULT di DB ini dan GoTrue crash
  --    ("Database error querying schema") bila nilainya NULL saat login.
  --    WAJIB diisi string kosong ''.
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

  -- 2. auth.identities — cek kolom provider_id (Supabase baru) vs provider (lama)
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

  -- 3. profiles
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_uid, COALESCE(NULLIF(trim(p_full_name), ''), split_part(v_email, '@', 1)), COALESCE(p_role, 'user'));

  -- 4. catat password utk fitur Lihat Password
  INSERT INTO public.user_credentials (user_id, password_text, updated_at, updated_by)
  VALUES (v_uid, p_password, now(),
          COALESCE((SELECT email FROM auth.users WHERE id = auth.uid()), 'admin'));

  RETURN jsonb_build_object('ok', true, 'id', v_uid, 'email', v_email);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'email_exists');
END $fn$;
REVOKE ALL ON FUNCTION public.admin_create_user(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(text, text, text, text) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.admin_create_user(text, text, text, text);
--   DROP FUNCTION IF EXISTS public.admin_set_user_password(uuid, text);
--   DROP FUNCTION IF EXISTS public.admin_get_user_password(uuid);
--   DROP TABLE IF EXISTS public.user_credentials;
--   (admin_list_users dikembalikan ke versi sebelumnya bila perlu)
-- ============================================================
