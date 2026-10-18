#!/usr/bin/env bash
# S7 final-gate verification — captured evidence
cd /home/ubuntu/dev-workspaces/purchasing-review-prep-20261018 || exit 1
{
echo "### 1. globals.css numstat (additions/deletions) 1d364e7..c06822b"
git diff 1d364e7..c06822b --numstat -- styles/globals.css
echo
echo "### 2. pages/api changes (expect: none)"
git diff 1d364e7..c06822b --name-only -- pages/api/
echo "(kosong = tidak ada perubahan API route)"
echo
echo "### 3. migrations/ changes (expect: none)"
git diff 1d364e7..c06822b --name-only -- migrations/
echo "(kosong = tidak ada migrasi baru/diubah)"
echo
echo "### 4. all deleted files across prep range (expect: only harness compile artifacts / none)"
git diff 1d364e7..c06822b --diff-filter=D --name-only
echo "(kosong = tidak ada file dihapus)"
echo
echo "### 5. production app files changed (intentional REVIEW-03 + ports)"
git diff 1d364e7..c06822b --name-only -- components/ lib/ modules/ pages/ styles/
echo
echo "### 6. HEAD / branch"
git log --oneline -2 | cat
git branch --show-current
} > /home/ubuntu/dev-workspaces/agent-3-finance/s7-audit-evidence/final-gate-checks.txt 2>&1
echo done
