-- ============================================================
-- MIGRASI: Modul Upah & Kasbon — DATABASE MASTER (tanpa sync)
-- Tanggal : 24 Oktober 2026
-- Penulis : Bamboo
-- Arahan DAT: "kalau yang ini dibuat tidak perlu sync, tapi utk databasenya
--             langsung di apps nya saja. purchasing app - supabase -
--             (jadi database master)"
-- ============================================================
-- KEPUTUSAN ARSITEKTUR
-- Tabel `tukang_*` (migrasi 2026-10-11) TIDAK disentuh: itu cermin read-only
-- hasil sync Google Sheets yang menimpa per siklus (replace). Modul ini
-- memakai tabel BARU `upah_*` yang sepenuhnya milik aplikasi — tidak ada
-- daemon yang menulis ke sini, jadi data yang diinput admin TIDAK pernah
-- tertimpa.
--
-- Hubungan dengan tabel lama:
--   tukang_* (sync, read-only)  -> tetap ada sebagai arsip/rujukan
--   upah_*   (master, tulis)    -> sumber kebenaran modul Upah & Kasbon
-- Data lama diimpor SEKALI dari tukang_* ke upah_* (lihat bagian 4).
--
-- PRINSIP: idempotent (IF NOT EXISTS), tidak mengubah tabel/trigger eksisting,
--          RLS admin-only untuk baca DAN tulis (modul ini form input).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) upah_tukang — master tukang
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upah_tukang (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kode        TEXT UNIQUE NOT NULL,        -- 'asep', 'pujon' (stabil, dipakai sbg kunci)
    nama        TEXT NOT NULL,
    unit_bisnis TEXT DEFAULT 'Noir Living',
    aktif       BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2) upah_projects — proyek per tukang (nama boleh berulang)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upah_projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_id     UUID NOT NULL REFERENCES public.upah_tukang(id) ON DELETE CASCADE,
    project_name  TEXT NOT NULL,             -- snapshot nama (file lama berbasis teks)
    project_id    UUID REFERENCES public.projects(id) ON DELETE SET NULL,  -- tautan opsional ke master proyek app
    status        TEXT DEFAULT 'ON_GOING',   -- ON_GOING | SELESAI
    arsip_manual  BOOLEAN,                   -- TRUE=paksa arsip, FALSE=tahan aktif, NULL=otomatis
    total_manual  NUMERIC,                   -- override subtotal (kolom F file Excel)
    sort_order    INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS upah_projects_tukang_idx ON public.upah_projects(tukang_id);

-- ------------------------------------------------------------
-- 3) upah_items — rincian upah per baris pekerjaan
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upah_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID NOT NULL REFERENCES public.upah_projects(id) ON DELETE CASCADE,
    pekerjaan     TEXT NOT NULL,
    ukuran        NUMERIC,
    satuan_ukuran TEXT,                      -- m / m2 / unit / ls (opsional, tidak ada di file asli)
    harga_satuan  NUMERIC,
    upah_rincian  NUMERIC NOT NULL,          -- nilai final dibayar (boleh beda dari ukuran x harga)
    catatan       TEXT,
    sort_order    INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS upah_items_project_idx ON public.upah_items(project_id);

-- ------------------------------------------------------------
-- 4) upah_kasbon — kasbon & pelunasan per tukang
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upah_kasbon (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_id   UUID NOT NULL REFERENCES public.upah_tukang(id) ON DELETE CASCADE,
    tanggal     DATE NOT NULL,
    jenis       TEXT NOT NULL DEFAULT 'KASBON',   -- KASBON | PELUNASAN
    deskripsi   TEXT,
    metode      TEXT,
    nominal     NUMERIC NOT NULL,
    bukti       TEXT,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS upah_kasbon_tukang_idx ON public.upah_kasbon(tukang_id, tanggal);

-- ------------------------------------------------------------
-- 5) upah_totalan + items + kasbon terpotong
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upah_totalan (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tukang_id          UUID NOT NULL REFERENCES public.upah_tukang(id) ON DELETE CASCADE,
    no_totalan         TEXT NOT NULL,
    tanggal            DATE NOT NULL,
    seq                INT DEFAULT 0,
    kasbon_dipotong    NUMERIC DEFAULT 0,     -- snapshot
    total_upah         NUMERIC DEFAULT 0,     -- snapshot
    hak_bersih         NUMERIC DEFAULT 0,     -- snapshot = total_upah - kasbon_dipotong
    pembayaran_aktual  NUMERIC DEFAULT 0,     -- input manual
    saldo_akhir        NUMERIC DEFAULT 0,     -- snapshot = hak_bersih - pembayaran_aktual
    status             TEXT,                  -- Lunas | Perlu cek
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tukang_id, no_totalan)
);

CREATE TABLE IF NOT EXISTS public.upah_totalan_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    totalan_id  UUID NOT NULL REFERENCES public.upah_totalan(id) ON DELETE CASCADE,
    project_id  UUID REFERENCES public.upah_projects(id) ON DELETE SET NULL,
    nama_snapshot TEXT,                       -- nama proyek saat totalan dibuat
    total_upah  NUMERIC DEFAULT 0,            -- snapshot
    sort_order  INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS upah_totalan_projects_idx ON public.upah_totalan_projects(totalan_id);

CREATE TABLE IF NOT EXISTS public.upah_totalan_kasbon (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    totalan_id  UUID NOT NULL REFERENCES public.upah_totalan(id) ON DELETE CASCADE,
    kasbon_id   UUID REFERENCES public.upah_kasbon(id) ON DELETE SET NULL,
    nominal     NUMERIC DEFAULT 0,            -- porsi kasbon yang dipotong di totalan ini
    UNIQUE (totalan_id, kasbon_id)
);
CREATE INDEX IF NOT EXISTS upah_totalan_kasbon_idx ON public.upah_totalan_kasbon(totalan_id);

-- ------------------------------------------------------------
-- 6) updated_at otomatis
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upah_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$fn$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['upah_tukang','upah_projects','upah_items','upah_kasbon','upah_totalan'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON public.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.upah_touch_updated_at()', t, t);
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7) RLS: ADMIN-ONLY baca DAN tulis (modul form input)
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['upah_tukang','upah_projects','upah_items','upah_kasbon','upah_totalan','upah_totalan_projects','upah_totalan_kasbon'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS %s_admin_all ON public.%I', t, t);
        EXECUTE format($p$CREATE POLICY %s_admin_all ON public.%I FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
            WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))$p$, t, t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;

COMMIT;
