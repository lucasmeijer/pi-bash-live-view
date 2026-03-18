# PLAN.md — PTY-backed override of pi's `bash` tool with live terminal widgets

## Goal

Implement a pi extension in this repo that overrides the built-in `bash` tool for **model-initiated tool calls only**, adding an optional `usePTY?: boolean` parameter.

When `usePTY !== true`, execution should follow pi's normal built-in bash behavior as closely as possible.

When `usePTY === true`, execution should:

- spawn the command inside a real PTY via `node-pty`
- feed the PTY byte stream into `xterm-headless`
- maintain a live, full-color terminal widget rendered as a **proper custom TUI component**
- only show that widget after a configurable delay (default: 3s)
- support multiple concurrent PTY-backed bash calls with one widget per tool call, stacked vertically above the editor
- derive the final textual tool result from **xterm's normal-screen scrollback/final state**, explicitly excluding alt-screen content
- apply the same truncation/temp-file semantics as pi's normal built-in bash tool as closely as practical
- preserve built-in tool call/result rendering in pi's standard tool list UI

The implementation lands in **this repo** as a single extension package and may replace current experimental code in `index.ts`.

---

## Product decisions already fixed

These are explicit user decisions and should be treated as requirements.

### Scope

- Override tool name remains exactly `bash`.
- Only **model-initiated** `bash` tool calls are in scope.
- User `!` / `!!` bash handling is unchanged.
- Add `usePTY?: boolean` to the tool schema.
- `usePTY` defaults to `false`.
- If `usePTY` is omitted, use the original non-PTY bash code path.
- No heuristic PTY auto-enable in v1.
- Do **not** teach the model to use `usePTY` yet via prompt customization.

### Widget behavior

- Use a **proper custom TUI component** from the start, not string widgets.
- Widget title: `Live terminal`.
- Widget appears only after a configurable delay, default `3000ms`.
- If the command finishes before the delay, no widget is shown.
- Delay applies independently per PTY-backed tool call.
- Multiple concurrent PTY calls are supported.
- Their widgets stack vertically **in start order** above the editor.
- Widget disappears automatically when the command exits.
- Widget border should be a nice 1-cell border using theme-derived color.
- Show elapsed time in the border/header without consuming extra content rows if possible.
- No visible cursor rendering in v1.
- Preserve **full color** in the live widget.

### PTY sizing

- In normal pi usage, PTY width uses the width pi has available for the widget minus border space.
- PTY height default is `15` rows.
- Height is configurable.
- Width/height are fixed at spawn time in v1; no resize after spawn.
- In tests, width should be deterministic and chosen by the harness.

### Final textual result semantics

When `usePTY === true`, the final textual result is defined as:

> the text recoverable from xterm's **normal screen + scrollback** after command completion, explicitly excluding alt-screen content.

Further decisions:

- For normal-screen repaint/spinner/progress UIs, only the **final normal-screen history/state** should matter, not every intermediate repaint frame.
- Alt-screen content is **never** included in the final textual result.
- If the command uses only alt-screen and leaves no normal-screen textual output, final result should be exactly `(no output)`.
- If a leftover spinner/progress line still remains in the final normal-screen scrollback/state, keep it.
- Strip ANSI and sanitize the final textual result like built-in bash.
- Apply the same truncation thresholds/notice/temp-file semantics as built-in bash as closely as practical.
- Do **not** add PTY-specific metadata to the returned tool result details. Keep shape aligned with built-in bash.

### Environment and execution semantics

- `usePTY:true` must always use the PTY + xterm path internally, even if pi itself has no parent TTY.
- If pi has no UI / no usable live TUI surface, suppress widget display but still run through PTY + xterm.
- Preserve `CI=1` if present.
- Set terminal env so color-capable tools know they can render colors.
- Set `COLORTERM=truecolor`.
- Copy pi's shell resolution logic into the extension, with a large comment documenting where it came from.
- Match built-in bash timeout/abort/kill semantics as closely as possible.
- If PTY initialization fails and `usePTY:true` was explicitly requested, fail execution.

