# Поиск в окне установки расширений + скролл длинных списков

> **For agentic workers:** REQUIRED SUB-SKILL: Use supo-subagent-driven-development (recommended) or supo-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В окно «Установка расширения» (пикер каталога pi.dev) добавить поиск по имени пакета; починить скролл — список длиннее терминального окна должен прокручиваться за курсором во всех списках TUI.

**Architecture:** Скролл — windowing в едином месте: `render()` получает от секции индекс курсорной строки (`cursorRow`) и рисует срез списка через чистую `scrollTop()`; без нового состояния. Поиск — строка `Поиск: ▌` в общем пикере `catalogPickerLines()`: запрос хранится в `ExtState.query` / `CreateState.query`, список фильтруется чистой `filterPackages()` (регистронезависимая подстрока в имени), навигация и установка работают по отфильтрованному списку.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, NodeNext), ноль runtime-зависимостей, тесты `node:test` через `tsx --test`.

**Spec:** дизайн согласован в чате 2026-10-03 (bounded, без spec-файла): поиск — только в окне установки (пикер каталога: вкладка «Расширения» + «Установить» в форме), не в списке установленных; поиск по имени пакета (по описанию — сознательно не делается); ввод в конец строки, без caret; скролл — окно стоит сверху, пока курсор не дойдёт до последней видимой строки, затем скроллится, удерживая курсор на нижней границе.

## Global Constraints

- Node.js ≥ 20, TypeScript ESM/`NodeNext`, **ноль runtime-зависимостей** (AGENTS.md).
- Вся UI-логика без TTY — чистые функции, тестируемые `node:test`; UI-тексты — на русском.
- Тесты: `npm test` (= `tsx --test test/*.test.ts`); типизация: `npm run build` (tsc).
- Печатные символы — `isPrintable()` из `src/state.ts` (одиночные ASCII 0x21–0x7e), уже используется в `formReducer`.
- Пикер общий: `catalogPickerLines()` вызываются только из `src/sections.ts` (`createInstall`, `extCatalogView`) — проверено grep'ом при создании плана.

## Review Focus

1. **Backspace при пустом поиске** — ничего не ломается, состояние не меняется (тест в Task 2: «пустой поиск — ничего не делает»).
2. **Enter/Space при пустом результате фильтра** — ничего не происходит, без падений и установки (тест в Task 2: «Enter при пустом результате — ничего не делает»).
3. **Ресайз кадра при курсоре в скролленом списке** — курсор остаётся видимым в кадре любого размера (тест в Task 2: «окно с поисковой строкой… + ресайз»).
4. **Нерядные/кириллические символы в поиске** — фильтр возвращает пусто, без исключений (тест в Task 2: `filterPackages`).
5. **Короткие списки (короче кадра)** — вывод идентичен доизменённому: окно не смещается (тест в Task 1: `scrollTop` + существующие регрессионные тесты render).

---

### Task 1: Скролл длинных списков (windowing в `render()`)

**Files:**
- Modify: `src/render.ts` — `scrollTop()`, windowing в цикле `render()`, `renderSettings`/`renderAbout` возвращают `Section`
- Modify: `src/sections.ts` — тип `Section`, `cursorRow` во всех секциях
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `computeLayout`, существующие секции.
- Produces: `export function scrollTop(cursorRow: number, len: number, height: number): number` (render.ts); `export interface Section { left: string[]; right: string[]; cursorRow: number }` (sections.ts) — используется Task 2.

- [ ] **Step 1: Написать падающие тесты**

Добавить в `test/render.test.ts` (импорт расширить: `import { render, scrollTop } from '../src/render.js';`):

```ts
test('scrollTop: окно стоит, пока курсор в кадре; затем скроллится', () => {
  assert.equal(scrollTop(0, 100, 20), 0);
  assert.equal(scrollTop(19, 100, 20), 0);
  assert.equal(scrollTop(20, 100, 20), 1);
  assert.equal(scrollTop(50, 100, 20), 31);
  assert.equal(scrollTop(99, 100, 20), 80);
  assert.equal(scrollTop(-1, 100, 20), 0);
  assert.equal(scrollTop(5, 15, 20), 0); // список короче окна
});

test('длинный каталог: окно скроллится, курсор виден, верхние строки ушли', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    name: 'pkg' + String(i).padStart(2, '0'),
    types: [] as string[],
    downloads: 0,
    description: null,
    author: null,
  }));
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, cursor: 25 }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('> pkg25'));
  assert.ok(!s.includes('pkg00'));
  assert.ok(!s.includes('pkg16'));
  assert.ok(s.includes('pkg17')); // первая видимая: left = [title, pkg00..], top = 19
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx tsx --test test/render.test.ts`
Expected: FAIL — `scrollTop` не экспортируется; окно не скроллится (`pkg00` виден).

