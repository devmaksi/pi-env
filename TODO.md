# TODO — pi-env

Рабочий список после audit-code (этап 2 готов, 158/158 тестов).

## 1. Refactor: длина файлов и функций (✗ в аудите, code style)

Цель: все файлы < 300 строк, функции 4–20 строк. Тесты render/state
фиксируют выход — разбивка проверяется полным прогоном `npm test`.

- [x] `render.ts` (440): вынести секции в функции `renderCreate(cr, ctx)`,
      `renderExtTab(ext, ctx)`, `renderEnvList(envs, state, ctx)`,
      `renderSettings/renderAbout/renderFooter`; `render()` — только
      диспетчер (таб-бар + вызов секции + сборка колонок/футера).
- [ ] `state.ts` (454): `reducer` → `reducerMain` (вкладки/суб-экраны) +
      делегирование; `createReducer` (135 строк) — таблица
      view → обработчик (по одному < 20 строк).
- [ ] `run.ts` (308): `dispatch` (≈110 строк) → `applyKey` (reducer +
      имена) + `runSideEffects` (хуки переходов: removing/updating/
      installing/submitting/deleting/run).
- [ ] F1: `reducer(state, action, envNames, twoColumns)` — 4 аргумента;
      при разбивке (пункт выше) упаковать `(envNames, twoColumns)` в
      `Ctx` и пересмотреть все вызовы + тесты.

## 2. Баг (залогирован, фикс — с этапом 3)

- [ ] `docs/superpowers/bugs/BUG-env-edit-skill-collision.md` — коллизии
      пакетных скиллов в редактировании окружения: идентичность скилла
      вести по `SkillItem.path` (freshEdit → updateEnvironment →
      settings), либо запретить выбор коллизии с пометкой в UI.

## 3. Мелкие улучшения (не блокируют)

- [ ] Повторная проверка обновлений на вкладке «Расширения»: сейчас
      `checkUpdates` запускается только при `pkgCheck === 'idle'` (первый
      вход), маркеры могут устареть; в форме пакетов — при каждом входе.
      Решить: перечитывать при каждом входе во вкладку (или кнопка).
- [ ] `catalog.ts readJson`: regex trailing-commas теоретически ломает
      строки, содержащие `",}"` (документировано ponytail); при надобности
      — валидный JSON или аккуратный pre-parse.
- [ ] `parsePackageCatalog`: имена пакетов из pi.dev попадают в TUI без
      санитизации (ANSI/переносы — визуальное повреждение); при надобности
      — отбрасывать контрольные символы на границе парсера.
- [ ] Планы в `docs/superpowers/plans/`: добавить `type:`/`context:`
      метаданные (frontmatter) или зафиксировать формат заголовка в
      AGENTS.md.

## 4. Процесс (после аудита)

- [ ] `request-review` — независимый взгляд на аудит-фиксы (с пометкой о
      зафиксированных отклонениях: F1 reducer, длина render/state).
- [ ] `commit-message` — сообщение для аудит-фиксов (см. ниже, готово).
- [ ] Этап 3 (дорожная карта AGENTS.md): полные настройки, детальная
      инфо-панель — вместе с ними пункты 1 и 2 выше.
