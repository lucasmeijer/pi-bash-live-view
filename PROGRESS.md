# Progress

## Done so far

- initialized real tracking file from mistaken `PROGRESS.ms`
- inspected `PLAN.md`, current scaffold, and pi extension APIs
- replaced the demo extension with a first real `bash` override scaffold in `index.ts`
- added `usePTY?: boolean` branching, PTY-backed execution via `node-pty`, a delayed live widget, and a `/bash-pty` slash command
- added config loading from global/project json locations
- added initial fixture scripts and a first-cut artifact/report generator in `testing/run-report.mjs`
- added the macOS `node-pty` spawn-helper chmod workaround so report generation actually runs here
- verified report generation end-to-end and produced `artifacts/master-report.html`, `artifacts/master-report.png`, per-case gif files, and sample frame pngs
- improved frame rendering so carriage-return spinner updates repaint a single terminal line instead of stacking history
- updated all fixture programs to branch on TTY presence so PTY-only behavior only happens in the PTY run, while the built-in bash comparison gets plain non-PTY-friendly output
- updated the custom fixtures to emit ANSI colors in PTY mode so the live widget/gif path can visually verify color handling while the final tool text stays stripped
- changed the `curl` and `ffmpeg` cases to long-running progress-producing commands so their PTY animations are observable for more than 5 seconds
- changed frame rasterization so gif/png generation no longer screenshots HTML; instead it converts ANSI widget lines directly into SVG/PNG images, which is much closer to how pi will actually render line output
- replaced the report runner's custom terminal-frame parser with `xterm-headless`-backed snapshotting, with a small Node-side `globalThis.window` shim so the package loads correctly here
- updated the master report generator so rerunning everything is just `npm run report`
- updated the master report to embed the actual fixture source code for each custom program
- regenerated artifacts and manually confirmed from frame screenshots that spinner/spill/alt-progress now show ANSI colors, while `curl` and `ffmpeg` show real multi-second progress states
- tightened widget border rendering in both the live widget and report renderer: body lines are now ANSI-truncated to the frame width, rounded corners are used, and the top border includes a right-aligned elapsed timer
- manually spot-checked sample frames for spinner/alt-only/ffmpeg and confirmed the report page renders in a browser screenshot
- refactored the xterm-backed widget/frame logic into a reusable shared module at `src/terminal-emulator.js`
- renamed that shared module around a terminal-emulator abstraction rather than a generic renderer
- the shared API now centers on `createTerminalEmulator()`, `consumeProcessStdout()`, `getViewportAsAnsiLines()`, and `getStrippedTextIncludingEntireScrollback()`
- switched the live widget in `index.ts` to use that shared terminal emulator instead of its old ad hoc frame logic
- switched `testing/run-report.mjs` to use that same shared terminal emulator for PTY feeding, frame capture, synchronized-render snapshot locking, and final transcript generation
- confirmed the architecture matches pi's public TUI model better: the widget is backed by xterm cell state internally, but pi components still render `string[]`, so the external widget surface remains ANSI-colored lines
- added `artifacts/reusable-live-widget-api.html`, a visual explainer of the shared terminal-emulator API and how runtime/tests consume it
- updated `PLAN.md` to reflect that it remains the target architecture/spec and that the current repo only partially implements it
- updated `PLAN.md` to require keeping `AGENTS.md` current with repo-local tooling commands/workflows
- added project-local `AGENTS.md` with the current working commands for install/report/reload/artifact inspection

## Current gaps

- transcript fidelity is still simplified; `getStrippedTextIncludingEntireScrollback()` is not yet true `xterm-headless` normal-screen + scrollback extraction
- viewport rendering is now correctly modeled as ANSI line output for pi's `render(width): string[]` API, but width parity and clipping behavior against the real pi surface still need tightening
- end-to-end pi-driven override validation still needs refinement
- built-in bash parity for truncation/temp-file behavior is still incomplete
- multi-widget stacking/order behavior has not been proven with dedicated e2e coverage
- the normal-screen transcript splitter still uses chunk-local alt-screen stripping logic, so true split-chunk alt-screen transcript fidelity remains incomplete even though mode state tracking is now streaming/parser-based

## Candidate follow-up tasks

1. upgrade `getStrippedTextIncludingEntireScrollback()` to read true normal-screen + scrollback state from `xterm-headless` instead of the current simplified transcript accumulator
2. add focused tests around `consumeProcessStdout()` for alt-screen transitions, synchronized rendering (`CSI ? 2026 h/l`), carriage-return repaint behavior, and split escape sequences across chunks
3. tighten width behavior so `getViewportAsAnsiLines()` matches live pi widget width constraints and border math as closely as possible
4. add production-like truncation/temp-file parity tests and behavior checks against built-in bash
5. add explicit concurrent PTY session tests for stacking, delay, cleanup, and deterministic start-order behavior
6. add real end-to-end pi-driven tests for the overridden `bash` tool and `/bash-pty`
7. make the report call out expected PTY vs built-in differences more explicitly per case
8. improve the rasterizer so the test artifact renderer matches pi theme/border styling more closely
Y vs built-in differences more explicitly per case
8. improve the rasterizer so the test artifact renderer matches pi theme/border styling more closely
