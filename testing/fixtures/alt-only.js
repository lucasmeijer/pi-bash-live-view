import { hasTTY, logPlain } from './common.js';

if (!hasTTY) {
  logPlain('alt-only fallback: no alternate screen available');
  process.exit(0);
}

process.stdout.write('\x1b[?1049hALT ONLY\n');
setTimeout(() => process.stdout.write('\x1b[?1049l'), 200);