### Rendering integration

- Keep built-in pi tool call/result rendering.
- No custom tool-call renderer needed.
- It is acceptable that the standard pi tool UI does not visually indicate `usePTY:true`.

### Test infrastructure

- Need both direct/integration tests and a smaller number of end-to-end pi-driven tests.
- Test matrix must include: `curl`, `ffmpeg`, `htop`, plus custom controlled fixture programs.
- Create a master HTML report for human review.
- It should let the reviewer compare:
  - animated GIFs of the bordered live widget
  - final non-truncated/truncated textual output
  - our PTY-backed bash vs built-in bash
- Comparison against built-in bash should exist for all tests, even if some differences are expected/interesting.
- Add a manual slash command `/bash-pty` for easy PTY execution during development.
- Logging/debugging should follow the conventions/patterns of `nicobailon/pi-interactive-shell` as closely as practical.

---

## External reference incorporated during planning

The referenced `nicobailon/pi-interactive-shell` repo was cloned and inspected during planning.

Key patterns to adopt from it:

1. modular repo-local extension layout
2. global + project JSON config merge with clamping
3. minimal runtime logging
4. `ctx.ui.setWidget(key, factory)` with `tui.requestRender()`-driven updates
5. macOS `node-pty` spawn-helper permission fix
6. focused utility modules with direct vitest coverage

---

## High-level architecture

## 1. Tool override strategy

Override the built-in `bash` tool by registering a tool with the same name.

Implementation pattern:

- create a local reference to pi's built-in-style bash implementation for fallback behavior
- preserve the same description and base parameter contract, but extend schema with `usePTY?: boolean`
- branch execution:
  - `usePTY !== true` -> original non-PTY path
  - `usePTY === true` -> PTY + xterm path

Key point: we are **not** intercepting with `tool_call` hooks. We are overriding the tool itself, which is the supported seam for model-initiated tool behavior changes.

---

## 2. Code layout in this repo

Refactor this repo into a single extension package with internal modules.

Proposed structure:

```text
./index.ts                         # extension entry point
./src/
  config.ts                        # config loading / defaults / merge / clamp
  copied-shell.ts                  # copied/adapted shell resolution logic from pi
  spawn-helper.ts                  # macOS node-pty spawn-helper permission fix (adapted from pi-interactive-shell)
  debug.ts                         # tiny debug helper, low-noise by default
  bash/
    override.ts                    # bash tool registration
    builtin-fallback.ts            # normal bash fallback wrapper
    pty-execute.ts                 # PTY execution path
    pty-kill.ts                    # kill semantics helpers
    xterm-transcript.ts            # extract final normal-screen transcript from xterm
    truncation.ts                  # built-in-compatible truncation/temp-file helpers
  ui/
    live-terminal-manager.ts       # tracks active PTY sessions/widgets
    live-terminal-widget.ts        # custom TUI component factory
    terminal-snapshot.ts           # snapshot xterm active buffer into colored lines/cells
    border-theme.ts                # widget border/theme helpers
  testing/
    harness.ts                     # programmatic test runner
    pi-e2e.ts                      # end-to-end pi-driven tests
    report.ts                      # master HTML report generator
    gif.ts                         # GIF rendering from widget frames
    fixtures/
      spill.ts
      spinner-normal-then-text.ts
      alt-progress-then-text.ts
      common.ts
./config/
  bash-pty.json                    # extension config file
./artifacts/                       # generated test artifacts (gitignored)
./PLAN.md
```

If simpler during implementation, collapse some files, but keep these responsibilities separated.

---

## 3. Dependencies

Add extension-local dependencies:

- `node-pty`
- `xterm-headless`
- `strip-ansi` (if not already conveniently available)
- any small utility needed for GIF/report generation

Also verify whether xterm addon(s) are needed for serialize/export. Prefer the lightest stack that works with `xterm-headless`.

Target platform in v1:

