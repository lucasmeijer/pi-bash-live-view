import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_BASENAME = 'bash-live-view.json';

export type BashLiveViewConfig = {
  widgetDelayMs: number;
  widgetHeight: number;
  testWidth: number;
  scrollbackLines: number;
  debug: boolean;
};

export const DEFAULT_CONFIG: BashLiveViewConfig = {
  widgetDelayMs: 500,
  widgetHeight: 15,
  testWidth: 100,
  scrollbackLines: 10_000,
  debug: false,
};

export function getGlobalConfigPath() {
  return path.join(os.homedir(), '.pi', 'agent', CONFIG_BASENAME);
}

export function getProjectConfigPath(cwd: string) {
  return path.join(cwd, '.pi', CONFIG_BASENAME);
}

export function loadConfig(cwd = process.cwd()): BashLiveViewConfig {
  let merged = { ...DEFAULT_CONFIG };
  for (const file of [getGlobalConfigPath(), getProjectConfigPath(cwd)]) {
    try {
      if (!fs.existsSync(file)) continue;
      merged = { ...merged, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch (error) {
      console.warn(`[bash-live-view] failed to load config ${file}:`, error);
    }
  }

  return {
    widgetDelayMs: clampInt(merged.widgetDelayMs, DEFAULT_CONFIG.widgetDelayMs, 0, 60_000),
    widgetHeight: clampInt(merged.widgetHeight, DEFAULT_CONFIG.widgetHeight, 5, 60),
    testWidth: clampInt(merged.testWidth, DEFAULT_CONFIG.testWidth, 20, 300),
    scrollbackLines: clampInt(merged.scrollbackLines, DEFAULT_CONFIG.scrollbackLines, 100, 100_000),
    debug: merged.debug === true,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
