# Changelog

Format: new features and bug fixes as separate blocks. Versions below 0.1.2 are in the git history.
Russian text: [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [Unreleased]

### pi.dev package catalog

- **Catalog strings are cleaned at the parser boundary.** The name, types, description and author
  read from `https://pi.dev/packages` go through `cleanText`: control characters (ESC included)
  are dropped, and line breaks, tabs and repeated spaces collapse into a single space. Before, a
  control character or a line break inside a description reached the frame: `visibleWidth` counts it
  as one cell, while the line break added a row to the frame — the layout slid and the line-by-line
  repaint diff was invalidated; an ESC in a package name would have moved the terminal cursor. A card
  whose name is only control characters is skipped, and an empty-after-cleaning description or author
  becomes `null` (the info panel draws no empty line). `src/catalog.ts` (`cleanText`/`cleanOrNull` in
  `parsePackageCatalog`), tests in `test/catalog.test.ts`.

## [0.2.4] — 2026-10-25

### Self-update: the «Update» tab

- **A sixth tab, «Update», appears only when a newer pi-env exists.** On launch the app makes
  one background request to `https://registry.npmjs.org/@devmaksi%2Fpi-env/latest`; when the
  registry offers a newer version, the tab joins the tab bar between «Settings» and «About».
  It shows the installed and the available version, how this instance was installed (`npm -g`,
  npx cache, pi package, source checkout, unknown — detected from the real module path) and the
  update command for that way; `Enter` copies the command to the clipboard (OSC 52), `R`
  re-reads the registry and the changelog. Below the commands — the changelog of the releases
  between the installed and the available version, in the interface language with a fallback to
  the other one.
- **The application never updates, downloads or restarts itself** — that is the design
  decision: pi-env shows the right command for your install method and nothing more. A source
  checkout is recognised and never queried against npm, `PI_ENV_NO_UPDATE_CHECK=1` switches the
  check off, and there is no cache and no Settings toggle (a failed check simply shows no tab).
- **The install method is read from the install itself:** a checkout is the directory whose own root
  holds `.git` (working tree, `npm link`, git worktree). A `.git` further up the path — a
  dotfiles-managed `$HOME` or a wrapper repository — no longer turns an npm install into a checkout,
  so those users keep both the check and the tab.
- **The tab bar adapts to the terminal width:** full names, then short names (`tab.*.short`)
  with a two-space separator, then «active tab N/M» — six tabs no longer overflow a narrow
  terminal. Long changelog lines wrap by visible width (`wrapVisible`); a word wider than the
  column is cut by cells.
- **Bilingual changelog:** `CHANGELOG.md` became the English canonical file, the Russian text
  moved to `CHANGELOG.ru.md`, and every release is written to both. `test/docs.test.ts` checks
  that the two files describe the same set of versions and that each README links its own.
- Tests: `test/selfupdate.test.ts`, `test/selfupdate-net.test.ts`, `test/state-update.test.ts`,
  `test/render-update.test.ts`, `test/app-update.test.ts` (the real `run()` loop: tab → Enter →
  copied command). The demo take pins `PI_ENV_NO_UPDATE_CHECK=1`, so the GIF never depends on
  the registry answer.

### MCP add form

- **Enumerated values change with arrows right on the row.** Changing «Type» or «Exposure»
  used to need two Enter presses and a jumping cursor: Enter opened the value list,
  `form.cursor` temporarily became an index in that list, Enter committed the value and put
  the cursor back on the form row. Now the cursor stays on the enum row, `←`/`→` cycle
  through the values and change them at once, `↑`/`↓` still move between rows, and Enter is
  only submit (the «Add» row). Same behaviour in the «MCP» tab and in the create/edit form;
  the right column hints «←/→ — value» while the cursor is on an enum row
  (`src/state-mcp.ts` — `MCP_ENUM_ROWS`/`enumValues`, the `select` UI field removed;
  `src/sections.ts`, `src/locales/ru.json`, `src/locales/en.json`).

### Environment trash

- **Deleting an environment is no longer `rm -rf`.** It used to be irreversible: a typo at
  the confirmation step cost the whole configuration. Now deletion moves the directory to
  `<root>/.trash/<name>@<unix-ms>` (`src/trash.ts`, `fs.rename` — one rename on one disk).
  The trash is the service folder `.trash`, and so it can neither be named an environment
  nor shadow one, `scan()` now skips directories starting with `.` (`validateName` already
  rejected such names).
- **The «Trash» sub-screen** in the environment list: a «Trash (N)» row after «Create»
  (always visible), entries as «<name> · date» (newest on top), an info panel for the
  selected one. Enter restores (refuses with a rename hint when the name is taken), X asks
  “delete X forever?” + Enter confirms, Esc cancels, TAB/Esc goes back to the list.
  `scan()` no longer treats a dot-prefixed folder as an environment, so `.trash` never
  shows up in the list.
- Deleting the same name twice produces a second trash entry (the newer one above);
  restoring takes the last one. Entries deleted forever cannot be restored — that is the
  only path to a real deletion.

## [0.2.3] — 2026-10-24

### Package showcase (npm, pi.dev)

- **Images and documentation links no longer 404 on the package page.** Showcases rewrite
  relative README paths into `https://cdn.jsdelivr.net/npm/@devmaksi/pi-env@<version>/<path>`,
  i.e. they serve them from the npm tarball instead of the repository. `files` used to hold
  only `dist` and `pi`, so `docs/demo.gif`, `docs/installation.md` and `docs/development.md`
  lived in the repository and were absent from the package: the demo GIF and the guide links
  on pi.dev and npm did not open (404) while everything was fine on GitHub. Now `docs` is in
  `files`; the tarball grew from ≈200 KB to ≈1.2 MB — almost all of it is the two demo GIFs
  (`demo.gif`, `demo.ru.gif`).
- **`CHANGELOG.md` and `AGENTS.md` links in README are absolute GitHub links:** those files
  stay in the repository and are not part of the package, and relative links broke the same
  way.
- **Showcase regression test:** `test/docs.test.ts` checks that every relative README link
  lands in `files`. The “works on GitHub, broken in npm” mismatch can no longer slip through
  silently.

## [0.2.2] — 2026-10-24

### Reliability

- **The terminal is restored on any failure.** An unhandled throw (for example saving into
  an environment you are not allowed to write: `EACCES`) or a rejected background pi command
  used to leave the terminal in raw mode on the alternate screen with a hidden cursor — the
  user lost their shell. Now the whole terminal section of the loop is wrapped in
  `withShutdown` (`src/shutdown.ts`): terminal output happens exactly once on a normal exit,
  an exception, a rejection from a background command and on `SIGINT`/`SIGTERM`/`SIGHUP`; a
  failure is reported by the `crash.terminal` line plus a stack in stderr (exit code 1).
  `start()/stop()` are idempotent, so a failure while a child `pi` owns the terminal writes
  no escape codes into its screen.

- **Publishing is gated by tests.** New reusable workflow `.github/workflows/tests.yml`
  (`on: workflow_call`): `npm ci` → build → `npm test` on Node 22 and 24 (`ubuntu-24.04`) —
  the single place where the check steps and the supported Node list live. `ci.yml` (push to
  `master`/`main` and pull request) and `publish.yml` (tag `v*`) now only call it, and the
  publish job got `needs: test`: a tag cannot reach `npm publish` while tests are not green.
  Previously `publish.yml` ran no tests, and pushing a tag does not trigger `ci.yml` — an
  unverified commit could get out.
- **Agreement between `engines`, the CI matrix and the docs** is guarded by the new
  `test/ci.test.ts`: the check matrix is not below `engines`, the reusable-workflow calls are
  in place and their own matrices are forbidden, `tests.yml` carries no extra permissions
  (`contents: read`, no `id-token`), and the publishing traps (`--provenance --access public`,
  `id-token: write`, `npm@11`, `ubuntu-24.04`) are not lost.

### Compatibility

- **Minimum Node is 22.19.0** (`engines` in `package.json` and `package-lock.json`,
  `README.md` and `README.ru.md`, `docs/installation.md` and `docs/installation.ru.md`,
  `docs/development.md` and `docs/development.ru.md`, `AGENTS.md`). pi itself requires the
  same: `@earendil-works/pi-coding-agent` 1.3/1.4 needs Node `>=22.19.0`; Node 20 has a
  separate legacy line for pi (dist-tag `legacy-node20` → 0.74.2). The CI matrix is 22 and 24
  instead of 20/22/24 — the active LTS lines.

### Rendering and performance

- **The frame is repainted by a line diff.** Every repaint used to clear the screen and draw
  the whole frame (4743 bytes for a 100×40 frame): visible lag when moving through a list and
  flicker while the pi.dev catalog loads. Now `diffFrames`/`paintFrame` (`src/diff.ts`)
  compare frames line by line (byte comparison, ANSI codes included) and write only the
  changed lines (CUP + `[K`): moving the cursor in a list 4743 → 1483 bytes per repaint
  (−69%), switching tabs 4366 → 3148 (−28%), and repainting identical state gives one repaint
  instead of three (14229 → 4743 bytes). A full frame remains where it is needed: the first
  frame, a change of `width`/`height`/`twoColumns`, a frame of a different layout and the
  return from a child `pi` (`Term.screenKnown()` is `false` again after `start()`); a frame of
  a different layout is detected by `frameKey`, not by eye.
- **`Term.paint` instead of a blind `clear()`.** `paint(full)` writes the screen clear itself,
  `paint(rows)` patches only changed lines, `screenKnown()` knows whether the current frame is
  drawn (right after `start()` and after returning from a child `pi` it is `false` again). The
  dead `Term.clear()` is removed; `Term` has no separate `clear()`. The frame must stay exactly
  `height` lines of a fixed visible width — otherwise the line diff is invalidated.
- **Throttle for long progress.** `src/throttle.ts` is a pure leading-edge throttle that
  collapses intermediate repaints into one window: the pi.dev catalog progress is drawn no more
  than once per `PROGRESS_THROTTLE_MS` = 70 ms, the final result without a delay
  (4163 → 325 bytes per repaint, −92%).
- **Measurement — `npm run bench`** (`bench/paint-bench.ts`, not shipped in `dist` or the npm
  tarball): real frames through the real `render()`, mode “full” (the old path: clear plus the
  whole frame) against “diff”, 100×40.
- Tests: `test/diff.test.ts` (line diff), `test/paint.test.ts` (`paint`/`screenKnown`),
  `test/throttle.test.ts` (collapsing progress repaints), `test/app-paint.test.ts` (the real
  `run()` loop on a fake terminal — how many bytes a repaint actually cost).

### Showcase and demo

- **English by default.** `README.md`, `docs/installation.md`, `docs/development.md` are
  English texts without a suffix, Russian moved to `README.ru.md`, `docs/installation.ru.md`,
  `docs/development.ru.md`; there are no `.en.md` files left in the repository and every one
  of the six documents has a language switch line. The showcase layout, the absence of the
  Russian GIF in the English README and the liveness of all relative links are guarded by the
  new `test/docs.test.ts`; `DOCS` in `test/ci.test.ts` moved to the new layout.
- **A demo GIF instead of a screenshot.** `docs/demo.gif` and `docs/demo.ru.gif` (883×739,
  42 frames, ~17 s, ~0.6 MB) — the same take in two interface languages; both READMEs embed
  only the GIF, `docs/screenshot.png` stayed the preview of the `pi` manifest. The take shows:
  the environment list → starting `dev-supo` (16 superpowers skills, 5 extension packages,
  `(strata) qwen3.8-flash…`) → `/quit` → starting `Test` (6 own skills, 0 packages,
  `(llama.cpp) Qwen3.8-27B`) → `/quit` → exit. Re-shooting is `npm run demo`: the Python 3
  stand `demo/` (PTY + asciinema cast + rendering through `agg`), pinning the language and
  `lastChangelogVersion` for the duration of the take (settings are restored byte for byte),
  checking that no pi-env is already open, a postmortem cast of a broken take, killing the
  whole process group on timeout, and tests `demo/test_ptycast.py` / `demo/test_capture.py`.
  `demo/` is not in package.json `files` — it does not get into the npm tarball.

## [0.2.1] — 2026-10-22

### Distribution and documentation

- **Listing in the pi.dev/packages gallery**: `keywords` gained `pi-package` (per the pi docs
  that is what makes an npm package available in the gallery), and the `pi` manifest got
  `skills` and `image` for the preview. The package can now be installed as a pi package:
  `pi install npm:@devmaksi/pi-env`.
- **The `pi-env` skill**: `pi/skills/pi-env/SKILL.md` — the agent can create environments,
  run them and explain the `settings.json`/`mcp.json` layout. The `pi/` catalog is added to
  `files`, the skill travels in the npm tarball.
- **CI**: `.github/workflows/ci.yml` — build and `npm test` on push to `main` and on pull
  requests, matrix Node 20/22/24 (previously Actions only had publishing).
- **README (ru/en)**: badges (version, npm downloads, CI, license, Node), the first screen
  rewritten — one-line pitch, quick start, a “why, when `PI_CODING_AGENT_DIR` already exists”
  section, a warning not to confuse it with `@earendil-works/pi-env`, tabs (MCP) updated and
  the CHANGELOG link refreshed.

## [0.2.0] — 2026-10-20 (changes after v0.1.2)

### New features

- **MCP — the «MCP» tab**: list of main-agent servers, info panel of the selected one,
  «＋ Add» (a 9-field stdio/http form: name, type, command, arguments, URL, variables,
  working directory, description, exposure) with validation, deletion with confirmation (X).
  Adding goes through `pi mcp add`, deletion is a clean `mcp.json` write (last entry → the
  file is removed).
- **MCP in the environment form**: the «MCP» row in create and in edit. In edit — the
  “environment + main” union: copying main-agent servers into the environment, removing
  environment entries, «Add new»; in create — marking servers from main, `mcp.json` is written
  together with the environment.
- **MCP in the environment details**: the environment info panel shows the servers of its own
  `mcp.json` (`catalog.mcp` / `details.mcp`).
- **«About» — supporting the author**: the «Support the author:» line and the link
  `https://boosty.to/devmaksi` (the URL on its own line — visible in narrow mode too).
- v1 limits (deliberate): `headers`/oauth/`timeout` only in a manual `mcp.json`; editing an
  existing server means remove + add; live connection status was deferred.

### Fixes

- **readJsonFile used to cut commas inside JSON strings**: the trailing-commas regex corrupted
  values like `{"a":"hello, }world"}` in a fully valid file. A string literal is now the first
  alternative — commas outside strings are the only ones touched.
- **Package skill collisions corrupted settings.json while editing**: two packages with a skill
  of the same name were indistinguishable in the form — `freshEdit` pre-marked both,
  `updateEnvironment` removed one by name, the unticked skill stayed as a directory and got
  back into settings.json. Skill identity is the environment's directory name
  (`envSkillDirName`: `pkg-b/dup` → `pkg-b-dup`) in create, update and freshEdit; `listSkills`
  returns unique names (`uniqueName`). Limitation: legacy `foo-2` directories in existing
  environments are not migrated.
- **The version in «About»** is no longer hardcoded (`pi-env 0.1.0`): it comes from
  `package.json`.

### Refactoring

- Shrinks from the audit (~−54 lines): a shared `readJsonFile` instead of three copies,
  `listEntries` instead of `listFiles`/`listDirs`, a shared `busySection` instead of
  `createBusy`/`extBusy`/`mcpTabBusy`, `basename`/`dirname`/`osHomedir` from standard modules
  instead of hand-written ones, a single `TEXT_ROWS`, `isPrintable`.
- `render.ts` split into sections (`renderCreate`, `renderExtTab`, `renderEnvList`,
  `renderSettings`, `renderAbout`, `renderFooter`); `render()` is only a dispatcher.
