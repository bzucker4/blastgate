# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a bypass. Use GitHub's private vulnerability reporting: **Security > Report a vulnerability** on this repository.

Include the policy, the action (JSON is ideal, see `blastgate check`), what you expected, and what happened. You will get an answer within 72 hours.

## What counts

- A destructive action that a built-in detector should catch but does not
- A path, domain or command matcher that can be evaded
- Any case where Blastgate allows when it should fail closed
- Audit log forgery or undetected tampering beyond the documented tail-truncation limit
- Crashes in the proxy triggered by crafted MCP messages

See [docs/threat-model.md](docs/threat-model.md) for what is out of scope by design.

## Supported versions

The latest minor release gets security fixes.
