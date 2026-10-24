-- ============================================================
-- FIX DATA (24 Okt 2026) #2: duplikat nama proyek beda kapitalisasi
-- pada tukang PUJON.
-- ============================================================
-- TEMUAN: ada dua baris untuk proyek yang sama:
--   "Project Barbershop"  (0 item,  SELESAI)   <- dari tukang_projects (sheet: Selesai)
--   "Project BarberShop"  (9 item,  Rp6.800.000, ON_GOING) <- terbentuk sebagai
--                          "project hantu" saat seed karena nama di sheet beda kapital
-- Efeknya: item menempel di baris ON_GOING, sehingga proyek tidak bisa ditotal
-- padahal di sheet statusnya Selesai.
--
-- TINDAKAN: pindahkan item ke baris resmi ("Project Barbershop"), hapus baris hantu.
-- IDEMPOTEN: bila baris hantu sudah tidak ada, tidak terjadi apa-apa.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tukang UUID;
  v_keep   UUID;
  v_drop   UUID;
  v_moved  INT := 0;
BEGIN
  SELECT id INTO v_tukang FROM public.upah_tukang WHERE kode = 'pujon';
  IF v_tukang IS NULL THEN RAISE EXCEPTION 'tukang pujon tidak ditemukan'; END IF;

  -- baris yang DIPERTAHANKAN: nama persis seperti di tab 'List Proyek'
  SELECT id INTO v_keep FROM public.upah_projects
   WHERE tukang_id = v_tukang AND project_name = 'Project Barbershop';

  -- baris hantu (kapitalisasi berbeda, BUKAN nama resmi)
  SELECT id INTO v_drop FROM public.upah_projects
   WHERE tukang_id = v_tukang AND project_name = 'Project BarberShop';

  IF v_keep IS NOT NULL AND v_drop IS NOT NULL THEN
    UPDATE public.upah_items
       SET project_id = v_keep, updated_at = NOW()
     WHERE project_id = v_drop;
    GET DIAGNOSTICS v_moved = ROW_COUNT;

    DELETE FROM public.upah_projects WHERE id = v_drop;
    RAISE NOTICE 'digabung: % item dipindah ke "Project Barbershop", baris hantu dihapus', v_moved;
  ELSE
    RAISE NOTICE 'tidak ada duplikat (keep=% drop=%) — dilewati', v_keep, v_drop;
  END IF;
END $$;

SELECT p.project_name, p.status, count(i.id) AS item,
       COALESCE(sum(i.upah_rincian), 0) AS total
  FROM public.upah_projects p
  JOIN public.upah_tukang t ON t.id = p.tukang_id
  LEFT JOIN public.upah_items i ON i.project_id = p.id
 WHERE t.kode = 'pujon' AND p.project_name ILIKE 'project barbershop%'
 GROUP BY p.project_name, p.status
 ORDER BY p.project_name;

COMMIT;