- [ ] **Step 3: Реализовать**

`src/render.ts`:

1. Импорты: `import { renderCreate, renderExtTab, renderEnvList, type Ctx, type Section } from './sections.js';`
2. После константы `PKG_NAME_MAX` — новая функция:

```ts
/**
 * Смещение окна для списка длиннее кадра: верх стоит, пока курсор не
 * достигнет последней видимой строки, затем окно скроллится и курсор
 * удерживается на нижней границе. Курсора нет (−1) или список короткий — 0.
 */
export function scrollTop(cursorRow: number, len: number, height: number): number {
  if (cursorRow < 0 || len <= height) return 0;
  return Math.max(0, Math.min(cursorRow - (height - 1), len - height));
}
```

3. В `render()` заменить блок `const { left, right } = section;` + начало цикла на:

```ts
  const { left, right, cursorRow } = section;
  const top = scrollTop(cursorRow, left.length, contentRows);
  for (let i = 0; i < contentRows; i++) {
    if (twoCol) {
      const l = left[top + i] !== undefined ? padRight(left[top + i], L.leftWidth) : ' '.repeat(L.leftWidth);
      const r = i < right.length ? padRight(right[i], L.rightWidth) : ' '.repeat(L.rightWidth);
```

(остальной цикл без изменений), и ветку narrow:

```ts
    } else {
      const l = left[top + i] !== undefined ? padRight(left[top + i], inner) : ' '.repeat(inner);
      lines.push('│' + l + '│');
    }
```

4. `renderSettings`: сигнатура `: Section`, `return { left, right, cursorRow: state.selected };`
5. `renderAbout`: сигнатура `: Section`, `return { left, right: [], cursorRow: -1 };`

`src/sections.ts`:

1. После `Ctx` — тип:

```ts
/** Результат секции: колонки и номер курсорной строки в left (−1 — нет списка). */
export interface Section {
  left: string[];
  right: string[];
  cursorRow: number;
}
```

