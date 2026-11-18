// Gate = engine + approval + audit. Every integration (MCP proxy, exec,
// Claude Code hook) goes through here so behaviour is identical everywhere.

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Engine, normalizeAction } from './engine.js';
import { AuditLog } from './audit.js';
import { requestApproval } from './approval.js';

export class Gate {
  constructor(policy, { cwd = process.cwd(), auditPath, audit, engine, approve = requestApproval } = {}) {
    this.policy = policy;
    this.cwd = cwd;
    this.engine = engine ?? new Engine(policy);
    this.approve = approve;
    const file = auditPath ?? process.env.BLASTGATE_AUDIT ?? path.resolve(cwd, policy.audit.path);
    this.audit = audit ?? new AuditLog(file, { enabled: policy.audit.enabled !== false });
  }

  /**
   * Decide on an action. With { interactive: false } an "approve" result is
   * returned as-is (for hosts like Claude Code that run their own prompt).
   * Resolves { allowed, decision, result, approval, ms }.
   */
  async check(input, { interactive = true, source = 'api' } = {}) {
    const action = normalizeAction(input, this.cwd);
    const t0 = performance.now();
    const result = this.engine.evaluate(action);
    const ms = performance.now() - t0;
    let approval = null;
    let final = result.decision;
    if (result.decision === 'approve' && interactive) {
      approval = await this.approve(this.policy, result);
      final = approval.approved ? 'allow' : 'deny';
    }
    this.audit.append({
      type: 'decision',
      source,
      policy: this.policy.name,
      decision: result.decision,
      final,
      rule: result.rule,
      reason: result.reason,
      matched: result.matched,
      approval,
      eval_ms: Number(ms.toFixed(4)),
      action: { kind: action.kind, server: action.server, tool: action.tool, command: action.command, args: action.args },
    });
    return { allowed: final === 'allow', decision: final, result, approval, ms };
  }

  record(event) {
    return this.audit.append(event);
  }
}

export function denialText(outcome) {
  const r = outcome.result;
  const base = `[blastgate] Blocked by policy rule "${r.rule ?? 'default'}": ${r.reason}.`;
  const extra = outcome.approval ? ` Approval: ${outcome.approval.note}.` : '';
  const msg = r.message ? ` ${r.message}` : ' Do not retry this exact action; choose a safer alternative or ask the user.';
  return base + extra + msg;
}
