import { createBashTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@mariozechner/pi-coding-agent';
import { loadConfig } from './config.ts';
import { createDebugLogger } from './debug.ts';
import { executePtyCommand } from './pty-execute.ts';
import { ensureSpawnHelperExecutable } from './spawn-helper.ts';
import { bashLiveViewParams } from './tool-schema.ts';

const config = loadConfig();
const debug = createDebugLogger(config);

ensureSpawnHelperExecutable(debug);

async function runSlashCommand(args: string, ctx: ExtensionCommandContext) {
  const command = args.trim();
  if (!command) {
    ctx.ui.notify('Usage: /bash-pty <command>', 'error');
    return;
  }
  const result = await executePtyCommand(
    `slash-${Date.now()}`,
    { command },
    new AbortController().signal,
    ctx as unknown as ExtensionContext,
    config,
  );
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '(no output)';
  ctx.ui.notify(text.slice(0, 4000), 'info');
}

export default function bashLiveView(pi: ExtensionAPI) {
  const originalBash = createBashTool(process.cwd());

  pi.registerTool({
    name: 'bash',
    label: 'bash',
    description: `${originalBash.description} Supports optional usePTY=true live terminal rendering for terminal-style programs and richer progress UIs.`,
    parameters: bashLiveViewParams,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      debug('bash', toolCallId, params);
      if (params.usePTY !== true) {
        return originalBash.execute(toolCallId, params, signal, onUpdate);
      }
      return executePtyCommand(toolCallId, params, signal, ctx, config);
    },
  });

  pi.registerCommand('bash-pty', {
    description: 'Run a command through the PTY-backed bash path',
    handler: async (args, ctx) => {
      await runSlashCommand(args, ctx);
    },
  });
}
