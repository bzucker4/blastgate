import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml, YamlError } from '../src/yaml.js';
import { ROOT } from './helpers.js';

test('maps, lists, lists of maps, flow lists and scalars', () => {
  const doc = parseYaml(`
version: 1   # comment
name: "demo # not a comment"
on: true
off: false
none: null
n: -2.5
list:
  - a
  - 'b''c'
inline: [x, "y, z", 3]
empty: {}
flow: { max: 5, per_seconds: 60 }
rules:
  - id: one
    match:
      tool: "*"
  -   id: two
      action: deny
same_indent:
- p
- q
`);
  assert.deepEqual(doc, {
    version: 1,
    name: 'demo # not a comment',
    on: true,
    off: false,
    none: null,
    n: -2.5,
    list: ['a', "b'c"],
    inline: ['x', 'y, z', 3],
    empty: {},
    flow: { max: 5, per_seconds: 60 },
    rules: [{ id: 'one', match: { tool: '*' } }, { id: 'two', action: 'deny' }],
    same_indent: ['p', 'q'],
  });
});

test('values containing colons and URLs stay strings', () => {
  assert.deepEqual(parseYaml('url: https://example.com:8443/x\ncmd: rm -rf *\n'), { url: 'https://example.com:8443/x', cmd: 'rm -rf *' });
});

test('rejects tabs, duplicates, bad indentation and unsupported features', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), YamlError);
  assert.throws(() => parseYaml('a: 1\na: 2'), /duplicate key/);
  assert.throws(() => parseYaml('a: 1\n    b: 2'), /indentation/);
  assert.throws(() => parseYaml('a: |\n  text'), /block scalars/);
  assert.throws(() => parseYaml('a: &x 1'), /anchors/);
  assert.throws(() => parseYaml('a: "open'), YamlError);
});

test('built-in policies parse', () => {
  for (const f of ['default.yaml', 'demo.yaml']) {
    const doc = parseYaml(fs.readFileSync(path.join(ROOT, 'policies', f), 'utf8'));
    assert.equal(doc.version, 1);
    assert.ok(Array.isArray(doc.rules) && doc.rules.length > 0);
  }
});
