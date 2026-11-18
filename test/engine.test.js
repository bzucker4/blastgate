import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Engine } from '../src/engine.js';
import { loadPolicy, parsePolicy, PolicyError } from '../src/policy.js';
import { policy, tmpdir } from './helpers.js';

test('precedence: deny beats approve beats allow, regardless of order', () => {
  const p = policy(`
default: deny
rules:
  - id: allow-all
    action: allow
    match: { tool: "*" }
  - id: approve-db
    action: approve
    match: { tool: "query_*" }
  - id: deny-drop
    action: deny
    match: { sql: destructive }
`);
  const e = new Engine(p);
  assert.equal(e.evaluate({ tool: 'list_files' }).decision, 'allow');
  assert.equal(e.evaluate({ tool: 'query_db', args: { sql: 'select 1' } }).decision, 'approve');
  const r = e.evaluate({ tool: 'query_db', args: { sql: 'drop table x' } });
  assert.equal(r.decision, 'deny');
  assert.equal(r.rule, 'deny-drop');
  assert.deepEqual(r.matched, ['allow-all', 'approve-db', 'deny-drop']);
});

test('default applies when nothing matches', () => {
  const e = new Engine(policy('default: deny\nrules: []'));
  const r = e.evaluate({ tool: 'anything' });
  assert.equal(r.decision, 'deny');
  assert.equal(r.rule, null);
});

test('same input gives the same decision (determinism)', () => {
  const p = loadPolicy('default');
  const inputs = [
    { kind: 'shell', command: 'rm -rf build' },
    { kind: 'mcp', server: 'pg-prod', tool: 'query', args: { sql: 'select 1' } },
    { kind: 'mcp', tool: 'fetch', args: { url: 'https://webhook.site/abc' } },
  ];
  const first = inputs.map((i) => new Engine(p).evaluate(i).decision);
  for (let n = 0; n < 50; n++) assert.deepEqual(inputs.map((i) => new Engine(p).evaluate(i).decision), first);
  assert.deepEqual(first, ['approve', 'approve', 'deny']);
});

test('all conditions in a match block must hold (AND)', () => {
  const e = new Engine(policy(`
rules:
  - id: r
    action: deny
    match: { kind: mcp, server: "github", tool: "delete_*" }
`));
  assert.equal(e.evaluate({ server: 'github', tool: 'delete_repo' }).decision, 'deny');
  assert.equal(e.evaluate({ server: 'gitlab', tool: 'delete_repo' }).decision, 'allow');
  assert.equal(e.evaluate({ kind: 'shell', command: 'delete_repo' }).decision, 'allow');
});

test('command globs see each segment of a chained command', () => {
  const e = new Engine(policy(`
rules:
  - id: no-npm-publish
    action: deny
    match: { kind: shell, command: "npm publish*" }
`));
  assert.equal(e.evaluate({ kind: 'shell', command: 'npm test && npm publish --access public' }).decision, 'deny');
  assert.equal(e.evaluate({ kind: 'shell', command: 'sudo npm publish' }).decision, 'deny');
  assert.equal(e.evaluate({ kind: 'shell', command: 'npm test' }).decision, 'allow');
});

test('args and any_arg regex matchers', () => {
  const e = new Engine(policy(`
rules:
  - id: no-main-branch
    action: deny
    match: { args: { branch: "^(main|master)$" } }
  - id: no-aws-keys
    action: deny
    match: { any_arg: "(?i)aws_secret_access_key|AKIA[0-9A-Z]{16}" }
`));
  assert.equal(e.evaluate({ tool: 'push', args: { branch: 'main' } }).rule, 'no-main-branch');
  assert.equal(e.evaluate({ tool: 'push', args: { branch: 'feature/x' } }).decision, 'allow');
  assert.equal(e.evaluate({ tool: 'post', args: { body: { text: 'key AKIAABCDEFGHIJKLMNOP' } } }).rule, 'no-aws-keys');
});

