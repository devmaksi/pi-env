# Разработка
[English](development.md) | [Русский](development.ru.md)

**Стек:** Node.js ≥ 22.19 (как у pi 1.3/1.4), TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей.
Dev-зависимости: `typescript`, `tsx`, `@types/node`. Тесты — `node:test`.

## Быстрый старт

```bash
git clone <repo> pi-env
cd pi-env
npm install            # dev-зависимости
npm run build          # компиляция src/ → dist/
npm test               # тесты ядра: tsx --test test/*.test.ts
npx tsx src/index.ts   # запуск TUI без сборки (улучшенная разработка)
npm run start          # запуск собранного CLI (node dist/index.js)
```

## Структура проекта

| Файл                  | Назначение                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `src/index.ts`        | вход: аргументы (`--root`, `--help`), TTY-проверка, старт              |
| `src/terminal.ts`     | raw-режим, `parseKeys` (чистая), фабрика `Term`                        |
| `src/environments.ts` | `scan(root)` (чистая)                                                  |
| `src/layout.ts`       | `computeLayout` (чистая), константы порогов                            |
| `src/catalog.ts`      | каталоги моделей/инструментов/пакетов/скиллов, каталог pi.dev (чистые) |
| `src/create.ts`       | создание/обновление/удаление окружений, валидация имени                |
| `src/state.ts`        | `AppState`, `reducer`, машины форм создания/редактирования (чистые)    |
| `src/render.ts`       | `render(args)` → строки ANSI (чистая)                                  |
| `src/sections.ts`     | секции вкладок: формы, «Расширения», окружения + детализация (чистые)  |
| `src/appsettings.ts`  | настройки приложения (`<root>/.pi-env.json`)                           |
| `src/run.ts`          | цикл приложения, вызовы `pi`/`npm`, запуск дочернего процесса          |
| `test/*.test.ts`      | тесты чистого ядра (`node:test`)                                       |

## Конвенции

- Вся логика, не требующая TTY, — **чистые функции**, покрытые тестами
  `node:test`; терминальный слой (`terminal.ts`, `run.ts`) остаётся тонким.
- UI-тексты и сообщения — через `t(lang, key)` (`src/i18n.ts`), словари —
  `src/locales/*.json` (ru — базовый, en — полный).
- Документация: файл без суффикса — английский, русский текст — в файлах с
  суффиксом `.ru`; `.en.md` в репозитории нет.
- **Не добавлять** runtime-зависимости без необходимости.
- Изменения раскладки/поведения клавиш — только вместе с обновлением тестов
  `render`/`state` и `AGENTS.md`.

## Цикл разработки

```bash
# правки в src/
npx tsx src/index.ts   # проверить поведение вживую
npm test               # прогнать тесты ядра
npm run build          # собрать
```

## Съёмка демо-GIF

```bash
pi-env                # сначала закрыть все открытые pi-env — скрипт иначе отказывается
npm run demo          # пересъёмка docs/demo.gif и docs/demo.ru.gif
```

`demo/` — Python 3 стенд (только stdlib): `demo/ptycast.py` ведёт PTY и пишет asciinema
cast, `demo/script.py` — сценарий клавиш и маркеров, `demo/capture.py` закрепляет язык
pi-env и рендерит GIF через `agg` (`demo/bin/agg`, скачивается при первом запуске и в git
не попадает; `demo/out/` тоже). Стенд сам проверяет работу с alt-screen
(`python3 -m demo.capture --selftest`), покрытие — `python3 -m unittest demo.test_ptycast
demo.test_capture`. В `files` package.json `demo/` нет, поэтому в npm-тарбелл он не
попадает.

Подробное описание модели окружений, текущего статуса и дорожной карты — в
`AGENTS.md`.
