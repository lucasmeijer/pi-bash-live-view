# bash-live-view

A pi extension that upgrades model-initiated `bash` calls with an optional PTY-backed live terminal view.

When a tool call uses `usePTY: true`, the command runs inside a real PTY, renders into an `xterm-headless` terminal emulator, and can appear in pi as a live terminal widget above the editor. This is useful for terminal-style programs, progress UIs, repaint-heavy tools, and full-screen-ish command behavior that plain pipe-based capture handles poorly.

## Why

Built-in `bash` is great for ordinary command output, but some commands behave much better when they think they are inside a terminal.

`bash-live-view` is for cases like:

- `htop`
- `ffmpeg`
- `curl` progress bars
- spinner/progress heavy CLIs
- tools that redraw lines with carriage returns
- tools that switch into alt-screen mode before printing final output

The extension keeps normal `bash` behavior as the default. PTY mode is opt-in through `usePTY: true`.

## Install

```bash
pi install npm:bash-live-view
```

## Requirements

- pi with extension support
- Node.js 20+
- `node-pty` prerequisites for your platform
- macOS is the primary tested platform right now

On macOS, make sure Xcode Command Line Tools are installed if native modules need to compile.

## Quick start

Ordinary commands should keep using regular `bash` behavior:

```ts
bash({ command: 'ls -la' })
bash({ command: 'npm test' })
```

Use PTY mode when terminal behavior matters:

```ts
bash({ command: 'htop', timeout: 3, usePTY: true })
bash({ command: 'ffmpeg -i input.mp4 output.mp4', usePTY: true })
bash({ command: 'curl https://example.com/large-file.zip -o /tmp/file.zip', usePTY: true })
```

For manual testing inside pi, use:

```text
/bash-pty <command>
```

Example:

```text
/bash-pty htop
```

## What it does

When `usePTY !== true`:

- the extension delegates to pi's normal `bash` behavior
- no live widget is shown
- this should behave like built-in `bash`

When `usePTY === true`:

- the command runs inside a PTY via `node-pty`
- PTY output is fed into `xterm-headless`
- a delayed live terminal widget may appear above the editor
- the final returned text is derived from the terminal emulator's retained normal-screen transcript
- alt-screen-only output is excluded from the final plain-text result

## When to use `usePTY:true`

Use it when:

- the command redraws the same line repeatedly
- the command shows a progress bar or spinner
- the command behaves differently when connected to a TTY
- you want the human to watch the command in a terminal-style view

Do not use it by default for every command.

Plain output-oriented commands are usually better without PTY mode:

- `rg`
- `find`
- `git diff`
- `cat`
- `npm test` when plain logs are all you need

## Live widget behavior

Current public behavior:

- widget title: `Live terminal`
- widget only appears for PTY-backed runs
- widget is delayed to avoid flashing for short commands
- terminal colors are preserved in the live widget
- widget disappears when the command exits
- `/bash-pty` uses the same PTY-backed execution path for manual testing

## Config

Configuration files are merged in this order:

- global: `~/.pi/agent/bash-live-view.json`
- project: `.pi/bash-live-view.json`

Project config overrides global config.

Example:

```json
{
  "widgetDelayMs": 500,
  "widgetHeight": 15,
  "testWidth": 100,
  "scrollbackLines": 10000,
  "debug": false
}
```

| Setting | Default | Description |
|---|---:|---|
| `widgetDelayMs` | `500` | Delay before showing the live widget |
| `widgetHeight` | `15` | PTY/widget height in rows |
| `testWidth` | `100` | Deterministic PTY width fallback |
| `scrollbackLines` | `10000` | Terminal emulator scrollback size |
| `debug` | `false` | Enable debug logging |

## How it works

```text
bash tool override
  -> usePTY !== true: delegate to normal pi bash
  -> usePTY === true: node-pty
                        -> xterm-headless
                        -> live widget in pi
                        -> plain-text transcript for final tool result
```

The live widget is for the human.
The final tool result is plain text for pi/model compatibility.

## Examples

### Progress-heavy command

```ts
bash({ command: 'ffmpeg -i in.mov out.mp4', usePTY: true })
```

### Full-screen-ish command with timeout capture

```ts
bash({ command: 'htop', timeout: 3, usePTY: true })
```

### Curl with progress bar

```ts
bash({ command: 'curl -L https://example.com/file -o /tmp/file', usePTY: true })
```

### Plain command that should stay non-PTY

```ts
bash({ command: 'git status' })
```

## Troubleshooting

### `node-pty` install/build problems

Make sure native build prerequisites are installed for your platform.

On macOS:

```bash
xcode-select --install
```

### PTY command works but no widget appears

Possible reasons:

- the command finished before `widgetDelayMs`
- pi is running without a usable interactive UI surface
- the command was not run with `usePTY: true`

### Need debug logs

Set:

```bash
BASH_LIVE_VIEW_DEBUG=1
```

## Limitations

- macOS is the primary tested target today
- transcript fidelity is good enough for current development, but still not perfect parity with every terminal behavior
- PTY width is currently fixed at spawn time
- the final text result intentionally differs from the live widget view

## Repository layout

Key files:

- `index.ts` — extension entrypoint
- `config.ts` — config loading and clamping
- `pty-execute.ts` — PTY-backed execution path
- `widget.ts` — live widget lifecycle
- `spawn-helper.ts` — native helper permission fix
- `src/terminal-emulator.js` — shared xterm-backed emulator
- `tests/` — automated tests
- `examples/` — install and usage examples

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```
