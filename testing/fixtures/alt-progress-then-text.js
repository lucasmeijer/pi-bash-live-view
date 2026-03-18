import { hasTTY, logPlain, ansi, color } from './common.js';

if (!hasTTY) {
  logPlain('alt fallback progress 0', 'alt fallback progress 1', 'back on normal screen', 'post-alt text');
  process.exit(0);
}

process.stdout.write('\x1b[?1049h');
let i = 0;
const timer = setInterval(() => {
  process.stdout.write(`\r${ansi.bold}${ansi.cyan}alt progress${ansi.reset} ${color(ansi.yellow, String(i++))}`);
}, 80);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write('\x1b[?1049l');
  process.stdout.write(`${color(ansi.green, 'back on normal screen')}\n${color(ansi.magenta, 'post-alt text')}\n`);
}, 800);
