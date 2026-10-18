Finding S7-R2 (candidate, honesty of labels — verify against the six audit
deliverables): the FN-EST_LABEL fix is real and well-tested (46 ok, baseline
28 FAIL), and actual tukang_projects wages are kept separate. BUT the
closing snapshot still stores project_plans.labor_cost (WBS ESTIMATE) into
project_closings.labor_cost via the close_project RPC (Finance.js:551
p_labor_cost: row.labor, where row.labor = laborByProject[p.id] = the WBS
estimate). The report itself states this honestly in section 9 ("labor_cost
snapshot masih ESTIMASI WBS"), and the print doc was relabeled "TOTAL BIAYA
TERCATAT". So: label honesty is preserved in UI + print doc, but the
permanent snapshot mixes an estimate with real material/petty numbers
without a per-row provenance flag. That is a known accepted limitation,
NOT a false claim by the worker — as long as it stays listed in the
findings report for Brooklyn/DAT. Must not be silently dropped.
