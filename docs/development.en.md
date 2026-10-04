# Development

[English](development.en.md) | [Русский](development.md)

**Stack:** Node.js ≥ 20, TypeScript (ESM, `NodeNext`), zero runtime dependencies.
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
- UI texts and messages — **in Russian**.
- **Do not add** runtime dependencies without necessity.
- Layout/key-behavior changes — only together with updating `render`/`state`
  tests and `AGENTS.md`.

## Development cycle

```bash
# edits in src/
npx tsx src/index.ts   # check behavior live
npm test               # run core tests
npm run build          # build
```

A detailed description of the environments model, current status, and roadmap — in
`AGENTS.md`.