2. Все сигнатуры `: { left: string[]; right: string[] }` → `: Section` (`renderCreate`, `createForm`, `createPackages`, `createInstall`, `createSelects` (оба return'а), `createBusy`, `renderEnvList`, `renderExtTab`, `extList`, `extCatalogView`, `extBusy`).
3. Значения `cursorRow` (индекс в массиве `left`):
   - `createForm`: `cr.cursor`
   - `createPackages`: `1 + cr.cursor` (строка заголовка сверху)
   - `createInstall`: `-1` (Task 2 поставит точное значение)
   - `createSelects`: ранний return — `-1`; основной — `1 + cr.cursor`
   - `createBusy`, `extBusy`: `-1`
   - `renderEnvList`:

```ts
  const cursorRow = state.selected < envs.length
    ? state.selected
    : envs.length === 0 ? 0 : envs.length + 1; // разделитель сдвигает «Создать»
  return { left, right, cursorRow };
```

   - `extList` (`n = pkgs.length`, `s = state.selected`; left = `[title, пакеты…, sep (если n>0), Обновить все, Установить]`):

```ts
  const cursorRow =
    s < n ? 1 + s
    : s === n ? (n === 0 ? 1 : n + 2)
    : (n === 0 ? 2 : n + 3);
  return { left, right, cursorRow };
```

   - `extCatalogView`: `-1` (Task 2 поставит точное значение)

- [ ] **Step 4: Тесты проходят**

Run: `npx tsx --test test/render.test.ts && npm test && npm run build`
Expected: PASS (все 4 набора), tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add src/render.ts src/sections.ts test/render.test.ts
git commit -m "feat(render): скролл длинных списков — окно следует за курсором"
```

---

### Task 2: Поиск в окне установки расширений

**Files:**
- Modify: `src/catalog.ts` — `filterPackages()`
- Modify: `src/state.ts` — `query` в `ExtState`/`CreateState`, `freshCreate`/`freshEdit`/`freshExt`, `clampToLen()`, reducer (каталог вкладки + `case 'install'`)
- Modify: `src/render.ts` — `catalogPickerLines()`: параметр `query`, поисковая строка, «Найдено: N», «Ничего не найдено»
- Modify: `src/sections.ts` — `extCatalogView`/`createInstall`: фильтрация + `cursorRow`
- Test: `test/catalog.test.ts`, `test/state.test.ts`, `test/state-create.test.ts`, `test/render.test.ts`

**Interfaces:**
- Consumes: `Section` из Task 1; `isPrintable()` (state.ts, hoisted); `CatalogPkg` (catalog.ts).
- Produces: `export function filterPackages(pkgs: CatalogPkg[], query: string): CatalogPkg[]`; поля `ExtState.query: string`, `CreateState.query: string`; `catalogPickerLines(pkgs, query, status, cursor, L, useColor)`.

- [ ] **Step 1: Написать падающие тесты**

`test/catalog.test.ts` — добавить (импорт `filterPackages` из `'../src/catalog.js'`):

```ts
test('filterPackages: подстрока без учёта регистра; пустой/пробельный — весь список', () => {
  const pkgs = [
    { name: 'obsidian', types: [], downloads: 3, description: null, author: null },
    { name: 'pi-a', types: [], downloads: 2, description: null, author: null },
    { name: 'Zebra', types: [], downloads: 1, description: null, author: null },
  ];
  assert.deepEqual(filterPackages(pkgs, '').map((p) => p.name), ['obsidian', 'pi-a', 'Zebra']);
  assert.deepEqual(filterPackages(pkgs, '  ').map((p) => p.name), ['obsidian', 'pi-a', 'Zebra']);
  assert.deepEqual(filterPackages(pkgs, 'obs').map((p) => p.name), ['obsidian']);
  assert.deepEqual(filterPackages(pkgs, 'ZEB').map((p) => p.name), ['Zebra']);
  assert.deepEqual(filterPackages(pkgs, 'zzz'), []);
  assert.deepEqual(filterPackages(pkgs, 'пакет'), []); // кириллица — пусто, без исключений
});
```

`test/state.test.ts` — исправить хелпер `extOver` (добавить `query: ''` в литерал, иначе `filterPackages` упадёт на `undefined`) и добавить:

```ts
test('каталог: ввод фильтрует список, Backspace стирает, курсор кламнится, Enter — отфильтрованное', () => {
  const items: CatalogPkg[] = [
    { name: 'obsidian', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-a', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-b', types: [], downloads: 0, description: null, author: null },
  ];
  let s = extTabState(0, { ext: extOver({ view: 'catalog', catalogStatus: 'ready', catalog: items }) });
  s = reducer(s, 'down', envs(0), true);
  s = reducer(s, 'down', envs(0), true); // курсор 2 (pi-b)
  s = reducer(s, 'p', envs(0), true); // 'p' → [pi-a, pi-b]
  assert.equal(s.ext!.query, 'p');
  assert.equal(s.ext!.cursor, 1); // кламп с 2 до 1
  s = reducer(s, 'backspace', envs(0), true);
  assert.equal(s.ext!.query, '');
  assert.equal(s.ext!.cursor, 1); // кламп не двигает курсор вверх
  s = reducer(s, 'backspace', envs(0), true); // пустой поиск — ничего не делает
  assert.equal(s.ext!.query, '');
  s = reducer(s, 'o', envs(0), true); // 'o' → [obsidian]
  s = reducer(s, 'b', envs(0), true);
  s = reducer(s, 'enter', envs(0), true);
  assert.equal(s.ext!.view, 'installing');
  assert.equal(s.ext!.installing, 'obsidian');
});

test('каталог: Enter при пустом результате фильтра — ничего не делает', () => {
  const items: CatalogPkg[] = [{ name: 'pi-a', types: [], downloads: 0, description: null, author: null }];
  let s = extTabState(0, { ext: extOver({ view: 'catalog', catalogStatus: 'ready', catalog: items }) });
  s = reducer(s, 'z', envs(0), true);
  assert.equal(s.ext!.view, 'catalog');
  s = reducer(s, 'enter', envs(0), true);
  assert.equal(s.ext!.view, 'catalog');
  assert.equal(s.ext!.installing, null);
});
```

`test/state-create.test.ts` — добавить (при необходимости `import type { CatalogPkg } from '../src/catalog.js';`, тип `AppState` уже импортирован):

```ts
test('install: поиск фильтрует каталог, Backspace стирает, Enter — отфильтрованное', () => {
  const items: CatalogPkg[] = [
    { name: 'pi-a', types: [], downloads: 0, description: null, author: null },
    { name: 'pi-b', types: [], downloads: 0, description: null, author: null },
    { name: 'obsidian', types: [], downloads: 0, description: null, author: null },
  ];
  let s: AppState = {
    ...initialState(catalog),
    sub: 'create',
    create: { ...freshEdit('dev', {}, catalog), view: 'install' as const, installCatalog: items, installStatus: 'ready' as const },
  };
  s = reducer(s, 'o', envs(0), true);
  assert.equal(s.create!.query, 'o');
  s = reducer(s, 'backspace', envs(0), true);
  assert.equal(s.create!.query, '');
  s = reducer(s, 'p', envs(0), true); // 'p' → [pi-a, pi-b]
  s = reducer(s, 'i', envs(0), true);
  s = reducer(s, 'down', envs(0), true); // курсор 1
  s = reducer(s, 'enter', envs(0), true);
  assert.equal(s.create!.view, 'installing');
  assert.equal(s.create!.installing, 'pi-b');
});
```

`test/render.test.ts` — добавить:

```ts
test('каталог: поисковая строка, «Найдено: N», «Ничего не найдено»', () => {
  const items = [
    { name: 'pi-a', types: ['extension'], downloads: 5, description: 'A', author: null },
    { name: 'pi-b', types: [], downloads: 4, description: null, author: null },
  ];
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, query: 'pi' }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('Поиск: pi▌'));
  assert.ok(s.includes('Найдено: 2'));
  const no = render({ state: { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, query: 'zzz' }) }, envs, width: 100, height: 12, ...base });
  assert.ok(no.includes('Ничего не найдено'));
  assert.ok(no.includes('Найдено: 0'));
});

