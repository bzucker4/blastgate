import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadPolicy, resolvePolicyPath, BUILTIN_DIR, PolicyError } from './policy.js';
import { Engine } from './engine.js';
import { verifyLog, loadOrCreateKey, keyDir } from './audit.js';
import { runMcpProxy } from './mcp-proxy.js';
import { runExec } from './exec.js';
import { runClaudeCodeHook } from './hooks/claude-code.js';
import { runDemo } from './demo.js';
import { c, badge } from './ui.js';

const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version;

const HELP = `${c.bold('blastgate')} ${VERSION}  deterministic policy firewall and approval gate for MCP servers and CLI agents

${c.bold('Usage')}
  blastgate demo [--fast]                         20-second demo, no API keys
  blastgate init [--force]                        write ./blastgate.yaml
  blastgate mcp [--name N] [--quiet] -- <cmd...>  wrap a stdio MCP server
  blastgate exec -- <cmd...>                      check, then run a shell command
  blastgate check '<action json>'                 decide on one action (exit 0 allow, 1 deny, 2 approve)
  blastgate hook claude-code                      Claude Code PreToolUse hook (reads stdin)
  blastgate lint [file]                           validate a policy
  blastgate audit verify [file] [--pubkey pem]    verify chain + signatures
  blastgate audit tail [file] [-n 20]             show recent decisions
  blastgate audit head [file]                     print latest seq + hash (anchor it elsewhere)
  blastgate license                               when you need a commercial license

${c.bold('Global options')}
  --policy <file|name>   policy file, or a built-in name (default, demo)
  --shadow               log every decision but block nothing (try a policy safely)
                         lookup order: --policy, $BLASTGATE_POLICY, ./blastgate.yaml,
                         ~/.blastgate/policy.yaml, built-in "default"

${c.bold('Environment')}
  BLASTGATE_APPROVAL   override approval channel (tty | webhook | auto-deny | auto-approve)
  BLASTGATE_MODE       override policy mode (enforce | shadow); --shadow wins over it
  BLASTGATE_AUDIT      override audit log path
  BLASTGATE_HOME       key directory root (default ~/.blastgate)
  NO_COLOR             disable colors

Docs: https://github.com/bzucker4/blastgate`;

function parseArgs(argv) {
  const dash = argv.indexOf('--');
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const rest = dash === -1 ? [] : argv.slice(dash + 1);
  const flags = {};
  const pos = [];
  const valued = new Set(['policy', 'name', 'pubkey', 'n']);
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a.startsWith('--') || (a.startsWith('-') && a.length === 2)) {
      const key = a.replace(/^-+/, '');
      if (valued.has(key)) {
        if (head[i + 1] === undefined) throw new PolicyError(`${a} needs a value`);
        flags[key] = head[++i];
      } else flags[key] = true;
    } else pos.push(a);
  }
  return { flags, pos, rest };
}

function auditFileFor(flags, posFile) {
  if (posFile) return posFile;
  if (process.env.BLASTGATE_AUDIT) return process.env.BLASTGATE_AUDIT;
  const policy = loadPolicy(flags.policy);
  return path.resolve(policy.audit.path);
}

const LAYER = { 'claude-code': 'hook', mcp: 'proxy', exec: 'exec' };
const STRICTNESS = { deny: 2, approve: 1, allow: 0 };

/**
 * One display item per tool call. Decision entries that share a tool_use_id
 * (the Claude Code hook and the MCP proxy both checking the same call) are
 * shown once, at the first entry's position, as the strictest result. The
 * log itself keeps every entry.
 */
