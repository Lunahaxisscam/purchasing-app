-- ============================================================
-- DRAFT MIGRASI — LEDGER IDEMPOTENSI KONEKTOR BAKPAU
-- ============================================================
-- STATUS: DRAFT. BELUM DIJALANKAN DI LINGKUNGAN MANA PUN.
-- Lane: Bandeng / t_310dfb07. Pemilik apply: integrator (Bamboo B) setelah
-- review schema owner. Tidak ada DDL live dari lane ini.
--
-- KENAPA DIBUTUHKAN
--   Idempotensi event per kanal dan bukti lintas kanal butuh operasi
--   insert-if-absent yang ATOMIK. Skema existing tidak menyediakannya:
--     * `receivings.invoice_no` tidak punya UNIQUE index (nomor nota tidak
--       unik: toko berbeda sering memakai nomor sama, dan nota tanpa nomor
--       memakai referensi internal).
--     * Tidak ada tabel event/idempotency (probe read-only: PGRST205).
--   Tanpa tabel ini, pola SELECT-lalu-INSERT punya window balapan: dua
--   request bersamaan bisa sama-sama lolos dan menulis nota ganda.
--   Karena itu konektor FAIL CLOSED (menolak menulis) bila tabel ini belum
--   ada — lihat lib/bakpau/ledger.js `createDbLedger().probe()`.
--
-- ISI TABEL BUKAN DATA KEUANGAN
--   Hanya kunci idempotensi + status pemrosesan + hasil kirim notifikasi.
--   TIDAK menyimpan nominal/biaya/ringkasan kumulatif. Satu-satunya sumber
--   biaya tetap `receivings` / `receiving_items`.
--
-- IDEMPOTENSI SQL
--   `dedup_key` UNIQUE adalah SATU-SATUNYA mekanisme klaim. Insert yang
--   kalah balapan menerima 23505 -> dianggap "sudah diklaim" (bukan error).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.bakpau_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dedup_key    text        NOT NULL,
    kind         text        NOT NULL DEFAULT 'event',
    status       text        NOT NULL DEFAULT 'claimed',
    payload      jsonb,
    result       jsonb,
    receiving_id uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bakpau_events_dedup_key_uniq UNIQUE (dedup_key),
    CONSTRAINT bakpau_events_kind_chk CHECK (kind IN ('event', 'evidence', 'notification')),
    CONSTRAINT bakpau_events_status_chk CHECK (status IN ('claimed', 'recorded', 'sent', 'failed'))
);

COMMENT ON TABLE public.bakpau_events IS
  'Ledger idempotensi konektor Bakpau (event per kanal, bukti lintas kanal, notifikasi). Bukan data keuangan.';
COMMENT ON COLUMN public.bakpau_events.dedup_key IS
  'Kunci klaim atomik: evt:<platform>:<chat>:<msg> | evd:sha256:<hash> | ntf:<status>:<channelKey>';

CREATE INDEX IF NOT EXISTS bakpau_events_kind_idx ON public.bakpau_events (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS bakpau_events_receiving_idx ON public.bakpau_events (receiving_id);

-- updated_at otomatis (tanpa trigger buatan sendiri: pakai fungsi existing
-- bila ada; kalau tidak, biarkan aplikasi yang mengisi).
CREATE OR REPLACE FUNCTION public.fn_bakpau_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bakpau_events_touch ON public.bakpau_events;
CREATE TRIGGER bakpau_events_touch
    BEFORE UPDATE ON public.bakpau_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_bakpau_touch_updated_at();

-- RLS: tidak ada akses anon/authenticated sama sekali. Hanya service role
-- (server konektor) yang boleh membaca/menulis. Ini menjaga agar browser
-- tidak bisa mengklaim/menghapus kunci idempotensi.
ALTER TABLE public.bakpau_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bakpau_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bakpau_events TO service_role;

-- TIDAK ADA policy untuk anon/authenticated: RLS + tanpa policy = deny all.

COMMIT;

-- ============================================================
-- ROLLBACK (aman: tidak menyentuh data keuangan)
-- ============================================================
-- BEGIN;
--   DROP TRIGGER IF EXISTS bakpau_events_touch ON public.bakpau_events;
--   DROP FUNCTION IF EXISTS public.fn_bakpau_touch_updated_at();
--   DROP TABLE IF EXISTS public.bakpau_events;
-- COMMIT;
--
-- CATATAN ROLLBACK: setelah tabel dihapus, konektor otomatis kembali ke
-- mode FAIL CLOSED (menolak menulis pembelian) — bukan kembali ke mode
-- "tulis tanpa idempotensi". Tidak ada data pembelian yang hilang karena
-- tabel ini tidak pernah menyimpan data keuangan.
