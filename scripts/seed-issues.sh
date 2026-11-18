#!/usr/bin/env bash
# Creates the launch-day roadmap and good-first-issue tickets.
# Run once from the repo root after `gh auth login`:  bash scripts/seed-issues.sh
set -euo pipefail

gh label create roadmap --color 5319e7 --description "Planned work" 2>/dev/null || true
gh label create "good first issue" --color 7057ff 2>/dev/null || true
gh label create detector --color d93f0b --description "Built-in detector patterns" 2>/dev/null || true

issue() { gh issue create --title "$1" --label "$2" --body "$3"; }

issue "Streamable HTTP transport for the MCP proxy" "roadmap" \
"The proxy speaks stdio today. Remote MCP servers use Streamable HTTP. Add \`blastgate mcp --http <url>\` that exposes a local stdio server and forwards to the remote endpoint, inspecting \`tools/call\` the same way."

issue "Cursor hooks adapter (blastgate hook cursor)" "roadmap" \
"Mirror \`hook claude-code\` for Cursor's shell/MCP hooks so built-in Cursor tools are covered, not just wrapped MCP servers."

issue "blastgate test: policy test files" "roadmap" \
"A YAML file of actions + expected decisions, run with \`blastgate test cases.yaml\`. Exit non-zero on any mismatch. Lets teams review policy changes in PRs like code."

issue "Spend caps from token usage" "roadmap" \
"Rate caps count calls. Add an optional spend cap that reads cost from a tool result or a sidecar counter, so a runaway loop stops at a dollar amount."

issue "JSON Schema for blastgate.yaml" "roadmap" \
"Publish a schema so VS Code / Cursor give autocomplete and inline errors via the YAML extension."

issue "Hide always-denied tools from tools/list" "roadmap" \
"If a rule denies a tool unconditionally (tool glob only, no other matchers), optionally filter it out of \`tools/list\` so the agent never tries."

issue "Detector: aws s3 rm --recursive and aws s3 rb --force" "good first issue,detector" \
"Add to \`destructiveShell\` in src/match.js with tests in test/detectors.test.js, including a safe look-alike (\`aws s3 ls --recursive\`)."

issue "Detector: gcloud / az delete commands" "good first issue,detector" \
"\`gcloud ... delete\`, \`az group delete\`, \`az vm delete\`. Same pattern as the kubectl rule."

issue "Detector: MongoDB and Redis destructive commands" "good first issue,detector" \
"\`db.dropDatabase()\`, \`db.collection.drop()\`, \`deleteMany({})\`, \`FLUSHALL\`, \`FLUSHDB\`. Probably a new \`nosql: destructive\` matcher."

issue "blastgate audit export --csv" "good first issue" \
"Export decisions to CSV (ts, final, rule, kind, server, tool, command) for spreadsheets and auditors."

issue "Example policies: GitHub, Postgres, filesystem MCP servers" "good first issue" \
"Add \`examples/policies/*.yaml\` with tuned rules for the most common MCP servers, each with a \`blastgate check\` snippet in the comments."

echo "done"
