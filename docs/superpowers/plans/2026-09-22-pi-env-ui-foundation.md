# pi-env UI-база (этап 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use supo-subagent-driven-development (recommended) or supo-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Интерактивная TUI-утилита `pi-env` с таб-баром, реальным списком окружений pi, адаптивными двумя колонками, полным маппингом клавиш (↑↓←→/TAB/Enter/Space/ESC), заглушками «Создание»/«Запуск» и AGENTS.md проекта.

**Architecture:** Тонкий терминальный слой (`terminal.ts`, raw-режим) + чистое ядро: `scan(root)` — сканирование окружений, `computeLayout` — раскладка, `reducer` — состояние приложения, `render` — отрисовка в строки ANSI. Всё чистое тестируется `node:test` без TTY.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей; dev: `typescript`, `tsx`; тесты: `node:test`.

Спецификация: `docs/superpowers/specs/2026-09-22-pi-env-design.md`

## Global Constraints

- Node.js ≥ 20; TypeScript; ESM (`"type": "module"`); импорты с расширением `.js`.
- Ноль runtime-зависимостей. Допустимые dev-зависимости: `typescript`, `tsx`.
- UI-тексты и сообщения пользователю — на русском.
- Вся логика без TTY — чистые функции; терминальный слой тонкий (~100 строк), UI-логики в нём нет.
- Константы: `WIDE_MIN = 62` (порог двух колонок), `NARROW_MIN = 30`, `LOW_MIN = 8`.
- Корневой каталог окружений: `~/.pi-env`; переопределение: `--root <путь>` (приоритет) или `PI_ENV_ROOT`.
- Версия 0.1.0.
- Коммит после каждой задачи; ветка `feat/ui-foundation`.

## File Structure

| Файл | Ответственность |
|---|---|
| `package.json` | метаданные, bin, скрипты, dev-зависимости |
| `tsconfig.json` | компиляция `src/` → `dist/` |
| `test/smoke.test.ts` | smoke-тест сборки |
| `src/environments.ts` | `Environment`, `scan(root)` (чистая) |
| `src/layout.ts` | `Size`, `Layout`, `computeLayout`, константы (чистая) |
| `src/state.ts` | `Tab`, `Sub`, `Key`, `AppState`, `initialState`, `listLength`, `reducer` (чистая) |
| `src/render.ts` | `RenderArgs`, `render` → строки ANSI (чистая) |
| `src/terminal.ts` | `parseKeys` (чистая), `Term`, `createTerm` (тонкий слой) |
| `src/run.ts` | цикл приложения: reducer → render |
| `src/index.ts` | вход: аргументы, TTY-проверка, запуск |
| `AGENTS.md` | инструкция проекта |
| `test/*.test.ts` | тесты чистого ядра |

---

### Task 1: Scaffolding проекта

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `test/smoke.test.ts`
- Branch: `git checkout -b feat/ui-foundation`

**Interfaces:**
- Produces: рабочая npm-среда; `npm test` запускает `node:test` через `tsx`.

- [ ] **Step 1: Создать ветку**

```bash
git checkout -b feat/ui-foundation
```

- [ ] **Step 2: Написать `package.json`**

```json
{
  "name": "pi-env",
  "version": "0.1.0",
  "description": "CLI для управления окружениями pi",
  "type": "module",
  "bin": { "pi-env": "dist/index.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "test": "tsx --test test/*.test.ts",
    "start": "node dist/index.js"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.8.0"
  }
}
```

- [ ] **Step 3: Написать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Написать smoke-тест `test/smoke.test.ts`**

```ts
import { test } from 'node:test';

test('среда тестов работает', () => {});
```

- [ ] **Step 5: Установить зависимости и проверить тест**

Run: `npm install && npm test`
Expected: PASS (1 тест, 0 провалов)

- [ ] **Step 6: Коммит**

```bash
git add package.json tsconfig.json test/smoke.test.ts
git commit -m "chore: scaffolding pi-env (package, tsconfig, test env)"
```

---

### Task 2: `src/environments.ts` — сканирование окружений

**Files:**
- Create: `src/environments.ts`
- Test: `test/environments.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Environment {
  name: string;
  path: string;
  hasSettings: boolean;
  hasSkills: boolean;
  hasExtensions: boolean;
}
export function scan(root: string): Environment[] | null; // null — корень не существует или нечитаем
```

- [ ] **Step 1: Написать failing-тест `test/environments.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../src/environments.js';

test('scan: отсутствующий корень → null', () => {
  assert.equal(scan('/nonexistent/pi-env-path'), null);
});

test('scan: пустой корень → []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: только каталоги, сортировка, флаги', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'b'));
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'skills'));
    mkdirSync(join(dir, 'a', 'extensions'));
    writeFileSync(join(dir, 'a', 'settings.json'), '{}');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.deepEqual(scan(dir), [
      { name: 'a', path: join(dir, 'a'), hasSettings: true, hasSkills: true, hasExtensions: true },
      { name: 'b', path: join(dir, 'b'), hasSettings: false, hasSkills: false, hasExtensions: false },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `npx tsx --test test/environments.test.ts`
Expected: FAIL — модуль `../src/environments.js` не найден

- [ ] **Step 3: Написать `src/environments.ts`**

```ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Environment {
  name: string;
  path: string;
  hasSettings: boolean;
  hasSkills: boolean;
  hasExtensions: boolean;
}

