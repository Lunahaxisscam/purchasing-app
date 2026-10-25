-- ============================================================
-- FIX DATA (24 Okt 2026): gabungkan "project" pecahan ber-ekstensi .pdf
-- pada tukang PUJON menjadi project yang sebenarnya.
-- ============================================================
-- MASALAH: tab 'Rincian Upah' mengelompokkan pekerjaan secara POSISIONAL
-- (satu header di kolom A, item-item di bawahnya), tetapi sync lama membaca
-- kolom A apa adanya. Akibatnya setiap baris yang kolom A-nya berisi nama
-- file PDF (A1-2 Kabinet entrance-rev2.pdf, dst) tercipta sebagai "project"
-- sendiri, padahal itu bagian dari SATU proyek.
--
-- BUKTI (jumlah tiap blok di sheet == total di tab 'List Proyek'):
--   baris 570-699  Rp123.729.000  -> "Proyek Sunter Hijau - Eric"  (header 568 "Project Erick")
--   baris 702-719  Rp  7.356.000  -> "Project Reivan Trail 10-20"  (header 720)
--   baris 722-742  Rp 10.120.000  -> "Brigitta Cove 12-32"         (header 743 "91 - project cove 12-32")
--   baris 744-751  Rp  3.035.000  -> tambahan "Proyek Josh - Mabes" (sudah tergabung di DB)
--
-- TARGET: project dengan nama di tab 'List Proyek' SUDAH ADA di upah_projects
-- (total_manual-nya juga sudah benar), hanya itemnya masih tersebar.
-- Jadi: pindahkan item -> hapus project pecahan -> tambah 3 item yang dulu
-- hilang (teksnya ada di kolom A, kolom Pekerjaan kosong).
--
-- IDEMPOTEN: project pecahan yang sudah tidak ada otomatis dilewati;
-- 3 item tambahan hanya dimasukkan bila belum ada.
-- TIDAK menyentuh tabel tukang_* (arsip sync Google Sheets).
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tukang  UUID;
  r         RECORD;
  v_target  UUID;
  v_moved   INT;
  n_item    INT := 0;
  n_proj    INT := 0;
