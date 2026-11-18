// Library entry point: use Blastgate inside your own agent loop.
//
//   import { loadPolicy, Gate } from 'blastgate';
//   const gate = new Gate(loadPolicy('./blastgate.yaml'));
//   const { allowed, result } = await gate.check({ kind: 'shell', command: 'rm -rf /' });

export { parseYaml } from './yaml.js';
export { loadPolicy, parsePolicy, validatePolicy, PolicyError } from './policy.js';
export { Engine, normalizeAction, matchRule } from './engine.js';
export { Gate, denialText } from './gate.js';
export { AuditLog, verifyLog, loadOrCreateKey } from './audit.js';
export { destructiveSql, destructiveShell, shellSegments } from './match.js';
export { runMcpProxy } from './mcp-proxy.js';