/**
 * Сканирует корневой каталог окружений.
 * Каждая подпапка — окружение; файлы игнорируются.
 * Возвращает null, если корень не существует или нечитаем.
 */
export function scan(root: string): Environment[] | null {
  if (!existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const p = join(root, e.name);
      return {
        name: e.name,
        path: p,
        hasSettings: existsSync(join(p, 'settings.json')),
        hasSkills: existsSync(join(p, 'skills')),
        hasExtensions: existsSync(join(p, 'extensions')),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Проверить прохождение**

Run: `npx tsx --test test/environments.test.ts`
Expected: PASS (3 теста)

- [ ] **Step 5: Коммит**

```bash
git add src/environments.ts test/environments.test.ts
git commit -m "feat: scan pi environments from root catalog"
```

---

### Task 3: `src/layout.ts` — раскладка

**Files:**
- Create: `src/layout.ts`
- Test: `test/layout.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Size { width: number; height: number }
export interface Layout { twoColumns: boolean; leftWidth: number; rightWidth: number }
export const WIDE_MIN: number;   // 62
export const NARROW_MIN: number; // 30
export const LOW_MIN: number;    // 8
export function computeLayout(size: Size): Layout;
```

Связь ширин: при `twoColumns` `leftWidth + rightWidth + 1 === width - 2` (+1 — разделитель).

- [ ] **Step 1: Написать failing-тест `test/layout.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { computeLayout, WIDE_MIN, NARROW_MIN, LOW_MIN } from '../src/layout.js';

test('порог двух колонок — 62', () => {
  assert.equal(WIDE_MIN, 62);
  assert.equal(computeLayout({ width: 62, height: 24 }).twoColumns, true);
  assert.equal(computeLayout({ width: 61, height: 24 }).twoColumns, false);
});

test('ширины колонок закрывают внутреннюю ширину', () => {
  const L = computeLayout({ width: 100, height: 24 });
  assert.equal(L.leftWidth + L.rightWidth + 1, 98);
  assert.equal(L.leftWidth, 49);
  assert.equal(L.rightWidth, 48);
});

test('одна колонка', () => {
  const L = computeLayout({ width: 40, height: 24 });
  assert.equal(L.twoColumns, false);
  assert.equal(L.leftWidth, 38);
  assert.equal(L.rightWidth, 0);
});

test('константы узкого/низкого терминала', () => {
  assert.equal(NARROW_MIN, 30);
  assert.equal(LOW_MIN, 8);
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `npx tsx --test test/layout.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Написать `src/layout.ts`**

```ts
export interface Size {
  width: number;
  height: number;
}

export interface Layout {
  twoColumns: boolean;
  leftWidth: number;
  rightWidth: number;
}

export const WIDE_MIN = 62;
export const NARROW_MIN = 30;
export const LOW_MIN = 8;

/**
 * Раскладка: две колонки при ширине >= WIDE_MIN, иначе одна.
 * leftWidth + rightWidth + 1 === width - 2 (разделитель между колонками).
 */
export function computeLayout(size: Size): Layout {
  const inner = size.width - 2;
  const twoColumns = size.width >= WIDE_MIN;
  const leftWidth = twoColumns ? Math.floor(inner / 2) : inner;
  const rightWidth = twoColumns ? inner - leftWidth - 1 : 0;
  return { twoColumns, leftWidth, rightWidth };
}
```

- [ ] **Step 4: Проверить прохождение**

Run: `npx tsx --test test/layout.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 5: Коммит**

```bash
git add src/layout.ts test/layout.test.ts
git commit -m "feat: responsive two-column layout"
```

---

### Task 4: `src/state.ts` — состояние и reducer

**Files:**
- Create: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Produces:

```ts
export type Tab = 'envs' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;
export type Key = 'up' | 'down' | 'left' | 'right' | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc';
export interface AppState {
  tab: Tab;
  focus: 'left' | 'right';
  selected: number;
  sub: Sub;
  colorToggle: boolean;
  quit: boolean;
}
export const TABS: readonly Tab[];
export const SETTINGS_COUNT: number; // 2
export function initialState(): AppState;
export function listLength(tab: Tab, envCount: number): number;
export function reducer(state: AppState, key: Key, envCount: number, twoColumns: boolean): AppState;
```

Поведование: TAB — цикл вкладок + сброс `sub`/`selected`/`focus`; ↑↓ — движение в списке (envs: `envCount + 1` пунктов, settings: 2, about: нет списка) с клампом; ←→ — только вкладка envs, широкий режим, без суб-экрана; Enter — окружение → `sub='run'`, последний пункт → `sub='create'`; Space — только settings, пункт 1; ESC — из суб-экрана назад, сверху — `quit`; Ctrl+C — `quit`.

- [ ] **Step 1: Написать failing-тест `test/state.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, listLength } from '../src/state.js';

test('initialState', () => {
  assert.deepEqual(initialState(), {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, quit: false,
  });
});

test('listLength', () => {
  assert.equal(listLength('envs', 3), 4);
  assert.equal(listLength('settings', 0), 2);
  assert.equal(listLength('about', 5), 0);
});

test('TAB циклически переключает вкладки и сбрасывает состояние', () => {
  let s = { ...initialState(), selected: 2, sub: 'create' };
  s = reducer(s, 'tab', 3, true);
  assert.equal(s.tab, 'settings');
  assert.equal(s.selected, 0);
  assert.equal(s.sub, null);
  s = reducer(s, 'tab', 3, true);
  assert.equal(s.tab, 'about');
  s = reducer(s, 'tab', 3, true);
  assert.equal(s.tab, 'envs');
});

test('↑↓ клампируются на границах списка', () => {
  let s = initialState();
  s = reducer(s, 'up', 2, true);
  assert.equal(s.selected, 0);
  s = reducer(s, 'down', 2, true);
  assert.equal(s.selected, 1);
  s = reducer(s, 'down', 2, true);
  assert.equal(s.selected, 2);
  s = reducer(s, 'down', 2, true);
  assert.equal(s.selected, 2);
  s = reducer(s, 'up', 2, true);
  assert.equal(s.selected, 1);
});

test('Enter: окружение → run-заглушка, последний пункт → create-заглушка', () => {
  assert.equal(reducer(initialState(), 'enter', 2, true).sub, 'run');
  assert.equal(reducer({ ...initialState(), selected: 2 }, 'enter', 2, true).sub, 'create');
});

test('Enter внутри суб-экрана игнорируется', () => {
  const s = { ...initialState(), sub: 'run' };
  assert.deepEqual(reducer(s, 'enter', 2, true), s);
});

test('ESC: назад из суб-экрана, выход на верхнем уровне', () => {
  assert.equal(reducer({ ...initialState(), sub: 'run' }, 'esc', 2, true).sub, null);
  assert.equal(reducer(initialState(), 'esc', 2, true).quit, true);
});

test('Space: toggle только на пункте 1 вкладки settings', () => {
  let s = { ...initialState(), tab: 'settings', selected: 1 };
  s = reducer(s, 'space', 0, true);
  assert.equal(s.colorToggle, false);
  s = reducer(s, 'space', 0, true);
  assert.equal(s.colorToggle, true);
  const s0 = { ...initialState(), tab: 'settings', selected: 0 };
  assert.deepEqual(reducer(s0, 'space', 0, true), s0);
});

test('←→: смена фокуса только envs + широкий режим + без суб-экрана', () => {
  let s = reducer(initialState(), 'right', 2, true);
  assert.equal(s.focus, 'right');
  s = reducer(s, 'left', 2, true);
  assert.equal(s.focus, 'left');
  assert.deepEqual(reducer(initialState(), 'right', 2, false), initialState());
  const settings = { ...initialState(), tab: 'settings' };
  assert.deepEqual(reducer(settings, 'right', 2, true), settings);
});

test('Ctrl+C — выход', () => {
  assert.equal(reducer(initialState(), 'ctrlc', 2, true).quit, true);
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `npx tsx --test test/state.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Написать `src/state.ts`**

```ts
export type Tab = 'envs' | 'settings' | 'about';
export type Sub = 'create' | 'run' | null;
export type Key =
  | 'up' | 'down' | 'left' | 'right'
  | 'tab' | 'enter' | 'space' | 'esc' | 'ctrlc';

export interface AppState {
  tab: Tab;
  focus: 'left' | 'right';
  selected: number;
  sub: Sub;
  colorToggle: boolean;
  quit: boolean;
}

export const TABS: readonly Tab[] = ['envs', 'settings', 'about'];
export const SETTINGS_COUNT = 2;

export function initialState(): AppState {
  return { tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, quit: false };
}

export function listLength(tab: Tab, envCount: number): number {
  if (tab === 'envs') return envCount + 1; // окружения + «Создать»
  if (tab === 'settings') return SETTINGS_COUNT;
  return 0;
}

/**
 * Переход состояния по нажатой клавише. Чистая функция.
 */
export function reducer(state: AppState, key: Key, envCount: number, twoColumns: boolean): AppState {
  if (key === 'ctrlc') return { ...state, quit: true };
  if (key === 'esc') {
    if (state.sub !== null) return { ...state, sub: null };
    return { ...state, quit: true };
  }
  if (key === 'tab') {
    const idx = TABS.indexOf(state.tab);
    const next = TABS[(idx + 1) % TABS.length];
    return { ...state, tab: next, focus: 'left', selected: 0, sub: null };
  }
  if (key === 'up' || key === 'down') {
    if (state.sub !== null) return state;
    const len = listLength(state.tab, envCount);
    if (len === 0) return state;
    const delta = key === 'up' ? -1 : 1;
    const selected = Math.min(len - 1, Math.max(0, state.selected + delta));
    return { ...state, selected };
  }
  if (key === 'left' || key === 'right') {
    if (state.tab !== 'envs' || state.sub !== null || !twoColumns) return state;
    return { ...state, focus: state.focus === 'left' ? 'right' : 'left' };
  }
  if (key === 'enter') {
    if (state.sub !== null || state.tab !== 'envs') return state;
    if (state.selected < envCount) return { ...state, sub: 'run' };
    return { ...state, sub: 'create' };
  }
  if (key === 'space') {
    if (state.tab !== 'settings' || state.sub !== null || state.selected !== 1) return state;
    return { ...state, colorToggle: !state.colorToggle };
  }
  return state;
}
```

- [ ] **Step 4: Проверить прохождение**

Run: `npx tsx --test test/state.test.ts`
Expected: PASS (10 тестов)

- [ ] **Step 5: Коммит**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat: app state and key reducer"
```

---

### Task 5: `src/render.ts` — отрисовка

**Files:**
- Create: `src/render.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `Environment` (Task 2), `AppState` (Task 4), `computeLayout`/`NARROW_MIN`/`LOW_MIN` (Task 3).
- Produces:

```ts
export interface RenderArgs {
  state: AppState;
  envs: Environment[];
  root: string;
  width: number;
  height: number;
  useColor: boolean;
  status: string | null;
}
export function render(a: RenderArgs): string; // строки, объединённые \n
```

Структура кадра: строка 0 — таб-бар; строка 1 — разделитель; затем `height - 4` контентных строки; последние 2 — статус-строка (легенда; при `status != null` вторая строка — статус). Суб-экраны рендерятся одной центрированной рамкой на всю ширину (в том числе в широком режиме).

- [ ] **Step 1: Написать failing-тест `test/render.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
import { initialState } from '../src/state.js';
import { Environment } from '../src/environments.js';

const envs: Environment[] = [
  { name: 'dev', path: '/root/dev', hasSettings: true, hasSkills: true, hasExtensions: false },
  { name: 'prod', path: '/root/prod', hasSettings: false, hasSkills: false, hasExtensions: false },
];

const base = { root: '/root', useColor: false, status: null };

test('слишком малый терминал — предупреждение', () => {
  const s = render({ state: initialState(), envs, width: 20, height: 4, ...base });
  assert.equal(s, 'Терминал слишком мал');
});

test('широкий режим: рамка, таб-бар, разделитель', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  for (const line of lines) assert.equal(line.length, 62);
  assert.ok(lines[0].includes('Окружения'));
  assert.ok(lines[0].includes('Настройки'));
  assert.ok(lines[0].includes('О программе'));
  assert.ok(lines[1].includes('┬'));
});

test('широкий режим: список, курсор, инфо-панель', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('> dev'));
  assert.ok(s.includes('  prod'));
  assert.ok(s.includes('Создать'));
  assert.ok(s.includes('Путь: /root/dev'));
  assert.ok(s.includes('settings.json ✓'));
  assert.ok(s.includes('Детализация — этап 2'));
});

test('узкий режим: нет правого столбца', () => {
  const s = render({ state: initialState(), envs, width: 40, height: 10, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 10);
  assert.ok(!lines[1].includes('┬'));
  assert.ok(!s.includes('Путь:'));
  assert.ok(s.includes('> dev'));
});

test('суб-экран запуска', () => {
  const s = render({ state: { ...initialState(), sub: 'run' }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Запуск окружения dev — этап 2'));
  assert.ok(s.includes('Esc — назад'));
});

test('вкладка настроек: каталог и toggle', () => {
  const s = render({ state: { ...initialState(), tab: 'settings', selected: 1 }, envs, width: 62, height: 10, ...base });
  assert.ok(s.includes('Корневой каталог: /root'));
  assert.ok(s.includes('Цветной вывод: [x]'));
  assert.ok(s.includes('Подробные настройки — этап 2'));
});

test('выбранный пункт подсвечивается цветом', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: true, status: null });
  assert.ok(s.includes('\x1b[7m'));
});

test('статус-строка показывает ошибку', () => {
  const s = render({ state: initialState(), envs, width: 62, height: 10, root: '/root', useColor: false, status: 'Окружения не найдены в /root' });
  assert.ok(s.includes('Окружения не найдены в /root'));
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `npx tsx --test test/render.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Написать `src/render.ts`**

```ts
import { Environment } from './environments.js';
import { computeLayout, NARROW_MIN, LOW_MIN } from './layout.js';
import { AppState } from './state.js';

const ANSI = {
  bright: '\x1b[96m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  inverse: '\x1b[7m',
  reset: '\x1b[0m',
};

function c(code: string, on: boolean): string {
  return on ? code : '';
}

function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return s.slice(0, w);
  return s + ' '.repeat(w - v);
}

function center(s: string, w: number): string {
  const v = visibleWidth(s);
  if (v > w) return s.slice(0, w);
  if (v >= w) return s;
  const left = Math.floor((w - v) / 2);
  return ' '.repeat(left) + s + ' '.repeat(w - v - left);
}

export interface RenderArgs {
  state: AppState;
  envs: Environment[];
  root: string;
  width: number;
  height: number;
  useColor: boolean;
  status: string | null;
}

const TAB_NAMES = { envs: 'Окружения', settings: 'Настройки', about: 'О программе' } as const;

export function render(a: RenderArgs): string {
  const { state, envs, root, width, height, useColor } = a;

  if (width < NARROW_MIN || height < LOW_MIN) {
    return center('Терминал слишком мал', width);
  }

  const L = computeLayout({ width, height });
  const inner = width - 2;
  const contentRows = height - 4; // таб-бар(1) + разделитель(1) + футер(2)
  const lines: string[] = [];

  // Таб-бар
  const tabs = (Object.keys(TAB_NAMES) as Array<keyof typeof TAB_NAMES>).map((t) => {
    const active = t === state.tab;
    if (active) {
      return c(ANSI.bright, useColor) + c(ANSI.bold, useColor) + TAB_NAMES[t] + c(ANSI.reset, useColor);
    }
    return c(ANSI.dim, useColor) + TAB_NAMES[t] + c(ANSI.reset, useColor);
  });
  lines.push('│' + padRight(tabs.join('    '), inner) + '│');

  // Разделитель под таб-баром
  if (L.twoColumns && !state.sub) {
    lines.push('├' + '─'.repeat(L.leftWidth) + '┬' + '─'.repeat(L.rightWidth) + '┤');
  } else {
    lines.push('├' + '─'.repeat(inner) + '┤');
  }

  if (state.sub) {
    // Суб-экран: центрированная рамка на всю ширину
    const title =
      state.sub === 'run'
        ? 'Запуск окружения ' + (envs[state.selected]?.name ?? '') + ' — этап 2'
        : 'Создание окружения — этап 2';
    const hint = 'Esc — назад';
    const boxW = Math.min(inner - 2, Math.max(visibleWidth(title), visibleWidth(hint)) + 6);
    const box = [
      '╭' + '─'.repeat(boxW) + '╮',
      '│' + center(title, boxW) + '│',
      '│' + center(hint, boxW) + '│',
      '╰' + '─'.repeat(boxW) + '╯',
    ];
    const top = Math.max(0, Math.floor((contentRows - box.length) / 2));
    for (let i = 0; i < contentRows; i++) {
      const row = i - top >= 0 && i - top < box.length ? box[i - top] : '';
      lines.push('│' + center(row, inner) + '│');
    }
  } else {
    const left: string[] = [];
    const right: string[] = [];

    if (state.tab === 'envs') {
      interface Row { text: string; selected: boolean; isSep: boolean }
      const rows: Row[] = [];
      envs.forEach((e, i) => {
        rows.push({ text: (i === state.selected ? '> ' : '  ') + e.name, selected: i === state.selected, isSep: false });
        if (i === envs.length - 1) {
          rows.push({ text: '─'.repeat(L.leftWidth - 2), selected: false, isSep: true });
        }
      });
      rows.push({ text: (state.selected === envs.length ? '> ' : '  ') + 'Создать', selected: state.selected === envs.length, isSep: false });

      for (const r of rows) {
        if (r.isSep) {
          left.push(c(ANSI.dim, useColor) + r.text + c(ANSI.reset, useColor));
        } else if (r.selected) {
          left.push(c(ANSI.inverse, useColor) + padRight(r.text, L.leftWidth) + c(ANSI.reset, useColor));
        } else {
          left.push(r.text);
        }
      }

      if (state.selected < envs.length) {
        const e = envs[state.selected];
        right.push(c(ANSI.bold, useColor) + e.name + c(ANSI.reset, useColor));
        right.push('Путь: ' + e.path);
        right.push('settings.json ' + (e.hasSettings ? '✓' : '—'));
        right.push('skills ' + (e.hasSkills ? '✓' : '—'));
        right.push('extensions ' + (e.hasExtensions ? '✓' : '—'));
        right.push('');
        right.push(c(ANSI.dim, useColor) + 'Детализация — этап 2' + c(ANSI.reset, useColor));
      } else {
        right.push(c(ANSI.dim, useColor) + 'Выберите окружение' + c(ANSI.reset, useColor));
      }
    } else if (state.tab === 'settings') {
      const items = [
        'Корневой каталог: ' + root,
        'Цветной вывод: [' + (state.colorToggle ? 'x' : ' ') + ']',
      ];
      items.forEach((t, i) => {
        if (i === state.selected) {
          left.push(c(ANSI.inverse, useColor) + padRight(t, L.leftWidth) + c(ANSI.reset, useColor));
        } else {
          left.push(t);
        }
      });
      right.push(c(ANSI.dim, useColor) + 'Подробные настройки — этап 2' + c(ANSI.reset, useColor));
    } else {
      const block = [
        c(ANSI.bold, useColor) + 'pi-env 0.1.0' + c(ANSI.reset, useColor),
        'CLI для управления окружениями pi',
        '',
        '↑↓ перемещение  TAB вкладки  Enter ОК  Space toggle  Esc назад/выход',
      ];
      const top = Math.max(0, Math.floor((contentRows - block.length) / 2));
      for (let i = 0; i < contentRows; i++) {
        left.push(i - top >= 0 && i - top < block.length ? center(block[i - top], inner) : '');
      }
    }

    for (let i = 0; i < contentRows; i++) {
      if (L.twoColumns) {
        const l = i < left.length ? padRight(left[i], L.leftWidth) : '';
        const r = i < right.length ? padRight(right[i], L.rightWidth) : '';
        const hl = state.tab === 'envs' && state.focus === 'left' && useColor;
        const hr = state.tab === 'envs' && state.focus === 'right' && useColor;
        const bl = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
        const bm = c(ANSI.bold, hl) + '│' + c(ANSI.reset, hl);
        const br = c(ANSI.bold, hr) + '│' + c(ANSI.reset, hr);
        lines.push(bl + l + bm + r + br);
      } else {
        const l = i < left.length ? padRight(left[i], inner) : '';
        lines.push('│' + l + '│');
      }
    }
  }

  // Статус-строка
  const legend1 = inner >= 49 ? '↑↓ перемещение  ←→ колонки  TAB вкладки  Enter ОК' : '↑↓ TAB Enter Space Esc';
  const legend2 = 'Space toggle  Esc назад/выход';
  const f1 = c(ANSI.dim, useColor) + legend1 + c(ANSI.reset, useColor);
  const f2 = a.status !== null
    ? c(ANSI.bold, useColor) + a.status + c(ANSI.reset, useColor)
    : c(ANSI.dim, useColor) + legend2 + c(ANSI.reset, useColor);
  lines.push('│' + padRight(f1, inner) + '│');
  lines.push('│' + padRight(f2, inner) + '│');

  return lines.join('\n');
}
```

- [ ] **Step 4: Проверить прохождение**

Run: `npx tsx --test test/render.test.ts`
Expected: PASS (8 тестов)

- [ ] **Step 5: Коммит**

```bash
git add src/render.ts test/render.test.ts
git commit -m "feat: ANSI frame renderer (tabs, columns, stubs, status bar)"
```

---

### Task 6: `src/terminal.ts` — терминальный слой

**Files:**
- Create: `src/terminal.ts`
- Test: `test/terminal.test.ts`

**Interfaces:**
- Produces:

```ts
export interface KeyParse { keys: string[]; esc: number }
export function parseKeys(chunk: Buffer, prevEsc: number): KeyParse; // чистая
export interface Term {
  start(): void;
  stop(): void;
  width(): number;
  height(): number;
  key(): Promise<string>; // 'up'|'down'|'left'|'right'|'tab'|'enter'|'space'|'esc'|'ctrlc'
  clear(): void;
  onResize(cb: () => void): void;
  noColor: boolean;
}
export function createTerm(): Term;
```

`parseKeys` — конечный автомат: `esc=0` — обычное чтение (0x03→ctrlc, 0x09→tab, 0x0D/0x0A→enter, 0x20→space, 0x1B→esc=1); `esc=1` — прочитан ESC (0x1B→'esc', 0x5B→esc=2, иное→'esc'); `esc=2` — CSI (0x41/0x42/0x43/0x44 → стрелки, иное игнорится). `esc` возвращается для продолжения парсинга следующего чанка.

- [ ] **Step 1: Написать failing-тест `test/terminal.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { parseKeys } from '../src/terminal.js';

test('parseKeys: стрелки', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x41]), 0).keys, ['up']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x42]), 0).keys, ['down']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x43]), 0).keys, ['right']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x44]), 0).keys, ['left']);
});

