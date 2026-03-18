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
