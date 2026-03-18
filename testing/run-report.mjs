import fs from 'node:fs';
import path from 'node:path';
import { createBashTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from '@mariozechner/pi-coding-agent';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { chromium } from 'playwright';
import GIFEncoder from 'gifencoder';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { buildWidgetAnsiLines, createTerminalEmulator } from '../src/terminal-emulator.js';

const cwd = process.cwd();
const outDir = path.join(cwd, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

function defaultStyle() {
  return { fg: null, bold: false, dim: false };
}
function cloneStyle(style) {
  return { fg: style.fg, bold: style.bold, dim: style.dim };
}
function hexToRgb(hex) {
  const value = hex.replace(/^#/, '');
  if (value.length !== 6) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}
function styleToAnsi(style) {
  const codes = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.fg) {
    const rgb = hexToRgb(style.fg);
    if (rgb) codes.push(38, 2, rgb.r, rgb.g, rgb.b);
  }
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}
function applySgr(style, codes) {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) Object.assign(style, defaultStyle());
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 39) {
      style.fg = null;
    } else if (code === 38) {
      const mode = codes[i + 1];
      if (mode === 2 && i + 4 < codes.length) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        style.fg = `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      }
    }
  }
}
function svgAttrsForStyle(style) {
  let attrs = '';
  if (style.fg) attrs += ` fill="${style.fg}"`;
  if (style.bold) attrs += ' font-weight="700"';
  if (style.dim) attrs += ' opacity="0.75"';
  return attrs;
}
function escapeXml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}
function parseAnsiLineToSegments(line) {
  const segments = [];
  let style = defaultStyle();
  let text = '';
  let i = 0;
  const flush = () => {
    if (!text) return;
    segments.push({ text, style: cloneStyle(style) });
    text = '';
  };
  while (i < line.length) {
    if (line[i] === '\x1b' && line[i + 1] === '[') {
      const match = line.slice(i).match(/^\x1b\[([0-9;]*)m/);
      if (match) {
        flush();
        const codes = (match[1] ? match[1].split(';').map(Number) : [0]).filter((n) => !Number.isNaN(n));
        applySgr(style, codes);
        i += match[0].length;
        continue;
      }
    }
    text += line[i];
    i += 1;
  }
  flush();
  return segments;
}
async function ansiLinesToPng(lines, pngPath) {
  const fontSize = 18;
  const charWidth = 10.8;
  const lineHeight = 24;
  const padding = 18;
  const visibleWidth = Math.max(...lines.map((line) => stripAnsi(line).length), 1);
  const width = Math.ceil(padding * 2 + (visibleWidth + 1) * charWidth);
  const height = Math.ceil(padding * 2 + lines.length * lineHeight);
  const background = '#111111';
  const defaultColor = '#dddddd';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
  svg += `<rect width="100%" height="100%" fill="${background}"/>`;
  lines.forEach((line, row) => {
    const y = padding + (row + 1) * lineHeight - 6;
    let x = padding;
    svg += `<text xml:space="preserve" x="${x}" y="${y}" font-family="Menlo, Monaco, 'Courier New', monospace" font-size="${fontSize}" fill="${defaultColor}">`;
    for (const segment of parseAnsiLineToSegments(line)) {
      const attrs = svgAttrsForStyle(segment.style);
      svg += `<tspan x="${x}"${attrs}>${escapeXml(segment.text)}</tspan>`;
      x += segment.text.length * charWidth;
    }
    svg += `</text>`;
  });
  svg += `</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
}

async function runPty(command, name) {
  const cols = 100;
  const rows = 15;
  const startedAt = Date.now();
  const child = pty.spawn('/bin/bash', ['-lc', command], {
    name: 'xterm-256color', cols, rows, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  const terminalEmulator = createTerminalEmulator({ cols, rows, scrollback: 10_000 });
  const snapshots = [];
  await new Promise((resolve) => {
    child.onData((chunk) => {
      void terminalEmulator.consumeProcessStdout(chunk, { elapsedMs: Date.now() - startedAt }).then((frame) => {
        snapshots.push(frame);
      });
    });
    child.onExit(resolve);
  });
  await terminalEmulator.whenIdle();
  const truncation = truncateHead(terminalEmulator.getStrippedTextIncludingEntireScrollback(), DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
  terminalEmulator.dispose();
  const jsonPath = path.join(outDir, `${name}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ command, snapshots, truncation }, null, 2));
  return { command, snapshots, truncation, jsonPath };
}

async function runBuiltin(command) {
  const tool = createBashTool(cwd);
  return tool.execute('report', { command }, new AbortController().signal, () => {});
}

function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function readFixtureSource(command) {
  const match = command.match(/node\s+(testing\/fixtures\/[^\s]+)/);
  if (!match) return null;
  const filePath = path.join(cwd, match[1]);
  return {
    path: match[1],
    source: fs.readFileSync(filePath, 'utf8'),
  };
}

async function renderGif(name, snapshots) {
  const frameDir = path.join(outDir, `${name}-frames`);
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  const pngPaths = [];
  const sampled = snapshots.length ? snapshots : [{ elapsedMs: 0, snapshot: [[{ ch: '(no live frames)', style: defaultStyle() }]] }];
  const step = Math.max(1, Math.floor(sampled.length / 12));
  for (let i = 0; i < sampled.length; i += step) {
    const frame = sampled[i];
    const lines = buildWidgetAnsiLines({ title: 'Live terminal', snapshot: frame.snapshot, width: 84, rows: 15, elapsedMs: frame.elapsedMs });
    const pngPath = path.join(frameDir, `${String(pngPaths.length).padStart(3, '0')}.png`);
    await ansiLinesToPng(lines, pngPath);
    pngPaths.push(pngPath);
  }
  if (sampled.length > 0 && (sampled.length - 1) % step !== 0) {
    const frame = sampled.at(-1);
    const lines = buildWidgetAnsiLines({ title: 'Live terminal', snapshot: frame.snapshot, width: 84, rows: 15, elapsedMs: frame.elapsedMs });
    const pngPath = path.join(frameDir, `${String(pngPaths.length).padStart(3, '0')}.png`);
    await ansiLinesToPng(lines, pngPath);
    pngPaths.push(pngPath);
  }
  const gifPath = path.join(outDir, `${name}.gif`);
  const first = PNG.sync.read(fs.readFileSync(pngPaths[0]));
  const encoder = new GIFEncoder(first.width, first.height);
  const stream = encoder.createReadStream().pipe(fs.createWriteStream(gifPath));
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(180);
  encoder.setQuality(10);
  for (const pngPath of pngPaths) {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    encoder.addFrame(png.data);
  }
  encoder.finish();
  await new Promise((resolve) => stream.on('finish', resolve));
  return { gifPath, pngPaths };
}

function buildApiExplainerHtml() {
  const sharedApiExample = `import { createLiveWidgetRenderer } from '../src/live-widget-core.js';

const renderer = createLiveWidgetRenderer({
  cols: 100,
  rows: 15,
  scrollback: 10_000,
  title: 'Live terminal',
});

await renderer.push(chunk, { elapsedMs: 1250 });
await renderer.whenIdle();
const ansiLines = renderer.getRenderableAnsiLines({ width: 84 });
const finalText = renderer.finalizeText();
renderer.dispose();`;

  const liveWidgetExample = `const renderer = createLiveWidgetRenderer({ cols, rows, scrollback: CONFIG.scrollbackLines });

renderer.subscribe(() => {
  session.requestRender?.();
});

child.onData((chunk) => {
  void renderer.push(chunk, { elapsedMs: Date.now() - session.startedAt });
});

render(width) {
  return renderer.getRenderableAnsiLines({
    width,
    rows: session.rows,
    elapsedMs: Date.now() - session.startedAt,
  });
}

await renderer.whenIdle();
const fullText = renderer.finalizeText();`;

  const testExample = `const renderer = createLiveWidgetRenderer({ cols: 100, rows: 15, scrollback: 10_000 });
const snapshots = [];

child.onData((chunk) => {
  void renderer.push(chunk, { elapsedMs: Date.now() - startedAt }).then((frame) => {
    snapshots.push(frame);
  });
});

await renderer.whenIdle();
const truncation = truncateHead(renderer.finalizeText(), DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
const gifLines = buildWidgetAnsiLines({
  title: 'Live terminal',
  snapshot: snapshots[0].snapshot,
  width: 84,
  rows: 15,
  elapsedMs: snapshots[0].elapsedMs,
});`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reusable live widget API</title>
  <style>
    :root{color-scheme:dark}
    body{font-family:Inter,system-ui,sans-serif;background:#0f1115;color:#eef2ff;margin:0;padding:32px;line-height:1.45}
    h1,h2,h3{margin:0 0 12px}
    p{color:#c8d2f0}
    .hero{padding:24px;border:1px solid #293048;border-radius:16px;background:linear-gradient(180deg,#151a24,#10141c);margin-bottom:24px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
    .card{border:1px solid #2a3247;border-radius:16px;padding:20px;background:#131826}
    .flow{display:grid;grid-template-columns:1fr 120px 1fr;gap:16px;align-items:center;margin:24px 0}
    .arrow{font-size:32px;text-align:center;color:#79b8ff}
    code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    pre{background:#0b0f17;border:1px solid #222a3d;border-radius:12px;padding:16px;overflow:auto;color:#d8e1ff}
    ul{margin:0;padding-left:20px;color:#c8d2f0}
    .pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#1f2a40;color:#8ecaff;font-size:12px;margin-right:8px}
    .api-table{width:100%;border-collapse:collapse;margin-top:12px}
    .api-table td,.api-table th{border-top:1px solid #263047;padding:10px 12px;vertical-align:top;text-align:left}
    .mini{font-size:13px;color:#9eb0d8}
    .stack{display:flex;flex-direction:column;gap:16px}
  </style>
</head>
<body>
  <div class="hero">
    <div class="pill">shared core</div><div class="pill">xterm-backed</div><div class="pill">used by runtime + report</div>
    <h1>Reusable live widget API</h1>
    <p>The test/report path and the live pi widget now share the same terminal-state component: <code>createLiveWidgetRenderer()</code>. That component owns xterm-headless state, synchronized-render snapshot locking, final transcript derivation, and ANSI widget-line generation.</p>
  </div>

  <div class="flow">
    <div class="card"><h3>Live widget in <code>index.ts</code></h3><p>Uses the shared renderer for incoming PTY data, subscribes to completed updates, requests pi re-renders, and asks the renderer for bordered ANSI lines at paint time.</p></div>
    <div class="arrow">⇄</div>
    <div class="card"><h3>Report/tests in <code>testing/run-report.mjs</code></h3><p>Uses the same renderer for incoming PTY data, stores frame snapshots for GIFs, and uses the same final transcript and widget-line logic for artifacts.</p></div>
  </div>

  <div class="grid">
    <div class="card stack">
      <div>
        <h2>Core constructor</h2>
        <pre>${esc(sharedApiExample)}</pre>
      </div>
      <div>
        <h3>API surface</h3>
        <table class="api-table">
          <tr><th>Method</th><th>Purpose</th></tr>
          <tr><td><code>push(chunk, { elapsedMs })</code></td><td>Feeds raw PTY bytes into xterm-headless, updates transcript state, honors alt-screen exclusion, and resolves with a renderable frame payload.</td></tr>
          <tr><td><code>whenIdle()</code></td><td>Waits for all queued xterm writes to finish before finalizing text or ending a test capture.</td></tr>
          <tr><td><code>subscribe(listener)</code></td><td>Receives completed-frame notifications; the live widget uses this to call <code>tui.requestRender()</code>.</td></tr>
          <tr><td><code>getRenderableSnapshot()</code></td><td>Returns the current safe snapshot, reusing the last completed one during synchronized render locks.</td></tr>
          <tr><td><code>getRenderableAnsiLines({ width, rows, elapsedMs })</code></td><td>Builds the bordered <code>Live terminal</code> widget exactly the way both runtime and report expect to consume it.</td></tr>
          <tr><td><code>finalizeText()</code></td><td>Returns the plain-text tool result that excludes alt-screen-only content and collapses repaint/spinner updates.</td></tr>
          <tr><td><code>dispose()</code></td><td>Disposes xterm resources and listeners.</td></tr>
        </table>
      </div>
    </div>

    <div class="card stack">
      <div>
        <h2>Why this matters</h2>
        <ul>
          <li>One terminal-state implementation now powers both human-visible review artifacts and the real live widget.</li>
          <li>Synchronized updates are handled in one place, so tests and runtime agree about “last completed snapshot” behavior.</li>
          <li>The report is no longer a separate prototype rendering path; it exercises the same shared component used by runtime.</li>
        </ul>
      </div>
      <div>
        <h3>Frame payload returned by <code>push()</code></h3>
        <pre>{
  elapsedMs: 1250,
  snapshot: SnapshotCell[][],
  inAltScreen: false,
  inSyncRender: false
}</pre>
        <p class="mini">The tests keep these payloads for GIF generation. The live widget mostly ignores the payload body and instead triggers a repaint, then asks the renderer for fresh ANSI lines at actual render time.</p>
      </div>
    </div>
  </div>

  <div class="grid" style="margin-top:20px">
    <div class="card">
      <h2>How the live widget uses it</h2>
      <pre>${esc(liveWidgetExample)}</pre>
    </div>
    <div class="card">
      <h2>How the tests/report use it</h2>
      <pre>${esc(testExample)}</pre>
    </div>
  </div>
</body>
</html>`;
}

const cases = [
  ['spill', `node testing/fixtures/spill.js 240`],
  ['spinner-normal-then-text', `node testing/fixtures/spinner-normal-then-text.js`],
  ['alt-progress-then-text', `node testing/fixtures/alt-progress-then-text.js`],
  ['synchronized-render', `node testing/fixtures/synchronized-render.js`],
  ['alt-only', `node testing/fixtures/alt-only.js`],
  ['curl', `PORT=18765; node testing/fixtures/slow-http-server.js "$PORT" 240000 12000 350 >/tmp/bash-pty-curl-server.log 2>&1 & pid=$!; trap 'kill $pid 2>/dev/null || true' EXIT; while ! grep -q "ready:$PORT" /tmp/bash-pty-curl-server.log 2>/dev/null; do sleep 0.05; done; curl http://127.0.0.1:$PORT/slow -o /dev/null; kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true`],
  ['ffmpeg', `ffmpeg -hide_banner -re -f lavfi -i testsrc2=size=640x360:rate=30 -t 6 -f null - || true`],
  ['htop', `htop --version || true`],
];

const reportRows = [];
for (const [name, command] of cases) {
  const fixture = readFixtureSource(command);
  const ptyResult = await runPty(command, name);
  const builtin = await runBuiltin(command);
  const media = await renderGif(name, ptyResult.snapshots);
  reportRows.push({ name, command, fixture, pty: ptyResult, builtin, media });
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>bash-pty report</title><style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;padding:24px}
pre{white-space:pre-wrap;background:#1b1b1b;padding:12px;border-radius:8px;overflow:auto}
code{background:#1b1b1b;padding:2px 6px;border-radius:6px}
.case{border:1px solid #333;padding:16px;border-radius:12px;margin-bottom:20px}
img{max-width:100%;border-radius:8px;border:1px solid #333}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
a{color:#8ecaff}
.meta{color:#aaa;font-size:14px}
</style></head><body><h1>bash-pty master report</h1><p class="meta">Rerun everything with <code>npm run report</code>. Reusable API explainer: <a href="reusable-live-widget-api.html">artifacts/reusable-live-widget-api.html</a></p>${reportRows.map((row)=>`
<div class="case">
<h2>${esc(row.name)}</h2>
<p><code>${esc(row.command)}</code></p>
${row.fixture ? `<details><summary>Fixture source: <code>${esc(row.fixture.path)}</code></summary><pre>${esc(row.fixture.source)}</pre></details>` : ''}
<p><img src="${path.basename(row.media.gifPath)}"></p>
<p>Sample frames: ${row.media.pngPaths.map((p)=>`<a href="${path.relative(outDir,p)}">${path.basename(p)}</a>`).join(' ')}</p>
<div class="grid">
<div><h3>PTY final output</h3><pre>${esc(row.pty.truncation.content)}</pre></div>
<div><h3>Built-in final output</h3><pre>${esc((row.builtin.content?.[0]?.text) || '')}</pre></div>
</div>
</div>`).join('')}</body></html>`;

const reportPath = path.join(outDir, 'master-report.html');
fs.writeFileSync(reportPath, html);
fs.writeFileSync(path.join(outDir, 'reusable-live-widget-api.html'), buildApiExplainerHtml());
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
await page.goto(`file://${reportPath}`);
await page.screenshot({ path: path.join(outDir, 'master-report.png'), fullPage: true });
await browser.close();
console.log(reportPath);
