# Reddit

Read each subreddit's self-promotion rules on the day. Post as a text post with the repo as a reference, never a bare link. Reply to every comment for the first few hours.

## r/LocalLLaMA

**Title:** I wrote a deterministic policy gate for MCP tool calls. Here is what I learned about stopping agents from wrecking things

**Body:**

I run agents against local models and real tools (Postgres, filesystem, shell), and the scariest failures were never the model being wrong in chat. They were tool calls: a "cleanup" that became `DROP TABLE`, a write that resolved to a path outside the project through a symlink, and a retry loop that hit the same endpoint hundreds of times.

So I built a small stdio proxy that checks every `tools/call` against a YAML policy before forwarding it. A few things that turned out to matter:

1. **Check the arguments, not the tool name.** `query_db` is fine; `query_db` with `DELETE FROM orders` and no `WHERE` is not. The SQL check strips string literals and comments first, so `INSERT ... VALUES ('please drop table users')` does not trip it.
2. **Shell commands hide inside other commands.** `git status && rm -rf ~/projects`, `echo $(rm -rf x)`, `sudo env FOO=1 rm -rf`. You have to split on `&&`, `;`, pipes and substitutions and strip wrappers before matching.
3. **Resolve paths for real.** `workspace/../../etc/passwd` and `workspace/link-to-etc/passwd` both need to count as `/etc`. That means `path.resolve` plus `realpath` on the longest existing prefix.
4. **Return denials as tool results.** If you return a JSON-RPC error, a lot of agents crash or retry. A normal result with `isError: true` and a reason ("rule no-destructive-sql: DELETE without WHERE") usually makes the model rewrite the call.
5. **Loop guard by identical arguments.** Counting identical calls per minute catches runaway loops without capping normal work.
6. **Roll it out in shadow mode.** Nobody trusts a new gate on day one. Shadow mode evaluates and logs every call but blocks nothing, so you can run it for a day and read what it would have stopped before enforcing.

No model is involved in the decision, which was the point: I did not want a probabilistic judge between an agent and my database.

It is open source (AGPL, zero dependencies). `npx blastgate demo` runs the whole thing against a mock server with no keys: https://github.com/bzucker4/blastgate

Happy to hear about bypasses. Each one becomes a test.

## r/ExperiencedDevs

**Title:** How are you bounding blast radius for background coding agents?

**Body:**

Genuine question first, tool second. As agents move from chat to background jobs that run shell commands and hit real services, what is your team doing about limits and audit?

What I ended up doing, for discussion:

- A policy file reviewed like code (YAML, fixed precedence: deny > approve > allow > default, so rule order never changes the outcome)
- A proxy in the tool-call path so the same rules apply in Claude Code, Cursor and scripts
- Human approval for a short list of side effects (prod, deploys, payments, force pushes) with timeout meaning deny
- A hash-chained, signed log of every decision so "what did the agent do last night" has an answer you can verify
- Roll-out in shadow mode: new rules run for a few days logging only (`decision: deny`, `final: allow`) before they enforce, the same way you would canary a WAF rule

The trade-off I keep going back and forth on: blocklists (catch `rm -rf`, destructive SQL) are friendly but bypassable; allowlists (`default: deny`) are safe but annoying. Right now I use blocklists locally and allowlists for anything touching prod.

I open-sourced my implementation if anyone wants to poke holes in it: https://github.com/bzucker4/blastgate. More interested in how others are handling it.

## r/programming

**Title:** Detecting destructive shell commands hidden in chains, substitutions and wrappers (notes from building an agent firewall)

Link post to the Dev.to article once it is live (Dec 11), or a text post using points 2 and 3 from the r/LocalLLaMA post with the repo as the reference implementation.
