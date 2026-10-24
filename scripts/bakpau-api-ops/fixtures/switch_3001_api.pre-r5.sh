#!/usr/bin/env bash
# ============================================================
# switch_3001_api.sh — alihkan preview 3001 ke kandidat API Bakpau
# ============================================================
# AMAN & REVERSIBEL:
#   * hanya menyentuh proses PM2 `purchasing-staging-3001`
#   * menyimpan snapshot cwd + build_id SEBELUM switch
#   * rollback: ./switch_3001_api.sh --rollback
#   * tidak menyentuh produksi, tidak menyentuh DB
#
# Kandidat = commit `ac7117b` (SAMA dengan produksi) + 4 commit API-only.
# Jadi UI yang diserve identik dengan produksi; tambahannya hanya route
# /api/bakpau/v1/*. Tidak ada perubahan receipt/hide/invoice.
# ============================================================
set -euo pipefail

APP="purchasing-staging-3001"
PORT=3001
NEW_DIR="/home/ubuntu/dev-workspaces/purchasing-api-t_dd743609"
STATE="/home/ubuntu/.hermes/kanban/boards/purchasing-app/workspaces/t_dd743609"
SNAP="$STATE/3001-before-api-switch.json"
MODE="${1:-dry-run}"

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

[[ -f "$NEW_DIR/.next/BUILD_ID" ]] || die "artefak tidak ada: $NEW_DIR/.next/BUILD_ID"
NEW_BID="$(cat "$NEW_DIR/.next/BUILD_ID")"

OLD_CWD="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[p for p in d if p['name']=='$APP']
print(m[0]['pm2_env'].get('pm_cwd','') if m else '')
")"
OLD_BID=""
[[ -n "$OLD_CWD" && -f "$OLD_CWD/.next/BUILD_ID" ]] && OLD_BID="$(cat "$OLD_CWD/.next/BUILD_ID")"

if [[ "$MODE" == "--rollback" ]]; then
  [[ -f "$SNAP" ]] || die "snapshot tidak ada: $SNAP"
  RB_CWD="$(python3 -c "import json;print(json.load(open('$SNAP'))['cwd'])")"
  RB_BID="$(python3 -c "import json;print(json.load(open('$SNAP'))['build_id'])")"
  say "Rollback ke cwd=$RB_CWD build_id=$RB_BID"
  cd "$RB_CWD"
  pm2 delete "$APP" >/dev/null 2>&1 || true
  pm2 start ./node_modules/next/dist/bin/next --name "$APP" -- start -p "$PORT" >/dev/null
  pm2 save >/dev/null
  sleep 5
  say "root=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)"
  say "BUILD_ID aktif: $(cat "$RB_CWD/.next/BUILD_ID" 2>/dev/null || echo unknown)"
  exit 0
fi

say "=== RENCANA SWITCH $APP ==="
say "  sekarang : cwd=$OLD_CWD build_id=${OLD_BID:-tidak terbaca}"
say "  menjadi  : cwd=$NEW_DIR build_id=$NEW_BID"

[[ "$MODE" == "--apply" ]] || { say ""; say "dry-run. Jalankan --apply untuk eksekusi."; exit 0; }

python3 - "$SNAP" "$OLD_CWD" "$OLD_BID" "$NEW_BID" <<'PY'
import json, os, sys, datetime
out, cwd, bid, new = sys.argv[1:5]
# JANGAN menimpa snapshot rollback yang sudah ada. Dulu setiap --apply
# menulis ulang file ini, sehingga setelah switch kedua kali target rollback
# yang asli (build sebelum API) HILANG dan yang tersimpan justru build
# kandidat itu sendiri — rollback jadi no-op yang tampak berhasil.
prev = None
if os.path.exists(out):
    try:
        prev = json.load(open(out))
    except Exception:
        prev = None
rec = {"cwd": cwd, "build_id": bid, "switched_to_build_id": new,
       "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
if prev and prev.get("build_id") and prev.get("build_id") != bid:
    # Simpan riwayat, bukan menimpa: rollback selalu menunjuk target PERTAMA.
    hist = out.replace(".json", ".history.json")
    h = []
    if os.path.exists(hist):
        try:
            h = json.load(open(hist))
        except Exception:
            h = []
    h.append(rec)
    json.dump(h, open(hist, "w"), indent=2)
    print("snapshot DIPERTAHANKAN:", prev.get("build_id"), "(riwayat:", hist + ")")
else:
    json.dump(rec, open(out, "w"), indent=2)
    print("snapshot:", out)
PY

cd "$NEW_DIR"
# Env API disuntikkan lewat file terpisah (600) supaya tidak pernah muncul
# di argumen proses / log. Hanya NAMA yang dicetak.
ENVFILE="$HOME/.hermes/secure/bakpau/api-server.env"
if [[ -f "$ENVFILE" ]]; then
  say "  env API : memakai $ENVFILE (mode $(stat -c %a "$ENVFILE"))"
  set -a; . "$ENVFILE"; set +a
else
  say "  env API : TIDAK ADA — endpoint akan menjawab 503 api_not_configured (fail closed)"
fi
# Kredensial BACA dari .env.local aplikasi (anon key, RLS berlaku).
if [[ -f /home/ubuntu/purchasing-app/.env.local ]]; then
  set -a; . /home/ubuntu/purchasing-app/.env.local; set +a
  export BAKPAU_API_READ_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
  export BAKPAU_API_READ_SUPABASE_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
fi

# HIGIENE: proses SERVER tidak boleh mewarisi token KLIEN. Token `bpk.…`
# hanya untuk profil Bakpau; kalau ikut ke environment server, ia muncul di
# `pm2 jlist`/dump dan memperluas permukaan kebocoran tanpa manfaat.
unset BAKPAU_API_TOKEN BAKPAU_API_BASE_URL BAKPAU_API_ALLOW_LOOPBACK BAKPAU_API_TIMEOUT_MS || true

pm2 delete "$APP" >/dev/null 2>&1 || true
pm2 start ./node_modules/next/dist/bin/next --name "$APP" -- start -p "$PORT" >/dev/null
pm2 save >/dev/null

for i in $(seq 1 25); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/ || true)" == "200" ]] && break
  sleep 1
done

ROOT="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/)"
say ""
say "root=$ROOT (harus 200)"
say "BUILD_ID disk=$(cat .next/BUILD_ID)"
say "BUILD_ID HTML=$(curl -s http://127.0.0.1:$PORT/ | grep -oE '\"buildId\":\"[^\"]+\"' | head -1)"
say "v1/read GET  = $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/bakpau/v1/read)"
say "v1/read POST = $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:$PORT/api/bakpau/v1/read)"
say "legacy telegram GET = $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/bakpau/telegram)"
say ""
say "Rollback: $0 --rollback"
