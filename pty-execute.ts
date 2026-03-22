import { getShellConfig, type ExtensionContext } from '@mariozechner/pi-coding-agent';
import { buildAbortError, buildExitCodeError, buildInteractiveStdinError, buildSuccessfulBashResult, buildTimeoutError } from './truncate.ts';
import { hideWidget, showWidget, type LiveSession } from './widget.ts';
import { PtyTerminalSession } from './pty-session.ts';

export const WIDGET_DELAY_MS = 100;
export const WIDGET_HEIGHT = 15;
export const DEFAULT_PTY_COLS = 100;
export const XTERM_SCROLLBACK_LINES = 100_000;
export const INPUT_IDLE_ABORT_MS = 2_000;
export const INPUT_IDLE_POLL_MS = 250;

const INTERACTIVE_PROMPT_PATTERNS = [
  /\b(?:password|passphrase|username|otp|token|verification code|pin)\b/iu,
  /\bpress (?:enter|return|any key)\b/iu,
  /\[(?:y\/n|Y\/n|y\/N|Y\/N|yes\/no|Yes\/No|YES\/NO)\]\s*$/u,
  /\((?:y\/n|Y\/n|y\/N|Y\/N|yes\/no|Yes\/No|YES\/NO)\)\s*$/u,
  /\b(?:continue|proceed|install|overwrite|replace|delete|remove|retry|accept|allow|trust)\b.*\?\s*$/iu,
  /\b(?:enter|input|type|provide|choose|select|pick|confirm|paste|repeat)\b.*:\s*$/iu,
];

function snapshotLineToPlainText(line: ReturnType<PtyTerminalSession['getViewportSnapshot']>[number]) {
  return line.map((cell) => cell.ch).join('').replace(/\s+$/u, '');
}

function getPromptCandidate(ptySession: PtyTerminalSession) {
  const lines = ptySession.getViewportSnapshot().map(snapshotLineToPlainText);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim();
    if (line) return line.replace(/\s+/gu, ' ').slice(0, 240);
  }
  return '';
}

export function looksLikeInteractivePrompt(text: string, endedWithNewline: boolean) {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  if (!normalized) return false;
  if (INTERACTIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return !endedWithNewline
    && /[:>?\]]$/u.test(normalized)
    && /\b(?:password|passphrase|username|otp|token|pin|code|choice|selection|confirm|continue|proceed|retry|trust|accept|allow)\b/iu.test(normalized);
}

export async function executePtyCommand(
  toolCallId: string,
  params: { command: string; timeout?: number },
  signal: AbortSignal,
  ctx: ExtensionContext,
) {
  const shellConfig = getShellConfig();
  const cols = DEFAULT_PTY_COLS;
  const rows = WIDGET_HEIGHT;
  const ptySession = new PtyTerminalSession({
    command: params.command,
    cwd: ctx.cwd,
    cols,
    rows,
    scrollback: XTERM_SCROLLBACK_LINES,
    shell: shellConfig.shell,
    shellArgs: shellConfig.args,
  });

  const session: LiveSession = {
    id: toolCallId,
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
  let promptWatchHandle: NodeJS.Timeout | undefined;
  let timedOut = false;
  let aborted = false;
  let interactiveWait: { prompt: string; idleMs: number } | undefined;

  const kill = () => {
    ptySession.kill();
  };
  const onAbort = () => {
    aborted = true;
    kill();
  };

  if (params.timeout && params.timeout > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      kill();
    }, params.timeout * 1000);
  }

  promptWatchHandle = setInterval(() => {
    if (aborted || timedOut || interactiveWait || ptySession.exited) return;
    const idleMs = Date.now() - ptySession.getLastOutputAt();
    if (idleMs < INPUT_IDLE_ABORT_MS) return;
    const prompt = getPromptCandidate(ptySession);
    if (!looksLikeInteractivePrompt(prompt, ptySession.getLastChunkEndedWithNewline())) return;
    interactiveWait = { prompt, idleMs };
    kill();
  }, INPUT_IDLE_POLL_MS);
  promptWatchHandle.unref?.();

  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const exit = await new Promise<{ exitCode: number | null }>((resolve) => {
    ptySession.addExitListener((exitCode) => resolve({ exitCode }));
  });

  await ptySession.whenIdle();
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (promptWatchHandle) clearInterval(promptWatchHandle);
  signal.removeEventListener('abort', onAbort);
  if (session.timer) clearTimeout(session.timer);
  session.disposed = true;
  hideWidget(ctx, session);
  unsubscribe();

  const fullText = ptySession.getStrippedTextIncludingEntireScrollback();
  ptySession.dispose();

  if (aborted) {
    throw buildAbortError(fullText);
  }
  if (interactiveWait) {
    throw buildInteractiveStdinError(fullText, interactiveWait.prompt, interactiveWait.idleMs);
  }
  if (timedOut && params.timeout && params.timeout > 0) {
    throw buildTimeoutError(fullText, params.timeout);
  }
  if (exit.exitCode !== 0 && exit.exitCode !== null) {
    throw buildExitCodeError(fullText, exit.exitCode);
  }

  return buildSuccessfulBashResult(fullText);
}
