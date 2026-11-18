# Show HN

## Title (pick one, all under 80 characters total)

1. `Show HN: Blastgate - a deterministic firewall for MCP and CLI agent tool calls`
2. `Show HN: Blastgate - block DROP TABLE and rm -rf before your agent runs them`
3. `Show HN: Blastgate - YAML policy gate and signed audit log for AI agents`

Recommended: **1**. It names the mechanism, not a promise.

**URL:** `https://github.com/bzucker4/blastgate`

## First comment (post immediately)

Hi HN. I built Blastgate because I wanted to leave coding agents running in the background without wondering what they were doing to my database.

It is a small proxy that sits between an agent and its tools. Every MCP `tools/call` (or shell command, or Claude Code tool use) is checked against a YAML policy before it runs. The answer is allow, deny, or "ask a human", and every decision goes into a hash-chained, Ed25519-signed log.

Try it with no setup: `npx blastgate demo`. It runs a scripted runaway agent against a mock Postgres MCP server through the real proxy, then verifies the audit log and shows tampering being detected.

Some design decisions I would like feedback on:

- **No model in the decision path.** I looked at "LLM as judge" guardrails and did not want a probabilistic check between an agent and `DROP TABLE`. Everything is pattern matching and path resolution, so the same call and the same policy always give the same answer.
- **Fixed precedence.** Any deny wins, then approve, then allow, then the default. Rule order does not matter, which makes policies much easier to review.
- **Denials go back as tool results, not protocol errors.** The agent sees `isError: true` with the rule and reason, so it usually picks a safer approach instead of crashing or retrying blindly.
- **Fail closed everywhere.** No terminal for an approval, webhook down, timeout, invalid policy: all deny.
- **Zero dependencies**, including a deliberately limited YAML parser (no anchors, no block scalars). About 1,700 lines in `src/`.

What it is not: a kernel sandbox. If you allow `npm install`, whatever the install script does is out of view. The detectors are string level, so `eval $(base64 -d ...)` gets past a blocklist; for that you want `default: deny` and explicit allows. I wrote up the limits in docs/threat-model.md.

Numbers on my machine: about 10 microseconds p50 to evaluate a call, about 0.7 ms p50 added per MCP round trip, most of which is the synchronous signed audit write.

It is AGPL-3.0 with a commercial license for people embedding it in closed products. Happy to answer anything, and I would especially love bypasses: they become test cases.

## Prepared answers for likely questions

**"Why not just use Docker / a VM?"**
Use both. The container limits what can happen; Blastgate decides what should happen and leaves a record. A container does not stop an agent from dropping your production table over a database connection it was legitimately given.

**"Claude Code already has permission prompts."**
It does, and the hook integration uses them: an "approve" decision becomes Claude Code's native prompt. Blastgate adds argument-level rules (SQL inside an MCP call, paths after `..` and symlink resolution, URLs), headless approvals over a webhook, loop and rate caps, a signed audit log, and the same policy across Claude Code, Cursor, Windsurf and scripts.

**"Regex can be bypassed."**
Yes. That is why the README pushes allowlists for high-stakes setups and why the threat model lists the gaps. Shell detection handles chains, substitutions, quoting, and wrappers like `sudo` and `env`, but not arbitrary obfuscation.

**"Why AGPL?"**
So the core stays open and companies that build it into hosted products either share changes or buy a license. Local use, CI, and internal use are free.

**"Why not OPA / Rego?"**
OPA is great and much more general. I wanted something an individual developer can read and edit in two minutes, with MCP and shell semantics built in (destructive SQL, path jails, chained commands) and no extra runtime.
