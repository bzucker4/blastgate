# MCP and agent directories (Day 3, Thu Dec 10)

Check each directory's current contribution guide on the day; formats change. These are the texts to paste.

## One-line description (reuse everywhere)

> Blastgate: deterministic policy firewall and approval gate for MCP servers and CLI agents. YAML rules, human approvals, signed audit log, zero dependencies.

## awesome-mcp-servers (PR)

Look for a security, gateway or proxy category. Entry:

```markdown
- [bzucker4/blastgate](https://github.com/bzucker4/blastgate) 📇 🏠 - Policy firewall that wraps any stdio MCP server. Blocks destructive SQL, rm -rf, path escapes and exfil domains via YAML rules, pauses risky calls for human approval, and writes a signed, hash-chained audit log.
```

(Adjust the emoji legend to the list's current convention: TypeScript/JavaScript and local service are the usual ones.)

**PR title:** Add Blastgate (policy firewall / approval gate for MCP servers)

**PR body:**
Adds Blastgate, an open-source stdio proxy that checks every `tools/call` against a YAML policy before it reaches the server. Zero dependencies, AGPL-3.0, `npx blastgate demo` runs without keys. Happy to move it to a different category if there is a better fit.

## awesome-ai-agents (PR)

Category: security / guardrails / infrastructure.

```markdown
- [Blastgate](https://github.com/bzucker4/blastgate) - Deterministic policy firewall for agent tool calls (MCP, shell, Claude Code hooks) with human-in-the-loop approvals and a signed audit log.
```

## Glama, Smithery, PulseMCP (submission forms)

- **Name:** Blastgate
- **Repo:** https://github.com/bzucker4/blastgate
- **npm:** blastgate
- **Install:** `npx -y blastgate mcp --name <name> -- <your server command>`
- **Category:** Security
- **Description (long):** Blastgate sits between an MCP client and any stdio MCP server. Every tool call is evaluated against a YAML policy with fixed precedence (deny, then approve, then allow). Built-in detectors catch destructive SQL and destructive shell commands, including ones hidden in chained commands. Path rules resolve `..` and symlinks; egress rules check every URL in the arguments. Risky calls pause for approval in the terminal or via webhook, and every decision is written to a hash-chained, Ed25519-signed audit log. Denials are returned as normal tool results so agents adapt instead of crashing.
- **Note for reviewers:** Blastgate is a proxy, not a tool server. It exposes exactly the tools of the server it wraps. The included mock server (`examples/mock-postgres-server.js`) can be used to try it.
