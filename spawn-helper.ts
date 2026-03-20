import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function ensureSpawnHelperExecutable(log?: (...args: unknown[]) => void) {
  try {
    const base = path.dirname(require.resolve('node-pty/package.json'));
    for (const helper of [
      path.join(base, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      path.join(base, 'prebuilds', 'darwin-x64', 'spawn-helper'),
    ]) {
      if (!fs.existsSync(helper)) continue;
      const mode = fs.statSync(helper).mode & 0o777;
      if (mode === 0o755) continue;
      fs.chmodSync(helper, 0o755);
      log?.('chmod', helper);
    }
  } catch (error) {
    log?.('spawn-helper chmod failed', error);
  }
}
