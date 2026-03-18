import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createBashTool, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from '@mariozechner/pi-coding-agent';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { chromium } from 'playwright';
import GIFEncoder from 'gifencoder';
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
  return stripAnsi(text).replace(/\u0000/g, '').replace(/\p{Cf}/gu, '');
}
function createFrameState() {
  return { lines: [''], cursorRow: 0, cursorCol: 0 };
}
function writeFrameChar(state, ch, cols) {
  const current = state.lines[state.cursorRow] ?? '';
  const padded = current.padEnd(state.cursorCol, ' ');
  state.lines[state.cursorRow] = `${padded.slice(0, state.cursorCol)}${ch}${padded.slice(state.cursorCol + 1)}`.slice(0, cols);
  state.cursorCol = Math.min(cols - 1, state.cursorCol + 1);
}
function applyFrameChunk(state, text, rows, cols) {
  for (const ch of text) {
    if (ch === '\r') {
      state.cursorCol = 0;
      continue;
    }
    if (ch === '\n') {
      state.cursorRow += 1;
      state.cursorCol = 0;
      while (state.lines.length <= state.cursorRow) state.lines.push('');
      if (state.lines.length > rows) {
        state.lines.shift();
        state.cursorRow = Math.max(0, state.cursorRow - 1);
      }
      continue;
    }
    if (ch === '\b') {
      state.cursorCol = Math.max(0, state.cursorCol - 1);
      continue;
    }
    if (ch >= ' ' || ch === '\t') {
      writeFrameChar(state, ch === '\t' ? ' ' : ch, cols);
    }
  }
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
      snapshots.push([...frame.lines]);
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
function renderTerminalHtml(title, lines) {
  return `<!doctype html><html><body style="margin:0;background:#111;color:#ddd;font-family:Menlo,monospace"><div style="width:840px;background:#111;padding:12px"><div style="border:1px solid #4da3ff;border-radius:8px;overflow:hidden"><div style="padding:6px 10px;border-bottom:1px solid #4da3ff;color:#7ab7ff">${esc(title)}</div><pre style="margin:0;padding:10px;min-height:270px">${esc(lines.join('\n'))}</pre></div></div></body></html>`;
}
async function renderGif(name, snapshots) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 864, height: 340 } });
  const frameDir = path.join(outDir, `${name}-frames`);
  fs.mkdirSync(frameDir, { recursive: true });
  const pngPaths = [];
  for (let i = 0; i < snapshots.length; i += Math.max(1, Math.floor(snapshots.length / 12))) {
    const lines = snapshots[i];
    await page.setContent(renderTerminalHtml('Live terminal', lines));
    const pngPath = path.join(frameDir, `${String(pngPaths.length).padStart(3, '0')}.png`);
    await page.screenshot({ path: pngPath });
    pngPaths.push(pngPath);
  }
  await browser.close();
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
  ['curl', `curl -I https://example.com || true`],
  ['ffmpeg', `ffmpeg -version || true`],
  ['htop', `htop --version || true`],
];

const reportRows = [];
for (const [name, command] of cases) {
  const ptyResult = await runPty(command, name);
  const builtin = await runBuiltin(command);
  const media = await renderGif(name, ptyResult.snapshots.length ? ptyResult.snapshots : [['(no live frames)']]);
  reportRows.push({ name, command, pty: ptyResult, builtin, media });
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>bash-pty report</title><style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;padding:24px} pre{white-space:pre-wrap;background:#1b1b1b;padding:12px;border-radius:8px} .case{border:1px solid #333;padding:16px;border-radius:12px;margin-bottom:20px} img{max-width:100%;border-radius:8px;border:1px solid #333} .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
a{color:#8ecaff}
</style></head><body><h1>bash-pty master report</h1>${reportRows.map((row)=>`
<div class="case">
<h2>${esc(row.name)}</h2>
<p><code>${esc(row.command)}</code></p>
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
