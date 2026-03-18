import { hasTTY, logPlain } from './common.js';

if (!hasTTY) {
  logPlain('spinner fallback start', 'spinner fallback end', 'final line one', 'final line two');
  process.exit(0);
}

let i = 0;
const frames = ['|', '/', '-', '\\'];
const timer = setInterval(() => {
  process.stdout.write(`\rspinner ${frames[i++ % frames.length]}`);
}, 80);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write('\rspinner done\nfinal line one\nfinal line two\n');
}, 1200);
