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

### Run tests

```bash
npm test
```

Note: the current repo has a test script placeholder, but most verification currently happens through `npm run report`.

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

- GIF/frame generation is intended to be close to production widget rendering.
- The report pipeline now uses `xterm-headless` to derive terminal frame snapshots before converting widget lines into PNGs/GIFs.
- The report rasterizer still converts ANSI-colored widget lines directly into PNGs instead of screenshotting HTML for GIF frames.
- `xterm-headless` currently needs a small `globalThis.window = {}` shim in this repo's Node report runner before requiring it.
- The final browser screenshot is still used for verifying the master HTML review page.

## Known current gaps

- `xterm-headless` is still not fully integrated for true terminal-state transcript extraction.
- The live widget implementation is still simplified compared to the target in `PLAN.md`.
- End-to-end pi-driven validation still needs more work.
