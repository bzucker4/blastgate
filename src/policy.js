// Policy loading and strict validation. A policy that fails validation
// never loads: Blastgate refuses to run rather than guess.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './yaml.js';
import { compileRegex } from './match.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BUILTIN_DIR = path.join(HERE, '..', 'policies');

export const ACTIONS = ['allow', 'deny', 'approve'];
const KINDS = ['mcp', 'shell', 'fs', 'http'];
const CHANNELS = ['tty', 'webhook', 'auto-deny', 'auto-approve'];
export const MODES = ['enforce', 'shadow'];
const MATCH_KEYS = new Set([
  'kind', 'tool', 'server', 'command', 'shell', 'sql', 'args', 'any_arg',
  'path_outside', 'path_inside', 'domain_not_in', 'domain_in',
]);
const RULE_KEYS = new Set(['id', 'description', 'action', 'match', 'limit', 'message']);
const TOP_KEYS = new Set(['version', 'name', 'description', 'default', 'mode', 'approval', 'audit', 'exec', 'rules']);

export class PolicyError extends Error {}

const asList = (v) => (Array.isArray(v) ? v : [v]);

function fail(where, msg) {
  throw new PolicyError(`${where}: ${msg}`);
}

function checkStrings(where, v) {
  for (const s of asList(v)) if (typeof s !== 'string' || !s) fail(where, 'expected a string or a list of strings');
}

function checkRegexes(where, v) {
  for (const s of asList(v)) {
    if (typeof s !== 'string') fail(where, 'expected a regex string');
    try { compileRegex(s); } catch (e) { fail(where, `invalid regex "${s}": ${e.message}`); }
  }
}

