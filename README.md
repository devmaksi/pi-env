# pi-env

[English](README.md) | [Русский](README.ru.md)

[![npm version](https://img.shields.io/npm/v/@devmaksi/pi-env?logo=npm)](https://www.npmjs.com/package/@devmaksi/pi-env)
[![npm downloads](https://img.shields.io/npm/dm/@devmaksi/pi-env)](https://www.npmjs.com/package/@devmaksi/pi-env)
[![CI](https://github.com/devmaksi/pi-env/actions/workflows/ci.yml/badge.svg)](https://github.com/devmaksi/pi-env/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@devmaksi/pi-env)](LICENSE)
[![node](https://img.shields.io/node/v/@devmaksi/pi-env)](package.json)

**Profiles for the `pi` agent: a separate configuration per project and model, created and launched from one TUI.**

`pi` reads its configuration from the directory pointed to by
`PI_CODING_AGENT_DIR`: `settings.json`, `extensions/`, `skills/`, `agents/`,
`themes/`, `mcp.json`. Different models, skills and MCP servers per task mean
different directories. `pi-env` makes them manageable: a list of environments,
a creation form, launch on Enter, extension and MCP updates in place — without
leaving the terminal.

![Launch an environment in pi-env, then run it in pi: pi prints the skills, tools and
packages that this environment loaded — two environments, two different sets](docs/demo.gif)

## Quick start

**Requirements:** Node.js ≥ 22.19 and the `pi` CLI installed
(`npm install -g @earendil-works/pi-coding-agent`).
(the Node floor matches `pi` itself: pi 1.3/1.4 requires Node.js 22.19 or newer)

```bash
npm install -g @devmaksi/pi-env                  # or one-off: npx @devmaksi/pi-env
pi-env                                           # TUI, environments root — ~/.pi-env
pi-env myenv --mode json "Review this repository"  # run pi in the environment (args passed as-is)
```

## Why not just `PI_CODING_AGENT_DIR`

- You still have to remember the variable, export it, and keep paths in your
  head — `pi-env` turns that into a list of names and Enter to launch.
- A new environment is not a `mkdir`: it needs tools, skills, packages, the
  model catalog and `auth.json` copied over. The creation form does it for you.
- Extensions and MCP servers live in separate files per environment; `pi-env`
  shows available updates and edits `mcp.json` for you.
- Launch remains a plain `pi` run: the child process gets
  `PI_CODING_AGENT_DIR=<environment>`, arguments pass through untouched — so it
  is scriptable, `--mode json` included.

## Not to be confused with `@earendil-works/pi-env`

This is an independent project, not affiliated with earendil-works. The official
`@earendil-works/pi-env` is about remote execution (`ssh`, `remote`, durable
agents) and has nothing to do with managing local configurations. Similar name,
different purpose.

## Features

- list of environments (root directory `~/.pi-env`, overridable via the
  `--root <path>` flag or the `PI_ENV_ROOT` environment variable);
- tabs: **Environments | Extensions | MCP | Settings | About**;
- environment creation via a form: name, model, tools, extension packages,
  skills (catalog is taken from the main `pi` agent), MCP servers;
- the main agent is the first entry in the environment list (its directory is
  `PI_CODING_AGENT_DIR`, by default `~/.pi/agent`): it can be launched, edited
  (model, packages, MCP) and used as the source of a new environment; it cannot
  be deleted, trashed or renamed; in the CLI it is `pi-env main [pi args...]`;
- launching an environment: a child `pi` process with
  `PI_CODING_AGENT_DIR=<environment path>`, back to the TUI on exit;
- environment editing: change model, tools, packages, skills, MCP, rename,
  delete with confirmation;
- deleting an environment moves it to the trash (`<root>/.trash/`): the
  “Trash (N)” entry in the environment list restores it with Enter, delete
  forever is there too, with confirmation;
- shared model-catalog storage: one `<root>/.store/models/models.json` for every
  environment (the “Storage” row in the environment form), per-environment model
  visibility in the “Models” row (the pi `enabledModels` setting), a broken link is
  repaired with `R` on the environment; the storage lives in `<root>/.store` by
  default and moves with the `storeDir` entry of `<root>/.pi-env.json` or the
  `PI_ENV_STORE` variable;
- shared package storage: the `npm/` and `git/` directories of an enabled environment
  are symlinks into `<root>/.store`, so `pi install`, `pi update` and `pi remove` there
  serve every environment at once. The “Extensions” tab is the store registry
  (`<store>/settings.json`): each package shows how many environments use it, conflicting
  sources are marked, and removal warns which environments will lose the package.
  The main agent joins the shared package directories when the store is enabled for the
  first time; the “Storage” row of the environment form turns both slices (models and
  packages) on and off together;
- extension management: update checks («↑ latest» markers), updating
  one/all packages (`pi update`), removal (`pi remove`);
- installing extensions from the `https://pi.dev/packages` catalog: globally
  (the “Extensions” tab) and into a specific environment (“Install” button
  in the form);
- MCP: a tab with the server list, form-based addition (`pi mcp add`) — closed-choice values
  ("Type", "Exposure") cycle with left/right arrows right on the row — removal, and live status
  (`pi mcp list --json`);
- environment details: info panel of the selected one (model, tools, skills,
  extension packages, MCP);
- application settings: “Colored output”, “Recheck updates”
  (`npm outdated` on every visit to the “Extensions” tab); stored in
  `<root>/.pi-env.json` and survive restarts.
- update indication for pi-env itself: when the npm registry has a newer
  version, a sixth “Update” tab appears with the version number, the update
  command for your install method (Enter copies it to the clipboard) and the
  changelog of the releases you skipped. The application never updates or
  restarts itself; the check is one background request per launch and is
  switched off by `PI_ENV_NO_UPDATE_CHECK=1` (and is never made when pi-env
  runs from a source checkout).
- a long operation is not a frozen screen: installs, updates, removals and MCP checks show an
  `⏳ N s` counter, `Esc` interrupts the running process (the hint on such a screen reads
  “Esc — cancel”), and a timeout is reported as a timeout, not as a generic failure;
- the environment list is cached (`src/env-cache.ts`): the disk is re-read only when the tree
  actually changed or when pi-env itself changed it;
- a broken configuration is visible, not silent: an environment whose `settings.json` or
  `mcp.json` cannot be read gets a `⚠` in the list and the error text in its info panel;
  `PI_ENV_DEBUG=1` appends such problems (and other failures that used to disappear in
  `catch {}`) to `<root>/.pi-env.log`.

## Controls (main keys)

| Key                      | Action                                                              |
| ---------------------------- | --------------------------------------------------------------------- |
| ↑/↓                          | move through the list                                                  |
| ←/→                          | column focus (wide mode, “Environments” tab)                    |
| TAB                          | switch tabs (a sixth “Update” tab joins when it is available)   |
| Enter                        | confirm (launch environment, action on the selected item)         |
| Space                        | mark in creation lists / toggle in settings (color, recheck) |
| E                            | edit the selected environment                                     |
| R                            | reload: live MCP status, changelog on the “Update” tab        |
| Enter on a command row     | copy the update command to the clipboard (“Update” tab)  |
| X                            | remove the selected extension (with confirmation)                       |
| printable characters / Backspace | entering a name (creation form)                                           |
| ESC                          | back from a sub-screen / exit; on a busy screen — interrupt the process |
| Ctrl+C                       | exit (running processes are killed first)                          |

## Installation

```bash
npm install -g @devmaksi/pi-env   # or one-off: npx @devmaksi/pi-env
```

All installation methods (including Node.js setup), removal, and notes
(TTY, Windows) — in [docs/installation.md](docs/installation.md).

## Documentation

- [Installation](docs/installation.md) — Node.js, pi-env install/remove
- [Development](docs/development.md) — stack, quick start, project structure,
  conventions
- [CHANGELOG.md](https://github.com/devmaksi/pi-env/blob/master/CHANGELOG.md) — release history
- [AGENTS.md](https://github.com/devmaksi/pi-env/blob/master/AGENTS.md) — environments model, current status, roadmap

## For the pi agent

The package ships a `pi-env` skill: install it as a Pi package
(`pi install npm:@devmaksi/pi-env`) and the agent can create environments,
launch them, and explain what lives in `settings.json`. Manual reference is in
[SKILL.md](pi/skills/pi-env/SKILL.md).