test('parseKeys: esc, enter, tab, space, ctrlc', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b]), 0).keys, ['esc']);
  assert.deepEqual(parseKeys(Buffer.from([0x0d]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x0a]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x09]), 0).keys, ['tab']);
  assert.deepEqual(parseKeys(Buffer.from([0x20]), 0).keys, ['space']);
  assert.deepEqual(parseKeys(Buffer.from([0x03]), 0).keys, ['ctrlc']);
});

test('parseKeys: последовательность разрезана по чанкам', () => {
  const first = parseKeys(Buffer.from([0x1b, 0x5b]), 0);
  assert.deepEqual(first.keys, []);
  const second = parseKeys(Buffer.from([0x41]), first.esc);
  assert.deepEqual(second.keys, ['up']);
});

test('parseKeys: неизвестная CSI-последовательность игнорируется', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x4f]), 0).keys, []);
});
```

- [ ] **Step 2: Проверить, что тест падает**

Run: `npx tsx --test test/terminal.test.ts`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Написать `src/terminal.ts`**

```ts
import * as proc from 'node:process';

export interface KeyParse {
  keys: string[];
  esc: number;
}

/**
 * Распознаёт клавиши из сырых байтов. Чистая функция: конечный автомат
 * с состоянием esc (0 — нет, 1 — прочитан ESC, 2 — прочитан ESC [).
 */