export function validatePolicy(p, source = 'policy') {
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(source, 'policy must be a map');
  for (const k of Object.keys(p)) if (!TOP_KEYS.has(k)) fail(source, `unknown top-level key "${k}"`);
  if (p.version !== 1) fail(source, '"version: 1" is required');
  const policy = {
    version: 1,
    name: p.name ?? path.basename(source),
    description: p.description ?? '',
    default: p.default ?? 'allow',
    mode: p.mode ?? 'enforce',
    approval: { channel: 'tty', timeout_seconds: 120, ...(p.approval ?? {}) },
    audit: { enabled: true, path: '.blastgate/audit.jsonl', ...(p.audit ?? {}) },
    exec: { env_strip: [], timeout_seconds: 0, ...(p.exec ?? {}) },
    rules: [],
  };
  if (!ACTIONS.includes(policy.default)) fail(source, `default must be one of ${ACTIONS.join(', ')}`);
  if (!MODES.includes(policy.mode)) fail(`${source}.mode`, `must be one of ${MODES.join(', ')}`);
  if (!CHANNELS.includes(policy.approval.channel)) fail(`${source}.approval.channel`, `must be one of ${CHANNELS.join(', ')}`);
  if (policy.approval.channel === 'webhook' && !policy.approval.webhook_url) fail(`${source}.approval`, 'webhook channel needs webhook_url');
  if (typeof policy.approval.timeout_seconds !== 'number' || policy.approval.timeout_seconds <= 0) fail(`${source}.approval.timeout_seconds`, 'must be a positive number');
  if (!Array.isArray(policy.exec.env_strip)) fail(`${source}.exec.env_strip`, 'must be a list of globs');
  policy.exec.env_strip.forEach((g) => checkStrings(`${source}.exec.env_strip`, g));

  const rules = p.rules ?? [];
  if (!Array.isArray(rules)) fail(`${source}.rules`, 'must be a list');
  const ids = new Set();
  rules.forEach((r, i) => {
    const where = `${source}.rules[${i}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) fail(where, 'rule must be a map');
    for (const k of Object.keys(r)) if (!RULE_KEYS.has(k)) fail(where, `unknown key "${k}"`);
    if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/i.test(r.id)) fail(where, 'id is required (letters, digits, - _ .)');
    if (ids.has(r.id)) fail(where, `duplicate rule id "${r.id}"`);
    ids.add(r.id);
    if (!ACTIONS.includes(r.action)) fail(`${where} (${r.id})`, `action must be one of ${ACTIONS.join(', ')}`);
    const m = r.match ?? {};
    if (typeof m !== 'object' || Array.isArray(m)) fail(`${where}.match`, 'must be a map');
    for (const k of Object.keys(m)) if (!MATCH_KEYS.has(k)) fail(`${where}.match`, `unknown matcher "${k}"`);
    if (m.kind !== undefined) for (const k of asList(m.kind)) if (!KINDS.includes(k)) fail(`${where}.match.kind`, `must be one of ${KINDS.join(', ')}`);
    for (const k of ['tool', 'server', 'command', 'path_outside', 'path_inside', 'domain_not_in', 'domain_in']) {
      if (m[k] !== undefined) checkStrings(`${where}.match.${k}`, m[k]);
    }
    if (m.shell !== undefined && m.shell !== 'destructive') fail(`${where}.match.shell`, 'only "destructive" is supported');
    if (m.sql !== undefined && m.sql !== 'destructive') fail(`${where}.match.sql`, 'only "destructive" is supported');
    if (m.any_arg !== undefined) checkRegexes(`${where}.match.any_arg`, m.any_arg);
    if (m.args !== undefined) {
      if (typeof m.args !== 'object' || Array.isArray(m.args)) fail(`${where}.match.args`, 'must map arg paths to regexes');
      for (const [k, v] of Object.entries(m.args)) checkRegexes(`${where}.match.args.${k}`, v);
    }
    if (r.limit !== undefined) {
      const l = r.limit;
      if (typeof l !== 'object' || !Number.isInteger(l.max) || l.max < 0) fail(`${where}.limit.max`, 'must be a non-negative integer');
      if (typeof l.per_seconds !== 'number' || l.per_seconds <= 0) fail(`${where}.limit.per_seconds`, 'must be a positive number');
      for (const k of Object.keys(l)) if (!['max', 'per_seconds', 'same_args'].includes(k)) fail(`${where}.limit`, `unknown key "${k}"`);
    }
    if (Object.keys(m).length === 0 && r.limit === undefined) fail(where, `rule "${r.id}" has no match conditions; it would match everything. Use "default:" instead, or add "match: { tool: \\"*\\" }" to be explicit`);
    policy.rules.push({ id: r.id, description: r.description ?? '', action: r.action, match: m, limit: r.limit ?? null, message: r.message ?? null });
  });
  return policy;
}

export function parsePolicy(text, source) {
  const trimmed = text.trimStart();
  const raw = trimmed.startsWith('{') ? JSON.parse(text) : parseYaml(text);
  return validatePolicy(raw, source);
}

/** Find the policy to use: --policy, $BLASTGATE_POLICY, ./blastgate.yaml, ~/.blastgate/policy.yaml, built-in default. */
export function resolvePolicyPath(explicit, cwd = process.cwd()) {
  const candidates = [
    explicit,
    process.env.BLASTGATE_POLICY,
    path.join(cwd, 'blastgate.yaml'),
    path.join(cwd, 'blastgate.yml'),
    path.join(os.homedir(), '.blastgate', 'policy.yaml'),
  ].filter(Boolean);
  for (const c of candidates) {
    const builtin = path.join(BUILTIN_DIR, `${c}.yaml`);
    if (!c.includes('/') && !c.includes('\\') && fs.existsSync(builtin)) return builtin;
    if (fs.existsSync(c)) return path.resolve(c);
    if (c === explicit || c === process.env.BLASTGATE_POLICY) throw new PolicyError(`policy file not found: ${c}`);
  }
  return path.join(BUILTIN_DIR, 'default.yaml');
}

/**
 * Load and validate a policy. The enforcement mode can be overridden:
 * `mode` (from --shadow) wins over $BLASTGATE_MODE, which wins over the file.
 */
export function loadPolicy(explicit, cwd, { mode } = {}) {
  const file = resolvePolicyPath(explicit, cwd);
  const policy = parsePolicy(fs.readFileSync(file, 'utf8'), path.basename(file));
  policy.file = file;
  const override = mode ?? process.env.BLASTGATE_MODE;
  if (override !== undefined && override !== '') {
    if (!MODES.includes(override)) throw new PolicyError(`BLASTGATE_MODE must be one of ${MODES.join(', ')} (got "${override}")`);
    policy.mode = override;
  }
  return policy;
}
