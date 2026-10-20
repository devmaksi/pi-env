# TODO — pi-env

Рабочий список после audit-code (этап 2 готов, 189/189 тестов).
Порядок секций = приоритет: 1 — делать первой, дальше по убыванию.

## 1. Ужимки (ponytail-audit, ~-54 строки, механика, покрыто тестами)

Все пункты — одной пачкой; проверка — полный прогон `npm test`.

- [x] Общий `readJsonFile(path)` (regex trailing-commas) вместо трёх копий:
  `catalog.ts readJson`, `mcp.ts readMcpServers`, `mcp.ts removeMcpEntry`.
  Хелпер в mcp.ts (catalog его уже импортирует), остальное — импорт.
- [x] `listFiles`/`listDirs` (environments.ts) → один `listEntries(dir, is)`.
- [x] `createBusy`/`extBusy`/`mcpTabBusy` (sections.ts) → общий
  `busySection(record, view, ctx)` (шаблон Record[view] → строка → hints).
- [x] `baseName` ×2 (экспорт create.ts + частный catalog.ts) → `basename`
  из node:path в state.ts/create.ts/catalog.ts; из catalog.ts убрать
  `import { sep }`.
- [x] `parentDir` (create.ts) → `dirname` из node:path.
- [x] `homeDir` (catalog.ts) → `osHomedir()` (он сам смотрит $HOME).
- [x] `TEXT_ROWS` (state.ts) и `textRows` Set (sections.ts renderMcpForm) —
  один экспортированный `TEXT_ROWS`.
- [x] `mcpFormStep` (state.ts): дублирующая проверка печатного символа →
  `isPrintable`.

## 2. Версия в «О программе» (2 строки, прицепить к любому ближайшему коммиту)

- [x] `renderAbout` (render.ts) хардкодит `pi-env 0.1.0`, а package.json — 0.1.2:
  версию брать из package.json (createRequire + new URL) либо убрать
  строку из «О программе».

## 3. Баг: коллизии пакетных скиллов (порча settings при редактировании)

Единственный реальный баг в списке; делать вдумчиво, с тестом на коллизию.
Подробности — `docs/superpowers/bugs/BUG-env-edit-skill-collision.md`.

- [x] Симптом: два пакета со скиллом одного имени (оба `skills/foo`) в форме
  редактирования неотличимы — `freshEdit` предмечает оба по одной строке
  `skills/<baseName>`; `updateEnvironment` удаляет по `s.name`
  (`pkg2/foo` — вложенный путь), а `createEnvironment` кладёт коллизию
  в `foo`/`foo-2` — снятый скилл остаётся каталогом, settings.json
  перечисляет его снова.
- [x] Фикс (вариант A — идентичность по имени каталога): `listSkills` выдаёт
  уникальные имена (`uniqueName` экспортируется из catalog.ts), каталог
  скилла в окружении — `envSkillDirName` (имя из каталога, `/` → `-`:
  `pkg-b/dup` → `pkg-b-dup`) и в `createEnvironment`, и в `updateEnvironment`;
  `freshEdit` предмечает по тому же имени. Вариант «идентичность по пути»
  и запрет выбора коллизии не выбраны. Ограничение: legacy-каталоги вида
  `foo-2` в существующих окружениях не мигрируют.

## 4. readJson: regex trailing-commas (после §1 — точка одна)

- [x] Regex вырезал запятые и внутри JSON-строк: `{"a":"hello, }world"}` →
  значение `hello}world` (молча, на полностью валидном файле). Починено в
  `readJsonFile` (единственное место после §1): строковый литерал — первая
  альтернатива `/"(?:[^"\\]|\\.)*"|,\s*([}\]])/g`, запятые вне строк не
  трогает. 3 новых теста; на 34 реальных json (4 с trailing commas) вывод
  совпадает со старым.

## 5. Refactor: длина файлов и функций (после ужимок)

Цель: все файлы < 300 строк, функции 4–20 строк. Тесты render/state
фиксируют поведение — разбивка проверяется полным прогоном `npm test`.

- [x] `render.ts` (было 440, стало 372): вынесены секции в функции
  `renderCreate(cr, ctx)`, `renderExtTab(ext, ctx)`,
  `renderEnvList(envs, state, ctx)`, `renderSettings/renderAbout/renderFooter`;
  `render()` — только диспетчер (таб-бар + вызов секции + сборка колонок/футера).
- [x] `state.ts` (было 749, стало 271): `reducer` — диспетчер (`applyResults` →
  `createReducer` → `extMachine` → `mcpMachine` → `reducerMain`); вынесены
  `state-mcp.ts` (154), `state-form.ts` (173), `state-create.ts` (217),
  `state-ext.ts` (62); `createReducer` — таблица `CREATE_VIEWS` view → handler.
- [x] `run.ts` (было 421, стало 243): `dispatch` → `applyKey` (reducer +
  снимок `PrevSnap`) + `runSideEffects` в `run-side.ts` (172) через интерфейс
  `Loop`; pi/npm-обёртки — `pi-actions.ts` (50) и `cmd.ts` (44);
  `launchPi`/`runPassthrough` — `pirun.ts` (46).
- [x] F1: `reducer(state, action, ctx: ReducerCtx)` — `ReducerCtx`
  (`envNames` + `twoColumns`) вместо 4-х аргументов; вызовы и тесты обновлены.
  (исходная формулировка: упаковать `(envNames, twoColumns)` в контекст
  и пересмотреть все вызовы + тесты.)

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
