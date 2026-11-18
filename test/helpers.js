import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePolicy } from '../src/policy.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'blastgate.js');
export const SERVER = path.join(ROOT, 'examples', 'mock-postgres-server.js');

export function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blastgate-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function policy(yaml) {
  return parsePolicy(`version: 1\nname: t\n${yaml}`, 'test');
}
