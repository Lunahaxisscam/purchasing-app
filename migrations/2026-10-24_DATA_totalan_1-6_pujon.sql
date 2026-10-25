-- ============================================================
-- BUAT 6 TOTALAN HISTORIS PUJON (dari dashboard cut-off DAT)
-- Dibuat otomatis; idempoten (dilewati bila no_totalan sudah ada).
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_tukang UUID;
  v_id     UUID;
  v_upah   NUMERIC;
  v_hak    NUMERIC;
  v_saldo  NUMERIC;
BEGIN
  SELECT id INTO v_tukang FROM public.upah_tukang WHERE kode='pujon';
  IF v_tukang IS NULL THEN RAISE EXCEPTION 'tukang pujon tidak ada'; END IF;

  -- KOREKSI DAT: Cendana Icon nilainya NOL (angka 300.000 di dashboard salah hitung)
  UPDATE public.upah_projects SET total_manual = NULL
   WHERE tukang_id = v_tukang AND project_name = 'Project Cendana Icon';


  -- ---------- TOT-001 : 2025-04-30 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-001') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Intercon', 'Project Cosmos', 'Project Radio Dalam', 'Project Sunter Hijau 8', 'Project Jessie', 'Project Cendana Icon');
    v_hak   := v_upah - 60850000;
    v_saldo := v_hak - 5159500;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-001', DATE '2025-04-30', 1, 60850000, v_upah, v_hak, 5159500, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Intercon', 'Project Cosmos', 'Project Radio Dalam', 'Project Sunter Hijau 8', 'Project Jessie', 'Project Cendana Icon');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('0bf2a3b2-a342-4b2a-a1f2-381838d9f07f'::uuid, 3000000),
      ('51903847-cddc-439d-97f2-d810de5f4af9'::uuid, 3000000),
      ('f46e3d1d-2e33-4603-a861-bc7e9f547e5a'::uuid, 5000000),
      ('22355d10-a1c1-432f-9702-09a58544da57'::uuid, 4000000),
      ('9a86bfe0-421e-490a-8f53-adee8c30fbce'::uuid, 5000000),
      ('6a1d2ef9-c038-4e8e-bb7f-77ddc3bb2457'::uuid, 1000000),
      ('f2825cfb-3bae-44ca-bb89-b4d14e9131ed'::uuid, 2500000),
      ('fc55279c-9d46-4a06-a117-3dfefebe684e'::uuid, 2500000),
      ('5051a931-9532-47b9-b6ff-9f68a9ade620'::uuid, 2000000),
      ('18b563a9-9c97-451d-8b54-a8cb755adf73'::uuid, 2850000),
      ('4382e419-e928-4d6b-b477-dc6311a22414'::uuid, 3000000),
      ('3398846e-abee-4095-aba4-e4acd7fb43f9'::uuid, 3000000),
      ('c4b635d8-e82c-4aa1-a6c7-ba98b690a1c0'::uuid, 2500000),
      ('92a9260f-cee8-4b00-b850-f6a9d98ecab0'::uuid, 2000000),
      ('04311388-8eb6-45e9-b455-6590f074d17b'::uuid, 2500000),
      ('e9f5f97d-3fca-4921-8948-6304f874aba8'::uuid, 2500000),
      ('b94e0bf0-2403-4e4c-8f3e-8bd15af8ca18'::uuid, 2500000),
      ('718a1a06-dadd-447d-80e1-186c4ba250eb'::uuid, 5000000),
      ('925274e3-5776-4aaa-a0b8-b1301c61d5cf'::uuid, 7000000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-001 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 60850000, v_hak, 5159500, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-001 sudah ada — dilewati';
  END IF;

  -- ---------- TOT-002 : 2025-07-31 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-002') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Gatsu', 'Project Park Serpong', 'Project Duren Sawit', 'Project Meranti');
    v_hak   := v_upah - 42000000;
    v_saldo := v_hak - 24000000;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-002', DATE '2025-07-31', 2, 42000000, v_upah, v_hak, 24000000, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Gatsu', 'Project Park Serpong', 'Project Duren Sawit', 'Project Meranti');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('1ec91811-fa6c-4fad-998f-2860e933c684'::uuid, 5459000),
      ('9690f7ae-c598-4c1b-b363-acb96689c042'::uuid, 3000000),
      ('447ab1f6-c482-4cab-8853-f880fce46d05'::uuid, 3000000),
      ('d20386ed-99de-48a6-9172-b31d7f3d08aa'::uuid, 3000000),
      ('556f4c48-e49a-4562-857a-dc0d690b9de1'::uuid, 3000000),
      ('d629aaea-f149-49d5-9542-b13de814afbe'::uuid, 4000000),
      ('dfdd30ba-b439-455e-9ad2-8f175eef984a'::uuid, 4000000),
      ('9ba6602e-0cfc-4e08-85ef-a78ca448456a'::uuid, 4000000),
      ('cfa120e2-87b9-4561-bed6-2a0cf63ce7e3'::uuid, 4000000),
      ('b9d8a4ed-63c9-4e86-b433-d6012900a717'::uuid, 4000000),
      ('1e72bb58-3506-4130-bbed-e29dcd971323'::uuid, 4541000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-002 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 42000000, v_hak, 24000000, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-002 sudah ada — dilewati';
  END IF;

  -- ---------- TOT-003 : 2025-11-01 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-003') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Nerin 1', 'Project Nerin 5', 'Project Park Serpong - Cendana', 'Project Rosini -', 'Service Park Serpong', 'Service Tokyo', 'Service TA', 'Service Bintaro', 'Project Barbershop');
    v_hak   := v_upah - 44500000;
    v_saldo := v_hak - 15000000;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-003', DATE '2025-11-01', 3, 44500000, v_upah, v_hak, 15000000, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Nerin 1', 'Project Nerin 5', 'Project Park Serpong - Cendana', 'Project Rosini -', 'Service Park Serpong', 'Service Tokyo', 'Service TA', 'Service Bintaro', 'Project Barbershop');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('1e72bb58-3506-4130-bbed-e29dcd971323'::uuid, 1459000),
      ('4d701d3c-6bc3-410d-bed6-40bf68ea9aeb'::uuid, 4000000),
      ('e37aa7a5-18c7-48ae-ad1b-1a3806273918'::uuid, 4000000),
      ('26b03a00-f910-4e67-8fc7-c1825cfb12b7'::uuid, 4500000),
      ('c2544b81-f712-4070-891e-43499376be09'::uuid, 4000000),
      ('6ba66c8a-49ef-4cad-8a1a-380ba6210a85'::uuid, 4000000),
      ('a090f5ea-52fc-4753-8608-26016a102507'::uuid, 4000000),
      ('ae85ae90-7b31-48d5-ab0c-a3b954ffbf43'::uuid, 4000000),
      ('e846ff26-5541-4818-8bcf-ce7594892602'::uuid, 4000000),
      ('ad411232-af09-4322-b213-e99cecf2b609'::uuid, 4000000),
      ('caa5017a-c6be-4cad-b865-7b6aec49abac'::uuid, 4000000),
      ('865804d6-018b-445d-aaa9-c168d1200810'::uuid, 2541000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-003 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 44500000, v_hak, 15000000, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-003 sudah ada — dilewati';
  END IF;

  -- ---------- TOT-004 : 2026-03-31 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-004') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Dulcet', 'Project Flaminggo', 'Project Casa de Parco', 'Project Sunter Hijau Utama', 'Everbeau', 'Cityzen North 3 -17', 'Cove 2 - 27', 'Cove 2 - 76', 'Park Serpong 9 - 15', 'Osaka PIK', 'Park Serpong Flo 7 -66', 'Servis', 'Barbershop HI - 2', 'Project Apt Baywalk', 'Project Cisauk', 'Peak Springhill');
    v_hak   := v_upah - 103625000;
    v_saldo := v_hak - 15000000;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-004', DATE '2026-03-31', 4, 103625000, v_upah, v_hak, 15000000, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Dulcet', 'Project Flaminggo', 'Project Casa de Parco', 'Project Sunter Hijau Utama', 'Everbeau', 'Cityzen North 3 -17', 'Cove 2 - 27', 'Cove 2 - 76', 'Park Serpong 9 - 15', 'Osaka PIK', 'Park Serpong Flo 7 -66', 'Servis', 'Barbershop HI - 2', 'Project Apt Baywalk', 'Project Cisauk', 'Peak Springhill');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('865804d6-018b-445d-aaa9-c168d1200810'::uuid, 1459000),
      ('147e8298-322c-4c1e-b009-48590a7f9f98'::uuid, 4000000),
      ('e946255c-61d1-4b40-b418-3614b72c0a57'::uuid, 4000000),
      ('01fa51aa-5a90-43d1-92d3-1e413c9d61a5'::uuid, 5000000),
      ('8c113d35-6054-49cb-a77b-1fcdddac03e3'::uuid, 4000000),
      ('b305dbeb-c122-48f0-8638-164645ea8139'::uuid, 5000000),
      ('fb6bd22c-e567-4d29-9ac4-9c57fec89f1b'::uuid, 4000000),
      ('9dee44d4-2c53-4810-a89e-e456c3f05495'::uuid, 4000000),
      ('f0593671-9475-495a-9f9a-ec9d35228739'::uuid, 5000000),
      ('b12b16df-e2b5-439d-bb66-fc3e6c674727'::uuid, 5000000),
      ('1c5b2948-9438-42c2-8324-7dcf5eea9f7d'::uuid, 4000000),
      ('0f0f4ef6-7096-48c6-a709-97e611b8b721'::uuid, 4000000),
      ('69c1f0d7-af9e-497b-8afe-ec7edae57a34'::uuid, 4000000),
      ('9327095f-1c07-4ead-af78-1e80dd613056'::uuid, 4000000),
      ('f6e3b4c8-bd35-48e5-93cb-6d24d473f6a8'::uuid, 4000000),
      ('dbc24837-d57b-4795-b858-c344be859ac3'::uuid, 4000000),
      ('a612dac0-289c-43b6-a837-6d1c49fbc46e'::uuid, 6000000),
      ('f126a005-a0f7-4760-b70e-0be2c23f9cb7'::uuid, 4000000),
      ('fa9a8ef5-a328-45e8-8972-e83c94f0d91b'::uuid, 4000000),
      ('e98dd793-f604-4db2-8bac-d36ad912d3b7'::uuid, 4000000),
      ('1ba47bd0-90aa-447c-802d-b4a1f063a82a'::uuid, 4000000),
      ('b08e3bb6-1b96-44d4-874a-720d33aaa403'::uuid, 625000),
      ('e043ff16-f730-4335-bf26-ce40d2288a70'::uuid, 4000000),
      ('32de9b4e-9d82-4f52-b9b9-10bc5a8b8c88'::uuid, 4000000),
      ('d762bad2-4d0d-44f3-8a98-ca631793de4e'::uuid, 4000000),
      ('902903ef-58bb-48de-bd76-97a0d6232bdc'::uuid, 3541000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-004 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 103625000, v_hak, 15000000, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-004 sudah ada — dilewati';
  END IF;

  -- ---------- TOT-005 : 2026-05-31 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-005') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Pademangan', 'Project Barbershop Pintu', 'Project Skyhouse BSD', 'Project Charm 23 - 56', 'Project Cove 2 - 27', 'Cendana Botanic', 'Project Springhill', 'Servisan 2');
    v_hak   := v_upah - 31000000;
    v_saldo := v_hak - 3774000;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-005', DATE '2026-05-31', 5, 31000000, v_upah, v_hak, 3774000, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Pademangan', 'Project Barbershop Pintu', 'Project Skyhouse BSD', 'Project Charm 23 - 56', 'Project Cove 2 - 27', 'Cendana Botanic', 'Project Springhill', 'Servisan 2');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('902903ef-58bb-48de-bd76-97a0d6232bdc'::uuid, 459000),
      ('b43b3182-48c7-47b8-9519-42232b297548'::uuid, 4000000),
      ('fc064e2e-662b-49db-8302-82ea45139dd0'::uuid, 4000000),
      ('3f6ecfcf-086f-430c-8019-f7a8732f7489'::uuid, 3000000),
      ('f8c82925-3f64-4713-ae8b-2d23ffbd5347'::uuid, 1000000),
      ('61a26e4c-2153-4091-9fb3-c371b3e49058'::uuid, 4000000),
      ('76bd730a-dfd7-47fb-9c53-b8a9c2f21afa'::uuid, 0),
      ('db70e9f3-50fe-4272-844c-ea1992d0aece'::uuid, 4000000),
      ('d0c1f72a-0e0e-4757-85f4-98e3cf4371bc'::uuid, 10541000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-005 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 31000000, v_hak, 3774000, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-005 sudah ada — dilewati';
  END IF;

  -- ---------- TOT-006 : 2026-07-05 ----------
  IF NOT EXISTS (SELECT 1 FROM public.upah_totalan WHERE tukang_id=v_tukang AND no_totalan='TOT-006') THEN
    SELECT COALESCE(SUM(COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0)),0)
      INTO v_upah
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Bekasi', 'Project Panola', 'Project Semanan', 'Project Rempoa', 'Project Barbershop Pekayon', 'Project Leo Sunter', 'Project Cove 2-21');
    v_hak   := v_upah - 39500000;
    v_saldo := v_hak - 15178000;
    INSERT INTO public.upah_totalan(tukang_id, no_totalan, tanggal, seq,
        kasbon_dipotong, total_upah, hak_bersih, pembayaran_aktual, saldo_akhir, status)
    VALUES (v_tukang, 'TOT-006', DATE '2026-07-05', 6, 39500000, v_upah, v_hak, 15178000, v_saldo,
            CASE WHEN v_saldo = 0 THEN 'Lunas' ELSE 'Perlu cek' END)
    RETURNING id INTO v_id;

    INSERT INTO public.upah_totalan_projects(totalan_id, project_id, nama_snapshot, total_upah, sort_order)
    SELECT v_id, p.id, p.project_name,
           COALESCE(p.total_manual, (SELECT SUM(i.upah_rincian) FROM public.upah_items i WHERE i.project_id=p.id), 0),
           row_number() OVER (ORDER BY p.project_name)
      FROM public.upah_projects p
     WHERE p.tukang_id=v_tukang AND p.project_name IN ('Project Bekasi', 'Project Panola', 'Project Semanan', 'Project Rempoa', 'Project Barbershop Pekayon', 'Project Leo Sunter', 'Project Cove 2-21');

    INSERT INTO public.upah_totalan_kasbon(totalan_id, kasbon_id, nominal)
    SELECT v_id, x.kasbon_id, x.nominal FROM (VALUES
      ('d0c1f72a-0e0e-4757-85f4-98e3cf4371bc'::uuid, 4459000),
      ('6b852586-1cfb-4d39-a01d-1d9409c8a366'::uuid, 0),
      ('ff481524-035c-4579-89aa-1b3e1125a35a'::uuid, 4000000),
      ('5c338f46-4682-4595-8ee4-2f4c6a477e46'::uuid, 4000000),
      ('a15ed5d9-9189-4fce-b7a1-6ca09194e2d0'::uuid, 5000000),
      ('2b09a8ec-7d4a-4850-a88f-8654aed0a373'::uuid, 5000000),
      ('d42a621a-3685-454a-99cf-b39b603443bf'::uuid, 8000000),
      ('1410f551-3e2c-4512-bf30-5054a1a4c747'::uuid, 5000000),
      ('23abeef6-f34c-4edf-b9d3-0b8c9d25644c'::uuid, 3774000),
      ('3f4faa32-6acd-4fbd-81e2-ba2156c3bcf4'::uuid, 267000)
    ) AS x(kasbon_id, nominal);

    RAISE NOTICE 'TOT-006 dibuat: upah=% kasbon=% hak=% bayar=% saldo=%', v_upah, 39500000, v_hak, 15178000, v_saldo;
  ELSE
    RAISE NOTICE 'TOT-006 sudah ada — dilewati';
  END IF;

END $$;

-- ---------- VERIFIKASI ----------
SELECT x.no_totalan, x.tanggal, x.total_upah, x.kasbon_dipotong, x.hak_bersih,
       x.pembayaran_aktual, x.saldo_akhir, x.status,
       (SELECT count(*) FROM public.upah_totalan_projects j WHERE j.totalan_id=x.id) AS n_proyek,
       (SELECT COALESCE(sum(j.nominal),0) FROM public.upah_totalan_kasbon j WHERE j.totalan_id=x.id) AS kasbon_tercatat
  FROM public.upah_totalan x
  JOIN public.upah_tukang t ON t.id=x.tukang_id AND t.kode='pujon'
 ORDER BY x.seq;

COMMIT;