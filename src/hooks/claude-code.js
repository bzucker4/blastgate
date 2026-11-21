// Claude Code PreToolUse hook adapter.
//
// Claude Code pipes {tool_name, tool_input, cwd, ...} to the hook on stdin.
// We map it to a Blastgate action and answer with hookSpecificOutput:
//   deny    -> permissionDecision "deny"  (Claude sees the reason)
//   approve -> permissionDecision "ask"   (Claude Code's own approval prompt)
//   allow   -> no output, so Claude Code's normal permission rules still apply.
// In shadow mode every call gets no output (logged, never enforced).
// Any internal error denies (fail closed).

import { Gate, denialText } from '../gate.js';

const FS_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Glob', 'Grep', 'LS']);

export function toAction(payload) {
  const name = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};
  const cwd = payload.cwd ?? process.cwd();
  if (name === 'Bash') return { kind: 'shell', command: String(input.command ?? ''), cwd };
  if (FS_TOOLS.has(name)) return { kind: 'fs', tool: name, args: input, cwd };
  if (name === 'WebFetch' || name === 'WebSearch') return { kind: 'http', tool: name, args: input, url: input.url, cwd };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return { kind: 'mcp', server: mcp[1], tool: mcp[2], args: input, cwd };
  return { kind: 'mcp', server: 'claude-code', tool: name, args: input, cwd };
}

function respond(decision, reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } };
}

export async function runClaudeCodeHook({ policy, stdinText, gate }) {
  try {
    const payload = JSON.parse(stdinText || '{}');
    gate = gate ?? new Gate(policy, { cwd: payload.cwd ?? process.cwd() });
    const outcome = await gate.check(toAction(payload), { interactive: false, source: 'claude-code' });
    const r = outcome.result;
    if (outcome.shadow) return null;
    if (r.decision === 'deny') return respond('deny', denialText(outcome));
    if (r.decision === 'approve') return respond('ask', `[blastgate] rule "${r.rule}" requires approval: ${r.reason}`);
    return null;
  } catch (e) {
    return respond('deny', `[blastgate] hook error, failing closed: ${e.message}`);
  }
}
