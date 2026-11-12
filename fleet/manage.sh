#!/usr/bin/env bash
# The manager: every INTERVAL seconds, integrate what the agents wrote.
# Only touches shared files, only commits when typecheck is clean.
set -uo pipefail

REPO=${REPO:-/home/roan/Roan}
INTERVAL=${INTERVAL:-300}
cd "$REPO" || exit 1

while true; do
  sleep "$INTERVAL"
  if [ -z "$(git status --porcelain)" ]; then continue; fi

  if npx tsc --noEmit > /tmp/fleet-tsc.log 2>&1; then
    npm test > /tmp/fleet-test.log 2>&1 || { echo "$(date '+%F %T') tests failed, not committing"; continue; }
    git add -A
    git -c user.email=roan@local -c user.name=Roan commit -q -m "Fleet batch: $(git status --porcelain | wc -l) files" || continue
    git push -q origin main && echo "$(date '+%F %T') committed and pushed"
  else
    echo "$(date '+%F %T') typecheck red: $(grep -c 'error TS' /tmp/fleet-tsc.log) errors, waiting"
  fi
done