export function parseKeys(chunk: Buffer, prevEsc: number): KeyParse {
  const keys: string[] = [];
  let esc = prevEsc;
  for (const b of chunk) {
    if (esc === 0) {
      if (b === 0x1b) { esc = 1; continue; }
      if (b === 0x03) { keys.push('ctrlc'); continue; }
      if (b === 0x09) { keys.push('tab'); continue; }
      if (b === 0x0d || b === 0x0a) { keys.push('enter'); continue; }
      if (b === 0x20) { keys.push('space'); continue; }
      continue;
    }
    if (esc === 1) {
      if (b === 0x1b) { keys.push('esc'); esc = 0; continue; }
      if (b === 0x5b) { esc = 2; continue; }
      keys.push('esc');
      esc = 0;
      continue;
    }
    if (esc === 2) {
      if (b === 0x41) keys.push('up');
      else if (b === 0x42) keys.push('down');
      else if (b === 0x43) keys.push('right');
      else if (b === 0x44) keys.push('left');
      esc = 0;
    }
  }
  return { keys, esc };
}

export interface Term {
  start(): void;
  stop(): void;
  width(): number;
  height(): number;
  key(): Promise<string>;
  clear(): void;
  onResize(cb: () => void): void;
  noColor: boolean;
}

/** Тонкий слой raw-режима терминала. UI-логики здесь нет. */
export function createTerm(): Term {
  const out = proc.stdout;
  const input = proc.stdin;
  const noColor = Boolean(process.env.NO_COLOR);
  const queue: string[] = [];
  let waiter: ((k: string) => void) | null = null;
  let esc = 0;
  const resizes: Array<() => void> = [];

  function emit(): void {
    if (waiter !== null && queue.length > 0) {
      const w = waiter;
      waiter = null;
      w(queue.shift()!);
    }
  }

  function onData(chunk: Buffer): void {
    const parsed = parseKeys(chunk, esc);
    esc = parsed.esc;
    for (const k of parsed.keys) queue.push(k);
    emit();
  }

  const onWinch = () => {
    for (const cb of resizes) cb();
  };

  return {
    noColor,
    start() {
      out.write('\x1b[?25l'); // скрыть курсор
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      proc.on('SIGWINCH', onWinch);
    },
    stop() {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      out.write('\x1b[2J\x1b[0m\x1b[?25h'); // очистить, показать курсор
      proc.removeListener('SIGWINCH', onWinch);
    },
    width() {
      return out.columns || 80;
    },
    height() {
      return out.rows || 24;
    },
    key() {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise<string>((res) => { waiter = res; });
    },
    clear() {
      out.write('\x1b[2J\x1b[H');
    },
    onResize(cb) {
      resizes.push(cb);
    },
  };
}
```

- [ ] **Step 4: Проверить прохождение**

Run: `npx tsx --test test/terminal.test.ts`
Expected: PASS (4 теста)

- [ ] **Step 5: Коммит**

```bash
git add src/terminal.ts test/terminal.test.ts
git commit -m "feat: raw terminal layer with key parser"
```

---

### Task 7: `src/run.ts` + `src/index.ts` — сборка приложения

**Files:**
- Create: `src/run.ts`
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `scan` (Task 2), `computeLayout` (Task 3), `initialState`/`reducer` (Task 4), `render` (Task 5), `createTerm` (Task 6).
- Produces: `run(root: string): Promise<void>` — цикл приложения; `index.ts` — точка входа CLI.

- [ ] **Step 1: Написать `src/run.ts`**

```ts
import { scan, Environment } from './environments.js';
import { computeLayout } from './layout.js';
import { render } from './render.js';
import { AppState, initialState, reducer } from './state.js';
import { createTerm, Term } from './terminal.js';

