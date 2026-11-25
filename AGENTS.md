# AGENTS.md — pi-env

## Назначение

`pi-env` — интерактивная TUI-утилита для управления окружениями ИИ-агента `pi`.
Окружение pi — отдельная папка с конфигурацией агента (аналог `~/.pi/agent`):
`settings.json`, `extensions/`, `skills/`, `agents/`, `themes/`. Агент читает
конфигурацию из каталога, задаваемого переменной окружения `PI_CODING_AGENT_DIR`.

## Модель окружения

- Корневой каталог окружений: `~/.pi-env`.
- Переопределение: флаг `--root <путь>` (приоритет) или переменная `PI_ENV_ROOT`.
- Окружение = каталог с конфигурацией агента, оно определяется **путём**
  (`Environment.path`), а не только именем. Обычные окружения — подкаталоги
  `<root>/<имя>/`; любая подпапка — окружение, файлы игнорируются. В списке может
  стоять и каталог вне `<root>` (сейчас — основной агент, дальше — своё хранилище).
- Запуск окружения (этап 2): процесс `pi` с `PI_CODING_AGENT_DIR=<путь окружения>`
  в текущей рабочей директории. Основной агент запускается тем же способом — его
  каталог это `PI_CODING_AGENT_DIR` (по умолчанию `~/.pi/agent`).

## Текущий статус (этап 2 готов; этап 3: живой статус MCP, вкладка «Обновление», отзывчивость долгих операций и основной агент в списке окружений готовы)

- Основной агент — первой строкой списка окружений (`withMain(envs, agentDir)` в
  `src/environments.ts`): каталог `PI_CODING_AGENT_DIR` или `~/.pi/agent`. Если он уже
  является окружением `<root>`, дубликата нет — строка помечена `«<имя> · основной»`,
  иначе это «Основной» с каталогом вне `<root>` (в инфо-панели — `envs.main-note`).
  Для него: Enter — запуск, `E` — правка модели/пакетов/MCP (инструменты и скиллы только
  показываются), `C` — форма создания окружения из основного, `X`/«Удалить»/переименование
  недоступны (`err.main-no-action`), `settings.json` пишется точечно (`patchSettings`),
  каталог агента не копируется (`C` не ведёт к `cloneEnvironment`). CLI: `pi-env main [аргументы pi]`.
