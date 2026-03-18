import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const WIDGET_ID = "bash-terminal-widget";

function renderWidget(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;

  const theme = ctx.ui.theme;
  ctx.ui.setWidget(WIDGET_ID, [
    theme.fg("accent", "● bash-terminal-widget"),
    theme.fg("dim", "Hello from this repo."),
  ]);
}

export default function bashTerminal(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    renderWidget(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    renderWidget(ctx);
  });
}
