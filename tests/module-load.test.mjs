import test from 'node:test';
import assert from 'node:assert/strict';

test('extension entrypoint loads', async () => {
  const mod = await import('../index.ts');
  assert.equal(typeof mod.default, 'function');
});
