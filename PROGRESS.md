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
- updated the master report generator so rerunning everything is just `npm run report`
- updated the master report to embed the actual fixture source code for each custom program
- regenerated artifacts and manually confirmed from frame screenshots that spinner/spill/alt-progress now show ANSI colors, while `curl` and `ffmpeg` show real multi-second progress states
- manually spot-checked sample frames for spinner/alt-only/ffmpeg and confirmed the report page renders in a browser screenshot
- updated `PLAN.md` to reflect that it remains the target architecture/spec and that the current repo only partially implements it

## Current gaps

- transcript fidelity is still simplified; it is not yet true `xterm-headless` normal-screen + scrollback extraction
- widget rendering is still simplified rather than full xterm cell/color rendering inside the real pi TUI component model
- end-to-end pi-driven override validation still needs refinement
- built-in bash parity for truncation/temp-file behavior is still incomplete
- multi-widget stacking/order behavior has not been proven with dedicated e2e coverage

## Candidate follow-up tasks

- integrate `xterm-headless` for real terminal-state rendering and final transcript extraction
- replace the current simplified live widget with a proper custom TUI component that renders true cell colors/styles from terminal state
- implement synchronized-render (`CSI ? 2026 h/l`) snapshot locking exactly as specified in `PLAN.md`
- add production-like truncation/temp-file parity tests and behavior checks against built-in bash
- add explicit concurrent PTY session tests for stacking, delay, and cleanup behavior
- add real end-to-end pi-driven tests for the overridden `bash` tool and `/bash-pty`
- make the report call out expected PTY vs built-in differences more explicitly per case
- improve the rasterizer so the test artifact renderer matches pi theme/border styling more closely
