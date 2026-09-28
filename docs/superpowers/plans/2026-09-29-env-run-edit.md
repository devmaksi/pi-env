# Запуск и редактирование окружений — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use supo-subagent-driven-development (recommended) or supo-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В pi-env запускается выбранное окружение (процесс `pi` с `PI_CODING_AGENT_DIR=<путь>` занимает терминал, по exit — возврат в TUI) и добавляется клавиша E — редактирование окружения (та же форма, что создание: предзаполнение, сохранение с синхронизацией extensions/skills, переименование, удаление окружения с подтверждением).

**Architecture:** Чистое ядро (state/create/render) расширяется, `run.ts` остаётся тонким слоем побочных эффектов: читает settings.json, запускает дочерний `pi` (stdio inherit, передача терминала через term.stop/start), вызывает updateEnvironment/deleteEnvironment и возвращает результаты в reducer синтетическими действиями по образцу `create-result`.

**Tech Stack:** Node.js ≥ 20, TypeScript (ESM, NodeNext), ноль runtime-зависимостей, node:test, child_process.spawn.

**Spec:** Дизайн согласован в чате (bounded-путь, без отдельного файла): (1) запуск — передача терминала дочернему `pi`, cwd = текущая рабочая директория, `PI_CODING_AGENT_DIR` = путь окружения, по exit возврат, ошибка spawn — в статус-строку; (2) редактирование — клавиша E, форма с mode 'edit': предзаполнение из settings.json (имя, модель, инструменты/пакеты/скиллы пересечением с каталогом main-агента), редактируемое имя с renameSync, «Сохранить» (sync: добавить/удалить только пункты каталога, чужие файлы не трогать), «Удалить» — 7-я строка формы только в edit-режиме, экран подтверждения (Enter — да, Esc — нет), после удаления выбор на соседнее окружение; (3) статус-строка «E — правка»; (4) AGENTS.md (клавиши, статус, дорожная карта) обновляются вместе.

## Global Constraints

- UI-тексты, сообщения и логи — на русском языке.
- Ноль runtime-зависимостей; только node:test для тестов.
- Вся логика без TTY — чистые функции, тестируемые node:test; терминальный слой тонкий.
- Изменение раскладки/клавиш — только вместе с тестами render/state и обновлением AGENTS.md.
- Короткие методы, информативные camelCase-имена; `ponytail:` — только для осознанных упрощений с указанием потолка.

## Review Focus

1. `pi` отсутствует в PATH → spawn-ошибка: статус-строка с текстом, терминал возвращается в raw-режим (term.start вызван), TUI живой. Проверка — вручную под pty (Task 4), в node:test запустить реального `pi` нельзя.
2. `pi` завершается с ненулевым кодом → возврат в список как при любом exit (кодов выходу не показываем). Зафиксировано решением: exit — это «пользователь закончил работу».
3. Ресайз терминала во время работы дочернего `pi` → после возврата раскладка пересчитывается (SIGWINCH перерегистрируется в term.start; перерисовка при следующей клавише).
4. Скилл в окружении с collision-суффиксом каталога (например `foo-2` при каталожном имени `foo`) → предзаполнение его не отмечает; сохранение без отметки удалит его. Редкий случай (коллизии имён скиллов main-агента); тест фиксирует текущее поведение (Task 2).
5. settings.json с абсолютным путём в extensions (вручную отредактирован) → файл не синхронизируется и не удаляется, но в форме не отображается. Тест (Task 1).

---

### Task 1: create.ts — readSettings, updateEnvironment, deleteEnvironment

**Files:**
- Modify: `src/create.ts`
- Test: `test/create.test.ts`

**Interfaces:**
- Consumes: `validateName`, `ToolItem`, `SkillItem`, `CreateRequest`, `CreateResult` (существующие).
- Produces:
  - `EnvSettings { defaultProvider?: string; defaultModel?: string; extensions?: string[]; skills?: string[]; packages?: string[] }`
  - `readSettings(envDir: string): EnvSettings | null`
  - `updateEnvironment(root: string, oldName: string, req: CreateRequest, allTools: ToolItem[], allSkills: SkillItem[]): CreateResult`
  - `deleteEnvironment(root: string, name: string): CreateResult`
  - `baseName(p: string): string` (уже есть, становится exported)

- [x] **Step 1: Write the failing tests**

Append to `test/create.test.ts` (imports дополнить: `readSettings, updateEnvironment, deleteEnvironment` из `../src/create.js`, `existsSync` в существующий импорт `node:fs`):

