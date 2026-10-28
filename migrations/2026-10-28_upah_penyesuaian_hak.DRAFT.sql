-- ============================================================
-- migrations/2026-10-28_upah_penyesuaian_hak.DRAFT.sql
-- DRAFT ADDITIVE SCHEMA: Penyesuaian Hak Upah Antar-Totalan (Signed Rights Carryover)
-- PERINGATAN: File ini adalah DRAFT. JANGAN jalankan di database produksi
-- tanpa otorisasi DDL terpisah dari DAT!
-- ============================================================

-- 1. Kolom aditif di tabel upah_totalan (nullable / default 0, aman tanpa merusak baris lama)
ALTER TABLE public.upah_totalan
  ADD COLUMN IF NOT EXISTS carried_residual numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_adjustment numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS residual_before_carry numeric DEFAULT 0;

-- 2. Tabel penyesuaian hak upah (pair-linked transfer record)
CREATE TABLE IF NOT EXISTS public.upah_penyesuaian (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tukang_id uuid NOT NULL REFERENCES public.upah_tukang(id) ON DELETE RESTRICT,
  source_totalan_id uuid REFERENCES public.upah_totalan(id) ON DELETE SET NULL,
  destination_totalan_id uuid REFERENCES public.upah_totalan(id) ON DELETE SET NULL,
  tipe text NOT NULL CHECK (tipe IN ('CARRY_TOTALAN', 'MANUAL_PENYESUAIAN')),
  nominal numeric NOT NULL CHECK (nominal <> 0),
  alasan text NOT NULL,
  actor text NOT NULL,
  tanggal date NOT NULL DEFAULT CURRENT_DATE,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'REVERSED')),
  consumed_at timestamptz,
  reversed_at timestamptz,
  reversed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indeks performa & relasi
CREATE INDEX IF NOT EXISTS idx_upah_penyesuaian_tukang ON public.upah_penyesuaian(tukang_id, status);
CREATE INDEX IF NOT EXISTS idx_upah_penyesuaian_source ON public.upah_penyesuaian(source_totalan_id);
CREATE INDEX IF NOT EXISTS idx_upah_penyesuaian_dest ON public.upah_penyesuaian(destination_totalan_id);
CREATE UNIQUE INDEX IF NOT EXISTS upah_penyesuaian_one_carry_source
  ON public.upah_penyesuaian(source_totalan_id) WHERE tipe='CARRY_TOTALAN';
GRANT SELECT, INSERT, UPDATE ON public.upah_penyesuaian TO authenticated;
REVOKE ALL ON public.upah_penyesuaian FROM anon;

