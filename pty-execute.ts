import { getShellConfig, type ExtensionContext } from '@mariozechner/pi-coding-agent';
import pty from 'node-pty';
import { createTerminalEmulator } from './src/terminal-emulator.js';
import type { BashLiveViewConfig } from './config.ts';
import { truncateTranscript } from './truncate.ts';
import { hideWidget, showWidget, type LiveSession } from './widget.ts';

export async function executePtyCommand(
  toolCallId: string,
  params: { command: string; timeout?: number },
  signal: AbortSignal,
  ctx: ExtensionContext,
  config: BashLiveViewConfig,
) {
  const shellConfig = getShellConfig();
  const cols = config.testWidth;
  const rows = config.widgetHeight;
  const terminalEmulator = createTerminalEmulator({ cols, rows, scrollback: config.scrollbackLines });
  const session: LiveSession = {
    id: toolCallId,
    startedAt: Date.now(),
    rows,
    visible: false,
    disposed: false,
    terminalEmulator,
  };

  const unsubscribe = terminalEmulator.subscribe(() => {
    session.requestRender?.();
  });

  if (ctx.hasUI) {
    session.timer = setTimeout(() => showWidget(ctx, session), config.widgetDelayMs);
  }

  const child = pty.spawn(shellConfig.shell, [...shellConfig.args, params.command], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: ctx.cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const kill = () => {
    try {
      child.kill();
    } catch {}
  };

  if (params.timeout && params.timeout > 0) {
    timeoutHandle = setTimeout(kill, params.timeout * 1000);
  }
  signal.addEventListener('abort', kill, { once: true });

  const exit = await new Promise<{ exitCode: number | null }>((resolve) => {
    child.onData((chunk) => {
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
  const truncation = truncateTranscript(fullText);

  return {
    content: [{ type: 'text' as const, text: truncation.content }],
    details: {
      truncation,
      exitCode: exit.exitCode,
    },
  };
}
