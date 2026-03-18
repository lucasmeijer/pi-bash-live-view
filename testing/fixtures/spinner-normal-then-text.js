import { hasTTY, logPlain, ansi, color } from './common.js';

if (!hasTTY) {
  logPlain('spinner fallback start', 'spinner fallback end', 'final line one', 'final line two');
  process.exit(0);
}

let i = 0;
const frames = [
  color(ansi.cyan, '|'),
  color(ansi.yellow, '/'),
  color(ansi.magenta, '-'),
  color(ansi.green, '\\'),
];
const timer = setInterval(() => {
  process.stdout.write(`\r${ansi.bold}${ansi.blue}spinner${ansi.reset} ${frames[i++ % frames.length]}`);
}, 80);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write(`\r${color(ansi.green, 'spinner done')}\n${color(ansi.yellow, 'final line one')}\n${color(ansi.magenta, 'final line two')}\n`);
}, 1200);
