#!/usr/bin/env bash
# ============================================================
# serve_candidate.sh — jalankan KANDIDAT API Bakpau di port terpisah
# ============================================================
# TIDAK menyentuh 3001 (milik koordinator rilis / preview DAT) dan tidak
# menulis apa pun ke produksi. Hanya membaca kredensial dari file privat
# (mode 600) yang dibuat oleh provision_token.py, lalu menjalankan build
# kandidat pada port $PORT (default 3011).
#
# Pakai:
#   ./serve_candidate.sh /path/ke/worktree/kandidat [port]
#
# Prasyarat: .next hasil `npx next build` di worktree kandidat, dan
# ~/.hermes/secure/bakpau/{bakpau_api_hash,bakpau_api_token} ada (600).
# ============================================================
set -euo pipefail

APP_DIR="${1:?pakai: serve_candidate.sh <worktree-kandidat> [port]}"
PORT="${2:-3011}"
SECURE_DIR="$HOME/.hermes/secure/bakpau"
HASH_FILE="$SECURE_DIR/bakpau_api_hash"
ENV_LOCAL="/home/ubuntu/purchasing-app/.env.local"

[[ -d "$APP_DIR/.next" ]] || { echo "GAGAL: $APP_DIR/.next tidak ada (build dulu)" >&2; exit 1; }
[[ -f "$HASH_FILE" ]] || { echo "GAGAL: hash token tidak ada di $HASH_FILE" >&2; exit 1; }
[[ -f "$ENV_LOCAL" ]] || { echo "GAGAL: $ENV_LOCAL tidak ada" >&2; exit 1; }

# Nama env saja yang dicetak, tidak pernah nilai.
echo "== Kandidat API Bakpau =="
echo "  dir   : $APP_DIR"
echo "  port  : $PORT"
echo "  token : keyId=bakpau01 (hash dari file 600, tidak dicetak)"
echo "  baca  : NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (RLS berlaku)"
echo "  tulis : SUPABASE_SERVICE_ROLE_KEY hanya bila ada di environment proses"

set -a
# shellcheck disable=SC1090
. "$ENV_LOCAL"
set +a

export BAKPAU_API_TOKENS="bakpau01:$(cat "$HASH_FILE"):purchasing:read+purchasing:create"
export BAKPAU_API_READ_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
export BAKPAU_API_READ_SUPABASE_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

cd "$APP_DIR"
exec npx next start -p "$PORT"
