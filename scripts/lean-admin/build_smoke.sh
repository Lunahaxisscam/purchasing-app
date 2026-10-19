#!/usr/bin/env bash
# Build smoke (SSR render semua modul) di worktree ini saja, serialisasi flock.
set -o pipefail
cd /home/ubuntu/dev-workspaces/purchasing-lean-admin-requests || exit 1
flock -w 900 /home/ubuntu/dev-workspaces/.purchasing-build.lock \
  env ENABLE_SMOKE=1 NODE_OPTIONS=--max-old-space-size=2048 npx next build
