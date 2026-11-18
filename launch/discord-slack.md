# Discord and Slack #showcase posts (Days 5 to 7, Dec 12 to 14)

Each post ends with a specific question. Communities answer questions; they ignore announcements.

## MCP community

Built a stdio proxy that puts a YAML policy in front of any MCP server: `npx blastgate mcp -- <server>`. Only `tools/call` is inspected; denials come back as `isError: true` tool results with the reason.

Question for people who know the spec better than me: for denied calls, is a tool result with `isError` the right shape, or would you rather see a JSON-RPC error? I went with the tool result because agents seem to recover better. Repo: https://github.com/bzucker4/blastgate

## Claude Code / Anthropic community

Made a PreToolUse hook + MCP wrapper that blocks destructive SQL, hidden `rm -rf`, secret file reads and runaway loops, with "approve" mapped to Claude Code's own permission prompt. Zero deps, `npx blastgate demo` to see it.

Question: do you run the hook on `*` or only on Bash/Write/Edit? Curious what the latency tolerance is for people. Repo: https://github.com/bzucker4/blastgate

## Cursor community

If you give Cursor agents MCP servers for your DB or filesystem: Blastgate wraps them with a policy (one line in `.cursor/mcp.json`). Blocks `DROP TABLE`, writes outside the project, calls to non-allowlisted domains.

Question: would a Cursor hooks adapter (for built-in terminal commands, not just MCP) be useful to you? It is the top roadmap item and I want to know if it is worth doing first. https://github.com/bzucker4/blastgate

## LangChain / agent framework communities

Library usage for custom loops:

```js
import { loadPolicy, Gate } from 'blastgate';
const gate = new Gate(loadPolicy());
const { allowed, result } = await gate.check({ kind: 'mcp', tool: call.name, args: call.input });
```

Question: would a Python package be worth it, or is a CLI you shell out to good enough for Python agents? https://github.com/bzucker4/blastgate

## Node / TypeScript communities

Wrote a zero-dependency agent firewall, including a strict YAML subset parser (no anchors, no block scalars, duplicate keys are errors) so policy files stay reviewable. About 1,700 lines.

Question: would you trust a hand-rolled YAML subset for a security config, or would you rather it accepted JSON only? Genuinely torn. https://github.com/bzucker4/blastgate