- Работает: список окружений, таб-бар `Окружения | Расширения | MCP | Настройки | О программе`,
  клавиши ↑↓←→/TAB/Enter/Space/ESC + печатные символы/Backspace, адаптивные
  две колонки (порог 62), создание окружения, вкладка настроек приложения
  («Цветной вывод», «Перепроверка обновлений» — персистентность в
  <root>/.pi-env.json), статус-строка, вкладка «О программе» (версия из package.json, строка поддержки + ссылка https://boosty.to/devmaksi),
  запуск окружения (дочерний `pi` с передачей терминала, возврат в TUI по выходе),
  редактирование окружения (E: модель, инструменты, пакеты, скиллы, переименование,
  удаление в корзину), управление расширениями в форме (маркеры
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
  «Добавить» — форма на 9 полей stdio/http, enum-строки «Тип» и «Exposure» меняются ←/→ прямо на строке со циклом: имя, тип, команда, аргументы,
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
- Отзывчивость долгих операций: `pi install`/`update`/`remove`, `pi mcp add`, `pi mcp list` идут в фоне,
  на их экранах счётчик «⏳ N с» (`AppState.opSeconds`, тикер `src/ticker.ts` раз в секунду), подсказка
  «Esc — прервать» (`hint.kill`), `Esc` снимает процесс этого экрана (`busyProcessView` + `AbortController`
  → `runCmd`), `Ctrl+C` выходит, сняв все незавершённые процессы (`cancelAll`). `CmdResult` различает
  `cancelled`/`timedOut`/`timeoutMs`, текст строит `cmdFailureText` (`status.cancelled*`, `status.timeout*`).
- Кэш снимка окружений (`src/env-cache.ts`): `scan()` и `listTrash()` вызываются раз на действие —
  `run.ts` держит `cache`, подпись = mtime корня, каталогов окружений и `settings.json`/`mcp.json`/`extensions/`/`skills/`
  (те же проверки для каталога основного агента — `scanSignature(root, agentDir)`);
  инвалидация — после создания/сохранения/переименования, корзины, MCP-операций, возврата из дочернего `pi`
  и окончания любой внешней команды (в `finally` у `startOp`). Нечитаемый корень не кэшируется.
  Замер (50 окружений): `scan` 1,425 мс → `cache.get()` 0,429 мс.
- Отладчивость конфигурации: `scan()` отдаёт диагностику окружения (`EnvDetails.settingsError`,
  `mcpError`, `mcpSkipped` — из `readJsonFileDetailed`/`readMcpServersDetailed`), окружение с
  проблемой помечено `⚠` в списке, инфо-панель показывает `settings.json ⚠` (битый файл больше
  не выглядит как отсутствующий) и ниже текст ошибки. Журнал отладки `PI_ENV_DEBUG=1` → append
  `<root>/.pi-env.log` (`src/debuglog.ts`, приходит в `run()` через `RunDeps.debugLog`):
  нечитаемый корень, битые settings/MCP окружений, провалы перечитки каталога, загрузки каталога
  pi.dev, проверки версии и чейнджлога; дедуп по `(tag, текст)` на запуск (без него двойной
  `scan()` на каждое нажатие плодил бы одинаковые строки), недоступный журнал не роняет
  приложение, без переменной `run()` не создаёт файлов.
- Клонирование окружения: `C` на строке окружения открывает суб-экран «Клонирование»
  (имя копии по умолчанию `⟨имя⟩-copy`, каретка/Backspace, Enter — создать, Esc — отмена,
  TAB вкладку не меняет, `c`/`e` в поле имени — печатные символы (`C`/`E` требуют
  закрытого суб-экрана); Enter копирует каталог окружения как есть (`cloneEnvironment`:
  `settings.json`, `mcp.json`, `extensions/`, `skills/`, модели и любые свои файлы), после
  успеха курсор на копии, в статусе `status.env-cloned`; на время копирования (каталог
  окружения весит сотни МБ, это блокирующая файловая операция, не дочерний процесс) кадр
  показывает `clone.copying` вместо подсказки Enter — `hooksClone` зовёт `repaint()` до
  копирования; ошибка имени/копирования остаётся
  в суб-экране (`⚠` + текст), файлы не трогает. Подсказка `envs.hint.clone` в инфо-панели.
- Корзина окружений: удаление окружения (`E` → «Удалить» → Enter → Enter) переносит
  каталог в `<root>/.trash/<имя>@<unix-мс>` вместо `rm -rf`; в списке вкладка
  «Окружения» — строка «Корзина (N)» после «Создать» (всегда видна, в том числе с
  нулём), Enter открывает суб-экран: список записей «<имя> · дата» (свежие сверху),
  инфо-панель выбранной (дата, путь), Enter — восстановить (при занятии имени —
  ошибка в статус-строке), X — «Удалить «X» совсем?» в инфо-панели + Enter
  подтверждает, Esc — отмена, TAB/Esc — назад к списку. Повторное удаление одного
  имени даёт вторую запись (старшая дата — верх списка); `scan()` не считает
  каталогом-окружением папки с `.` в начале, поэтому `.trash` не виден как окружение.
- Дифф-отрисовка кадра: `repaint()` пишет только изменённые строки (`src/diff.ts`:
  `diffFrames`/`paintFrame`, сравнение строк байтовое, вместе с ANSI-кодами). Полный кадр —
  первый кадр, смена `width`/`height`/`twoColumns`, разная длина кадра и возврат из дочернего
  `pi` (`Term.screenKnown()` после `start()` снова `false`). Прогресс загрузки каталога
  pi.dev репакется не чаще одного раза в `PROGRESS_THROTTLE_MS` = 70 мс
  (`src/throttle.ts` + `makeProgressPainter` в `run.ts`; финальный результат — без задержки).
  Замер — `npm run bench` (100×40): сдвиг курсора 4743 → 1483 байт/репок, идентичный репок
  3 репака → 1, прогресс каталога 4163 → 325 байт/репок.
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
- Вкладка «Обновление» (есть только когда npm-реестр даёт более свежую версию): установленная и доступная версия, способ установки
  (`npm-global`/`npx-cache`/`pi-package`/`source`/`unknown` — по реальному пути модуля), команды обновления под способ (Enter — копирование через OSC 52),
  чейнджлог пропущенных релизов (`CHANGELOG.md`/`CHANGELOG.ru.md` с GitHub raw, блоки `[Unreleased]` отбрасываются), `R` — перечитать реестр и чейнджлог.
  Проверка — один фоновый запрос на запуск (`https://registry.npmjs.org/.../latest`, без кэша и без настройки в Settings); для `source` запроса нет вовсе,
  отключается `PI_ENV_NO_UPDATE_CHECK=1`. Приложение само себя не обновляет и не перезапускает — только показывает команду.
- Таб-бар адаптивный: полные имена (sep 4) → короткие (`tab.*.short`, sep 2) → «активная вкладка N/M» — по внутренней ширине кадра
  (`tabBarPlan`/`tabBarRow` в `src/render.ts`); список вкладок даёт `tabsOf(state)`, поэтому «Обновление» физически отсутствует, когда её нет.
- Демо-GIF витрины: `docs/demo.gif` (английский интерфейс) и `docs/demo.ru.gif`
  (русский), оба без статичного скриншота — `docs/screenshot.png` остался только
  превью в манифесте `pi` (`package.json`). Сценарий дубля: shell → `pi-env` → выбор
  `dev-supo` → запуск pi (видно `[Context]`/`[Skills]`/`[Prompts]`/`[Extensions]` и
  модель) → `/quit` → выбор `Test` → запуск pi (другой набор скиллов, ноль пакетов,
  другая модель) → `/quit` → Esc. Кадр 90×32, ~17 с, ~0.6 МБ. Съёмка — `npm run demo`
  (`demo/`).

## Стек

- Node.js ≥ 22.19 (столько же требует pi 1.3/1.4), TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей.
- Dev-зависимости: `typescript`, `tsx`. Тесты: `node:test`.
- Съёмка демо-GIF (`demo/`): Python 3 (только stdlib) + бинарный `agg`
  (`demo/bin/agg`, скачивается скриптом, в git не попадает). Рантайм-зависимостей
  это не добавляет: `demo/` не входит в `files` package.json.

## Команды

- `npm run build` — компиляция `src/` → `dist/`
- `npm test` — `tsx --test test/*.test.ts`
- `npm run bench` — замер байт на репок (`bench/paint-bench.ts`: полный кадр против построчного диффа; в `dist` не попадает)
- `npm run start` — запуск CLI (`node dist/index.js`)
- `npx tsx src/index.ts` — запуск без сборки
- `npm run demo` — пересъёмка `docs/demo.gif` и `docs/demo.ru.gif`
  (`python3 -m demo.capture --langs en,ru`; `--root`, `--cols/--rows`,
  `--font-*`, `--keep-cast`; `demo/bin/agg` и `demo/out/` в `.gitignore`)
- `python3 -m unittest demo.test_ptycast demo.test_capture` — тесты Python-стенда
  съёмки (cast, alt-screen-самопроверка, маркеры, закреплённые настройки)
- `PI_ENV_NO_UPDATE_CHECK=1 npx tsx src/index.ts` — запуск без сетевого запроса о собственной версии (используется и в дубле GIF: `demo/capture.py` передаёт её всегда)
- `PI_ENV_DEBUG=1 npx tsx src/index.ts` — запуск с журналом отладки `<root>/.pi-env.log`
  (проблемы конфигурации окружений и сбои фонового чтения; без переменной файлов не создаётся)
- `python3 -m demo.capture --selftest` — проверка стенда на alt-screen без pi-env


## Публикация новой версии

- npm-пакет — `@devmaksi/pi-env` (безскоупный `pi-env` занят);
  установка: `npm i -g @devmaksi/pi-env` (или `npx @devmaksi/pi-env`).
- Релиз: bump `version` в package.json → коммит → `git tag vX.Y.Z` →
  push тега (уходит в оба remote сразу: у origin два pushurl — git.lan
  и github.com).
- Проверка — `.github/workflows/tests.yml` (`on: workflow_call`): матрица
  Node **22/24**, `npm ci` → build → `npm test` на `ubuntu-24.04`. Единственное
  место, где живут шаги проверки и список поддерживаемых Node: `ci.yml` (push в
  master/main + PR) и `publish.yml` (тег) только вызывают его и свою матрицу
  не дублируют. Согласие `engines` ↔ матрицы ↔ документов и наличие гейта
  страхует `test/ci.test.ts`.
- CI `.github/workflows/publish.yml` на тег `v*`: джоб `test` (тот же
  реюз-воркфлоу) → джоб `publish` (`needs: test`): `npm ci` → build →
  проверка «тег = версия» → `npm publish --provenance --access public`
  → GitHub Release (идемпотентно: существующий релиз не создаёт заново).
  Тег без зелёных тестов не публикуется.
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
  - Тег обязан доехать до обоих pushurl, а проверить это по одному адресу нельзя:
    `origin` задан двумя pushurl (github.com и git.lan), `git ls-remote --tags origin`
    читает только fetch-URL (git.lan), и молчаливый отказ одного из адресов не виден
    в выводе push. У `v0.2.3` тег и релиз есть на GitHub (в npm — версия), на git.lan
    его нет. После каждого тега — `git ls-remote --tags` по обоим адресам.

## Структура

- `src/index.ts` — вход: аргументы (`--root`, `--help`, проброс в окружение), TTY-проверка, старт
- `src/cli.ts` — `parsePiEnvArgs` (чистая): `pi-env [--root <путь>] <окружение> [аргументы pi...]` — первое позиционное = окружение, остальное — проброс в pi как есть; `envPathCandidates(root, token, agentDir)` — кандидаты пути (сначала `<root>/<токен>`, для `main` вторым — агентский каталог), реальное `<root>/main` имеет приоритет
- `src/i18n.ts` — словари переводов: `t(lang, key, params?)`, `resolve`
  (ru-фолбэк), `loadLocales`/`localeCodes` (сканирование `src/locales/*.json`,
  новая локаль = новый файл, без кода), `nativeName`, `defaultLang`
  (Intl → LANG → 'ru'), `StrKey` — ключи проверяются на этапе компиляции
- `src/locales/ru.json`, `src/locales/en.json` — словари (ключ — имя,
  `native-name` — название языка; `{p}` — плейсхолдеры)
- `src/terminal.ts` — raw-режим, `parseKeys` (чистая; стрелки, Esc, TAB,
  Enter, Space, Backspace, Ctrl+C, печатные символы), фабрика `Term`
  идемпотентные `start()`/`stop()` (флаг `running`), `paint(patch)` (полный кадр с очисткой экрана
  или только изменённые строки через CUP + `[K`) и `screenKnown()` (`false` сразу и после каждого
  `start()`); UI-логики и знания о layout в `terminal.ts` нет
- `src/diff.ts` — построчный дифф кадра: `frameKey`, `diffFrames`, `paintFrame`, типы
  `FrameKey`/`PrevFrame`/`PaintOp`/`FramePatch`/`FrameSink` (чистые; row = индекс строки + 1)
- `src/throttle.ts` — `createThrottle` leading-edge со схлопыванием в одно окно, часы и таймеры
  инжектятся (чистая)
- `src/environments.ts` — `scan(root)` с детализацией окружения
  (settings.json, extensions/, skills/, mcp.json); каталоги с `.` в начале — не
  окружения, поэтому служебный `.trash` в список не попадает; битые `settings.json`/`mcp.json`
  и неразобранные записи отдаёт в `settingsError`/`mcpError`/`mcpSkipped`; `Environment.main`
  (основная запись), `withMain(envs, agentDir)` (пометка существующей записи или ведущая запись
  с путём агентского каталога, детали — общий `readDetails`), `realEnvNames(envs)` — имена
  обычных окружений для проверки уникальности (чистые)
- `src/debuglog.ts` — журнал отладки (чистое ядро + тонкий writer): `debugEnabled`
  (`PI_ENV_DEBUG=1`), `formatLogLine` (`YYYY-MM-DD HH:MM:SS tag: текст`), `dedupedLog`
  (одна строка на пару `(tag, текст)`), `createDebugLog` (сток и часы инжектятся, сбой стока
  наружу не выходит), `logFileFor`/`fileLogger` — append `<root>/.pi-env.log`, файл появляется
  первой записью
- `src/layout.ts` — `computeLayout` (чистая), константы порогов
- `src/catalog.ts` — `loadCatalog` + `listProviders/listCustomTools/`
  `listPackages/listSkills` (`listSkills` уникализированы `uniqueName`), `parseOutdated`, `parsePackageCatalog`/
  `fetchPackageCatalog` (каталог pi.dev/packages: все страницы пагинации
  параллельно, `lastCatalogPage`, прогресс, дедупликация), `normalizePkgSource`,
  `filterPackages` (поиск по имени пакета); вход из pi.dev-HTML санитизируется
  (`cleanText`/`cleanOrNull`: control-символы, включая ESC, вырезаны; переносы/табы/повторные
  пробелы → один пробел; пустое имя — карточка пропущена, пустые описание/автор — null) (чистые)
- `src/mcp.ts` — mcp.json: `McpServer`/`McpFormFields`, `readJsonFile`/`readJsonFileDetailed`
  (значение + текст сбоя), `readMcpServers`/`readMcpServersDetailed` (`servers` + `fileError` +
  `skipped`),
  `writeMcpFile`, `mcpAddCliArgs` (аргументы `pi mcp add`), `validateMcpForm`,
  `copyMcpEntry`/`removeMcpEntry` (чистые)
- `src/mcp-live.ts` — живой статус из `pi mcp list --json`: `McpLiveState`
  (`connected`/`needs-auth`/`connecting`/`disabled`/`failed`/`unknown`),
  `McpLiveStatus`/`McpLiveReport`, `parseMcpList` (битый вывод → null),
  `mergeLive` (union конфига и живой проверки по имени; живой вне конфига —
  `config: null`), `liveMarker` (чистые; re-экспорт из `mcp.ts`)
- `src/create.ts` — `validateName`, `createEnvironment` (создание каталога,
  копирование инструментов/скиллов/каталога моделей, запись settings.json),
  `readSettings`, `updateEnvironmentAt(sourceDir, req, ctx, {rename, syncResources, modelSource}, lang)`
  — правка каталога по пути (вне `<root>` тоже), `updateEnvironment` — прежняя обёртка
  `<root>/<oldName>`, `patchSettings` — точечная запись `settings.json` (незнакомые поля
  сохраняются, управляемые ключи снимаются, когда пусто),
  (+ запись `mcp.json` из `req.mcp` при создании),
  `envSkillDirName` (идентичность скилла: имя из каталога main-агента, `/` → `-`
  — одно имя используется в create, update и `freshEdit`)
  `cloneEnvironment(root, srcPath, newName, existing, lang)` (копирование каталога
  окружения как есть через `copyRecursive`; при сбое неполная копия удаляется)
- `src/selfupdate.ts` — версия и способ установки (чистые): `parseVersion`/`compareVersions`/`isOutdated`, `classifyInstall`
  (порядок: pi-package → npx-cache → source → npm-global → unknown; `source` — `.git` в корне самого
  экземпляра: checkout, `npm link`, git worktree; `.git` в `$HOME` или репозиторий-обёртка выше по пути
  npm-установку checkout'ом не делают), `updateCommands`, `installedVersion()` (общая точка правды версии для UI и проверки),
  парсер чейнджлога `parseChangelog`/`changelogRange`/`mergeChangelog`/`changelogRows`/`changelogUrl` (Markdown-украшение снимается, управляющие символы вырезаются)
- `src/selfupdate-net.ts` — только fetch: `runSelfCheck` (номер из ответа `.../latest` — `version` или `dist-tags.latest`, npm отдаёт обе формы; `noCheck` или `kind === 'source'` — без запроса; `checkedAt`),
  `fetchChangelogEntries` (второй язык догружается, если в основном нет блока последней доступной версии), `AbortSignal.timeout`
- `src/state-update.ts` — динамические вкладки `tabsOf` (`update` перед `about` только при `selfUpdate !== null`), `UpdateUi` (курсор, чейнджлог, `copyRequest`),
  `updateMachine` (↑↓/Enter/R), `applySelfUpdateResult` (вкладка исчезла под курсором → соседняя), `updateListLength`/`selectedCommand`
- `src/trash.ts` — корзина окружений (чистые): `moveToTrash`/`listTrash`/
  `restoreTrash`/`deleteTrashForever` (переносы `fs.rename` между `<root>/<имя>` и
  `<root>/.trash/<имя>@<мс>`; одно имя = последняя запись, `@` разделитель — его
  запрещает `validateName`), `formatTs`/`trashLabel` (метка «2026-10-24 14:30»),
  служебные (не экспортируются) `safeDirName` (имя безопасно как один уровень `.trash`)
  и `parseDirName` (имя/метка обратно из имени каталога)
- `src/state-trash.ts` — суб-экран «Корзина»: `TrashState` (`cursor`, `confirm`,
  `pending`), `freshTrash`, `trashMachine` (↑↓/Enter/X/Esc/TAB), `applyTrashResult`
  (результат restore/delete навсегда; список пуст → курсор 0) (чистые)
- `src/state-clone.ts` — суб-экран «Клонирование окружения» (чистые): `CloneState`
  (`srcName`, `name`, `caret`, `pending`, `error`), `freshClone(srcName, lang)` (имя по
  умолчанию `clone.name-default`), `cloneMachine` (ввод имени, каретка, Enter → `pending`,
  Esc — закрыть, TAB не уходит с вкладки; `null` не возвращает ни для одной клавиши),
  `applyCloneResult` (успех — курсор на копии в `ctx.envNames`; ошибка — суб-экран открыт
  с текстом)
- `src/state.ts` — ядро состояния: `AppState` (+ `pkgCheck`, `pkgLatest`, `ext`,
  `mcp`, `trash`, `clone`, `opSeconds`), `Action` (`clone-start`/`clone-result`),
  `ReducerCtx` (`envNames`, `trashNames`, `twoColumns`),
  `busyProcessView(state)`/`PROCESS_VIEWS` — какие экраны принадлежат процессу (его снимает Esc),
  `reducer` — диспетчер (`applyResults` → `createReducer` → `extMachine` →
  `mcpMachine` → `trashMachine` → `reducerMain`: esc/tab/↑↓/←→/Enter/Space/X);
  список вкладка «Окружения» = окружения + «Создать» + «Корзина (N)»,
  `enterEnvs` открывает суб-экран корзины; ре-экспортирует всё из
  `state-*.ts` (внешние импорты `./state.js` не менялись) (чистые)
- `src/state-form.ts` — `CreateState`/`freshCreate`/`freshEdit`, строки формы
  (`ROW_*`, `formRows(mode, main)` — у основного агента строки «Удалить» нет),
  `formReducer` (имя основного агента нередактируемое), `listViewReducer`,
  `packageListSources`, `clampToLen` (чистые)
- `src/state-create.ts` — create-машина: `createResultReducer` (результаты
  updates/install/create/delete/mcp), таблица `CREATE_VIEWS` view → handler
  (views `install`/`installing`, `check`/`latest`, `mcp`/`mcp-op`/
  `mcp-submitting`/`mcp-confirm-remove`) (чистые)
- `src/state-ext.ts` — `ExtState`/`freshExt` вкладки «Расширения» (каталог,
  установка, обновление, удаление; `query` — поиск) + `extMachine` (чистые)
- `src/state-mcp.ts` — `McpTab`/`freshMcpForm` вкладки «MCP», `McpFormAdd`,
  `mcpFormStep`/`mcpFormRows`, `MCP_ENUM_ROWS`/`enumValues` (закрытые списки значений формы: `type`, `exposure`),
  `mcpListNames`, `applyMcpLiveMain`/`onRefreshMcp` + `mcpMachine`; UI-поля `McpFormAdd` — `cursor`/`caret`/`error`
  (`select` удалён: `cursor` — только индекс строки формы, enum-значение меняется клавишами ←/→) (чистые)
- `src/render.ts` — `render(args)` → строки ANSI, `pkgMarker` (вкладка) и
  `formPkgMarker` (форма, по карте outdated окружения), `scrollTop` (окно списка),
  `visibleWidth`/`truncateVisible`/`wideCount`, `mcpInfoLines` (инфо-панель
  MCP-сервера) (чистые)
- `src/sections.ts` — секции вкладок: формы создания/редактирования,
  «Расширения», «MCP» (`renderMcpTab`, `renderMcpForm`), список MCP в форме
  окружения, список окружений + инфо-панель детализации, суб-экран «Корзина»
  (`renderTrashTab`) (чистые)
- `src/appsettings.ts` — `loadAppSettings`/`saveAppSettings`
  (настройки приложения в `<root>/.pi-env.json`)
- `src/run.ts` — цикл приложения: `applyKey` (reducer + снимок `PrevSnap`,
  сохранение настроек), обёртки команд (`checkUpdates`, `doUpdateAll`,
  `doUpdateOne`, `doRemove`, `doInstall`, `doMcpAdd`, `loadPackageCatalog`)
  поверх `pi-actions.ts`/`cmd.ts`, объект `Loop` для побочных эффектов
  (`prevFrame` + `paintFrame` — дифф-репок; `makeProgressPainter`/`PROGRESS_THROTTLE_MS` — throttle прогресса каталога; `cache` — снимок окружений из `env-cache.ts`, `startOp`/`cancelBusy`/`cancelAll` — отмена процессов, `opTicker` — секунды, `Loop` отдаёт `invalidate`/`trashNames`)
- `src/env-cache.ts` — кэш снимка окружений и корзины (чистый): `scanSignature(root, agentDir)`
  (mtime корня, каталогов окружений, `settings.json`/`mcp.json`/`extensions/`/`skills/` — и те же
  проверки для каталога основного агента), `createScanCache(root, agentDir, deps)` →
  `get()` (снимок уже с `withMain`)/`invalidate()`; нечитаемый корень не кэшируется
- `src/ticker.ts` — `createTicker(onTick, deps)`: цепочка таймеров, пока `onTick()` возвращает true
  (повторный `start()` не заводит вторую) (чистая, таймеры инжектятся)
- `src/cmd.ts` — `runCmd` (spawn с таймаутами `PI_TIMEOUT_MS`/`NPM_TIMEOUT_MS`/`MCP_TIMEOUT_MS` и
  `AbortSignal`; `detached` + kill группы процессов; результат `CmdResult` различает
  `cancelled`/`timedOut`/`timeoutMs`), `RunFn = typeof runCmd` — тип для инжекции слоя запуска,
  `piEnv(dir)` — окружение процесса с `PI_CODING_AGENT_DIR` (чистая сборка аргументов)
- `src/pi-actions.ts` — `piUpdateAll`/`piUpdateOne`/`piRemove`/`piInstall`/
  `piMcpAdd(dir, form)`, `piMcpList(dir)` (`MCP_TIMEOUT_MS`), `npmOutdated` — все принимают
  необязательный `signal` и `run: RunFn`; `cmdFailureText` (отмена/таймаут/stderr),
  `buildCreateRequest` (CreateState → `CreateRequest`) (чистые сборки, тонкие
  обёртки spawn)
- `src/run-side.ts` — `runSideEffects(loop, envs, prev)`: хуки переходов
  (`hooksCreate`/`hooksExt`/`hooksMcp`/`hooksMcpCheck`/`hooksTrash`, recheck вкладок «Расширения» и «MCP»),
  sync-копирование/удаление MCP (`copyMcpEntry`/`removeMcpEntry`),
  `doSubmit`/`doRun` (create.js, launchPi) и `doDelete` — окружение переносится
  в корзину (`moveToTrash`), не `rm -rf`; каждая мутация зовёт `loop.invalidate()` (кэш снимка),
  `prev.cancelRequested` → `loop.cancelBusy()`; интерфейс `Loop` —
  окно в цикл (state/setState/status/обёртки команд/`invalidate`/`trashNames`)
- `src/pirun.ts` — `launchPi` (дочерний `pi` с передачей терминала, возврат в
  TUI по exit) и `runPassthrough(envPath, args, lang)` — неинтерактивный проброс
  (код выхода пробрасывается)
- `src/shutdown.ts` — `withShutdown(deps, body)` (чистая, deps инжектятся):
  одноразовый `close()` → `deps.stop()`, обработчики `uncaughtException`/
  `unhandledRejection`/`SIGINT`/`SIGTERM`/`SIGHUP`, `report`+`exit(1)` при
  исключении (сигналы — cleanup без текста в stderr); никогда не reject'ит
- `test/*.test.ts` — тесты чистого ядра (включая `mcp.test.ts`,
  `state-mcp.test.ts`, `state-create-mcp.test.ts`, `render-mcp.test.ts`, `shutdown.test.ts`, `terminal.test.ts` — гарантия терминала, `paint.test.ts` — `paint`/`screenKnown`, `diff.test.ts` — построчный дифф, `throttle.test.ts` — схлопывание прогресс-репоков, `app-paint.test.ts` — реальный цикл `run()` на фейковом терминале (сколько байт ушло на репок), `trash.test.ts`/`state-trash.test.ts`/`render-trash.test.ts` — корзина (переносы, машина суб-экрана, кадра), `app-trash.test.ts` — сквозной прогон `run()`: удаление → «Корзина (1)» → восстановить → удалить совсем, `ci.test.ts` — согласие `engines`/матрицы CI/документов и гейт `needs: test` перед публикацией,
  `selfupdate.test.ts`/`selfupdate-net.test.ts` — версия, способ установки, парсер и диапазон чейнджлога, фолбэк языка; `state-update.test.ts` — динамические вкладки и клавиши вкладки;
  `render-update.test.ts` — `wrapVisible`, план таб-бара и invariant кадра; `app-update.test.ts` — сквозной `run()` с вкладкой и копированием; `debuglog.test.ts` — формат строки журнала, дедуп и writer; `app-debug.test.ts` — сквозной `run()` с `debugLog` (ровно одна строка на проблему при двойном `scan()`); `render-envs.test.ts` — маркер `⚠`, тексты проблемы и кадры с ним;
  `cmd.test.ts` — отмена по `AbortSignal`, отличимый таймаут (`cancelled`/`timedOut`/`timeoutMs`),
  `pi-actions.test.ts` — проброс сигнала и тексты `cmdFailureText`, `ticker.test.ts` — цепочка таймеров,
  `env-cache.test.ts` — подпись дерева, кэш и инвалидация, `state.test.ts` — `busyProcessView`,
  `run-side.test.ts` — `cancelBusy` и вызовы `invalidate` по мутациям, `app-cancel.test.ts` — сквозной
  `run()`: Esc снимает `pi mcp add`, в статусе «Прервано», `⏳ 0 с` в кадре, Ctrl+C уходит с abort)
  , `create.test.ts` дополнен `cloneEnvironment` (копия дерева, занятые/битые имена, сбой
  копирования без неполной копии), `state-clone.test.ts` — машина суб-экрана (имя по
  умолчанию, каретка, Enter/Esc/TAB, `clone-result`), `render-clone.test.ts` — кадр
  суб-экрана и инвариант рамок, `app-clone.test.ts` — сквозной `run()`: `C` → Enter →
  копия на диске, `C` не на окружении — ничего, занятое имя — ошибка в статусе
- `demo/ptycast.py` — PTY-стенд съёмки: `openpty` + reader-поток, запись asciinema
  cast v2, `alt_fix` (первый кадр после `\x1b[?1049h`), `Step` (клавиши, маркер,
  пауза до клавиш), рендер через `agg` (чистые функции, тесты `demo/test_ptycast.py`)
- `demo/script.py` — сценарий дубля: маркеры по языкам (`Environments`/`Окружения`),
  навигация «↑ с упором, затем счётчик ↓», `DEMO_ENVS = ("dev-supo", "Test")`
- `demo/capture.py` — CLI съёмки: `--langs/--root/--cols/--rows/--font-*/--keep-cast`,
  закрепление языка и `lastChangelogVersion` с восстановлением байт в байт,
  проверка «нет открытого pi-env», постмортем-каст сорванного дубля
  (`demo/test_capture.py`)
- `demo/selftest.py` — самопроверка alt-screen-хука стенда; `demo/README.md` — как
  пользоваться; `demo/bin/agg`, `demo/out/` — в `.gitignore`

## Конвенции

- Вся логика, не требующая TTY, — чистые функции, тестируемые `node:test`.
- Терминальный слой тонкий; UI-логику в `terminal.ts` не переносить.
- Вывод терминала наружу — только через `withShutdown` (`src/shutdown.ts`): `term.stop()` вне него не вызывать (исключение — `launchPi`, который сознательно отдаёт терминал дочернему `pi`).
- Отрисовка — только через `term.paint(...)` (полный кадр или `rows`-патч из `src/diff.ts`); отдельного `clear()` в `Term` больше нет (полный кадр пишет очистку экрана сам), а `process.stdout.write` из `run.ts` не добавлять. Кадр обязан оставаться ровно `height` строк фиксированной видимой ширины (иначе построчный дифф инвалидируется); новый кадр с другой раскладкой узнаётся по `frameKey`, а не «на глаз».
- Строки из внешних источников (HTML каталога pi.dev) санитизируются на границе парсера
  (`catalog.ts` `cleanText`/`cleanOrNull`): control-символы, переносы и табы не должны доходить до
  кадра — иначе он перестаёт быть `height` строк фиксированной ширины и построчный дифф ломается.
- Диагностика сбоя — данные, а не побочный эффект: парсер возвращает текст проблемы
  (`readJsonFileDetailed`/`readMcpServersDetailed`, `EnvDetails.settingsError`/`mcpError`/
  `mcpSkipped`), а журнал пишет только слой побочных эффектов (`run.ts` ← `RunDeps.debugLog`).
  Без `deps.debugLog` `run()` не создаёт файлов — сквозные тесты остаются без побочных
  артефактов; журнал не локализован и не чинит файлы, только сообщает.
- UI-тексты и сообщения — через `t(lang, key)` (`src/i18n.ts`), словари —
  `src/locales/*.json` (ru — базовый, en — полный; новая локаль = новый файл,
  код не меняется); прямые литеральные строки в UI — не добавлять.
- Документация: файл без суффикса — английский (`README.md`, `docs/installation.md`,
  `docs/development.md`, `docs/demo.gif`), русский текст — файл с суффиксом `.ru`
  (`README.ru.md`, `docs/installation.ru.md`, `docs/development.ru.md`,
  `docs/demo.ru.gif`). Суффикса `.en.md` в репозитории нет; раскладку и ссылки
  страхует `test/docs.test.ts`, а список доков в `test/ci.test.ts` (`DOCS`) держит
  согласованность упоминаний порода Node.
- Съёмка демо-GIF — только `demo/` (Python 3, stdlib + бинарный `agg`): в `files`
  package.json `demo/` не входит и в npm-тарбелл не попадает. Пересъёмка меняет
  `docs/demo*.gif` — это артефакты, их коммитят.
- Не добавлять runtime-зависимости без необходимости.
- Изменять раскладку/поведение клавиш — только вместе с обновлением тестов
  `render`/`state` и этого файла.
- Список вкладок кадра динамический: его даёт `tabsOf(state)` (вкладка «Обновление» существует только при доступной новой версии), поэтому TAB-цикл,
  `listLength` и положение курсора обязаны работать по `tabsOf`, а не по фиксированному списку; исчезнувшая под курсором вкладка даёт соседнюю.
  Короткие имена вкладок для узких терминалов — ключи `tab.*.short`, план раскладки таб-бара — `tabBarPlan`.
- Changelog двуязычный: `CHANGELOG.md` — английский канон, `CHANGELOG.ru.md` — русский; каждый релиз описан в обоих файлов одним набором версий
  (страхует `test/docs.test.ts`), вкладка «Обновление» читает их с `raw.githubusercontent.com/devmaksi/pi-env/master/…`.
- Проверка собственной версии не должна становиться сетевой зависимостью тестов: `run(root, term, deps)` по умолчанию не делает запросов,
  настоящие `deps` собираются только в `src/index.ts`.
- Сквозные прогоны `run()` в тестах не зависят от локали: язык закрепляется настройкой
  в `<root>/.pi-env.json` (`tmpRootRu()` в `test/app-update.test.ts`, закрепление в `root()`
  в `test/app-cancel.test.ts`), а строки кадра/статуса тест ищет через `t('ru', key)`, а не
  литералом. Урок CI на 0.2.4 и повтор на 0.2.6 (`test/app-cancel.test.ts`: «Прервано: docs»
  и «⏳ 0 с» литералами): у GitHub-раннера `LANG=C.UTF-8` → `defaultLang` = «en», русская
  строка в кадре не находится — тесты зелёны локально (`LANG=ru_RU.UTF-8`) и красные в CI.
  Проверка перед тегом: `LANG=C.UTF-8 LC_ALL= LANGUAGE= npm test`.
- Тесты не зависят от прав пользователя: сбой файловой операции, смоделированный
  `chmod 0o000`, под root не работает (root прав не слушает). `test/create.test.ts`
  (`cloneEnvironment`: сбой копирования) под root ломает копию битым симлинком — `statSync`
  даёт ENOENT и при root. Проверка перед тегом: прогон suite в чистом контейнере под root
  и от обычного пользователя.
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
- Время операции живёт в слое эффектов: `run.ts` считает `opStartedAt` и кладёт в состояние целые
  секунды как `AppState.opSeconds`; `render`/`sections` только печатают `busy.elapsed` («⏳ N с») и
  остаются чистыми. `⏳` обязан быть в `WIDE_CHARS` — иначе граница рамки ломается на 2-клеточных
  терминалах (`test/render.test.ts` проверяет кадр с счётчиком на обеих моделях).
- Отмена процесса — `AbortSignal` сквозь `runCmd` (не отдельный «kill-хендл»): обёртки `pi-actions.ts`
  принимают необязательный `signal` и `run: RunFn`, слой запуска подставляется в тестах через
  `RunDeps.cmd`. `Esc` снимает только процесс текущего busy-экрана (`busyProcessView`), `Ctrl+C` —
  все процессы (`cancelAll`); живая проверка MCP в `Esc` не входит.
- `scan()`/`listTrash()` кэшируются (`src/env-cache.ts`): своя мутация (создание, сохранение,
  переименование, корзина, MCP-операции) и окончание любой внешней команды обязаны звать
  `invalidate()` (в `run.ts` — через `Loop.invalidate`, в `startOp` — в `finally`). Разрешение имени
  окружения и список корзины берутся из того же снимка (`envNames`/`trashNames`), повторного обхода
  диска в `rctx()` быть не должно.
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
- TAB — цикл вкладок: Окружения → Расширения → MCP → Настройки → (Обновление, только когда она доступна) → О программе (в суб-экране «Корзина» — выход в список окружений)
- ↑/↓ в суб-экране «Корзина» — по записям корзины; пустая корзина — курсора нет
- Space — toggle на вкладке «Настройки» («Цветной вывод», «Перепроверка
  обновлений», «Перепроверять MCP»), отметка в списках создания и в списке MCP формы окружения
  (create — отметка, edit — копирование/удаление)
- Enter — подтвердить: окружение → запуск, «Создать» → форма создания, «Корзина (N)» →
  суб-экран корзины (в суб-экране: выбранная запись → восстановить); «Сохранить» →
  обновление, «Удалить» → подтверждение; в списках формы — выбрать пункт; на вкладке
  «Расширения» — обновить пакет / «Обновить все» / «Установить» (каталог); в каталоге
  установки — установить пакет; на вкладке «MCP» — открыть форму добавления (строка «＋ Добавить»);
  в форме добавления MCP Enter — только submit (строка «Добавить»), enum-строки список не открывают
- C — клонировать выбранное окружение (суб-экран с именем копии; Enter — копировать каталог
  как есть, Esc — отмена); на основной строке — форма создания окружения из основного (дерево
  агентского каталога не копируется); на строках «Создать»/«Корзина», в форме, в суб-экране «Корзина»
  и на других вкладках — игнор; в суб-экране «Клонирование» `c` — печатный символ имени
- E — редактировать выбранное окружение (форма с предзаполнением: имя, модель, инструменты, пакеты, скиллы, MCP; сохранение, переименование, удаление в корзину); в суб-экранах «Корзина» и «Клонирование» — игнор (в поле имени клона `e` — печатный символ)
- X — удалить выбранное расширение (список расширений формы) или MCP-сервер
  (вкладка «MCP», список MCP формы окружения) — с подтверждением; в суб-экране
  «Корзина» — удалить запись совсем (с подтверждением в инфо-панели); на основной
  строке и в форме основного агента удаление недоступно (строки «Удалить» нет, `doDelete` защищён)
- Enter на строке команды вкладки «Обновление» — скопировать команду в буфер (OSC 52); на остальных строках вкладки — ничего
- ↑/↓ на вкладке «Обновление» — курсор по списку (версии, команды, строки чейнджлога); `R` на этой вкладке — перечитать реестр и чейнджлог
- R — обновить живой статус MCP (`pi mcp list`): на вкладке «MCP» (список) и
  в списке MCP формы окружения; во время проверки повторный R не запускает
  вторую проверку; в суб-экранах (форма добавления, подтверждение удаления) — игнор
- ←/→ на enum-строке формы (закрытый список значений: «Тип» и «Exposure» в форме добавления MCP) —
  сменить значение со циклом по списку, без Enter-режима; на текстовой строке формы — двигать caret
- Печатные символы / Backspace — ввод имени (строка «Имя» формы), поиска
  (строка «Поиск» в окне установки) и полей формы добавления MCP
- ESC — назад из суб-экрана / выход; на экране долгой команды (установка/обновление/удаление,
  добавление MCP, проверка MCP) — прервать процесс (`busyProcessView`, подсказка `hint.kill`)
- Ctrl+C — выход из pi-env; перед выходом снимаются все незавершённые процессы (`cancelAll`)

## Дорожная карта

- Этап 2: готов (запуск, создание, клонирование (`C` — копия каталога окружения как есть),
  редактирование с переименованием и удалением в корзину
  управление расширениями: обновления, инфо-панель, удаление; вкладка
  «Расширения» и установка из каталога pi.dev/packages — глобально и в окружение;
  управление MCP: вкладка «MCP» (добавление — форма, удаление с подтверждением),
  строка «MCP» формы окружения (копирование/удаление/добавление), MCP в
  детализации окружения; настройки приложения с персистентностью
  в `<root>/.pi-env.json`; CLI-проброс аргументов в pi: `pi-env <окружение> [аргументы pi...]`;
  корзина окружений: `<root>/.trash/<имя>@<мс>` + суб-экран «Корзина (N)» с восстановлением
  и удалением совсем; основной агент первой строкой списка: запуск, правка модели/пакетов/MCP,
  создание из него, защита от удаления и переименования, `pi-env main` в CLI).
- Этап 3 (начат): живой статус MCP (`pi mcp list --json`) во вкладке «MCP» и
  в списке MCP формы окружения — маркеры состояния, инфо-панель с состоянием и ошибкой,
  автопроверка при первом входе + `R` + настройка «Перепроверять MCP».
- Этап 3 (готов для самого pi-env): вкладка «Обновление» — номер доступной версии, способ установки и команды под него, чейнджлог
  пропущенных релизов (en/ru), копирование команды по Enter, `R` для перечитывания; само-обновления нет по замыслу.
- Этап 3 (готов): отзывчивость долгих операций — фоновые `pi install`/`update`/`remove`/`mcp add`/`mcp list`,
  отмена по `Esc` (процесс убивается), остановка всех процессов при выходе, счётчик «⏳ N с»,
  различимый таймаут; кэш снимка окружений (`src/env-cache.ts`) — один `scan()` на действие.
- Ограничения MCP (осознанно): `headers`/oauth/`timeout` — только в ручном
  `mcp.json`; правка существующего сервера — удалить + добавить; значения env/args
  в форме — без пробелов (разбор по пробелам); `pi mcp login`/`logout` из TUI не
  вызываются — состояние `needs-auth` только показывается (sign-in — в терминале);
  живой статус в детализации окружения на вкладке «Окружения» отложен (потребует
  `pi mcp list` на каждое окружение); живой статус окружения в форме check-режима
  берётся из каталога формы (create — main-агент, edit — каталог окружения).
- Остальное для этапа 3+: формулировать; открытые пункты — в TODO.md.
