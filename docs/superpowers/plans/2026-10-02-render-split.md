# Render Split (render.ts → render.ts + sections.ts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use supo-subagent-driven-development (recommended) or supo-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить `render()` (290 строк) из `src/render.ts` (440 строк) на секции-функции в новом модуле `src/sections.ts`, чтобы оба файла были < 300 строк, а `render()` остался чистым диспетчером — поведение пикселей в пиксель не меняется (фиксируют тесты).

**Architecture:** `src/render.ts` — фасад: текстовые примитивы (ANSI, обрезка, паддинг), `RenderArgs`, `render()`-диспетчер, футер, простые вкладки (settings/about) и пакетные хелперы. `src/sections.ts` — три сложных интерактивных секции: `renderCreate` (с per-view функциями), `renderExtTab`, `renderEnvList`. Каждая секция — чистая функция, возвращает `{ left: string[]; right: string[] }`; слияние правого столбца в узком режиме (`!twoCol`) делают сами `renderCreate`/`renderExtTab` (как сейчас внутри `render()`). Циклический импорт render.js ↔ sections.ts безопасен: верхний уровень sections.ts не вызывает привязки render.js во время оценки модуля (только декларации функций и литеральные константы).

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей, `node:test`.

**Spec:** `TODO.md` пункт 1 (раздел render.ts) + дизайн, согласованный в чате 2026-10-02, вариант B: секции в отдельный модуль, оба файла < 300 строк, `renderCreate` доработан до per-view функций.

## Global Constraints

- Файлы `src/render.ts` и `src/sections.ts` — < 300 строк каждый (проверка `wc -l`, Task 5).
- Функции 4–20 строк — цель из TODO; per-view функции секций — ориентир, не жёстко (бóльшие блоки не дробить сверх списка функций из TODO).
- Ноль новых runtime-зависимостей; не добавлять новые файлы, кроме `src/sections.ts`.
- UI-тексты — на русском, формулировки не менять ни на один символ (тесты их фиксируют).
- Поведение не меняется: полный `npm test` зелёный после каждого task; существующие тесты не править (только добавлять в Task 1).
- Код переносится дословно (verbatim): тело view-блоков из `render()` копируется в функции секций без переписывания; меняется только доступ к `useColor`/`L`/`left`/`right` через `ctx` и локальные массивы.
- Коммит после каждого task; ветка/репозиторий: текущий master, без worktree (согласовано).

## Review Focus

Поведение, которое текущие тесты НЕ фиксируют, а рефакторинг затрагивает (каждый пункт — тест в Task 1):

1. Пустой список окружений (`envs: []`) — разделителя нет, «Создать» на индексе 0, инфо-панель «Выберите окружение». Ожидание: рендер не падает, строки кадра полные.
2. Узкий режим (width < 62) на вкладке «Расширения» + статус-строка — правый столбец сливается в левый (строк правого нет отдельной колонкой), статус заменяет legend2. Ожидание: одна колонка, рамка цела, статус виден.
3. Цветной вывод (`useColor: true`) на суб-экране создания — ANSI-последовательности не обрываются (проверка `assertNoDanglingAnsi` на каждую строку). Ожидание: ни одного «хвоста» ANSI после переноса формы в sections.ts.
4. Вкладка «Расширения» без пакетов — «— пусто —», только кнопки, инфо-панель не рисуется. Ожидание: нет строки «Источник:».

---

### Task 1: Характеризующие тесты (зафиксировать неподкрытое поведение)

**Files:**
- Modify: `test/render.test.ts` (добавить 4 теста в конец файла)

**Interfaces:**
- Consumes: `render` (src/render.ts), `initialState`/`freshCreate` (src/state.ts), фикстуры `envs`, `base`, `extCatalog`, `assertNoDanglingAnsi` — уже есть в `test/render.test.ts`.
- Produces: 4 зелёных теста, фиксирующих поведение, которое Tasks 2–4 не должны изменить.

- [ ] **Step 1: Добавить тесты**

В конец `test/render.test.ts`:

