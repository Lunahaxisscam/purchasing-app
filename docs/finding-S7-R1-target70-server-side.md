Finding S7-R1 (candidate): the report for t_7634fa92 claims the FN-TARGET70 fix
means "layar, keputusan, dan snapshot memakai angka yang sama" (screen,
decision, and snapshot use the same number). The client-side fix
(lib/money.js -> targetBudget70) does round to whole rupiah. BUT the
snapshot is written SERVER-SIDE by the close_project RPC, whose SQL still
computes v_target := COALESCE(p_revenue,0) * 0.7 (migrations/
2026-10-10_planning_closing.sql:141) — i.e. exactly the float-artifact
formula the audit called out (revenue*0.7). The RPC does not receive
target_budget as a parameter (verified: Finance.js:546 rpc call passes
p_revenue/p_material_cost/p_petty_cash_cost/p_labor_cost only, and the SQL
signature has no p_target). So for decimal revenue the stored
project_closings.target_budget can still carry a sub-rupiah fraction while
the screen shows a rounded integer. The claim in the report (section 4 and
the code comment at components/Finance.js:486-489) is therefore only
partially true; it is not a client-side-only cosmetic difference because
the comparison HEMAT/OVER in the table reads c.target_budget from the DB
snapshot (Finance.js:1169,1218), not the client value.

Severity: LOW-MEDIUM (data honesty, not data loss). Does not block: no DB
write happened, so no wrong snapshot exists yet. Requires either (a) an
additive migration that changes the RPC to round server-side, or (b) the
client to pass target as a parameter — both need DB access which is BLOCKED
(t_03b41644). Must be listed in the critical findings report.
