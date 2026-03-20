import type { BashLiveViewConfig } from './config.ts';

const PREFIX = '[bash-live-view]';

export function createDebugLogger(config: BashLiveViewConfig) {
  const enabled = config.debug || process.env.BASH_LIVE_VIEW_DEBUG === '1';
  return (...args: unknown[]) => {
    if (enabled) console.log(PREFIX, ...args);
  };
}
