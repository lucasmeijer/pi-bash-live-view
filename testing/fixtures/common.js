export const hasTTY = Boolean(process.stdout.isTTY);

export function logPlain(...lines) {
  for (const line of lines) process.stdout.write(`${line}\n`);
}

export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

export function color(code, text) {
  return `${code}${text}${ansi.reset}`;
}
