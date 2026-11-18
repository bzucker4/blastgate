// Measures (1) pure policy evaluation cost and (2) the round-trip overhead
// the MCP proxy adds compared with talking to the server directly.
// Run: npm run bench

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Engine } from '../src/engine.js';
import { loadPolicy } from '../src/policy.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

const ACTIONS = [
  { kind: 'mcp', server: 'postgres', tool: 'query', args: { sql: 'SELECT id, email FROM users WHERE id = 42' } },
  { kind: 'mcp', server: 'postgres', tool: 'query', args: { sql: 'DROP TABLE users' } },
  { kind: 'shell', command: 'git status && npm test -- --watch=false' },
  { kind: 'shell', command: 'sudo rm -rf /var/lib/postgresql' },
  { kind: 'fs', tool: 'Write', args: { file_path: 'src/index.ts', content: 'x'.repeat(2000) } },
  { kind: 'mcp', server: 'http', tool: 'fetch', args: { url: 'https://api.github.com/repos/x/y' } },
];

function benchEngine(n = 20000) {
  const policy = loadPolicy('default');
  policy.rules = policy.rules.filter((r) => !r.limit); // measure matching, not the window
  const engine = new Engine(policy);
  for (let i = 0; i < 2000; i++) engine.evaluate(ACTIONS[i % ACTIONS.length]);
  const times = [];
  for (let i = 0; i < n; i++) {
    const a = ACTIONS[i % ACTIONS.length];
    const t0 = performance.now();
    engine.evaluate(a);
    times.push((performance.now() - t0) * 1000);
  }
  return { n, rules: policy.rules.length, p50: pct(times, 50), p99: pct(times, 99) };
}

async function roundTrips(cmd, args, n, env) {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], env });
  const waiting = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(); });
  let id = 0;
  const rpc = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); });
  await rpc('initialize', {});
  for (let i = 0; i < 50; i++) await rpc('tools/call', { name: 'query_db', arguments: { sql: `SELECT ${i}` } });
  const times = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await rpc('tools/call', { name: 'query_db', arguments: { sql: `SELECT * FROM t WHERE id = ${i}` } });
    times.push(performance.now() - t0);
  }
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  return { p50: pct(times, 50), p99: pct(times, 99) };
}

const e = benchEngine();
console.log(`policy evaluation (default policy, ${e.rules} rules, ${e.n} calls): p50 ${e.p50.toFixed(1)} us, p99 ${e.p99.toFixed(1)} us`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blastgate-bench-'));
const env = { ...process.env, BLASTGATE_HOME: path.join(tmp, 'home'), BLASTGATE_AUDIT: path.join(tmp, 'audit.jsonl') };
fs.writeFileSync(path.join(tmp, 'p.yaml'), fs.readFileSync(path.join(ROOT, 'policies', 'default.yaml'), 'utf8').replace(/limit: \{ max: \d+/g, 'limit: { max: 1000000'));
const server = path.join(ROOT, 'examples', 'mock-postgres-server.js');
const N = 1000;
const direct = await roundTrips(process.execPath, [server], N, env);
const proxied = await roundTrips(process.execPath, [path.join(ROOT, 'bin', 'blastgate.js'), 'mcp', '--quiet', '--policy', path.join(tmp, 'p.yaml'), '--', process.execPath, server], N, env);
console.log(`MCP round trip, direct      (${N} calls): p50 ${direct.p50.toFixed(3)} ms, p99 ${direct.p99.toFixed(3)} ms`);
console.log(`MCP round trip, via proxy   (${N} calls): p50 ${proxied.p50.toFixed(3)} ms, p99 ${proxied.p99.toFixed(3)} ms  (includes signed audit write per call)`);
console.log(`added latency: p50 +${(proxied.p50 - direct.p50).toFixed(3)} ms`);
console.log(`node ${process.version}, ${os.cpus()[0]?.model ?? 'unknown cpu'}, ${os.platform()}`);
fs.rmSync(tmp, { recursive: true, force: true });