test('каталог с поисковой строкой: окно корректно, курсор на нижней границе, ресайз', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    name: 'pkg' + String(i).padStart(2, '0'),
    types: [] as string[],
    downloads: 0,
    description: null,
    author: null,
  }));
  const st = { ...initialState(), tab: 'extensions' as const, ext: freshExt({ catalogStatus: 'ready' as const, catalog: items, cursor: 25 }) };
  const s = render({ state: st, envs, width: 100, height: 12, ...base });
  assert.ok(s.includes('> pkg25'));
  assert.ok(s.includes('pkg18')); // первая видимая: left = [title, поиск, pkg00..], top = 20
  assert.ok(!s.includes('pkg17'));
  assert.ok(!s.includes('pkg00'));
  const tall = render({ state: st, envs, width: 100, height: 40, ...base });
  assert.ok(tall.includes('> pkg25'));
  assert.ok(tall.includes('pkg00')); // высокий кадр — весь список
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx tsx --test test/catalog.test.ts test/state.test.ts test/state-create.test.ts test/render.test.ts`
Expected: FAIL — `filterPackages` не экспортируется; `query` не меняется; строки «Поиск:»/«Найдено:» отсутствуют.

- [ ] **Step 3: Реализовать**

`src/catalog.ts` — после интерфейса `CatalogPkg`:

```ts
/**
 * Поиск по имени пакета: регистронезависимая подстрока.
 * Пустой/только-пробельный запрос — исходный список.
 */
export function filterPackages(pkgs: CatalogPkg[], query: string): CatalogPkg[] {
  const q = query.trim().toLowerCase();
  if (q === '') return pkgs;
  return pkgs.filter((p) => p.name.toLowerCase().includes(q));
}
```

`src/state.ts`:

1. Импорт: `import { normalizePkgSource, filterPackages } from './catalog.js';`
2. `ExtState` — поле `query: string;` (рядом с `catalogStatus`).
3. `CreateState` — поле `query: string;` (рядом с `installStatus`).
4. `freshCreate()` и `freshEdit()` — в инициализацию добавить `query: ''`.
5. `freshExt()`:

```ts
  return { view: 'catalog', cursor: 0, updating: null, installing: null, removing: null, catalog: [], catalogStatus: 'loading', query: '', ...partial };
```

6. После `isPrintable` — хелпер:

```ts
/** Кламп курсора к длине списка: пусто — 0. Двигает курсор только вниз. */
function clampToLen(cursor: number, len: number): number {
  return len === 0 ? 0 : Math.min(cursor, len - 1);
}
```

7. В `reducer` заменить блок `if (ext.view === 'catalog') { ... }` целиком:

```ts
      if (ext.view === 'catalog') {
        const pkgs = filterPackages(ext.catalog, ext.query);
        const n = pkgs.length;
        if (action === 'up' || action === 'down') {
          if (n === 0) return state;
          const delta = action === 'up' ? -1 : 1;
          return { ...state, ext: { ...ext, cursor: (ext.cursor + delta + n) % n } };
        }
        if (isPrintable(action)) {
          const query = ext.query + action;
          return { ...state, ext: { ...ext, query, cursor: clampToLen(ext.cursor, filterPackages(ext.catalog, query).length) } };
        }
        if (action === 'backspace') {
          const query = ext.query.slice(0, -1);
          return { ...state, ext: { ...ext, query, cursor: clampToLen(ext.cursor, filterPackages(ext.catalog, query).length) } };
        }
        if (action === 'esc') return { ...state, ext: null };
        if ((action === 'enter' || action === 'space') && n > 0) {
          return { ...state, ext: { ...ext, view: 'installing', installing: pkgs[ext.cursor].name } };
        }
      }
