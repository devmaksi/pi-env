# Разработка
[English](development.en.md) | [Русский](development.md)

**Стек:** Node.js ≥ 20, TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей.
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
- UI-тексты и сообщения — **на русском**.
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

Подробное описание модели окружений, текущего статуса и дорожной карты — в
`AGENTS.md`.