- macOS first
- keep code as cross-platform as practical
- leave source comments where behavior may differ on Linux/Windows

---

## 4. Config model

Follow the config pattern used by `pi-interactive-shell`.

Use two JSON config locations:

- global: `~/.pi/agent/bash-pty.json`
- project: `.pi/bash-pty.json`

Merge order:

- defaults
- global config
- project config

Clamp all numeric values after merge.

Initial config keys:

```json
{
  "widgetDelayMs": 3000,
  "widgetHeight": 15,
  "debug": false,
  "testWidth": 100
}
```

Use config file as the primary config surface in v1.

No slash-command options in `/bash-pty` yet.

Optional later fallback: env var overrides for debug only.

Add tests for:

- global/project config merge behavior
- clamping/default behavior
- docs/config parity if config is documented in README or SKILL

---

## Detailed implementation plan

## Phase A — baseline repo cleanup and scaffolding

### A1. Replace current experimental code

Current `index.ts` is a demo widget/tool. Replace it with the real extension entry point.

Tasks:

- remove the existing demo ticker/widget logic
- preserve nothing unless some utility is genuinely reusable
- create extension bootstrap that registers:
  - overridden `bash` tool
  - `/bash-pty` slash command
  - lifecycle cleanup hooks

### A2. Add package metadata for new dependencies

Update `package.json` to include the PTY/xterm/test/report dependencies.

### A3. Add gitignore entries

Ignore generated artifacts such as:

```text
artifacts/
*.gif
*.html
*.log
*.tmp
```

Adjust to keep committed fixtures separate from generated outputs.

---

## Phase B — shell and fallback parity

## B1. Copy/adapt pi shell resolution logic

Create `src/copied-shell.ts`.

Copy/adapt the relevant logic from pi's `dist/utils/shell.js` and document clearly at the top:

- original source path
- pi version inspected
- reason for copying instead of deep-importing
- note that updates may need to be synced if pi changes

Include only what we need:

- shell resolution
- PATH/env augmentation if needed
- process-tree kill helper or adapted equivalent

Do **not** deep-import pi internals unless a later implementation decision explicitly revisits this.

### B2. Decide fallback implementation form

For `usePTY !== true`, the fallback should reuse pi behavior as much as possible.

Preferred approach:

- create `originalBash = createBashTool(cwd)` via public API
- delegate directly to `originalBash.execute(...)`

This preserves built-in behavior for:

- spawn semantics
- truncation/temp-file details
- result shape
- built-in-compatible rendering behavior

Important: keep fallback branch as thin as possible.

---

## Phase C — overridden bash tool registration

## C1. Tool schema

Register a tool named `bash`.

Parameter schema should extend the built-in bash schema with:

- `command: string`
- `timeout?: number`
- `usePTY?: boolean`

Do not add any other public parameters in v1.

### C2. Description

Keep built-in description as the base. It is acceptable for the model not to be explicitly taught to use `usePTY` yet.

Do not modify prompt guidance in v1.

### C3. Execute branch

Pseudo-flow:

```ts
if (params.usePTY !== true) {
  return originalBash.execute(...);
}
return executePtyBash(...);
```

No custom `renderCall` or `renderResult` in v1.

---

## Phase D — PTY execution path

## D1. Spawn strategy

Use `node-pty` when `usePTY:true`.

Spawn characteristics:

- shell resolved via copied shell resolver
- execute equivalent of `shell -c command`
- cwd semantics should match built-in bash as closely as possible
- env preserved from current process, plus terminal vars
- width/height fixed at spawn time

Initial env behavior in PTY mode:

- preserve existing env, including `CI`
- set `TERM=xterm-256color`
- set `COLORTERM=truecolor`
- keep comments documenting tradeoffs

### D2. Width/height calculation

At PTY spawn time:

- width = available widget inner width from pi UI, minus left/right border space
- height = configured widget height, default `15`
- in test harness, width must be deterministic and not depend on host pi width

Important implementation detail:

