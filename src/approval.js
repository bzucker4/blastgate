// Human-in-the-loop approval channels. Every channel fails closed:
// a timeout, a missing terminal or a webhook error is a denial.

import fs from 'node:fs';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { c } from './ui.js';

function summarize(action) {
  if (action.kind === 'shell') return `$ ${action.command}`;
  const args = JSON.stringify(action.args ?? {});
  return `${action.server ? `${action.server}/` : ''}${action.tool} ${args.length > 300 ? `${args.slice(0, 300)}...` : args}`;
}

function ttyApprove(request, timeoutMs) {
  return new Promise((resolve) => {
    let fd;
    try { fd = fs.openSync('/dev/tty', 'r+'); } catch {
      resolve({ approved: false, by: 'tty', note: 'no terminal available for approval; denied' });
      return;
    }
    const input = fs.createReadStream(null, { fd, autoClose: false });
    const output = fs.createWriteStream(null, { fd, autoClose: false });
    const rl = readline.createInterface({ input, output, terminal: false });
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rl.close();
      input.destroy();
      try { fs.closeSync(fd); } catch { /* already closed */ }
      resolve(res);
    };
    const timer = setTimeout(() => {
      output.write(`\n${c.red('  timed out, denied')}\n`);
      finish({ approved: false, by: 'tty', note: `no answer within ${timeoutMs / 1000}s; denied` });
    }, timeoutMs);
    output.write(
      `\n${c.yellow(c.bold('  blastgate: approval required'))}  ${c.dim(`[${request.rule}]`)}\n` +
      `  ${request.summary}\n  ${c.dim(request.reason)}\n` +
      `  ${c.bold('Allow this action? [y/N] ')}`,
    );
    rl.once('line', (line) => {
      const yes = /^\s*y(es)?\s*$/i.test(line);
      finish({ approved: yes, by: 'tty', note: yes ? 'approved at terminal' : 'denied at terminal' });
    });
    rl.once('close', () => finish({ approved: false, by: 'tty', note: 'terminal closed; denied' }));
  });
}

async function webhookApprove(request, url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'blastgate' },
      body: JSON.stringify(request),
      signal: ctrl.signal,
    });
    if (!res.ok) return { approved: false, by: 'webhook', note: `webhook returned HTTP ${res.status}; denied` };
    const body = await res.json().catch(() => ({}));
    return { approved: body.approved === true, by: body.by ? `webhook:${body.by}` : 'webhook', note: body.note ?? (body.approved === true ? 'approved via webhook' : 'denied via webhook') };
  } catch (e) {
    return { approved: false, by: 'webhook', note: e.name === 'AbortError' ? `webhook timed out after ${timeoutMs / 1000}s; denied` : `webhook error (${e.message}); denied` };
  } finally {
    clearTimeout(timer);
  }
}

/** Ask for approval. Resolves { approved, by, note, id }. */
export async function requestApproval(policy, result) {
  const channel = process.env.BLASTGATE_APPROVAL || policy.approval.channel;
  const timeoutMs = policy.approval.timeout_seconds * 1000;
  const request = {
    id: randomUUID(),
    policy: policy.name,
    rule: result.rule,
    reason: result.reason,
    message: result.message,
    summary: summarize(result.action),
    action: { kind: result.action.kind, server: result.action.server, tool: result.action.tool, command: result.action.command, args: result.action.args },
    requested_at: new Date().toISOString(),
  };
  let res;
  if (channel === 'auto-approve') res = { approved: true, by: 'auto-approve', note: 'auto-approved by configuration' };
  else if (channel === 'auto-deny') res = { approved: false, by: 'auto-deny', note: 'approval required; auto-deny is configured' };
  else if (channel === 'webhook') res = await webhookApprove(request, policy.approval.webhook_url, timeoutMs);
  else if (channel === 'tty') res = await ttyApprove(request, timeoutMs);
  else res = { approved: false, by: channel, note: `unknown approval channel "${channel}"; denied` };
  return { ...res, id: request.id };
}
