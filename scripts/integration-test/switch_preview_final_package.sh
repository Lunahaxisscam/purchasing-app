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

# Start helper — SATU cara start untuk --apply dan --rollback.
# Port HANYA lewat env PORT. JANGAN `-- start -p $PORT`: npm meneruskan `-p 3001`
# menjadi `next start 3001`, dan Next membaca "3001" sebagai DIREKTORI PROYEK
# ("Invalid project directory ... /3001") -> proses errored, preview 3001 mati.
# Ditemukan Brooklyn t_987f2c96 (preview down ~3 menit). Diuji ulang: `npm start
# -p 3019` gagal, `npm start` + env PORT = 200 + buildId tersaji.
start_app() { # $1 = cwd — mengembalikan non-zero bila pm2 menolak (caller memutuskan)
  ( cd "$1" && ENABLE_SMOKE=1 NEXT_TELEMETRY_DISABLED=1 PORT=$PORT \
      pm2 start npm --name "$APP_NAME" -- start ) >/dev/null
}

# Tunggu HTTP 200 (maks ~20s). `|| true` WAJIB: dengan `set -euo pipefail`,
# curl yang gagal koneksi (exit 7) akan mematikan skrip tanpa pesan apa pun.
wait_ready() {
  local code=000 i
  for i in $(seq 1 20); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
    [[ "$code" == "200" ]] && break
    sleep 1
  done
  printf '%s' "$code"
}

# BUILD_ID yang benar-benar DISAJIKAN di HTML (bukan cuma file .next/BUILD_ID).
# `|| true` di tiap tahap supaya grep/cut tanpa hasil tidak mematikan skrip
# sebelum pesan diagnostik sempat dicetak.
served_build_id() {
  { curl -s "http://127.0.0.1:$PORT/" || true; } \
    | { grep -o 'buildId":"[^"]*' || true; } \
    | { head -1 || true; } \
    | { cut -d'"' -f3 || true; }
}

# Kembalikan preview ke cwd/BUILD_ID tertentu (dipakai --rollback dan saat
# --apply gagal readback, supaya preview TIDAK ditinggal mati).
restore_to() { # $1 = cwd
  local dir="$1" want="$2" code bid
  say "  memulihkan ke cwd=$dir build_id=$want"
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  start_app "$dir"
  pm2 save >/dev/null 2>&1 || true
  code="$(wait_ready)"
  bid="$(served_build_id)"
  say "  readback pemulihan: HTTP=$code build_id_tersaji=${bid:-tidak terbaca}"
  [[ "$code" == "200" && "$bid" == "$want" ]]
}

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
  restore_to "$PREV_DIR" "$PREV_BID" || die "rollback gagal: preview tidak menyajikan $PREV_BID"
  say "  sekarang : cwd=$(pm2_cwd) build_id=$(cat "$(pm2_cwd)/.next/BUILD_ID" 2>/dev/null || echo '?')"
  say "ROLLBACK SELESAI."
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
start_app "$NEW_DIR"

NOW_CWD="$(pm2_cwd)"
NOW_BID="$(cat "$NOW_CWD/.next/BUILD_ID" 2>/dev/null || echo '?')"
say "  sekarang : cwd=$NOW_CWD build_id=$NOW_BID"

# Readback dari yang DISAJIKAN (bukan hanya file BUILD_ID). Bila gagal:
# pulihkan ke build lama dulu, baru keluar dengan pesan — preview tidak boleh
# ditinggal mati seperti pada insiden t_987f2c96.
CODE="$(wait_ready)"
SERVED_BID="$(served_build_id)"
say "  HTTP / : $CODE"
say "  BUILD_ID tersaji di HTML: ${SERVED_BID:-tidak terbaca}"

if [[ "$NOW_BID" != "$NEW_BID" || "$CODE" != "200" || "$SERVED_BID" != "$NEW_BID" ]]; then
  say ""
  say "READBACK GAGAL (file=$NOW_BID http=$CODE tersaji=${SERVED_BID:-?} != $NEW_BID)"
  if [[ -n "$OLD_CWD" && -n "$OLD_BID" ]]; then
    say "Mengembalikan preview ke build sebelumnya (tidak ditinggal mati)..."
    restore_to "$OLD_CWD" "$OLD_BID" || say "PERINGATAN: pemulihan otomatis GAGAL — preview perlu dicek manual."
  else
    say "PERINGATAN: snapshot cwd/BUILD_ID lama tidak terbaca — preview perlu dicek manual."
  fi
  die "switch dibatalkan; preview dikembalikan ke build sebelumnya"
fi
# Simpan dump PM2 supaya switch bertahan setelah reboot/resurrect (sama seperti
# switch_staging_3001.sh). Tanpa ini, `pm2 resurrect` mengembalikan proses LAMA.
pm2 save >/dev/null 2>&1 || say "PERINGATAN: pm2 save gagal — switch aktif tapi tidak tahan reboot."
say "SELESAI."
