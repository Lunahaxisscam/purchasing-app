-- ============================================================
-- KUNCI TOTALAN HISTORIS (24 Okt 2026)
-- ============================================================
-- Keputusan DAT: "ikuti yang ada di file sheet, aku tidak bisa ubah, itu sudah
-- terjadi". Artinya totalan 1-6 (Pujon) adalah DOKUMEN TUTUP BUKU — angkanya
-- tidak boleh dihitung ulang dari data kasbon/proyek yang bisa berubah.
--
-- Masalah: modul menghitung ulang kasbon per ENTRI UTUH. Satu entri
-- (12 Apr 2025 Rp7.459.000) terbelah antar batch, sehingga angka sistem
-- (43.459.000) berbeda dari sheet (42.000.000).
--
-- Solusi: kolom `final` = TRUE -> modul memakai angka TERSIMPAN (dari sheet).
-- Diisi nilai sheet apa adanya, termasuk status manual.
-- ============================================================

BEGIN;

ALTER TABLE public.upah_totalan
  ADD COLUMN IF NOT EXISTS final BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.upah_totalan t
   SET final = TRUE,
       total_upah        = v.upah,
       kasbon_dipotong   = v.kasbon,
       hak_bersih        = v.upah - v.kasbon,
       pembayaran_aktual = v.bayar,
       saldo_akhir       = (v.upah - v.kasbon) - v.bayar,
       status            = v.status
  FROM (VALUES
    ('TOT-001', 66009500::numeric,  60850000::numeric,  5159500::numeric, 'Lunas'),
    ('TOT-002', 65902300::numeric,  42000000::numeric, 24000000::numeric, 'Lunas'),
    ('TOT-003', 59415950::numeric,  44500000::numeric, 15000000::numeric, 'Lunas'),
    ('TOT-004', 86699600::numeric, 103625000::numeric, 15000000::numeric, 'Saldo sunter ditahan belum dihitung'),
    ('TOT-005', 28773750::numeric,  31000000::numeric,  3774000::numeric, 'Saldo sunter ditahan belum dihitung'),
    ('TOT-006', 54678500::numeric,  39500000::numeric, 15178000::numeric, 'Saldo sunter ditahan belum dihitung')
  ) AS v(no, upah, kasbon, bayar, status)
 WHERE t.no_totalan = v.no
   AND t.tukang_id = (SELECT id FROM public.upah_tukang WHERE kode = 'pujon');

COMMIT;

-- Verifikasi (harus 6 baris, final = true semua)
SELECT string_agg(no_totalan || ' | upah=' || total_upah || ' | kasbon=' || kasbon_dipotong
       || ' | bayar=' || pembayaran_aktual || ' | saldo=' || saldo_akhir || ' | ' || status,
       E'\n' ORDER BY no_totalan) AS hasil
  FROM public.upah_totalan t
 WHERE tukang_id = (SELECT id FROM public.upah_tukang WHERE kode = 'pujon')
   AND final = TRUE;
