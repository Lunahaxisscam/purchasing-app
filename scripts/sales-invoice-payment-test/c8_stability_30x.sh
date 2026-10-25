#!/bin/bash
# ============================================================
# c8_stability_30x.sh — bukti anti-flaky assertion C8 (t_472efa7d)
# ============================================================
# Menjalankan scripts/sales-invoice-payment-test/run.py 30x BERURUTAN dan
# mencatat hasil tiap run. Run ke-15 SENGAJA ditahan sampai detik :30 supaya
# pemicu flaky lama (timestamp memuat :30) benar-benar terjadi.
#
# Pemakaian: bash scripts/sales-invoice-payment-test/c8_stability_30x.sh [N]
#   N = jumlah run (default 30)
# Keluaran: docs/c8-stability/c8-stability-<stamp>.log + ringkasan di stdout.
# Exit 0 hanya bila SEMUA run menghasilkan "51 lulus / 0 gagal".
# ============================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
N="${1:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="$REPO/docs/c8-stability"
OUT="$OUTDIR/c8-stability-$STAMP.log"
mkdir -p "$OUTDIR"
: > "$OUT"

FAILRUNS=0
FORCED_AT=""
printf 'C8 stability %s — %d run berurutan (repo %s)\n' "$STAMP" "$N" "$REPO" | tee -a "$OUT"

for i in $(seq 1 "$N"); do
  FORCED="tidak"
  if [[ "$i" -eq 15 ]]; then
    # paksa mulai tepat detik :30 (pemicu flaky lama)
    while [[ "$(date +%S)" != "30" ]]; do sleep 0.05; done
    FORCED="ya (detik :30)"
    FORCED_AT="$(date -Is)"
  fi
  START="$(date -Is)"
  LOG="$OUTDIR/.run-$STAMP-$i.log"
  python3 "$REPO/scripts/sales-invoice-payment-test/run.py" > "$LOG" 2>&1
  RC=$?
  OK="$(grep -oE 'TOTAL assertion lulus : [0-9]+' "$LOG" | grep -oE '[0-9]+$')"
  NG="$(grep -oE 'TOTAL assertion gagal : [0-9]+' "$LOG" | grep -oE '[0-9]+$')"
  C8="$(grep -E '^\s+(ok|FAIL) C8 ' "$LOG" | head -1 | awk '{print $1}')"
  GEN="$(grep -oE '"generated_at":"[^"]*"' "$LOG" | head -1)"
  [[ "$OK" == "51" && "$NG" == "0" && "$RC" -eq 0 && "$C8" == "ok" ]] || FAILRUNS=$((FAILRUNS+1))
  printf 'run %02d/%d  rc=%d  C8=%-4s  %s lulus / %s gagal  dipaksa_detik30=%s  mulai=%s\n' \
    "$i" "$N" "$RC" "$C8" "${OK:-?}" "${NG:-?}" "$FORCED" "$START" | tee -a "$OUT"
  rm -f "$LOG"
done

printf '\nRINGKASAN: %d run, %d run menyimpang (harus 0)\n' "$N" "$FAILRUNS" | tee -a "$OUT"
if [[ -n "$FORCED_AT" ]]; then
  printf 'Run yang dipaksa mulai detik :30 -> %s\n' "$FORCED_AT" | tee -a "$OUT"
fi
printf 'Log: %s\n' "$OUT" | tee -a "$OUT"
[[ "$FAILRUNS" -eq 0 ]] || exit 1
