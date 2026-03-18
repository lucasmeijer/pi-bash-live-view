import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createBashTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from '@mariozechner/pi-coding-agent';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { chromium } from 'playwright';
import GIFEncoder from 'gifencoder';
import sharp from 'sharp';
import { PNG } from 'pngjs';

const cwd = process.cwd();
const outDir = path.join(cwd, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
const require = createRequire(import.meta.url);

function ensureSpawnHelperExecutable() {
  try {
    const base = path.dirname(require.resolve('node-pty/package.json'));
    for (const helper of [
      path.join(base, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      path.join(base, 'prebuilds', 'darwin-x64', 'spawn-helper'),
    ]) {
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    }
  } catch (error) {
    console.warn('[bash-pty report] spawn-helper chmod failed', error);
  }
}

ensureSpawnHelperExecutable();

function sanitizeOutput(text) {
  return stripAnsi(text).replace(/\r/g, '').replace(/\u0000/g, '');
}
function applyTranscriptChunk(state, text) {
  for (const ch of text) {
    if (state.pendingCR && ch !== '\n') state.current = '';
    if (ch === '\r') {
      state.pendingCR = true;
      continue;
    }
    if (ch === '\n') {
      state.lines.push(state.current);
      state.current = '';
      state.pendingCR = false;
      continue;
    }
    if (ch === '\b') state.current = state.current.slice(0, -1);
    else if (ch >= ' ' || ch === '\t') state.current += ch;
    state.pendingCR = false;
  }
}
function finalizeTranscript(state) {
  const lines = [...state.lines];
  if (state.current) lines.push(state.current);
  const text = sanitizeOutput(lines.join('\n')).trimEnd();
  return text.length === 0 ? '(no output)' : `${text}\n`;
}
function stripControlForFrame(text) {
  return text.replace(/\u0000/g, '').replace(/\p{Cf}/gu, '');
}
function createFrameState() {
  return { lines: [[{ ch: ' ', style: defaultStyle() }]], cursorRow: 0, cursorCol: 0, style: defaultStyle() };
}
function defaultStyle() {
  return { fg: null, bold: false, dim: false };
}
function cloneStyle(style) {
  return { fg: style.fg, bold: style.bold, dim: style.dim };
}
function styleToCss(style) {
  const colors = {
    red: '#ff6b6b',
    green: '#51cf66',
    yellow: '#ffd43b',
    blue: '#74c0fc',
    magenta: '#f783ff',
    cyan: '#66d9e8',
    gray: '#adb5bd',
  };
  const parts = [];
  if (style.fg && colors[style.fg]) parts.push(`color:${colors[style.fg]}`);
  if (style.bold) parts.push('font-weight:700');
  if (style.dim) parts.push('opacity:0.75');
  return parts.join(';');
}
function svgAttrsForStyle(style) {
  const colors = {
    red: '#ff6b6b',
    green: '#51cf66',
    yellow: '#ffd43b',
    blue: '#74c0fc',
    magenta: '#f783ff',
    cyan: '#66d9e8',
    gray: '#adb5bd',
  };
  let attrs = '';
  if (style.fg && colors[style.fg]) attrs += ` fill="${colors[style.fg]}"`;
  if (style.bold) attrs += ' font-weight="700"';
  if (style.dim) attrs += ' opacity="0.75"';
  return attrs;
}
function ensureRow(state, row, cols) {
  while (state.lines.length <= row) {
    state.lines.push(Array.from({ length: cols }, () => ({ ch: ' ', style: defaultStyle() })));
  }
  const line = state.lines[row];
  while (line.length < cols) line.push({ ch: ' ', style: defaultStyle() });
}
function writeFrameChar(state, ch, cols) {
  ensureRow(state, state.cursorRow, cols);
  state.lines[state.cursorRow][state.cursorCol] = { ch, style: cloneStyle(state.style) };
  state.cursorCol = Math.min(cols - 1, state.cursorCol + 1);
}
function applySgr(style, codes) {
  for (const code of codes) {
    if (code === 0) Object.assign(style, defaultStyle());
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 31) style.fg = 'red';
    else if (code === 32) style.fg = 'green';
    else if (code === 33) style.fg = 'yellow';
    else if (code === 34) style.fg = 'blue';
    else if (code === 35) style.fg = 'magenta';
    else if (code === 36) style.fg = 'cyan';
    else if (code === 90) style.fg = 'gray';
    else if (code === 39) style.fg = null;
  }
}
function applyFrameChunk(state, text, rows, cols) {
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const sgrMatch = text.slice(i).match(/^\x1b\[([0-9;]*)m/);
      if (sgrMatch) {
        const codes = (sgrMatch[1] ? sgrMatch[1].split(';').map(Number) : [0]).filter((n) => !Number.isNaN(n));
        applySgr(state.style, codes);
        i += sgrMatch[0].length;
        continue;
      }
      const csiMatch = text.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
      if (csiMatch) {
        i += csiMatch[0].length;
        continue;
      }
    }
    const ch = text[i];
    if (ch === '\r') {
      state.cursorCol = 0;
      i += 1;
      continue;
    }
    if (ch === '\n') {
      state.cursorRow += 1;
      state.cursorCol = 0;
      ensureRow(state, state.cursorRow, cols);
      if (state.lines.length > rows) {
        state.lines.shift();
        state.cursorRow = Math.max(0, state.cursorRow - 1);
      }
      i += 1;
      continue;
    }
    if (ch === '\b') {
      state.cursorCol = Math.max(0, state.cursorCol - 1);
      i += 1;
      continue;
    }
    if (ch >= ' ' || ch === '\t') writeFrameChar(state, ch === '\t' ? ' ' : ch, cols);
    i += 1;
  }
}
function frameSnapshotToHtmlLines(lines) {
  return lines.map((line) => {
    if (!Array.isArray(line)) return esc(String(line ?? ''));
    const cells = line;
    let html = '';
    let currentCss = null;
    let chunk = '';
    const flush = () => {
      if (!chunk) return;
      const escaped = esc(chunk);
      html += currentCss ? `<span style="${currentCss}">${escaped}</span>` : escaped;
      chunk = '';
    };
    for (const cell of cells) {
      const css = styleToCss(cell.style ?? defaultStyle());
      if (css !== currentCss) {
        flush();
        currentCss = css || null;
      }
      chunk += cell.ch;
    }
    flush();
    return html.replace(/\s+$/g, '');
  });
}
function styleToAnsi(style) {
  const codes = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.fg === 'red') codes.push(31);
  if (style.fg === 'green') codes.push(32);
  if (style.fg === 'yellow') codes.push(33);
  if (style.fg === 'blue') codes.push(34);
  if (style.fg === 'magenta') codes.push(35);
  if (style.fg === 'cyan') codes.push(36);
  if (style.fg === 'gray') codes.push(90);
  return codes.length ? `\x1b[${codes.join(';')}m` : '';
}
function frameSnapshotToAnsiLines(lines) {
  return lines.map((line) => {
    if (!Array.isArray(line)) return String(line ?? '');
    let out = '';
    let current = defaultStyle();
    for (const cell of line) {
      const style = cell.style ?? defaultStyle();
      if (style.fg !== current.fg || style.bold !== current.bold || style.dim !== current.dim) {
        out += '\x1b[0m' + styleToAnsi(style);
        current = cloneStyle(style);
      }
      out += cell.ch;
    }
    return `${out}\x1b[0m`.replace(/\s+\x1b\[0m$/, '\x1b[0m');
  });
}
function padAnsiLine(line, width) {
  const visible = stripAnsi(line);
  return line + ' '.repeat(Math.max(0, width - visible.length));
}
function buildWidgetAnsiLines(title, snapshot, width, rows) {
  const accent = '\x1b[38;2;77;163;255m';
  const reset = '\x1b[0m';
  const innerWidth = Math.max(10, width - 4);
  const header = ` ${title} `;
  const top = `${accent}┌${header}${'─'.repeat(Math.max(0, width - 2 - header.length))}┐${reset}`;
  const bottom = `${accent}└${'─'.repeat(Math.max(0, width - 2))}┘${reset}`;
  const bodySource = frameSnapshotToAnsiLines(snapshot).slice(-rows);
  const body = [];
  for (let i = 0; i < rows; i++) {
    const line = padAnsiLine(bodySource[i] ?? '', innerWidth);
    body.push(`${accent}│ ${reset}${line}${accent} │${reset}`);
  }
  return [top, ...body, bottom];
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
  const charWidth = 10;
  const lineHeight = 24;
  const padding = 14;
  const visibleWidth = Math.max(...lines.map((line) => stripAnsi(line).length), 1);
  const width = padding * 2 + visibleWidth * charWidth;
  const height = padding * 2 + lines.length * lineHeight;
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
function normalScreenPortion(inAltAtStart, chunk) {
  const enter = /\x1b\[\?(?:1049|1047|47)h/g;
  const exit = /\x1b\[\?(?:1049|1047|47)l/g;
  let out = '';
  let index = 0;
  let inAlt = inAltAtStart;
  while (index < chunk.length) {
    if (inAlt) {
      exit.lastIndex = index;
      const match = exit.exec(chunk);
      if (!match) break;
      index = match.index + match[0].length;
      inAlt = false;
      continue;
    }
    enter.lastIndex = index;
    const match = enter.exec(chunk);
    if (!match) {
      out += chunk.slice(index);
      break;
    }
    out += chunk.slice(index, match.index);
    index = match.index + match[0].length;
    inAlt = true;
  }
  return out;
}

async function runPty(command, name) {
  const child = pty.spawn('/bin/bash', ['-lc', command], {
    name: 'xterm-256color', cols: 100, rows: 15, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  const state = { lines: [], current: '' };
  let inAlt = false;
  let ansiBuffer = '';
  const frame = createFrameState();
  const snapshots = [];
  await new Promise((resolve) => {
    child.onData((chunk) => {
      const startedAlt = inAlt;
      ansiBuffer = (ansiBuffer + chunk).slice(-256);
      if (/\x1b\[\?1049h/.test(ansiBuffer)) inAlt = true;
      if (/\x1b\[\?1049l/.test(ansiBuffer)) inAlt = false;
      const clean = stripControlForFrame(chunk);
      if (clean) applyFrameChunk(frame, clean, 15, 100);
      snapshots.push(frame.lines.map((line) => line.map((cell) => ({ ...cell, style: { ...cell.style } }))));
      const visibleNormal = normalScreenPortion(startedAlt, chunk);
      if (visibleNormal) applyTranscriptChunk(state, stripAnsi(visibleNormal));
    });
    child.onExit(resolve);
  });
  const truncation = truncateHead(finalizeTranscript(state), DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
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
  const step = Math.max(1, Math.floor(snapshots.length / 12));
  for (let i = 0; i < snapshots.length; i += step) {
    const lines = buildWidgetAnsiLines('Live terminal', snapshots[i], 84, 15);
    const pngPath = path.join(frameDir, `${String(pngPaths.length).padStart(3, '0')}.png`);
    await ansiLinesToPng(lines, pngPath);
    pngPaths.push(pngPath);
  }
  if (snapshots.length > 0 && (snapshots.length - 1) % step !== 0) {
    const lines = buildWidgetAnsiLines('Live terminal', snapshots.at(-1) ?? [], 84, 15);
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

const cases = [
  ['spill', `node testing/fixtures/spill.js 2400`],
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
  const media = await renderGif(name, ptyResult.snapshots.length ? ptyResult.snapshots : [['(no live frames)']]);
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
</style></head><body><h1>bash-pty master report</h1><p class="meta">Rerun everything with <code>npm run report</code>.</p>${reportRows.map((row)=>`
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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } });
await page.goto(`file://${reportPath}`);
await page.screenshot({ path: path.join(outDir, 'master-report.png'), fullPage: true });
await browser.close();
console.log(reportPath);
