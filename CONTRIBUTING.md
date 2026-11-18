# Contributing

Thanks for helping make agents safer to run.

## Ground rules

- **Zero runtime dependencies.** PRs that add one will be declined; the engine must stay auditable.
- **Deterministic.** No network, clocks (except rate-limit windows), randomness or models in the decision path.
- **Fail closed.** If in doubt, deny.
- **Tests first for detectors.** Every new detector pattern needs a test that would fail without it, plus at least one safe look-alike that must not be flagged.

## Setup

```bash
git clone https://github.com/bzucker4/blastgate && cd blastgate
npm test          # node:test, no install step
npm run demo
npm run bench
```

## CLA

Blastgate is dual-licensed (AGPL-3.0 and commercial), so every contributor signs the [CLA](CLA.md). The CLA bot comments on your first PR; reply with the phrase it gives you. You only sign once.

## Good first issues

Look for the [`good first issue`](https://github.com/bzucker4/blastgate/labels/good%20first%20issue) label. New destructive-command detectors for cloud CLIs are a great place to start.
