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

## Глобальная установка pi-env

Запустите в каталоге репозитория (все три варианта делают команду `pi-env`
доступной из любого места в терминале):

```bash
# 1. npm link — удобно, если вы работаете с исходниками (создаёт глобальный
#    symlink на каталог проекта; правки исходников сразу видны в CLI)
cd /путь/к/pi-env
npm install
npm run build
npm link

# 2. npm install -g <путь> — копирует пакет в глобальный prefix
npm install -g /путь/к/pi-env

# 3. npm pack + установка архива (если репозитория локально нет)
npm pack /путь/к/pi-env
npm install -g pi-env-0.1.0.tgz
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
> **Windows (PowerShell/CMD):** всё то же самое — `npm install -g <путь>`;
> глобальный prefix npm по умолчанию уже в `PATH`. Если команда не находится —
> перезапустите терминал.

## Удаление глобальной установки

```bash
npm uninstall -g pi-env   # либо: npm unlink -g pi-env (для npm link)
```