```ts
test('readSettings: нет файла — null', () => {
  const root = tmpDir();
  try {
    assert.equal(readSettings(join(root, 'nope')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSettings: битый JSON — null', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'env1'));
    writeFileSync(join(root, 'env1', 'settings.json'), '{oops');
    assert.equal(readSettings(join(root, 'env1')), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readSettings: валидный файл — поля', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'env1'));
    writeFileSync(join(root, 'env1', 'settings.json'),
      JSON.stringify({ defaultProvider: 'cpp', defaultModel: 'm1', packages: ['npm:a'], noise: 1 }));
    assert.deepEqual(readSettings(join(root, 'env1')),
      { defaultProvider: 'cpp', defaultModel: 'm1', packages: ['npm:a'] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: синхронизация — новое копируется, снятое удаляется, чужое остаётся', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    mkdirSync(join(agent, 'extensions'), { recursive: true });
    writeFileSync(join(agent, 'extensions', 't1.ts'), 'one');
    writeFileSync(join(agent, 'extensions', 't2.ts'), 'two');
    mkdirSync(join(agent, 'skills', 's1'), { recursive: true });
    writeFileSync(join(agent, 'skills', 's1', 'SKILL.md'), 'S1');
    mkdirSync(join(agent, 'skills', 's2'), { recursive: true });
    writeFileSync(join(agent, 'skills', 's2', 'SKILL.md'), 'S2');

    const envDir = join(root, 'env1');
    mkdirSync(join(envDir, 'extensions'), { recursive: true });
    mkdirSync(join(envDir, 'skills'), { recursive: true });
    writeFileSync(join(envDir, 'extensions', 't1.ts'), 'one');
    writeFileSync(join(envDir, 'extensions', 'alien.txt'), 'keep me');
    writeFileSync(join(envDir, 'skills', 's1', 'SKILL.md'), 'S1');
    writeFileSync(join(envDir, 'settings.json'), '{}');

    const res = updateEnvironment(root, 'env1', {
      name: 'env1',
      defaultProvider: 'cpp',
      defaultModel: 'm1',
      tools: [{ name: 't2.ts', path: join(agent, 'extensions', 't2.ts') }],
      skills: [{ name: 's2', path: join(agent, 'skills', 's2') }],
      packages: ['npm:a'],
    },
    [
      { name: 't1.ts', path: join(agent, 'extensions', 't1.ts') },
      { name: 't2.ts', path: join(agent, 'extensions', 't2.ts') },
    ],
    [
      { name: 's1', path: join(agent, 'skills', 's1') },
      { name: 's2', path: join(agent, 'skills', 's2') },
    ]);
    assert.equal(res.ok, true);

    assert.equal(existsSync(join(envDir, 'extensions', 't1.ts')), false);
    assert.equal(readFileSync(join(envDir, 'extensions', 't2.ts'), 'utf8'), 'two');
    assert.equal(existsSync(join(envDir, 'extensions', 'alien.txt')), true);
    assert.equal(existsSync(join(envDir, 'skills', 's1')), false);
    assert.equal(readFileSync(join(envDir, 'skills', 's2', 'SKILL.md'), 'utf8'), 'S2');

    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, 'cpp');
    assert.equal(settings.defaultModel, 'm1');
    assert.deepEqual(settings.extensions, ['extensions/alien.txt', 'extensions/t2.ts']);
    assert.deepEqual(settings.skills, ['skills/s2']);
    assert.deepEqual(settings.packages, ['npm:a']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('updateEnvironment: модель без провайдера — оба поля убираются', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'cpp', defaultModel: 'm1' }));
    const res = updateEnvironment(root, 'env1', { name: 'env1', defaultProvider: 'cpp' }, [], []);
    assert.equal(res.ok, true);
    const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
    assert.equal(settings.defaultProvider, undefined);
    assert.equal(settings.defaultModel, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: переименование каталога', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'old');
    mkdirSync(envDir, { recursive: true });
    writeFileSync(join(envDir, 'settings.json'), '{}');
    const res = updateEnvironment(root, 'old', { name: 'new' }, [], []);
    assert.equal(res.ok, true);
    assert.equal(existsSync(join(root, 'old')), false);
    assert.ok(existsSync(join(root, 'new', 'settings.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: новое имя занято — ошибка, каталог не тронут', () => {
  const root = tmpDir();
  try {
    mkdirSync(join(root, 'old'), { recursive: true });
    mkdirSync(join(root, 'new'), { recursive: true });
    const res = updateEnvironment(root, 'old', { name: 'new' }, [], []);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /уже есть/i);
    assert.ok(existsSync(join(root, 'old')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: окружение не найдено — ошибка', () => {
  const root = tmpDir();
  try {
    const res = updateEnvironment(root, 'nope', { name: 'nope' }, [], []);
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /не найдено/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('updateEnvironment: абсолютный путь в extensions не синхронизируется и не удаляется', () => {
  const root = tmpDir();
  const agent = tmpDir();
  try {
    const file = join(tmpdir(), 'pi-env-abs-' + Date.now() + '.ts');
    writeFileSync(file, 'abs');
    try {
      const envDir = join(root, 'env1');
      mkdirSync(join(envDir, 'extensions'), { recursive: true });
      writeFileSync(join(envDir, 'extensions', 'abs.ts'), 'abs');
      writeFileSync(join(envDir, 'settings.json'),
        JSON.stringify({ extensions: [file] }));
      const res = updateEnvironment(root, 'env1', { name: 'env1' }, [], []);
      assert.equal(res.ok, true);
      assert.ok(existsSync(join(envDir, 'extensions', 'abs.ts')));
      const settings = JSON.parse(readFileSync(join(envDir, 'settings.json'), 'utf8'));
      assert.deepEqual(settings.extensions, ['extensions/abs.ts']);
    } finally {
      rmSync(file, { force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(agent, { recursive: true, force: true });
  }
});

test('deleteEnvironment: каталог удаляется вместе с содержимым', () => {
  const root = tmpDir();
  try {
    const envDir = join(root, 'env1');
    mkdirSync(join(envDir, 'skills', 's1'), { recursive: true });
    writeFileSync(join(envDir, 'settings.json'), '{}');
    const res = deleteEnvironment(root, 'env1');
    assert.equal(res.ok, true);
    assert.equal(existsSync(envDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deleteEnvironment: не найдено — ошибка', () => {
  const root = tmpDir();
  try {
    const res = deleteEnvironment(root, 'nope');
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /не найдено/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/create.test.ts`
Expected: FAIL — `readSettings`, `updateEnvironment`, `deleteEnvironment` are not exported from `../src/create.js` (import error).

