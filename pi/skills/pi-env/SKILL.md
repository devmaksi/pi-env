---
name: pi-env
description: Manage Pi agent environments (profiles) with the pi-env CLI — list, create, launch and inspect per-project configs. Use when a task must run Pi with an isolated config directory, switch between Pi setups, or manage extensions, skills and MCP servers per environment.
---

# pi-env — Pi environment manager

A Pi environment is a folder holding a complete agent configuration:
`settings.json`, `extensions/`, `skills/`, `agents/`, `themes/`, `mcp.json`.
Pi reads it when `PI_CODING_AGENT_DIR` points at that folder. `pi-env` creates
such folders and launches Pi inside them.

## Inspect before acting

- `pi-env --help` — flags and usage.
- `pi-env` — interactive TUI (Environments | Extensions | MCP | Settings |
  About). It needs a real TTY; do not start it from a non-interactive tool call.
- Environments live under `~/.pi-env` unless `--root <path>` or `PI_ENV_ROOT`
  says otherwise. `ls ~/.pi-env` lists them.

## Run Pi in an environment (safe in scripts)

`pi-env <env> [pi args...]` spawns `pi` with `PI_CODING_AGENT_DIR=<root>/<env>`
and passes the arguments through unchanged:

```bash
pi-env work --mode json "Summarize this repository"
```

Prefer this over exporting `PI_CODING_AGENT_DIR` by hand: the environment stays
discoverable in the TUI and the launch is one short command.

## Create or edit an environment without the TUI

The folder layout is the contract; write it directly when scripting:

```text
~/.pi-env/<name>/
├── settings.json   {"defaultProvider": "...", "defaultModel": "...",
│                    "extensions": ["extensions/foo.ts"],
│                    "skills": ["skills/bar"],
│                    "packages": ["npm:pi-mcp-adapter"]}
├── extensions/
├── skills/
├── agents/
├── themes/
└── mcp.json        {"mcpServers": {"<name>": {...}}}
```

Rules:

- Keys in `settings.json` are Pi's own; paths inside it are relative to the
  environment directory.
- MCP servers belong in `mcp.json`, never in `settings.json`.
- `models.json`, `models-store.json` and `auth.json` are copied from the main
  agent at creation time by the TUI form. Copy them by hand only when you
  deliberately want to fork the main agent's model catalog and credentials.
- Package entries use the same source syntax as `pi install` (`npm:...`,
  `git:...`), without the `pi install` prefix.

## Conventions

- When the user says "environment", change that environment's folder — never
  the main agent config in `~/.pi/agent`.
- Ask the user before deleting an environment directory; deletion is not
  reversible.
