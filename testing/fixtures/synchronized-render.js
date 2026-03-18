import { hasTTY, logPlain, ansi, color } from './common.js';

if (!hasTTY) {
  logPlain('sync fallback A', 'sync fallback B', 'sync fallback C', 'done');
  process.exit(0);
}

function burst(label) {
  process.stdout.write('\x1b[?2026h');
  process.stdout.write(`\r${ansi.red}${label} A${ansi.reset}`);
  process.stdout.write(`\r${ansi.yellow}${label} B${ansi.reset}`);
  process.stdout.write(`\r${ansi.green}${label} C${ansi.reset}\n`);
  process.stdout.write('\x1b[?2026l');
}

burst('sync-1');
setTimeout(() => burst('sync-2'), 200);
setTimeout(() => process.stdout.write(`${color(ansi.cyan, 'done')}\n`), 450);
