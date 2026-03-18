import { hasTTY, ansi } from './common.js';

const count = Number(process.argv[2] || 400);
const palette = [ansi.red, ansi.green, ansi.yellow, ansi.blue, ansi.magenta, ansi.cyan];
const prefix = hasTTY ? 'spill line' : 'spill fallback line';
for (let i = 0; i < count; i++) {
  const line = `${prefix} ${i + 1}`;
  if (hasTTY) console.log(`${palette[i % palette.length]}${line}\x1b[0m`);
  else console.log(line);
}
