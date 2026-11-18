# Blastgate launch kit

Everything you need to run the launch from your plan, with dates filled in. Days and times are flexible: shift the whole calendar by the same number of days and nothing breaks.

**Proposed Day 1: Tuesday, December 8, 2026.** That gives a full 14-day pre-launch window starting Tuesday, November 24, keeps launch week clear of Thanksgiving, and lands on a Tuesday for Hacker News.

## Placeholders to fill before launch

Both are filled in now:

| Placeholder | Where | What to put |
| --- | --- | --- |
| (done) | README.md, COMMERCIAL.md, .github/FUNDING.yml | Polar checkout: Blastgate Commercial License, $299/year, Threshold Labs org |
| (done) | COMMERCIAL.md | Licensing email set to atlascreative95@gmail.com |


## Status (updated Nov 18)

Done: repo public, CI green, npm 0.1.0 live, 11 issues seeded, Polar checkout ($299/yr) with agreement link, Sponsors tiers live, demo MP4/GIF recorded, Claude Code configs tested, X thread scheduled for Dec 8 9:00 AM ET (3 posts + video), Dev.to draft saved (unpublished, AI-assisted label, 4 tags), directory branches pushed (`add-blastgate` on bzucker4/awesome-mcp-servers and bzucker4/awesome-ai-agents, PRs not opened yet).

Left: publish the Dev.to draft Dec 11, Bluesky thread (no native scheduling, post by hand Dec 8), open the two directory PRs Dec 10, Glama/Smithery/PulseMCP forms Dec 10.

## Phase 1: pre-launch (Nov 24 to Dec 7)

| Date | Task | Done when |
| --- | --- | --- |
| Tue Nov 24 | Create public repo `bzucker4/blastgate`, push `main` | Repo is live, CI badge green |
| Tue Nov 24 | Enable private vulnerability reporting (Settings > Security) | SECURITY.md link works |
| Wed Nov 25 | Reserve the npm name: `npm publish` v0.1.0 (or tag `v0.1.0` once `NPM_TOKEN` secret is set and let the Release workflow do it) | `npx blastgate demo` works on a clean machine |
| Fri Nov 27 | GitHub Sponsors: create tiers (copy in `sponsorships.md`) | Sponsor button visible on repo |
| Sat Nov 28 | Polar.sh: create "Blastgate Commercial License" product, paste URL into placeholders | README "Buy a commercial license" link resolves |
| Mon Nov 30 | Record the real terminal demo: `vhs docs/demo.tape` makes `docs/demo.gif` and `docs/demo.mp4` (the README already ships an animated `docs/demo.svg`) | MP4 under 20 seconds for social posts |
| Tue Dec 1 | `bash scripts/seed-issues.sh` | 11 issues labeled `roadmap` / `good first issue` |
| Wed Dec 2 | Test the copy-paste configs yourself in Claude Code and Cursor against a real MCP server | Screenshot of a real block in each client |
| Thu Dec 3 | Pre-write and schedule the X and Bluesky threads (`x-bluesky-thread.md`) | Scheduled for Dec 8, 9:00 AM ET |
| Fri Dec 4 | Draft the Dev.to post as unpublished (`devto-tutorial.md`) | Draft saved, scheduled for Dec 11 |
| Sat Dec 5 | Fork and prep directory PR branches (`directories.md`) | Branches ready, not opened |
| Mon Dec 7 | Final pass: fresh clone, `npm test`, `npx blastgate@latest demo`, read the README top to bottom on mobile | No placeholder text left |

## Phase 2: launch week (Dec 8 to Dec 14)

| Date and time (ET) | Channel | File |
| --- | --- | --- |
| Tue Dec 8, 8:00 AM | Show HN post, then immediately the first comment | `show-hn.md` |
| Tue Dec 8, 9:00 AM | X and Bluesky threads (native video first, link in reply) | `x-bluesky-thread.md` |
| Tue Dec 8, all day | Answer every HN comment. Technical, specific, no defensiveness | |
| Wed Dec 9 | Reddit: r/LocalLLaMA first, r/ExperiencedDevs a few hours later | `reddit.md` |
| Thu Dec 10 | Open the directory PRs and submissions | `directories.md` |
| Fri Dec 11 | Publish the Dev.to tutorial, cross-post to Hashnode | `devto-tutorial.md` |
| Sat Dec 12 to Mon Dec 14 | Discord and Slack `#showcase` posts | `discord-slack.md` |

Rule for the 48-hour window: every channel links to the **repo**, not a landing page. Stars are the signal Trending uses.

## Phase 3: conversion (Dec 15 to Jan 7)

| When | Task | File |
| --- | --- | --- |
| Daily | Respond to every issue and PR within 2 hours of seeing it | |
| By Tue Dec 22 | Ship v0.2.0 with the top 2 or 3 requests from launch threads. Tag the people who asked | changelog in `CHANGELOG.md` |
| After 300+ stars | README sponsor slot outreach | `sponsorships.md` |
| Week of Dec 15 | Newsletter pitches | `newsletters.md` |
| Ongoing | `blastgate license` and COMMERCIAL.md already explain when a license is needed | |

## Likely v0.2.0 candidates

Pick from what people actually ask for, but these are already scoped as issues: Streamable HTTP transport, `blastgate test` policy test files, Cursor hooks adapter, JSON Schema for editor autocomplete.