- if exact width cannot be known until widget component exists, create the PTY session only after enough UI context is available to compute width
- alternatively, create width via TUI/query from current root width before PTY spawn
- if no UI is available, use a deterministic fallback width from config for PTY spawn, but do not show widget

Need this explicitly in code comments because the PTY width affects command formatting.

### D3. Abort / timeout / exit semantics

Match built-in bash behavior as closely as possible.

Requirements:

- wire `AbortSignal`
- kill on timeout
- kill on abort
- use process-tree / process-group semantics analogous to built-in bash
- test this on macOS explicitly

Implementation note:

PTY child kill semantics differ from plain `child_process.spawn`. The implementation should:

- attempt the closest PTY-compatible equivalent to pi's hard-kill behavior
- document any unavoidable platform-specific caveats
- add test coverage for process-tree termination expectations

### D4. Failure handling

If PTY initialization fails:

- reject/fail the tool call
- do not silently fall back to non-PTY execution when `usePTY:true`

---

## Phase E — xterm integration

## E1. Terminal instance per PTY tool call

Each `usePTY:true` execution owns:

- one `node-pty` instance
- one `xterm-headless` instance
- one UI session/widget state object
- one completion/finalization pipeline

### E2. Feed PTY output into xterm

All PTY data goes to xterm unstripped.

Do **not** strip ANSI/control sequences before writing to xterm.

This preserves:

- color
- cursor movement
- repaint behavior
- alt-screen switching
- terminal layout semantics

### E3. Alt-screen tracking

Even though final transcript comes from xterm's normal buffer/scrollback, track whether alt-screen was entered for debugging/tests and to reason about behavior.

However:

- do not expose PTY metadata in returned tool details
- do not include alt-screen frames in final textual result

Tracking may be implemented through:

- xterm parser hooks if available
- or explicit observation of known DEC private mode sequences in the incoming PTY stream

This tracking is mainly internal/test-only.

### E3b. Synchronized rendering / DECSET 2026 handling

Explicitly support synchronized terminal updates so the live widget does not snapshot half-painted frames.

Treat the synchronized rendering control sequences as first-class state in the PTY/xterm session:

- begin synchronized update: `CSI ? 2026 h`
- end synchronized update: `CSI ? 2026 l`

Requirements:

- maintain an internal boolean like `inSynchronizedRender`
- when a synchronized-update begin sequence has been seen without a matching end, the widget must **not** publish a new snapshot derived from the partially updated xterm state
- while inside the synchronized region, continue feeding bytes into xterm so its state stays current, but keep using the **previous completed snapshot** for UI rendering
- when the synchronized-update end sequence arrives, immediately mark the session/widget dirty and call `tui.requestRender()` so pi can render the newly completed frame

Important rendering contract:

- pi asks the widget to render
- widget attempts to snapshot the **very latest** xterm state
- if the session is currently inside a synchronized-update lock, widget must return the **last completed snapshot** instead of a fresh partial one
- this is specifically to avoid flicker and visible half-painted frames

Implementation notes:

- parsing should work even if begin/end sequences arrive split across PTY chunks
- keep the parser/state tracking separate from final transcript extraction
- synchronized rendering affects **live widget snapshot publication**, not final textual transcript generation
- add comments explaining that this is a flicker-avoidance mechanism, not an output-filtering mechanism

### E4. Scrollback length

Configure xterm scrollback to be very large.

Reason:

- final transcript source is xterm normal-screen scrollback/state
- tests need large retained history for spill/truncation cases

Set a generous default, e.g. many thousands of lines, and document memory tradeoffs.

Follow the `pi-interactive-shell` pattern of making scrollback configurable and clamped via config.

---

## Phase F — final transcript extraction from xterm

This is one of the most important parts of the implementation.

## F1. Definition of transcript source

At process completion, derive transcript from:

- xterm's **normal screen**
- plus xterm's **normal-screen scrollback/history retained after terminal operations**
- excluding alt-screen content

This is intentionally not a raw PTY byte transcript.