- [x] **Step 3: Implement in `src/create.ts`**

Imports: добавить `readFileSync, unlinkSync, renameSync, rmSync` в существующий импорт `node:fs`.

```ts
export interface EnvSettings {
  defaultProvider?: string;
  defaultModel?: string;
  extensions?: string[];
  skills?: string[];
  packages?: string[];
}

/** Читает settings.json окружения. null — файла нет или он бит. */
export function readSettings(envDir: string): EnvSettings | null {
  const p = join(envDir, 'settings.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const arr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const out: EnvSettings = {};
    const dp = str(raw.defaultProvider); if (dp !== undefined) out.defaultProvider = dp;
    const dm = str(raw.defaultModel); if (dm !== undefined) out.defaultModel = dm;
    const ex = arr(raw.extensions); if (ex !== undefined) out.extensions = ex;
    const sk = arr(raw.skills); if (sk !== undefined) out.skills = sk;
    const pk = arr(raw.packages); if (pk !== undefined) out.packages = pk;
    return out;
  } catch {
    return null;
  }
}

/**
 * Обновляет окружение <root>/<oldName>: переименовывает при смене имени,
 * синхронизирует extensions/ и skills/ по полному каталогу main-агента
 * (выбранное копируется, невыбранное среди пунктов каталога удаляется,
 * чужие файлы и каталоги не трогаются), переписывает settings.json.
 */
export function updateEnvironment(
  root: string,
  oldName: string,
  req: CreateRequest,
  allTools: ToolItem[],
  allSkills: SkillItem[],
): CreateResult {
  const invalid = validateName(req.name, []);
  if (invalid !== null) return { ok: false, error: invalid };
  const oldDir = join(root, oldName);
  if (!existsSync(oldDir)) return { ok: false, error: 'Окружение не найдено' };
  let envDir = oldDir;
  if (req.name !== oldName) {
    const newDir = join(root, req.name);
    if (existsSync(newDir)) return { ok: false, error: 'Окружение с таким именем уже есть' };
    try {
      renameSync(oldDir, newDir);
    } catch {
      return { ok: false, error: `Не удалось переименовать окружение в ${req.name}` };
    }
    envDir = newDir;
  }

  const selectedTools = new Set((req.tools ?? []).map((t) => baseName(t.path)));
  for (const t of allTools) {
    const file = join(envDir, 'extensions', t.name);
    if (selectedTools.has(t.name) && !existsSync(file)) {
      mkdirSync(join(envDir, 'extensions'), { recursive: true });
      copyFileSync(t.path, file);
    } else if (!selectedTools.has(t.name) && existsSync(file)) {
      unlinkSync(file);
    }
  }

  const selectedSkills = new Set((req.skills ?? []).map((s) => baseName(s.path)));
  for (const s of allSkills) {
    const dir = join(envDir, 'skills', s.name);
    if (selectedSkills.has(s.name) && !existsSync(dir)) {
      copyRecursive(s.path, dir);
    } else if (!selectedSkills.has(s.name) && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const settings: Record<string, unknown> = {};
  if (req.defaultProvider && req.defaultModel) {
    settings.defaultProvider = req.defaultProvider;
    settings.defaultModel = req.defaultModel;
  }
  const extDir = join(envDir, 'extensions');
  const extFiles = existsSync(extDir)
    ? readdirSync(extDir).filter((f) => statSync(join(extDir, f)).isFile())
    : [];
  if (extFiles.length > 0) settings.extensions = extFiles.sort().map((f) => `extensions/${f}`);
  const skillDir = join(envDir, 'skills');
  const skillDirs = existsSync(skillDir)
    ? readdirSync(skillDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  if (skillDirs.length > 0) settings.skills = skillDirs.sort().map((d) => `skills/${d}`);
  const packages = uniqueStrings(req.packages ?? []);
  if (packages.length > 0) settings.packages = packages;
  writeFileSync(join(envDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, path: envDir };
}

/** Удаляет каталог окружения <root>/<name> вместе с содержимым. */
export function deleteEnvironment(root: string, name: string): CreateResult {
  const envDir = join(root, name);
  if (!existsSync(envDir)) return { ok: false, error: 'Окружение не найдено' };
  try {
    rmSync(envDir, { recursive: true, force: true });
  } catch {
    return { ok: false, error: `Не удалось удалить окружение ${name}` };
  }
  return { ok: true, path: envDir };
}
```

