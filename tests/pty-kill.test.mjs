import test from 'node:test';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import stripAnsi from 'strip-ansi';
import { getShellConfig } from '@earendil-works/pi-coding-agent';
import { killPtyProcess } from '../pty-kill.ts';
import { executePtyCommand } from '../pty-execute.ts';

function restoreProcessKill(originalKill) {
  process.kill = originalKill;
}

async function waitFor(condition, { timeoutMs = 3000, intervalMs = 25 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('killPtyProcess prefers process-group kill before direct PTY kill', () => {
  const originalKill = process.kill;
  const calls = [];
  process.kill = ((pid, signal) => {
    calls.push({ type: 'group', pid, signal });
    return true;
  });

  try {
    const ptyProcess = {
      pid: 1234,
      kill(signal) {
        calls.push({ type: 'pty', signal });
      },
    };

    killPtyProcess(ptyProcess, 'SIGTERM');

    if (process.platform === 'win32') {
      assert.deepEqual(calls, [{ type: 'pty', signal: 'SIGTERM' }]);
    } else {
      assert.deepEqual(calls, [{ type: 'group', pid: -1234, signal: 'SIGTERM' }]);
    }
  } finally {
    restoreProcessKill(originalKill);
  }
});

test('killPtyProcess falls back to direct PTY kill when process-group kill fails', () => {
  const originalKill = process.kill;
  const calls = [];
  process.kill = ((pid, signal) => {
    calls.push({ type: 'group', pid, signal });
    throw new Error('group kill failed');
  });

  try {
    const ptyProcess = {
      pid: 5678,
      kill(signal) {
        calls.push({ type: 'pty', signal });
      },
    };

    killPtyProcess(ptyProcess, 'SIGKILL');

    if (process.platform === 'win32') {
      assert.deepEqual(calls, [{ type: 'pty', signal: 'SIGKILL' }]);
    } else {
      assert.deepEqual(calls, [
        { type: 'group', pid: -5678, signal: 'SIGKILL' },
        { type: 'pty', signal: 'SIGKILL' },
      ]);
    }
  } finally {
    restoreProcessKill(originalKill);
  }
});

test('killPtyProcess removes a spawned descendant process tree in practice', async () => {
  if (process.platform === 'win32') {
    return;
  }

  const shellConfig = getShellConfig();
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
    "const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(child.pid); setInterval(() => {}, 1000);",
  )}`;

  const child = pty.spawn(shellConfig.shell, [...shellConfig.args, command], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  let output = '';
  let descendantPid = null;
  const exitPromise = new Promise((resolve) => {
    child.onExit(resolve);
  });

  child.onData((chunk) => {
    output += stripAnsi(chunk);
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const lastNumericLine = [...lines].reverse().find((line) => /^\d+$/.test(line));
    if (lastNumericLine) descendantPid = Number(lastNumericLine);
  });

  try {
    await waitFor(() => Number.isInteger(descendantPid), { timeoutMs: 3000 });
    assert.equal(isProcessAlive(descendantPid), true);

    killPtyProcess(child);
    await exitPromise;
    await waitFor(() => !isProcessAlive(descendantPid), { timeoutMs: 3000 });
    assert.equal(isProcessAlive(descendantPid), false);
  } finally {
    try {
      killPtyProcess(child, 'SIGKILL');
    } catch {}
    if (Number.isInteger(descendantPid) && isProcessAlive(descendantPid)) {
      try {
        process.kill(descendantPid, 'SIGKILL');
      } catch {}
    }
  }
});

test('executePtyCommand timeout uses PTY kill semantics and rejects promptly', async () => {
  const controller = new AbortController();
  const start = Date.now();
  await assert.rejects(
    () => executePtyCommand(
      `timeout-${Date.now()}`,
      { command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify("setInterval(() => console.log('tick'), 25)")}`, timeout: 0.1 },
      controller.signal,
      { cwd: process.cwd(), hasUI: false },
    ),
    /Command timed out after 0\.1 seconds/,
  );

  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `expected timeout path to complete quickly, got ${elapsed}ms`);
});