```ts
test('пустой список окружений: без разделителя, «Создать» на нуле', () => {
  const s = render({ state: initialState(), envs: [], width: 62, height: 10, ...base });
  assert.ok(s.includes('> Создать'));
  assert.ok(s.includes('Выберите окружение'));
  const sepLines = s.split('\n').filter((l) => l.includes('─'));
  assert.equal(sepLines.length, 1); // только разделитель под таб-баром
});

test('узкий режим на вкладке «Расширения»: правый столбец слит, статус в футере', () => {
  const st = { ...initialState(extCatalog), tab: 'extensions' as const };
  const s = render({ state: st, envs, width: 40, height: 10, root: '/root', useColor: false, status: 'проверка' });
  assert.ok(!s.split('\n')[1].includes('┬'));
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Источник:')); // строка инфо-панели, слитая в левый столбец
  assert.ok(s.includes('проверка'));
});

test('форма создания в цвете: ANSI не обрывается', () => {
  const st: AppState = { ...initialState(), sub: 'create', create: freshCreate() };
  const s = render({ state: st, envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  for (const line of s.split('\n')) assertNoDanglingAnsi(line);
});

test('вкладка «Расширения» без пакетов: пусто и только кнопки', () => {
  const st = { ...initialState(), tab: 'extensions' as const };
  const s = render({ state: st, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('— пусто —'));
  assert.ok(s.includes('Установить'));
  assert.ok(!s.includes('Источник:'));
});
```

В `test/render.test.ts` добавить в строку импорта из `'../src/state.js'` `freshCreate, type AppState` (сейчас там `initialState, freshExt, type Catalog`):

```ts
import { initialState, freshExt, freshCreate, type AppState, type Catalog } from '../src/state.js';
```

- [ ] **Step 2: Прогнать тесты — все зелёные (поведение уже существует)**

Run: `npm test`
Expected: PASS, 162 теста (158 + 4 новых), 0 failures. Если какой-то из 4 тестов падает — поведение отличается от ожидаемого: НЕ менять src, поправить утверждение под фактический (задокументированный) вывод и заново прогнать.

- [ ] **Step 3: Коммит**

```bash
git add test/render.test.ts
git commit -m "test: характеризующие тесты render (пустые окружения, узкие расширения, цветная форма)"
```

---

### Task 2: sections.ts — Ctx и renderCreate (per-view)

**Files:**
- Create: `src/sections.ts`
- Modify: `src/render.ts` (строки 106–223: init left/right + create-ветка; строки 74–88: добавить ctx)

**Interfaces:**
- Consumes: из `src/render.ts`: `c`, `ANSI`, `listRow`, `truncateName`, `pkgInfoLines`, `catalogPickerLines`, `PKG_NAME_MAX`; из `src/state.ts`: `UPDATE_ALL_ROW`, `INSTALL_ROW`, `packageListSources`, типы `AppState`, `CreateState`; из `src/layout.ts`: тип `Layout`.
- Produces: `Ctx` (interface, экспорт), `renderCreate(cr: CreateState, ctx: Ctx): { left: string[]; right: string[] }` (экспорт).

- [ ] **Step 1: Создать `src/sections.ts`**

Шапка и новые конструкции (код дословно):

```ts
import type { Layout } from './layout.js';
import {
  UPDATE_ALL_ROW,
  INSTALL_ROW,
  packageListSources,
  type AppState,
  type CreateState,
} from './state.js';
import {
  c,
  ANSI,
  listRow,
  truncateName,
  pkgInfoLines,
  catalogPickerLines,
  PKG_NAME_MAX,
  type Ctx,
} from './render.js';

/** Контекст рендера: раскладка и параметры кадра, общие для всех секций. */
export interface Ctx {
  state: AppState;
  L: Layout;
  useColor: boolean;
  inner: number;
  contentRows: number;
  twoCol: boolean;
  root: string;
}

/** Суб-экран создания/редактирования окружения: диспетчер по view. */
export function renderCreate(cr: CreateState, ctx: Ctx): { left: string[]; right: string[] } {
  const r =
    cr.view === 'form' ? createForm(cr, ctx)
    : cr.view === 'packages' ? createPackages(cr, ctx)
    : cr.view === 'install' ? createInstall(cr, ctx)
    : cr.view === 'providers' || cr.view === 'models' || cr.view === 'tools' || cr.view === 'skills'
      ? createSelects(cr, ctx)
      : createBusy(cr, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}
```

