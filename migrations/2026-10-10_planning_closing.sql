-- ============================================================
-- MIGRASI: Modul Project Planning & Closing Proyek (Finance)
-- Tanggal  : 10 Oktober 2026
-- Penulis  : Bamboo (Tech Lead)
-- Brief    : /home/ubuntu/bamboo_task_planning_closing.md
-- ============================================================
-- PRINSIP KEAMANAN:
--   * Kedua tabel KHUSUS ADMIN (RLS admin-only, pola sama dengan
--     project_cost_summary / activity_logs).
--   * Idempotent: aman dijalankan berulang (IF NOT EXISTS / OR REPLACE).
--   * TIDAK menyentuh tabel / trigger eksisting (log_activity aman JSONB).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) TABEL: project_plans (WBS / List Pekerjaan & Penugasan Tukang)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    area TEXT NOT NULL,
    item_name TEXT NOT NULL,
    volume NUMERIC DEFAULT 1,
    unit TEXT DEFAULT 'unit',
    spec TEXT,
    worker_name TEXT,
    worker_type TEXT DEFAULT 'borongan',   -- borongan / harian
    labor_cost NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'Perencanaan',     -- Perencanaan, Fabrikasi WS, Finishing, Instalasi, Selesai
    progress INT DEFAULT 0,
    target_start DATE,
    target_end DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_plans_project ON public.project_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_project_plans_status  ON public.project_plans(status);

-- ------------------------------------------------------------
-- 2) TABEL: project_closings (Snapshot Historis Closing — PERMANEN)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_closings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    project_no TEXT NOT NULL,
    project_name TEXT NOT NULL,
    revenue NUMERIC DEFAULT 0,
    target_budget NUMERIC DEFAULT 0,       -- 70% x revenue
    material_cost NUMERIC DEFAULT 0,
    petty_cash_cost NUMERIC DEFAULT 0,
    labor_cost NUMERIC DEFAULT 0,
    total_cost NUMERIC DEFAULT 0,
    margin_nominal NUMERIC DEFAULT 0,
    margin_percentage NUMERIC DEFAULT 0,
    labor_ratio NUMERIC DEFAULT 0,
    notes TEXT,
    closed_at TIMESTAMPTZ DEFAULT NOW(),
    closed_by TEXT
);

-- Snapshot permanen = maksimal 1 closing per proyek (dijamin level DB).
CREATE UNIQUE INDEX IF NOT EXISTS project_closings_project_no_uniq
    ON public.project_closings(project_no);

-- ------------------------------------------------------------
-- 3) KOLOM REVENUE & PETTY CASH pada project_cost_summary
--    (diisi daemon Drive sync — read-only cache)
-- ------------------------------------------------------------
ALTER TABLE public.project_cost_summary
    ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS petty_cash NUMERIC DEFAULT 0;

-- ------------------------------------------------------------
-- 4) RLS: admin-only untuk kedua tabel baru
-- ------------------------------------------------------------
ALTER TABLE public.project_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_plans_admin_all ON public.project_plans;
CREATE POLICY project_plans_admin_all ON public.project_plans
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS project_closings_admin_all ON public.project_closings;
CREATE POLICY project_closings_admin_all ON public.project_closings
    FOR ALL
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ------------------------------------------------------------
-- 5) GRANT (selaras pola tabel admin-only lain)
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_plans    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_closings TO authenticated;

-- ------------------------------------------------------------
-- 6) RPC: close_project — atomic & idempotent (kunci snapshot permanen)
--    * Guard admin (defense-in-depth di atas RLS).
--    * Derived fields dihitung SERVER-SIDE (target 70%, total, margin, rasio).
--    * ON CONFLICT (project_no) DO NOTHING → aman dobel-klik / 2 admin.
--    * Memindahkan proyek ke arsip Past Project (status DONE) —
--      sesuai konsep: closing = proyek selesai & diarsipkan.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_project(
    p_project_id UUID,
    p_project_no TEXT,
    p_project_name TEXT,
    p_revenue NUMERIC,
    p_material_cost NUMERIC,
    p_petty_cash_cost NUMERIC,
    p_labor_cost NUMERIC,
    p_notes TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_email TEXT;
    v_target NUMERIC;
    v_total NUMERIC;
    v_margin NUMERIC;
    v_margin_pct NUMERIC;
    v_labor_ratio NUMERIC;
    v_id UUID;
BEGIN
    SELECT (p.role = 'admin') INTO v_is_admin
    FROM public.profiles p WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, FALSE) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
    END IF;

    SELECT COALESCE(u.email, 'admin') INTO v_email
    FROM auth.users u WHERE u.id = auth.uid();
    v_email := COALESCE(v_email, 'admin');

    v_target      := COALESCE(p_revenue, 0) * 0.7;
    v_total       := COALESCE(p_material_cost, 0) + COALESCE(p_petty_cash_cost, 0) + COALESCE(p_labor_cost, 0);
    v_margin      := COALESCE(p_revenue, 0) - v_total;
    v_margin_pct  := CASE WHEN COALESCE(p_revenue, 0) = 0 THEN 0 ELSE (v_margin / p_revenue) * 100 END;
    v_labor_ratio := CASE WHEN v_total = 0 THEN 0 ELSE (COALESCE(p_labor_cost, 0) / v_total) * 100 END;

    INSERT INTO public.project_closings (
        project_id, project_no, project_name,
        revenue, target_budget, material_cost, petty_cash_cost, labor_cost,
        total_cost, margin_nominal, margin_percentage, labor_ratio,
        notes, closed_by
    ) VALUES (
        p_project_id, p_project_no, p_project_name,
        COALESCE(p_revenue, 0), v_target, COALESCE(p_material_cost, 0), COALESCE(p_petty_cash_cost, 0), COALESCE(p_labor_cost, 0),
        v_total, v_margin, v_margin_pct, v_labor_ratio,
        p_notes, v_email
    )
    ON CONFLICT (project_no) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_closed');
    END IF;

    -- Arsipkan proyek (masuk Past Project).
    UPDATE public.projects SET status = 'DONE'
    WHERE id = p_project_id AND status IS DISTINCT FROM 'DONE';

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_id,
        'total_cost', v_total,
        'margin_nominal', v_margin,
        'margin_percentage', v_margin_pct,
        'labor_ratio', v_labor_ratio,
        'under_budget', v_total <= v_target
    );
