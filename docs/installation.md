# Установка
[English](installation.en.md) | [Русский](installation.md)

**Требования:**

- Node.js ≥ 20;
- установленный CLI `pi` (`@earendil-works/pi-coding-agent`) — `pi-env`
  вызывает `pi` для запуска окружений и управления пакетами:

  ```bash
  npm install -g @earendil-works/pi-coding-agent
  ```

## Установить Node.js

**Linux (Debian/Ubuntu):**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

(или пакетный менеджер дистрибутива: `dnf install nodejs`, `pacman -S nodejs-lts`)

**macOS:**

```bash
brew install node
```

**Windows:**

```powershell
winget install OpenJS.NodeJS.LTS
```

(или установщик с https://nodejs.org — в PowerShell/CMD после перезапуска)

Проверка: `node -v` (должно быть ≥ 20) и `npm -v`.

## Установка pi-env

**Из npm-реестра (основной способ):**

```bash
npm install -g @devmaksi/pi-env
```

Одноразовый запуск без установки:

```bash
npx @devmaksi/pi-env
```

**Из исходников (для разработки):** глобальный symlink на проект —
правки исходников сразу видны в CLI:

```bash
cd /путь/к/pi-env
npm install
npm run build
npm link
```

После установки:

```bash
pi-env              # запуск TUI (корень окружений — ~/.pi-env)
pi-env --root /tmp  # другой корень окружений
pi-env --help       # справка
```

> **Примечание:** утилита требует интерактивный терминал (TTY) — в pipe/CI не
> запустится и покажет сообщение об ошибке.
>
> **Windows (PowerShell/CMD):** всё то же самое — `npm install -g @devmaksi/pi-env`;
> глобальный prefix npm по умолчанию уже в `PATH`. Если команда не находится —
> перезапустите терминал.

## Удаление глобальной установки

```bash
npm uninstall -g @devmaksi/pi-env   # либо: npm unlink -g pi-env (для npm link)
```

