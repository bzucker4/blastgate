# Integrations

## Any stdio MCP server

Put `npx -y blastgate mcp --name <name> --` in front of the server command. `--name` is what `server:` matchers and the audit log see.

```bash
npx -y blastgate mcp --name postgres -- npx -y @modelcontextprotocol/server-postgres postgresql://localhost/db
```

Use `--policy path/to/policy.yaml` to pick a policy explicitly. Decisions are printed to stderr (most clients show it in their MCP log); add `--quiet` to silence them.

## Claude Code

**Plugin (one step):** `/plugin install blastgate --marketplace bzucker4/blastgate` inside Claude Code, or `claude plugin install blastgate --marketplace bzucker4/blastgate` from a terminal. The plugin ships the same `PreToolUse` hook shown below, running `npx -y blastgate@0.2 hook claude-code`, so it picks up `./blastgate.yaml` when the project has one and the default policy otherwise. Add `--scope project` to commit it to the repo's `.claude/settings.json` for your whole team.

Two layers, use either or both:

**1. MCP servers** in `.mcp.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "blastgate", "mcp", "--name", "postgres", "--",
               "npx", "-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"]
    }
  }
}
```

**2. Built-in tools** with a `PreToolUse` hook in `.claude/settings.json` (project) or `~/.claude/settings.json` (all projects):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "npx -y blastgate hook claude-code" }]
      }
    ]
  }
}
```

What the hook returns:

- **deny**: Claude Code blocks the tool and shows Claude the reason, so it can choose another approach.
- **approve**: Claude Code shows its normal permission prompt with Blastgate's reason.
- **allow**: no output. Claude Code's own permission settings still apply; Blastgate never grants more than Claude Code would.

For speed, install globally (`npm i -g blastgate`) and use `"command": "blastgate hook claude-code"`.

Using both layers is fine. Each MCP call is then checked by the hook and again by the proxy. The audit log keeps both decisions, tied together by Claude Code's `tool_use_id`, and `blastgate audit tail` shows them as one line marked `via hook+proxy`.

## Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "blastgate", "mcp", "--name", "filesystem", "--",
               "npx", "-y", "@modelcontextprotocol/server-filesystem", "./"]
    }
  }
}
```

## Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "blastgate", "mcp", "--name", "github", "--",
               "npx", "-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your token>" }
    }
  }
}
```

## Claude Desktop and other GUI clients

Same `mcpServers` shape. GUI clients launch servers without a terminal, so a `tty` approval cannot be shown and is **denied**. For approvals there, use a webhook:

```yaml
approval:
  channel: webhook
  webhook_url: http://localhost:8787/approve
  timeout_seconds: 300
```

## Shell scripts and CI

```bash
blastgate exec -- terraform apply            # check, then run
blastgate exec -- "make clean && make all"   # one quoted string runs through $SHELL -c
BLASTGATE_APPROVAL=auto-deny blastgate exec -- ./deploy.sh   # CI: anything needing approval fails
```

Exit codes: the command's own code when it runs, `126` when blocked, `127` when it cannot start.

## Policy tests in CI

```bash
blastgate lint blastgate.yaml
blastgate check --json '{"kind":"shell","command":"git push --force"}'   # exits 2 (approve)
```

## Your own agent loop

```js
import { loadPolicy, Gate } from 'blastgate';

const gate = new Gate(loadPolicy());
for (const call of toolCalls) {
  const outcome = await gate.check({ kind: 'mcp', server: 'internal', tool: call.name, args: call.input });
  if (!outcome.allowed) { reply(call.id, `Blocked: ${outcome.result.reason}`); continue; }
  reply(call.id, await run(call));
}
```
