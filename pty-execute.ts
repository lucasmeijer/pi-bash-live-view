import type { BashOperations, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { getShellConfig } from '@mariozechner/pi-coding-agent';
import { buildAbortError, buildExitCodeError, buildSuccessfulBashResult, buildTimeoutError } from './truncate.ts';
import { hideWidget, showWidget, type LiveSession } from './widget.ts';
import { PtyTerminalSession } from './pty-session.ts';

export const WIDGET_DELAY_MS = 100;
export const WIDGET_HEIGHT = 15;
export const DEFAULT_PTY_COLS = 100;
export const XTERM_SCROLLBACK_LINES = 100_000;

async function runPtyCommand(
  id: string,
  command: string,
  cwd: string,
  timeout: number | undefined,
  signal: AbortSignal,
  ctx: ExtensionContext,
) {
  const shellConfig = getShellConfig();
  const cols = DEFAULT_PTY_COLS;
  const rows = WIDGET_HEIGHT;
  const ptySession = new PtyTerminalSession({
    command,
    cwd,
    cols,
    rows,
    scrollback: XTERM_SCROLLBACK_LINES,
    shell: shellConfig.shell,
    shellArgs: shellConfig.args,
  });

  const session: LiveSession = {
    id,
    startedAt: Date.now(),
    rows,
    visible: false,
    disposed: false,
    session: ptySession,
  };

  const unsubscribe = ptySession.subscribe(() => {
    session.requestRender?.();
  });

  if (ctx.hasUI) {
    session.timer = setTimeout(() => showWidget(ctx, session), WIDGET_DELAY_MS);
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  let timedOut = false;
  let aborted = false;

  const kill = () => {
    ptySession.kill();
  };
  const onAbort = () => {
    aborted = true;
    kill();
  };

  if (timeout && timeout > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout * 1000);
  }
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const exit = await new Promise<{ exitCode: number | null }>((resolve) => {
      ptySession.addExitListener((exitCode) => resolve({ exitCode }));
    });

    await ptySession.whenIdle();
    const fullText = ptySession.getStrippedTextIncludingEntireScrollback();

    return {
      fullText,
      exitCode: exit.exitCode,
      timedOut,
      aborted,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    signal.removeEventListener('abort', onAbort);
    if (session.timer) clearTimeout(session.timer);
    session.disposed = true;
    hideWidget(ctx, session);
    unsubscribe();
    ptySession.dispose();
  }
}

export async function executePtyCommand(
  toolCallId: string,
  params: { command: string; timeout?: number },
  signal: AbortSignal,
  ctx: ExtensionContext,
) {
  const result = await runPtyCommand(toolCallId, params.command, ctx.cwd, params.timeout, signal, ctx);

  if (result.aborted) {
    throw buildAbortError(result.fullText);
  }
  if (result.timedOut && params.timeout && params.timeout > 0) {
    throw buildTimeoutError(result.fullText, params.timeout);
  }
  if (result.exitCode !== 0 && result.exitCode !== null) {
    throw buildExitCodeError(result.fullText, result.exitCode);
  }

  return buildSuccessfulBashResult(result.fullText);
}

export function createPtyBashOperations(ctx: ExtensionContext): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      const result = await runPtyCommand(
        `user-bash-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        command,
        cwd,
        timeout,
        signal ?? new AbortController().signal,
        ctx,
      );

      if (result.fullText) {
        onData(Buffer.from(result.fullText, 'utf8'));
      }
      if (result.aborted) {
        throw new Error('aborted');
      }
      if (result.timedOut) {
        throw new Error(`timeout:${timeout}`);
      }

      return { exitCode: result.exitCode };
    },
  };
}