## F2. Extraction behavior

Implement a utility that extracts plain text lines from xterm's final normal-screen retained state.

Expected effects:

- normal output commands yield ordinary text transcript
- `\r` spinner/progress repaint loops collapse naturally to final retained state/history
- alt-screen-only UI yields no transcript and therefore becomes `(no output)`
- post-alt-screen normal output appears normally in the transcript

## F3. ANSI stripping / sanitization

After extracting text from xterm, apply built-in-like sanitization semantics:

- strip ANSI/control formatting sequences from the final textual result
- remove `\r`
- sanitize problematic control/unicode chars like pi's bash sanitization path

Important nuance:

- live widget uses full-color xterm state
- final transcript is plain sanitized text

### What pi's sanitizer does (must be documented in code)

Pi's bash sanitization path does approximately this:

1. decode bytes to text
2. strip ANSI escape sequences
3. sanitize binary/problematic characters via `sanitizeBinaryOutput()`
4. remove carriage returns

And `sanitizeBinaryOutput()` filters:

- most control characters except tab/newline/carriage return
- problematic Unicode format chars
- invalid/undefined code-point situations
- characters that can break width calculations or display

For PTY mode we do **not** sanitize before xterm, only after transcript extraction.

## F4. Empty-output rule

If extracted/sanitized transcript is empty, final textual result must be exactly:

```text
(no output)
```

This matches the user requirement and built-in bash convention.

---

## Phase G — truncation and temp-file semantics

## G1. Thresholds

Match built-in bash thresholds:

- ~50KB
- 2000 lines
- tail truncation semantics

## G2. Source text for truncation

Use the xterm-derived final transcript text as the pre-truncation source in PTY mode.

## G3. Temp file contents

The temp file should contain the same kind of thing normal bash effectively exposes for the final output path: the full plain text transcript after PTY/xterm derivation, before final truncation.

This means:

- not raw PTY bytes
- not alt-screen frames
- not colorized terminal cells
- yes to plain extracted text used for tool result generation

## G4. Notice formatting

Reuse built-in bash truncation notice style as closely as possible.

The returned tool result should still look/behave like built-in bash in pi UI.

### Implementation preference

If there is a public helper for truncation semantics, use it.
If not, copy the relevant logic/semantics into a local helper with a comment describing where it was copied/adapted from.

Do **not** deep-import unstable private internals without first revisiting the decision.

---

## Phase H — live widget system

## H1. Widget manager

Build a manager that tracks all active PTY-backed sessions.

Responsibilities:

- assign stable widget IDs per tool call
- track start time
- track whether the visibility delay has elapsed
- maintain start-order stacking
- register/unregister widgets with `ctx.ui.setWidget`
- suppress widget creation when no UI is available

## H2. Delay behavior

For each PTY tool call:

- start invisible
- after `widgetDelayMs` (default 3000), if still running and UI is available, show widget
- if command exits before delay, never show widget

This should be independent per tool call.

## H3. Placement and ordering

- placement: above editor
- order: vertical stack in PTY session start order

Implementation should use stable per-session widget keys so pi keeps deterministic ordering.

If pi's widget ordering semantics are not obvious, explicitly test and adapt.

## H4. Component rendering model

The widget should be a custom component factory passed through `ctx.ui.setWidget(key, factory)`.

Render-time model:

- PTY writes update xterm state
- PTY writes mark the component dirty / invalidate it
- manager/component keeps a `tui` reference as needed and calls `tui.requestRender()` on PTY updates, following the `pi-interactive-shell` widget pattern
- component snapshots xterm state during render
- no fixed rendering poll loop

This matches the chosen “snapshot on render” design.

### H4a. Last-completed-snapshot cache

To support synchronized rendering without flicker, each live terminal widget should maintain:

- `lastCompletedSnapshot`
- `lastCompletedSnapshotSize`
- `inSynchronizedRender`

Rendering behavior:

