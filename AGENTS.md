# AGENTS.md

## Repo purpose

This repo is an in-progress pi extension that overrides the model-facing `bash` tool with an optional PTY-backed execution path and live terminal widget/reporting workflow.

## Working conventions

- Keep `PLAN.md` current as the target architecture/spec.
- Keep `PROGRESS.md` current with what has actually been implemented.
- Keep this file current with practical commands/tooling that are useful while working on the repo.
- When adding or changing tooling workflows, update this file in the same change.

## Useful commands

### Install dependencies

```bash
npm install
```

### Regenerate the full report/artifacts

```bash
npm run report
```

This currently:
- runs the fixture/command matrix
- regenerates files in `artifacts/`
- rebuilds animated GIFs
- rebuilds `artifacts/master-report.html`
- rebuilds `artifacts/master-report.png`
- rebuilds `artifacts/reusable-live-widget-api.html`

### Run tests

```bash
npm test
```

Tests now run via Node's built-in test runner against files in `testing/*.test.mjs`. Report generation is still useful for visual/manual verification through `npm run report`.

### Inspect the generated report

Open:
- `artifacts/master-report.html`
- `artifacts/master-report.png`

### Check spinner frames quickly

Useful files after `npm run report`:
- `artifacts/spinner-normal-then-text-frames/000.png`
- `artifacts/spinner-normal-then-text-frames/007.png`
- `artifacts/spinner-normal-then-text-frames/014.png`

### Check long-running progress cases

Useful files after `npm run report`:
- `artifacts/curl-frames/010.png`
- `artifacts/ffmpeg-frames/014.png`

### Reload the extension in pi

Inside pi:

```text
/reload
```

## Important implementation notes

- The live widget and the report/test pipeline now share the same reusable `xterm-headless`-backed terminal emulator in `src/terminal-emulator.js`.
- That shared component now exposes terminal-emulator-flavored APIs like `consumeProcessStdout()`, `getViewportAsAnsiLines()`, and `getStrippedTextIncludingEntireScrollback()`.
- pi TUI components render `string[]`, so the live widget currently converts xterm viewport state into ANSI-colored lines instead of drawing raw terminal cells directly.
- GIF/frame generation is intended to be close to production widget rendering.
- The report rasterizer still converts ANSI-colored widget lines directly into PNGs/GIFs instead of screenshotting HTML for GIF frames.
- `xterm-headless` currently needs a small `globalThis.window = {}` shim before requiring it; `src/terminal-emulator.js` handles that centrally.
- The final browser screenshot is still used for verifying the master HTML review page.

## Known current gaps

- transcript fidelity is still simplified; it is not yet true normal-screen + scrollback extraction from `xterm-headless` state
- the shared terminal emulator still returns ANSI viewport lines because pi's public TUI component API is string-based
- end-to-end pi-driven validation still needs more work
