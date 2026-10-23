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
| `src/state.ts`        | `AppState`, `reducer`, create/edit form machines (pure)        |
| `src/render.ts`       | `render(args)` → ANSI strings (pure)                                      |
| `src/sections.ts`     | tab sections: forms, “Extensions”, environments + details (pure)      |
| `src/appsettings.ts`  | application settings (`<root>/.pi-env.json`)                               |
| `src/run.ts`          | application loop, `pi`/`npm` invocations, child process launch              |
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
