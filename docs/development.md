# Development

[English](development.md) | [Русский](development.ru.md)

**Stack:** Node.js ≥ 22.19 (same as pi 1.3/1.4), TypeScript (ESM, `NodeNext`), zero runtime dependencies.
Dev dependencies: `typescript`, `tsx`, `@types/node`. Tests — `node:test`.

## Quick start

```bash
git clone <repo> pi-env
cd pi-env
npm install            # dev dependencies
npm run build          # compile src/ → dist/
npm test               # core tests: tsx --test test/*.test.ts
npx tsx src/index.ts   # run the TUI without a build (faster development)
npm run start          # run the built CLI (node dist/index.js)
```

## Project structure

| File                  | Purpose                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`        | entry point: arguments (`--root`, `--help`), TTY check, start              |
| `src/terminal.ts`     | raw mode, `parseKeys` (pure), `Term` factory                        |
| `src/environments.ts` | `scan(root)` (pure)                                                  |
| `src/layout.ts`       | `computeLayout` (pure), threshold constants                                |
| `src/catalog.ts`      | model/tool/package/skill catalogs, pi.dev catalog (pure)     |
| `src/create.ts`       | creating/updating/deleting environments, name validation                    |
| `src/trash.ts`        | environment trash (`<root>/.trash`): move, list, restore                    |
| `src/store.ts`        | shared storage (`<root>/.store`): model file link, package roots, registry, snapshots (pure) |
| `src/fscopy.ts`       | `copyRecursive` — directory copy shared by create and clone                |
| `src/state-trash.ts`  | “Trash” sub-screen: ↑↓/Enter/X/Esc (pure)                                   |
| `src/state-clone.ts`  | “Clone environment” sub-screen: name field, Enter/Esc (pure)                |
| `src/state.ts`        | `AppState`, `reducer`, create/edit form machines (pure)        |
| `src/render.ts`       | `render(args)` → ANSI strings (pure)                                      |
| `src/sections.ts`     | tab sections: forms, “Extensions”, environments + details (pure)      |
| `src/appsettings.ts`  | application settings (`<root>/.pi-env.json`)                               |
| `src/run.ts`          | application loop, `pi`/`npm` invocations, child process launch              |
| `src/env-cache.ts`    | cached environment/trash snapshot: stat signature + invalidation (pure)   |
| `src/ticker.ts`       | one-shot timer chain behind the «⏳ N s» counter (pure)                    |
| `src/diff.ts`         | per-frame row diff: `diffFrames`/`paintFrame` (pure)                      |
| `test/*.test.ts`      | pure core tests (`node:test`)                                           |

## Conventions

- All logic that does not require a TTY — **pure functions**, covered by
  `node:test` tests; the terminal layer (`terminal.ts`, `run.ts`) stays thin.
- UI texts and messages — through `t(lang, key)` (`src/i18n.ts`), dictionaries in
  `src/locales/*.json` (ru is the base, en is complete).
- Documentation: a file without a suffix is English, Russian text lives in `.ru`
  files; the repository has no `.en.md` files.
- Layout/key-behavior changes — only together with updating `render`/`state`
  tests and `AGENTS.md`.

## Responsiveness

- Long external commands (`pi install`/`update`/`remove`, `pi mcp add`, `pi mcp list`) run in the
  background: the screen stays responsive and shows «⏳ N s». `Esc` on such a screen aborts the
  process that owns it; `Ctrl+C` exits pi-env after aborting every running process. A timeout is
  distinguishable from a cancellation and from an ordinary failure — `CmdResult.cancelled`,
  `CmdResult.timedOut`, `CmdResult.timeoutMs` — and the status line says which one it was.
- Time lives in the effect layer: `run.ts` keeps `opStartedAt` and puts whole seconds into the
  state as `opSeconds`, so `render`/`sections` stay pure. `⏳` is listed in `WIDE_CHARS`, otherwise
  the column borders break on 2-cell terminals.
- The environment snapshot is cached by a stat signature (`src/env-cache.ts`). Your own mutation —
  create/save/rename, trash, MCP edit, a finished external command, the return of the child `pi` —
  must invalidate it, otherwise the UI shows a stale list.

## Development cycle

```bash
# edits in src/
npx tsx src/index.ts   # check behavior live
npm test               # run core tests
npm run build          # build
```

## Demo GIF recording

```bash
pi-env                # close every running pi-env first — the script refuses otherwise
npm run demo          # re-shoots docs/demo.gif and docs/demo.ru.gif
```

`demo/` is a Python 3 stand (stdlib only): `demo/ptycast.py` drives a PTY and writes an
asciinema cast, `demo/script.py` is the keyboard/marker script, `demo/capture.py` pins the
pi-env language and renders the GIF through `agg` (`demo/bin/agg`, downloaded on first run,
gitignored; so is `demo/out/`). The stand self-checks alt-screen handling with
`python3 -m demo.capture --selftest`, and `python3 -m unittest demo.test_ptycast
demo.test_capture` covers it. `demo/` is not in `files` in `package.json`, so it never
reaches the npm tarball.

A detailed description of the environments model, current status, and roadmap — in
`AGENTS.md`.

## Specifications

Every architectural decision is documented per feature in `docs/superpowers/specs/`,
implementation plans in `docs/superpowers/plans/`. Both directories are in `.gitignore`
(working artifacts of the development process): they are not in the repository, so they are
mentioned by name here rather than linked.

- Environment trash — `docs/superpowers/specs/2026-10-24-env-trash-design.md`:
  a deleted environment is moved into `<root>/.trash` instead of an irreversible
  `rm -rf`; the “Trash” sub-screen restores it or deletes it forever.

- The main agent as an environment — `docs/superpowers/specs/2026-11-25-main-pi-as-environment-design.md`:
  an environment is identified by a path (`Environment.path`), the main agent is the leading
  entry of the list (`withMain`); editing it patches `settings.json` and leaves the agent
  directory alone, deleting and renaming are disabled, and the CLI form is `pi-env main`.

- Shared model-catalog storage — `docs/superpowers/specs/2026-11-25-env-store-models-design.md`:
  a shared `<root>/.store/models/models.json` (overridden by the `storeDir` setting in
  `.pi-env.json` and by `PI_ENV_STORE`, the variable wins), the environment's `models.json`
  becomes a symlink to it, per-environment model visibility is the pi `enabledModels` setting,
  and the environment's own copy moves into the file-trash branch
  `<root>/.trash/files/<env>--<file>@<ms>`.
- Shared package storage (slice 2a) — `docs/superpowers/specs/2026-11-26-env-store-artifacts-design.md`:
  the whole `npm/` and `git/` package roots of an environment are symlinks to `<root>/.store/npm`
  and `<root>/.store/git`, because pi keeps its package roots inside the agent directory; the
  shared registry is `<store>/settings.json` and every `pi install/update/remove` of the
  “Extensions” tab runs with `PI_CODING_AGENT_DIR=<store>`. `scan()` reports the link state per
  root (`EnvDetails.rootLinks`), plus `packageConflicts` (same package name declared by different
  sources) and `missingPackages` (declared but absent from the registry). An environment's own
  redundant package directory becomes a store snapshot `<store>/<root>.from-<env>@<ms>`, not a
  file-trash entry: the file branch only accepts files. Enabling the store links the main agent
  to the shared roots as well.
- Environment cloning — `docs/superpowers/specs/2026-11-19-env-clone-design.md`:
  `C` on an environment opens a name prompt and copies the environment directory
  verbatim (its own files included), instead of rebuilding it from the main agent.
