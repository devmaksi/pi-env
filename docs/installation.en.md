# Installation

[English](installation.en.md) | [Русский](installation.md)

**Requirements:**

- Node.js ≥ 20;
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

Check: `node -v` (must be ≥ 20) and `npm -v`.

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

## Removing the global installation

```bash
npm uninstall -g @devmaksi/pi-env   # or: npm unlink -g pi-env (for npm link)
```