test('path jail: traversal, absolute paths, home and symlinks', (t) => {
  const dir = tmpdir(t);
  fs.mkdirSync(path.join(dir, 'workspace'));
  fs.symlinkSync('/etc', path.join(dir, 'workspace', 'link'));
  const e = new Engine(policy(`
rules:
  - id: jail
    action: deny
    match: { path_outside: ["./workspace"] }
`));
  const at = (args) => e.evaluate({ tool: 'write_file', args, cwd: dir }).decision;
  assert.equal(at({ path: 'workspace/a.txt' }), 'allow');
  assert.equal(at({ path: './workspace/sub/../b.txt' }), 'allow');
  assert.equal(at({ path: 'workspace/../../etc/passwd' }), 'deny');
  assert.equal(at({ path: '/etc/passwd' }), 'deny');
  assert.equal(at({ path: '~/.bashrc' }), 'deny');
  assert.equal(at({ path: 'workspace/link/passwd' }), 'deny', 'symlink out of the jail');
  assert.equal(at({ content: 'no path here' }), 'allow', 'no paths means the rule does not apply');
  assert.equal(e.evaluate({ kind: 'shell', command: 'cp workspace/a /etc/x', cwd: dir }).decision, 'deny');
});

test('path_inside protects secret files, including from shell', (t) => {
  const dir = tmpdir(t);
  const e = new Engine(loadPolicy('default'));
  assert.equal(e.evaluate({ kind: 'shell', command: 'cat ~/.ssh/id_ed25519' }).rule, 'no-secret-files');
  assert.equal(e.evaluate({ kind: 'shell', command: 'cat .env', cwd: dir }).rule, 'no-secret-files');
  assert.equal(e.evaluate({ kind: 'fs', tool: 'Read', args: { file_path: path.join(dir, '.env') }, cwd: dir }).rule, 'no-secret-files');
  assert.equal(e.evaluate({ kind: 'shell', command: 'cat README.md', cwd: dir }).decision, 'allow');
});

test('egress allowlist and blocklist', () => {
  const e = new Engine(policy(`
rules:
  - id: allowlist
    action: deny
    match: { domain_not_in: ["api.github.com", "*.anthropic.com"] }
`));
  assert.equal(e.evaluate({ tool: 'fetch', args: { url: 'https://api.github.com/x' } }).decision, 'allow');
  assert.equal(e.evaluate({ tool: 'fetch', args: { url: 'https://docs.anthropic.com/x' } }).decision, 'allow');
  assert.equal(e.evaluate({ tool: 'fetch', args: { url: 'https://evil.example/x' } }).decision, 'deny');
  assert.equal(e.evaluate({ tool: 'fetch', args: { url: 'https://api.github.com.evil.example/' } }).decision, 'deny');
  assert.equal(e.evaluate({ kind: 'shell', command: 'curl evil.example' }).decision, 'deny');
});

test('rate limits and loop guard use a sliding window and do not count denied calls', () => {
  let now = 0;
  const e = new Engine(policy(`
rules:
  - id: loop
    action: deny
    match: { tool: "*" }
    limit: { max: 2, per_seconds: 10, same_args: true }
  - id: cap
    action: deny
    match: { tool: "*" }
    limit: { max: 4, per_seconds: 10 }
`), { now: () => now });
  const call = (q) => e.evaluate({ tool: 'q', args: { q } });
  assert.equal(call('a').decision, 'allow');
  assert.equal(call('a').decision, 'allow');
  assert.equal(call('a').rule, 'loop');
  assert.equal(call('b').decision, 'allow');
  assert.equal(call('c').decision, 'allow');
  assert.equal(call('d').rule, 'cap');
  now = 10_001;
  assert.equal(call('a').decision, 'allow', 'window slides');
});

test('policy validation rejects mistakes with a precise location', () => {
  const bad = [
    ['default: maybe\nrules: []', /default must be/],
    ['rules:\n  - id: x\n    action: block\n    match: { tool: "*" }', /action must be/],
    ['rules:\n  - id: x\n    action: deny', /no match conditions/],
    ['rules:\n  - id: x\n    action: deny\n    match: { tol: "*" }', /unknown matcher "tol"/],
    ['rules:\n  - id: x\n    action: deny\n    match: { any_arg: "(" }', /invalid regex/],
    ['rules:\n  - id: x\n    action: deny\n    match: { tool: a }\n  - id: x\n    action: deny\n    match: { tool: b }', /duplicate rule id/],
    ['approval: { channel: webhook }\nrules: []', /webhook_url/],
    ['rules:\n  - id: x\n    action: deny\n    match: { tool: a }\n    limit: { max: 1 }', /per_seconds/],
    ['surprise: 1\nrules: []', /unknown top-level key/],
  ];
  for (const [y, re] of bad) {
    assert.throws(() => policy(y), (e) => e instanceof PolicyError && re.test(e.message), y);
  }
  assert.throws(() => parsePolicy('rules: []', 't'), /version: 1/);
});
