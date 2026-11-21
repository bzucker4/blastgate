import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { BIN, SERVER, tmpdir } from './helpers.js';
import { verifyLog } from '../src/audit.js';

function envFor(dir, extra = {}) {
  return { ...process.env, NO_COLOR: '1', BLASTGATE_HOME: path.join(dir, 'home'), BLASTGATE_AUDIT: path.join(dir, 'audit.jsonl'), ...extra };
}

function startProxy(dir, policyArg, extraEnv = {}, { detached = false } = {}) {
  const env = envFor(dir, { MOCK_CALL_LOG: path.join(dir, 'calls.jsonl'), ...extraEnv });
  const child = spawn(process.execPath, [BIN, 'mcp', '--policy', policyArg, '--name', 'pg-test', '--quiet', '--', process.execPath, SERVER], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], detached });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => {
    const m = JSON.parse(l);
    waiting.get(m.id)?.(m);
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    waiting.set(myId, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
  });
  const close = () => new Promise((r) => { child.on('close', r); child.stdin.end(); });
  return { rpc, close };
}

test('MCP proxy: denied calls never reach the upstream server; allowed ones pass through', async (t) => {
  const dir = tmpdir(t);
  const { rpc, close } = startProxy(dir, 'demo');
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'mock-postgres');
  const list = await rpc('tools/list', {});
  assert.equal(list.result.tools.length, 4);
  const ok = await rpc('tools/call', { name: 'query_db', arguments: { sql: 'SELECT 1' } });
  assert.equal(ok.result.isError, undefined);
  const no = await rpc('tools/call', { name: 'query_db', arguments: { sql: 'DROP TABLE users' } });
  assert.equal(no.result.isError, true);
  assert.match(no.result.content[0].text, /no-destructive-sql/);
  const held = await rpc('tools/call', { name: 'run_shell', arguments: { command: 'rm -rf /' } });
  assert.match(held.result.content[0].text, /auto-deny/);
  await close();

  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.arguments.sql ?? c.arguments.command), ['SELECT 1']);

  const pub = fs.readFileSync(path.join(dir, 'home', 'keys', 'ed25519.pub.pem'), 'utf8');
  const v = verifyLog(path.join(dir, 'audit.jsonl'), pub);
  assert.equal(v.ok, true);
  assert.equal(v.entries, 4, '3 decisions + 1 execution record');
});

test('MCP proxy: tty approval with no terminal fails closed', async (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'p.yaml'), 'version: 1\napproval: { channel: tty, timeout_seconds: 3 }\nrules:\n  - id: ask\n    action: approve\n    match: { tool: "*" }\n');
  // detached = new session with no controlling terminal, so /dev/tty cannot open
  const { rpc, close } = startProxy(dir, 'p.yaml', { BLASTGATE_APPROVAL: '' }, { detached: true });
  await rpc('initialize', {});
  const r = await rpc('tools/call', { name: 'query_db', arguments: { sql: 'SELECT 1' } });
  await close();
  assert.equal(r.result.isError, true);
  assert.ok(!fs.existsSync(path.join(dir, 'calls.jsonl')), 'nothing reached the server');
});

test('exec: denied commands exit 126 and do not run; allowed ones run with secrets stripped', (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'blastgate.yaml'), `version: 1
exec:
  env_strip: ["*_TOKEN"]
rules:
  - id: no-touch-marker
    action: deny
    match: { kind: shell, command: "touch *" }
`);
  const env = envFor(dir, { SECRET_TOKEN: 'shh', KEEP_ME: 'yes' });
  const denied = spawnSync(process.execPath, [BIN, 'exec', '--', 'touch', 'marker'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(denied.status, 126);
  assert.ok(!fs.existsSync(path.join(dir, 'marker')));
  const ok = spawnSync(process.execPath, [BIN, 'exec', '--quiet', '--', process.execPath, '-e', 'console.log(JSON.stringify([process.env.SECRET_TOKEN ?? null, process.env.KEEP_ME]))'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), [null, 'yes']);
  const code = spawnSync(process.execPath, [BIN, 'exec', '--quiet', '--', process.execPath, '-e', 'process.exit(7)'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(code.status, 7, 'exit code passes through');
});

test('check: exit codes 0 allow, 1 deny, 2 approve', (t) => {
  const dir = tmpdir(t);
  const run = (a) => spawnSync(process.execPath, [BIN, 'check', '--policy', 'default', '--json', JSON.stringify(a)], { cwd: dir, env: envFor(dir), encoding: 'utf8' });
  assert.equal(run({ kind: 'shell', command: 'ls' }).status, 0);
  const d = run({ kind: 'mcp', tool: 'q', args: { sql: 'truncate users' } });
  assert.equal(d.status, 1);
  assert.equal(JSON.parse(d.stdout).rule, 'no-destructive-sql');
  assert.equal(run({ kind: 'shell', command: 'git push --force' }).status, 2);
});

test('Claude Code hook: deny, ask, and silent allow', (t) => {
  const dir = tmpdir(t);
  const hook = (payload) => {
    const r = spawnSync(process.execPath, [BIN, 'hook', 'claude-code', '--policy', 'default'], { cwd: dir, env: envFor(dir), input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: dir, ...payload }), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'cat ~/.aws/credentials' } }).permissionDecision, 'deny');
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf node_modules' } }).permissionDecision, 'ask');
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: '/etc/hosts', content: 'x' } }).permissionDecision, 'ask');
  assert.equal(hook({ tool_name: 'mcp__postgres__query', tool_input: { sql: 'DROP TABLE users' } }).permissionDecision, 'deny');
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'npm test' } }), null);
  assert.equal(hook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src', 'a.js'), content: 'x' } }), null);
});

