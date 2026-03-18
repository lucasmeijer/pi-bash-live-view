import { createBashTool, getShellConfig, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import stripAnsi from "strip-ansi";
import pty from "node-pty";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const CONFIG = loadConfig();
const WIDGET_PREFIX = "bash-pty/live/";
const sessions = new Map<string, LiveSession>();
let latestCtx: ExtensionContext | null = null;
const require = createRequire(import.meta.url);

function ensureSpawnHelperExecutable() {
  try {
    const base = path.dirname(require.resolve('node-pty/package.json'));
    for (const helper of [
      path.join(base, 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      path.join(base, 'prebuilds', 'darwin-x64', 'spawn-helper'),
    ]) {
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    }
  } catch (error) {
    debug('spawn-helper chmod failed', error);
  }
}

ensureSpawnHelperExecutable();

const bashParams = Type.Object({
  command: Type.String({ description: "Command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds" })),
  usePTY: Type.Optional(Type.Boolean({ description: "Run inside a PTY with a live terminal widget" })),
});

type Config = {
  widgetDelayMs: number;
  widgetHeight: number;
  testWidth: number;
  scrollbackLines: number;
  debug: boolean;
};

type FrameState = {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
};

type LiveSession = {
  id: string;
  command: string;
  startedAt: number;
  rows: number;
  cols: number;
  visible: boolean;
  disposed: boolean;
  timer?: NodeJS.Timeout;
  frame: FrameState;
  lastRenderedFrame: string[];
  inAltScreen: boolean;
  inSyncRender: boolean;
  ansiBuffer: string;
  transcript: TranscriptState;
  artifactsDir?: string;
  frameCounter: number;
};

type TranscriptState = {
  lines: string[];
  current: string;
  pendingCR?: boolean;
};

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

function sanitizeOutput(text: string) {
  return stripAnsi(text).replace(/\r/g, "").replace(/\u0000/g, "").replace(/\p{Cf}/gu, "");
}

function applyTranscriptChunk(state: TranscriptState, text: string) {
  for (const ch of text) {
    if (state.pendingCR && ch !== "\n") state.current = "";
    if (ch === "\r") {
      state.pendingCR = true;
      continue;
    }
    if (ch === "\n") {
      state.lines.push(state.current);
      state.current = "";
      state.pendingCR = false;
      continue;
    }
    if (ch === "\b") {
      state.current = state.current.slice(0, -1);
    } else if (ch >= " " || ch === "\t") {
      state.current += ch;
    }
    state.pendingCR = false;
  }
}

function finalizeTranscript(state: TranscriptState) {
  const lines = [...state.lines];
  if (state.current.length > 0) lines.push(state.current);
  const text = sanitizeOutput(lines.join("\n")).trimEnd();
  return text.length === 0 ? "(no output)" : `${text}\n`;
}

function stripControlForFrame(text: string) {
  return stripAnsi(text).replace(/\u0000/g, "").replace(/\p{Cf}/gu, "");
}

function detectModeTransitions(session: LiveSession, chunk: string) {
  session.ansiBuffer = (session.ansiBuffer + chunk).slice(-256);
  if (/\x1b\[\?1049h/.test(session.ansiBuffer) || /\x1b\[\?47h/.test(session.ansiBuffer) || /\x1b\[\?1047h/.test(session.ansiBuffer)) {
    session.inAltScreen = true;
  }
  if (/\x1b\[\?1049l/.test(session.ansiBuffer) || /\x1b\[\?47l/.test(session.ansiBuffer) || /\x1b\[\?1047l/.test(session.ansiBuffer)) {
    session.inAltScreen = false;
  }
  if (/\x1b\[\?2026h/.test(session.ansiBuffer)) {
    session.inSyncRender = true;
  }
  if (/\x1b\[\?2026l/.test(session.ansiBuffer)) {
    session.inSyncRender = false;
  }
}

function normalScreenPortion(startInAlt: boolean, chunk: string) {
  const enter = /\x1b\[\?(?:1049|1047|47)h/g;
  const exit = /\x1b\[\?(?:1049|1047|47)l/g;
  let out = '';
  let index = 0;
  let inAlt = startInAlt;
  while (index < chunk.length) {
    if (inAlt) {
      exit.lastIndex = index;
      const match = exit.exec(chunk);
      if (!match) break;
      index = match.index + match[0].length;
      inAlt = false;
      continue;
    }
    enter.lastIndex = index;
    const match = enter.exec(chunk);
    if (!match) {
      out += chunk.slice(index);
      break;
    }
    out += chunk.slice(index, match.index);
    index = match.index + match[0].length;
    inAlt = true;
  }
  return out;
}

function updateFrame(session: LiveSession, chunk: string) {
  const clean = stripControlForFrame(chunk);
  if (!clean) return;
  const parts = clean.replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (parts.length === 0) return;
  session.frameLines.push(...parts);
  const max = session.rows;
  if (session.frameLines.length > max) {
    session.frameLines.splice(0, session.frameLines.length - max);
  }
  if (!session.inSyncRender) {
    session.lastRenderedFrame = [...session.frameLines];
  }
}

function getRenderableLines(session: LiveSession) {
  return session.inSyncRender ? session.lastRenderedFrame : session.frame.lines;
}

function makeWidgetFactory(session: LiveSession) {
  return (_tui: any, theme: any) => ({
    invalidate() {},
    render(width: number) {
      const elapsed = ((Date.now() - session.startedAt) / 1000).toFixed(1);
      const innerWidth = Math.max(10, width - 4);
      const header = ` Live terminal ${elapsed}s `;
      const top = theme.fg("accent", `┌${header}${"─".repeat(Math.max(0, width - 2 - header.length))}┐`);
      const bottom = theme.fg("accent", `└${"─".repeat(Math.max(0, width - 2))}┘`);
      const lines = getRenderableLines(session).slice(-session.rows);
      const body: string[] = [];
      for (let i = 0; i < session.rows; i++) {
        const line = (lines[i] ?? "").slice(0, innerWidth).padEnd(innerWidth, " ");
        body.push(theme.fg("accent", "│ ") + line + theme.fg("accent", " │"));
      }
      return [top, ...body, bottom];
    },
  });
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
  const shellConfig = getShellConfig(ctx.cwd);
  const cols = CONFIG.testWidth;
  const rows = CONFIG.widgetHeight;
  const session: LiveSession = {
    id: toolCallId,
    command: params.command,
    startedAt: Date.now(),
    cols,
    rows,
    visible: false,
    disposed: false,
    frame: createFrameState(),
    lastRenderedFrame: [],
    inAltScreen: false,
    inSyncRender: false,
    ansiBuffer: "",
    transcript: { lines: [], current: "" },
    frameCounter: 0,
  };
  sessions.set(toolCallId, session);

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
  const chunks: string[] = [];

  const kill = () => {
    try {
      child.kill();
    } catch {}
  };

  if (params.timeout && params.timeout > 0) {
    timeoutHandle = setTimeout(kill, params.timeout * 1000);
  }
  signal.addEventListener("abort", kill, { once: true });

  const exit = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
    child.onData((chunk) => {
      chunks.push(chunk);
      const startedAlt = session.inAltScreen;
      detectModeTransitions(session, chunk);
      updateFrame(session, chunk);
      const visibleNormal = normalScreenPortion(startedAlt, chunk);
      if (visibleNormal) {
        applyTranscriptChunk(session.transcript, stripAnsi(visibleNormal));
      }
    });
    child.onExit((event) => resolve({ exitCode: event.exitCode }));
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (session.timer) clearTimeout(session.timer);
  session.disposed = true;
  hideWidget(ctx, session);
  sessions.delete(toolCallId);

  const fullText = finalizeTranscript(session.transcript);
  const truncation = truncateHead(fullText, DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES);
  return {
    content: [{ type: "text" as const, text: truncation.content }],
    details: {
      truncation,
      exitCode: exit.exitCode,
      usedPTY: true,
      rawChunkCount: chunks.length,
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

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
  });
  pi.on("session_switch", async (_event, ctx) => {
    latestCtx = ctx;
  });

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