BEGIN
  SELECT id INTO v_tukang FROM public.upah_tukang WHERE kode = 'pujon';
  IF v_tukang IS NULL THEN
    RAISE EXCEPTION 'tukang pujon tidak ditemukan';
  END IF;

  -- (urutan, nama pecahan, nama project tujuan)
  FOR r IN
    SELECT * FROM (VALUES
      ( 1, 'A1-2 Kabinet entrance-rev2.pdf',                          'Proyek Sunter Hijau - Eric'),
      ( 2, 'A3,B3-Kabinet storage & bench-rev3.pdf',                  'Proyek Sunter Hijau - Eric'),
      ( 3, 'B1-2. Backdrop TV & Wallpanel-rev4.pdf',                  'Proyek Sunter Hijau - Eric'),
      ( 4, 'C1.Panel cermin-rev2.pdf',                                'Proyek Sunter Hijau - Eric'),
      ( 5, 'C2.Bench-Rev3.pdf',                                       'Proyek Sunter Hijau - Eric'),
      ( 6, 'D1-5.Kitchenset-Rev4.pdf',                                'Proyek Sunter Hijau - Eric'),
      ( 7, 'D6-7 Kabinet kulkas, wallpanel,pintu kamuflase-Rev1.pdf',  'Proyek Sunter Hijau - Eric'),
      ( 8, 'E1.Storage-Rev3.pdf',                                     'Proyek Sunter Hijau - Eric'),
      ( 9, 'F.Toilet lt1-Rev3.pdf',                                   'Proyek Sunter Hijau - Eric'),
      (10, 'G.Gundam-rev2.pdf',                                       'Proyek Sunter Hijau - Eric'),
      (11, 'H1-3.Divan & Lemari pakaian-rev2.pdf',                    'Proyek Sunter Hijau - Eric'),
      (12, 'H2.Kabinet & Backdrop TV-Rev1.pdf',                       'Proyek Sunter Hijau - Eric'),
      (13, 'H4-5.WIC-Rev3.pdf',                                       'Proyek Sunter Hijau - Eric'),
      (14, 'I.Toilet kamar utama-rev4.pdf',                           'Proyek Sunter Hijau - Eric'),
      (15, 'J.Working area-rev4.pdf',                                 'Proyek Sunter Hijau - Eric'),
      (16, 'K.Lemari kamar anak-rev1.pdf',                            'Proyek Sunter Hijau - Eric'),
      (17, 'L.Toilet kamar anak lt2-rev2.pdf',                        'Proyek Sunter Hijau - Eric'),
      (18, 'M.Toilet lt3-rev1.pdf',                                   'Proyek Sunter Hijau - Eric'),
      (20, 'A1-2.Lemari & meja rias-Rev2.pdf',                        'Project Reivan Trail 10-20'),
      (21, 'A2.Divan & Nakas-Rev2.pdf',                               'Project Reivan Trail 10-20'),
      (22, 'B.Ruang kerja-Rev2.pdf',                                  'Project Reivan Trail 10-20'),
      (30, 'A1.Tangga-rev1.pdf',                                      'Brigitta Cove 12-32'),
      (31, 'A2-3.Kabinet TV & Pintu kamuflase-rev2.pdf',              'Brigitta Cove 12-32'),
      (32, 'A4-Partisi 2.pdf',                                        'Brigitta Cove 12-32')
    ) AS m(ord, frag, target)
  LOOP
    SELECT id INTO v_target FROM public.upah_projects
     WHERE tukang_id = v_tukang AND project_name = r.target;

    IF v_target IS NULL THEN
      RAISE NOTICE 'target "%" tidak ada — dilewati', r.target;
      CONTINUE;
    END IF;

    -- pindahkan item; sort_order diberi offset supaya urutan blok tetap
    WITH moved AS (
      UPDATE public.upah_items i
         SET project_id = v_target,
             sort_order = (r.ord * 1000) + COALESCE(i.sort_order, 0),
             updated_at = NOW()
       WHERE i.project_id IN (
              SELECT p.id FROM public.upah_projects p
               WHERE p.tukang_id = v_tukang AND p.project_name = r.frag)
      RETURNING 1)
    SELECT count(*) INTO v_moved FROM moved;

    IF v_moved > 0 THEN
      n_item := n_item + v_moved;
      DELETE FROM public.upah_projects p
       WHERE p.tukang_id = v_tukang AND p.project_name = r.frag;
      n_proj := n_proj + 1;
      RAISE NOTICE '  % -> % : % item dipindah', r.frag, r.target, v_moved;
    END IF;
  END LOOP;

  -- 3 baris yang dulu hilang: teks ada di kolom A, kolom Pekerjaan kosong
  -- (baris 697-699 sheet). Hanya dimasukkan bila belum ada.
  IF EXISTS (SELECT 1 FROM public.upah_projects
              WHERE tukang_id = v_tukang AND project_name = 'Proyek Sunter Hijau - Eric') THEN
    SELECT id INTO v_target FROM public.upah_projects
     WHERE tukang_id = v_tukang AND project_name = 'Proyek Sunter Hijau - Eric';

    INSERT INTO public.upah_items(project_id, pekerjaan, ukuran, harga_satuan,
                                  upah_rincian, catatan, sort_order)
    SELECT v_target, x.pekerjaan, x.ukuran, x.harga, x.upah, 'Dipulihkan dari kolom A sheet', x.ord
      FROM (VALUES
        ('Pemasangan tutup gorden',            1.0::numeric, 150000::numeric, 150000::numeric, 19000),
        ('Pemasangan bracket cctv + konek listrik', 1.0::numeric, 100000::numeric, 100000::numeric, 19001),
        ('Pemasangan cover MCB',               1.2::numeric, 350000::numeric, 420000::numeric, 19002)
      ) AS x(pekerjaan, ukuran, harga, upah, ord)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.upah_items e
        WHERE e.project_id = v_target AND e.pekerjaan = x.pekerjaan);
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RAISE NOTICE '  item tambahan dipulihkan: %', v_moved;
  END IF;

  -- baris "project" palsu dari header/subtotal sheet
  DELETE FROM public.upah_projects p
   WHERE p.tukang_id = v_tukang
     AND p.project_name IN ('Project', 'subtotal Proyek Erik', 'Proyek Sunter Hijau - Eric 90%');
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RAISE NOTICE 'baris header/subtotal dihapus: %', v_moved;

  -- "91 - project cove 12-32" = header nomor 91 (nama resmi: Brigitta Cove 12-32)
  IF EXISTS (SELECT 1 FROM public.upah_projects
              WHERE tukang_id = v_tukang AND project_name = '91 - project cove 12-32') THEN
    SELECT id INTO v_target FROM public.upah_projects
     WHERE tukang_id = v_tukang AND project_name = 'Brigitta Cove 12-32';
    IF v_target IS NOT NULL THEN
      UPDATE public.upah_items i SET project_id = v_target
       WHERE i.project_id IN (SELECT id FROM public.upah_projects
                               WHERE tukang_id = v_tukang AND project_name = '91 - project cove 12-32')
         AND COALESCE(i.upah_rincian, 0) <> 0;
    END IF;
    DELETE FROM public.upah_projects
     WHERE tukang_id = v_tukang AND project_name = '91 - project cove 12-32';
  END IF;

  RAISE NOTICE 'SELESAI: % item dipindah, % project pecahan dihapus', n_item, n_proj;
END $$;

-- ---------- VERIFIKASI ----------
SELECT p.project_name,
       count(i.id)                                   AS item,
       COALESCE(sum(i.upah_rincian), 0)              AS total_item,
       COALESCE(p.total_manual, 0)                   AS total_manual
  FROM public.upah_projects p
  JOIN public.upah_tukang t ON t.id = p.tukang_id
  LEFT JOIN public.upah_items i ON i.project_id = p.id
 WHERE t.kode = 'pujon'
   AND p.project_name IN ('Proyek Sunter Hijau - Eric', 'Project Reivan Trail 10-20', 'Brigitta Cove 12-32')
 GROUP BY p.project_name, p.total_manual
 ORDER BY p.project_name;

COMMIT;
