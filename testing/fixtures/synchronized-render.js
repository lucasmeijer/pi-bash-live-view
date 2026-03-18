import { hasTTY, logPlain } from './common.js';

if (!hasTTY) {
  logPlain('sync fallback A', 'sync fallback B', 'sync fallback C', 'done');
  process.exit(0);
}

function burst(label) {
  process.stdout.write('\x1b[?2026h');
  process.stdout.write(`\r${label} A`);
  process.stdout.write(`\r${label} B`);
  process.stdout.write(`\r${label} C\n`);
  process.stdout.write('\x1b[?2026l');
}

burst('sync-1');
setTimeout(() => burst('sync-2'), 200);
setTimeout(() => process.stdout.write('done\n'), 450);
