-- ============================================================
-- REBUILD item Pujon dari ARSIP SUMBER (otoritatif), 24 Okt 2026
-- ============================================================
-- Percobaan tambal-menambal sebelumnya membuat angka melenceng. Sekarang
-- item Pujon DIBANGUN ULANG dari `tukang_upah_items` (arsip sync Sheets =
-- cermin tab 'Rincian Upah'), dengan pemetaan eksplisit:
--   * 18 nama file .pdf milik "Proyek Sunter Hijau - Eric"
--   *  3 nama file .pdf milik "Project Reivan Trail 10-20"
--   *  3 nama file .pdf milik "Brigitta Cove 12-32"
--   * 3 baris yang dulu hilang (teks di kolom A, kolom Pekerjaan kosong)
-- Semua baris sumber lain masuk apa adanya (duplikat yang sah dipertahankan).
--
-- Asep TIDAK disentuh (sumbernya sendiri terduplikasi 2x dari sync).
-- IDEMPOTEN: delete+insert dalam satu transaksi.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tukang UUID;
  n_src INT; n_ins INT;
BEGIN
  SELECT id INTO v_tukang FROM public.upah_tukang WHERE kode='pujon';
  IF v_tukang IS NULL THEN RAISE EXCEPTION 'tukang pujon tidak ada'; END IF;

  SELECT count(*) INTO n_src FROM public.tukang_upah_items WHERE tukang_key='pujon';

  DELETE FROM public.upah_items i
   USING public.upah_projects p
   WHERE i.project_id = p.id AND p.tukang_id = v_tukang;

  INSERT INTO public.upah_items(project_id, pekerjaan, ukuran, harga_satuan,
                                upah_rincian, catatan, sort_order)
  SELECT pr.id,
         s.pekerjaan,
         CASE WHEN s.ukuran ~ '^[0-9]+([.][0-9]+)?$' THEN s.ukuran::numeric ELSE NULL END,
         s.harga_satuan,
         COALESCE(s.upah_rincian, 0),
         s.catatan,
         row_number() OVER (ORDER BY s.ctid)
    FROM public.tukang_upah_items s
    JOIN public.upah_projects pr
      ON pr.tukang_id = v_tukang
     AND pr.project_name = CASE s.project_name
           -- ===== Proyek Sunter Hijau - Eric =====
           WHEN 'A1-2 Kabinet entrance-rev2.pdf'                         THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'A3,B3-Kabinet storage & bench-rev3.pdf'                 THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'B1-2. Backdrop TV & Wallpanel-rev4.pdf'                 THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'C1.Panel cermin-rev2.pdf'                               THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'C2.Bench-Rev3.pdf'                                      THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'D1-5.Kitchenset-Rev4.pdf'                               THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'D6-7 Kabinet kulkas, wallpanel,pintu kamuflase-Rev1.pdf' THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'E1.Storage-Rev3.pdf'                                    THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'F.Toilet lt1-Rev3.pdf'                                  THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'G.Gundam-rev2.pdf'                                      THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'H1-3.Divan & Lemari pakaian-rev2.pdf'                   THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'H2.Kabinet & Backdrop TV-Rev1.pdf'                      THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'H4-5.WIC-Rev3.pdf'                                      THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'I.Toilet kamar utama-rev4.pdf'                          THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'J.Working area-rev4.pdf'                                THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'K.Lemari kamar anak-rev1.pdf'                           THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'L.Toilet kamar anak lt2-rev2.pdf'                       THEN 'Proyek Sunter Hijau - Eric'
           WHEN 'M.Toilet lt3-rev1.pdf'                                  THEN 'Proyek Sunter Hijau - Eric'
           -- ===== Project Reivan Trail 10-20 =====
           WHEN 'A1-2.Lemari & meja rias-Rev2.pdf'                       THEN 'Project Reivan Trail 10-20'
           WHEN 'A2.Divan & Nakas-Rev2.pdf'                              THEN 'Project Reivan Trail 10-20'
           WHEN 'B.Ruang kerja-Rev2.pdf'                                 THEN 'Project Reivan Trail 10-20'
           -- ===== Brigitta Cove 12-32 =====
           WHEN 'A1.Tangga-rev1.pdf'                                     THEN 'Brigitta Cove 12-32'
           WHEN 'A2-3.Kabinet TV & Pintu kamuflase-rev2.pdf'             THEN 'Brigitta Cove 12-32'
           WHEN 'A4-Partisi 2.pdf'                                       THEN 'Brigitta Cove 12-32'
           ELSE s.project_name
         END
   WHERE s.tukang_key = 'pujon';
  GET DIAGNOSTICS n_ins = ROW_COUNT;

  -- 3 baris yang hilang saat sync (teks di kolom A, kolom Pekerjaan kosong)
  INSERT INTO public.upah_items(project_id, pekerjaan, ukuran, harga_satuan,
                                upah_rincian, catatan, sort_order)
  SELECT pr.id, x.pekerjaan, x.ukuran, x.harga, x.upah,
         'Dipulihkan dari kolom A sheet', 90000 + x.ord
    FROM (VALUES
      ('Pemasangan tutup gorden',                1.0::numeric, 150000::numeric, 150000::numeric, 1),
      ('Pemasangan bracket cctv + konek listrik', 1.0::numeric, 100000::numeric, 100000::numeric, 2),
      ('Pemasangan cover MCB',                   1.2::numeric, 350000::numeric, 420000::numeric, 3)
    ) AS x(pekerjaan, ukuran, harga, upah, ord)
    JOIN public.upah_projects pr
      ON pr.tukang_id = v_tukang AND pr.project_name = 'Proyek Sunter Hijau - Eric';

  RAISE NOTICE 'sumber=% baris, masuk=% baris (+3 dipulihkan)', n_src, n_ins;
END $$;

-- ---------- VERIFIKASI: total per proyek vs sheet ----------
SELECT t.kode, count(i.id) AS item, COALESCE(sum(i.upah_rincian),0) AS total
  FROM public.upah_tukang t
  JOIN public.upah_projects p ON p.tukang_id = t.id
  LEFT JOIN public.upah_items i ON i.project_id = p.id
 GROUP BY t.kode ORDER BY t.kode;

COMMIT;
