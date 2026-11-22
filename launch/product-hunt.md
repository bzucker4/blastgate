# Product Hunt (second wave)

**Proposed date: Tuesday, December 15, 2026**, one week after Show HN. Product Hunt launches go live at 00:00 Pacific (3:00 AM ET), so be up to reply to comments from about 7:00 AM ET. Hacker News stays the main launch; Product Hunt reaches a different, less technical audience (team leads, founders), so lead with the outcome, not the mechanism.

Link the **GitHub repo** (https://github.com/bzucker4/blastgate) as the product URL, so votes turn into stars.

## Fields

**Name:** Blastgate

**Tagline** (Product Hunt shows about 60 characters):
`A firewall for your AI agent's tool calls` (41)

Alternatives:
- `Stop AI agents from running DROP TABLE and rm -rf` (49)
- `Rules and a signed audit log for every AI agent action` (54)

**Description** (keep under 260 characters):
Blastgate checks every tool call your AI agent makes (MCP, shell, Claude Code) against a YAML policy before it runs. Destructive SQL, secret reads and exfil are blocked, risky calls wait for a human, and every decision is signed into an audit log.

(247 characters)

**Pricing:** Free options (open source under AGPL-3.0; $299/year commercial license for closed products)

**Open source:** yes

**Suggested topics:** Developer Tools, Artificial Intelligence, Security (pick the matching IDs in the editor)

## Gallery (3 to 5 images, 1270 x 760)

1. The demo GIF (`docs/demo.gif`) or a still of its final screen: blocked calls plus "audit log verified".
2. A Claude Code session where Claude tries `cat ~/.aws/credentials` and the hook blocks it with the rule name. Take it from a real session (the README test steps reproduce it).
3. `blastgate audit tail` output showing ALLOW / DENY / `via hook+proxy` / `(shadow: would approve)` lines.
4. The default policy YAML (six or seven rules visible), titled "The whole policy is YAML".
5. Optional: a simple diagram, Agent -> Blastgate -> MCP server / shell, with "allow / deny / ask a human".

## Maker's first comment

Hi Product Hunt! I'm Brian, and I built Blastgate after one too many moments of watching a coding agent run commands against my real database and hoping for the best.

Blastgate sits between an AI agent and its tools. Before any tool call runs (an MCP call, a shell command, a file write in Claude Code) it is checked against a short YAML policy. The answer is allow, deny, or ask a human, and every decision goes into a signed, tamper-evident log.

Out of the box it stops:
- `DROP TABLE`, `TRUNCATE` and `DELETE` without `WHERE`
- `rm -rf`, force pushes and `curl | sh`, even hidden inside `a && b`
- reads of `~/.ssh`, `~/.aws` and `.env`
- uploads to webhook and tunnel services
- runaway retry loops

Two things I care about:
- **No AI in the decision.** It's plain rules, so the same call always gets the same answer.
- **Shadow mode.** Run it for a day blocking nothing, read what it *would* have stopped, then turn it on. You can adopt it without breaking anyone's workflow.

Try it in 10 seconds with no API key: `npx blastgate demo`. For Claude Code it's one line: `/plugin install blastgate --marketplace bzucker4/blastgate`.

It's free and open source. Companies building it into closed products can buy a commercial license. I'd love your feedback, and especially any way you find to get past it: every bypass becomes a test.

## Launch-day checklist

- [ ] Draft created and previewed (Claude can create it through the Product Hunt connector once it is signed in)
- [ ] Gallery images uploaded, thumbnail set (there is no logo yet: make a simple 240 x 240 mark, or crop the first frame of `docs/demo.png`)
- [ ] Launch date set to Dec 15, then submitted
- [ ] Tell people who starred during HN week, in a reply on your own HN/X posts, not by DM
- [ ] Reply to every comment within the hour, all day
