# AGENTS.md — pi-env

## Назначение

`pi-env` — интерактивная TUI-утилита для управления окружениями ИИ-агента `pi`.
Окружение pi — отдельная папка с конфигурацией агента (аналог `~/.pi/agent`):
`settings.json`, `extensions/`, `skills/`, `agents/`, `themes/`. Агент читает
конфигурацию из каталога, задаваемого переменной окружения `PI_CODING_AGENT_DIR`.

## Модель окружения

- Корневой каталог окружений: `~/.pi-env`.
- Переопределение: флаг `--root <путь>` (приоритет) или переменная `PI_ENV_ROOT`.
- Окружение = подкаталог корня `<root>/<имя>/`; любая подпапка — окружение,
  файлы игнорируются.
- Запуск окружения (этап 2): процесс `pi` с `PI_CODING_AGENT_DIR=<путь окружения>`
  в текущей рабочей директории.

## Текущий статус (этап 2 готов; этап 3: живой статус MCP готов)

- Работает: список окружений, таб-бар `Окружения | Расширения | MCP | Настройки | О программе`,
  клавиши ↑↓←→/TAB/Enter/Space/ESC + печатные символы/Backspace, адаптивные
  две колонки (порог 62), создание окружения, вкладка настроек приложения
  («Цветной вывод», «Перепроверка обновлений» — персистентность в
  <root>/.pi-env.json), статус-строка, вкладка «О программе» (версия из package.json, строка поддержки + ссылка https://boosty.to/devmaksi),
  запуск окружения (дочерний `pi` с передачей терминала, возврат в TUI по выходе),
  редактирование окружения (E: модель, инструменты, пакеты, скиллы, переименование,
  удаление с подтверждением), управление расширениями в форме (маркеры
  «↑ latest» по `npm outdated` самого окружения, включая env-only пакеты,
  строка «Обновить все» через `pi update --extensions` в каталоге окружения,
  полное удаление через `pi remove` с подтверждением, инфо-панель пакета справа),
  вкладка «Расширения» (глобальные пакеты main-агента: Enter — обновить пакет
  (`pi update <source>`), X — удалить, «Обновить все»),
  установка расширений из каталога `https://pi.dev/packages` (экран пикера:
  список по загрузкам, инфо-панель; каталог пагинирован (50/стр), грузятся
  ВСЕ страницы параллельно (8 потоков) с прогрессом «N/total», дедупликация
  по имени — поиск ищет по всему каталогу, а не по первой 50-ке; глобально —
  в вкладке, в окружение — кнопка «Установить» в списке пакетов формы;
  `pi install` с нужным `PI_CODING_AGENT_DIR`; поиск по имени пакета —
  регистронезависимый),
  CLI-проброс: `pi-env <окружение> [аргументы pi...]` —
  неинтерактивный запуск pi в окружении (аргументы передаются pi как есть,
  код выхода pi пробрасывается, TTY не требуется — работает `--mode json` в pipe),
  управление MCP: вкладка «MCP» (main-агент: список серверов, инфо-панель,
  «Добавить» — форма на 9 полей stdio/http: имя, тип, команда, аргументы,
  URL, переменные, рабочая директория, описание, exposure; добавление —
  `pi mcp add` с валидацией, X — удалить с подтверждением (чистый JSON,
  последняя запись → удаление файла)), строка «MCP» формы окружения
  (edit: union «окружение + main» — копирование MCP main-агента в окружение,
  удаление записей окружения, «Добавить новый» в окружение; create — отметки
  из main, mcp.json пишется при создании), MCP в детализации окружения
- Живой статус MCP (`pi mcp list --json`, этап 3): маркеры подключения в списке
  вкладки «MCP» и в списке MCP формы окружения (`✓ N` — подключён и N инструментов,
  `⚠ вход`, `✗ ошибка`, `— выкл`), в инфо-панели — состояние, текст ошибки,
  project-override; сервер из `.pi/mcp.json`, отсутствующий в mcp.json, показан
  отдельной строкой; ошибки конфигурации — справа. Проверка: при первом входе
  в список и по клавише `R`; далее при каждом входе — только с настройкой
  «Перепроверять MCP» (по умолчанию выкл). Во время проверки список доступен
  для навигации; индикатор «Проверка MCP…».
- Гарантия терминала: весь терминальный участок запуска (`start → repaint → цикл клавиш`) обёрнут в `withShutdown` (`src/shutdown.ts`) — `term.stop()` вызывается ровно один раз: при нормальном выходе, исключении из цикла (в т.ч. из `doSubmit`/`updateEnvironment`), rejection из необранной pi-команды (`void checkUpdates/...`) и по `SIGINT`/`SIGTERM`/`SIGHUP`. Исключение — строка `crash.terminal` + stack в stderr и код 1; сигналы восстанавливают терминал молча. `start()/stop()` идемпотентны (флаг `running` в `terminal.ts`), поэтому cleanup не пишет escape-коды в экран, когда терминалом владеет дочерний `pi`.
- Детализация окружения: инфо-панель выбранного (settings.json, модель,
  инструменты — файлы extensions/, скиллы — подкаталоги skills/,
  расширения — пакеты, MCP — mcp.json; списки обрезаются по 4 позиции,
  «+N ещё»).
- Скролл: окно списка следует за курсором (все списки длиннее кадра).
- Создание окружения: форма (имя — обязательное; модель по умолчанию
  «провайдер → модель», свои инструменты, расширения-пакеты, скиллы —
  опциональные). Каталог берётся из main-агента (`PI_CODING_AGENT_DIR`,
  по умолчанию `~/.pi/agent`): models.json + models-store.json, файлы
  extensions/, пакеты settings.json → packages, скиллы + пакетные скиллы.
  Результат: `<root>/<имя>/` с `settings.json`, скопированными инструментами
  (extensions/), скиллами (skills/) и каталогом моделей (models.json,
  models-store.json, auth.json); пакеты — по source в settings.packages.
- Настройки приложения: «Цветной вывод» (по умолчанию вкл), «Перепроверка
  обновлений» (по умолчанию выкл; при вкл — `npm outdated` при каждом входе
  во вкладку «Расширения», а не только при первом), «Перепроверять MCP»
  (по умолчанию выкл; при вкл — `pi mcp list` при каждом входе в список MCP),
  «Язык» (ru/en, ←/→ на строке; по умолчанию — из системного locale,
  переопределяется выбором). Строки-переключатели: 1, 2, 3; «Язык» — строка 4
  (`LANGUAGE_ROW`). Загружаются при старте, сохраняются при переключении:
  `<root>/.pi-env.json`.

## Стек

- Node.js ≥ 22.19 (столько же требует pi 1.3/1.4), TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей.
- Dev-зависимости: `typescript`, `tsx`. Тесты: `node:test`.

## Команды

- `npm run build` — компиляция `src/` → `dist/`
- `npm test` — `tsx --test test/*.test.ts`
- `npm run start` — запуск CLI (`node dist/index.js`)
- `npx tsx src/index.ts` — запуск без сборки


## Публикация новой версии

- npm-пакет — `@devmaksi/pi-env` (безскоупный `pi-env` занят);
  установка: `npm i -g @devmaksi/pi-env` (или `npx @devmaksi/pi-env`).
- Релиз: bump `version` в package.json → коммит → `git tag vX.Y.Z` →
  push тега (уходит в оба remote сразу: у origin два pushurl — git.lan
  и github.com).
- CI `.github/workflows/publish.yml` на тег `v*`: `npm ci` → build →
  проверка «тег = версия» → `npm publish --provenance --access public`
  → GitHub Release (идемпотентно: существующий релиз не создаёт заново).
  Публикация — через npm Trusted Publishing (OIDC от GitHub): токена
  в репозитории нет, `permissions: id-token: write`, внутри воркфлоу
  npm обновляется до `npm@11` (trusted publishing требует ≥ 11.5.1).
- npm-аккаунт `devmaksi` владеет скоупом `@devmaksi`, 2FA включён
  (обязателен для publish). Trusted publisher зарегистрирован на пакете:
  npmjs.com → пакет → Settings → Publishing access → Trusted Publishers
  (GitHub Actions, org `devmaksi`, repo `pi-env`, файл `publish.yml`,
  действие `npm publish`).
- Ловушки (проверено на v0.1.0):
  - provenance требует `--access public`: scop'd-пакеты по умолчанию
    private (иначе `EUSAGE: Can't generate provenance for new or
    private package`).
  - publish с 2FA через приложение-аутентификатор требует одноразовый
    пароль (`--otp`) — из CI его не дать; это и есть сценарий
    trusted publishing (OIDC) вместо токена.
  - Trusted publisher регистрируется только на СУЩЕСТВУЮЩЕМ пакете:
    первый релиз делается вручную (`npm login` → `npm publish --access
    public` с кодом 2FA), дальше — CI.
  - Воркфлоу по тегу использует файл workflow из коммита, на который
    указывает тег: при изменении `publish.yml` тег подвигать
    (`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`).
  - Раннер закреплён на `ubuntu-24.04`: `ubuntu-latest` не получил
    хостед-раннер («job was not acquired by Runner of type hosted»).
  - Контроль результата без GitHub API (60 req/ч на IP):
    `curl https://registry.npmjs.org/@devmaksi%2Fpi-env` (200 = опубликован)
    и `curl https://github.com/devmaksi/pi-env/releases.atom` (релиз).
  - Реестр npm отстаёт от зелёного CI: после успешного publish версия
    появляется в `registry.npmjs.org` через ~4 минуты (0.1.3 — 404 на `/0.1.3`
    при завершённом job и созданном релизе). Проверять повторно, а не чинить CI.

## Структура

- `src/index.ts` — вход: аргументы (`--root`, `--help`, проброс в окружение), TTY-проверка, старт
- `src/cli.ts` — `parsePiEnvArgs` (чистая): `pi-env [--root <путь>] <окружение> [аргументы pi...]` — первое позиционное = окружение, остальное — проброс в pi как есть
- `src/i18n.ts` — словари переводов: `t(lang, key, params?)`, `resolve`
  (ru-фолбэк), `loadLocales`/`localeCodes` (сканирование `src/locales/*.json`,
  новая локаль = новый файл, без кода), `nativeName`, `defaultLang`
  (Intl → LANG → 'ru'), `StrKey` — ключи проверяются на этапе компиляции
- `src/locales/ru.json`, `src/locales/en.json` — словари (ключ — имя,
  `native-name` — название языка; `{p}` — плейсхолдеры)
- `src/terminal.ts` — raw-режим, `parseKeys` (чистая; стрелки, Esc, TAB,
  Enter, Space, Backspace, Ctrl+C, печатные символы), фабрика `Term`
  идемпотентные `start()`/`stop()` (флаг `running`)
- `src/environments.ts` — `scan(root)` с детализацией окружения
  (settings.json, extensions/, skills/, mcp.json) (чистая)
- `src/layout.ts` — `computeLayout` (чистая), константы порогов
- `src/catalog.ts` — `loadCatalog` + `listProviders/listCustomTools/`
  `listPackages/listSkills` (`listSkills` уникализированы `uniqueName`), `parseOutdated`, `parsePackageCatalog`/
  `fetchPackageCatalog` (каталог pi.dev/packages: все страницы пагинации
  параллельно, `lastCatalogPage`, прогресс, дедупликация), `normalizePkgSource`,
  `filterPackages` (поиск по имени пакета) (чистые)
- `src/mcp.ts` — mcp.json: `McpServer`/`McpFormFields`, `readJsonFile`, `readMcpServers`,
  `writeMcpFile`, `mcpAddCliArgs` (аргументы `pi mcp add`), `validateMcpForm`,
  `copyMcpEntry`/`removeMcpEntry` (чистые)
- `src/mcp-live.ts` — живой статус из `pi mcp list --json`: `McpLiveState`
  (`connected`/`needs-auth`/`connecting`/`disabled`/`failed`/`unknown`),
  `McpLiveStatus`/`McpLiveReport`, `parseMcpList` (битый вывод → null),
  `mergeLive` (union конфига и живой проверки по имени; живой вне конфига —
  `config: null`), `liveMarker` (чистые; re-экспорт из `mcp.ts`)
- `src/create.ts` — `validateName`, `createEnvironment` (создание каталога,
  копирование инструментов/скиллов/каталога моделей, запись settings.json),
  `readSettings`, `updateEnvironment` (синхронизация + переименование),
  `deleteEnvironment` (+ запись `mcp.json` из `req.mcp` при создании),
  `envSkillDirName` (идентичность скилла: имя из каталога main-агента, `/` → `-`
  — одно имя используется в create, update и `freshEdit`)
- `src/state.ts` — ядро состояния: `AppState` (+ `pkgCheck`, `pkgLatest`, `ext`,
  `mcp`), `Action`, `ReducerCtx` (`envNames` + `twoColumns`), `reducer` —
  диспетчер (`applyResults` → `createReducer` → `extMachine` → `mcpMachine` →
  `reducerMain`: esc/tab/↑↓/←→/Enter/Space/X); ре-экспортирует всё из
  `state-*.ts` (внешние импорты `./state.js` не менялись) (чистые)
- `src/state-form.ts` — `CreateState`/`freshCreate`/`freshEdit`, строки формы
  (`ROW_*`, `formRows`), `formReducer`, `listViewReducer`, `packageListSources`,
  `clampToLen` (чистые)
- `src/state-create.ts` — create-машина: `createResultReducer` (результаты
  updates/install/create/delete/mcp), таблица `CREATE_VIEWS` view → handler
  (views `install`/`installing`, `check`/`latest`, `mcp`/`mcp-op`/
  `mcp-submitting`/`mcp-confirm-remove`) (чистые)
- `src/state-ext.ts` — `ExtState`/`freshExt` вкладки «Расширения» (каталог,
  установка, обновление, удаление; `query` — поиск) + `extMachine` (чистые)
- `src/state-mcp.ts` — `McpTab`/`freshMcpForm` вкладки «MCP», `McpFormAdd`,
  `mcpFormStep`/`mcpFormRows`, `mcpListNames`, `applyMcpLiveMain`/`onRefreshMcp` + `mcpMachine` (чистые)
- `src/render.ts` — `render(args)` → строки ANSI, `pkgMarker` (вкладка) и
  `formPkgMarker` (форма, по карте outdated окружения), `scrollTop` (окно списка),
  `visibleWidth`/`truncateVisible`/`wideCount`, `mcpInfoLines` (инфо-панель
  MCP-сервера) (чистые)
- `src/sections.ts` — секции вкладок: формы создания/редактирования,
  «Расширения», «MCP» (`renderMcpTab`, `renderMcpForm`), список MCP в форме
  окружения, список окружений + инфо-панель детализации (чистые)
- `src/appsettings.ts` — `loadAppSettings`/`saveAppSettings`
  (настройки приложения в `<root>/.pi-env.json`)
- `src/run.ts` — цикл приложения: `applyKey` (reducer + снимок `PrevSnap`,
  сохранение настроек), обёртки команд (`checkUpdates`, `doUpdateAll`,
  `doUpdateOne`, `doRemove`, `doInstall`, `doMcpAdd`, `loadPackageCatalog`)
  поверх `pi-actions.ts`/`cmd.ts`, объект `Loop` для побочных эффектов
- `src/cmd.ts` — `runCmd` (spawn с таймаутами `PI_TIMEOUT_MS`/`NPM_TIMEOUT_MS`/`MCP_TIMEOUT_MS`),
  `piEnv(dir)` — окружение процесса с `PI_CODING_AGENT_DIR` (чистая сборка аргументов)
- `src/pi-actions.ts` — `piUpdateAll`/`piUpdateOne`/`piRemove`/`piInstall`/
  `piMcpAdd(dir, form)`, `piMcpList(dir)` (`MCP_TIMEOUT_MS`), `npmOutdated`,
  `buildCreateRequest` (CreateState → `CreateRequest`) (чистые сборки, тонкие
  обёртки spawn)
- `src/run-side.ts` — `runSideEffects(loop, envs, prev)`: хуки переходов
  (`hooksCreate`/`hooksExt`/`hooksMcp`/`hooksMcpCheck`, recheck вкладок «Расширения» и «MCP»),
  sync-копирование/удаление MCP (`copyMcpEntry`/`removeMcpEntry`),
  `doSubmit`/`doDelete` (create.js), `doRun` (launchPi); интерфейс `Loop` —
  окно в цикл (state/setState/status/обёртки команд)
- `src/pirun.ts` — `launchPi` (дочерний `pi` с передачей терминала, возврат в
  TUI по exit) и `runPassthrough(envPath, args, lang)` — неинтерактивный проброс
  (код выхода пробрасывается)
- `src/shutdown.ts` — `withShutdown(deps, body)` (чистая, deps инжектятся):
  одноразовый `close()` → `deps.stop()`, обработчики `uncaughtException`/
  `unhandledRejection`/`SIGINT`/`SIGTERM`/`SIGHUP`, `report`+`exit(1)` при
  исключении (сигналы — cleanup без текста в stderr); никогда не reject'ит
- `test/*.test.ts` — тесты чистого ядра (включая `mcp.test.ts`,
  `state-mcp.test.ts`, `state-create-mcp.test.ts`, `render-mcp.test.ts`, `shutdown.test.ts`, `terminal.test.ts` — гарантия терминала)

## Конвенции

- Вся логика, не требующая TTY, — чистые функции, тестируемые `node:test`.
- Терминальный слой тонкий; UI-логику в `terminal.ts` не переносить.
- Вывод терминала наружу — только через `withShutdown` (`src/shutdown.ts`): `term.stop()` вне него не вызывать (исключение — `launchPi`, который сознательно отдаёт терминал дочернему `pi`).
- UI-тексты и сообщения — через `t(lang, key)` (`src/i18n.ts`), словари —
  `src/locales/*.json` (ru — базовый, en — полный; новая локаль = новый файл,
  код не меняется); прямые литеральные строки в UI — не добавлять.
- Не добавлять runtime-зависимости без необходимости.
- Изменять раскладку/поведение клавиш — только вместе с обновлением тестов
  `render`/`state` и этого файла.
- Границы рамки на строках с «неопределёнными» символами (↑↓←→—…✓⚠▌＋):
  сколько клеток они занимают (1 или 2) зависит от шрифта/локали терминала
  и даже от символа (в одном терминале ＋ — 2 клетки, а ↑ — 1). Приложение
  это не знает, поэтому в каждой колонке перед границей оставляем резерв n
  клеток (n = число таких символов в колонке), а сами границы дорисовываем
  CUP (`\x1b[<строка>;<колонка>H`) — средняя и правая стоят на своих местах
  и на 1-клеточном, и на 2-клеточном терминале. Box-drawing (─│├┬┤) и «·»
  — всегда 1 клетка, резерв не нужен.
- Обрезка стилизованной строки под резерв не должна срезать завершающий SGR-сброс
  (`ESC[0m` после инверсии курсорной строки): потерянный сброс уводит активный стиль
  в правую колонку и в строки ниже (`padRight` — SGR-безопасная обрезка).
- `npm outdated --json` заканчивается кодом 1, когда найдены устаревшие пакеты —
  это нормальный случай. Успех проверки определяется по содержимому stdout
  (`interpretOutdated`: JSON-объект без поля `error`), а не по коду выхода —
  иначе вкладка «Расширения» всегда показывает «проверка не удалась».
- `pi mcp list --json` заканчивается кодом 1, когда хотя бы один включённый сервер
  не подключён или запись конфига невалидна — это нормальный случай. Успех
  проверки — по содержимому stdout (`parseMcpList` вернул объект со списком
  `servers`), а не по коду выхода; иначе вкладка «MCP» всегда показывала бы
  «проверка не удалась». Выход 1 при этом содержит валидный JSON.

## Клавиши

- ↑/↓ — перемещение в списке
- ←/→ — фокус колонок (широкий режим, вкладка «Окружения»); в форме
  создания — caret в имени; на вкладке «Настройки» (строка «Язык») —
  переключение языка
- TAB — цикл вкладок: Окружения → Расширения → MCP → Настройки → О программе
- Enter — подтвердить: окружение → запуск, «Создать» → форма создания,
  «Сохранить» → обновление, «Удалить» → подтверждение; в списках формы —
  выбрать пункт; на вкладке «Расширения» — обновить пакет / «Обновить все» /
  «Установить» (каталог); в каталоге установки — установить пакет; на вкладке
  «MCP» — открыть форму добавления (строка «＋ Добавить»)
- Space — toggle на вкладке «Настройки» («Цветной вывод», «Перепроверка
  обновлений», «Перепроверять MCP»), отметка в списках создания и в списке MCP формы окружения
  (create — отметка, edit — копирование/удаление)
- E — редактировать выбранное окружение (форма с предзаполнением: имя, модель, инструменты, пакеты, скиллы, MCP; сохранение, переименование, удаление с подтверждением)
- X — удалить выбранное расширение (список расширений формы) или MCP-сервер
  (вкладка «MCP», список MCP формы окружения) — с подтверждением
- R — обновить живой статус MCP (`pi mcp list`): на вкладке «MCP» (список) и
  в списке MCP формы окружения; во время проверки повторный R не запускает
  вторую проверку; в суб-экранах (форма добавления, подтверждение удаления) — игнор
- Печатные символы / Backspace — ввод имени (строка «Имя» формы), поиска
  (строка «Поиск» в окне установки) и полей формы добавления MCP
- ESC — назад из суб-экрана / выход
- Ctrl+C — аварийный выход

## Дорожная карта

- Этап 2: готов (запуск, создание, редактирование с переименованием и удалением,
  управление расширениями: обновления, инфо-панель, удаление; вкладка
  «Расширения» и установка из каталога pi.dev/packages — глобально и в окружение;
  управление MCP: вкладка «MCP» (добавление — форма, удаление с подтверждением),
  строка «MCP» формы окружения (копирование/удаление/добавление), MCP в
  детализации окружения; настройки приложения с персистентностью
  в `<root>/.pi-env.json`; CLI-проброс аргументов в pi: `pi-env <окружение> [аргументы pi...]`).
- Этап 3 (начат): живой статус MCP (`pi mcp list --json`) во вкладке «MCP» и
  в списке MCP формы окружения — маркеры состояния, инфо-панель с состоянием и ошибкой,
  автопроверка при первом входе + `R` + настройка «Перепроверять MCP».
- Ограничения MCP (осознанно): `headers`/oauth/`timeout` — только в ручном
  `mcp.json`; правка существующего сервера — удалить + добавить; значения env/args
  в форме — без пробелов (разбор по пробелам); `pi mcp login`/`logout` из TUI не
  вызываются — состояние `needs-auth` только показывается (sign-in — в терминале);
  живой статус в детализации окружения на вкладке «Окружения» отложен (потребует
  `pi mcp list` на каждое окружение); живой статус окружения в форме check-режима
  берётся из каталога формы (create — main-агент, edit — каталог окружения).
- Остальное для этапа 3+: формулировать; открытые пункты — в TODO.md.
