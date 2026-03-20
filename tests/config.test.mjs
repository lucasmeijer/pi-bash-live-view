import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.ts';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-live-view-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig merges project config and clamps numeric values', () => {
  withTempDir((dir) => {
    const projectDir = path.join(dir, '.pi');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'bash-live-view.json'), JSON.stringify({
      widgetDelayMs: 999999,
      widgetHeight: 1,
      testWidth: 400,
      scrollbackLines: 50,
      debug: true,
    }));

    const config = loadConfig(dir);
    assert.equal(config.widgetDelayMs, 60_000);
    assert.equal(config.widgetHeight, 5);
    assert.equal(config.testWidth, 300);
    assert.equal(config.scrollbackLines, 100);
    assert.equal(config.debug, true);
  });
});
