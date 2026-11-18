// Deterministic matchers and built-in detectors. No network, no models,
// no randomness: the same action and policy always give the same answer.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const globCache = new Map();

/** Glob to anchored, case-insensitive RegExp. Supports * and ?. */
export function globToRegExp(glob) {
  let re = globCache.get(glob);
  if (re) return re;
  const body = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[\\s\\S]*')
    .replace(/\?/g, '[\\s\\S]');
  re = new RegExp(`^${body}$`, 'i');
  globCache.set(glob, re);
  return re;
}

export function globMatch(value, globs) {
  if (value === undefined || value === null) return false;
  const list = Array.isArray(globs) ? globs : [globs];
  return list.some((g) => globToRegExp(g).test(String(value)));
}

const regexCache = new Map();
/** Compile a policy regex. A leading (?i) turns on case-insensitive mode. */
export function compileRegex(src) {
  let re = regexCache.get(src);
  if (re) return re;
  let flags = '';
  let body = String(src);
  if (body.startsWith('(?i)')) { flags = 'i'; body = body.slice(4); }
  re = new RegExp(body, flags);
  regexCache.set(src, re);
  return re;
}

/** Every string found anywhere inside a value (deep). */
export function collectStrings(value, out = [], depth = 0) {
  if (depth > 32 || value === null || value === undefined) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out, depth + 1));
  else if (typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out, depth + 1));
  return out;
}

/** Read a dotted path (a.b.0.c) from an object. */
export function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);
}

// ---------------------------------------------------------------- shell

/** Split a shell string into argv, honouring single/double quotes and backslashes. */
export function tokenize(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) { cur += cmd[++i]; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += cmd[++i]; has = true; continue; }
    if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
      continue;
    }
    cur += c;
    has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * Break a shell string into the individual commands it would run:
 * splits on ; && || | & and newlines, and pulls out $( ) and backtick
 * substitutions so "echo ok && rm -rf /" is seen as two commands.
 */
