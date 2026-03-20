#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

try {
  const base = path.dirname(require.resolve('node-pty/package.json'));
  for (const helper of [
    path.join(base, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
    path.join(base, 'prebuilds', 'darwin-x64', 'spawn-helper'),
  ]) {
    if (!fs.existsSync(helper)) continue;
    const mode = fs.statSync(helper).mode & 0o777;
    if (mode !== 0o755) fs.chmodSync(helper, 0o755);
  }
} catch (error) {
  console.warn('[pi-bash-live-view] spawn-helper fix skipped:', error?.message ?? error);
}
