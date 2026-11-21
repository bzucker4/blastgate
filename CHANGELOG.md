# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-20

### Added

- Shadow mode: `mode: shadow` in the policy, `--shadow`, or `BLASTGATE_MODE=shadow`. Every decision is logged with what would have happened, nothing is blocked and no approval is requested. Errors still fail closed. `audit tail` marks shadow decisions.

## [0.1.0] - 2026-11-18

First public release.

### Added

- Deterministic policy engine with fixed precedence (deny > approve > allow > default)
- Strict, dependency-free YAML subset parser and policy validator
- Matchers: `kind`, `tool`, `server`, `command`, `args`, `any_arg`, `path_outside`, `path_inside`, `domain_not_in`, `domain_in`
- Built-in detectors: `sql: destructive`, `shell: destructive`
- Sliding-window rate limits and identical-call loop guard
- `blastgate mcp`: transparent stdio MCP proxy
- `blastgate exec`: shell guard with env scrubbing, timeout and exit-code passthrough
- `blastgate hook claude-code`: PreToolUse hook (deny / ask / pass)
- Approval channels: tty, webhook, auto-deny, auto-approve (all fail closed)
- Hash-chained, Ed25519-signed JSONL audit log with `audit verify|tail|head|key`
- `blastgate demo`: zero-config demo against a mock Postgres MCP server
- `blastgate check`, `lint`, `init`, `license`
- Built-in `default` and `demo` policies
