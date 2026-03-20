# SHIP.md — productionization plan for publishing this pi extension

Goal: turn this repo from an experimental local extension into a production-quality, publicly shippable pi extension package, following the structural, packaging, installation, documentation, and maintenance patterns used by [`nicobailon/pi-interactive-shell`](https://github.com/nicobailon/pi-interactive-shell).

## Definition of done

- [ ] The repo can be installed by other users via `pi install npm:<package-name>`.
- [ ] The package exposes proper pi package metadata (`pi.extensions`, and optionally `pi.skills`, `pi.prompts`, `pi.video` if relevant).
- [ ] The source tree is organized as a real extension package, not a local experiment.
- [ ] The shipped files are intentional and minimal.
- [ ] The extension has production docs for install, config, usage, troubleshooting, limitations, and versioning.
- [ ] The extension has tests covering core behavior and release-critical edge cases.
- [ ] The extension has a clear release workflow, changelog discipline, and npm/GitHub publishing setup.
- [ ] A user can discover it, install it, configure it, and trust it.

## 1. Product/package identity

- [ ] Decide final public package name.
  - [ ] Verify npm availability.
  - [ ] Verify the extension directory name users will see under `~/.pi/agent/extensions/` is clean and intuitive.
- [ ] Decide final positioning statement.
  - [ ] Write a concise one-line description for npm/GitHub/package metadata.
  - [ ] Clearly explain what problem it solves beyond built-in `bash`.
- [ ] Decide v1 feature boundary.
  - [x] There is already a substantial architecture/spec in `PLAN.md`.
  - [ ] Explicitly define what ships in v1.
  - [ ] Explicitly define what remains experimental/non-goals.
- [ ] Decide support statement.
  - [x] The current docs/code already implicitly target macOS first.
  - [ ] Decide whether v1 is macOS-only or macOS primary / Linux experimental.
  - [ ] Document unsupported/less-tested platforms honestly.

## 2. Restructure repo to match Nico-style production layout

- [ ] Convert the repo from “single local experiment with artifacts” into a package layout similar in spirit to `pi-interactive-shell`.
- [ ] Move from ad hoc/experimental structure to a stable top-level module layout.
- [ ] Target a top-level layout like:
  - [x] `index.ts`
  - [ ] focused top-level modules or a small number of clearly named source modules
  - [ ] `scripts/`
  - [ ] `tests/`
  - [ ] `examples/`
  - [x] `README.md`
  - [ ] `CHANGELOG.md`
  - [ ] `SKILL.md` if a skill is part of the public UX
  - [ ] optional banner/demo assets
- [ ] Decide whether current `src/` stays or whether key runtime modules should move to top-level files, following Nico’s flatter package style.
- [ ] Separate clearly:
  - [ ] runtime extension code
  - [ ] test/report harness code
  - [ ] publishable assets
  - [ ] internal-only experimental artifacts
- [ ] Remove or quarantine repo-local scratch files that should not exist in a production package.
  - [ ] Remove mistaken duplicates like `PROGRESS.ms`.
  - [ ] Remove generated files checked into the repo accidentally.
  - [ ] Remove temporary artifacts not intended for consumers.
- [ ] Ensure the production repo structure communicates “installable extension package” immediately.

## 3. Split experimental code into production modules

- [ ] Break `index.ts` into smaller production modules with explicit responsibilities.
- [ ] Create dedicated modules for:
  - [ ] tool schema
  - [ ] config loading/validation
  - [ ] PTY execution/session management
  - [ ] widget rendering/manager lifecycle
  - [ ] transcript extraction
  - [ ] truncation/temp-file behavior
  - [ ] logging/debug utilities
  - [ ] shell/spawn-helper helpers
- [ ] Keep `index.ts` thin as the extension entrypoint.
- [ ] Name modules in a user-maintainable way, mirroring Nico’s focused single-purpose files.
- [ ] Remove report/test-specific concerns from runtime code where possible.
- [ ] Make runtime/public code readable without reading the report generator.

## 4. Package metadata and publishability

- [ ] Change `package.json` from private experimental package to public package.
  - [ ] Remove `"private": true`.
  - [ ] Add real `name`, `version`, `description`, `license`, `author`.
  - [ ] Add `repository`, `bugs`, `homepage`, `keywords`.
- [ ] Add a `pi` section in `package.json` like Nico’s package.
  - [ ] Add `pi.extensions` pointing at the extension entrypoint.
  - [ ] Include `pi.skills` if shipping a user-facing skill.
  - [ ] Include `pi.prompts` if shipping prompt templates/examples.
  - [ ] Optionally include `pi.video` if there will be a demo video.
- [ ] Add a `files` allowlist in `package.json`.
  - [ ] Only publish runtime code, docs, examples, scripts needed at install/postinstall, and intentional assets.
  - [ ] Exclude generated artifacts, local notes, and development-only files.
- [ ] Decide whether TypeScript source is shipped directly, matching pi package expectations, or whether a build step/output dir is needed.
- [ ] Verify package install works from a tarball, not just from the local repo.
- [ ] Add `engines` if needed for Node compatibility.

## 5. Installation/deploy structure for real users

- [ ] Align installation flow with Nico’s pattern.
  - [ ] User installs with `pi install npm:<package-name>`.
  - [ ] pi discovers extension via package metadata.
- [ ] Ensure no manual symlink instructions are the primary install path anymore.
- [ ] If `node-pty` requires postinstall help, add a production-safe `postinstall` script similar to Nico’s spawn-helper fix flow.
- [ ] Validate what lands in the user environment after install.
  - [ ] extension files
  - [ ] any bundled skill
  - [ ] any bundled prompt examples
  - [ ] any install helper scripts
- [ ] Test clean install on a machine/environment that does not have this repo symlinked.
- [ ] Test upgrade flow from one published version to another.
- [ ] Test uninstall/removal expectations.

## 6. Runtime config model and docs parity

- [ ] Formalize config loading into a dedicated module, following Nico’s global+project JSON pattern.
- [x] The current extension already loads global + project JSON config files.
- [ ] Keep config paths production-friendly and documented clearly.
  - [x] Global path exists today in code.
  - [x] Project path exists today in code.
  - [ ] Document both paths clearly for users.
- [ ] Finalize the public config schema.
- [x] Clamp and validate all numeric options.
- [ ] Clamp/validate any remaining public string/boolean options as needed.
- [x] Invalid config files currently warn and fall back instead of crashing.
- [ ] Ensure code, README, tests, and any skill doc all describe the exact same config keys/defaults.
- [ ] Add docs/tests parity checks similar in spirit to Nico’s `config-and-docs` coverage.

## 7. Public UX/docs for users

- [ ] Rewrite `README.md` into a production README patterned after Nico’s style.
- [ ] README should include:
  - [ ] project banner/title
  - [ ] what the extension does
  - [ ] why it exists
  - [ ] install command
  - [ ] requirements/prerequisites
  - [ ] quick-start examples
  - [ ] key behavior overview
  - [ ] config docs with JSON examples and settings table
  - [ ] limitations/platform notes
  - [ ] troubleshooting
- [ ] Replace local-dev-only instructions with real user instructions.
- [ ] Add a clear “How it works” section with a simple architecture diagram.
- [ ] Add examples showing when to use `usePTY:true` and when not to.
- [ ] Add practical examples for commands like `htop`, `ffmpeg`, `curl`, `vim`, etc. if those are intended supported cases.
- [ ] Add screenshots/GIFs/video references for the live terminal widget experience.
- [ ] Add a concise troubleshooting section for common `node-pty`/build-tool/macOS issues.

## 8. Decide whether to ship a SKILL.md

- [ ] Decide whether this extension benefits from a public skill file.
- [ ] If yes, add `SKILL.md` and include it in `package.json` `pi.skills`.
- [ ] The skill should teach agents/users:
  - [ ] when this extension is useful
  - [ ] when to prefer normal `bash`
  - [ ] when `usePTY:true` is appropriate
  - [ ] caveats around interactive/full-screen tools
- [ ] Ensure the skill is concise and operational, like Nico’s cheat-sheet style.
- [ ] Keep README and SKILL behavior guidance consistent.

## 9. Decide whether to ship prompt templates/examples

- [ ] Decide whether prompt templates are part of the package UX.
- [ ] If yes, add an `examples/` directory similar to Nico’s package.
- [ ] Potential examples:
  - [ ] prompts that encourage deliberate `usePTY:true` usage when the user explicitly wants live terminal behavior
  - [ ] demos for debugging terminal-heavy tools
  - [ ] examples for reproducing rendering/truncation issues
- [ ] Keep examples clearly optional and non-core.

## 10. Productionize source behavior before release

- [ ] Resolve open runtime gaps that are acceptable in an experiment but not in a public release.
- [ ] Specifically ship-quality work is needed for:
  - [ ] transcript fidelity from normal screen + scrollback
  - [ ] alt-screen exclusion correctness
  - [ ] truncation/temp-file parity with built-in bash
  - [ ] timeout/abort/kill behavior reliability
  - [ ] multi-widget stacking/order cleanup behavior
  - [ ] width/height behavior in real pi UI
  - [ ] no-UI behavior consistency
- [ ] Remove or hide experimental return metadata that should not appear in a public tool result.
- [ ] Ensure the public behavior is intentional, stable, and documented.

## 11. Logging and operational noise

- [ ] Adopt Nico-style minimal runtime logging.
- [x] Debug logging is already off by default.
- [x] A tiny dedicated debug helper with stable prefix already exists.
- [x] The code already uses `console.warn` for actionable config-load failures.
- [ ] Ensure important runtime failures consistently use `console.warn`/`console.error` only when actionable.
- [ ] Avoid noisy normal-path logs everywhere in the public extension.
- [ ] Document debug enablement for bug reports.

## 12. Spawn-helper / native dependency hardening

- [ ] Extract the macOS spawn-helper permission fix into a dedicated script/module patterned after Nico’s `scripts/fix-spawn-helper.cjs` + helper module approach.
- [ ] Decide exactly when it runs.
  - [ ] `postinstall`
  - [ ] runtime fallback
  - [ ] both
- [x] There is already a working runtime spawn-helper chmod workaround in the repo.
- [ ] Ensure the script is robust, quiet on success, and clear on failure.
- [ ] Document prerequisites for `node-pty` compilation/install.
- [ ] Test fresh install where native dependencies must be built or loaded normally.

## 13. Tests: move from experiment coverage to release coverage

- [ ] Reorganize tests into a production `tests/` directory.
- [ ] Adopt a standard test runner and config, ideally following Nico’s focused module-test approach.
  - [ ] Likely Vitest for consistency with the reference repo, unless there is a strong reason not to.
- [ ] Add release-critical tests for:
  - [ ] config loading/merge/clamping
  - [ ] docs/config parity
  - [ ] module load smoke test
  - [ ] transcript extraction correctness
  - [x] split escape sequence handling already has some coverage
  - [x] synchronized rendering lock behavior already has some coverage
  - [ ] truncation behavior
  - [ ] empty output behavior
  - [ ] PTY failure behavior
  - [ ] timeout/abort/kill behavior
  - [ ] widget lifecycle/ordering behavior where testable
- [x] There is already a working automated test command.
- [ ] Keep tests direct and modular where possible, similar to Nico’s focused unit coverage.
- [ ] Add a lightweight install/load test that simulates package consumers, not just local dev.

## 14. Separate release tests from visual/manual review tooling

- [x] The repo already has a visual report generator/manual review workflow.
- [ ] Keep the visual report generator if it remains useful, but make it clearly secondary to the real test suite.
- [ ] Decide whether report generation stays in-package or moves under a dev-only area.
- [ ] Ensure report artifacts are not part of the published package.
- [x] Report generation is already documented as a maintainer workflow in `AGENTS.md`.
- [ ] Make sure the extension can be maintained without requiring artifact regeneration for ordinary code changes.

## 15. Git hygiene and published-file hygiene

- [ ] Tighten `.gitignore`.
- [ ] Ensure generated `artifacts/` do not get published to npm.
- [ ] Decide whether any generated demos should live in the repo as curated assets instead of raw report outputs.
- [ ] Remove committed noise that does not belong in the long-term production repo.
- [ ] Add npm pack verification to confirm only intended files ship.

## 16. Add CHANGELOG discipline

- [ ] Add `CHANGELOG.md`, following Nico’s production-repo pattern.
- [ ] Start with an unreleased/v0 section and then versioned entries.
- [ ] Document user-visible changes only.
- [ ] Use it as part of every release.

## 17. Versioning and release policy

- [ ] Decide semantic versioning strategy.
  - [ ] Probably `0.x` until behavior stabilizes.
- [ ] Define release gates for each version.
  - [ ] tests passing
  - [ ] install tested
  - [ ] docs updated
  - [ ] changelog updated
  - [ ] package contents verified
- [ ] Define who/what publishes to npm and when.
- [ ] Decide whether GitHub releases/tags will be created for each npm release.

## 18. Licensing, ownership, and community readiness

- [ ] Add a real license file if not already present.
- [ ] Ensure all bundled code/assets/examples are licensable for public release.
- [ ] Decide contribution posture.
  - [ ] issues enabled
  - [ ] PRs welcome or not
- [ ] Add contribution guidance if desired.
- [ ] Add issue templates or at least troubleshooting guidance in README for bug reports.

## 19. CI / automation for a public repo

- [ ] Add CI to run tests on push/PR.
- [ ] At minimum automate:
  - [ ] module-load smoke test
  - [ ] test suite
  - [ ] package metadata/packageable-file validation
- [ ] Optionally automate:
  - [ ] npm pack dry-run check
  - [ ] docs/config parity test
  - [ ] lint/typecheck if adopted
- [ ] Decide whether to test on macOS only or macOS + Linux.
- [ ] Make CI reflect the documented support matrix.

## 20. Type safety and code health

- [ ] Decide whether to keep the runtime in mixed JS/TS or move to stronger TS-first production code.
- [ ] Add type checking as a release gate.
- [ ] Remove dead experimental code and stale comments.
- [ ] Ensure module APIs are named and typed clearly.
- [ ] Add comments documenting copied/adapted pi logic provenance.

## 21. Public-facing naming consistency

- [ ] Rename repo/package/docs/config/widget strings consistently.
- [ ] Ensure the extension name is the same across:
  - [ ] repo name
  - [ ] package name
  - [ ] README title
  - [ ] config file names
  - [x] debug prefix is already consistently `bash-pty`
  - [ ] install instructions
  - [ ] skill metadata
- [ ] Remove references that make it sound like a temporary experiment.

## 22. User-facing command/tool documentation

- [ ] Document exactly how users experience the override.
- [ ] Explain whether users need to do anything special for model usage.
- [x] The slash command `/bash-pty` already exists.
- [ ] Document the slash command (`/bash-pty`) if it remains public.
- [ ] Decide whether `/bash-pty` is:
  - [ ] public feature
  - [ ] dev-only feature
  - [ ] hidden/undocumented maintainer tool
- [ ] Ensure the public docs match that decision.

## 23. Compatibility and fallback strategy

- [x] The extension already uses current public pi extension APIs for tool/command registration.
- [ ] Verify compatibility with current pi extension APIs more explicitly.
- [ ] Document which pi versions are expected to work.
- [ ] Decide how tightly to couple to current pi internals.
- [x] Deep imports/unstable assumptions are currently minimal.
- [ ] Add smoke tests or notes for behavior if pi internals change.

## 24. Real-user install and usage validation

- [ ] Test the package from a completely separate checkout/environment.
- [ ] Validate:
  - [ ] `pi install npm:<package>`
  - [ ] extension discovery
  - [ ] config file loading
  - [ ] slash command registration if public
  - [ ] normal `bash` fallback path
  - [ ] `usePTY:true` path
  - [ ] widget display and cleanup
- [ ] Test at least one realistic “new user” flow using only README instructions.
- [ ] Fix documentation until that path is smooth.

## 25. Curate demo assets like Nico’s repo

- [ ] Decide whether to add:
  - [ ] banner image
  - [ ] demo GIF
  - [ ] demo video
- [ ] If yes, create intentional curated assets rather than shipping raw test artifacts.
- [ ] Reference them from README/package metadata appropriately.
- [ ] Keep the repo landing page professional and understandable at a glance.

## 26. Maintenance docs for contributors/maintainers

- [x] `PLAN.md` already exists and is being used as architecture/spec.
- [x] `PROGRESS.md` already exists and is being used as implementation status.
- [x] `AGENTS.md` already exists and has maintainer workflows.
- [ ] Add maintainer-oriented release steps somewhere explicit.
  - [ ] either in `AGENTS.md`, `RELEASING.md`, or README contributor section
- [ ] Make it clear which docs are public-user docs vs internal-maintainer docs.

## 27. Decide what not to ship

- [ ] Review every current top-level file and decide:
  - [ ] user-facing and published
  - [ ] maintainer-facing and committed
  - [ ] generated and ignored
  - [ ] experimental and deleted
- [ ] Likely candidates to exclude from the published package:
  - [ ] `artifacts/`
  - [ ] ad hoc screenshots/reports
  - [ ] internal planning/progress notes
  - [ ] dev-only fixtures unless intentionally published as examples
- [ ] Keep the npm package lean and intentional.

## 28. Final release checklist to execute before first publish

- [ ] Finalize package name and metadata.
- [ ] Restructure source tree.
- [ ] Split runtime modules cleanly.
- [ ] Add `pi` metadata and `files` allowlist.
- [ ] Add/install-test postinstall spawn-helper fix if needed.
- [ ] Rewrite README for public install/use.
- [ ] Add CHANGELOG.
- [ ] Add LICENSE.
- [ ] Decide on SKILL/examples and wire them into metadata.
- [ ] Harden runtime behavior for release-critical gaps.
- [ ] Reorganize/add tests.
- [ ] Add CI.
- [ ] Verify npm pack contents.
- [ ] Test `pi install npm:<package>` in a clean environment.
- [ ] Cut first version/tag/changelog entry.
- [ ] Publish to npm.
- [ ] Verify install from the public registry works end to end.

## Recommended first implementation order

- [ ] Package identity + naming.
- [ ] Repo/source restructuring.
- [ ] Package metadata + publishability.
- [ ] README/install/config docs rewrite.
- [ ] Config module cleanup and docs parity.
- [ ] Runtime hardening for release-critical gaps.
- [ ] Spawn-helper/postinstall hardening.
- [ ] Test suite reorganization and expansion.
- [ ] CI + pack verification.
- [ ] Curated assets/examples/skill.
- [ ] Clean-install validation.
- [ ] First release.
