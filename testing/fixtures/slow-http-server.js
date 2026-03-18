import http from 'node:http';

const port = Number(process.argv[2] || 18765);
const totalBytes = Number(process.argv[3] || 240000);
const chunkBytes = Number(process.argv[4] || 12000);
const intervalMs = Number(process.argv[5] || 350);

const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(totalBytes),
    'Cache-Control': 'no-store',
  });

  let sent = 0;
  const timer = setInterval(() => {
    if (sent >= totalBytes) {
      clearInterval(timer);
      res.end();
      return;
    }
    const size = Math.min(chunkBytes, totalBytes - sent);
    sent += size;
    res.write(Buffer.alloc(size, sent % 255));
  }, intervalMs);

  res.on('close', () => clearInterval(timer));
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`ready:${port}\n`);
});
