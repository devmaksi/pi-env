# Управление расширениями: обновления, инфо-панель, удаление

> **For agentic workers:** REQUIRED SUB-SKILL: Use supo-subagent-driven-development (recommended) or supo-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В списке расширений (форма создания/редактирования окружения) показать доступность обновлений, информацию о расширении в правой колонке, кнопку «Обновить все» и клавишу X удаления расширения с подтверждением.

**Architecture:** Действия глобальные (main-агент) через pi CLI (`pi update --extensions`, `pi remove <source>`) и npm (`npm outdated --json --prefix <agent>/npm`) — дочерние процессы с piped-stdio (pi/npm в print-режиме, без TTY-промптов). Состояние — чистый reducer (`state.ts`), отрисовка — чистая `render()`, побочные эффекты — тонкий слой `run.ts`. Каталог перезагружается после операций.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, NodeNext), ноль runtime-зависимостей, node:test.

**Spec:** дизайн одобрен в чате 2026-09-30 (маркер `↑ <версия>`, инфо-панель справа, кнопка «Обновить все» в конце списка, X — удаление с подтверждением; pinned/локальные источники — без проверки реестра).

## Global Constraints

- UI-тексты и сообщения — на русском языке.
- Ноль runtime-зависимостей (dev: typescript, tsx).
- Вся логика без TTY — чистые функции, тестируемые `node:test`; UI-логику в `terminal.ts` не переносить.
- Коммит после каждого task; сообщения коммитов — `feat:`/`fix:` + русское описание.
- Изменение раскладки/клавиш — только вместе с тестами `render`/`state` и обновлением `AGENTS.md` (сделать в Task 4).
- Рабочая директория: worktree `~/.pi-env/Project/...` — `.worktrees/feat-pkg-management` (ветка `feat-pkg-management`).

## Review Focus

1. **Офлайн / ошибка npm** — `npm outdated` завершается не 0: список не падает, маркер `?`, статус-строка «Не удалось проверить обновления». → тесты: Task 2 (`updates-result ok:false`), Task 3 (маркер `?`).
2. **Pinned npm-источник** (`npm:pkg@1.2.3`) — не показывать ложный «↑ доступно»: pi не обновляет закреплённые версии. → тест: Task 3 (маркер «закреплено»).
3. **X на строке кнопки / в пустом списке** — не действие, без падения. → тесты: Task 2 (X на строке кнопки), Task 3 (пустой список: кнопка на месте).
4. **Поздний результат после Esc** (пользователь ушёл из «Обновление…/Удаление…», процесс завершился) — результат применяется безопасно, отметки остальных пакетов не теряются. → тест: Task 2 (esc в removing → remove-result ok).
5. **Синхронность после удаления** — удалённый пакет снимается с отметок формы (в settings окружения при сохранении его не будет). → тест: Task 2 (remove-result фильтрует `packages`).

---

### Task 1: catalog — version/description у PkgItem + parseOutdated

**Files:**
- Modify: `src/catalog.ts`
- Test: `test/catalog.test.ts`
- Modify (фикстуры под новый обязательный интерфейс): `test/state-create.test.ts`, `test/state.test.ts`, `test/render-create.test.ts`

**Interfaces:**
- Consumes: — (первый task)
- Produces:
  - `PkgItem { source: string; name: string; path: string; version: string | null; description: string | null; extensions: string[]; skills: string[] }`
  - `parseOutdated(raw: string): Record<string, string>` — имя пакета → latest-версия (только устаревшие; мусор/пусто → `{}`)

- [ ] **Step 1: Write the failing test**

`test/catalog.test.ts` — дописать импорты (`parseOutdated` из `../src/catalog.js`) и тесты:

```ts
test('parseOutdated: валидный JSON → имя → latest', () => {
  assert.deepEqual(
    parseOutdated('{"pkg-a":{"current":"1.0.0","latest":"2.0.0"},"pkg-b":{"latest":"1.1.0"}}'),
    { 'pkg-a': '2.0.0', 'pkg-b': '1.1.0' },
  );
});

test('parseOutdated: {}, мусорный JSON, массив, числовой latest, null → {}', () => {
  assert.deepEqual(parseOutdated('{}'), {});
  assert.deepEqual(parseOutdated('не json'), {});
  assert.deepEqual(parseOutdated('[1,2]'), {});
  assert.deepEqual(parseOutdated('{"a":{"latest":5}}'), {});
  assert.deepEqual(parseOutdated('null'), {});
});
```

