import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBashTool } from '@earendil-works/pi-coding-agent';
import { executePtyCommand } from '../pty-execute.ts';

function createCtx() {
  return { cwd: process.cwd(), hasUI: false };
}

async function runBuiltIn(params, signal = new AbortController().signal) {
  const tool = createBashTool(process.cwd());
  return tool.execute(`builtin-${Date.now()}`, params, signal, undefined);
}

async function runPty(params, signal = new AbortController().signal) {
  return executePtyCommand(`pty-${Date.now()}`, params, signal, createCtx());
}

async function captureResult(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function normalizeTempPaths(text) {
  return String(text).replace(/\/var\/folders\/[^\]\s]+\/pi-bash-[a-f0-9]+\.log/g, '/tmp/pi-bash-XXXX.log')
    .replace(/\/tmp\/pi-bash-[a-f0-9]+\.log/g, '/tmp/pi-bash-XXXX.log');
}

function buildNodeCommand(source) {
  const normalized = source.trim().replace(/\s*\n\s*/g, ' ');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(normalized)}`;
}

test('PTY-backed bash matches built-in bash for simple successful output and does not leak PTY metadata', async () => {
  const command = `printf 'hello\\nworld\\n'`;

  const [builtin, pty] = await Promise.all([
    runBuiltIn({ command }),
    runPty({ command }),
  ]);

  assert.deepEqual(pty, builtin);
  assert.equal(pty.details, undefined);
});

test('PTY-backed bash matches built-in bash non-zero exit reporting', async () => {
  const command = `printf 'oops\\n'; exit 7`;

  const [builtin, pty] = await Promise.all([
    captureResult(() => runBuiltIn({ command })),
    captureResult(() => runPty({ command })),
  ]);

  assert.equal(builtin.ok, false);
  assert.equal(pty.ok, false);
  assert.equal(pty.error instanceof Error, true);
  assert.equal(pty.error.message, builtin.error.message);
});

test('PTY-backed bash matches built-in bash timeout error formatting', async () => {
  const command = buildNodeCommand(`
    console.log('hi');
    setInterval(() => console.log('tick'), 50);
  `);

  const [builtin, pty] = await Promise.all([
    captureResult(() => runBuiltIn({ command, timeout: 0.1 })),
    captureResult(() => runPty({ command, timeout: 0.1 })),
  ]);

  assert.equal(builtin.ok, false);
  assert.equal(pty.ok, false);
  assert.equal(pty.error.message, builtin.error.message);
});

test('PTY-backed bash matches built-in bash abort error formatting', async () => {
  const command = buildNodeCommand(`
    console.log('starting');
    setInterval(() => console.log('tick'), 50);
  `);

  const builtinController = new AbortController();
  const ptyController = new AbortController();
  setTimeout(() => builtinController.abort(), 100);
  setTimeout(() => ptyController.abort(), 100);

  const [builtin, pty] = await Promise.all([
    captureResult(() => runBuiltIn({ command }, builtinController.signal)),
    captureResult(() => runPty({ command }, ptyController.signal)),
  ]);

  assert.equal(builtin.ok, false);
  assert.equal(pty.ok, false);
  assert.equal(pty.error.message, builtin.error.message);
});

test('PTY-backed bash matches built-in bash truncation shape and notice style for large output', async () => {
  const command = buildNodeCommand(`
    for (let i = 1; i <= 2500; i += 1) {
      console.log(String(i).padStart(4, '0') + ' ' + 'x'.repeat(40));
    }
  `);

  const [builtin, pty] = await Promise.all([
    runBuiltIn({ command }),
    runPty({ command }),
  ]);

  assert.equal(pty.content[0]?.type, 'text');

  const ptyText = normalizeTempPaths(pty.content[0]?.text);
  const builtinText = normalizeTempPaths(builtin.content[0]?.text);
  const ptyBody = ptyText.replace(/\n\n\[Showing lines .*$/, '');
  const builtinBody = builtinText.replace(/\n\n\[Showing lines .*$/, '');
  assert.equal(ptyBody, builtinBody, 'truncated visible content should match built-in bash');
  assert.match(ptyText, /\n\n\[Showing lines \d+-\d+ of \d+(?: \(50\.0KB limit\))?\. Full output: \/tmp\/pi-bash-XXXX\.log\]$/);
  assert.match(builtinText, /\n\n\[Showing lines \d+-\d+ of \d+(?: \(50\.0KB limit\))?\. Full output: \/tmp\/pi-bash-XXXX\.log\]$/);

  assert.deepEqual(
    Object.keys(pty.details ?? {}).sort(),
    Object.keys(builtin.details ?? {}).sort(),
    'details shape should match built-in bash shape',
  );

  assert.equal(pty.details?.truncation?.truncated, true);
  assert.equal(pty.details?.truncation?.truncatedBy, builtin.details?.truncation?.truncatedBy);
  assert.equal(pty.details?.truncation?.outputBytes, builtin.details?.truncation?.outputBytes);
  assert.equal(pty.details?.truncation?.content, builtin.details?.truncation?.content);
  assert.equal(typeof pty.details?.fullOutputPath, typeof builtin.details?.fullOutputPath);

  if (pty.details?.fullOutputPath) {
    assert.equal(fs.existsSync(pty.details.fullOutputPath), true);
  }
  if (builtin.details?.fullOutputPath) {
    assert.equal(fs.existsSync(builtin.details.fullOutputPath), true);
  }
});