Затем per-view функции. Тела — **verbatim** из текущего `src/render.ts`:

- `createForm(cr, ctx)` — блок `if (cr.view === 'form') { ... }` (строки 111–130): строки `Имя/Модель/…`, легенда справа, `cr.error`, `cr.done`. Внутри: `left`/`right` — локальные массивы; `useColor` → `ctx.useColor`; `if (cr.view === 'form') {` → сигнатура функции; в конце `return { left, right };`.
- `createPackages(cr, ctx)` — блок `} else if (cr.view === 'packages') { ... }` (строки 151–189): список пакетов с маркерами, кнопки `UPDATE_ALL_ROW`/`INSTALL_ROW`, инфо-панель (`pkgInfoLines`), легенда.
- `createInstall(cr, ctx)` — блок `} else if (cr.view === 'install') { ... }` (строки 190–196): заголовок + `catalogPickerLines` + `cr.error` + Esc.
- `createSelects(cr, ctx)` — блок `} else if (cr.view === 'providers' || ... 'skills') { ... }` (строки 200–222): items/titles/current/checked, список, легенда.
- Заглушки-состояния — таблица (новый компактный код, заменяет 7 однотипных if-веток: строки 131–150 — confirm-delete/deleting/submitting/confirm-remove/removing/updating, и 197–199 — installing):

```ts
// Заглушки и подтверждения создания: view → [текст, bold?, подсказки]
const CREATE_BUSY: Record<string, { text: (cr: CreateState) => string; bold?: boolean; hints: string[] }> = {
  'confirm-delete': { text: (cr) => 'Удалить окружение «' + cr.name + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
  'deleting': { text: () => 'Удаление…', hints: ['Esc — отмена'] },
  'submitting': { text: () => 'Создание…', hints: ['Esc — отмена'] },
  'confirm-remove': { text: (cr) => 'Удалить расширение «' + (cr.removing ?? '') + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
  'removing': { text: () => 'Удаление…', hints: ['Esc — назад'] },
  'updating': { text: () => 'Обновление…', hints: ['Esc — назад'] },
  'installing': { text: (cr) => 'Установка: ' + (cr.installing ?? '') + '…', hints: ['Esc — назад'] },
};

function createBusy(cr: CreateState, ctx: Ctx): { left: string[]; right: string[] } {
  const b = CREATE_BUSY[cr.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(cr) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + h + c(ANSI.reset, ctx.useColor));
  return { left, right };
}
```

Проверка эквивалентности таблицы (по текущему коду render.ts): `confirm-delete`/`confirm-remove` — bold-текст + две подсказки; `deleting` — «Удаление…»/«Esc — отмена»; `removing`/`updating` — «Esc — назад»; `submitting` — «Создание…»/«Esc — отмена»; `installing` — «Установка: X…»/«Esc — назад».

- [ ] **Step 2: Подключить секцию в `src/render.ts`**

- В импорты render.ts добавить (новая строка):

```ts
import { renderCreate, type Ctx } from './sections.js';
```

- В `render()`, после строки `const contentRows = height - CHROME_ROWS; // таб-бар(1) + разделитель(1) + футер(2)` (строка 85) добавить строку:

```ts
  const ctx: Ctx = { state, L, useColor, inner, contentRows, twoCol, root };
```

- Строки 106–107: `const left: string[] = [];` / `const right: string[] = [];` → `let left: string[] = [];` / `let right: string[] = [];`.
- Create-ветку (строки 109–223, от `if (state.sub === 'create' && state.create) {` до закрывающей `} else if (state.tab === 'envs') {` — саму `} else if` оставить) заменить на:

```ts
    if (state.sub === 'create' && state.create) {
      ({ left, right } = renderCreate(state.create, ctx));
```

- [ ] **Step 3: Прогнать тесты**

Run: `npm test`
Expected: PASS, 162 теста, 0 failures (вывод рендера не изменился).

- [ ] **Step 4: Коммит**

```bash
git add src/sections.ts src/render.ts
git commit -m "refactor(render): renderCreate с per-view функциями в sections.ts"
```