export function shellSegments(cmd) {
  const segments = [];
  const subs = [];
  const subRe = /\$\(([^()]*)\)|`([^`]*)`/g;
  let m;
  let work = String(cmd);
  // Repeat to unwrap nested substitutions from the inside out.
  for (let guard = 0; guard < 8 && subRe.test(work); guard++) {
    subRe.lastIndex = 0;
    work = work.replace(subRe, (_, a, b) => { subs.push(a ?? b); return ' __SUB__ '; });
  }
  for (const s of [work, ...subs]) {
    for (const part of s.split(/;|&&|\|\||\||&|\n/)) {
      const t = part.replace(/__SUB__/g, '').trim();
      if (t) segments.push(t);
    }
  }
  return segments;
}

const WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'time', 'nice', 'command', 'builtin', 'exec', 'xargs']);

/** Strip wrappers like sudo/env/nohup and leading VAR=x assignments. */
export function unwrapArgv(argv) {
  let i = 0;
  while (i < argv.length) {
    const t = argv[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) { i++; continue; }
    if (WRAPPERS.has(path.basename(t))) {
      i++;
      while (i < argv.length && argv[i].startsWith('-')) i++;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

function hasShortFlag(args, letters) {
  return args.some((a) => /^-[A-Za-z]+$/.test(a) && [...letters].some((l) => a.includes(l)));
}

/** Built-in detector for destructive shell commands. Returns a reason or null. */
export function destructiveShell(cmd) {
  for (const seg of shellSegments(cmd)) {
    const argv = unwrapArgv(tokenize(seg));
    if (argv.length === 0) continue;
    const bin = path.basename(argv[0]);
    const args = argv.slice(1);
    if (bin === 'rm') {
      const recursive = hasShortFlag(args, 'rR') || args.includes('--recursive');
      const force = hasShortFlag(args, 'f') || args.includes('--force');
      if (recursive && force) return `recursive force delete: ${seg}`;
      if (recursive && args.some((a) => a === '/' || a === '~' || a === '*' || a === '/*')) return `recursive delete of a root path: ${seg}`;
    }
    if (/^mkfs(\..+)?$/.test(bin)) return `filesystem format: ${seg}`;
    if (bin === 'dd' && args.some((a) => /^of=\/dev\//.test(a))) return `raw write to a device: ${seg}`;
    if (bin === 'shred' || bin === 'wipefs') return `secure erase: ${seg}`;
    if ((bin === 'chmod' || bin === 'chown') && hasShortFlag(args, 'R') && args.includes('/')) return `recursive permission change on /: ${seg}`;
    if (bin === 'git') {
      const sub = args.find((a) => !a.startsWith('-'));
      if (sub === 'push' && args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force') || a === '--mirror' || a === '--delete')) return `force/destructive git push: ${seg}`;
      if (sub === 'reset' && args.includes('--hard')) return `git reset --hard: ${seg}`;
      if (sub === 'clean' && hasShortFlag(args, 'f')) return `git clean -f: ${seg}`;
    }
    if (bin === 'find' && args.includes('-delete')) return `find -delete: ${seg}`;
    if ((bin === 'kubectl' || bin === 'helm') && args.includes('delete')) return `${bin} delete: ${seg}`;
    if (bin === 'terraform' && (args.includes('destroy') || (args.includes('apply') && args.includes('-auto-approve')))) return `terraform destroy/auto-approve: ${seg}`;
    if ((bin === 'curl' || bin === 'wget') && /\|\s*(ba|z|)sh\b/.test(cmd)) return `piping a download into a shell: ${cmd}`;
  }
  if (/:\(\)\s*\{\s*:\|:&\s*\};\s*:/.test(cmd)) return 'fork bomb';
  if (/>\s*\/dev\/(sd|nvme|disk|hd)/.test(cmd)) return 'redirect onto a block device';
  return null;
}

// ---------------------------------------------------------------- sql

function stripSql(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

const SQL_HINT = /\b(select|insert|update|delete|drop|truncate|alter|create|grant|revoke|merge)\b/i;

/** Built-in detector for destructive SQL. Returns a reason or null. */
export function destructiveSql(text) {
  if (!SQL_HINT.test(text)) return null;
  for (const raw of stripSql(text).split(';')) {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (/^drop\s+(table|database|schema|index|view|user|role|function|procedure|trigger|sequence)\b/i.test(s)) return `DROP statement: ${s}`;
    if (/^truncate\b/i.test(s)) return `TRUNCATE statement: ${s}`;
    if (/^alter\s+table\b.*\bdrop\b/i.test(s)) return `ALTER TABLE ... DROP: ${s}`;
    if (/^delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s)) return `DELETE without WHERE: ${s}`;
    if (/^update\b.*\bset\b/i.test(s) && !/\bwhere\b/i.test(s)) return `UPDATE without WHERE: ${s}`;
    if (/^(grant|revoke)\b/i.test(s)) return `privilege change: ${s}`;
    if (/\bwhere\s+(1\s*=\s*1|true|''\s*=\s*'')\s*$/i.test(s) && /^(delete|update)\b/i.test(s)) return `${s.split(' ')[0].toUpperCase()} with an always-true WHERE: ${s}`;
  }
  return null;
}

// ---------------------------------------------------------------- paths & urls

const PATH_KEYS = /^(path|paths|file|files|filename|filepath|file_path|dir|directory|target|destination|dest|src|source|cwd|output|out|notebook_path|root)$/i;

/** Paths an action touches: well-known arg keys plus path-looking shell tokens. */
export function extractPaths(action) {
  const out = [];
  const walk = (v, key, depth) => {
    if (depth > 16 || v === null || v === undefined) return;
    if (typeof v === 'string') { if (key && PATH_KEYS.test(key)) out.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k, depth + 1);
  };
  walk(action.args, null, 0);
  if (action.path) out.push(action.path);
  if (action.kind === 'shell' && action.command) {
    for (const seg of shellSegments(action.command)) {
      for (const tok of tokenize(seg)) {
        const t = tok.replace(/^[<>]+/, '').replace(/^[^=]+=(?=[/~.])/, '');
        if (/^(\/|~\/|~$|\.\.?\/|\.\.$|\.[A-Za-z0-9_-])/.test(t) || /^[\w.-]+\//.test(t)) out.push(t);
      }
    }
  }
  return out;
}

export function resolvePath(p, cwd) {
  let s = String(p);
  if (s === '~' || s.startsWith('~/')) s = path.join(os.homedir(), s.slice(1));
  if (s.startsWith('file://')) s = decodeURIComponent(new URL(s).pathname);
  const abs = path.resolve(cwd, s);
  // Resolve symlinks for the longest existing prefix so a link inside the
  // jail that points outside it is still caught.
  let probe = abs;
  const rest = [];
  while (probe !== path.dirname(probe)) {
    try {
      const real = fs.realpathSync(probe);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      rest.push(path.basename(probe));
      probe = path.dirname(probe);
    }
  }
  return abs;
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const NET_TOOLS = new Set(['curl', 'wget', 'http', 'https', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'rsync', 'telnet', 'ftp']);

const FLAG_WITH_VALUE = new Set(['-o', '--output', '-O', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '-X', '--request', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-F', '--form', '-T', '--upload-file', '-b', '--cookie', '-c', '--cookie-jar', '-i', '-p', '-P', '-l', '-w', '--write-out', '--output-document']);

const URL_RE = /\b(?:https?|wss?|ftp):\/\/([^\s/:?#"'<>]+)(?::\d+)?/gi;

/** Hostnames of every URL found anywhere in the action. */
export function extractDomains(action) {
  const hosts = new Set();
  const strings = collectStrings(action.args);
  if (action.command) strings.push(action.command);
  if (action.url) strings.push(action.url);
  for (const s of strings) {
    for (const m of s.matchAll(URL_RE)) hosts.add(m[1].toLowerCase().replace(/^.*@/, ''));
  }
  // Scheme-less targets of network tools: `curl evil.example`, `nc host 443`.
  if (action.kind === 'shell' && action.command) {
    for (const seg of shellSegments(action.command)) {
      const argv = unwrapArgv(tokenize(seg));
      if (!NET_TOOLS.has(path.basename(argv[0] ?? ''))) continue;
      const rest = argv.slice(1);
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (FLAG_WITH_VALUE.has(a)) { i++; continue; }
        if (a.startsWith('-') || a.includes('://')) continue;
        const host = a.replace(/^.*@/, '').split(/[/:]/)[0].toLowerCase();
        if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) hosts.add(host);
      }
    }
  }
  return [...hosts];
}
