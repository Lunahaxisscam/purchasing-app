# Compact flow review and activation limits

## Verified scope
Candidate based on running staging 31555d4, not origin/main. This branch is STAGING-ONLY; do not merge it into main wholesale (contains earlier staging integration). Foreign ProjectFinance.js WIP copied unchanged, excluded from own commit.

Checks executed:
- 20 pure logic/boundary checks; 6 SSR render cases; 4 service workflow cases; 3 jsdom interactions.
- Existing purchase suite: 218 logic checks and 105 render/interaction checks, all pass after adding genuine parent/item fixture rows for new fresh-status reads. Mock .single now matches Supabase read response shape.
- Existing save regression: 56 checks pass.
- Local PostgreSQL draft migration applied, then transaction-rollback assertions for return, item edit lock, stock credit, replay, withdrawal, overdraft, direct issue and cost totals. Separate concurrent sessions proved one of two competing withdrawals denied, final stock 1; anon RPC and authenticated direct INSERT denied.
- Production Next build compiled. Final rebuild and staging HTTP checks recorded separately.

## Blockers and deliberate omissions
Shared Supabase is production project wuurovgjflrhczlsbixm. Read-only probes showed receiving_events, handover_items, v_receipt_progress, ops_transfers and material_movements absent. NO production DDL or transaction fixtures were applied. The new migration is explicitly DRAFT and tested only in purchasing_compact_test locally.
- New transfer and warehouse confirmation disabled when ledger unavailable. Rows show unknown/unverified handover totals, not invented zeros.
- Return PR calls a new RPC; without activation it reports error and leaves PR untouched. Client-side submitted edit/delete guards work now, but DB trigger enforcement requires reviewed migration.
- Project cost is recorded once in new local ledger on TUKANG issues; warehouse intake is not project cost. Existing lib/projectCostBreakdown.js and foreign Finance WIP were deliberately not changed: current financial reports still use purchased-note basis. Finance integration/valuation policy requires Brooklyn/Finance signoff before DB activation. No claim that Finance dashboard already follows new recognition.
- FIFO is a proposed stock-cost mechanism, NOT a user-approved accounting policy. Historical stock without verified lot values is blocked from consumption; no guessed backfill. Do not activate until valuation/reconciliation plan reviewed.
- Purchased items with historic physical allocation are blocked for reconciliation; no double distribution from inferred legacy status.
- Existing damaged goods/return data paths retained in source but compact screen does not expose new damaged-goods handling; restore such actions in Detail only after explicit UX decision.
- PC browser MCP call timed out; real desktop/mobile browser geometry and signed-in end-to-end staging workflow NOT verified. SSR and jsdom checks are not browser geometry evidence.
- No independent model-based review launched: possibly paid review model requires DAT approval. This is a technical self-review, not Brooklyn's final approval.

## Required before complete backend rollout
Choose isolated staging Supabase/database, or explicitly authorize a reviewed production additive migration after backup/restore drill. Then align project-cost readers with ledger (keep cash spent separate from project consumption), reconcile legacy stock and test actual user permissions. Do not call whole workflow complete before these gates.
