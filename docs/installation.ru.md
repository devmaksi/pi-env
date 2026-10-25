# Установка
[English](installation.md) | [Русский](installation.ru.md)

**Требования:**

- Node.js ≥ 22.19 — столько же требует сам `pi` (pi 1.3/1.4: Node ≥ 22.19);
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

Проверка: `node -v` (должно быть ≥ 22.19) и `npm -v`.

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

## Обновление pi-env

pi-env сам себя не обновляет: он только сообщает, что есть более свежая версия, и
показывает команду под ваш способ установки.

```bash
npm i -g @devmaksi/pi-env@latest        # установка через npm -g
pi update @devmaksi/pi-env              # установка как pi-пакет
git pull && npm install && npm run build   # исходники (npm link)
```

`npx @devmaksi/pi-env` каждый раз использует временную кэшированную копию, поэтому
рекомендуется глобальная установка — вкладка «Обновление» говорит то же самое. Установка
из исходников опознаётся и к npm не сверяется вовсе.

Вкладка «Обновление» (появляется только когда обновление есть) показывает текущую и
доступную версию, команду и чейнджлог пропущенных релизов; Enter по строке команды
копирует её в буфер, `R` перечитывает реестр и чейнджлог. Проверка — один фоновый запрос
на запуск к `https://registry.npmjs.org`. Отключить её так:

```bash
PI_ENV_NO_UPDATE_CHECK=1 pi-env
```

## Удаление глобальной установки

```bash
npm uninstall -g @devmaksi/pi-env   # либо: npm unlink -g pi-env (для npm link)
```