/**
 * Цикл приложения: чтение клавиши → reducer → отрисовка.
 */
export async function run(root: string): Promise<void> {
  const term: Term = createTerm();
  let state: AppState = initialState();

  function load(): { envs: Environment[]; status: string | null } {
    const scanned = scan(root);
    if (scanned === null) {
      return { envs: [], status: `Окружения не найдены в ${root}` };
    }
    return { envs: scanned, status: null };
  }

  function repaint(): void {
    const { envs, status } = load();
    const w = term.width();
    const h = term.height();
    term.clear();
    process.stdout.write(render({
      state,
      envs,
      root,
      width: w,
      height: h,
      useColor: state.colorToggle && !term.noColor,
      status,
    }));
  }

  term.onResize(repaint);
  term.start();
  repaint();

  for (;;) {
    const key = await term.key();
    const { envs } = load();
    state = reducer(state, key, envs.length, computeLayout({ width: term.width(), height: term.height() }).twoColumns);
    if (state.quit) break;
    repaint();
  }
  term.stop();
}
```

- [ ] **Step 2: Написать `src/index.ts`**

```ts
#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';

function printHelp(): void {
  process.stdout.write(
    [
      'pi-env — CLI для управления окружениями pi',
      '',
      'Использование: pi-env [--root <путь>]',
      '',
      'Флаги:',
      '  --root <путь>   корневой каталог окружений (по умолчанию ~/.pi-env)',
      '  -h, --help      эта справка',
      '',
    ].join('\n'),
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    return;
  }
  let root: string | undefined;
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1] !== undefined) root = argv[i + 1];
  if (root === undefined) root = process.env.PI_ENV_ROOT ?? join(homedir(), '.pi-env');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('pi-env требует интерактивный терминал (TTY)\n');
    process.exit(2);
  }
  void run(root);
}

