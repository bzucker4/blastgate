// `blastgate exec -- <command>`: evaluate a shell command, then run it
// with a scrubbed environment and optional timeout. Exit code passes through.

import { spawn } from 'node:child_process';
import { Gate, denialText } from './gate.js';
import { globMatch } from './match.js';
import { c, log, badge } from './ui.js';

export function scrubEnv(env, globs) {
  if (!globs || globs.length === 0) return { env: { ...env }, removed: [] };
  const out = {};
  const removed = [];
  for (const [k, v] of Object.entries(env)) {
    if (globMatch(k, globs)) removed.push(k);
    else out[k] = v;
  }
  return { env: out, removed };
}

export async function runExec({ policy, argv, quiet = false, gate }) {
  gate = gate ?? new Gate(policy);
  // One argument containing spaces is treated as a shell string.
  const shellString = argv.length === 1 && /\s|[;&|<>$`]/.test(argv[0]);
  const outcome = await gate.check(shellString ? { kind: 'shell', command: argv[0] } : { kind: 'shell', argv }, { source: 'exec' });
  const r = outcome.result;
  if (!quiet || !outcome.allowed) {
    log(c.dim('[blastgate]'), badge(outcome.approval ? outcome.decision : r.decision), c.bold(r.action.command), c.dim(r.rule ? `[${r.rule}] ${r.reason}` : ''));
  }
  if (!outcome.allowed) {
    log(c.red(denialText(outcome)));
    return 126;
  }
  const { env, removed } = scrubEnv(process.env, policy.exec.env_strip);
  if (removed.length && !quiet) log(c.dim(`[blastgate] stripped ${removed.length} env var(s): ${removed.join(', ')}`));
  const child = shellString
    ? spawn(process.env.SHELL || '/bin/sh', ['-c', argv[0]], { stdio: 'inherit', env })
    : spawn(argv[0], argv.slice(1), { stdio: 'inherit', env });
  const t0 = Date.now();
  let timer = null;
  if (policy.exec.timeout_seconds > 0) {
    timer = setTimeout(() => {
      log(c.red(`[blastgate] timeout after ${policy.exec.timeout_seconds}s, killing process`));
      child.kill('SIGTERM');
    }, policy.exec.timeout_seconds * 1000);
  }
  return new Promise((resolve) => {
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      log(c.red(`[blastgate] could not start "${argv[0]}": ${e.message}`));
      resolve(127);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      gate.record({ type: 'execution', source: 'exec', command: r.action.command, exit_code: code, signal, duration_ms: Date.now() - t0 });
      resolve(signal ? 128 + 15 : (code ?? 0));
    });
  });
}
