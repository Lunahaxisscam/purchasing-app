# PR → Pembelian → Serah Terima: user-feedback execution plan

Scope: staging VPS :3001 only. Baseline 31555d4 from running purchasing-staging-3001, candidate branch feat/compact-pr-purchase-handover. Preserve foreign uncommitted components/ProjectFinance.js verbatim; do not commit it or modify financial source records. No production deployment or production SQL.

## Approved user decisions
- PR statuses Draft, Submitted (locked), Perlu Revisi (REVISI). Aktif is a filter, not a status. Return to PR originates in Pembelian; resubmit same PR after edits.
- Remove fulfilment/belum-dibeli information from PR main desktop/mobile UI; keep data for purchase tracking.
- Consistent item identity/quantity/estimate ordering across PR and Pembelian; actual purchase prices do not overwrite PR estimates.
- Partial purchases stay visible with ordered, bought and remaining quantities, Beli Sisa, transaction details. Never conflate bought/arrived/handed quantities.
- Serah Terima follows purchased items. Remove Antrean Fisik panel; one compact list + Serahkan action. Details hide nonessential information.
- Per transfer choose quantity and Gudang vs Tukang. Gudang credits Material stock, no project-cost recognition. Tukang requires project and receiver, recognizes project cost.
- Ambil dari Gudang consumes Material stock and records project issue/cost only on confirmation. Drafts never mutate balances. No overdraft or double cost.

## Ownership and implementation sequence
Bamboo owns this isolated candidate in this run; Bit is full-stack implementer but not launched without confirming possibly paid backend. No parallel writers to shared files.
1. PR workflow helpers, latest-state edit/delete guards, return + resubmit, compact item view and filter tests.
2. Purchase item continuity, visible partial remainder, vendor-at-purchase flow, return action, tests.
3. New additive atomic distribution/stock ledger RPC with local PostgreSQL integration tests, compact handover view, warehouse withdrawal dialog. No mass backfill or production DDL. Missing live capability must fail closed and be reported, not simulated as success.
4. Regression/save/render tests; serial build away from live .next; independent review; preserve foreign WIP; swap staging only with rollback and verify live build/assets.

## Acceptance scenarios
- Draft edit allowed; stale submitted edit denied before any child writes; return transitions to REVISI; REVISI disappears from buy queue even with legacy lean markers; resubmit restores same PR ID and queue.
- PR quantity 5, bought 3 → remaining 2; fractional remainder is not rounded up to 1. Subsequent purchase accumulates without overwriting first invoice.
- No vendor on PR does not force editing submitted PR just to buy; actual vendor selected in purchase dialog.
- Partial distribution per purchase item to warehouse/tukang, no total across incompatible units; receiving quantity is bought, never inferred as delivered.
- Warehouse in/out and project issue ledger commit atomically, replay safe; competing withdrawals cannot overdraw; invalid receiver/project/material rejected without writes.
- Purchase/warehouse movement not counted twice as project cost. Historic finance calculations are not silently rewritten; financial-report integration requires reviewer signoff.

## Known baseline findings
- Running staging tree has foreign ProjectFinance.js changes. Copied unchanged to candidate for preservation, excluded from our commits.
- Existing purchaseLogic tracks bought/remainder but floors fractional remainder to 1.
- Existing isLeanRequest only checks marker, allowing returned/revised PR to remain buyable.
- Existing request save has no latest-state edit guard; submitted editing is blocked only in UI.
- Existing handover has legacy/prototype panels and receipt schema capability gates. Existing material stock has no complete withdrawal ledger. Confirm live schema before activation.
