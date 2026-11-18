// Append-only, hash-chained, Ed25519-signed audit log (JSON Lines).
//
// Each entry carries the SHA-256 of the previous entry, so deleting,
// reordering or editing any line breaks the chain from that point on.
// Each entry's hash is signed with a local Ed25519 key, so an entry
// cannot be forged without the private key. Verify against a public key
// you trust (keep a copy off the machine the agent runs on).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { stableStringify } from './engine.js';

export const GENESIS = '0'.repeat(64);
const SECRET_KEY_RE = /pass(word)?|secret|token|api[_-]?key|auth|credential|private[_-]?key|cookie|session/i;
const MAX_STR = 512;

export function keyDir() {
  return process.env.BLASTGATE_HOME ? path.join(process.env.BLASTGATE_HOME, 'keys') : path.join(os.homedir(), '.blastgate', 'keys');
}

/** Load the local signing key, creating it (0600) on first use. */
export function loadOrCreateKey(dir = keyDir()) {
  const priv = path.join(dir, 'ed25519.pem');
  const pub = path.join(dir, 'ed25519.pub.pem');
  if (!fs.existsSync(priv)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  }
  const privateKey = createPrivateKey(fs.readFileSync(priv));
  const publicKey = createPublicKey(fs.readFileSync(pub));
  return { privateKey, publicKey, kid: keyId(publicKey), pubPath: pub };
}

export function keyId(publicKey) {
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
}

/** Redact secret-looking keys and truncate long strings before logging. */
export function redact(value, depth = 0) {
  if (depth > 16) return '[depth]';
  if (typeof value === 'string') return value.length > MAX_STR ? `${value.slice(0, MAX_STR)}...[+${value.length - MAX_STR} chars]` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export function entryHash(entry) {
  const { hash, sig, ...body } = entry;
  // Round-trip through JSON so the hash covers exactly what is written to disk.
  return createHash('sha256').update(stableStringify(JSON.parse(JSON.stringify(body)))).digest('hex');
}

function readLastLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return null;
    const chunk = Math.min(size, 1 << 16);
    const buf = Buffer.alloc(chunk);
    fs.readSync(fd, buf, 0, chunk, size - chunk);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } finally {
    fs.closeSync(fd);
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(file, fn) {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 5000) { fs.rmSync(lock, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() - start > 10000) throw new Error(`audit log is locked: ${lock}`);
      sleepSync(5);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

export class AuditLog {
  constructor(file, { key = null, enabled = true } = {}) {
    this.file = path.resolve(file);
    this.enabled = enabled;
    this.key = enabled ? (key ?? loadOrCreateKey()) : null;
    if (enabled) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  /** Append one event. Safe across processes sharing the same file. */
  append(event) {
    if (!this.enabled) return null;
    return withLock(this.file, () => {
      let prev = GENESIS;
      let seq = 0;
      if (fs.existsSync(this.file)) {
        const last = readLastLine(this.file);
        if (last) {
          const parsed = JSON.parse(last);
          prev = parsed.hash;
          seq = parsed.seq + 1;
        }
      }
      const entry = { v: 1, seq, ts: new Date().toISOString(), kid: this.key.kid, prev, ...redact(event) };
      entry.hash = entryHash(entry);
      entry.sig = sign(null, Buffer.from(entry.hash, 'hex'), this.key.privateKey).toString('base64');
      fs.appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      return entry;
    });
  }
}

/** Verify chain + signatures. Returns { ok, entries, errors: [{ line, error }] }. */
export function verifyLog(file, publicKeyPem) {
  const publicKey = createPublicKey(publicKeyPem);
  const kid = keyId(publicKey);
  const errors = [];
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let prev = GENESIS;
  let expectSeq = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    let e;
    try { e = JSON.parse(line); } catch { errors.push({ line: n, error: 'not valid JSON' }); prev = null; return; }
    if (e.seq !== expectSeq) errors.push({ line: n, error: `sequence gap: expected ${expectSeq}, found ${e.seq}` });
    if (prev !== null && e.prev !== prev) errors.push({ line: n, error: 'chain broken: prev hash does not match the line before' });
    const h = entryHash(e);
    if (h !== e.hash) errors.push({ line: n, error: 'content hash mismatch: this line was edited' });
    if (e.kid !== kid) errors.push({ line: n, error: `signed by a different key (${e.kid})` });
    else {
      let good = false;
      try { good = verify(null, Buffer.from(e.hash, 'hex'), publicKey, Buffer.from(e.sig ?? '', 'base64')); } catch { good = false; }
      if (!good) errors.push({ line: n, error: 'bad signature' });
    }
    prev = e.hash;
    expectSeq = (typeof e.seq === 'number' ? e.seq : expectSeq) + 1;
  });
  return { ok: errors.length === 0, entries: lines.length, errors };
}
