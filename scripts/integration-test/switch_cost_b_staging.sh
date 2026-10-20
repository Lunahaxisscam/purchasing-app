#!/bin/bash
# ============================================================
# switch_cost_b_staging.sh — sajikan rilis integrasi Tahap B di port 3001
# ============================================================
# Prinsip (sama dengan scripts/integration-test/switch_staging_3001.sh):
#   * TIDAK membangun ulang .next yang disajikan; artefak = salinan .next yang
#     sudah dibangun + diverifikasi di worktree.
#   * BUILD_ID artefak WAJIB sama dengan manifest rilis.
#   * Snapshot cwd/BUILD_ID lama disimpan; rollback otomatis bila readback gagal.
#   * Hanya proses `purchasing-staging-3001` yang disentuh.
set -uo pipefail

APP_NAME="purchasing-staging-3001"
PORT=3001
SRC="/home/ubuntu/dev-workspaces/purchasing-project-cost-link"
NEW_DIR="/home/ubuntu/dev-workspaces/purchasing-cost-b-release-20261020-1728"
STATE_DIR="$NEW_DIR/state"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$SRC/.next/BUILD_ID" ]] || die "artefak build tidak ada di $SRC/.next"
NEW_BID="$(cat "$SRC/.next/BUILD_ID")"
COMMIT="$(cd "$SRC" && git rev-parse HEAD)"
[[ -n "$NEW_BID" ]] || die "BUILD_ID kosong"

# --- 1) siapkan direktori rilis immutable (kode tracked + .next) ---
mkdir -p "$NEW_DIR"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .next \
  "$SRC"/ "$NEW_DIR"/
rsync -a --delete "$SRC/.next/" "$NEW_DIR/.next/"
ln -sfn "$(readlink -f "$SRC/node_modules")" "$NEW_DIR/node_modules"
mkdir -p "$STATE_DIR"
cat > "$NEW_DIR/state/release-manifest.json" <<JSON
{
  "build_id": "$NEW_BID",
  "source_commit": "$COMMIT",
  "source_worktree": "$SRC",
  "branch": "$(cd "$SRC" && git rev-parse --abbrev-ref HEAD)",
  "created_at": "$STAMP",
  "app": "$APP_NAME",
  "port": $PORT
}
JSON

OLD_CWD="$(pm2 jlist | python3 -c 'import json,sys;d=json.load(sys.stdin);m=[p for p in d if p["name"]=="'"$APP_NAME"'" and p["pid"]];print(m[0]["pm2_env"].get("pm_cwd","") if m else "")')"
OLD_BID=""
[[ -n "$OLD_CWD" && -f "$OLD_CWD/.next/BUILD_ID" ]] && OLD_BID="$(cat "$OLD_CWD/.next/BUILD_ID")"

say "sekarang : cwd=$OLD_CWD build_id=${OLD_BID:-tidak terbaca}"
say "menjadi  : cwd=$NEW_DIR build_id=$NEW_BID commit=$COMMIT"

printf '{"name":"%s","cwd":"%s","build_id":"%s","stamp":"%s"}\n' \
  "$APP_NAME" "$OLD_CWD" "$OLD_BID" "$STAMP" > "$STATE_DIR/before-$STAMP.json"

# --- 2) switch atomik ---
cd "$NEW_DIR" || die "cd $NEW_DIR gagal"
ENABLE_SMOKE=1 pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
ENABLE_SMOKE=1 pm2 start ./node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$PORT" >/dev/null || die "pm2 start gagal"
pm2 save >/dev/null 2>&1 || true

# --- 3) readback nyata ---
for _ in $(seq 1 25); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
ROOT="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
SMOKE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/__smoke")"
API_GET="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/sales-invoices")"
API_SEED="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/seed-simulation")"
CHUNK_PATH="$(cd "$NEW_DIR" && ls .next/static/chunks/pages/_app-*.js | head -1)"
CHUNK_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/_next${CHUNK_PATH#.next}")"
HTML_BID="$(curl -s "http://127.0.0.1:$PORT/" | grep -c "$NEW_BID" || true)"
SERVED_BID="$(cat "$NEW_DIR/.next/BUILD_ID")"
LISTENER="$(ss -ltnp 2>/dev/null | grep ":$PORT " | head -1)"

say ""
say "=== READBACK ==="
say "  root=$ROOT smoke=$SMOKE chunk=$CHUNK_CODE html_build_id_hits=$HTML_BID"
say "  api sales-invoices GET=$API_GET (harus 401) ; seed-simulation POST=$API_SEED (403/409 = tertutup)"
say "  BUILD_ID disajikan=$SERVED_BID (manifest: $NEW_BID)"
say "  listener: $LISTENER"
if [[ "$ROOT" != "200" || "$HTML_BID" -lt 1 || "$CHUNK_CODE" != "200" ]]; then
  say "READBACK GAGAL — rollback ke rilis sebelumnya."
  if [[ -n "$OLD_CWD" && -f "$OLD_CWD/.next/BUILD_ID" ]]; then
    cd "$OLD_CWD" || die "cd rollback gagal"
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    pm2 start ./node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$PORT" >/dev/null
    pm2 save >/dev/null 2>&1 || true
    sleep 6
    say "rollback root=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/") build=$(cat "$OLD_CWD/.next/BUILD_ID")"
  fi
  die "switch dibatalkan"
fi
say ""
say "Switch selesai. BUILD_ID=$NEW_BID commit=$COMMIT"