Дополнить существующий тест `listPackages: npm- и локальные источники, поле pi`: в `package.json` у `pkg-a` добавить `version: '1.2.3'` и `description: 'Тестовый пакет'`; после `const a = pkgs.find(...)` добавить:

```ts
    assert.equal(a.version, '1.2.3');
    assert.equal(a.description, 'Тестовый пакет');
    const l = pkgs.find((p) => p.name === 'local-pkg')!;
    assert.equal(l.version, null);
    assert.equal(l.description, null);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/catalog.test.ts`
Expected: FAIL — `parseOutdated is not a function` / тип `version` отсутствует.

- [ ] **Step 3: Write minimal implementation**

`src/catalog.ts` — интерфейс:

```ts
export interface PkgItem {
  source: string;
  name: string;
  path: string;
  version: string | null;
  description: string | null;
  extensions: string[];
  skills: string[];
}
```

`listPackages` — push дополнить (рядом с `name`/`path`):

```ts
      version: typeof (pkg as { version?: unknown }).version === 'string' ? (pkg as { version: string }).version : null,
      description: typeof (pkg as { description?: unknown }).description === 'string' ? (pkg as { description: string }).description : null,
```

Новый экспорт (рядом с `listPackages`):

```ts
/**
 * Разбор вывода `npm outdated --json`: имя пакета → latest-версия.
 * Только устаревшие пакеты попадают в вывод. Мусор/пусто → {}.
 */
export function parseOutdated(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const latest = (value as { latest?: unknown }).latest;
      if (typeof latest === 'string') out[name] = latest;
    }
  }
  return out;
}
```

Обновить фикстуры каталогов (новые обязательные поля `version`/`description`):

`test/state-create.test.ts`:
```ts
  packages: [
    { source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: 'Пакет A', extensions: ['./index.ts'], skills: [] },
    { source: 'npm:pkg-b', name: 'pkg-b', path: '/p/b', version: '2.0.0', description: null, extensions: ['./exts'], skills: [] },
  ],
```

`test/state.test.ts` (catalog2):
```ts
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: null, extensions: [], skills: [] }],
```

`test/render-create.test.ts`:
```ts
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.2.3', description: 'Тестовый пакет', extensions: ['./index.ts'], skills: [] }],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (все тесты, включая старые — фикстуры обновлены).

- [ ] **Step 5: Commit**

```bash
git add src/catalog.ts test/catalog.test.ts test/state-create.test.ts test/state.test.ts test/render-create.test.ts
git commit -m "feat: каталог — version/description у пакетов, parseOutdated для npm outdated"
```

---

### Task 2: state — views, клавиша X, действия обновлений/удаления

**Files:**
- Modify: `src/state.ts`
- Test: `test/state-create.test.ts`

**Interfaces:**
- Consumes: `PkgItem` (Task 1)
- Produces:
  - `CreateView` += `'updating' | 'confirm-remove' | 'removing'`
  - `UPDATE_ALL_ROW: string` (константа строки-кнопки в конце списка)
  - `PkgCheck = 'idle' | 'checking' | 'done' | 'error'`
  - `AppState.pkgCheck: PkgCheck`, `AppState.pkgLatest: Record<string, string>`
  - `CreateState.removing: string | null`
  - `Action` += `{ type: 'updates-result'; ok: boolean; latest: Record<string, string> } | { type: 'update-result'; ok: boolean; message: string } | { type: 'remove-result'; ok: boolean; message: string }`
  - Поведение: в `packages` view `items = [...имена, UPDATE_ALL_ROW]`; Enter на кнопку → `updating`; `x`/`X` на строке пакета → `confirm-remove` (+`removing = имя`); Enter в `confirm-remove` → `removing`; `remove-result ok` → фильтр `packages` от `removing`; `update-result` → `packages`, `cursor 0`.

- [ ] **Step 1: Write the failing test**

`test/state-create.test.ts` — добавить импорт типа `AppState` (уже есть) и хелпер + тесты:

```ts
function openPackages(s: AppState): AppState {
  let t = s;
  t = reducer(t, 'down', [], true);
  t = reducer(t, 'down', [], true);
  t = reducer(t, 'down', [], true);
  t = reducer(t, 'enter', [], true);
  assert.equal(t.create!.view, 'packages');
  return t;
}

