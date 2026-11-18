// The decision engine. Pure and synchronous apart from the in-memory
// rate-limit windows. Precedence is fixed and documented:
//
//   any matching deny rule  -> deny
//   else any approve rule   -> approve (pause for a human)
//   else any allow rule     -> allow
//   else                    -> policy.default
//
// Rule order never changes the decision, only which rule is reported first.

import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  globMatch, compileRegex, collectStrings, getPath, shellSegments, tokenize,
  unwrapArgv, destructiveShell, destructiveSql, extractPaths, resolvePath,
  isInside, extractDomains,
} from './match.js';

const asList = (v) => (Array.isArray(v) ? v : [v]);

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** Normalize any supported input into the action shape the engine expects. */
export function normalizeAction(input, cwd = process.cwd()) {
  const a = { kind: input.kind ?? 'mcp', args: input.args ?? input.arguments ?? {}, cwd: input.cwd ?? cwd };
  for (const k of ['server', 'tool', 'command', 'path', 'url']) if (input[k] !== undefined) a[k] = input[k];
  if (a.kind === 'shell') {
    if (Array.isArray(input.argv) && !a.command) a.command = input.argv.map(quoteArg).join(' ');
    if (!a.command) a.command = '';
    if (!a.tool) {
      const first = shellSegments(a.command)[0] ?? '';
      a.tool = path.basename(unwrapArgv(tokenize(first))[0] ?? '');
    }
  }
  if (a.kind !== 'shell' && !a.command) {
    const c = a.args && (a.args.command ?? a.args.cmd ?? a.args.script);
    if (typeof c === 'string') a.command = c;
  }
  if (!a.tool) a.tool = a.kind;
  return a;
}

function quoteArg(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`;
}

function commandMatches(cmd, globs) {
  if (!cmd) return null;
  const candidates = [cmd.trim()];
  for (const seg of shellSegments(cmd)) {
    candidates.push(seg);
    candidates.push(unwrapArgv(tokenize(seg)).join(' '));
  }
  return candidates.find((c) => globMatch(c, globs)) ?? null;
}

/** Test one rule's match block. Returns a reason string on match, else null. */
export function matchRule(rule, action) {
  const m = rule.match;
  const why = [];
  if (m.kind !== undefined) {
    if (!asList(m.kind).includes(action.kind)) return null;
  }
  if (m.tool !== undefined) {
    if (!globMatch(action.tool, m.tool)) return null;
    why.push(`tool ${action.tool}`);
  }
  if (m.server !== undefined) {
    if (!globMatch(action.server, m.server)) return null;
    why.push(`server ${action.server}`);
  }
  if (m.command !== undefined) {
    const hit = commandMatches(action.command, m.command);
    if (!hit) return null;
    why.push(`command "${hit}"`);
  }
  if (m.shell === 'destructive') {
    const r = action.command ? destructiveShell(action.command) : null;
    if (!r) return null;
    why.push(r);
  }
  if (m.sql === 'destructive') {
    const strings = collectStrings(action.args);
    if (action.kind === 'shell' && action.command) strings.push(action.command);
    const r = strings.map(destructiveSql).find(Boolean);
    if (!r) return null;
    why.push(r);
  }
  if (m.args !== undefined) {
    for (const [key, res] of Object.entries(m.args)) {
      const v = getPath(action.args, key);
      if (v === undefined || v === null) return null;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      if (!asList(res).some((r) => compileRegex(r).test(s))) return null;
      why.push(`args.${key} matches`);
    }
  }
  if (m.any_arg !== undefined) {
    const strings = collectStrings(action.args);
    const hit = strings.find((s) => asList(m.any_arg).some((r) => compileRegex(r).test(s)));
    if (hit === undefined) return null;
    why.push(`argument matches pattern`);
  }
  if (m.path_outside !== undefined || m.path_inside !== undefined) {
    const paths = extractPaths(action);
    if (paths.length === 0) return null;
    if (m.path_outside !== undefined) {
      const roots = asList(m.path_outside).map((d) => resolvePath(d, action.cwd));
      const bad = paths.find((p) => !roots.some((r) => isInside(resolvePath(p, action.cwd), r)));
      if (bad === undefined) return null;
      why.push(`path ${bad} is outside ${asList(m.path_outside).join(', ')}`);
    }
    if (m.path_inside !== undefined) {
      const roots = asList(m.path_inside).map((d) => resolvePath(d, action.cwd));
      const hit = paths.find((p) => roots.some((r) => isInside(resolvePath(p, action.cwd), r)));
      if (hit === undefined) return null;
      why.push(`path ${hit} is inside a protected path`);
    }
  }
  if (m.domain_not_in !== undefined || m.domain_in !== undefined) {
    const domains = extractDomains(action);
    if (domains.length === 0) return null;
    if (m.domain_not_in !== undefined) {
      const bad = domains.find((d) => !globMatch(d, m.domain_not_in));
      if (bad === undefined) return null;
      why.push(`domain ${bad} is not on the allowlist`);
    }
    if (m.domain_in !== undefined) {
      const hit = domains.find((d) => globMatch(d, m.domain_in));
      if (hit === undefined) return null;
      why.push(`domain ${hit} is blocked`);
    }
  }
  return why.join('; ') || 'matched';
}

export function fingerprint(action) {
  return createHash('sha256')
    .update(stableStringify({ k: action.kind, s: action.server, t: action.tool, a: action.args, c: action.command }))
    .digest('hex')
    .slice(0, 16);
}

export class Engine {
  constructor(policy, { now = () => Date.now() } = {}) {
    this.policy = policy;
    this.now = now;
    this.windows = new Map();
  }

  windowKey(rule, action) {
    return rule.limit.same_args ? `${rule.id}:${fingerprint(action)}` : rule.id;
  }

  recent(key, perSeconds) {
    const cutoff = this.now() - perSeconds * 1000;
    const list = (this.windows.get(key) ?? []).filter((t) => t > cutoff);
    this.windows.set(key, list);
    return list;
  }

  /** Decide on an action. Returns { decision, rule, reason, matched, message, action }. */
  evaluate(input) {
    const action = input.__normalized ? input : normalizeAction(input);
    const triggered = [];
    const counted = [];
    for (const rule of this.policy.rules) {
      const reason = matchRule(rule, action);
      if (reason === null) continue;
      if (rule.limit) {
        const key = this.windowKey(rule, action);
        const used = this.recent(key, rule.limit.per_seconds).length;
        counted.push(key);
        if (used < rule.limit.max) continue;
        const scope = rule.limit.same_args ? 'identical calls' : 'calls';
        triggered.push({ rule, reason: `${rule.limit.max} ${scope} per ${rule.limit.per_seconds}s exceeded` });
        continue;
      }
      triggered.push({ rule, reason });
    }
    let decision = this.policy.default;
    let hit = null;
    for (const a of ['deny', 'approve', 'allow']) {
      hit = triggered.find((t) => t.rule.action === a);
      if (hit) { decision = a; break; }
    }
    if (decision !== 'deny') {
      const t = this.now();
      for (const key of counted) this.windows.get(key).push(t);
    }
    return {
      decision,
      rule: hit ? hit.rule.id : null,
      reason: hit ? hit.reason : `no rule matched; default is ${this.policy.default}`,
      message: hit?.rule.message ?? null,
      matched: triggered.map((t) => t.rule.id),
      action,
    };
  }
}
