# AGENTS.md

## Repo purpose

This repo contains the `bash-live-view` pi extension.

It overrides model-facing `bash` with an optional PTY-backed execution path via `usePTY: true`, plus a live terminal widget for longer-running terminal-style commands.

## Working conventions

- Keep this file current with practical maintainer commands and workflows.
- Keep public-user documentation in `README.md`.
- Keep publishable package metadata in `package.json` aligned with the actual shipped file layout.
- When changing install, packaging, or testing workflows, update this file in the same change.

## Useful commands

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test
```

Tests run via Node's built-in test runner against files in `tests/*.test.mjs`.

### Reload the extension in pi

Inside pi:

```text
/reload
```

### Test the PTY path manually

Inside pi:

```text
/bash-pty htop
```

or:

```text
/bash-pty curl -L https://example.com/file -o /tmp/file
```

### Verify published package contents locally

```bash
npm pack --dry-run
```

## Important implementation notes

- The live widget is backed by the shared `xterm-headless` emulator in `src/terminal-emulator.js`.
- pi TUI extensions render `string[]`, so the widget publishes ANSI-colored lines rather than raw terminal cells.
- The final textual tool result is derived from the retained normal-screen transcript, not from raw PTY bytes.
- `node-pty` may need the bundled macOS `spawn-helper` chmod fix; this is handled by `scripts/fix-spawn-helper.cjs` and `spawn-helper.ts`.

## Known current gaps

- transcript fidelity is still simplified relative to true xterm normal-screen + scrollback extraction
- width parity against real pi UI constraints still needs refinement
- end-to-end clean-install and public-registry validation still need more work