main();
```

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: exit 0, создан `dist/index.js`

- [ ] **Step 4: Проверка поведения без TTY**

Run: `echo "" | node dist/index.js; echo "exit=$?"`
Expected: в stderr «pi-env требует интерактивный терминал (TTY)», `exit=2`

Run: `node dist/index.js --help`
Expected: текст справки (включая `--root`), exit 0

- [ ] **Step 5: Ручная проверка TUI**

```bash
mkdir -p ~/.pi-env/dev ~/.pi-env/prod
touch ~/.pi-env/dev/settings.json
npm run start
```

В терминале проверить:
1. Таб-бар: `Окружения` активный; TAB → `Настройки` → `О программе` → `Окружения`.
2. Список: `dev`, `prod`, разделитель, `Создать`; ↑↓ двигает курсор, `> dev` подсвечен.
3. Правая колонка: `dev`, `Путь: ~/.pi-env/dev`, `settings.json ✓`.
4. Enter на `dev` → рамка «Запуск окружения dev — этап 2», Esc — назад.
5. Enter на «Создать» → рамка «Создание окружения — этап 2», Esc — назад.
6. Вкладка «Настройки»: Space на «Цветной вывод» переключает `[x]`/`[ ]` (цвет вкл/выкл).
7. Сжать терминал (ширина < 62) → правая колонка исчезает; ←→ неактивны.
8. ESC на верхнем уровне → выход, курсор и терминал восстановлены.

- [ ] **Step 6: Коммит**

```bash
git add src/run.ts src/index.ts
git commit -m "feat: app loop and CLI entry point"
```

---

### Task 8: `AGENTS.md` + финальная проверка

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: весь реализованный код (Tasks 1–7).

- [ ] **Step 1: Написать `AGENTS.md`**

```markdown
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

