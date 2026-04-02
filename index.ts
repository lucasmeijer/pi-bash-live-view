import { createBashTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { createPtyBashOperations, executePtyCommand } from './pty-execute.ts';
import { ensureSpawnHelperExecutable } from './spawn-helper.ts';

const bashLiveViewParams = Type.Object({
  command: Type.String({ description: 'Command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds' })),
  usePTY: Type.Optional(Type.Boolean({ description: 'Run inside a PTY with a live terminal widget the user can see while its running. Use this when you suspect the program being ran has interesting ansi progress output, like buildsystems.' })),
});

ensureSpawnHelperExecutable();

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
      if (params.usePTY !== true) {
        return originalBash.execute(toolCallId, params, signal, onUpdate);
      }
      return executePtyCommand(toolCallId, params, signal, ctx);
    },
  });

  pi.on('user_bash', (_event, ctx) => {
    return {
      operations: createPtyBashOperations(ctx),
    };
  });

  pi.registerCommand('bash-pty', {
    description: 'Run a command through the PTY-backed bash path',
    handler: async (args, ctx) => {
      await runSlashCommand(args, ctx);
    },
  });
}
