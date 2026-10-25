#!/usr/bin/env bash
# ============================================================
# switch_3001_api.sh — alihkan preview 3001 ke kandidat API Bakpau
# ============================================================
# AMAN & REVERSIBEL:
#   * hanya menyentuh proses PM2 `purchasing-staging-3001`
#   * menyimpan snapshot cwd + build_id SEBELUM switch (tidak menimpa)
#   * rollback: ./switch_3001_api.sh --rollback
#   * tidak menyentuh produksi, tidak menyentuh DB
#
# URUTAN GERBANG (dikoreksi pada review operasional R5):
#   Sebelumnya pemeriksaan artefak KANDIDAT (baris lama 27) dijalankan
#   SEBELUM cabang --rollback. Akibatnya kandidat yang rusak/hilang membuat
#   rollback ke rilis lama yang SEHAT ikut gagal — justru saat rollback paling
#   dibutuhkan. Sekarang:
#     1. --rollback ditangani LEBIH DULU dan tidak menyentuh kandidat sama sekali;
#     2. target rollback divalidasi (direktori ada, BUILD_ID ada, cocok dengan
#        snapshot) SEBELUM proses PM2 dihapus, sehingga target rusak tidak
#        mematikan preview;
#     3. hasil rollback/switch DIVERIFIKASI (root 200 + buildId HTML == target),
#        bukan sekadar dicetak. Gagal verifikasi = exit non-zero.
#
# Kandidat = commit `ac7117b` (SAMA dengan produksi) + commit API-only.
# ============================================================
set -euo pipefail

APP="${BAKPAU_SWITCH_APP:-purchasing-staging-3001}"
PORT="${BAKPAU_SWITCH_PORT:-3001}"
NEW_DIR="${BAKPAU_SWITCH_NEW_DIR:-/home/ubuntu/dev-workspaces/purchasing-api-t_dd743609}"
STATE="${BAKPAU_SWITCH_STATE:-/home/ubuntu/.hermes/kanban/boards/purchasing-app/workspaces/t_dd743609}"
SNAP="${BAKPAU_SWITCH_SNAP:-$STATE/3001-before-api-switch.json}"
MODE="${1:-dry-run}"
ENVFILE="${BAKPAU_SWITCH_ENVFILE:-$HOME/.hermes/secure/bakpau/api-server.env}"
APP_ENV_LOCAL="${BAKPAU_SWITCH_APP_ENV:-/home/ubuntu/purchasing-app/.env.local}"
# Opsional: paksa identitas snapshot yang diharapkan. Bila diisi dan snapshot
# menunjuk build lain -> rollback DITOLAK (deteksi snapshot tertimpa/dirusak).
EXPECT_BID="${BAKPAU_SWITCH_EXPECT_BUILD_ID:-}"

say() { printf '%s\n' "$*"; }
die() { printf 'GAGAL: %s\n' "$*" >&2; exit 1; }

build_id_of() {
  local dir="$1"
  [[ -n "$dir" && -f "$dir/.next/BUILD_ID" ]] || { printf ''; return 0; }
  cat "$dir/.next/BUILD_ID" 2>/dev/null || true
}

http_code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$PORT$1" || true; }

served_build_id() {
  curl -s -m 10 "http://127.0.0.1:$PORT/" 2>/dev/null \
    | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4 || true
}

WAIT_TRIES="${BAKPAU_SWITCH_WAIT_TRIES:-25}"

wait_root_200() {
  local i
  for i in $(seq 1 "$WAIT_TRIES"); do
    [[ "$(http_code /)" == "200" ]] && return 0
    sleep 1
  done
  return 1
}