```

8. В `createReducer` заменить `case 'install':`:

```ts
    case 'install': {
      if (isPrintable(action)) {
        const query = c.query + action;
        return { ...c, query, cursor: clampToLen(c.cursor, filterPackages(c.installCatalog, query).length) };
      }
      if (action === 'backspace') {
        const query = c.query.slice(0, -1);
        return { ...c, query, cursor: clampToLen(c.cursor, filterPackages(c.installCatalog, query).length) };
      }
      const pkgs = filterPackages(c.installCatalog, c.query);
      return listViewReducer(c, action, pkgs.map((p) => p.name), 'packages', ROW_NAME, (name) => ({
        ...c, view: 'installing', installing: name,
      }));
    }
```

`src/render.ts` — `catalogPickerLines()`: второй параметр `query: string`; в тело:

```ts
  const left: string[] = [];
  const right: string[] = [];
  left.push('Поиск: ' + query + '▌');
  if (query.trim() !== '') right.push('Найдено: ' + pkgs.length);
  if (status === 'loading') {
```

(ветка `loading`/`error` без изменений), в else-ветке пустой список:

```ts
    if (pkgs.length === 0) {
      const empty = query.trim() !== '' ? 'Ничего не найдено' : '— пусто —';
      left.push(c(ANSI.dim, useColor) + empty + c(ANSI.reset, useColor));
    }
```

(`pkgs.forEach(... listRow(i, cursor, ...))` и инфо-панель `cur = pkgs[cursor]` — без изменений, `pkgs` теперь отфильтрованный.)

`src/sections.ts`:

1. Импорт: `import { filterPackages } from './catalog.js';`
2. `createInstall`:

```ts
  const pkgs = filterPackages(cr.installCatalog, cr.query);
  const picker = catalogPickerLines(pkgs, cr.query, cr.installStatus, cr.cursor, ctx.L, ctx.useColor);
  left.push(...picker.left);
  right.push(...picker.right);
  // …строки error/hint без изменений…
  return { left, right, cursorRow: cr.installStatus === 'ready' ? 2 + cr.cursor : -1 };
```

3. `extCatalogView`:

```ts
  const pkgs = filterPackages(ext.catalog, ext.query);
  const picker = catalogPickerLines(pkgs, ext.query, ext.catalogStatus, ext.cursor, ctx.L, ctx.useColor);
  left.push(...picker.left);
  right.push(...picker.right);
  right.push(c(ANSI.dim, ctx.useColor) + 'Esc — назад' + c(ANSI.reset, ctx.useColor));
  return { left, right, cursorRow: ext.catalogStatus === 'ready' ? 2 + ext.cursor : -1 };
```

- [ ] **Step 4: Тесты проходят**

Run: `npm test && npm run build`
Expected: PASS во всех файлах тестов, tsc без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add src/catalog.ts src/state.ts src/render.ts src/sections.ts test/catalog.test.ts test/state.test.ts test/state-create.test.ts test/render.test.ts
git commit -m "feat(каталог): поиск по имени пакета в окне установки расширений"
```

---

### Task 3: Документация (AGENTS.md) и финальная проверка

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: результат Task 1–2.
- Produces: актуальные AGENTS.md.

- [ ] **Step 1: Обновить AGENTS.md**

1. Раздел «Текущий статус (этап 2 готов)» — в список «Работает» дополнить: поиск в окне установки расширений (по имени пакета, регистронезависимо, в обоих пикерах: вкладка «Расширения» и форма окружения) и скролл: окно списка следует за курсором (все списки длиннее кадра).
2. Раздел «Клавиши» — строку «Печатные символы / Backspace — ввод имени (строка «Имя» формы)» заменить на: «Печатные символы / Backspace — ввод имени (строка «Имя» формы) и поиска (строка «Поиск» в окне установки)».
3. Структура: строка `src/render.ts` — добавить `scrollTop` (окно списка); строка `src/state.ts` — упомянуть `query` (поиск в окне установки).

- [ ] **Step 2: Финальная проверка**

Run: `npm test && npm run build && git status --short`
Expected: все тесты PASS, tsc чистый, в unstaged только AGENTS.md.

- [ ] **Step 3: Коммит**

```bash
git add AGENTS.md
git commit -m "docs: AGENTS.md — поиск в окне установки и скролл списков"
```
