-- DRAFT: permits purchases without a PR. Apply only with the tested
-- connector ledger and atomic purchase function, after live schema review.
-- This changes no existing purchase or PR. Existing foreign keys remain.
BEGIN;
ALTER TABLE public.receivings ALTER COLUMN purchase_request_id DROP NOT NULL;
COMMIT;
-- Rollback is safe only after every no-PR receiving has been reconciled:
-- ALTER TABLE public.receivings ALTER COLUMN purchase_request_id SET NOT NULL;