---

### Task 3: sections.ts — renderExtTab и renderEnvList

**Files:**
- Modify: `src/sections.ts`
- Modify: `src/render.ts` (строки 224–306: envs-ветка и extensions-ветка)

**Interfaces:**
- Consumes: `Ctx`, `listRow`, `truncateName`, `pkgInfoLines`, `catalogPickerLines`, `PKG_NAME_MAX`, `c`, `ANSI` (render.ts); `UPDATE_ALL_ROW`, `INSTALL_ROW`, `packageListSources` не нужны; типы `AppState`, `ExtState` (state.ts); `Environment` (environments.ts).
- Produces: `renderExtTab(ext: ExtState | null, ctx: Ctx): { left: string[]; right: string[] }`, `renderEnvList(envs: Environment[], state: AppState, ctx: Ctx): { left: string[]; right: string[] }` (экспорты).

- [ ] **Step 1: Добавить секции в `src/sections.ts`**

Добавить в импорты sections.ts: `INSTALL_ROW` уже есть; добавить тип `ExtState` из state.js, `Environment` из environments.js, `CATALOG_NAME_MAX` не нужен здесь. Новые функции — тела **verbatim** из `src/render.ts`:

```ts
/** Вкладка «Расширения»: диспетчер по состоянию ext. */
export function renderExtTab(ext: ExtState | null, ctx: Ctx): { left: string[]; right: string[] } {
  const r =
    ext === null ? extList(ctx)
    : ext.view === 'catalog' ? extCatalogView(ext, ctx)
    : extBusy(ext, ctx);
  if (!ctx.twoCol) r.left.push(...r.right);
  return r;
}

// Вкладка «Расширения»: список пакетов main-агента + кнопки
function extList(ctx: Ctx): { left: string[]; right: string[] } {
  // verbatim тело блока `if (ext === null) { ... }` render.ts (строки 261–285):
  // заголовок, список pkgs с pkgMarker, разделитель, кнопки [['↑', 'Обновить все'], ['＋', 'Установить']],
  // инфо-панель (pkgInfoLines) или подсказки по выбранной кнопке, легенда
}

// Вкладка «Расширения»: пикер каталога pi.dev
function extCatalogView(ext: ExtState, ctx: Ctx): { left: string[]; right: string[] } {
  // verbatim тело блока `} else if (ext.view === 'catalog') { ... }` render.ts (строки 287–291):
  // заголовок + catalogPickerLines + Esc
}

// Вкладка «Расширения»: состояния установки/обновления/удаления (verbatim-тела render.ts 292–305)
const EXT_BUSY: Record<string, { text: (ext: ExtState) => string; bold?: boolean; hints: string[] }> = {
  'installing': { text: (ext) => 'Установка: ' + (ext.installing ?? '') + '…', hints: ['Esc — назад'] },
  'updating': { text: (ext) => ext.updating === null ? 'Обновление…' : 'Обновление: ' + ext.updating + '…', hints: ['Esc — назад'] },
  'removing': { text: () => 'Удаление…', hints: ['Esc — назад'] },
  'confirm-remove': { text: (ext) => 'Удалить расширение «' + (ext.removing ?? '') + '»?', bold: true, hints: ['Enter — подтвердить', 'Esc — отмена'] },
};

function extBusy(ext: ExtState, ctx: Ctx): { left: string[]; right: string[] } {
  const b = EXT_BUSY[ext.view];
  const left = [c(b.bold ? ANSI.bold : ANSI.dim, ctx.useColor) + b.text(ext) + c(ANSI.reset, ctx.useColor)];
  const right = b.hints.map((h) => c(ANSI.dim, ctx.useColor) + h + c(ANSI.reset, ctx.useColor));
  return { left, right };
}

/** Вкладка «Окружения»: список + инфо-панель выбранного (без слияния в узком режиме). */
export function renderEnvList(envs: Environment[], state: AppState, ctx: Ctx): { left: string[]; right: string[] } {
  // verbatim тело ветки `} else if (state.tab === 'envs') { ... }` render.ts (строки 225–256):
  // rows (envs + «Создать», разделитель после последнего окружения), отрисовка строк,
  // инфо-панель выбранного или «Выберите окружение»
  // ВАЖНО: без if (!ctx.twoCol) — в узком режиме правый столбец отбрасывается, как сейчас
}
```

