// Transparent stdio MCP proxy. Sits between an MCP client (Claude Code,
// Cursor, Windsurf, ...) and an upstream MCP server process. Every
// JSON-RPC message passes through untouched except `tools/call`
// requests, which are evaluated first. Denied calls never reach the
// upstream server; the client gets a normal tool result with
// isError: true and the reason, so the agent can adapt instead of crash.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { Gate, denialText, shadowNote } from './gate.js';
import { c, log, badge } from './ui.js';

export function runMcpProxy({ policy, command, args, name, quiet = false, stdin = process.stdin, stdout = process.stdout, gate }) {
  const serverName = name ?? path.basename(command);
  gate = gate ?? new Gate(policy);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
  const pending = new Map();
  const write = (obj) => stdout.write(`${JSON.stringify(obj)}\n`);
  const say = (...p) => { if (!quiet) log(c.dim('[blastgate]'), ...p); };
  let queue = Promise.resolve();
  if (policy.mode === 'shadow') say(c.yellow('shadow mode: decisions are logged, nothing is blocked'));

  child.on('error', (e) => {
    log(c.red(`[blastgate] failed to start upstream MCP server "${command}": ${e.message}`));
    process.exitCode = 127;
  });

  const fromClient = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  fromClient.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      child.stdin.write(`${line}\n`);
      return;
    }
    const messages = Array.isArray(msg) ? msg : [msg];
    for (const m of messages) handle(m);
  });
  fromClient.on('close', () => { queue.then(() => child.stdin.end()); });

  function handle(m) {
    if (m && m.method === 'tools/call' && m.id !== undefined) {
      // Serialize decisions so rate limits and approval prompts are ordered.
      queue = queue.then(() => decide(m)).catch((e) => {
        log(c.red(`[blastgate] internal error, denying call: ${e.stack ?? e}`));
        write({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: '[blastgate] internal error; call denied (fail closed).' }], isError: true } });
      });
      return;
    }
    queue.then(() => child.stdin.write(`${JSON.stringify(m)}\n`));
  }

  async function decide(m) {
    const params = m.params ?? {};
    const outcome = await gate.check(
      { kind: 'mcp', server: serverName, tool: params.name, args: params.arguments ?? {} },
      { source: 'mcp' },
    );
    const shown = outcome.approval || outcome.shadow ? outcome.decision : outcome.result.decision;
    say(badge(shown), c.bold(`${serverName}/${params.name}`), c.yellow(shadowNote(outcome)), c.dim(outcome.result.rule ? `[${outcome.result.rule}] ${outcome.result.reason}` : ''));
    if (outcome.allowed) {
      pending.set(m.id, { tool: params.name, t: Date.now() });
      child.stdin.write(`${JSON.stringify(m)}\n`);
    } else {
      write({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: denialText(outcome) }], isError: true } });
    }
  }

  const fromServer = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  fromServer.on('line', (line) => {
    stdout.write(`${line}\n`);
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg && msg.id !== undefined && pending.has(msg.id) && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      gate.record({
        type: 'execution',
        source: 'mcp',
        server: serverName,
        tool: p.tool,
        ok: !msg.error && msg.result?.isError !== true,
        duration_ms: Date.now() - p.t,
      });
    }
  });

  return new Promise((resolve) => {
    child.on('close', (code, signal) => resolve(signal ? 1 : (code ?? 0)));
  });
}
