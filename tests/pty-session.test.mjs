import test from 'node:test';
import assert from 'node:assert/strict';
import stripAnsi from 'strip-ansi';
import { getShellConfig } from '@mariozechner/pi-coding-agent';
import { PtyTerminalSession } from '../pty-session.ts';
import { buildWidgetAnsiLines } from '../widget.ts';

function visibleWidth(text) {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0) continue;
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    if (codePoint >= 0x300 && codePoint <= 0x36f) continue;
    if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) continue;
    if (codePoint >= 0x1f000 && codePoint <= 0x1faff) width += 2;
    else if (codePoint >= 0x2600 && codePoint <= 0x27bf) width += 2;
    else width += 1;
  }
  return width;
}

function defaultStyle() {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    invisible: false,
    strikethrough: false,
    fgMode: 'default',
    fg: 0,
    bgMode: 'default',
    bg: 0,
  };
}

function snapshotLine(text) {
  return [...text].map((ch) => ({ ch, style: defaultStyle() }));
}

function snapshotToText(snapshot) {
  return snapshot
    .map((line) => line.map((cell) => cell.ch).join('').replace(/\s+$/u, ''))
    .join('\n')
    .trimEnd();
}

function buildNodeCommand(source) {
  return `"${process.execPath}" -e ${JSON.stringify(source.trim())}`;
}

function createSession(command, overrides = {}) {
  const shellConfig = getShellConfig();
  return new PtyTerminalSession({
    command,
    cwd: process.cwd(),
    cols: 60,
    rows: 6,
    scrollback: 1000,
    shell: shellConfig.shell,
    shellArgs: shellConfig.args,
    ...overrides,
  });
}

function waitForExit(session, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for session exit after ${timeoutMs}ms`)), timeoutMs);
    const unsubscribe = session.addExitListener((exitCode, signal) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve({ exitCode, signal });
    });
  });
}

function waitForFirstUpdate(session, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for session update after ${timeoutMs}ms`)), timeoutMs);
    const unsubscribe = session.subscribe((payload) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(payload);
    });
  });
}

test('PtyTerminalSession exposes minimal lifecycle, widget, and final-text APIs', async () => {
  const session = createSession(String.raw`printf 'alpha\n\033[38;5;196mbeta\033[0m\n'`);

  try {
    const updates = [];
    const unsubscribeUpdates = session.subscribe((payload) => updates.push(payload));
    const exit = await waitForExit(session);
    await session.whenIdle();
    unsubscribeUpdates();

    assert.equal(session.exited, true);
    assert.equal(session.exitCode, 0);
    assert.equal(exit.exitCode, 0);
    assert.equal(typeof session.pid, 'number');
    assert.equal(session.cols, 60);
    assert.equal(session.rows, 6);
    assert.ok(updates.length >= 1, 'expected at least one terminal update');

    const viewportText = snapshotToText(session.getViewportSnapshot());
    assert.match(viewportText, /alpha/);
    assert.match(viewportText, /beta/);

    const ansiLines = buildWidgetAnsiLines({
      snapshot: session.getViewportSnapshot(),
      width: 40,
      rows: 6,
    }).join('\n');
    assert.match(ansiLines, /beta/);
    assert.match(ansiLines, /\x1b\[/);

    assert.equal(session.getStrippedTextIncludingEntireScrollback(), 'alpha\nbeta\n');
  } finally {
    session.dispose();
    session.dispose();
  }
});

test('widget rendering keeps wide characters within the requested width', () => {
  const width = 40;
  const lines = buildWidgetAnsiLines({
    snapshot: [snapshotLine('  ✅ VITE_FIREBASE_API_KEY: Configurada')],
    width,
    rows: 1,
  });

  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(
      visibleWidth(stripAnsi(line)) <= width,
      `expected line to fit width ${width}: ${JSON.stringify(stripAnsi(line))}`,
    );
  }
});

test('getStrippedTextIncludingEntireScrollback includes output beyond the visible viewport', async () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n');
  const session = createSession(`printf ${JSON.stringify(lines + '\n')}`, { rows: 6 });

  try {
    await waitForExit(session);
    await session.whenIdle();

    const viewportText = snapshotToText(session.getViewportSnapshot());
    assert.doesNotMatch(viewportText, /line-1/);
    assert.match(viewportText, /line-40/);

    const fullText = session.getStrippedTextIncludingEntireScrollback();
    assert.match(fullText, /line-1/);
    assert.match(fullText, /line-20/);
    assert.match(fullText, /line-40/);
  } finally {
    session.dispose();
  }
});

test('PtyTerminalSession kill terminates a running session and still settles idle state', async () => {
  const session = createSession(buildNodeCommand(`
    process.stdout.write('ready\\n');
    setInterval(() => process.stdout.write('tick\\n'), 25);
  `));

  try {
    await waitForFirstUpdate(session);
    session.kill();
    await waitForExit(session);
    await session.whenIdle();

    assert.equal(session.exited, true);
    assert.match(session.getStrippedTextIncludingEntireScrollback(), /ready|tick/);
  } finally {
    session.dispose();
  }
});