- [ ] **Step 2: Заменить ветки в `src/render.ts`**

Импорт расширить: `import { renderCreate, renderExtTab, renderEnvList, type Ctx } from './sections.js';`

- envs-ветку (строки 224–256) заменить на:

```ts
    } else if (state.tab === 'envs') {
      ({ left, right } = renderEnvList(envs, state, ctx));
```

- extensions-ветку (строки 257–306) заменить на:

```ts
    } else if (state.tab === 'extensions') {
      ({ left, right } = renderExtTab(state.ext, ctx));
```

- [ ] **Step 3: Прогнать тесты**

Run: `npm test`
Expected: PASS, 162 теста, 0 failures.

- [ ] **Step 4: Коммит**

```bash
git add src/sections.ts src/render.ts
git commit -m "refactor(render): renderExtTab и renderEnvList в sections.ts"
```

---

### Task 4: render() — только диспетчер (settings/about/footer)

**Files:**
- Modify: `src/render.ts` (строки 307–359: settings/about-ветки, сборка, футер)

**Interfaces:**
- Consumes: всё из Tasks 2–3; `RenderArgs`, `LEGEND_WIDE_MIN`, `padRight`, `center`, `c`, `ANSI`.
- Produces: финальный `render(a: RenderArgs): string` — диспетчер; `renderSettings(state, ctx)`, `renderAbout(ctx)`, `renderFooter(a, inner)` (не экспортируются).

- [ ] **Step 1: Вынести settings/about/footer в функции `src/render.ts`**

- settings-блок (строки 307–320) → функция, тело verbatim (`root` из `ctx.root`):

```ts
/** Вкладка «Настройки»: корневой каталог и toggle цвета. */
function renderSettings(state: AppState, ctx: Ctx): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  // verbatim render.ts 308–320: items ['Корневой каталог: ' + ctx.root, 'Цветной вывод: [...]'],
  // отрисовка строк с '> ' и inverse, right — 'Подробные настройки — этап 2'
  return { left, right };
}
```

- about-блок (строки 321–332) → функция (verbatim; `inner`/`contentRows` из ctx):

```ts
/** Вкладка «О программе»: центрированный блок на всю ширину. */
function renderAbout(ctx: Ctx): { left: string[]; right: string[] } {
  // verbatim render.ts 322–332: block из 5 строк, top-смещение, цикл по contentRows
  const left: string[] = [];
  return { left, right: [] };
}
```

- футер (строки 350–359) → функция:

```ts
/** Статус-строка: легенда (или статус) + вторая легенда. */
function renderFooter(a: RenderArgs, inner: number): string[] {
  const legend1 = inner >= LEGEND_WIDE_MIN ? '↑↓ перемещение  ←→ колонки  TAB вкладки  Enter ОК' : '↑↓ TAB Enter Space Esc';
  const legend2 = 'Space toggle  E — правка  Esc назад/выход';
  const f1 = c(ANSI.dim, a.useColor) + legend1 + c(ANSI.reset, a.useColor);
  const f2 = a.status !== null
    ? c(ANSI.bold, a.useColor) + a.status + c(ANSI.reset, a.useColor)
    : c(ANSI.dim, a.useColor) + legend2 + c(ANSI.reset, a.useColor);
  return ['│' + padRight(f1, inner) + '│', '│' + padRight(f2, inner) + '│'];
}
```

- [ ] **Step 2: Собрать `render()`-диспетчер**

Тело `render()` заменяется целиком на (код дословно):

