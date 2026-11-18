# Threat model and limits

Blastgate is honest about what it is: a deterministic **policy gate** at the tool-call boundary. Read this before you rely on it.

## What it protects against

- **Agent mistakes.** A model that decides to "clean up" with `DROP TABLE`, `rm -rf`, or a force push.
- **Runaway loops.** The same call retried forever, or a burst of calls that burns budget.
- **Prompt injection that reaches a tool call.** Injected instructions still have to become a tool call to do damage, and that call is checked like any other.
- **Silent damage.** Every decision is in a signed, hash-chained log you can verify later.

## What it does not protect against

- **Code that runs after an allowed call.** If you allow `npm install` or `python script.py`, whatever that program does next is out of Blastgate's view. Use a container, VM, or OS sandbox for untrusted code; Blastgate decides *whether* to start it.
- **Obfuscated shell.** Detection is string-level: it handles chains, substitutions, wrappers and quoting, but not `eval "$(echo cm0gLXJmIC8= | base64 -d)"`. For high-stakes hosts, prefer allowlists (`default: deny` plus explicit `allow` rules) over blocklists.
- **An MCP server that lies.** Blastgate checks the call the agent makes, not what the server does with it. A `read_file` tool that actually deletes is a server bug.
- **Calls that bypass the gate.** Tools not routed through `blastgate mcp`, `blastgate exec` or the hook are not checked.
- **An attacker with write access to the machine.** They can edit the policy or remove the proxy. The audit log still helps: see below.

## Audit log guarantees

- Each entry includes the SHA-256 of the previous entry and is signed with an Ed25519 key.
- `blastgate audit verify` detects edited, inserted, deleted and reordered lines, and lines signed by a different key.
- Deleting entries **from the end** is not detectable from the file alone. Anchor `blastgate audit head` output somewhere the agent cannot write (a CI artifact, a ticket, a different machine) to close that gap.
- Verify with a public key you trust. The private key lives in `~/.blastgate/keys/` (mode 0600); someone who can read it can forge entries. Copy `ed25519.pub.pem` off the machine and verify with `--pubkey`.

## Fail-closed behaviour

| situation | result |
| --- | --- |
| policy file missing (explicit `--policy`) or invalid | refuse to start (hook: deny) |
| approval needed, no terminal | deny |
| approval webhook down, non-2xx, bad JSON, timeout | deny |
| approval timeout | deny |
| internal error while deciding | deny |
| upstream MCP server crashes | proxy exits with its code |

## Reporting a bypass

See [SECURITY.md](../SECURITY.md). Detector gaps are treated as security bugs.