# ------------------------------------------------------------
# MODE ROLLBACK — ditangani SEBELUM pemeriksaan kandidat.
# ------------------------------------------------------------
if [[ "$MODE" == "--rollback" ]]; then
  [[ -f "$SNAP" ]] || die "snapshot tidak ada: $SNAP — tidak ada target rollback; proses $APP TIDAK disentuh"
  RB_CWD="$(python3 -c "import json;print(json.load(open('$SNAP')).get('cwd') or '')")"
  RB_BID="$(python3 -c "import json;print(json.load(open('$SNAP')).get('build_id') or '')")"
  [[ -n "$RB_CWD" && -n "$RB_BID" ]] || die "snapshot tidak lengkap (cwd/build_id kosong): $SNAP — proses $APP TIDAK disentuh"
  if [[ -n "$EXPECT_BID" && "$RB_BID" != "$EXPECT_BID" ]]; then
    die "snapshot menunjuk build '$RB_BID', bukan yang diharapkan '$EXPECT_BID' — rollback DITOLAK, proses $APP TIDAK disentuh"
  fi

  # Validasi target SEBELUM menghapus proses yang sedang jalan.
  [[ -d "$RB_CWD" ]] || die "direktori target rollback tidak ada: $RB_CWD — proses $APP TIDAK disentuh"
  [[ -f "$RB_CWD/.next/BUILD_ID" ]] || die "artefak target rollback tidak ada: $RB_CWD/.next/BUILD_ID — proses $APP TIDAK disentuh"
  DISK_BID="$(build_id_of "$RB_CWD")"
  [[ "$DISK_BID" == "$RB_BID" ]] || die "BUILD_ID di disk ($DISK_BID) != snapshot ($RB_BID) — proses $APP TIDAK disentuh"

  say "Rollback ke cwd=$RB_CWD build_id=$RB_BID"
  cd "$RB_CWD"
  pm2 delete "$APP" >/dev/null 2>&1 || true
  pm2 start ./node_modules/next/dist/bin/next --name "$APP" -- start -p "$PORT" >/dev/null
  pm2 save >/dev/null
  wait_root_200 || true

  ROOT="$(http_code /)"
  HTML_BID="$(served_build_id)"
  say "root=$ROOT (harus 200)"
  say "BUILD_ID snapshot=$RB_BID"
  say "BUILD_ID HTML=${HTML_BID:-tidak terbaca}"

  [[ "$ROOT" == "200" ]] || die "ROLLBACK GAGAL: root=$ROOT (harus 200) — preview $APP tidak melayani"
  [[ "$HTML_BID" == "$RB_BID" ]] || die "ROLLBACK GAGAL: buildId HTML '${HTML_BID:-tidak terbaca}' != snapshot '$RB_BID' — preview tidak kembali ke rilis lama"
  say "ROLLBACK TERVERIFIKASI: build $RB_BID melayani root 200"
  exit 0
fi

# ------------------------------------------------------------
# MODE SWITCH (dry-run / --apply) — kandidat WAJIB utuh.
# ------------------------------------------------------------
[[ -f "$NEW_DIR/.next/BUILD_ID" ]] || die "artefak kandidat tidak ada: $NEW_DIR/.next/BUILD_ID"
NEW_BID="$(build_id_of "$NEW_DIR")"
[[ -n "$NEW_BID" ]] || die "BUILD_ID kandidat kosong: $NEW_DIR/.next/BUILD_ID"

OLD_CWD="$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[p for p in d if p['name']=='$APP']
print(m[0]['pm2_env'].get('pm_cwd','') if m else '')
" || true)"
OLD_BID="$(build_id_of "$OLD_CWD")"

say "=== RENCANA SWITCH $APP ==="
say "  sekarang : cwd=${OLD_CWD:-tidak terbaca} build_id=${OLD_BID:-tidak terbaca}"
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
if [[ -f "$ENVFILE" ]]; then
  say "  env API : memakai $ENVFILE (mode $(stat -c %a "$ENVFILE"))"
  set -a; . "$ENVFILE"; set +a
else
  say "  env API : TIDAK ADA — endpoint akan menjawab 503 api_not_configured (fail closed)"
fi
# Kredensial BACA dari .env.local aplikasi (anon key, RLS berlaku).
if [[ -f "$APP_ENV_LOCAL" ]]; then
  set -a; . "$APP_ENV_LOCAL"; set +a
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
wait_root_200 || true

ROOT="$(http_code /)"
HTML_BID="$(served_build_id)"
say ""
say "root=$ROOT (harus 200)"
say "BUILD_ID disk=$(cat .next/BUILD_ID)"
say "BUILD_ID HTML=${HTML_BID:-tidak terbaca}"
say "v1/read GET  = $(http_code /api/bakpau/v1/read)"
say "v1/read POST = $(curl -s -o /dev/null -m 10 -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/bakpau/v1/read" || true)"
say "legacy telegram GET = $(http_code /api/bakpau/telegram)"
say ""

# Verifikasi hasil switch: jangan pernah melaporkan sukses hanya karena
# perintah pm2 selesai tanpa error.
[[ "$ROOT" == "200" ]] || die "SWITCH GAGAL: root=$ROOT (harus 200)"
[[ "$HTML_BID" == "$NEW_BID" ]] || die "SWITCH GAGAL: buildId HTML '${HTML_BID:-tidak terbaca}' != BUILD_ID kandidat '$NEW_BID'"
say "SWITCH TERVERIFIKASI: build $NEW_BID melayani root 200"
say "Rollback: $0 --rollback"
