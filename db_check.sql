-- CEK KONDISI DATABASE (read-only, tidak mengubah apa pun)
SELECT '--- CHECK CONSTRAINTS pada kolom status ---' AS info;
SELECT conrelid::regclass AS tabel, conname AS nama_constraint, pg_get_constraintdef(oid) AS definisi
FROM pg_constraint
WHERE contype = 'c'
  AND conrelid::regclass::text IN ('purchase_requests','pr_items','receivings','receiving_items','approval_steps','handovers')
ORDER BY tabel, conname;

SELECT '--- POLA nilai status yang sudah dipakai di data existing ---' AS info;
SELECT 'purchase_requests' AS tabel, status, COUNT(*) FROM purchase_requests GROUP BY status
UNION ALL SELECT 'pr_items', status, COUNT(*) FROM pr_items GROUP BY status
UNION ALL SELECT 'receivings', status, COUNT(*) FROM receivings GROUP BY status
UNION ALL SELECT 'approval_steps', status, COUNT(*) FROM approval_steps GROUP BY status
UNION ALL SELECT 'handovers', status, COUNT(*) FROM handovers GROUP BY status
ORDER BY 1,2;