export function groupDecisions(entries) {
  const out = [];
  const byId = new Map();
  for (const e of entries) {
    const id = e.type === 'decision' && typeof e.tool_use_id === 'string' ? e.tool_use_id : null;
    const layer = LAYER[e.source] ?? e.source;
    if (id && byId.has(id)) {
      const item = byId.get(id);
      if (!item.layers.includes(layer)) item.layers.push(layer);
      if ((STRICTNESS[e.final] ?? 0) > (STRICTNESS[item.entry.final] ?? 0)) item.entry = e;
      continue;
    }
    const item = { entry: e, layers: [layer] };
    if (id) byId.set(id, item);
    out.push(item);
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const ch of process.stdin) chunks.push(ch);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv) {
  const [cmd, ...restArgv] = argv;
  const { flags, pos, rest } = parseArgs(restArgv);
  const load = (file = flags.policy) => loadPolicy(file, undefined, { mode: flags.shadow ? 'shadow' : undefined });

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;

    case '--version':
    case '-v':
    case 'version':
      console.log(VERSION);
      return 0;

    case 'demo':
      return runDemo({ fast: Boolean(flags.fast) });

    case 'init': {
      const target = path.resolve('blastgate.yaml');
      if (fs.existsSync(target) && !flags.force) {
        console.error(`blastgate.yaml already exists (use --force to overwrite)`);
        return 1;
      }
      fs.copyFileSync(path.join(BUILTIN_DIR, 'default.yaml'), target);
      const text = fs.readFileSync(target, 'utf8').replace(/^# Blastgate built-in default policy\.[\s\S]*?(?=\n# Precedence)/m, '# Blastgate policy. Docs: https://github.com/bzucker4/blastgate/blob/main/docs/policy.md\n').replace('name: default', 'name: project');
      fs.writeFileSync(target, text);
      console.log(`${c.green('created')} blastgate.yaml  ${c.dim('edit it, then: blastgate lint')}`);
      return 0;
    }

    case 'lint': {
      const policy = load(pos[0] ?? flags.policy);
      console.log(`${c.green('ok')} ${path.relative(process.cwd(), policy.file) || policy.file}: ${policy.rules.length} rules, default ${policy.default}, approvals via ${policy.approval.channel}${policy.mode === 'shadow' ? `, ${c.yellow('shadow mode (not enforced)')}` : ''}`);
      return 0;
    }

    case 'check': {
      const raw = pos[0] ?? (await readStdin());
      const input = JSON.parse(raw);
      const policy = loadPolicy(flags.policy);
      const r = new Engine(policy).evaluate(input);
      if (flags.json) console.log(JSON.stringify({ decision: r.decision, rule: r.rule, reason: r.reason, matched: r.matched }));
      else console.log(`${badge(r.decision)} ${r.rule ? c.bold(r.rule) : c.dim('(default)')} ${c.dim(r.reason)}`);
      return r.decision === 'allow' ? 0 : r.decision === 'deny' ? 1 : 2;
    }

    case 'mcp': {
      if (rest.length === 0) throw new PolicyError('usage: blastgate mcp [--name N] -- <server command> [args...]');
      const policy = load();
      return runMcpProxy({ policy, command: rest[0], args: rest.slice(1), name: flags.name, quiet: Boolean(flags.quiet) });
    }

    case 'exec': {
      const argvToRun = rest.length ? rest : pos;
      if (argvToRun.length === 0) throw new PolicyError('usage: blastgate exec -- <command> [args...]');
      const policy = load();
      return runExec({ policy, argv: argvToRun, quiet: Boolean(flags.quiet) });
    }

    case 'hook': {
      if (pos[0] !== 'claude-code') throw new PolicyError('usage: blastgate hook claude-code   (more hosts are on the roadmap)');
      let policy;
      try { policy = load(); } catch (e) {
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[blastgate] policy failed to load, failing closed: ${e.message}` } }));
        return 0;
      }
      const out = await runClaudeCodeHook({ policy, stdinText: await readStdin() });
      if (out) console.log(JSON.stringify(out));
      return 0;
    }

    case 'audit': {
      const sub = pos[0];
      if (sub === 'verify') {
        const file = auditFileFor(flags, pos[1]);
        const pubPath = flags.pubkey ?? path.join(keyDir(), 'ed25519.pub.pem');
        if (!fs.existsSync(file)) throw new PolicyError(`no audit log at ${file}`);
        if (!fs.existsSync(pubPath)) throw new PolicyError(`no public key at ${pubPath} (pass --pubkey)`);
        const res = verifyLog(file, fs.readFileSync(pubPath, 'utf8'));
        if (res.ok) {
          console.log(`${c.green('verified')} ${res.entries} entries in ${file}: chain intact, every signature valid`);
          return 0;
        }
        console.log(`${c.red('FAILED')} ${file}: ${res.errors.length} problem(s)`);
        for (const e of res.errors.slice(0, 50)) console.log(`  line ${e.line}: ${e.error}`);
        return 1;
      }
      if (sub === 'tail' || sub === 'head') {
        const file = auditFileFor(flags, pos[1]);
        if (!fs.existsSync(file)) throw new PolicyError(`no audit log at ${file}`);
        const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
        if (sub === 'head') {
          const last = JSON.parse(lines[lines.length - 1]);
          console.log(`seq=${last.seq} hash=${last.hash} kid=${last.kid} ts=${last.ts}`);
          return 0;
        }
        const n = Number(flags.n ?? 20);
        for (const item of groupDecisions(lines.slice(-n).map((l) => JSON.parse(l)))) {
          const e = item.entry;
          if (e.type === 'decision') {
            const what = e.action?.kind === 'shell' ? `$ ${e.action.command}` : `${e.action?.server ? `${e.action.server}/` : ''}${e.action?.tool}`;
            const shadow = e.mode === 'shadow' && e.decision !== 'allow' ? c.yellow(`(shadow: would ${e.decision}) `) : '';
            const via = item.layers.length > 1 ? c.dim(`via ${item.layers.join('+')} `) : '';
            console.log(`${c.dim(e.ts)} ${badge(e.final)} ${what} ${shadow}${via}${c.dim(e.rule ? `[${e.rule}]` : '')}`);
          } else {
            console.log(`${c.dim(e.ts)} ${c.gray(`${e.type}`)} ${c.dim(JSON.stringify({ ...e, v: undefined, seq: undefined, ts: undefined, kid: undefined, prev: undefined, hash: undefined, sig: undefined, type: undefined }))}`);
          }
        }
        return 0;
      }
      if (sub === 'key') {
        const k = loadOrCreateKey();
        console.log(`kid=${k.kid}\npublic key: ${k.pubPath}`);
        return 0;
      }
      throw new PolicyError('usage: blastgate audit verify|tail|head|key [file]');
    }

    case 'license':
      console.log(`Blastgate is AGPL-3.0. You can use it free, forever, for:
  - local development and CI on your own machines
  - internal use, as long as you do not offer modified versions to others over a network

You need a commercial license if you:
  - embed Blastgate in a proprietary product or agent platform
  - run a modified Blastgate as part of a hosted or multi-tenant service
  - cannot meet AGPL source-sharing obligations for any other reason

Commercial license, team policy sync, compliance exports and support:
  https://github.com/bzucker4/blastgate/blob/main/COMMERCIAL.md`);
      return 0;

    default:
      console.error(`unknown command "${cmd}". Run blastgate --help`);
      return 1;
  }
}

export { resolvePolicyPath };
