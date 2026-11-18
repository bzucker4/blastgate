# Newsletter pitches (week of Dec 15)

Send after the launch thread has comments you can point to. Attach `docs/demo.png` or the GIF. Find each newsletter's current submission form or curator address on their site; do not guess emails.

## TLDR (tech / AI editions)

**Subject:** Blastgate: deterministic firewall for AI agent tool calls

Blastgate is an open-source proxy that checks every MCP and shell call an AI agent makes against a YAML policy before it runs, blocking things like `DROP TABLE`, hidden `rm -rf` and runaway retry loops. Risky calls pause for human approval, and every decision lands in a signed, tamper-evident log. Zero dependencies; `npx blastgate demo` shows it working with no API key: https://github.com/bzucker4/blastgate

## Console.dev

**Subject:** Tool submission: Blastgate (MCP / agent policy firewall)

Blastgate is a zero-dependency CLI that wraps any stdio MCP server, plus a Claude Code PreToolUse hook, with a deterministic YAML policy engine. It is aimed at developers running coding agents in the background who want argument-level rules (destructive SQL, path jails with symlink resolution, egress allowlists) and a verifiable audit trail. AGPL-3.0, Node 18+, try it with `npx blastgate demo`: https://github.com/bzucker4/blastgate

## ByteByteGo

**Subject:** Architecture story: putting a policy gate in an agent's tool-call path

I built a stdio proxy that intercepts MCP `tools/call` requests, evaluates them with a fixed-precedence rule engine, and writes a hash-chained, Ed25519-signed decision log, adding about 0.7 ms per call. The interesting design choices are returning denials as tool results so agents self-correct, and keeping the engine deterministic with no model in the loop. Repo and threat model: https://github.com/bzucker4/blastgate

## Pointer.io

**Subject:** Blastgate: bounding the blast radius of autonomous agents

Engineering teams moving agents from chat to background jobs need a way to bound what those agents can break. Blastgate is an open-source policy firewall that sits in the tool-call path, asks a human before risky actions, and keeps a verifiable record of every decision. Write-up and code: https://github.com/bzucker4/blastgate