- if `inSynchronizedRender === false`, render may grab a fresh snapshot from xterm and replace `lastCompletedSnapshot`
- if `inSynchronizedRender === true`, render must **not** publish a newly grabbed partial frame; it must render `lastCompletedSnapshot`
- if no completed snapshot exists yet and synchronized mode is already active, render an empty/default terminal body inside the border rather than a half-painted frame

Update behavior:

- PTY data still flows into xterm immediately
- begin-sync sequence flips `inSynchronizedRender = true`
- end-sync sequence flips it back to `false` and triggers `tui.requestRender()` so the next render publishes the newly completed state

This cache is central to the no-flicker guarantee.

## H5. Border and header

Render a bordered terminal frame with:

- title: `Live terminal`
- theme-derived blue-ish/accent border color, ideally from current theme
- elapsed time embedded in border/header without consuming an extra content row

No visible cursor in v1.

## H6. Full-color snapshot rendering

Widget must preserve full color.

Plan:

- snapshot xterm buffer cell data at render time
- translate cell colors/attrs into pi-tui renderable ANSI/styled text lines
- maintain the terminal viewport area inside the border

If direct color cell extraction is awkward, adapt to the highest-fidelity rendering path available from `xterm-headless` + pi-tui.

Document any color limitations encountered.

### H6a. Flicker avoidance policy

A core UX requirement is: **do not flicker**.

Concretely:

- never publish partial terminal frames while an application is inside a synchronized rendering region
- favor slightly stale-but-complete frames over partially updated frames
- when synchronized rendering is not active, always try to render from the freshest xterm state available at render time

The intended behavior is:

1. PTY writes arrive and update xterm immediately
2. pi later asks the widget to render
3. widget grabs the freshest xterm state it can
4. if synchronized rendering is currently active, widget reuses the prior completed snapshot
5. when the synchronized end sequence arrives, widget requests a new render so pi can display the completed update promptly

This should be called out in source comments anywhere snapshot caching logic is implemented.

---

## Phase I — `/bash-pty` slash command

Add a development/manual-testing slash command:

```text
/bash-pty <command>
```

Behavior:

- runs the command through the same PTY-backed execution path as `bash` with `usePTY:true`
- no extra options in v1
- returns/output should mirror the tool implementation path as much as possible

Primary purpose:

- manual testing without waiting for model-emitted tool calls
- easier debugging of widget rendering and transcript behavior

---

## Phase J — no-UI / CI behavior

## J1. Internal consistency

When `usePTY:true`, always use PTY + xterm internally.

This is true even when:

- pi has no parent PTY
- pi is run in CI
- no live widget can be displayed

## J2. Widget suppression

If no UI or no usable interactive rendering surface is available:

- do not show widget
- still perform the exact same PTY/xterm execution and final transcript extraction path

This ensures behavior consistency across interactive vs CI/test contexts.

---

## Phase K — testing infrastructure

This should be strong enough to judge both terminal capture fidelity and final textual result quality.

## K1. Test types

Implement both, following the `pi-interactive-shell` precedent of testing focused modules directly with vitest in addition to higher-level behaviors:

### Direct/integration harness

Run the PTY executor and built-in fallback executor programmatically without requiring a full live pi session.

Use this for:

- fast iteration
- deterministic width/height
- fixture programs
- artifact generation

### End-to-end pi-driven tests

Run a smaller set through real pi/extension wiring to validate:

- actual tool override registration
- widget lifecycle integration
- concurrent PTY sessions
- built-in tool rendering compatibility

## K2. Deterministic test terminal size

Tests should pin width/height explicitly.

Do **not** depend on host pi width in tests.

Recommended test config:

- width from config, e.g. `100`
- height `15`

## K3. Fixture programs

Create controlled programs that alter behavior based on whether they have a PTY, just like real tools.

At least one fixture must explicitly exercise synchronized rendering begin/end behavior (`CSI ? 2026 h` / `CSI ? 2026 l`) so we can verify that the widget does not capture or publish half-painted frames.

Required fixtures:

