import type { BashLiveViewConfig } from './config.ts';

const PREFIX = '[pi-bash-live-view]';

export function createDebugLogger(config: BashLiveViewConfig) {
  const enabled = config.debug || process.env.PI_BASH_LIVE_VIEW_DEBUG === '1';
  return (...args: unknown[]) => {
    if (enabled) console.log(PREFIX, ...args);
  };
}