END;
$$;

REVOKE ALL ON FUNCTION public.close_project(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_project(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7) RPC: sync_write_cost_summary (DIPERBARUI) — + revenue & petty_cash
--    Tetap token-gated (kompatibel daemon existing). Kolom baru default 0,
--    sehingga daemon lama tetap jalan; daemon baru mengisi nilai riil.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_write_cost_summary(p_token text, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tok text;
  r jsonb;
  n integer := 0;
BEGIN
  SELECT v INTO v_tok FROM public.private_secrets WHERE k = 'drive_sync_token';
  IF v_tok IS NULL OR p_token IS DISTINCT FROM v_tok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    INSERT INTO public.project_cost_summary (
      project_no, project_name, project_status,
      current_week_expense, cumulative_cost, total_paid, outstanding,
      pending_verification, last_report_date, revenue, petty_cash, synced_at
    ) VALUES (
      r->>'project_no', r->>'project_name', r->>'project_status',
      (r->>'current_week_expense')::numeric, (r->>'cumulative_cost')::numeric,
      (r->>'total_paid')::numeric, (r->>'outstanding')::numeric,
      (r->>'pending_verification')::numeric, (r->>'last_report_date')::date,
      COALESCE(NULLIF(r->>'revenue','')::numeric, 0), COALESCE(NULLIF(r->>'petty_cash','')::numeric, 0), now()
    )
    ON CONFLICT (project_no) DO UPDATE SET
      project_name = EXCLUDED.project_name,
      project_status = EXCLUDED.project_status,
      current_week_expense = EXCLUDED.current_week_expense,
      cumulative_cost = EXCLUDED.cumulative_cost,
      total_paid = EXCLUDED.total_paid,
      outstanding = EXCLUDED.outstanding,
      pending_verification = EXCLUDED.pending_verification,
      last_report_date = EXCLUDED.last_report_date,
      -- Hanya timpa bila key dikirim daemon; kalau tidak, pertahankan nilai lama
      -- (melindungi data saat sumber revenue/petty cash gagal dibaca).
      revenue = CASE WHEN r ? 'revenue' THEN COALESCE(NULLIF(r->>'revenue','')::numeric, 0) ELSE public.project_cost_summary.revenue END,
      petty_cash = CASE WHEN r ? 'petty_cash' THEN COALESCE(NULLIF(r->>'petty_cash','')::numeric, 0) ELSE public.project_cost_summary.petty_cash END,
      synced_at = now();
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'rows', n);
END
$function$;

-- ------------------------------------------------------------
-- 8) Trigger updated_at untuk project_plans
--    Nama fungsi SPESIFIK (bukan generik) supaya tidak pernah
--    menimpa fungsi umum milik tabel lain bila nama sama.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_project_plans_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_plans_touch ON public.project_plans;
CREATE TRIGGER trg_project_plans_touch
    BEFORE UPDATE ON public.project_plans
    FOR EACH ROW EXECUTE FUNCTION public.fn_project_plans_touch_updated_at();

-- ------------------------------------------------------------
-- 9) SNAPSHOT PERMANEN: tolak UPDATE/DELETE pada project_closings
--    (L5) — walaupun admin, riwayat closing tidak boleh berubah
--    lewat API. Break-glass lewat SQL Editor (role postgres)
--    tetap diizinkan untuk koreksi darurat.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_project_closings_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'project_closings bersifat PERMANEN — baris snapshot tidak boleh diubah/dihapus.';
END;
$$;

DROP TRIGGER IF EXISTS trg_project_closings_immutable ON public.project_closings;
CREATE TRIGGER trg_project_closings_immutable
    BEFORE UPDATE OR DELETE ON public.project_closings
    FOR EACH ROW EXECUTE FUNCTION public.fn_project_closings_immutable();

-- Catatan: trigger ini juga memblokir UPDATE dari RPC close_project,
-- tetapi RPC hanya melakukan INSERT (ON CONFLICT DO NOTHING) — aman.

-- Bersihkan fungsi generik lama yang dibuat versi awal migrasi ini
-- (sudah tidak dipakai trigger mana pun setelah rename di atas).
DROP FUNCTION IF EXISTS public.touch_updated_at();

COMMIT;

-- ============================================================
-- ROLLBACK (bila perlu membatalkan migrasi ini):
--   DROP TRIGGER IF EXISTS trg_project_closings_immutable ON public.project_closings;
--   DROP TRIGGER IF EXISTS trg_project_plans_touch ON public.project_plans;
--   DROP FUNCTION IF EXISTS public.fn_project_closings_immutable();
--   DROP FUNCTION IF EXISTS public.fn_project_plans_touch_updated_at();
--   DROP FUNCTION IF EXISTS public.close_project(UUID,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,NUMERIC,TEXT);
--   DROP TABLE IF EXISTS public.project_closings;
--   DROP TABLE IF EXISTS public.project_plans;
--   ALTER TABLE public.project_cost_summary DROP COLUMN IF EXISTS revenue, DROP COLUMN IF EXISTS petty_cash;
-- ============================================================
