#!/usr/bin/env node
// Renders `blastgate demo --fast` output into an animated terminal SVG
// (docs/demo.svg) for the README. Re-run after changing the demo:
//   node scripts/render-demo-svg.js

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'blastgate.js'), 'demo', '--fast'], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '' } });
if (res.status !== 0) { console.error(res.stdout, res.stderr); process.exit(1); }
const tmpDir = /demo files left in (\S+)/.exec(res.stdout.replace(/\x1b\[[0-9;]*m/g, ''))?.[1];
if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

const lines = ['$ npx blastgate demo', ...res.stdout.split('\n').filter((l) => !l.includes('demo files left in'))];
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

const COLORS = { 31: '#f38ba8', 32: '#a6e3a1', 33: '#f9e2af', 34: '#89b4fa', 35: '#cba6f7', 36: '#89dceb', 90: '#7f849c' };
const FG = '#cdd6f4';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function spans(line) {
  let color = null; let bold = false; let dim = false;
  const out = [];
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      const code = Number(m[1]);
      if (code === 1) bold = true; else if (code === 22) { bold = false; dim = false; } else if (code === 2) dim = true;
      else if (code === 39) color = null; else if (COLORS[code]) color = COLORS[code];
      continue;
    }
    if (!part) continue;
    const attrs = [`fill="${color ?? FG}"`];
    if (bold) attrs.push('font-weight="700"');
    if (dim) attrs.push('opacity="0.6"');
    out.push(`<tspan ${attrs.join(' ')}>${esc(part)}</tspan>`);
  }
  return out.join('');
}

const lineH = 20; const charW = 8.4; const padX = 20; const padTop = 44;
const cols = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length));
const width = Math.ceil(cols * charW + padX * 2);
const height = padTop + lines.length * lineH + 20;
const step = 0.32; const hold = 5;
const total = lines.length * step + hold;
const css = lines.map((_, i) => {
  const on = ((i * step) / total) * 100;
  return `@keyframes l${i}{0%,${on.toFixed(2)}%{opacity:0}${(on + 0.5).toFixed(2)}%,97%{opacity:1}100%{opacity:0}} .l${i}{animation:l${i} ${total.toFixed(2)}s infinite}`;
}).join('\n');

const body = lines.map((l, i) => `<text class="l${i}" x="${padX}" y="${padTop + (i + 1) * lineH - 6}">${spans(i === 0 ? `\x1b[32m$\x1b[39m npx blastgate demo` : l)}</text>`).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
<style>${css}</style>
<rect width="100%" height="100%" rx="10" fill="#1e1e2e"/>
<circle cx="22" cy="20" r="6" fill="#f38ba8"/><circle cx="42" cy="20" r="6" fill="#f9e2af"/><circle cx="62" cy="20" r="6" fill="#a6e3a1"/>
<text x="${width / 2}" y="24" text-anchor="middle" fill="#7f849c" font-size="12">blastgate demo</text>
${body}
</svg>
`;
fs.writeFileSync(path.join(ROOT, 'docs', 'demo.svg'), svg);
console.log(`wrote docs/demo.svg (${lines.length} lines, ${width}x${height})`);
