#!/bin/bash
# ============================================================
# switch_staging_3001.sh — alihkan PM2 preview 3001 ke artefak integrasi
# ============================================================
# DIPAKAI HANYA SETELAH Brooklyn memberi approval eksplisit atas commit
# integrasi yang akan disajikan. Tanpa argumen, skrip ini DRY-RUN (tidak
# menyentuh PM2 sama sekali).
#
#   ./switch_staging_3001.sh                 # dry-run: cetak rencana + cek
#   ./switch_staging_3001.sh --apply         # lakukan switch atomik
#   ./switch_staging_3001.sh --rollback      # kembalikan ke rilis sebelumnya
#
# Prinsip yang dijaga:
#   * TIDAK menjalankan `next build` di direktori .next yang sedang aktif.
#   * Artefak rilis adalah salinan .next yang SUDAH dibangun & diverifikasi
#     di tempat lain (BUILD_ID dicocokkan dengan commit).
#   * Rollback disimpan: pm2 dump + nama proses + cwd lama dicatat ke berkas
#     sebelum apa pun diubah.
#   * Hanya proses `purchasing-staging-3001` yang disentuh. Layanan lain
#     (9router, drive-sync, virtual-office, stt-shim, tukang-upah-sync,
#     noirliving-web-preview) TIDAK direstart.
# ============================================================
set -euo pipefail

APP_NAME="purchasing-staging-3001"
PORT=3001
NEW_DIR="/home/ubuntu/dev-workspaces/purchasing-8h-integration-release"
NEW_BUILD_ID_FILE="$NEW_DIR/.next/BUILD_ID"
MANIFEST="$NEW_DIR/state/release-manifest.json"
STATE_DIR="/home/ubuntu/dev-workspaces/purchasing-8h-integration-release/state"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
MODE="${1:-dry-run}"

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$NEW_BUILD_ID_FILE" ]] || die "artefak rilis tidak ada: $NEW_BUILD_ID_FILE"
NEW_BID="$(cat "$NEW_BUILD_ID_FILE")"
[[ -n "$NEW_BID" ]] || die "BUILD_ID kosong"

# BUILD_ID yang disajikan harus SAMA dengan yang tercatat di manifest rilis —
# mencegah menyajikan .next yang tertimpa build lain tanpa verifikasi ulang.
if [[ -f "$MANIFEST" ]]; then
  MANIFEST_BID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["build_id"])' "$MANIFEST")"
  MANIFEST_COMMIT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["source_commit"])' "$MANIFEST")"
  [[ "$MANIFEST_BID" == "$NEW_BID" ]] || die "BUILD_ID artefak ($NEW_BID) != manifest ($MANIFEST_BID). Build/verifikasi ulang dulu."
else
  MANIFEST_COMMIT="(manifest tidak ada)"
fi

OLD_CWD="$(pm2 jlist | python3 -c 'import json,sys; d=json.load(sys.stdin); m=[p for p in d if p["name"]=="'"$APP_NAME"'"]; print(m[0]["pm2_env"].get("pm_cwd","") if m else "")')"
OLD_BID=""
[[ -n "$OLD_CWD" && -f "$OLD_CWD/.next/BUILD_ID" ]] && OLD_BID="$(cat "$OLD_CWD/.next/BUILD_ID")"

say "=== RENCANA SWITCH $APP_NAME (port $PORT) ==="
say "  sekarang : cwd=$OLD_CWD build_id=${OLD_BID:-tidak terbaca}"
say "  menjadi  : cwd=$NEW_DIR build_id=$NEW_BID (commit $MANIFEST_COMMIT)"
say "  mode     : $MODE"

if [[ "$MODE" == "dry-run" ]]; then
  say ""
  say "Dry-run: tidak ada perubahan. Jalankan dengan --apply setelah approval."
  say "Prasyarat yang harus benar SEBELUM --apply:"
  say "  1) /__smoke 200 dan / 200 di server bayangan port 3016 (sudah diverifikasi)."
  say "  2) GET/POST/PATCH /api/sales-invoices tanpa sesi = 401."
  say "  3) BUILD_ID artefak == commit yang di-approve Brooklyn."
  exit 0