test('Claude Code hook fails closed on a broken policy', (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'blastgate.yaml'), 'version: 2\n');
  const r = spawnSync(process.execPath, [BIN, 'hook', 'claude-code'], { cwd: dir, env: envFor(dir), input: '{"tool_name":"Bash","tool_input":{"command":"ls"}}', encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('shadow mode: MCP proxy logs the would-be denial but forwards the call', async (t) => {
  const dir = tmpdir(t);
  const { rpc, close } = startProxy(dir, 'demo', { BLASTGATE_MODE: 'shadow' });
  await rpc('initialize', {});
  const r = await rpc('tools/call', { name: 'query_db', arguments: { sql: 'DROP TABLE users' } });
  await close();
  assert.equal(r.result.isError, undefined, 'not blocked');
  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.arguments.sql), ['DROP TABLE users'], 'reached the server');
  const d = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'decision');
  assert.equal(d.mode, 'shadow');
  assert.equal(d.decision, 'deny', 'the would-be decision is recorded');
  assert.equal(d.final, 'allow');
  assert.equal(d.rule, 'no-destructive-sql');
});

test('shadow mode: exec --shadow runs a denied command and says what would have happened; approvals are never requested', (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'blastgate.yaml'), `version: 1
approval: { channel: auto-deny }
rules:
  - id: no-touch-marker
    action: deny
    match: { kind: shell, command: "touch marker" }
  - id: ask-touch-other
    action: approve
    match: { kind: shell, command: "touch other" }
`);
  const env = envFor(dir);
  const r = spawnSync(process.execPath, [BIN, 'exec', '--shadow', '--quiet', '--', 'touch', 'marker'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'marker')));
  assert.match(r.stderr, /shadow: would deny/);
  const a = spawnSync(process.execPath, [BIN, 'exec', '--shadow', '--quiet', '--', 'touch', 'other'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(a.status, 0, 'auto-deny approval channel is not consulted in shadow mode');
  assert.match(a.stderr, /shadow: would approve/);
  const tail = spawnSync(process.execPath, [BIN, 'audit', 'tail'], { cwd: dir, env, encoding: 'utf8' });
  assert.match(tail.stdout, /ALLOW.*touch marker.*shadow: would deny/);
  const enforced = spawnSync(process.execPath, [BIN, 'exec', '--quiet', '--', 'touch', 'marker'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(enforced.status, 126, 'without --shadow the policy is enforced again');
});

test('shadow mode: Claude Code hook stays silent; policy file mode and BLASTGATE_MODE override', (t) => {
  const dir = tmpdir(t);
  fs.writeFileSync(path.join(dir, 'blastgate.yaml'), 'version: 1\nmode: shadow\nrules:\n  - id: no-ls\n    action: deny\n    match: { kind: shell, command: "ls" }\n');
  const hook = (extra = {}) => spawnSync(process.execPath, [BIN, 'hook', 'claude-code'], { cwd: dir, env: envFor(dir, extra), input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: dir }), encoding: 'utf8' });
  assert.equal(hook().stdout.trim(), '', 'mode: shadow in the file');
  assert.equal(JSON.parse(hook({ BLASTGATE_MODE: 'enforce' }).stdout).hookSpecificOutput.permissionDecision, 'deny', 'env forces enforce');
  assert.equal(JSON.parse(hook({ BLASTGATE_MODE: 'bogus' }).stdout).hookSpecificOutput.permissionDecision, 'deny', 'a bad mode fails closed');
});

test('demo runs green end to end', (t) => {
  const dir = tmpdir(t);
  const r = spawnSync(process.execPath, [BIN, 'demo', '--fast'], { cwd: dir, env: { ...process.env, NO_COLOR: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified/);
  assert.match(r.stdout, /detected at line/);
  const left = /demo files left in (\S+)/.exec(r.stdout)?.[1];
  if (left) fs.rmSync(left, { recursive: true, force: true });
});
