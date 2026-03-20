import { Type } from '@sinclair/typebox';

export const bashLiveViewParams = Type.Object({
  command: Type.String({ description: 'Command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds' })),
  usePTY: Type.Optional(Type.Boolean({ description: 'Run inside a PTY with a live terminal widget for terminal-style output.' })),
});
