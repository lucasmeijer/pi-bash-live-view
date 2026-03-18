# Progress

- initialized real tracking file from mistaken `PROGRESS.ms`
- inspected PLAN.md, current scaffold, and pi extension APIs
- replaced the demo extension with a first real `bash` override scaffold in `index.ts`
- added `usePTY?: boolean` branching, PTY-backed execution via `node-pty`, a delayed live widget, and a `/bash-pty` slash command
- added config loading from global/project json locations
- added initial fixture scripts and a first-cut artifact/report generator in `testing/run-report.mjs`
- added the macOS `node-pty` spawn-helper chmod workaround so report generation actually runs here
- verified report generation end-to-end and produced `artifacts/master-report.html`, `artifacts/master-report.png`, per-case gif files, and sample frame pngs
- improved frame rendering so carriage-return spinner updates repaint a single terminal line instead of stacking history
- updated all fixture programs to branch on TTY presence so PTY-only behavior only happens in the PTY run, while the built-in bash comparison gets plain non-PTY-friendly output
- updated the master report generator so rerunning everything is just `npm run report`
- updated the master report to embed the actual fixture source code for each custom program
- regenerated artifacts and manually confirmed the spinner gif now looks correct via `artifacts/spinner-normal-then-text-frames/000.png`, `007.png`, and `014.png`
- manually spot-checked sample frames for spinner/alt-only/ffmpeg and confirmed the report page renders in a browser screenshot
- current gaps: transcript fidelity is still simplified (not true xterm state extraction yet), widget rendering is still simplified rather than full xterm cell/color rendering, and end-to-end pi-driven override validation still needs refinement