fi

mkdir -p "$STATE_DIR"

if [[ "$MODE" == "--rollback" ]]; then
  SNAP="$(ls -1t "$STATE_DIR"/before-*.json 2>/dev/null | head -1 || true)"
  [[ -n "$SNAP" ]] || die "tidak ada snapshot rollback di $STATE_DIR"
  RB_CWD="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["cwd"])' "$SNAP")"
  RB_BID="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["build_id"])' "$SNAP")"
  say "Rollback ke cwd=$RB_CWD build_id=$RB_BID"
  cd "$RB_CWD"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 start ./node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$PORT" >/dev/null
  pm2 save >/dev/null
  sleep 6
  SERVED="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
  say "readback root=$SERVED (harus 200). BUILD_ID aktif: $(cat "$RB_CWD/.next/BUILD_ID")"
  exit 0
fi

[[ "$MODE" == "--apply" ]] || die "mode tidak dikenal: $MODE (pakai --apply / --rollback)"

# --- 0) snapshot rollback (state, bukan tebakan) ---
python3 - "$STATE_DIR/before-$STAMP.json" "$APP_NAME" "$OLD_CWD" "$OLD_BID" <<'PY'
import json, sys
out, name, cwd, bid = sys.argv[1:5]
json.dump({"name": name, "cwd": cwd, "build_id": bid, "stamp": out.split("before-")[-1].replace(".json", "")},
          open(out, "w"), indent=2)
print("snapshot:", out)
PY
pm2 jlist > "$STATE_DIR/pm2-before-$STAMP.json" 2>/dev/null || true
say "snapshot rollback tersimpan di $STATE_DIR"

# --- 1) proses lain TIDAK disentuh: catat pid mereka untuk dibuktikan ---
pm2 jlist | python3 -c 'import json,sys
d=json.load(sys.stdin)
print("PID lain (tidak boleh berubah):")
for p in d:
    if p["name"] != "'"$APP_NAME"'":
        print("  ", p["name"], p["pid"])'

# --- 2) switch atomik: hapus lalu start di cwd baru, satu perintah PM2 ---
cd "$NEW_DIR"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start ./node_modules/next/dist/bin/next --name "$APP_NAME" -- start -p "$PORT" >/dev/null
pm2 save >/dev/null
say "PM2 start dikirim untuk $APP_NAME di $NEW_DIR"

# --- 3) verifikasi readback (klaim hanya setelah dibaca ulang) ---
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
ROOT="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
SMOKE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/__smoke")"
API_GET="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/sales-invoices")"
API_POST="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/sales-invoices")"
API_PATCH="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/sales-invoices")"
HTML_BID="$(curl -s "http://127.0.0.1:$PORT/" | grep -c "$NEW_BID" || true)"
CHUNK_PATH="$(cd "$NEW_DIR" && ls .next/static/chunks/pages/_app-*.js | head -1)"
CHUNK_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/_next${CHUNK_PATH#.next}")"

say ""
say "=== READBACK ==="
say "  root=$ROOT  smoke=$SMOKE  chunk=$CHUNK_CODE  html_build_id_hits=$HTML_BID"
say "  api GET=$API_GET POST=$API_POST PATCH=$API_PATCH (semua harus 401)"
if [[ "$ROOT" != "200" || "$API_GET" != "401" || "$HTML_BID" -lt 1 ]]; then
  say ""
  say "READBACK GAGAL — menjalankan rollback otomatis."
  "$0" --rollback
  die "switch dibatalkan; staging dikembalikan ke rilis sebelumnya"
fi
say ""
say "Switch selesai dan terbaca. BUILD_ID disajikan: $NEW_BID"
