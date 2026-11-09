# Installation

[English](installation.md) | [Русский](installation.ru.md)

**Requirements:**

- Node.js ≥ 22.19 — the same floor `pi` itself requires (pi 1.3/1.4: Node ≥ 22.19);
- the installed `pi` CLI (`@earendil-works/pi-coding-agent`) — `pi-env`
  invokes `pi` to launch environments and manage packages:

  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```

## Installing Node.js

**Linux (Debian/Ubuntu):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

(or your distribution's package manager: `dnf install nodejs`, `pacman -S nodejs-lts`)

**macOS:**

```bash
brew install node
```

**Windows:**

```powershell
winget install OpenJS.NodeJS.LTS
```

(or the installer from https://nodejs.org — in PowerShell/CMD after a restart)

Check: `node -v` (must be ≥ 22.19) and `npm -v`.

## Installing pi-env

**From the npm registry (the standard way):**

```bash
npm install -g @devmaksi/pi-env
```

One-off run without installation:

```bash
npx @devmaksi/pi-env
```

**From sources (for development):** a global symlink to the project —
source changes are visible in the CLI right away:

```bash
cd /path/to/pi-env
npm install
npm run build
npm link
```

After installation:

```bash
pi-env              # launch the TUI (environments root — ~/.pi-env)
pi-env --root /tmp  # a different environments root
pi-env --help       # help
```

> **Note:** the utility requires an interactive terminal (TTY) — it will not
> start in pipe/CI and will show an error message.
>
> **Windows (PowerShell/CMD):** everything is the same — `npm install -g @devmaksi/pi-env`;
> npm's global prefix is already in `PATH` by default. If the command is not found —
> restart the terminal.

## Updating pi-env

pi-env never updates itself: it only reports that a newer version exists and shows
the command for the way you installed it.

```bash
npm i -g @devmaksi/pi-env@latest        # installed with npm -g
pi update @devmaksi/pi-env              # installed as a pi package
git pull && npm install && npm run build   # source checkout (npm link)
```

`npx @devmaksi/pi-env` uses a temporary cached copy every time, so a global install
is recommended — the “Update” tab says the same. A source checkout is detected and
never queried against npm.

The “Update” tab (it appears only when an update exists) shows the current and the
available version, the command, and the changelog of the releases you skipped; Enter
on a command row copies it to the clipboard, `R` re-reads the registry and the
changelog. The check is a single background request per launch to
`https://registry.npmjs.org`. Turn it off with:

```bash
PI_ENV_NO_UPDATE_CHECK=1 pi-env
```

### Diagnostics

An environment whose `settings.json` or `mcp.json` cannot be read is marked `⚠` in the
environment list, and its info panel shows the error text. Failures that used to disappear
without a trace (an unreadable root, a catalog that failed to reload, a version check that
failed) are written to a journal when debugging is on:

```bash
PI_ENV_DEBUG=1 pi-env      # append to <root>/.pi-env.log
```

The journal is one line per problem — `2026-11-09 19:40:12 env demo: settings.json — <текст>`
— and a distinct problem is recorded once per run. pi-env does not repair these files.

## Removing the global installation

```bash
npm uninstall -g @devmaksi/pi-env   # or: npm unlink -g pi-env (for npm link)
```
