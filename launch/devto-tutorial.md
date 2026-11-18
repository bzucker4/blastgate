---
title: How to stop runaway agent loops from draining your Anthropic API budget
published: false
tags: ai, mcp, security, devops
cover_image: https://raw.githubusercontent.com/bzucker4/blastgate/main/docs/demo.png
---

Your agent is not expensive because it thinks too hard. It is expensive because it gets stuck.

The pattern is always the same. A tool call fails or returns something unexpected. The agent retries. The retry fails the same way. Every retry carries the full conversation back to the model, so each loop iteration costs more tokens than the last. By the time you look, the agent has called the same tool with the same arguments a few hundred times.

This tutorial puts a hard, deterministic stop in front of that, in about five minutes, without changing your agent.

## What we are building

A small proxy between your agent and its MCP servers that:

1. Denies the 6th identical tool call within a minute (the loop)
2. Caps total tool calls per minute (the burst)
3. Tells the agent *why* it was stopped, so it changes approach instead of retrying
4. Logs every decision in a signed audit log so you can see exactly where the loop started

We will use [Blastgate](https://github.com/bzucker4/blastgate), an open-source policy firewall for MCP and CLI agents. It has zero dependencies and needs no account.

## Step 1: see it work

```bash
npx blastgate demo
```

The last four lines of the demo are a retry loop: three identical `SELECT count(*)` calls go through, the fourth is denied by `loop-guard`.

## Step 2: write the policy

In your project:

```bash
npx blastgate init
```

That writes `blastgate.yaml` with sensible defaults. The two rules that matter for cost:

```yaml
rules:
  - id: loop-guard
    description: The same call repeated more than 5 times a minute is a runaway loop.
    action: deny
    match:
      tool: "*"
    limit: { max: 5, per_seconds: 60, same_args: true }
    message: You have made this exact call 5 times in a minute. Stop retrying it. Explain the problem to the user or try a different approach.

  - id: rate-cap
    description: Hard ceiling on total calls.
    action: deny
    match:
      tool: "*"
    limit: { max: 120, per_seconds: 60 }
```

How the limits work:

- `same_args: true` counts calls that are **identical**: same server, tool and arguments. Normal work that varies its arguments is never capped by `loop-guard`.
- Without `same_args`, the window counts every matching call, which is what `rate-cap` does.
- Windows slide. Denied calls do not count, so the agent is not punished further for being blocked.
- `message` is sent back to the agent with the denial. This is the part that actually saves money: a clear instruction to stop retrying breaks the loop at the model level, not just the tool level.

Validate it:

```bash
npx blastgate lint
```

## Step 3: put it in front of your MCP servers

Prefix the server command with `npx -y blastgate mcp --name <name> --`. For Claude Code, in `.mcp.json`:

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

The same shape works in Cursor (`.cursor/mcp.json`) and Windsurf (`~/.codeium/windsurf/mcp_config.json`).

Everything except `tools/call` passes through untouched. When a call is denied, the agent gets a normal tool result:

```json
{
  "content": [{ "type": "text", "text": "[blastgate] Blocked by policy rule \"loop-guard\": 5 identical calls per 60s exceeded. You have made this exact call 5 times in a minute. Stop retrying it..." }],
  "isError": true
}
```

That matters. A protocol-level error makes many agents crash or retry harder. A tool result with a reason is something the model can read and act on.

## Step 4: cover built-in tools too (Claude Code)

Loops are not only MCP calls. A Bash command that keeps failing is the same problem. Add a `PreToolUse` hook in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "npx -y blastgate hook claude-code" }] }
    ]
  }
}
```

Note the hook runs as a new process per tool call, so rate windows do not carry across calls there; use the MCP proxy for loop limits and the hook for content rules like destructive commands and secret files.

## Step 5: find where the loop started

```bash
npx blastgate audit tail -n 30
npx blastgate audit verify
```

`tail` shows each decision with the rule that fired. `verify` checks the hash chain and Ed25519 signatures, so you know the log you are reading is the log that was written.

## Test your policy in CI

```bash
npx blastgate check '{"kind":"mcp","tool":"query","args":{"sql":"DROP TABLE users"}}'
echo $?   # 1 = deny, 2 = needs approval, 0 = allow
```

Put a handful of these in CI and policy changes get reviewed like code.

## While you are in there

The default policy also blocks destructive SQL, asks before `rm -rf` and force pushes (even hidden in `a && b`), keeps writes inside the project, and denies reads of `~/.ssh`, `~/.aws` and `.env`. Loops cost money; those cost weekends.

Repo, docs and threat model: https://github.com/bzucker4/blastgate
