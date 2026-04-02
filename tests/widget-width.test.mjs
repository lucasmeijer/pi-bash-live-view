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
  return Array.from(text).map((ch) => ({ ch, style: { ...defaultStyle } }));
}

test('live widget truncates wide-character body lines to terminal width', () => {
  const width = 163;
  const snapshot = [
    makeSnapshotLine(
      'Warning: image media-raw/uploads/مفتاح-تاتش-2-خط--766607f026/__cutouts/1773746356432-1-cf7777001b-微信图片_2025-09-22_122637_423-cutout.png is smaller than the recommended minimum (565×565 vs 1000×750). Processing will continue.',
    ),
  ];

  const rendered = buildWidgetAnsiLines({
    snapshot,
    width,
    rows: 1,
    elapsedMs: 315300,
  });

  assert.equal(rendered.length, 3);
  for (const line of rendered) {
    assert.ok(visibleWidth(line) <= width, `expected line width <= ${width}, got ${visibleWidth(line)} for ${JSON.stringify(line)}`);
  }
});

test('live widget truncates wide-character titles to terminal width', () => {
  const width = 40;
  const rendered = buildWidgetAnsiLines({
    title: 'Live terminal 微信图片 very long title',
    snapshot: [makeSnapshotLine('ok')],
    width,
    rows: 1,
    elapsedMs: 315300,
  });

  for (const line of rendered) {
    assert.ok(visibleWidth(line) <= width, `expected line width <= ${width}, got ${visibleWidth(line)} for ${JSON.stringify(line)}`);
  }
});
