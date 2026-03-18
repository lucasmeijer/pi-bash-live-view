import { hasTTY, logPlain, ansi, color } from './common.js';

if (!hasTTY) {
  logPlain('alt-only fallback: no alternate screen available');
  process.exit(0);
}

process.stdout.write(`\x1b[?1049h${ansi.bold}${color(ansi.cyan, 'ALT ONLY')}\n`);
setTimeout(() => process.stdout.write('\x1b[?1049l'), 200);
