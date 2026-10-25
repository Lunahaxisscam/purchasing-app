-- ============================================================
-- FIX DATA (25 Okt 2026): Hapus proyek non-resmi pada tukang ASEP.
-- ============================================================
-- TEMUAN:
-- Di tab 'List Proyek' dan 'Dashboard' Excel resmi Tukang Asep,
-- hanya ada SATU proyek aktif: "Santi - Baroni Utara 1/87" (Rp 10.345.000).
-- Proyek "Proyek Josh - Mabes" (Rp 9.230.000) dan "Servisan 2" (Rp 0)
-- adalah sisa draf rincian yang bukan milik Asep di periode ini.
--
-- TINDAKAN:
-- Hapus item upah dan baris proyek "Proyek Josh - Mabes" dan "Servisan 2"
-- khusus untuk tukang Asep.
-- IDEMPOTEN: aman dieksekusi berulang kali.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tukang UUID;
  v_del_items INT := 0;
  v_del_projs INT := 0;
BEGIN
  SELECT id INTO v_tukang FROM public.upah_tukang WHERE kode = 'asep';
  IF v_tukang IS NULL THEN
    RAISE NOTICE 'tukang asep tidak ditemukan, dilewati';
    RETURN;
  END IF;

  -- 1. Hapus upah_items untuk proyek yang akan dihapus dari Asep
  DELETE FROM public.upah_items
   WHERE project_id IN (
     SELECT id FROM public.upah_projects
      WHERE tukang_id = v_tukang
        AND project_name IN ('Proyek Josh - Mabes', 'Servisan 2')
   );
  GET DIAGNOSTICS v_del_items = ROW_COUNT;

  -- 2. Hapus proyek dari upah_projects Asep
  DELETE FROM public.upah_projects
   WHERE tukang_id = v_tukang
     AND project_name IN ('Proyek Josh - Mabes', 'Servisan 2');
  GET DIAGNOSTICS v_del_projs = ROW_COUNT;

  RAISE NOTICE 'Selesai: % items dan % proyek dihapus dari tukang Asep.', v_del_items, v_del_projs;
END $$;

-- Verifikasi hasil akhir proyek Asep
SELECT p.project_name, p.status, count(i.id) AS item,
       COALESCE(p.total_manual, sum(i.upah_rincian)) AS total_upah
  FROM public.upah_projects p
  JOIN public.upah_tukang t ON t.id = p.tukang_id
  LEFT JOIN public.upah_items i ON i.project_id = p.id
 WHERE t.kode = 'asep'
 GROUP BY p.project_name, p.status, p.total_manual
 ORDER BY p.project_name;

COMMIT;
