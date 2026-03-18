import { hasTTY, logPlain } from './common.js';

if (!hasTTY) {
  logPlain('alt fallback progress 0', 'alt fallback progress 1', 'back on normal screen', 'post-alt text');
  process.exit(0);
}

process.stdout.write('\x1b[?1049h');
let i = 0;
const timer = setInterval(() => {
  process.stdout.write(`\ralt progress ${i++}`);
}, 80);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write('\x1b[?1049l');
  process.stdout.write('back on normal screen\npost-alt text\n');
}, 800);