-- 3. Row Level Security (RLS)
ALTER TABLE public.upah_penyesuaian ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upah_penyesuaian_admin_select ON public.upah_penyesuaian;
CREATE POLICY upah_penyesuaian_admin_select ON public.upah_penyesuaian
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS upah_penyesuaian_admin_insert ON public.upah_penyesuaian;
CREATE POLICY upah_penyesuaian_admin_insert ON public.upah_penyesuaian
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS upah_penyesuaian_admin_update ON public.upah_penyesuaian;
CREATE POLICY upah_penyesuaian_admin_update ON public.upah_penyesuaian
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 4. Atomic RPC: Carry Totalan Residual ke Hak Berjalan
CREATE OR REPLACE FUNCTION public.upah_carry_totalan_residual(
  p_source_totalan_id uuid,
  p_alasan text,
  p_actor text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_role text;
  v_totalan record;
  v_residual numeric;
  v_key text;
  v_existing record;
  v_adj_id uuid;
BEGIN
  -- Cek hak akses admin
  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor_id;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'admin_required: Hanya administrator yang dapat melakukan carry-over residual totalan'
      USING ERRCODE = '42501';
  END IF;

  -- Kunci baris totalan untuk update (mencegah race condition)
  SELECT * INTO v_totalan
  FROM public.upah_totalan
  WHERE id = p_source_totalan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'totalan_not_found: Totalan sumber % tidak ditemukan', p_source_totalan_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Hitung residual sebelum carry
  -- residual = hak_bersih - pembayaran_aktual
  v_residual := COALESCE(v_totalan.hak_bersih, 0) - COALESCE(v_totalan.pembayaran_aktual, 0);

  IF v_residual = 0 THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_ZERO',
      'message', 'Totalan sudah lunas persis (residual = 0), tidak perlu carry-over',
      'totalan_id', p_source_totalan_id
    );
  END IF;

  v_key := COALESCE(NULLIF(TRIM(p_idempotency_key), ''), 'carry:totalan:' || p_source_totalan_id::text);

  -- Cek Idempotensi
  SELECT * INTO v_existing
  FROM public.upah_penyesuaian
  WHERE idempotency_key = v_key;

  IF FOUND THEN
    IF v_existing.source_totalan_id IS DISTINCT FROM p_source_totalan_id THEN
      RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object(
      'status', 'REPLAY',
      'adjustment_id', v_existing.id,
      'nominal', v_existing.nominal,
      'idempotency_key', v_existing.idempotency_key,
      'message', 'Operasi diabaikan karena idempotency key sudah ada'
    );
  END IF;

  SELECT * INTO v_existing FROM public.upah_penyesuaian
  WHERE source_totalan_id=p_source_totalan_id AND tipe='CARRY_TOTALAN';
  IF FOUND THEN
    RETURN jsonb_build_object('status','REPLAY','adjustment_id',v_existing.id,'nominal',v_existing.nominal);
  END IF;
  IF COALESCE(v_totalan.final,false) THEN
    RAISE EXCEPTION 'historical upah record is final and locked' USING ERRCODE='42501';
  END IF;

  -- Insert record transfer penyesuaian hak upah
  INSERT INTO public.upah_penyesuaian (
    tukang_id,
    source_totalan_id,
    destination_totalan_id,
    tipe,
    nominal,
    alasan,
    actor,
    tanggal,
    idempotency_key,
    status
  ) VALUES (
    v_totalan.tukang_id,
    p_source_totalan_id,
    NULL,
    'CARRY_TOTALAN',
    v_residual,
    COALESCE(NULLIF(TRIM(p_alasan), ''), 'Carry-over sisa saldo totalan ' || COALESCE(v_totalan.no_totalan, '')),
    COALESCE(NULLIF(TRIM(p_actor), ''), 'admin'),
    COALESCE(v_totalan.tanggal, CURRENT_DATE),
    v_key,
    'ACTIVE'
  )
  RETURNING id INTO v_adj_id;

  -- Update totalan sumber menjadi lunas sempurna (saldo akhir 0)
  UPDATE public.upah_totalan
  SET
    carried_residual = v_residual,
    residual_before_carry = v_residual,
    saldo_akhir = 0,
    status = 'Lunas',
    final = TRUE,
    updated_at = now()
  WHERE id = p_source_totalan_id;

  INSERT INTO public.activity_logs(user_id,user_email,action,entity,entity_id,detail)
  VALUES(v_actor_id,COALESCE(auth.jwt()->>'email','admin'),'UPAH_CARRY_RESIDUAL','upah_totalan',p_source_totalan_id::text,
    jsonb_build_object('nominal',v_residual,'adjustment_id',v_adj_id,'idempotency_key',v_key,'alasan',p_alasan)::text);

  RETURN jsonb_build_object(
    'status', 'SUCCESS',
    'adjustment_id', v_adj_id,
    'source_totalan_id', p_source_totalan_id,
    'nominal', v_residual,
    'saldo_akhir', 0,
    'totalan_status', 'Lunas',
    'idempotency_key', v_key
  );
END;
$$;

-- Hak eksekusi RPC
REVOKE ALL ON FUNCTION public.upah_carry_totalan_residual(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upah_carry_totalan_residual(uuid, text, text, text) TO authenticated;

-- ============================================================
-- DRAFT ROLLBACK SCRIPT (jika perlu dibatalkan)
-- ============================================================
-- DROP FUNCTION IF EXISTS public.upah_carry_totalan_residual(uuid, text, text, text);
-- DROP TABLE IF EXISTS public.upah_penyesuaian CASCADE;
-- ALTER TABLE public.upah_totalan
--   DROP COLUMN IF EXISTS carried_residual,
--   DROP COLUMN IF EXISTS opening_adjustment,
--   DROP COLUMN IF EXISTS residual_before_carry;