## Текущий статус (этап 1)

- Работает: список окружений, таб-бар `Окружения | Настройки | О программе`,
  клавиши ↑↓←→/TAB/Enter/Space/ESC, адаптивные две колонки (порог 62),
  заглушки-субэкраны «Создание — этап 2»/«Запуск — этап 2», минимальная
  вкладка настроек (toggle «Цветной вывод»), статус-строка.
- Заглушки: запуск окружения, создание окружения, полные настройки — этап 2.

## Стек

- Node.js ≥ 20, TypeScript (ESM, `NodeNext`), ноль runtime-зависимостей.
- Dev-зависимости: `typescript`, `tsx`. Тесты: `node:test`.

## Команды

- `npm run build` — компиляция `src/` → `dist/`
- `npm test` — `tsx --test test/*.test.ts`
- `npm run start` — запуск CLI (`node dist/index.js`)
- `npx tsx src/index.ts` — запуск без сборки

## Структура

- `src/index.ts` — вход: аргументы (`--root`, `--help`), TTY-проверка, старт
- `src/terminal.ts` — raw-режим, `parseKeys` (чистая), фабрика `Term`
- `src/environments.ts` — `scan(root)` (чистая)
- `src/layout.ts` — `computeLayout` (чистая), константы порогов
- `src/state.ts` — `AppState`, `reducer` (чистая)
- `src/render.ts` — `render(args)` → строки ANSI (чистая)
- `src/run.ts` — цикл приложения
- `test/*.test.ts` — тесты чистого ядра

