#!/usr/bin/env bash
# End-to-end smoke test: build, stub model, daemon on a temp home, create a
# chain, send a message, assert the chain grew. No real API key, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/roan-smoke.XXXXXX")"
DAEMON_PID=""
STUB_PID=""

cleanup() {
  set +e
  [ -n "$DAEMON_PID" ] && kill "$DAEMON_PID" 2>/dev/null
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  wait 2>/dev/null
  if [ "${KEEP:-0}" = "1" ]; then
    echo "kept temp dir: $TMP"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

wait_for_port() {
  local port="$1" i
  for i in $(seq 1 200); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

echo "==> build"
(cd "$ROOT" && npm run build >/dev/null)

echo "==> stub model server"
MODEL_PORT="$(free_port)"
CONTROL_PORT="$(free_port)"
HITS="$TMP/model-hits"

cat >"$TMP/stub-model.cjs" <<'NODE'
const http = require("node:http");
const fs = require("node:fs");
const port = Number(process.argv[2]);
const hitsFile = process.argv[3];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    try {
      JSON.parse(body);
    } catch {
      res.writeHead(400).end("bad json");
      return;
    }
    fs.appendFileSync(hitsFile, "hit\n");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ choices: [{ index: 0, delta: { role: "assistant" } }] });
    send({ choices: [{ index: 0, delta: { content: "pong from the stub" } }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
server.listen(port, "127.0.0.1", () => process.stderr.write(`stub model on ${port}\n`));
NODE

node "$TMP/stub-model.cjs" "$MODEL_PORT" "$HITS" 2>"$TMP/stub.log" &
STUB_PID=$!
wait_for_port "$MODEL_PORT" || { echo "stub model did not start"; exit 1; }

echo "==> temp home and config"
HOME_DIR="$TMP/home"
mkdir -p "$HOME_DIR"
cat >"$HOME_DIR/config.json" <<JSON
{"provider":"openai","baseUrl":"http://127.0.0.1:$MODEL_PORT/v1","model":"stub-model","apiKey":""}
JSON

echo "==> start daemon (control port $CONTROL_PORT)"
ROAN_HOME="$HOME_DIR" ROAN_CONTROL_PORT="$CONTROL_PORT" \
  node "$ROOT/dist/daemon/main.js" >"$TMP/daemon.log" 2>&1 &
DAEMON_PID=$!
wait_for_port "$CONTROL_PORT" || {
  echo "daemon did not start"
  cat "$TMP/daemon.log"
  exit 1
}

echo "==> create chain, send message, check the chain"
cat >"$TMP/client.cjs" <<'NODE'
const WebSocket = require("ws");

const port = Number(process.argv[2]);
const queue = [];
const waiters = [];
let failure = null;

const ws = new WebSocket(`ws://127.0.0.1:${port}`);

function feed(message) {
  queue.push(message);
  for (let i = waiters.length - 1; i >= 0; i--) {
    const waiter = waiters[i];
    const found = queue.find(waiter.pred);
    if (found) {
      queue.splice(queue.indexOf(found), 1);
      waiters.splice(i, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(found);
    }
  }
}

function next(pred, label, ms = 20000) {
  const found = queue.find(pred);
  if (found) {
    queue.splice(queue.indexOf(found), 1);
    return Promise.resolve(found);
  }
  return new Promise((resolve, reject) => {
    const waiter = { pred, resolve };
    waiter.timer = setTimeout(() => {
      const at = waiters.indexOf(waiter);
      if (at >= 0) waiters.splice(at, 1);
      reject(new Error(`timed out waiting for ${label}`));
    }, ms);
    waiters.push(waiter);
  });
}

ws.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  feed(message);
});
ws.on("error", (err) => {
  failure = err;
});

ws.on("open", async () => {
  try {
    const first = await next((m) => m.t === "state", "initial state");
    if (first.data.onboarding !== true) throw new Error("expected onboarding state on an empty home");
    if (first.data.chain !== null) throw new Error("expected no chain yet");

    ws.send(JSON.stringify({ t: "create_chain" }));
    const created = await next((m) => m.t === "chain", "chain response");
    if (!created.chain) throw new Error("create_chain returned no chain id");
    if (!created.node) throw new Error("create_chain returned no node id");
    if (!created.invite) throw new Error("create_chain returned no invite code");

    const afterCreate = await next(
      (m) => m.t === "state" && m.data.chain === created.chain,
      "state for the new chain",
    );
    const before = afterCreate.data.head;

    ws.send(
      JSON.stringify({
        t: "append",
        event: { type: "message", data: { text: "ping" } },
      }),
    );

    const message = await next(
      (m) => m.t === "append" && m.event.type === "message",
      "message append",
    );
    const assistant = await next(
      (m) => m.t === "append" && m.event.type === "assistant",
      "assistant append",
    );
    const text = assistant.event.data && assistant.event.data.text;
    if (text !== "pong from the stub") {
      throw new Error(`assistant text was ${JSON.stringify(text)}, expected "pong from the stub"`);
    }

    ws.send(JSON.stringify({ t: "state" }));
    const after = await next((m) => m.t === "state" && m.data.chain === created.chain, "final state");
    const afterHead = after.data.head;

    if (!(afterHead > before)) throw new Error(`chain did not grow: ${before} -> ${afterHead}`);
    if (afterHead < 4) throw new Error(`expected at least 4 events, got ${afterHead}`);
    if (message.event.seq !== before + 1) {
      throw new Error(`message seq ${message.event.seq}, expected ${before + 1}`);
    }

    console.log(
      JSON.stringify({
        chain: created.chain,
        node: created.node,
        before,
        after: afterHead,
        assistant: text,
      }),
    );
    ws.close();
    setTimeout(() => process.exit(0), 50);
  } catch (err) {
    console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`);
    ws.close();
    setTimeout(() => process.exit(1), 50);
  }
});

setTimeout(() => {
  if (failure) console.error(`websocket error: ${failure.message}`);
  process.exit(1);
}, 30000).unref();
NODE

RESULT="$(NODE_PATH="$ROOT/node_modules" node "$TMP/client.cjs" "$CONTROL_PORT")"
echo "$RESULT"

HITS_COUNT="$(wc -l <"$HITS" | tr -d ' ')"
if [ "$HITS_COUNT" -lt 1 ]; then
  echo "stub model was never called"
  exit 1
fi

BEFORE="$(node -e 'console.log(JSON.parse(process.argv[1]).before)' "$RESULT")"
AFTER="$(node -e 'console.log(JSON.parse(process.argv[1]).after)' "$RESULT")"
if [ "$AFTER" -le "$BEFORE" ]; then
  echo "FAIL: chain head did not grow ($BEFORE -> $AFTER)"
  exit 1
fi

echo "ok: chain $BEFORE -> $AFTER after one message (model calls: $HITS_COUNT)"
