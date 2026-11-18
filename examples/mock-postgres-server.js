#!/usr/bin/env node
// A fake "Postgres + filesystem + http" MCP server over stdio for demos and
// tests. Nothing here touches a real database, disk or network: every tool
// just describes what it WOULD have done. Safe to point anything at.

import readline from 'node:readline';
import { appendFileSync } from 'node:fs';

const TOOLS = [
  { name: 'query_db', description: 'Run a SQL query against the (pretend) production database.', inputSchema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
  { name: 'write_file', description: 'Write a file (pretend).', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path'] } },
  { name: 'http_fetch', description: 'Fetch a URL (pretend).', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'run_shell', description: 'Run a shell command (pretend).', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const text = (t) => ({ content: [{ type: 'text', text: t }] });

function call(name, a = {}) {
  switch (name) {
    case 'query_db': return text(/^\s*select/i.test(a.sql ?? '') ? '5 rows: ada, grace, linus, margaret, ken' : `OK (pretend): ${a.sql}`);
    case 'write_file': return text(`wrote ${String(a.content ?? '').length} bytes to ${a.path} (pretend)`);
    case 'http_fetch': return text(`200 OK from ${a.url} (pretend)`);
    case 'run_shell': return text(`$ ${a.command}\n(pretend output)`);
    default: return null;
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  if (m.method === 'initialize') {
    out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock-postgres', version: '0.1.0' } } });
  } else if (m.method === 'tools/list') {
    out({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  } else if (m.method === 'tools/call') {
    if (process.env.MOCK_CALL_LOG) appendFileSync(process.env.MOCK_CALL_LOG, `${JSON.stringify(m.params)}\n`);
    const r = call(m.params?.name, m.params?.arguments);
    if (r) out({ jsonrpc: '2.0', id: m.id, result: r });
    else out({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } });
  } else if (m.method === 'ping') {
    out({ jsonrpc: '2.0', id: m.id, result: {} });
  } else {
    out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  }
});
