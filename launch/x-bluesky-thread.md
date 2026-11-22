# X and Bluesky thread

**Post 3 changed on Nov 22 (shadow mode, Claude Code plugin).** The X thread was already scheduled with the old text: open the scheduled post on X and replace post 3 with the version below.

Attach `docs/demo.mp4` (record with `vhs docs/demo.tape`) natively to post 1. Put the GitHub link in the last post, not the first, so the video post is not downranked.

## X

**1/3** (with video)
I gave a runaway agent a database, a filesystem and a shell.

Blastgate stopped DROP TABLE, a jail escape, a key exfil, a hidden rm -rf and a retry loop before any of them reached the server. Then it proved its own log was not tampered with.

**2/3** (with code image or text)
The whole policy is YAML. No model in the loop, same answer every time:

```yaml
- id: no-destructive-sql
  action: deny
  match: { sql: destructive }
- id: loop-guard
  action: deny
  match: { tool: "*" }
  limit: { max: 5, per_seconds: 60, same_args: true }
```

Wrap any MCP server with one line: `npx blastgate mcp -- <server>`

**3/3**
Zero dependencies. Claude Code plugin in one line, plus Cursor and Windsurf.

Not sure about the rules yet? --shadow logs what it would block and blocks nothing.

Try it with no API key: `npx blastgate demo`

github.com/bzucker4/blastgate

## Bluesky (300 character limit per post)

**1/3** (with video)
I gave a runaway agent a database, a filesystem and a shell. Blastgate blocked DROP TABLE, a jail escape, a key exfil, a hidden rm -rf and a retry loop before they reached the server, then verified its own signed audit log.

**2/3**
Policies are plain YAML with fixed precedence: deny beats approve beats allow. No LLM judge. Denials go back to the agent as normal tool results so it adapts instead of crashing.

One line to wrap any MCP server: npx blastgate mcp -- <server>

**3/3**
Zero deps, Node 18+. Claude Code plugin, Cursor, Windsurf. Try a policy safely first: --shadow logs what it would block and blocks nothing. No API key needed: npx blastgate demo

github.com/bzucker4/blastgate
