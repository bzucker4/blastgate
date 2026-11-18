// Minimal, dependency-free YAML subset parser for Blastgate policy files.
//
// Supported: block maps, block lists (including lists of maps), flow lists
// ([a, "b"]), empty flow maps ({}), single and double quoted strings,
// numbers, booleans, null, and # comments. Anchors, tags, multi-document
// streams and block scalars (| and >) are intentionally NOT supported:
// policy files should stay boring and easy to review.

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `YAML line ${line}: ${message}` : `YAML: ${message}`);
    this.line = line;
  }
}

function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#'"\-\[\]{},][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:\s+(.*)|$)/;

function matchKey(text) {
  const m = KEY_RE.exec(text);
  if (!m) return null;
  let key = m[1];
  if (key.startsWith('"')) key = JSON.parse(key);
  else if (key.startsWith("'")) key = key.slice(1, -1).replace(/''/g, "'");
  return [key, (m[2] ?? '').trim()];
}

function splitFlow(inner, line) {
  const items = [];
  let buf = '';
  let quote = null;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      buf += c;
      if (c === '\\' && quote === '"') { buf += inner[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { items.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (quote) throw new YamlError('unterminated string in flow list', line);
  if (buf.trim()) items.push(buf.trim());
  return items;
}

export function parseScalar(text, line) {
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new YamlError('unterminated flow list', line);
    return splitFlow(text.slice(1, -1), line).map((t) => parseScalar(t, line));
  }
  if (text.startsWith('{')) {
    if (text.replace(/\s/g, '') === '{}') return {};
    if (!text.endsWith('}')) throw new YamlError('unterminated flow map', line);
    const out = {};
    for (const part of splitFlow(text.slice(1, -1), line)) {
      const kv = matchKey(part);
      if (!kv) throw new YamlError(`bad flow map entry "${part}"`, line);
      out[kv[0]] = kv[1] === '' ? null : parseScalar(kv[1], line);
    }
    return out;
  }
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw new YamlError('bad double-quoted string', line);
    return JSON.parse(text);
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw new YamlError('bad single-quoted string', line);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^(null|Null|NULL|~)$/.test(text)) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^[|>][+-]?$/.test(text)) throw new YamlError('block scalars (| and >) are not supported', line);
  if (/^[&*!]/.test(text)) throw new YamlError('anchors, aliases and tags are not supported', line);
  return text;
}

export function parseYaml(src) {
  const lines = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const lead = raw.match(/^[ \t]*/)[0];
    const body = stripComment(raw);
    if (!body.trim()) return;
    if (lead.includes('\t')) throw new YamlError('tabs are not allowed for indentation', i + 1);
    if (body.trim() === '---' && lines.length === 0) return;
    lines.push({ indent: lead.length, text: body.trim(), line: i + 1 });
  });
  if (lines.length === 0) return null;
  let pos = 0;

  const isItem = (l) => l.text === '-' || l.text.startsWith('- ');

  function parseBlock() {
    const first = lines[pos];
    if (isItem(first)) return parseList(first.indent);
    if (!matchKey(first.text)) {
      pos++;
      return parseScalar(first.text, first.line);
    }
    return parseMap(first.indent);
  }

  function parseList(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos])) {
      const ln = lines[pos];
      const after = ln.text === '-' ? '' : ln.text.slice(2);
      const rest = after.trim();
      if (!rest) {
        pos++;
        out.push(pos < lines.length && lines[pos].indent > indent ? parseBlock() : null);
        continue;
      }
      if (matchKey(rest) && !/^["'\[{]/.test(rest)) {
        const childIndent = indent + 2 + (after.length - after.trimStart().length);
        lines[pos] = { indent: childIndent, text: rest, line: ln.line };
        out.push(parseMap(childIndent));
      } else {
        out.push(parseScalar(rest, ln.line));
        pos++;
      }
    }
    return out;
  }

  function parseMap(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos])) {
      const ln = lines[pos];
      const kv = matchKey(ln.text);
      if (!kv) throw new YamlError(`expected "key: value", got "${ln.text}"`, ln.line);
      const [key, val] = kv;
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(`duplicate key "${key}"`, ln.line);
      pos++;
      if (val === '') {
        const next = lines[pos];
        if (next && (next.indent > indent || (next.indent === indent && isItem(next)))) out[key] = parseBlock();
        else out[key] = null;
      } else {
        out[key] = parseScalar(val, ln.line);
      }
    }
    if (pos < lines.length && lines[pos].indent > indent) {
      throw new YamlError('unexpected indentation', lines[pos].line);
    }
    return out;
  }

  const result = parseBlock();
  if (pos < lines.length) throw new YamlError('unexpected content', lines[pos].line);
  return result;
}
