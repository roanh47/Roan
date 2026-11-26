# Security

The rule is one line in `AGENTS.md`: secrets never travel — not in events, not in
the session log, not in a commit, not in an error message. This page describes the
machinery that exists to hold that line, file by file, and what each piece does
not cover.

One caveat changes how everything below reads: most of this machinery is written
and tested but not on the path a turn takes. `src/tools/policy.ts` (its
`decide()`), `src/tools/secrets-scan.ts` and `src/tools/shell-allowlist.ts` have
a test file and no caller that matters: `policy.ts` is imported only for its
`isInsideWorkspace` path helper (by `tools/exec.ts`, `tools/move.ts` and
`workspace/library.ts`, none of which is the `run_shell` the model gets), and
`src/protocol/redact.ts` is imported only by `connectors/github.ts` and
`daemon/logging.ts`, two modules nothing else calls. The sections say so where
it matters, and section 8 lists it in one place. What actually keeps a key out of
the chain today is the first section.

## 1. What travels, and what stays

The env is the part of `~/.Roan` that goes into the chain: nine root files
(`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `config.json`,
`cron.json`, `hooks.json`, `providers.json`) plus everything under `memory/`,
`skills/`, `mcp/` and `imported/`. That list is
`ENV_ROOT_FILES`/`ENV_ROOT_DIRS` in `src/env/types.ts`, and it is exhaustive: the
comment there says `secrets/`, `workspace/` and `synced-workspace/` are never
read, written or moved by anything in `src/env/`, and `collectEnvEntries` in
`src/env/pack.ts` walks only those two lists. The daemon publishes this snapshot
every ten seconds when it changed (`publishEnv` in `src/daemon/env-sync.ts`,
started by `main.ts`), so the env really does travel now.

`secrets/` is where the per-machine material lives. `src/daemon/paths.ts` puts
`identity.json` at `~/.Roan/secrets/identity.json`, and `saveIdentity` in
`src/daemon/identity.ts` writes it with mode `0600` and chmods it to `0600`
afterwards, so the chain token is not world-readable.

**Does not cover — and this one is live:** exclusion is by *filename*, not by
content, and `config.json` is in the travelling set. `src/daemon/settings.ts`
reads an `apiKey` field out of it, `saveSettings` writes that field back
verbatim when the app sends one (`settings_save` → `src/daemon/settings-write.ts`,
atomic write at `0600`), and `readFileEntry` in `src/env/pack.ts` copies the
bytes with no scan. So an API key entered in the app ends up in `config.json`,
in the next env snapshot, in every device's `chain.db` and in the chain's
history — the same file the agent itself can read with `read_file`. The key is
not encrypted at rest either; the file is plain JSON at `0600`. Until the key
moves to `secrets/` (or the packer learns to strip it), "keys never enter the
chain" is a rule the code does not hold. Directory permissions on `secrets/` are
not checked, only the file's.

## 2. What a leak would look like

Four exits, and what guards each today.

**Events.** An `Event` is `{ v, chain, seq, id, node, ts, type, data }`
(`src/protocol/types.ts`) and `data` is opaque to the transport.
`src/daemon/turn-runner.ts` fills it verbatim: `tool_start` becomes a `tool_call`
whose `args` are the model's raw argument string, `tool_end` becomes a
`tool_result` carrying the tool's full output, and an `error` event carries
`err.message` unchanged. Tool output
includes file contents, so `read_file` on a key file puts that key in the chain if
nothing upstream stopped the read. There is no redaction call on this path.

**Session log.** The session log is the chain: append-only rows in
`~/.Roan/workspace/chain.db` (`src/daemon/paths.ts`), written by
`src/chain/store.ts`. There is no second text log today: nothing in `src/daemon/`
writes one, and `.gitignore` ignores `*.log` in case one appears.

**Error messages.** `src/providers/anthropic.ts` and `src/providers/google.ts`
each keep a one-line `redact`/`scrub` that replaces the configured API key
literally (`text.split(apiKey).join("[redacted]")`) before an error leaves the
module. `src/providers/openai-compat.ts` has no equivalent. Any error that
survives that becomes an `error` event via `turn-runner.ts` and is appended to the
chain, so the provider that does not scrub is the one whose error text can carry
key-adjacent material.

**Commits.** `.gitignore` covers `node_modules/`, `dist/`, `*.log` and `.env`.
There is no pre-commit hook (`.git/hooks` holds no active hook) and no scanner in
`scripts/` (only `scripts/gen-catalog.mjs`). Protecting a commit is a review
discipline, not a mechanism.

## 3. The tool policy: allow, ask, deny

`src/tools/policy.ts` defines `Decision = "allow" | "ask" | "deny"` and a
`decide(policy, toolName, toolArgs)` that returns a verdict plus the reason the UI
shows.

The default policy, `defaultPolicy(workspace)`, allows `read_file`, `list_dir`,
`search_files`, `web_search` and `web_fetch`, and asks for `write_file`,
`apply_patch`, `run_shell` and `delete_file`. With no explicit entry, the fallback
splits by capability: a tool in `WRITE_TOOLS` (`write_file`, `apply_patch`,
`run_shell`, `delete_file`) gets `ask`, everything else gets `deny` — an unlisted
tool is not assumed harmless.

`ask` is not a second-class allow. The registry interface in `src/tools/registry.ts`
puts `ask` tools in `allowed()` as well as `needsApproval()`, with the comment
that the agent may try them and the UI is the gate. `get()`/`has()` still return
`undefined` for anything the policy denies, so a denied tool does not exist as far
as the loop is concerned.

**Does not cover:** nothing calls `policy.decide`. `src/tools/registry.ts` has its
own `decide` that looks only at `policy.tools[name]` — it never sees the
arguments, so it cannot apply the path rules in section 4 — and `buildRegistry`
has no caller in `src/`. The live `run_shell` (`src/tools.ts`) and the `delegate`
tool do not consult a policy at all. A tool that is allowed and a tool that is
merely listed as `ask` are indistinguishable to the code that runs a turn;
approval is a chain event the daemon enforces one layer up (`askPermission` →
`approval_request` → `tool_approve`), and only for tools whose `tool_rule` says
`ask`.

## 4. Path rules, including `secrets/`

Inside `decide`, arguments win over the declared verdict: path checks run first,
and a violation returns `deny` even when the policy says `allow` for that tool.
`pathViolation` treats a path as bad when

- it resolves outside `policy.workspace` (`isInsideWorkspace`, `..` included);
- any path segment equals a name in `PROTECTED_DIRS` — `secrets`, `.ssh`,
  `.gnupg` — compared case-insensitively, at any depth;
- it falls inside a directory listed in `extraDenyDirs`; an entry containing a
  separator is resolved as a path, a bare name is added to the segment set;
- it ends in `.pem`.

Resolution is `realpath`-based for the part of the path that exists
(`resolvePath` in `src/tools/policy.ts`), so a symlink pointing at `~/.Roan/secrets`
resolves to the protected path and is caught. Missing tail segments stay lexical,
so a path that does not exist yet is still judged by its spelling.

Arguments are read from keys that name a path: `path`, `paths`, `file`, `files`,
`filename`, `filepath`, `file_path`, `target`, `targets`, `target_path`, `source`,
`src`, `dest`, `destination`, `dir`, `directory`, `cwd`, `root`. Nested objects are
walked to depth 4 (`MAX_ARG_DEPTH`).

**Does not cover:** the inspection is key-name based, so a path that arrives in
another field is invisible — `run_shell`'s `command` and a tool's `content` are
not among the keys, which means `run_shell` can `cat` a file the read tool would
have refused. Nesting deeper than 4 is not walked. Only `*.pem` is caught by
extension; a private key named `id_rsa` or a `.env` is not. And per section 3,
`decide` has no caller: the check that would deny `secrets/` is not invoked by
`agent.ts`, `turn-runner.ts` or `registry.ts`.

## 5. Redaction and the home directory

`src/protocol/redact.ts` is the module written for this rule: "redaction for
everything that leaves the process". Three entry points share one rule set.

`redact(text)` replaces, in this order: any PEM private-key block (an unterminated
one is taken to run to the end of the text), the credential after
`Authorization: Bearer|Basic|Token`, the userinfo in `scheme://user:pass@host`, and
token shapes — `sk-…` (including `sk-ant-`, `sk-proj-`, `sk-svcacct-`),
`github_pat_…`, `ghp_/gho_/ghu_/ghs_/ghr_…`, `xox[abeprs]-…`, Google `AIza…`, and
AWS `AKIA`/`ASIA` key ids. `extraPatterns` can add expressions. Replacement text
is `[redacted]`, which no rule matches again, so a second pass over the same
string is a no-op and cannot grow it.

`redactDeep(value)` applies `redact` to every string in a plain object or array,
without mutating the input, and turns a self-reference into `"[circular]"` rather
than recursing forever. `redactUrl(url)` drops `user:pass@` entirely and keeps
the name but not the value of query parameters whose name matches
`key|token|secret|password|sig`, then passes the rest through `redact` so a token
in the path is caught too.

The home directory is collapsed last, by `collapseHome`: literal occurrences of
the user's home path (from `os.homedir()`, or `options.home`) become `~/`, so a
workspace path in a log line reads `~/Roan` and not `/home/<user>/Roan`. It is a
literal split, not a pattern, so a home path containing regex metacharacters
cannot corrupt the substitution.

**Does not cover:** the module's own header calls it a best-effort scrubber for
"the credential shapes this project actually emits", and that is the honest
summary. There is no entropy heuristic, so a password, a JWT, an AWS *secret*
access key, a database URL whose password is not in userinfo, a session cookie,
or a hex key in prose all pass through unchanged. `redactDeep` returns class
instances, Maps and Dates by reference untouched, so strings inside them are not
scrubbed. `collapseHome` only knows one home, and only whole occurrences.

The larger gap is reach: `src/protocol/redact.ts` is imported by
`src/connectors/github.ts` and `src/daemon/logging.ts` and nothing else, and
neither of those is on the turn path — the connector has no route and the log
writer has no caller. `src/protocol/index.ts` — the protocol's single import
surface — does not re-export it. `src/daemon/diagnostics.ts` still carries a
private copy of a few patterns plus its own `collapseHome`, with a comment saying
`redact.ts` "does not exist yet"; that comment is now wrong, but the module has
no caller either, so nothing is scrubbed through either path. Event payloads are
never redacted.

## 6. The secrets scanner

`src/tools/secrets-scan.ts` answers "is there a key in this tree", for a repo or a
workspace, without printing it. `scanForSecrets(root, options)` returns
`{ findings, scanned, skipped, truncated }`; each finding is a file (relative,
forward slashes), a 1-based line and column, a `kind`, and a preview.

Nine rules, ordered so `sk-ant-` is not reported as `sk-`: `anthropic-key`,
`openai-key`, `github-token`, `slack-token`, `google-api-key`,
`aws-access-key-id`, `bearer-token`, `private-key`, and `assigned-credential`
(a key name containing `api_key|secret|token|password|passwd|client_secret`
followed by `=` or `:` — `.env`, YAML and TOML lines). The assigned-credential rule
drops values that look like placeholders (`${…}`, `change_me`, `your_…`, `xxx`,
`…`), deliberately biased toward a false positive over a miss.

The preview is the finding's only rendering of the value: first four and last four
characters with `…` between, and anything 12 characters or shorter becomes a bare
`…`, so the preview can never be the whole secret.

Traversal skips `node_modules`, `.git`, `dist` and `build`, skips symlinks, files
over 1 MiB, and files whose first 8 KiB contain a NUL byte (binary). Unreadable
directories count as `skipped` and never throw. Defaults are 2000 files and 500
findings; hitting either sets `truncated`, so a clean result is only clean if
`truncated` is false.

**Does not cover:** it reads text only — a key inside an image, a PDF, a SQLite
file or a `.zip` is not found. It only knows the nine rule shapes, so a generic
high-entropy secret, a JWT or a bare hex key is missed (the same blind spot as
section 5). Only `scanForSecrets`' own test calls it: there is no tool, no
pre-commit step and no daemon call that runs it, so nothing scans a workspace
before a turn or a commit today.

## 7. The shell command allowlist

`src/tools/shell-allowlist.ts` classifies a command line before anything runs it.
It never executes and never expands: `splitRaw` cuts the string lexically on
`&&`, `||`, `;`, newlines and a single `|`, with single and double quotes
protecting their contents, so `echo 'a && b'` stays one segment. Each segment is
judged by the first matching rule and the worst verdict wins —
`deny` > `ask` > `allow`.

`defaultRules` denies `rm -rf /`, `sudo`/`doas`, `chmod 777`, `mkfs`, `dd` writing
to `/dev/`, `sh -c` combined with `curl`/`wget`, a force push to a protected
branch, and redirects or writes into `/etc`, `/usr`, `/boot`, `/dev`. A whole-line
rule catches fork bombs, because their danger is in the combination of segments.
It allows read-only commands (`ls`, `pwd`, `cat`, `head`, `tail`, `wc`,
`git status|diff|log`, `node --version`) and the workspace's own checks
(`npm run typecheck`, `npm run build`, `npm test`). It asks for `git push`,
state-changing git verbs, `rm`, and dependency or publish commands. A pipeline
that feeds a downloader into `sh`/`bash`/`zsh`/`dash`/`ksh` is denied even though
each segment alone might pass.

Two mechanisms keep the allow list from being a bypass: an allow rule is skipped
for any segment containing `<`, `>`, a backtick or `$(` (that segment can write
or substitute, so it falls through to `ask`), and an unterminated quote returns
`ask` instead of being guessed at. An unmatched segment is `ask`, never `allow`,
so the list fails closed.

**Does not cover:** it reads text, not a shell. Obfuscation that is still valid
bash — `$(printf ...)`, a variable built from pieces, an alias, a script in the
repo run by `npm test` — is not modelled. The rules match command *text*, not
arguments, so `cat secrets/identity.json` and `ls ~/.Roan/secrets` are `allow`:
the allowlist is not a path guard, and it does not consult `policy.ts`. Its
`npm test` / `npm run build` allowances execute whatever the workspace's
`package.json` defines.

And the decisive gap: `runShell` in `src/tools.ts` — the `run_shell` the agent
actually has — calls `exec` with `shell: "/bin/bash"` and never calls
`classifyCommand`. Only `src/tools/shell-allowlist.test.ts` does.

## 8. What holds, what is written but unwired, and what does not hold

**Holds at runtime:**

| Piece | File | Called by |
| --- | --- | --- |
| identity at `0600` | `src/daemon/identity.ts` | `createIdentity` in the daemon |
| `secrets/` outside the env packer | `src/env/types.ts`, `src/env/pack.ts` | `packEnv` (live: `publishEnv` every 10 s) |
| provider key scrub | `src/providers/{anthropic,google}.ts` | their own error paths |
| path containment for the app's file routes | `src/workspace/library.ts` (`isInsideWorkspace`) + the prefix check in `main.ts` | `workspace_read` / `workspace_write` |
| approval gate for tools with a `tool_rule` ask | `src/daemon/main.ts` (`askPermission`) | every turn's tool list |

**Written and tested, but no caller that a turn reaches:**

| Piece | File | Called by |
| --- | --- | --- |
| `decide()` allow/ask/deny + path rules | `src/tools/policy.ts` | nothing calls `decide`; `exec.ts`, `move.ts` and `workspace/library.ts` import only `isInsideWorkspace` |
| registry built from a policy | `src/tools/registry.ts` | nothing |
| redaction, home collapse | `src/protocol/redact.ts` | `connectors/github.ts`, `daemon/logging.ts` — both unwired |
| secrets scanner | `src/tools/secrets-scan.ts` | its own test |
| shell allowlist | `src/tools/shell-allowlist.ts` | its own test; the live `run_shell` calls `exec` directly |
| sandbox, untrusted blocks, elevation, audit log | `src/safety/{sandbox,untrusted,elevation,audit-log}.ts` | nothing |
| signed webhooks in and out | `src/webhooks/dispatch.ts`, `src/webhooks/sign.ts` | nothing — no HTTP route in the daemon, no trigger kind |
| GitHub connector | `src/connectors/github.ts` | nothing — no route and no tool; the token is read from `secrets/` |
| device control | `src/sync/device-control.ts` | nothing — no `device_req` frame |
| health + diagnostics snapshot | `src/daemon/health.ts`, `src/daemon/diagnostics.ts` | nothing and no test |

**Does not hold:** an API key entered in the app is written into `config.json`,
which is part of the env the daemon publishes into the chain (section 1). So
today the one guarantee the README states — keys never enter the chain — is not
enforced anywhere in the code.

So the guarantees that are actually enforced at runtime are narrow and worth
stating plainly: `secrets/` is outside the set the env packer walks, the identity
file is written `0600`, two of the provider adapters strip the configured key from
their own error text, the app's workspace routes cannot leave the workspace, a
tool whose rule says `ask` waits for an approval event, and
every tool resolves its path against the workspace (`resolveInside` in
`src/tools.ts`, which rejects `..` and absolute escapes for `read_file`,
`write_file` and `list_dir`). The policy, the path deny list, the scrubber, the
scanner and the sandbox are real, tested modules waiting for the calls that
`docs/architecture.md` also notes are missing.

A turn that needs a key inside `secrets/` will still be able to read it through
`run_shell`, and the result will be appended to the chain as a `tool_result`.
Until `policy.decide` sits in front of the tool call and `redactDeep` sits in
front of `append`, that is the honest description of this page.
