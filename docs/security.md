# Security

The rule is one line in `AGENTS.md`: secrets never travel — not in events, not in
the session log, not in a commit, not in an error message. This page describes the
machinery that exists to hold that line, file by file, and what each piece does
not cover.

One caveat changes how everything below reads: most of this machinery is written
and tested but not on the path a turn takes. `src/tools/policy.ts`,
`src/protocol/redact.ts`, `src/tools/secrets-scan.ts` and
`src/tools/shell-allowlist.ts` each have a test file and no production caller. The
sections say so where it matters, and section 8 lists it in one place. What
actually keeps a key out of the chain today is the first section.

## 1. What travels, and what stays

The env is the part of `~/.roan` that goes into the chain: five root files
(`AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `config.json`) plus everything
under `memory/`, `skills/` and `mcp/`. That list is
`ENV_ROOT_FILES`/`ENV_ROOT_DIRS` in `src/env/types.ts`, and it is exhaustive: the
comment there says `secrets/`, `workspace/` and `synced-workspace/` are never
read, written or moved by anything in `src/env/`, and `collectEnvEntries` in
`src/env/pack.ts` walks only those two lists.

`secrets/` is where the per-machine material lives. `src/daemon/paths.ts` puts
`identity.json` at `~/.roan/secrets/identity.json`, and `saveIdentity` in
`src/daemon/identity.ts` writes it with mode `0600` and chmods it to `0600`
afterwards, so the chain token is not world-readable.

**Does not cover:** exclusion is by *filename*, not by content. `config.json` is
in the travelling set, and `src/daemon/settings.ts` reads an optional `apiKey`
field out of it — `readFileEntry` in `src/env/pack.ts` copies a file's bytes with
no scan, so a `config.json` that holds a key would be packed and sent. Nothing in
`src/` currently writes that file, so the field is only reachable if something
else writes it, but the packer will not stop it. Directory permissions on
`secrets/` are not checked, only the file's.

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
`~/.roan/workspace/chain.db` (`src/daemon/paths.ts`), written by
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
has no caller in `src/`. A tool that is allowed and a tool that is merely
listed as `ask` are indistinguishable to the code that runs a turn; approval is
a UI concept that the daemon does not enforce.

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
(`resolvePath` in `src/tools/policy.ts`), so a symlink pointing at `~/.roan/secrets`
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

The larger gap is reach: nothing in `src/` imports `src/protocol/redact.ts`
except its own test, and `src/protocol/index.ts` — the protocol's single import
surface — does not re-export it. `src/daemon/diagnostics.ts` carries a private
copy of a few patterns plus its own `collapseHome`, with a comment saying
`redact.ts` "does not exist yet"; diagnose snapshots are scrubbed, event payloads
are not.

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
arguments, so `cat secrets/identity.json` and `ls ~/.roan/secrets` are `allow`:
the allowlist is not a path guard, and it does not consult `policy.ts`. Its
`npm test` / `npm run build` allowances execute whatever the workspace's
`package.json` defines.

And the decisive gap: `runShell` in `src/tools.ts` — the `run_shell` the agent
actually has — calls `exec` with `shell: "/bin/bash"` and never calls
`classifyCommand`. Only `src/tools/shell-allowlist.test.ts` does.

## 8. What holds, and what is written but unwired

| Piece | File | Called by |
| --- | --- | --- |
| `secrets/` out of the travelling env | `src/env/types.ts`, `src/env/pack.ts` | `packEnv`, which no code outside `src/env/` calls |
| identity at `0600` | `src/daemon/identity.ts` | `createIdentity` in the daemon |
| allow/ask/deny + path rules | `src/tools/policy.ts` | nothing |
| registry built from a policy | `src/tools/registry.ts` | nothing |
| redaction, home collapse | `src/protocol/redact.ts` | its own test |
| secrets scanner | `src/tools/secrets-scan.ts` | its own test |
| shell allowlist | `src/tools/shell-allowlist.ts` | its own test |
| provider key scrub | `src/providers/{anthropic,google}.ts` | their error paths |

So today the guarantees that are actually enforced at runtime are narrow and worth
stating plainly: `secrets/` is outside the set the env packer walks, the identity
file is written `0600`, two of the provider adapters strip the configured key from
their own error text, and every tool resolves its path against the workspace
(`resolveInside` in `src/tools.ts`, which rejects `..` and absolute escapes for
`read_file`, `write_file` and `list_dir`). The policy, the path deny list, the
scrubber and the scanner are all real, tested modules waiting for the calls that
`docs/architecture.md` also notes are missing.

A turn that needs a key inside `secrets/` will still be able to read it through
`run_shell`, and the result will be appended to the chain as a `tool_result`.
Until `policy.decide` sits in front of the tool call and `redactDeep` sits in
front of `append`, that is the honest description of this page.
