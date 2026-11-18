# Policy reference

A policy is one YAML (or JSON) file. Blastgate validates it strictly: unknown keys, bad regexes, duplicate rule ids and empty match blocks are errors, and a policy that fails validation never loads.

## Lookup order

1. `--policy <file or built-in name>`
2. `$BLASTGATE_POLICY`
3. `./blastgate.yaml` (or `.yml`)
4. `~/.blastgate/policy.yaml`
5. built-in `default`

Built-in names: `default`, `demo`.

## Top level

```yaml
version: 1                 # required
name: my-project           # shown in logs and approval requests
description: optional text
default: allow             # allow | deny | approve, used when no rule matches

approval:
  channel: tty             # tty | webhook | auto-deny | auto-approve
  timeout_seconds: 120     # no answer in time = deny
  webhook_url: https://... # required when channel is webhook

audit:
  enabled: true
  path: .blastgate/audit.jsonl   # relative to the working directory

exec:                      # only used by `blastgate exec`
  env_strip: ["*_TOKEN", "*_API_KEY"]   # globs of env var names removed before running
  timeout_seconds: 0       # 0 = none

rules: [...]
```

## Rules

```yaml
- id: unique-id            # letters, digits, - _ .
  description: optional
  action: deny             # allow | deny | approve
  match: { ... }           # every condition listed must hold (AND)
  limit: { ... }           # optional rate cap, see below
  message: optional text sent back to the agent when the rule blocks
```

### Precedence

All rules are evaluated. Then:

1. any matching `deny` rule: **deny**
2. else any matching `approve` rule: **approve** (pause for a human)
3. else any matching `allow` rule: **allow**
4. else the policy `default`

Rule order only affects which rule is reported first in logs. An `allow` rule can never override a `deny`.

## Actions

Every call is normalized to an action before matching:

| field | MCP proxy | `exec` / shell | Claude Code hook |
| --- | --- | --- | --- |
| `kind` | `mcp` | `shell` | `shell` for Bash, `fs` for Read/Write/Edit/Glob/Grep, `http` for WebFetch/WebSearch, `mcp` for `mcp__*` tools |
| `server` | `--name` value | | MCP server name |
| `tool` | tool name | first program in the command | tool name |
| `args` | tool arguments | | tool input |
| `command` | `args.command`, `args.cmd` or `args.script` if present | the full command line | the Bash command |

## Matchers

All glob matching is case-insensitive and anchored. `*` matches anything, `?` one character. Regexes are JavaScript regexes; start one with `(?i)` for case-insensitive.

| matcher | type | matches when |
| --- | --- | --- |
| `kind` | string or list | the action kind is one of these |
| `tool` | glob or list | the tool name matches |
| `server` | glob or list | the MCP server name matches |
| `command` | glob or list | the whole command, **or any single command inside it** (split on `;` `&&` `\|\|` `\|` `&`, newlines, `$(...)` and backticks, with `sudo`/`env`/`nohup` and `VAR=x` stripped) matches |
| `shell: destructive` | built-in | the command contains a destructive shell operation (see below) |
| `sql: destructive` | built-in | any string argument contains destructive SQL (see below) |
| `args` | map of `path: regex` | each named argument exists and matches. Paths are dotted: `options.branch`, `files.0.path` |
| `any_arg` | regex or list | any string anywhere in the arguments matches |
| `path_outside` | list of dirs | the action touches at least one path that is outside **all** of these |
| `path_inside` | list of paths | the action touches at least one path inside any of these |
| `domain_not_in` | glob list | the action contains at least one URL host not matching any glob |
| `domain_in` | glob list | the action contains a URL host matching a glob |

### Paths

Paths are collected from argument keys named `path`, `file`, `file_path`, `filename`, `dir`, `directory`, `target`, `destination`, `dest`, `src`, `source`, `cwd`, `output`, `root` (and plurals), and for shell commands from tokens that look like paths (`/x`, `./x`, `../x`, `~/x`, `.env`, `dir/file`). They are resolved against the working directory, `~` is expanded, and symlinks are resolved for the longest existing prefix, so `workspace/link-to-etc/passwd` counts as `/etc/passwd`.

If an action has no paths, path matchers do not match (the rule does not apply).

### Domains

Hosts are taken from every `http(s)://`, `ws(s)://` and `ftp://` URL in the arguments or command, plus scheme-less targets of `curl`, `wget`, `nc`, `ssh`, `scp`, `rsync` and similar. `api.github.com.evil.example` does not match `api.github.com`.

### `sql: destructive`

Statements are split on `;` after removing comments and string literals. Flags `DROP (TABLE|DATABASE|SCHEMA|INDEX|VIEW|USER|ROLE|FUNCTION|PROCEDURE|TRIGGER|SEQUENCE)`, `TRUNCATE`, `ALTER TABLE ... DROP`, `GRANT`, `REVOKE`, `DELETE FROM` without `WHERE`, `UPDATE ... SET` without `WHERE`, and `DELETE`/`UPDATE` whose `WHERE` is always true (`1=1`, `true`).

### `shell: destructive`

`rm` with recursive and force flags (any order or spelling), recursive `rm` of `/`, `~` or `*`, `mkfs*`, `dd of=/dev/*`, `shred`, `wipefs`, recursive `chmod`/`chown` on `/`, `git push --force|-f|--mirror|--delete`, `git reset --hard`, `git clean -f`, `find -delete`, `kubectl delete`, `helm delete`, `terraform destroy`, `terraform apply -auto-approve`, downloads piped into a shell, fork bombs, and redirects onto block devices.

## Limits

```yaml
- id: loop-guard
  action: deny
  match: { tool: "*" }
  limit: { max: 5, per_seconds: 60, same_args: true }
```

When a rule has `limit`, it only triggers once `max` matching calls have already been allowed within the sliding window. With `same_args: true` the count is per identical call (same kind, server, tool, arguments and command), which catches runaway retry loops without capping normal work. Denied calls are not counted. Windows live in memory per Blastgate process.

## Approval channels

| channel | behaviour |
| --- | --- |
| `tty` | prompts on the controlling terminal (`/dev/tty`), so it works even while stdin/stdout carry MCP traffic. No terminal = deny. |
| `webhook` | `POST`s a JSON request to `webhook_url` and waits for `{"approved": true}`. Any other answer, HTTP error or timeout = deny. |
| `auto-deny` | every approval is denied. Good for CI and headless agents. |
| `auto-approve` | every approval is granted, still logged. For testing policies only. |

`$BLASTGATE_APPROVAL` overrides the channel for one run.

Webhook request body:

```json
{
  "id": "uuid",
  "policy": "my-project",
  "rule": "approve-production",
  "reason": "server pg-prod",
  "message": null,
  "summary": "pg-prod/query {\"sql\":\"UPDATE ...\"}",
  "action": { "kind": "mcp", "server": "pg-prod", "tool": "query", "args": { "sql": "UPDATE ..." } },
  "requested_at": "2026-12-08T13:00:00.000Z"
}
```

Respond with `{"approved": true, "by": "alice", "note": "ok for the migration"}`.