### 1. `spill`

Purpose:

- generate enough retained normal-screen text to trigger truncation/temp-file semantics
- compare built-in bash vs PTY-backed bash spill behavior

Behavior:

- when no PTY: straightforward large output
- when PTY: still produce large normal-screen output retained in scrollback

### 2. `spinner-normal-then-text`

Purpose:

- emulate `curl`/progress-like normal-screen repaint behavior
- after a few seconds, stop spinner and print normal trailing text

Behavior:

- spinner/progress repaints on normal screen
- then prints stable lines afterwards
- adapts based on TTY presence

### 3. `alt-progress-then-text`

Purpose:

- enter alt-screen
- render progress there
- exit alt-screen
- print more normal output afterwards

This validates:

- alt-screen exclusion from final transcript
- post-alt-screen normal output retention

### 4. `synchronized-render`

Purpose:

- emit `CSI ? 2026 h`
- perform multiple visible screen updates that would look torn/flickery if captured mid-flight
- emit `CSI ? 2026 l`
- optionally repeat this a few times

This validates:

- the widget does not publish intermediate frames during synchronized rendering
- the widget publishes the updated frame after the end sequence
- render-time snapshotting plus cached completed-frame logic works as intended

Optional additional fixture if needed:

### 4. `alt-only`

Purpose:

- alt-screen-only UI with no normal output

Expected result:

- final textual result `(no output)`

## K4. Real-world commands

Include real command cases:

- `curl`
- `ffmpeg`
- `htop`

For commands that require environment/network/media specifics, the harness may need controlled inputs or skipped execution when unavailable. Document those assumptions.

## K5. Comparison model

For every test case, run both:

- PTY-backed overridden bash path
- built-in/non-PTY bash path

Even when outputs are expected to differ, include both in the report.

## K6. Artifact generation

For human evaluation, generate a master HTML report.

Per testcase capture:

- animated GIF of the **bordered live widget**, including title and elapsed-time border treatment
- PTY-backed final textual tool result
- built-in bash final textual result
- indicate whether outputs were truncated
- link to full captured artifacts if large

It is acceptable for the master report to hyperlink heavier detailed captures so the page stays manageable.

## K7. GIF generation strategy

The GIF should represent the widget as the user would see it, not just raw terminal content.

Meaning:

- include border
- include timer/elapsed display
- include viewport content
- use deterministic dimensions in tests

Implementation options:

- render frames from the same widget snapshot pipeline used by live component
- rasterize ANSI/color lines into images for GIF assembly

Do not capture PNG final frame separately in v1.

## K8. Report structure

Master HTML should, for each testcase, show:

- test name
- command
- whether PTY was used
- GIF preview or link
- PTY final output
- built-in bash final output
- truncation/full-output links if present
- notes for expected differences

This report is the main human review surface.

---

## Phase L — logging/debugging

## L1. Follow Nico-style conventions

`pi-interactive-shell` has now been inspected and the relevant conventions are:

- runtime logging is minimal by default
- serious failures use direct `console.error(...)` / `console.warn(...)`
- there is no heavyweight logger framework
- state is surfaced through UI/widgets where possible instead of log spam
- install/setup scripts use simple prefixed console logging

Mirror that style here.

## L2. Logging helper

Create a small logging module with:

- debug enablement from config and/or env
- prefixed logs for PTY session IDs/toolCallIds, e.g. `[bash-pty]`
- optional artifact/test logging hooks
- very low noise in normal runtime

Use direct `console.error(...)` / `console.warn(...)` for important failures and unexpected exceptions, consistent with the `pi-interactive-shell` style.

Do not emit user-facing noise unless debug is enabled.

---

## Acceptance criteria

Implementation is done when all of the following are true.

## Core behavior

- A tool named `bash` is registered and overrides built-in bash.
- Schema includes `usePTY?: boolean`.
- `usePTY !== true` follows built-in bash behavior via fallback path.
- `usePTY === true` runs via PTY + xterm.
- PTY init failure fails the tool call.
- Timeout/abort kill behavior matches built-in bash as closely as practical.

