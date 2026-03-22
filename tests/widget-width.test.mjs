import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@mariozechner/pi-tui';
import { buildWidgetAnsiLines } from '../widget.ts';

const defaultStyle = {
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

function makeSnapshotLine(text) {
  return [...text].map((ch) => ({ ch, style: defaultStyle }));
}

test('widget lines stay within width when body contains wide Unicode characters', () => {
  const lines = buildWidgetAnsiLines({
    snapshot: [makeSnapshotLine('Warning: image 微信图片_2025-09-22_122637_423-cutout.png is smaller than the recommended minimum (565×565 vs 1000×750). Processing will continue.')],
    width: 163,
    rows: 3,
    elapsedMs: 254000,
  });

  for (const line of lines) {
    assert.equal(visibleWidth(line), 163);
  }
});

test('widget top border stays within width when title contains wide Unicode characters', () => {
  const lines = buildWidgetAnsiLines({
    title: 'Live terminal 微信图片 progress',
    snapshot: [makeSnapshotLine('ok')],
    width: 40,
    rows: 1,
    elapsedMs: 254000,
  });

  assert.equal(visibleWidth(lines[0]), 40);
  assert.equal(visibleWidth(lines.at(-1)), 40);
});
