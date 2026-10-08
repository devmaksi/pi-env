# TODO — pi-env

Рабочий список после audit-code (этап 2 готов, 189/189 тестов).
Порядок секций = приоритет: 1 — делать первой, дальше по убыванию.

## 1. Ужимки (ponytail-audit, ~-54 строки, механика, покрыто тестами)

Все пункты — одной пачкой; проверка — полный прогон `npm test`.

- [ ] Общий `readJsonFile(path)` (regex trailing-commas) вместо трёх копий:
      `catalog.ts readJson`, `mcp.ts readMcpServers`, `mcp.ts removeMcpEntry`.
      Хелпер в mcp.ts (catalog его уже импортирует), остальное — импорт.
- [ ] `listFiles`/`listDirs` (environments.ts) → один `listEntries(dir, is)`.
- [ ] `createBusy`/`extBusy`/`mcpTabBusy` (sections.ts) → общий
      `busySection(record, view, ctx)` (шаблон Record[view] → строка → hints).
- [ ] `baseName` ×2 (экспорт create.ts + частный catalog.ts) → `basename`
      из node:path в state.ts/create.ts/catalog.ts; из catalog.ts убрать
      `import { sep }`.
- [ ] `parentDir` (create.ts) → `dirname` из node:path.
- [ ] `homeDir` (catalog.ts) → `osHomedir()` (он сам смотрит $HOME).
- [ ] `TEXT_ROWS` (state.ts) и `textRows` Set (sections.ts renderMcpForm) —
      один экспортированный `TEXT_ROWS`.
- [ ] `mcpFormStep` (state.ts): дублирующая проверка печатного символа →
      `isPrintable`.

## 2. Версия в «О программе» (2 строки, прицепить к любому ближайшему коммиту)

- [ ] `renderAbout` (render.ts) хардкодит `pi-env 0.1.0`, а package.json — 0.1.2:
      версию брать из package.json (createRequire + new URL) либо убрать
      строку из «О программе».

## 3. Баг: коллизии пакетных скиллов (порча settings при редактировании)

Единственный реальный баг в списке; делать вдумчиво, с тестом на коллизию.
Подробности — `docs/superpowers/bugs/BUG-env-edit-skill-collision.md`.

- [ ] Симптом: два пакета со скиллом одного имени (оба `skills/foo`) в форме
      редактирования неотличимы — `freshEdit` предмечает оба по одной строке
      `skills/<baseName>`; `updateEnvironment` удаляет по `s.name`
      (`pkg2/foo` — вложенный путь), а `createEnvironment` кладёт коллизию
      в `foo`/`foo-2` — снятый скилл остаётся каталогом, settings.json
      перечисляет его снова.
- [ ] Фикс: идентичность скилла — по пути (`SkillItem.path`) во всех слоях:
      `freshEdit` → `updateEnvironment` → settings (`skills/<каталог>`
      остаётся пи-форматом, выбор/удаление — по пути). Альтернатива:
      запретить выбор коллизии с пометкой в UI.

## 4. readJson: regex trailing-commas (после §1 — точка одна)

- [ ] Regex теоретически ломает строки, содержащие `",}"` (задокументировано
      ponytail); после объединения в `readJsonFile` (§1) починить в одном
      месте: валидный JSON или аккуратный pre-parse.

## 5. Refactor: длина файлов и функций (после ужимок)

Цель: все файлы < 300 строк, функции 4–20 строк. Тесты render/state
фиксируют поведение — разбивка проверяется полным прогоном `npm test`.

- [x] `render.ts` (было 440, стало 372): вынесены секции в функции
      `renderCreate(cr, ctx)`, `renderExtTab(ext, ctx)`,
      `renderEnvList(envs, state, ctx)`, `renderSettings/renderAbout/renderFooter`;
      `render()` — только диспетчер (таб-бар + вызов секции + сборка колонок/футера).
- [ ] `state.ts` (749): `reducer` → `reducerMain` (вкладки/суб-экраны) +
      делегирование; `createReducer` (135 строк) — таблица
      view → обработчик (по одному < 20 строк).
- [ ] `run.ts` (421): `dispatch` (≈110 строк) → `applyKey` (reducer +
      имена) + `runSideEffects` (хуки переходов: removing/updating/
      installing/submitting/deleting/run).
- [ ] F1: `reducer(state, action, envNames, twoColumns)` — 4 аргумента;
      при разбивке (пункт выше) упаковать `(envNames, twoColumns)` в
      `Ctx` и пересмотреть все вызовы + тесты. Отдельным пунктом не делать.

## 6. Фичи (этап 3)

- [ ] MCP live-статус: просмотр/добавление/удаление во вкладке «MCP» и в
      форме окружения уже готовы (этап 2); осталось — живой статус
      подключения каждого сервера по `pi mcp list`.
- [ ] `parsePackageCatalog`: имена пакетов из pi.dev попадают в TUI без
      санитизации (ANSI/переносы — визуальное повреждение); при надобности —
      отбрасывать контрольные символы на границе парсера.

## 7. Процесс (после кодовых изменений)

- [ ] `request-review` — независимый взгляд на аудит-фиксы (с пометкой о
      зафиксированных отклонениях: F1 reducer, длина render/state).
- [ ] `commit-message` — сообщение для аудит-фиксов.
- [ ] Планы в `docs/superpowers/plans/`: добавить `type:`/`context:`
      метаданные (frontmatter) или зафиксировать формат заголовка в
      AGENTS.md.

## 8. Готово

- [x] Повторная проверка обновлений на вкладке «Расширения» — решено
      настройкой «Перепроверка обновлений» (вкладка «Настройки», персистентно
      в `<root>/.pi-env.json`); по умолчанию выкл (старое поведение).
- [x] Дорожная карта: «полные настройки, детальная инфо-панель» — готовы
      (детализация окружения, настройки приложения с персистентностью).