```ts
export function render(a: RenderArgs): string {
  const { state, envs, root, width, height, useColor } = a;

  if (width < NARROW_MIN || height < LOW_MIN) {
    return center('Терминал слишком мал', width);
  }

  const L = computeLayout({ width, height });
  // «О программе» — центрированный текст на всю ширину, двухколоночная сетка его режет пополам
  const twoCol = L.twoColumns && state.tab !== 'about';
  const inner = width - 2;
  const contentRows = height - CHROME_ROWS; // таб-бар(1) + разделитель(1) + футер(2)
  const ctx: Ctx = { state, L, useColor, inner, contentRows, twoCol, root };
  const lines: string[] = [];

  // Таб-бар
  const tabs = (Object.keys(TAB_NAMES) as Array<keyof typeof TAB_NAMES>).map((t) => {
    const active = t === state.tab;
    const label = active ? '[' + TAB_NAMES[t] + ']' : TAB_NAMES[t];
    if (active) {
      return c(ANSI.bright, useColor) + c(ANSI.bold, useColor) + label + c(ANSI.reset, useColor);
    }
    return c(ANSI.dim, useColor) + label + c(ANSI.reset, useColor);
  });
  lines.push('│' + padRight(tabs.join('    '), inner) + '│');

  // Разделитель под таб-баром
  if (twoCol) {
    lines.push('├' + '─'.repeat(L.leftWidth) + '┬' + '─'.repeat(L.rightWidth) + '┤');
  } else {
    lines.push('├' + '─'.repeat(inner) + '┤');
  }

  const section = state.sub === 'create' && state.create
    ? renderCreate(state.create, ctx)
    : state.tab === 'envs' ? renderEnvList(envs, state, ctx)
    : state.tab === 'extensions' ? renderExtTab(state.ext, ctx)
    : state.tab === 'settings' ? renderSettings(state, ctx)
    : renderAbout(ctx);
  const { left, right } = section;

  for (let i = 0; i < contentRows; i++) {
    if (twoCol) {
      const l = i < left.length ? padRight(left[i], L.leftWidth) : ' '.repeat(L.leftWidth);
      const r = i < right.length ? padRight(right[i], L.rightWidth) : ' '.repeat(L.rightWidth);
      const hl = state.tab === 'envs' && state.sub === null && state.focus === 'left' && useColor;
      const hr = state.tab === 'envs' && state.sub === null && state.focus === 'right' && useColor;
      const bl = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
      const bm = c(ANSI.bold, hl || hr) + '│' + c(ANSI.reset, hl || hr);
      const br = c(ANSI.bold, hr) + '│' + c(ANSI.reset, hr);
      lines.push(bl + l + bm + r + br);
    } else {
      const l = i < left.length ? padRight(left[i], inner) : ' '.repeat(inner);
      lines.push('│' + l + '│');
    }
  }

  lines.push(...renderFooter(a, inner));

  return lines.join('\n');
}
```

- [ ] **Step 3: Прогнать тесты и сборку**

Run: `npm test && npm run build`
Expected: PASS, 162 теста, 0 failures; сборка без ошибок.

- [ ] **Step 4: Коммит**

```bash
git add src/render.ts
git commit -m "refactor(render): render() — диспетчер, settings/about/footer в функции"
```

---

### Task 5: Проверка размеров, TODO.md, финальный прогон

**Files:**
- Modify: `TODO.md` (пункт 1: `- [ ]` → `- [x]` в строке `render.ts`)

**Interfaces:**
- Consumes: результат Tasks 1–4.
- Produces: оба файла < 300 строк, зелёный `npm test` + `npm run build`, отмеченный пункт TODO.

- [ ] **Step 1: Проверить размеры файлов**

Run: `wc -l src/render.ts src/sections.ts`
Expected: оба < 300. Если какой-то файл ≥ 300: перенести в другой файл наименьшую самодостаточную функцию (кандидаты: `createInstall`, `extBusy`+`EXT_BUSY`, `renderAbout`) — без изменения сигнатур и выводов, затем повторить Step 3.

- [ ] **Step 2: Финальный прогон**

Run: `npm test && npm run build`
Expected: PASS, 162 теста, 0 failures; сборка чистая.

- [ ] **Step 3: Отметить пункт в TODO.md**

Строка `- [ ] `render.ts` (440): вынести секции в функции ...` → галочка: `- [x] `render.ts` (440): вынести секции в функции ...` (только `[ ]` → `[x]`, текст не менять).

- [ ] **Step 4: Коммит**

```bash
git add src/ TODO.md
git commit -m "refactor(render): пункт 1 TODO — секции render.ts вынесены в sections.ts"
```
