const enabled = () => !process.env.NO_COLOR && (process.env.FORCE_COLOR || process.stderr.isTTY);
const wrap = (open, close) => (s) => (enabled() ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

export function badge(decision) {
  if (decision === 'allow') return c.green(c.bold('ALLOW  '));
  if (decision === 'deny') return c.red(c.bold('DENY   '));
  if (decision === 'approve') return c.yellow(c.bold('APPROVE'));
  return decision;
}

export function log(...parts) {
  process.stderr.write(`${parts.join(' ')}\n`);
}
