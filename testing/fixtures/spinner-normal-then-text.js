let i = 0;
const frames = ['|','/','-','\\'];
const timer = setInterval(() => {
  process.stdout.write(`\rspinner ${frames[i++ % frames.length]}`);
}, 80);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write('\rspinner done\nfinal line one\nfinal line two\n');
}, 1200);
