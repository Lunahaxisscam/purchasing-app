#!/bin/bash
# ============================================================
# switch_preview_final_package.sh — alihkan PM2 preview 3001 ke artefak
# PAKET AKHIR (t_2e5ef03c)
# ============================================================
# DIPAKAI HANYA SETELAH Brooklyn (t_987f2c96) memberi approval eksplisit atas
# commit 9c5d8b6 / BUILD_ID di state/release-manifest.json.
# Tanpa argumen: DRY-RUN (tidak menyentuh PM2 sama sekali).
#
#   ./switch_preview_final_package.sh              # dry-run: cetak rencana
#   ./switch_preview_final_package.sh --apply      # switch atomik
#   ./switch_preview_final_package.sh --rollback   # kembali ke rilis 8h
#
# Prinsip yang dijaga (sama seperti switch_staging_3001.sh):
#   * TIDAK menjalankan `next build` di direktori .next yang sedang aktif.
#   * BUILD_ID artefak WAJIB sama dengan yang tercatat di manifest rilis.
#   * Snapshot pm2 jlist + cwd/BUILD_ID lama disimpan SEBELUM perubahan.
#   * Hanya proses `purchasing-staging-3001` yang disentuh.
# ============================================================
set -euo pipefail

APP_NAME="purchasing-staging-3001"
PORT=3001
NEW_DIR="/home/ubuntu/dev-workspaces/purchasing-final-package-release-20261018"
PREV_DIR="/home/ubuntu/dev-workspaces/purchasing-8h-integration-release"
NEW_BUILD_ID_FILE="$NEW_DIR/.next/BUILD_ID"
MANIFEST="$NEW_DIR/state/release-manifest.json"
STATE_DIR="$NEW_DIR/state"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${1:-dry-run}"

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$NEW_BUILD_ID_FILE" ]] || die "artefak rilis tidak ada: $NEW_BUILD_ID_FILE"
NEW_BID="$(cat "$NEW_BUILD_ID_FILE")"
[[ -n "$NEW_BID" ]] || die "BUILD_ID kosong"
[[ -f "$MANIFEST" ]] || die "manifest rilis tidak ada: $MANIFEST"

MANIFEST_BID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build_id"])' "$MANIFEST")"
MANIFEST_COMMIT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source_commit"])' "$MANIFEST")"
APPROVED_BY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("approved_by") or "")' "$MANIFEST")"

[[ "$MANIFEST_BID" == "$NEW_BID" ]] || die "BUILD_ID artefak ($NEW_BID) != manifest ($MANIFEST_BID). Build/verifikasi ulang dulu."

pm2_cwd() {
  pm2 jlist | python3 -c 'import json,sys; d=json.load(sys.stdin); m=[p for p in d if p["name"]=="'"$APP_NAME"'"]; print(m[0]["pm2_env"].get("pm_cwd","") if m else "")'
}

if [[ "$MODE" == "--rollback" ]]; then
  say "=== ROLLBACK $APP_NAME -> $PREV_DIR ==="
  [[ -f "$PREV_DIR/.next/BUILD_ID" ]] || die "rilis sebelumnya tidak ada: $PREV_DIR/.next/BUILD_ID"
  PREV_BID="$(cat "$PREV_DIR/.next/BUILD_ID")"
  say "  kembali ke build_id=$PREV_BID"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  ( cd "$PREV_DIR" && PORT=$PORT pm2 start npm --name "$APP_NAME" -- start -p "$PORT" ) >/dev/null
  sleep 4
  say "  sekarang : cwd=$(pm2_cwd) build_id=$(cat "$(pm2_cwd)/.next/BUILD_ID" 2>/dev/null || echo '?')"
  exit 0
fi

OLD_CWD="$(pm2_cwd)"
OLD_BID=""
[[ -n "$OLD_CWD" && -f "$OLD_CWD/.next/BUILD_ID" ]] && OLD_BID="$(cat "$OLD_CWD/.next/BUILD_ID")"

say "=== RENCANA SWITCH $APP_NAME (port $PORT) ==="
say "  sekarang : cwd=$OLD_CWD build_id=${OLD_BID:-tidak terbaca}"
say "  menjadi  : cwd=$NEW_DIR build_id=$NEW_BID (commit $MANIFEST_COMMIT)"
say "  approval : ${APPROVED_BY:-BELUM ADA}"
say "  mode     : $MODE"

if [[ "$MODE" == "dry-run" ]]; then
  say ""
  say "DRY-RUN: tidak ada perubahan. Jalankan dengan --apply setelah approval Brooklyn."
  exit 0
fi

[[ "$MODE" == "--apply" ]] || die "mode tidak dikenal: $MODE (pakai --apply / --rollback / tanpa argumen)"
[[ -n "$APPROVED_BY" ]] || die "manifest belum mencatat approved_by — switch ditolak (jalankan verifikasi Brooklyn dulu, lalu isi manifest)."

say ""
say "Snapshot state sebelum switch..."
pm2 jlist > "$STATE_DIR/pm2-before-$STAMP.json"
printf '{"name":"%s","cwd":"%s","build_id":"%s","stamp":"%s"}\n' \
  "$APP_NAME" "$OLD_CWD" "$OLD_BID" "$STAMP" > "$STATE_DIR/before-$STAMP.json"

say "Switch atomik (delete + start di cwd baru; TIDAK rebuild)..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
( cd "$NEW_DIR" && ENABLE_SMOKE=1 NEXT_TELEMETRY_DISABLED=1 PORT=$PORT \
    pm2 start npm --name "$APP_NAME" -- start -p "$PORT" ) >/dev/null
sleep 5

NOW_CWD="$(pm2_cwd)"
NOW_BID="$(cat "$NOW_CWD/.next/BUILD_ID" 2>/dev/null || echo '?')"
say "  sekarang : cwd=$NOW_CWD build_id=$NOW_BID"
[[ "$NOW_BID" == "$NEW_BID" ]] || die "readback BUILD_ID tidak cocok ($NOW_BID != $NEW_BID)"
say "  HTTP / : $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
say "SELESAI."