## Live widget behavior

- No widget is shown for PTY calls that complete before delay.
- Widget appears after delay for long-running PTY calls.
- Multiple concurrent PTY-backed commands produce multiple widgets.
- Widgets stack vertically above the editor in start order.
- Widget title is `Live terminal`.
- Widget border uses theme-derived color.
- Elapsed time is visible in the border/header.
- Widget preserves terminal colors.
- Widget disappears automatically on process exit.
- Widget rendering must honor synchronized terminal updates (`DECSET/DECRST 2026`) to avoid flicker:
  - do not publish new snapshots while synchronized rendering is active
  - continue showing the last completed snapshot instead
  - request a render when the synchronized-render end sequence arrives
- Synchronized-rendering test coverage exists and proves there are no half-painted snapshots during `CSI ? 2026 h` / `CSI ? 2026 l` regions.

## Final textual result behavior

- Final text comes from xterm normal screen + scrollback only.
- Alt-screen content is excluded.
- Alt-screen-only commands return exactly `(no output)`.
- Normal-screen repainting commands return final retained normal-screen text, not raw repaint history.
- ANSI is stripped and transcript sanitized.
- Truncation/temp-file behavior matches built-in bash thresholds and notice style.
- Returned result shape remains built-in-bash compatible, without extra PTY metadata.

## Testing/reporting

- Direct/integration harness exists.
- End-to-end pi tests exist.
- Fixture programs exist for spill, normal-screen spinner-then-text, and alt-progress-then-text.
- Real command coverage includes curl, ffmpeg, and htop.
- Deterministic-width test runs produce a master HTML report.
- Report includes GIFs of bordered widget and side-by-side PTY vs built-in outputs.

---

## Open implementation notes to document in code

These are not blockers; they are things the implementation should annotate clearly.

1. **Copied shell logic provenance**
   - include original pi file path/version
   - explain why copied instead of deep-imported

2. **Platform notes**
   - macOS first
   - where Linux/Windows behavior may differ

3. **PTY kill semantics caveats**
   - especially process-group/process-tree differences under PTY libraries

4. **xterm transcript rationale**
   - explain why final output is derived from normal-screen xterm scrollback rather than raw PTY bytes

5. **Widget visibility rationale**
   - delayed display is a UX decision to reduce flicker and only show “what the user is waiting on” for longer-running commands

---

## Suggested execution order for the implementing agent

1. Inspect repo and replace current demo extension scaffold.
2. Inspect `nicobailon/pi-interactive-shell` if available; adopt logging/dev conventions.
3. Add dependencies and config loading.
4. Implement copied shell/env helpers.
5. Implement overridden `bash` tool with non-PTY fallback branch.
6. Implement minimal PTY spawn + xterm feed + completion handling.
7. Implement xterm final transcript extraction from normal screen/scrollback.
8. Implement built-in-compatible truncation/temp-file path for PTY results.
9. Implement live widget manager and custom TUI component.
10. Add multi-widget stacking and delayed visibility.
11. Add `/bash-pty` command.
12. Build fixture programs.
13. Build direct test harness.
14. Build GIF/report pipeline.
15. Add end-to-end pi-driven tests.
16. Validate against acceptance criteria and refine parity with built-in bash.

---

## Non-goals for v1

- automatic heuristic `usePTY` inference
- prompt/system guidance teaching the model when to set `usePTY`
- dynamic PTY resize during command execution
- visible terminal cursor rendering
- inclusion of PTY-specific metadata in tool result details
- custom tool-call/result renderer in pi UI
- Windows-first support

---

## Final implementation principle

The live PTY widget is for the **human**.
The final textual tool result is for **pi/model compatibility**.

Those two views intentionally differ:

- live widget preserves full terminal behavior and color
- final tool result is plain sanitized text derived from xterm's retained normal-screen state, excluding alt-screen

That split is the core design choice of this extension.
