import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../config.ts';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README documents all public config keys', () => {
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.match(readme, new RegExp(`\`${key}\``), `README is missing config key ${key}`);
  }
});
