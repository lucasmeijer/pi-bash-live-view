import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PTY_COLS, INPUT_IDLE_ABORT_MS, INPUT_IDLE_POLL_MS, WIDGET_DELAY_MS, WIDGET_HEIGHT, XTERM_SCROLLBACK_LINES } from '../pty-execute.ts';

test('PTY execution uses hardcoded runtime defaults', () => {
  assert.equal(WIDGET_DELAY_MS, 100);
  assert.equal(WIDGET_HEIGHT, 15);
  assert.equal(DEFAULT_PTY_COLS, 100);
  assert.equal(XTERM_SCROLLBACK_LINES, 100_000);
  assert.equal(INPUT_IDLE_ABORT_MS, 2_000);
  assert.equal(INPUT_IDLE_POLL_MS, 250);
});