`baseName` в `create.ts` сделать `export function baseName` (без изменения тела).

- [x] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/create.test.ts`
Expected: PASS (все тесты файла, включая прежние).

- [x] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (0 fail).

- [x] **Step 6: Commit**

```bash
git add src/create.ts test/create.test.ts
git commit -m "feat: create.ts — readSettings, updateEnvironment (синхронизация, rename), deleteEnvironment"
```

---

### Task 2: state.ts — режим редактирования, подтверждения, run-result

**Files:**
- Modify: `src/state.ts`
- Test: `test/state.test.ts`

**Interfaces:**
- Consumes: `validateName`, `baseName`, `EnvSettings` (Task 1); существующие `Catalog`, `CreateState`, `reducer`.
- Produces:
  - `CreateView` += `'confirm-delete' | 'deleting'`
  - `CreateState` += `mode: 'create' | 'edit'`, `origName: string | null`
  - `formRows(mode: 'create' | 'edit'): number` (6 / 7)
  - `freshEdit(name: string, settings: EnvSettings, catalog: Catalog): CreateState`
  - `Action` += `{ type: 'edit-start'; name: string; settings: EnvSettings }`, `{ type: 'run-result'; ok: boolean }`, `{ type: 'delete-result'; ok: boolean; message: string }`
  - reducer: `edit-start` (только envs + без суб-экрана), `run-result` (sub → null), `delete-result` (ok — закрыть форму; ошибка — в форму с `error`)

- [x] **Step 1: Write the failing tests**

Append to `test/state.test.ts` (import дополнить: `freshCreate` и `type AppState` из `../src/state.js`; `EnvSettings` не нужен прямо — литералы):

```ts
const catalog2 = {
  providers: [{ name: 'cpp', models: [{ id: 'Bonsai-2' }] }],
  tools: [{ name: 'searxng.ts', path: '/a/extensions/searxng.ts' }],
  packages: [{ source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', extensions: [], skills: [] }],
  skills: [
    { name: 'own-skill', path: '/s/own-skill' },
    { name: 'zzz', path: '/s/zzz' },
  ],
};

test('edit-start: форма предзаполняется из settings', () => {
  const s = { ...initialState(catalog2), selected: 0 };
  const next = reducer(s, {
    type: 'edit-start',
    name: 'dev',
    settings: {
      defaultProvider: 'cpp',
      defaultModel: 'Bonsai-2',
      extensions: ['extensions/searxng.ts'],
      packages: ['npm:pkg-a'],
      skills: ['skills/own-skill'],
    },
  }, envs(1), true);
  assert.equal(next.sub, 'create');
  const c = next.create!;
  assert.equal(c.mode, 'edit');
  assert.equal(c.name, 'dev');
  assert.equal(c.origName, 'dev');
  assert.equal(c.caret, 3);
  assert.equal(c.provider, 'cpp');
  assert.equal(c.model, 'Bonsai-2');
  assert.deepEqual(c.tools, ['searxng.ts']);
  assert.deepEqual(c.packages, ['pkg-a']);
  assert.deepEqual(c.skills, ['own-skill']);
  assert.equal(c.view, 'form');
});

test('edit-start: collision-суффикс скилла не отмечается', () => {
  const s = { ...initialState(catalog2), selected: 0 };
  const next = reducer(s, {
    type: 'edit-start',
    name: 'dev',
    settings: { skills: ['skills/own-skill-2'] },
  }, envs(1), true);
  assert.deepEqual(next.create!.skills, []);
});

test('edit-start: игнорируется при открытом суб-экране', () => {
  const s = { ...initialState(catalog2), sub: 'create' as const, create: freshCreate() };
  const next = reducer(s, { type: 'edit-start', name: 'dev', settings: {} }, envs(1), true);
  assert.deepEqual(next, s);
});

function editState(name = 'env0', cursor = 5): AppState {
  let s = { ...initialState(catalog2), selected: 0 };
  s = reducer(s, { type: 'edit-start', name, settings: {} }, envs(2), true);
  for (let i = 0; i < cursor; i++) s = reducer(s, 'down', envs(2), true);
  return s;
}

test('edit: сохранение с неизменённым именем — без коллизии с собой', () => {
  const s = editState('env0', 5);
  const next = reducer(s, 'enter', envs(2), true);
  assert.equal(next.create!.view, 'submitting');
});

test('edit: переименование в занятое имя — ошибка', () => {
  const s = editState('env0', 0);
  const b = reducer(s, 'backspace', envs(2), true); // env
  const t = reducer(b, '1', envs(2), true); // env1
  assert.equal(t.create!.name, 'env1');
  let s2 = t;
  for (let i = 0; i < 5; i++) s2 = reducer(s2, 'down', envs(2), true);
  s2 = reducer(s2, 'enter', envs(2), true);
  assert.equal(s2.create!.error, 'Окружение с таким именем уже есть');
});

test('edit: курсор 6 — Удалить → confirm-delete, Esc — в форму, Enter → deleting', () => {
  let s = editState('env0', 6);
  s = reducer(s, 'enter', envs(2), true);
  assert.equal(s.create!.view, 'confirm-delete');
  s = reducer(s, 'esc', envs(2), true);
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 6);
  s = reducer(s, 'enter', envs(2), true);
  assert.equal(s.create!.view, 'confirm-delete');
  s = reducer(s, 'enter', envs(2), true);
  assert.equal(s.create!.view, 'deleting');
});

test('delete-result: ok — форма закрывается, ошибка — в форму', () => {
  const s = editState('env0', 6);
  const del = reducer(reducer(s, 'enter', envs(2), true), 'enter', envs(2), true);
  assert.equal(del.create!.view, 'deleting');
  const ok = reducer(del, { type: 'delete-result', ok: true, message: 'env0' }, envs(2), true);
  assert.equal(ok.sub, null);
  assert.equal(ok.create, null);
  const fail = reducer(del, { type: 'delete-result', ok: false, message: 'Не удалось удалить окружение env0' }, envs(2), true);
  assert.equal(fail.create!.view, 'form');
  assert.equal(fail.create!.error, 'Не удалось удалить окружение env0');
});

test('run-result: sub сбрасывается в null', () => {
  const s = { ...initialState(), sub: 'run' as const };
  assert.equal(reducer(s, { type: 'run-result', ok: true }, envs(2), true).sub, null);
});

test('edit: курсор цикла на 7 строках', () => {
  const s = editState('env0', 6);
  assert.equal(reducer(s, 'down', envs(2), true).create!.cursor, 0);
  assert.equal(reducer(s, 'up', envs(2), true).create!.cursor, 5);
});
```

(Вверху файла добавить `import type { AppState } from '../src/state.js';` к существующему импорту, если ещё не импортирован.)

- [x] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/state.test.ts`
Expected: FAIL — `freshEdit` не экспортируется / `edit-start` действие не обрабатывается (тесты падают с неверными значениями).

- [x] **Step 3: Implement in `src/state.ts`**

1. Импорт: `import { validateName, baseName, type EnvSettings } from './create.js';`
2. `CreateView` += `'confirm-delete' | 'deleting'`.
3. `CreateState`: добавить `mode: 'create' | 'edit';` и `origName: string | null;`.
4. `freshCreate()`: добавить `mode: 'create', origName: null,`.
5. Константа: `export const FORM_ROWS = 6;` оставить, добавить:

```ts
/** Число строк формы: в edit-режиме добавляется «Удалить». */
export function formRows(mode: 'create' | 'edit'): number {
  return mode === 'edit' ? FORM_ROWS + 1 : FORM_ROWS;
}
```

6. `Action`:

```ts
export type Action =
  | Key
  | { type: 'create-result'; ok: boolean; message: string }
  | { type: 'edit-start'; name: string; settings: EnvSettings }
  | { type: 'run-result'; ok: boolean }
  | { type: 'delete-result'; ok: boolean; message: string };
```

7. `freshEdit`:

```ts
/** Чистая форма редактирования: предзаполнение из settings окружения. */
export function freshEdit(name: string, settings: EnvSettings, catalog: Catalog): CreateState {
  const ext = settings.extensions ?? [];
  const sk = settings.skills ?? [];
  return {
    mode: 'edit',
    origName: name,
    name,
    caret: name.length,
    cursor: 0,
    provider: settings.defaultProvider ?? null,
    model: settings.defaultModel ?? null,
    tools: catalog.tools.filter((t) => ext.includes(`extensions/${t.name}`)).map((t) => t.name),
    packages: catalog.packages.filter((p) => (settings.packages ?? []).includes(p.name)).map((p) => p.name),
    skills: catalog.skills.filter((s) => {
      const base = baseName(s.path);
      return sk.includes(`skills/${base}`) || sk.includes(`skills/${s.name}`);
    }).map((s) => s.name),
    view: 'form',
    error: null,
    done: null,
  };
}
```

8. reducer — после блока `ctrlc`, до блока `create`:

```ts
  if (typeof action === 'object') {
    if (action.type === 'edit-start') {
      if (state.sub !== null || state.tab !== 'envs') return state;
      return { ...state, sub: 'create', create: freshEdit(action.name, action.settings, state.catalog) };
    }
    if (action.type === 'run-result') return { ...state, sub: null };
  }
```

9. `createReducer` — внутри существующей проверки `typeof action === 'object'` добавить ветку:

```ts
    if (action.type === 'delete-result') {
      if (action.ok) return null; // закрыть форму — назад к списку
      return { ...c, view: 'form', cursor: formRows(c.mode) - 1, error: action.message };
    }
```

и в `switch (c.view)` добавить:

```ts
    case 'confirm-delete':
      if (action === 'esc') return { ...c, view: 'form', cursor: formRows(c.mode) - 1 };
      if (action === 'enter') return { ...c, view: 'deleting' };
      return c;
    case 'deleting':
      return action === 'esc' ? { ...c, view: 'form' } : c;
```

10. `formReducer` — `const rows = formRows(c.mode);` вместо `FORM_ROWS` (в двух местах: wrap cursor), и блок enter:

```ts
  if (action === 'enter') {
    if (c.done !== null) return null; // «Готово»
    if (c.cursor === 1) return { ...c, view: 'providers', cursor: 0 };
    if (c.cursor === 2) return { ...c, view: 'tools', cursor: 0 };
    if (c.cursor === 3) return { ...c, view: 'packages', cursor: 0 };
    if (c.cursor === 4) return { ...c, view: 'skills', cursor: 0 };
    if (c.cursor === 5) {
      const others = c.mode === 'edit' ? envNames.filter((n) => n !== c.origName) : envNames;
      const err = validateName(c.name, others);
      if (err !== null) return { ...c, error: err };
      return { ...c, view: 'submitting' };
    }
    if (c.cursor === 6 && c.mode === 'edit') return { ...c, view: 'confirm-delete' };
    return c;
  }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/state.test.ts`
Expected: PASS (весь файл).

- [x] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (0 fail).

- [x] **Step 6: Commit**

```bash
git add src/state.ts test/state.test.ts
git commit -m "feat: state — режим редактирования (edit-start, сохранение/переименование), подтверждение удаления, run-result"
```

---

### Task 3: render.ts — форма редактирования, экраны подтверждения, легенда

**Files:**
- Modify: `src/render.ts`
- Test: `test/render-create.test.ts`
- Modify: `test/render.test.ts` (замена старого теста «суб-экран запуска» — суб-экран больше не существует)

**Interfaces:**
- Consumes: `CreateState.mode/origName`, `CreateView 'confirm-delete' | 'deleting'` (Task 2).
- Produces: визуал — форма edit (7 строк: «Сохранить», «Удалить»), экраны «Удалить окружение «X»?» / «Удаление…», «✓ Обновлено:», статус-строка с «E — правка», правая панель списка окружений с подсказкой «E — редактировать». Суб-экран «Запуск окружения … — этап 2» удаляется.

- [x] **Step 1: Write the failing tests**

Append to `test/render-create.test.ts`:

```ts
function editState(over: Partial<AppState['create']> = {}): AppState {
  return { ...initialState(catalog), sub: 'create', create: { ...freshCreate(), mode: 'edit' as const, origName: 'dev', name: 'dev', ...over } };
}

test('форма edit: 7 строк — Сохранить и Удалить', () => {
  const s = render({ state: editState(), envs, width: 62, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Сохранить'));
  assert.ok(s.includes('Удалить'));
  assert.ok(!s.includes('Создать'));
});

test('форма create: строки Удалить/Сохранить нет', () => {
  const s = render({ state: createState(), envs, width: 62, height: 12, root: '/root', useColor: false, status: null });
  assert.ok(!s.includes('Удалить'));
  assert.ok(!s.includes('Сохранить'));
  assert.ok(s.includes('Создать'));
});

test('confirm-delete: вопрос и подсказки', () => {
  const s = render({ state: editState({ view: 'confirm-delete' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удалить окружение «dev»?'));
  assert.ok(s.includes('Enter — подтвердить'));
  assert.ok(s.includes('Esc — отмена'));
});

test('deleting: пометка процесса', () => {
  const s = render({ state: editState({ view: 'deleting' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Удаление…'));
});

test('edit: после сохранения — Обновлено, не Создано', () => {
  const s = render({ state: editState({ done: '/root/dev' }), envs, width: 62, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('Обновлено: /root/dev'));
  assert.ok(!s.includes('Создано'));
});

test('статус-строка: подсказка E — правка', () => {
  const s = render({ state: initialState(catalog), envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('E — правка'));
});

test('инфо-панель окружения: подсказка E — редактировать', () => {
  const s = render({ state: initialState(catalog), envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(s.includes('E — редактировать'));
});

test('суб-экран запуска больше не рендерится', () => {
  const s = render({ state: { ...initialState(catalog), sub: 'run' as const }, envs, width: 80, height: 10, root: '/root', useColor: false, status: null });
  assert.ok(!s.includes('Запуск окружения'));
});
```
В `test/render.test.ts` заменить существующий тест «суб-экран запуска» (строки 50–53) на:

```ts
test('суб-экран запуска больше не рендерится', () => {
  const s = render({ state: { ...initialState(), sub: 'run' }, envs, width: 62, height: 10, ...base });
  assert.ok(!s.includes('Запуск окружения'));
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/render-create.test.ts`
Expected: FAIL (нет «Сохранить»/«Удалить», есть «Запуск окружения», нет «E — правка»).

- [x] **Step 3: Implement in `src/render.ts`**

1. `twoCol`: убрать `&& state.sub !== 'run'` → `const twoCol = L.twoColumns && state.tab !== 'about';`
2. Удалить блок `if (state.sub === 'run') { ... }` (рамка «Запуск окружения») вместе с его `else`-веткой: содержимое `else` становится телом основного блока (переименовать: просто убрать внешний `if/else`, сохранив код `else`).
3. Форма (ветка `cr.view === 'form'`): строки:

```ts
        const rows = [
          'Имя: ' + caret,
          'Модель: ' + model,
          'Свои инструменты: ' + cr.tools.length,
          'Расширения: ' + cr.packages.length,
          'Скиллы: ' + cr.skills.length,
          cr.done !== null ? 'Готово' : cr.mode === 'edit' ? 'Сохранить' : 'Создать',
        ];
        if (cr.mode === 'edit' && cr.done === null) rows.push('Удалить');
```

строка «Создано»:

```ts
        if (cr.done !== null) right.push(c(ANSI.bold, useColor) + (cr.mode === 'edit' ? '✓ Обновлено: ' : '✓ Создано: ') + cr.done + c(ANSI.reset, useColor));
```

4. Новые ветки view (между `'form'` и `'submitting'`):

```ts
      } else if (cr.view === 'confirm-delete') {
        left.push(c(ANSI.bold, useColor) + 'Удалить окружение «' + cr.name + '»?' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Enter — подтвердить' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
      } else if (cr.view === 'deleting') {
        left.push(c(ANSI.dim, useColor) + 'Удаление…' + c(ANSI.reset, useColor));
        right.push(c(ANSI.dim, useColor) + 'Esc — отмена' + c(ANSI.reset, useColor));
```

5. Инфо-панель окружения (ветка `state.selected < envs.length`): добавить строку подсказки:

```ts
        right.push(c(ANSI.dim, useColor) + 'E — редактировать' + c(ANSI.reset, useColor));
```

6. Статус-строка: `const legend2 = 'Space toggle  E — правка  Esc назад/выход';`

- [x] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/render-create.test.ts test/render.test.ts`
Expected: PASS.

- [x] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS (0 fail).

- [x] **Step 6: Commit**

```bash
git add src/render.ts test/render-create.test.ts test/render.test.ts
git commit -m "feat: render — форма редактирования (Сохранить/Удалить), экраны подтверждения, легенда E"
```

---

### Task 4: run.ts — запуск pi, перехват E, AGENTS.md

**Files:**
- Modify: `src/run.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: `readSettings`, `updateEnvironment`, `deleteEnvironment` (Task 1); `edit-start`/`run-result`/`delete-result` (Task 2); `Environment`, `Term.stop/start` (существующие).
- Produces: поведение: Enter на окружении → дочерний `pi` (cwd = process.cwd(), `PI_CODING_AGENT_DIR` = путь окружения, stdio inherit) и возврат; E на окружении → форма редактирования; сохранение → updateEnvironment (rename включительно); подтверждённое удаление → deleteEnvironment + выбор на соседнее; ошибка spawn → статус-строка.

- [ ] **Step 1: Implement in `src/run.ts`**

1. Импорт: `import { spawn } from 'node:child_process';` и добавить в импорт create.js `readSettings, updateEnvironment, deleteEnvironment`.
2. В `run()`: `let statusMsg: string | null = null;` рядом с `let state`.
3. `dispatch` — async, новые ветки:

```ts
  async function dispatch(key: Key): void {
    statusMsg = null;
    const { envs } = load();
    const names = envs.map((e) => e.name);
    if (key === 'e' && state.tab === 'envs' && state.sub === null && state.selected < envs.length) {
      const settings = readSettings(envs[state.selected].path) ?? {};
      state = reducer(state, { type: 'edit-start', name: envs[state.selected].name, settings }, names, twoColumns());
    } else {
      state = reducer(state, key, names, twoColumns());
    }

    if (state.create && state.create.view === 'submitting') {
      const cr = state.create;
      const req: CreateRequest = {
        name: cr.name,
        defaultProvider: cr.provider ?? undefined,
        defaultModel: cr.model ?? undefined,
        tools: cr.tools
          .map((n) => catalog.tools.find((t) => t.name === n))
          .filter((t): t is ToolItem => t !== undefined),
        skills: cr.skills
          .map((n) => catalog.skills.find((s) => s.name === n))
          .filter((s): s is SkillItem => s !== undefined),
        packages: cr.packages,
      };
      const res = cr.mode === 'edit'
        ? updateEnvironment(root, cr.origName ?? cr.name, req, catalog.tools, catalog.skills)
        : createEnvironment(root, req);
      const message = res.ok ? res.path : res.error;
      state = reducer(state, { type: 'create-result', ok: res.ok, message }, names, twoColumns());
    }

    if (state.create && state.create.view === 'deleting') {
      const name = state.create.name;
      const res = deleteEnvironment(root, name);
      state = reducer(state, { type: 'delete-result', ok: res.ok, message: res.ok ? name : res.error }, names, twoColumns());
      if (res.ok) {
        const n = load().envs.length;
        state = { ...state, selected: Math.max(0, Math.min(state.selected, n - 1)) };
      }
    }

    if (state.sub === 'run' && state.tab === 'envs' && state.selected < envs.length) {
      const env = envs[state.selected];
      const res = await launchPi(term, env);
      state = reducer(state, { type: 'run-result', ok: res.ok }, names, twoColumns());
      if (!res.ok) statusMsg = res.message;
    }
  }
```

(Старая ветка `if (state.create && state.create.view === 'submitting') { ... }` заменяется приведённой; вызов в цикле: `await dispatch(key as Key);`)

4. `repaint`: `status: statusMsg ?? status,`.
5. Новая функция в модуле:

```ts
/**
 * Запускает pi в окружении, передав ему терминал.
 * ponytail: кодов выхода не различаем — любой exit означает возврат в TUI.
 */
function launchPi(term: Term, env: Environment): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    term.stop();
    let done = false;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      term.start();
      resolve({ ok, message });
    };
    const child = spawn('pi', [], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: env.path },
      stdio: 'inherit',
    });
    child.on('error', (e: Error) => finish(false, `Не удалось запустить pi: ${e.message}`));
    child.on('exit', () => finish(true, ''));
  });
}
```

- [ ] **Step 2: Run the whole suite (чистое ядро не задето, но проверяем)**

Run: `npm test`
Expected: PASS (0 fail).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: компиляция без ошибок.

- [ ] **Step 4: Ручная E2E под pty**

Сценарий (запускать из рабочей директории проекта, root — временный):
1. `npx tsx src/index.ts --root /tmp/pi-env-e2e` (создать `/tmp/pi-env-e2e/dev` с `settings.json` и `extensions/x.ts` вручную) — список показывает `dev`, в инфо-панели подсказка «E — редактировать».
2. `e` → форма с именем `dev`, предзаполненными инструментами; `↓`×5 → «Сохранить», `Enter` → «✓ Обновлено: …».
3. В форме: `↑`×5 + ввод нового имени + `Enter` на «Сохранить» → каталог переименован (проверить `ls /tmp/pi-env-e2e`).
4. `e` → `↓`×6 → «Удалить», `Enter` → «Удалить окружение «…»?», `Enter` → список без окружения; `Esc` на подтверждении → возврат в форму.
5. Создать окружение, `Enter` → запускается реальный `pi` с `PI_CODING_AGENT_DIR=/tmp/pi-env-e2e/<имя>` (проверить, что pi стартует и видит каталог); выход из `pi` (Ctrl+D / quit) → возврат в TUI со списком.
6. Запуск при отсутствии `pi` в PATH (`PATH=/usr/bin npx tsx src/index.ts --root /tmp/pi-env-e2e` — если `pi` не в /usr/bin) → статус-строка «Не удалось запустить pi: …», TUI жив.

- [ ] **Step 5: Обновить AGENTS.md**

1. Раздел «Текущий статус»: в «Работает» добавить «запуск окружения (дочерний `pi` с передачей терминала), редактирование окружения (E: модель, инструменты, пакеты, скиллы, переименование, удаление с подтверждением)»; строку «Заглушки: запуск окружения, полные настройки — этап 2» заменить на «Заглушки: полные настройки — этап 2».
2. Раздел «Клавиши»: Enter — «окружение → запуск, «Создать» → форма создания; в списках формы — выбрать пункт»; добавить строку: `E — редактировать выбранное окружение (форма с предзаполнением: имя, модель, инструменты, пакеты, скиллы; сохранение, переименование, удаление с подтверждением)`.
3. Раздел «Структура»: строку `src/create.ts — validateName, createEnvironment` расширить: `src/create.ts — validateName, createEnvironment, readSettings, updateEnvironment, deleteEnvironment`.
4. Раздел «Дорожная карта»: «Этап 2: запуск окружения (spawn `pi` с `PI_CODING_AGENT_DIR`), редактирование окружений. Создание — готово.» заменить на «Этап 2: готов (запуск, создание, редактирование с переименованием и удалением).»; «Этап 3+: полные настройки, удаление окружений, детальная инфо-панель.» — убрать «удаление окружений» (уже сделано).

- [ ] **Step 6: Commit**

```bash
git add src/run.ts AGENTS.md
git commit -m "feat: run — запуск окружения (spawn pi с передачей терминала), клавиша E редактирования; AGENTS.md"
```