test('packages: кнопка «Обновить все» в конце списка, Enter → updating, Esc назад', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', [], true); // pkg-b
  s = reducer(s, 'down', [], true); // кнопка
  assert.equal(s.create!.cursor, 2);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'updating');
  s = reducer(s, 'esc', [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.cursor, 0);
});

test('packages: X → confirm-remove → removing; Esc отменяет', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'x', [], true);
  assert.equal(s.create!.view, 'confirm-remove');
  assert.equal(s.create!.removing, 'pkg-a');
  s = reducer(s, 'esc', [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, null);
  s = reducer(s, 'X', [], true); // верхний регистр тоже
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'removing');
  s = reducer(s, 'esc', [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, 'pkg-a'); // процесс идёт — имя храним до результата
});

test('packages: X на строке кнопки ничего не делает', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true); // строка кнопки
  s = reducer(s, 'x', [], true);
  assert.equal(s.create!.view, 'packages');
});

test('remove-result: ошибка → error, успех → пакет снят с отметок', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'enter', [], true); // отметить pkg-a
  s = reducer(s, 'x', [], true);
  s = reducer(s, 'enter', [], true);
  s = reducer(s, { type: 'remove-result', ok: false, message: 'нет сети' }, [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, null);
  assert.deepEqual(s.create!.packages, ['pkg-a']);
  assert.equal(s.create!.error, 'нет сети');
  s = reducer(s, 'x', [], true);
  s = reducer(s, 'enter', [], true);
  s = reducer(s, { type: 'remove-result', ok: true, message: 'pkg-a' }, [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.cursor, 0);
  assert.equal(s.create!.removing, null);
  assert.deepEqual(s.create!.packages, []);
  assert.equal(s.create!.error, null);
});

test('поздний remove-result после Esc применяется безопасно', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'enter', [], true); // pkg-a
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true); // pkg-b
  s = reducer(s, 'up', [], true);
  s = reducer(s, 'x', [], true);
  s = reducer(s, 'enter', [], true);
  s = reducer(s, 'esc', [], true); // ушли, процесс ещё идёт
  s = reducer(s, { type: 'remove-result', ok: true, message: 'pkg-a' }, [], true);
  assert.equal(s.create!.view, 'packages');
  assert.deepEqual(s.create!.packages, ['pkg-b']);
});

test('update-result: успех → к списку, ошибка → error', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'updating');
  s = reducer(s, { type: 'update-result', ok: false, message: 'нет сети' }, [], true);
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.error, 'нет сети');
});

