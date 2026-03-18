import { createBashTool, getShellConfig, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import pty from "node-pty";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createTerminalEmulator } from "./src/terminal-emulator.js";

const CONFIG = loadConfig();
const WIDGET_PREFIX = "bash-pty/live/";
const require = createRequire(import.meta.url);

type Config = {
  widgetDelayMs: number;
  widgetHeight: number;
  testWidth: number;
  scrollbackLines: number;
  debug: boolean;
};

type TerminalEmulator = ReturnType<typeof createTerminalEmulator>;

type LiveSession = {
  id: string;
  command: string;
  startedAt: number;
  rows: number;
  cols: number;
  visible: boolean;
  disposed: boolean;
  timer?: NodeJS.Timeout;
  terminalEmulator: TerminalEmulator;
  requestRender?: () => void;
};

const bashParams = Type.Object({
  command: Type.String({ description: "Command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  usePTY: Type.Optional(Type.Boolean({ description: "Run inside a PTY with a live terminal widget" })),
});

function ensureSpawnHelperExecutable() {
  try {
    const base = path.dirname(require.resolve("node-pty/package.json"));
    for (const helper of [
      path.join(base, "prebuilds", "darwin-arm64", "spawn-helper"),
      path.join(base, "prebuilds", "darwin-x64", "spawn-helper"),
    ]) {
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    }
  } catch (error) {
    debug("spawn-helper chmod failed", error);
  }
}

ensureSpawnHelperExecutable();

function loadConfig(): Config {
  const defaults: Config = {
    widgetDelayMs: 3000,
    widgetHeight: 15,
    testWidth: 100,
    scrollbackLines: 10000,
    debug: false,
  };
  const files = [
    path.join(os.homedir(), ".pi", "agent", "bash-pty.json"),
    path.join(process.cwd(), ".pi", "bash-pty.json"),
  ];
  let merged = { ...defaults };
  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        merged = { ...merged, ...JSON.parse(fs.readFileSync(file, "utf8")) };
      }
    } catch (error) {
      console.warn(`[bash-pty] failed to load config ${file}:`, error);
    }
  }
  merged.widgetDelayMs = clamp(merged.widgetDelayMs, 0, 60_000);
  merged.widgetHeight = clamp(merged.widgetHeight, 5, 60);
  merged.testWidth = clamp(merged.testWidth, 20, 300);
  merged.scrollbackLines = clamp(merged.scrollbackLines, 100, 100_000);
  return merged;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function debug(...args: unknown[]) {
  if (CONFIG.debug || process.env.BASH_PTY_DEBUG === "1") {
    console.log("[bash-pty]", ...args);
  }
}

function makeWidgetFactory(session: LiveSession) {
  return (tui: any) => {
    session.requestRender = () => tui.requestRender();
    return {
      invalidate() {},
      render(width: number) {
        return session.terminalEmulator.getViewportAsAnsiLines({
          width,
          rows: session.rows,
          elapsedMs: Date.now() - session.startedAt,
        });
      },
    };
  };
}

function showWidget(ctx: ExtensionContext, session: LiveSession) {
  if (!ctx.hasUI || session.visible || session.disposed) return;
  session.visible = true;
  ctx.ui.setWidget(`${WIDGET_PREFIX}${session.id}`, makeWidgetFactory(session));
}

function hideWidget(ctx: ExtensionContext | null, session: LiveSession) {
  if (!ctx || !ctx.hasUI) return;
  ctx.ui.setWidget(`${WIDGET_PREFIX}${session.id}`, undefined);
}

async function executePty(toolCallId: string, params: { command: string; timeout?: number }, signal: AbortSignal, ctx: ExtensionContext) {
  const shellConfig = getShellConfig();
  const cols = CONFIG.testWidth;
  const rows = CONFIG.widgetHeight;
  const terminalEmulator = createTerminalEmulator({ cols, rows, scrollback: CONFIG.scrollbackLines });
  const session: LiveSession = {
    id: toolCallId,
    command: params.command,
    startedAt: Date.now(),
    cols,
    rows,
    visible: false,
    disposed: false,
    terminalEmulator,
  };

  const unsubscribe = terminalEmulator.subscribe(() => {
    session.requestRender?.();
  });

  if (ctx.hasUI) {
    session.timer = setTimeout(() => showWidget(ctx, session), CONFIG.widgetDelayMs);
  }

  const child = pty.spawn(shellConfig.shell, [...shellConfig.args, params.command], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: ctx.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  let rawChunkCount = 0;

  const kill = () => {
    try {
      child.kill();
    } catch {}
  };

  if (params.timeout && params.timeout > 0) {
    timeoutHandle = setTimeout(kill, params.timeout * 1000);
  }
  signal.addEventListener("abort", kill, { once: true });

  const exit = await new Promise<{ exitCode: number | null }>((resolve) => {
    child.onData((chunk) => {
      rawChunkCount += 1;
      void terminalEmulator.consumeProcessStdout(chunk, { elapsedMs: Date.now() - session.startedAt });
    });
    child.onExit((event) => resolve({ exitCode: event.exitCode }));
  });

  await terminalEmulator.whenIdle();
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (session.timer) clearTimeout(session.timer);
  session.disposed = true;
  hideWidget(ctx, session);
  unsubscribe();

  const fullText = terminalEmulator.getStrippedTextIncludingEntireScrollback();
  terminalEmulator.dispose();
  const truncation = truncateHead(fullText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  return {
    content: [{ type: "text" as const, text: truncation.content }],
    details: {
      truncation,
      exitCode: exit.exitCode,
      usedPTY: true,
      rawChunkCount,
    },
  };
}

async function runSlashCommand(args: string, ctx: ExtensionCommandContext) {
  const command = args.trim();
  if (!command) {
    ctx.ui.notify("Usage: /bash-pty <command>", "error");
    return;
  }
  const result = await executePty(`slash-${Date.now()}`, { command }, new AbortController().signal, ctx as unknown as ExtensionContext);
  const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
  ctx.ui.notify(text.slice(0, 4000), "info");
}

export default function bashTerminal(pi: ExtensionAPI) {
  const originalBash = createBashTool(process.cwd());

  pi.registerTool({
    name: "bash",
    label: "bash",
    description: `${originalBash.description} Supports an optional usePTY=true mode for PTY-backed execution with a live terminal widget.`,
    parameters: bashParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      debug("bash", toolCallId, params);
      if (params.usePTY !== true) {
        return originalBash.execute(toolCallId, params, signal, onUpdate);
      }
      return executePty(toolCallId, params, signal, ctx);
    },
  });

  pi.registerCommand("bash-pty", {
    description: "Run a command through the PTY-backed bash path",
    handler: async (args, ctx) => {
      await runSlashCommand(args, ctx);
    },
  });
}
