import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalEmulator } from '../src/terminal-emulator.js';

function snapshotToText(snapshot) {
  return snapshot
    .map((line) => line.map((cell) => cell.ch).join('').replace(/\s+$/u, ''))
    .join('\n')
    .trimEnd();
}

test('synchronized render lock survives split DECSET/DECRST 2026 sequences', async () => {
  const emulator = createTerminalEmulator({ cols: 20, rows: 4 });
  try {
    const before = await emulator.consumeProcessStdout('before\n');
    assert.equal(before.inSyncRender, false);
    assert.match(snapshotToText(before.snapshot), /before/);

    const beginA = await emulator.consumeProcessStdout('\x1b[?20');
    assert.equal(beginA.inSyncRender, false);

    const beginB = await emulator.consumeProcessStdout('26hpartial');
    assert.equal(beginB.inSyncRender, true);
    assert.match(snapshotToText(beginB.snapshot), /before/);
    assert.doesNotMatch(snapshotToText(beginB.snapshot), /partial/);
    assert.equal(emulator.getState().inSyncRender, true);

    const stillLocked = await emulator.consumeProcessStdout(' update');
    assert.equal(stillLocked.inSyncRender, true);
    assert.match(snapshotToText(stillLocked.snapshot), /before/);
    assert.doesNotMatch(snapshotToText(stillLocked.snapshot), /partial update/);

    const endA = await emulator.consumeProcessStdout('\x1b[?202');
    assert.equal(endA.inSyncRender, true);
    assert.match(snapshotToText(endA.snapshot), /before/);

    const endB = await emulator.consumeProcessStdout('6l');
    assert.equal(endB.inSyncRender, false);
    assert.match(snapshotToText(endB.snapshot), /partial update/);
    assert.equal(emulator.getState().inSyncRender, false);
    assert.match(snapshotToText(emulator.getViewportSnapshot()), /partial update/);
  } finally {
    emulator.dispose();
  }
});

test('split alt-screen private mode sequences still update terminal state tracking', async () => {
  const emulator = createTerminalEmulator({ cols: 20, rows: 4 });
  try {
    await emulator.consumeProcessStdout('\x1b[?104');
    assert.equal(emulator.getState().inAltScreen, false);

    await emulator.consumeProcessStdout('9h');
    assert.equal(emulator.getState().inAltScreen, true);

    await emulator.consumeProcessStdout('\x1b[?104');
    assert.equal(emulator.getState().inAltScreen, true);

    await emulator.consumeProcessStdout('9l');
    assert.equal(emulator.getState().inAltScreen, false);
  } finally {
    emulator.dispose();
  }
});

test('split alt-screen transitions are excluded from the final normal-screen transcript', async () => {
  const emulator = createTerminalEmulator({ cols: 30, rows: 6 });
  try {
    await emulator.consumeProcessStdout('before\n');
    await emulator.consumeProcessStdout('\x1b[?104');
    await emulator.consumeProcessStdout('9halt-screen only');
    await emulator.consumeProcessStdout('\nmore alt text');
    await emulator.consumeProcessStdout('\x1b[?104');
    await emulator.consumeProcessStdout('9lafter\n');

    assert.equal(emulator.getStrippedTextIncludingEntireScrollback(), 'before\nafter\n');
  } finally {
    emulator.dispose();
  }
});
