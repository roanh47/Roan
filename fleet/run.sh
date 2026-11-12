#!/usr/bin/env bash
# A work floor: N agents at a time, each on one file, for a fixed number of hours.
# One manager integrates. No agent commits and no agent pushes.
set -uo pipefail

REPO=${REPO:-/home/roan/Roan}
N=${N:-40}                 # concurrent agents; this box dies well before 200
HOURS=${HOURS:-12}
QUEUE=$REPO/fleet/queue
DONE=$REPO/fleet/done
FAILED=$REPO/fleet/failed
LOGS=$REPO/fleet/logs
DEADLINE=$(( $(date +%s) + HOURS * 3600 ))

mkdir -p "$QUEUE" "$DONE" "$FAILED" "$LOGS"
echo "$(date '+%F %T') fleet start: N=$N, ${HOURS}h, queue=$(ls "$QUEUE"/*.txt 2>/dev/null | wc -l)"

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  running=$(jobs -rp | wc -l)
  while [ "$running" -lt "$N" ]; do
    task=$(ls "$QUEUE"/*.txt 2>/dev/null | head -1)
    [ -z "$task" ] && break
    id=$(basename "$task" .txt)
    body=$(cat "$task")
    rm -f "$task"
    (
      cd "$REPO" || exit 1
      timeout 3600 hermes -z "$(cat "$REPO/fleet/prompt.txt")

TAAK: $body" --yolo -t terminal,file --no-restore-cwd > "$LOGS/$id.log" 2>&1
      code=$?
      if [ "$code" -eq 0 ]; then
        cp "$LOGS/$id.log" "$DONE/$id.log" 2>/dev/null
        echo "$id" >> "$DONE/ok.txt"
      else
        cp "$LOGS/$id.log" "$FAILED/$id.log" 2>/dev/null
        echo "$id $code" >> "$FAILED/fail.txt"
      fi
    ) &
    running=$((running + 1))
  done
  sleep 10
done

echo "$(date '+%F %T') wall clock reached, waiting for the last agents"
wait
echo "$(date '+%F %T') fleet done: ok=$(wc -l < "$DONE/ok.txt" 2>/dev/null || echo 0) failed=$(wc -l < "$FAILED/fail.txt" 2>/dev/null || echo 0)"
