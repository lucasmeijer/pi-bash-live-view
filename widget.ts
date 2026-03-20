import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createTerminalEmulator } from './src/terminal-emulator.js';

export const WIDGET_PREFIX = 'pi-bash-live-view/live/';

type TerminalEmulator = ReturnType<typeof createTerminalEmulator>;

export type LiveSession = {
  id: string;
  startedAt: number;
  rows: number;
  visible: boolean;
  disposed: boolean;
  timer?: NodeJS.Timeout;
  terminalEmulator: TerminalEmulator;
  requestRender?: () => void;
};

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

export function showWidget(ctx: ExtensionContext, session: LiveSession) {
  if (!ctx.hasUI || session.visible || session.disposed) return;
  session.visible = true;
  ctx.ui.setWidget(`${WIDGET_PREFIX}${session.id}`, makeWidgetFactory(session));
}

export function hideWidget(ctx: ExtensionContext | null, session: LiveSession) {
  if (!ctx || !ctx.hasUI) return;
  ctx.ui.setWidget(`${WIDGET_PREFIX}${session.id}`, undefined);
}