test('updates-result: карта latest и статус проверки', () => {
  let s = withCreate();
  assert.equal(s.pkgCheck, 'idle');
  s = reducer(s, { type: 'updates-result', ok: true, latest: { 'pkg-a': '2.0.0' } }, [], true);
  assert.equal(s.pkgCheck, 'done');
  assert.deepEqual(s.pkgLatest, { 'pkg-a': '2.0.0' });
  s = reducer(s, { type: 'updates-result', ok: false, latest: {} }, [], true);
  assert.equal(s.pkgCheck, 'error');
  assert.deepEqual(s.pkgLatest, { 'pkg-a': '2.0.0' });
});
```

Поправить существующий тест `списки: курсор зациклен` (в список добавилась строка кнопки — items = 3):

```ts
test('списки: курсор зациклен', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true); // packages (строка 3)
  s = reducer(s, 'enter', [], true);
  s = reducer(s, 'up', [], true);
  assert.equal(s.create!.cursor, 2); // заходит на строку «Обновить все»
  s = reducer(s, 'down', [], true);
  assert.equal(s.create!.cursor, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/state-create.test.ts`
Expected: FAIL — новые views/действия/поля не существуют.

- [ ] **Step 3: Write minimal implementation**

`src/state.ts`:

Типы (заменить/дополнить существующие):

```ts
export type CreateView = 'form' | 'providers' | 'models' | 'tools' | 'packages' | 'skills' | 'submitting' | 'updating' | 'confirm-delete' | 'deleting' | 'confirm-remove' | 'removing';

/** Строка-кнопка в конце списка расширений. */
export const UPDATE_ALL_ROW = 'Обновить все';

/** Статус проверки расширений на обновления. */
export type PkgCheck = 'idle' | 'checking' | 'done' | 'error';
```

`CreateState` — добавить поле:

```ts
  removing: string | null;
```

`AppState` — добавить поля:

```ts
  pkgCheck: PkgCheck;
  pkgLatest: Record<string, string>;
```

`initialState` — `pkgCheck: 'idle'`, `pkgLatest: {}`.
`freshCreate` и `freshEdit` — `removing: null`.

`Action` — дополнить:

```ts
  | { type: 'updates-result'; ok: boolean; latest: Record<string, string> }
  | { type: 'update-result'; ok: boolean; message: string }
  | { type: 'remove-result'; ok: boolean; message: string }
```

Внешний `reducer` — в ветке `typeof action === 'object'` (рядом с `edit-start`/`run-result`):

```ts
    if (action.type === 'updates-result') {
      return {
        ...state,
        pkgCheck: action.ok ? 'done' : 'error',
        pkgLatest: action.ok ? action.latest : state.pkgLatest,
      };
    }
```

`createReducer` — в начале (рядом с `create-result`/`delete-result`):

```ts
    if (action.type === 'update-result') {
      return { ...c, view: 'packages', cursor: 0, error: action.ok ? null : action.message };
    }
    if (action.type === 'remove-result') {
      if (!action.ok) return { ...c, view: 'packages', removing: null, error: action.message };
      return {
        ...c,
        view: 'packages',
        cursor: 0,
        removing: null,
        error: null,
        packages: c.removing !== null ? c.packages.filter((n) => n !== c.removing) : c.packages,
      };
    }
```

`createReducer` — расщепить общий case `tools/packages/skills`:

```ts
    case 'tools':
    case 'skills': {
      const field = c.view;
      const row = field === 'tools' ? 2 : 4;
      const items =
        field === 'tools' ? catalog.tools.map((t) => t.name)
        : catalog.skills.map((s) => s.name);
      return listViewReducer(c, action, items, 'form', row, (name) => {
        const sel = c[field];
        const next = sel.includes(name) ? sel.filter((x) => x !== name) : [...sel, name];
        return { ...c, [field]: next };
      });
    }
    case 'packages': {
      const names = catalog.packages.map((p) => p.name);
      if ((action === 'x' || action === 'X') && c.cursor < names.length) {
        return { ...c, view: 'confirm-remove', removing: names[c.cursor] };
      }
      return listViewReducer(c, action, [...names, UPDATE_ALL_ROW], 'form', 3, (item) => {
        if (item === UPDATE_ALL_ROW) return { ...c, view: 'updating' };
        const sel = c.packages;
        const next = sel.includes(item) ? sel.filter((x) => x !== item) : [...sel, item];
        return { ...c, packages: next };
      });
    }
```

`createReducer` — новые case (рядом с `submitting`/`confirm-delete`/`deleting`):

```ts
    case 'updating':
      return action === 'esc' ? { ...c, view: 'packages', cursor: 0 } : c;
    case 'confirm-remove':
      if (action === 'esc') return { ...c, view: 'packages', removing: null };
      if (action === 'enter') return { ...c, view: 'removing' };
      return c;
    case 'removing':
      // Esc не отменяет процесс — имя храним до прихода remove-result
      return action === 'esc' ? { ...c, view: 'packages' } : c;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/state-create.test.ts
git commit -m "feat: state — список расширений: кнопка «Обновить все», X — удаление, views updating/removing/confirm-remove, действия updates/update/remove-result"
```

---

### Task 3: render — маркеры обновлений, инфо-панель, экраны

**Files:**
- Modify: `src/render.ts`
- Test: `test/render-create.test.ts`

**Interfaces:**
- Consumes: `UPDATE_ALL_ROW`, `PkgCheck` (Task 2), `PkgItem.version/description` (Task 1)
- Produces: — (UI-слой)
- Поведение: в `packages` view строки `имена + строка кнопки`; маркеры: `↑ <latest>` / `·` / `…` (idle|checking) / `?` (error) / `закреплено` (pinned npm) / `локальный`; правая колонка — панель по пакету под курсором (или описание кнопки); легенда `Space/Enter — выбрать  X — удалить`; `cr.error` — `⚠` в правой колонке; экраны `confirm-remove`/`removing`/`updating` по образцу `confirm-delete`/`deleting`/`submitting`.

- [ ] **Step 1: Write the failing test**

`test/render-create.test.ts` — добавить (фикстура `catalog` уже обновлена в Task 1):

```ts
function pkgState(over: Partial<AppState['create']> = {}, app: Partial<AppState> = {}): AppState {
  return { ...createState(over), ...app, create: { ...freshCreate(), ...over } };
}

test('список расширений: ↑ latest у устаревшего', () => {
  const s = render({ state: pkgState({ view: 'packages' }, { pkgCheck: 'done', pkgLatest: { 'pkg-a': '2.0.0' } }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('↑ 2.0.0'));
});

test('список расширений: · у актуального, … при проверке, ? при ошибке', () => {
  const done = render({ state: pkgState({ view: 'packages' }, { pkgCheck: 'done', pkgLatest: {} }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(done.includes('·'));
  const checking = render({ state: pkgState({ view: 'packages' }, { pkgCheck: 'checking' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(checking.includes('…'));
  const err = render({ state: pkgState({ view: 'packages' }, { pkgCheck: 'error' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(err.includes('?'));
});

test('список расширений: строка кнопки, панель справа, легенда X', () => {
  const s = render({ state: pkgState({ view: 'packages' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Обновить все'));
  assert.ok(s.includes('Источник: npm:pkg-a'));
  assert.ok(s.includes('Версия: 1.2.3'));
  assert.ok(s.includes('Расширений: 1  Скиллов: 0'));
  assert.ok(s.includes('X — удалить'));
});

test('список расширений: панель — описание, отметка «в окружении», статус обновления', () => {
  const s = render({ state: pkgState({ view: 'packages', packages: ['pkg-a'] }, { pkgCheck: 'done', pkgLatest: { 'pkg-a': '2.0.0' } }), envs, width: 100, height: 14, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Тестовый пакет'));
  assert.ok(s.includes('В окружении: ✓'));
  assert.ok(s.includes('установлена 1.2.3'));
});

test('список расширений: курсор на кнопке — описание действия', () => {
  const s = render({ state: pkgState({ view: 'packages', cursor: 1 }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('pi update --extensions'));
});

test('список расширений: pinned и локальные маркеры', () => {
  const catalog2: Catalog = {
    ...catalog,
    packages: [
      { source: 'npm:pkg-a@1.2.3', name: 'pkg-a', path: '/p/a', version: '1.2.3', description: null, extensions: [], skills: [] },
      { source: '/local/p', name: 'local-p', path: '/local/p', version: null, description: null, extensions: [], skills: [] },
    ],
  };
  const s = render({ state: { ...initialState(catalog2), sub: 'create', create: { ...freshCreate(), view: 'packages' } }, envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('закреплено'));
  assert.ok(s.includes('локальный'));
});

test('confirm-remove: вопрос и подсказки', () => {
  const s = render({ state: pkgState({ view: 'confirm-remove', removing: 'pkg-a' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удалить расширение «pkg-a»?'));
  assert.ok(s.includes('Enter — подтвердить'));
  assert.ok(s.includes('Esc — отмена'));
});

test('removing/updating: пометки процесса', () => {
  const s1 = render({ state: pkgState({ view: 'removing' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s1.includes('Удаление…'));
  const s2 = render({ state: pkgState({ view: 'updating' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s2.includes('Обновление…'));
});

test('список расширений: ошибка visible в правой колонке', () => {
  const s = render({ state: pkgState({ view: 'packages', error: 'нет сети' }), envs, width: 100, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('⚠ нет сети'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/render-create.test.ts`
Expected: FAIL — экраны/маркеры/панель не рендерятся.

- [ ] **Step 3: Write minimal implementation**

`src/render.ts` — импорты:

```ts
import { AppState } from './state.js';
import { UPDATE_ALL_ROW, type PkgCheck } from './state.js';
import type { PkgItem } from './catalog.js';
```

(объединить: `import { UPDATE_ALL_ROW, type AppState, type PkgCheck } from './state.js';`)

В цепочке `else if` ветки создания — вставить три экрана (после `submitting`, перед списками):

```ts
      } else if (cr.view === 'confirm-remove') {
        left.push(c(ANSI.bold, useColor) + 'Удалить расширение «' + (cr.removing ?? '') + '»?' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Enter — подтвердить' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
      } else if (cr.view === 'removing') {
        left.push(c(ANSI.dim, useColor) + 'Удаление…' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
      } else if (cr.view === 'updating') {
        left.push(c(ANSI.dim, useColor) + 'Обновление…' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
      } else if (cr.view === 'providers' || cr.view === 'models' || cr.view === 'tools' || cr.view === 'skills') {
```

Исключить `'packages'` из общего case списков (условие, ternary `items`, `titles`, `checked` — как в Task 2-м расщеплении).

Новый блок `packages` (после общего case):

```ts
      } else if (cr.view === 'packages') {
        const pkgs = state.catalog.packages;
        left.push(c(ANSI.bold, useColor) + 'Расширения (пакеты)' + c(ANSI.reset, useColor));
        if (pkgs.length === 0) left.push(c(ANSI.dim, useColor) + '— пусто —' + c(ANSI.reset, useColor));
        pkgs.forEach((pkg, i) => {
          const checked = cr.packages.includes(pkg.name);
          const text = (i === cr.cursor ? '> ' : '  ') + (checked ? '✓ ' : '  ') + pkg.name + ' ' + pkgMarker(pkg, state.pkgCheck, state.pkgLatest);
          left.push(i === cr.cursor ? c(ANSI.inverse, useColor) + padRight(text, L.leftWidth) + c(ANSI.reset, useColor) : text);
        });
        const btnText = (pkgs.length === cr.cursor ? '> ' : '  ') + '↑ ' + UPDATE_ALL_ROW;
        left.push(pkgs.length === cr.cursor ? c(ANSI.inverse, useColor) + padRight(btnText, L.leftWidth) + c(ANSI.reset, useColor) : btnText);
        if (cr.cursor < pkgs.length) {
          const pkg = pkgs[cr.cursor];
          right.push(c(ANSI.bold, useColor) + pkg.name + c(ANSI.reset, useColor));
          right.push('Источник: ' + pkg.source);
          right.push('Версия: ' + (pkg.version ?? '—'));
          right.push('Обновление: ' + pkgUpdateLine(pkg, state.pkgCheck, state.pkgLatest));
          right.push('Расширений: ' + pkg.extensions.length + '  Скиллов: ' + pkg.skills.length);
          if (pkg.description) right.push(pkg.description);
          right.push('В окружении: ' + (cr.packages.includes(pkg.name) ? '✓' : '—'));
        } else {
          right.push(c(ANSI.dim, useColor) + 'Обновить все npm-пакеты: pi update --extensions' + c(ANSI.reset, useColor));
        }
        right.push(c(ANSI.dim, useColor) + 'Space/Enter — выбрать  X — удалить' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — назад' + c(ANSI.reset, useColor));
        if (cr.error) right.push(c(ANSI.bold, useColor) + '⚠ ' + cr.error + c(ANSI.reset, useColor));
      }
```

Хелперы (внизу файла, рядом с `visibleWidth`-утилитами):

```ts
function isPinnedNpm(pkg: PkgItem): boolean {
  const bare = pkg.source.slice(4).replace(/^@[^/]+\//, '');
  return /@[^@]+$/.test(bare);
}

/** Маркер строки списка: ↑ latest / · / … / ? / закреплено / локальный. */
function pkgMarker(pkg: PkgItem, check: PkgCheck, latest: Record<string, string>): string {
  if (!pkg.source.startsWith('npm:')) return 'локальный';
  if (isPinnedNpm(pkg)) return 'закреплено';
  if (check === 'idle' || check === 'checking') return '…';
  if (check === 'error') return '?';
  return latest[pkg.name] ? '↑ ' + latest[pkg.name] : '·';
}

/** Строка «Обновление:» инфо-панели. */
function pkgUpdateLine(pkg: PkgItem, check: PkgCheck, latest: Record<string, string>): string {
  if (!pkg.source.startsWith('npm:')) return 'нет — локальный источник';
  if (isPinnedNpm(pkg)) return 'нет — закреплённая версия';
  if (check === 'idle' || check === 'checking') return 'проверка…';
  if (check === 'error') return 'не удалось проверить';
  const latestV = latest[pkg.name];
  return latestV
    ? '↑ ' + latestV + ' (установлена ' + (pkg.version ?? '—') + ')'
    : 'актуально (' + (pkg.version ?? '—') + ')';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (включая старый тест «пустой список — пометка»: кнопка не ломает пометку «— пусто —»).

- [ ] **Step 5: Commit**

```bash
git add src/render.ts test/render-create.test.ts
git commit -m "feat: render — список расширений: маркеры обновлений, инфо-панель справа, экраны confirm-remove/removing/updating"
```

---

### Task 4: run — связка (npm outdated, pi update, pi remove, перезагрузка каталога) + AGENTS.md

**Files:**
- Modify: `src/run.ts`, `AGENTS.md`

**Interfaces:**
- Consumes: `parseOutdated` (Task 1), `UPDATE_ALL_ROW`/действия (Task 2)
- Produces: — (входная точка)
- Поведение:
  - `runCmd(cmd, args)` — spawn с piped stdio → `{ ok: boolean; output: string }` (exit 0 → ok).
  - Вход в `packages` view (переход из другого view) → `pkgCheck: 'checking'`, fire-and-forget `npm outdated --json --prefix <agentDir>/npm` → `updates-result`; при ошибке статус-строка «Не удалось проверить обновления».
  - `updating` → `pkgCheck: 'idle'`, `await pi update --extensions` → `update-result`; успех → перезагрузка каталога, статус «Все расширения обновлены».
  - `removing` → `await pi remove <source>` (source из каталога по `removing`) → `remove-result`; успех → перезагрузка каталога, статус «Расширение «имя» удалено».
  - Порядок обработчиков в `dispatch`: updating → removing → триггер проверки (после обновлений/удалений проверка запускается сразу).
  - `AGENTS.md`: клавиши += `X — удалить расширение (в списке «Расширения», с подтверждением)`; статус — новая строка про управление расширениями.

- [ ] **Step 1: Написать код** (TTY-слой: юнит-тестов нет — как в текущем проекте; проверка — сборка, тесты и smoke)

`src/run.ts`:

Импорт:
```ts
import { loadCatalog, parseOutdated, ToolItem, SkillItem, type Catalog } from './catalog.js';
```

`run()`:
```ts
  const agentDir = defaultAgentDir();
  const term: Term = createTerm();
  let catalog: Catalog = loadCatalog(agentDir);
```
(заменить существующие `const catalog = loadCatalog(defaultAgentDir());` и локальный `const agentDir = defaultAgentDir();` в submitting-ветке — использовать внешний `agentDir`.)

Хелпер рядом с `launchPi`:
```ts
/** Запускает команду в print-режиме (piped stdio — без TTY-промптов). */
function runCmd(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (d: Buffer): void => { out += d; };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (e: Error) => resolve({ ok: false, output: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, output: out.trim() }));
  });
}
```

В `run()`, рядом с `twoColumns`:
```ts
  function reloadCatalog(): void {
    catalog = loadCatalog(agentDir);
    state = { ...state, catalog };
  }
```

В `dispatch(key)` — перед reducer'ом сохранить предыдущий view:
```ts
    const prevView = state.create?.view ?? null;
```

После существующих обработчиков (`submitting`, `deleting`) и до блока запуска (`sub === 'run'`) добавить, в этом порядке:
```ts
    if (state.create && state.create.view === 'updating') {
      state = { ...state, pkgCheck: 'idle' };
      const res = await runCmd('pi', ['update', '--extensions']);
      const message = res.ok ? 'Все расширения обновлены' : res.output || 'pi update завершилась с ошибкой';
      state = reducer(state, { type: 'update-result', ok: res.ok, message }, names, twoColumns());
      if (res.ok) reloadCatalog();
      statusMsg = message;
    }

    if (state.create && state.create.view === 'removing') {
      const name = state.create.removing;
      const source = name !== null ? catalog.packages.find((p) => p.name === name)?.source : undefined;
      const res = source !== undefined
        ? await runCmd('pi', ['remove', source])
        : { ok: false, output: 'Источник расширения не найден' };
      const message = res.ok ? `Расширение «${name}» удалено` : res.output || 'pi remove завершилась с ошибкой';
      state = reducer(state, { type: 'remove-result', ok: res.ok, message }, names, twoColumns());
      if (res.ok) reloadCatalog();
      statusMsg = message;
    }

    if (state.create && state.create.view === 'packages' && prevView !== 'packages') {
      state = { ...state, pkgCheck: 'checking' };
      void runCmd('npm', ['outdated', '--json', '--prefix', join(agentDir, 'npm')]).then((res) => {
        state = reducer(state, { type: 'updates-result', ok: res.ok, latest: parseOutdated(res.output) }, names, twoColumns());
        if (!res.ok) statusMsg = 'Не удалось проверить обновления';
        repaint();
      });
    }
```

`AGENTS.md`:
- Раздел «Клавиши» — добавить строку:
  `- X — удалить расширение (в списке «Расширения» формы, с подтверждением)`
- Раздел «Текущий статус» — в пункт про редактирование окружения дописать (отдельная строка списка):
  `- Управление расширениями в списке формы: маркеры обновлений (↑ версия / · / закреплено / локальный), инфо-панель в правой колонке, строка-кнопка «Обновить все» (pi update --extensions), X — удаление с подтверждением (pi remove).`

- [ ] **Step 2: Run build и тесты**

Run: `npm run build && npm test`
Expected: сборка без ошибок, все тесты PASS.

- [ ] **Step 3: Smoke-проверка в терминале (ручная, одноразовая)**

```bash
mkdir -p /tmp/pienv-smoke
npx tsx src/index.ts --root /tmp/pienv-smoke
```
В TUI: TAB до нужного места не нужен — Enter на «Создать» (или E на окружении), курсор на «Расширения» → Enter. Проверить глазами: строки с маркерами (`↑ версия` / `·`), справа панель (Источник/Версия/Обновление/описание), в конце строка «↑ Обновить все», внизу `X — удалить`; Esc назад. (Полный прогон `pi update`/`pi remove` руками не делать — это глобальные операции над real-агентом; покрывают reducer/render-тесты.)

- [ ] **Step 4: Commit**

```bash
git add src/run.ts AGENTS.md
git commit -m "feat: run — обновление/удаление расширений через pi CLI, проверка npm outdated, перезагрузка каталога; AGENTS.md"
```

---

## Self-Review

- **Spec coverage:** 4 пункта дизайна → Task 1 (данные: version/description), Task 2 (состояние: маркеры через данные, кнопка, X, confirmation), Task 3 (визуал: маркеры, панель, экраны), Task 4 (механика: npm outdated, pi update/remove, каталог). ✓
- **Placeholder scan:** код во всех steps дан полностью; «поправить фикстуры» указано с полным содержимым. ✓
- **Type consistency:** `UPDATE_ALL_ROW`, `PkgCheck`, `pkgLatest`, `removing`, `updates-result`/`update-result`/`remove-result` — одинаково в Tasks 1–4. ✓
- **Review Focus:** все 5 линий покрыты тестами в Tasks 2–3. ✓
- **Риски:** `npm outdated` требует сеть (обработано: `?` + статус); поздние async-результаты (обработано: reducer без view-gate, как в существующем submitting); `pi` в PATH (ошибка spawn → message в статус/панель).
