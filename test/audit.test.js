import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AuditLog, verifyLog, loadOrCreateKey, redact } from '../src/audit.js';
import { tmpdir } from './helpers.js';

function setup(t, n = 5) {
  const dir = tmpdir(t);
  const key = loadOrCreateKey(path.join(dir, 'keys'));
  const file = path.join(dir, 'audit.jsonl');
  const log = new AuditLog(file, { key });
  for (let i = 0; i < n; i++) log.append({ type: 'decision', i, final: i % 2 ? 'deny' : 'allow' });
  const pub = fs.readFileSync(key.pubPath, 'utf8');
  return { dir, file, pub, log };
}

test('a clean log verifies', (t) => {
  const { file, pub } = setup(t);
  const r = verifyLog(file, pub);
  assert.equal(r.ok, true);
  assert.equal(r.entries, 5);
});

test('editing a line is detected', (t) => {
  const { file, pub } = setup(t);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[1] = lines[1].replace('"final":"deny"', '"final":"allow"');
  fs.writeFileSync(file, lines.join('\n'));
  const r = verifyLog(file, pub);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].error, /edited/);
  assert.equal(r.errors[0].line, 2);
});

test('deleting or reordering lines is detected', (t) => {
  const { file, pub } = setup(t);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  fs.writeFileSync(file, `${[lines[0], lines[2], lines[3], lines[4]].join('\n')}\n`);
  assert.equal(verifyLog(file, pub).ok, false);
  fs.writeFileSync(file, `${[lines[1], lines[0], ...lines.slice(2)].join('\n')}\n`);
  assert.equal(verifyLog(file, pub).ok, false);
});

test('a rebuilt chain signed with a different key is rejected', (t) => {
  const { dir, file, pub } = setup(t);
  const other = loadOrCreateKey(path.join(dir, 'other-keys'));
  fs.rmSync(file);
  const forged = new AuditLog(file, { key: other });
  forged.append({ type: 'decision', final: 'allow' });
  const r = verifyLog(file, pub);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].error, /different key/);
});

test('appending continues the chain across instances', (t) => {
  const { file, pub, log } = setup(t, 2);
  new AuditLog(file, { key: log.key }).append({ type: 'decision', i: 99 });
  const r = verifyLog(file, pub);
  assert.equal(r.ok, true);
  assert.equal(r.entries, 3);
});

test('secrets are redacted and long strings truncated', () => {
  const out = redact({ api_key: 'sk-123', nested: { password: 'p', ok: 'x'.repeat(600) }, list: [{ token: 't' }] });
  assert.equal(out.api_key, '[redacted]');
  assert.equal(out.nested.password, '[redacted]');
  assert.equal(out.list[0].token, '[redacted]');
  assert.match(out.nested.ok, /\[\+88 chars\]$/);
});
