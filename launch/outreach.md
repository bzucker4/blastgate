# Pre-launch outreach (Nov 24 to Dec 7)

Two habits for the two weeks before Show HN. Both are slow on purpose: a handful of genuinely useful replies does more than any volume, and anything that looks like spam will be held against the HN post.

## 1. Answer people who already have the problem

**Where to look (15 minutes a day):**
- X and Bluesky search: `agent deleted database`, `claude code rm -rf`, `cursor deleted my files`, `mcp security`, `agent drop table`, `prompt injection mcp`
- Hacker News search (hn.algolia.com), past month: `agent deleted`, `mcp security`, `claude code hooks`
- Reddit: r/ClaudeAI, r/cursor, r/LocalLLaMA, r/ExperiencedDevs threads about agents breaking things
- GitHub issues on agent tools asking for "block dangerous commands" or "confirm before rm"

**How to reply:**
1. Answer the actual question first, in a few sentences, as if Blastgate did not exist (container, allowlist, read-only DB user, hooks).
2. Mention Blastgate only if it directly fixes what they described, in one sentence, with the exact config line for their tool.
3. Disclose: "I built this" every time.
4. Never paste the same reply twice. Never reply to threads older than a month or that already have an accepted answer.

**Template (adapt every time, do not paste as is):**
> That's the scary part of agents: the model was fine, the tool call wasn't. A read-only DB role is the cheapest fix. If you want it at the tool-call level, I built an open-source gate for exactly this (Blastgate): it blocks `DROP`/`DELETE` without `WHERE` before the MCP call reaches the server. For Claude Code it's `/plugin install blastgate --marketplace bzucker4/blastgate`, and `BLASTGATE_MODE=shadow` lets you see what it would block without blocking anything.

Goal: 2 to 3 good replies a day, about 25 to 35 by launch.

## 2. Offer ready-made policies to MCP server authors

A line in a popular MCP server's README ("to guard this server, use this Blastgate policy") puts the tool in front of exactly the right people, and it helps their users.

**Pick 5 servers** that are actively maintained (commit in the last month), widely used, and can do damage: a Postgres or SQL server, a filesystem server, a shell or terminal server, a GitHub server, a cloud or Kubernetes server.

**For each one:**
1. Write a policy for it in `examples/policies/<server>.yaml`, with rules that match that server's real tool names and arguments. Test it with `blastgate check` and against the real server.
2. Open an **issue first**, not a PR: "Would you be open to a short 'Running with a policy gate' section in the README?" Link the example policy. Many maintainers prefer to be asked.
3. If they say yes, send a PR with 5 to 10 lines of docs. If they say no or don't answer within a week, move on, and list the policy in Blastgate's own README instead.

**Issue template:**
> Hi, thanks for building <server>. I maintain Blastgate, an open-source policy gate for MCP tool calls. I wrote a policy for <server> that blocks <the 2 or 3 most dangerous calls with this server> and asks before <risky but legitimate ones>: <link to example policy>. Would a short "Running with a policy gate" note in your README be welcome? Happy to send the PR, or to leave it here if it isn't a fit.

## 3. Lobsters

A small, technical, security-minded audience. It's invite-only: you need an existing member to invite you, and self-promotion is fine only from active members. If you don't have an account by Dec 8, skip it rather than ask strangers for an invite.