## Конвенции

- Вся логика, не требующая TTY, — чистые функции, тестируемые `node:test`.
- Терминальный слой тонкий; UI-логику в `terminal.ts` не переносить.
- UI-тексты и сообщения — на русском.
- Не добавлять runtime-зависимости без необходимости.
- Изменять раскладку/поведение клавиш — только вместе с обновлением тестов
  `render`/`state` и этого файла.

## Клавиши

- ↑/↓ — перемещение в списке
- ←/→ — фокус колонок (широкий режим, вкладка «Окружения»)
- TAB — цикл вкладок: Окружения → Настройки → О программе
- Enter — подтвердить: окружение → «Запуск — этап 2», «Создать» → «Создание — этап 2»
- Space — toggle на вкладке «Настройки»
- ESC — назад из суб-экрана / выход
- Ctrl+C — аварийный выход

## Дорожная карта

- Этап 2: запуск окружения (spawn `pi` с `PI_CODING_AGENT_DIR`), создание
  окружения (форма имени → папка с дефолтным `settings.json`), редактирование.
- Этап 3+: полные настройки, удаление окружений, детальная инфо-панель.
```

- [ ] **Step 2: Финальная проверка**

Run: `npm test && npm run build && node dist/index.js --help`
Expected: все тесты PASS, сборка успешна, справка печатается.

Ручной прогон из Task 7 Step 5 (список 1–8) — все пункты выполняются.

- [ ] **Step 3: Коммит**

```bash
git add AGENTS.md
git commit -m "docs: project AGENTS.md"
```

---

## Self-Review (выполнен автором плана)

1. **Покрытие спеки:** список окружений → Task 2/5; таб-бар и TAB → Task 4/5; клавиши ↑↓←→/Enter/Space/ESC/Ctrl+C → Task 4; адаптивность 62/30/8 и SIGWINCH → Task 3/5/6/7; правая колонка-заглушка → Task 5; «Создать» без «Настройки» в списке → Task 5; минимальные настройки с toggle → Task 4/5; суб-экраны → Task 4/5; статус-строка и ошибки (нет TTY → exit 2, корень не найден) → Task 5/7; тесты → Tasks 2–6; AGENTS.md → Task 8. Пропусков нет.
2. **Placeholder-скан:** «TBD/TODO/позже» отсутствуют; каждый шаг с кодом или командой.
3. **Согласованность типов:** `Environment` (Task 2) → `RenderArgs` (Task 5); `AppState`/`reducer` (Task 4) → `run` (Task 7); `computeLayout` (Task 3) → `render` (Task 5) и `run` (Task 7); `parseKeys`/`Term` (Task 6) → `run` (Task 7). Имена и сигнатуры совпадают во всех задачах.
