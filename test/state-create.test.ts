import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, freshCreate, freshEdit, type AppState, type ReducerCtx, type Catalog } from '../src/state.js';
import type { CatalogPkg } from '../src/catalog.js';

/** Контекст reducer: имена окружений + раскладка. */
const rc = (names: string[], two = true): ReducerCtx => ({ envNames: names, twoColumns: two });

const catalog: Catalog = {
  providers: [
    { name: 'cpp', models: [{ id: 'Bonsai-2' }, { id: 'Zed-1' }] },
    { name: 'openai', models: [{ id: 'gpt-4o' }] },
  ],
  tools: [{ name: 'searxng-search.ts', path: '/x/searxng-search.ts' }],
  packages: [
    { source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', version: '1.0.0', description: 'Пакет A', extensions: ['./index.ts'], skills: [] },
    { source: 'npm:pkg-b', name: 'pkg-b', path: '/p/b', version: '2.0.0', description: null, extensions: ['./exts'], skills: [] },
  ],
  skills: [{ name: 'own-skill', path: '/s/own' }],
  mcp: [],
};

function withCreate() {
  return { ...initialState(catalog), sub: 'create' as const, create: freshCreate() };
}

test('ввод имени: печатные символы, backspace, caret', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, rc([]));
  assert.equal(s.create!.name, 'prod');
  assert.equal(s.create!.caret, 4);
  s = reducer(s, 'backspace', rc([]));
  assert.equal(s.create!.name, 'pro');
  s = reducer(s, 'left', rc([]));
  s = reducer(s, 'left', rc([]));
  s = reducer(s, 'X', rc([]));
  assert.equal(s.create!.name, 'pXro');
  assert.equal(s.create!.caret, 2);
});

test('caret не выходит за границы имени', () => {
  let s = withCreate();
  s = reducer(s, 'a', rc([]));
  s = reducer(s, 'left', rc([]));
  s = reducer(s, 'left', rc([]));
  assert.equal(s.create!.caret, 0);
  s = reducer(s, 'right', rc([]));
  s = reducer(s, 'right', rc([]));
  s = reducer(s, 'right', rc([]));
  assert.equal(s.create!.caret, 1);
});

test('длина имени ограничена 40', () => {
  let s = withCreate();
  for (const ch of 'a'.repeat(45)) s = reducer(s, ch, rc([]));
  assert.equal(s.create!.name.length, 40);
});

test('навигация по форме и переход в списки', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([]));
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'providers');
  s = reducer(s, 'esc', rc([]));
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'down', rc([])); // tools
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'tools');
  s = reducer(s, 'esc', rc([]));
  s = reducer(s, 'down', rc([])); // packages
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'packages');
  s = reducer(s, 'esc', rc([]));
  s = reducer(s, 'down', rc([])); // skills
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'skills');
});

test('провайдер → модель в два шага', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([])); // providers
  assert.equal(s.create!.view, 'providers');
  s = reducer(s, 'enter', rc([])); // cpp
  assert.equal(s.create!.provider, 'cpp');
  assert.equal(s.create!.view, 'models');
  assert.equal(s.create!.cursor, 0);
  s = reducer(s, 'down', rc([])); // Zed-1
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.model, 'Zed-1');
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 1);
});

test('повторный выбор провайдера сбрасывает модель', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, 'enter', rc([])); // cpp
  s = reducer(s, 'esc', rc([])); // providers
  s = reducer(s, 'esc', rc([])); // form
  s = reducer(s, 'enter', rc([])); // providers again
  s = reducer(s, 'enter', rc([])); // cpp again
  assert.equal(s.create!.provider, null);
  assert.equal(s.create!.model, null);
  assert.equal(s.create!.view, 'form');
});

test('toggle инструментов/пакетов/скиллов по Space и Enter', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([])); // tools
  s = reducer(s, 'space', rc([]));
  assert.deepEqual(s.create!.tools, ['searxng-search.ts']);
  s = reducer(s, 'space', rc([]));
  assert.deepEqual(s.create!.tools, []);
  s = reducer(s, 'enter', rc([]));
  assert.deepEqual(s.create!.tools, ['searxng-search.ts']);
  s = reducer(s, 'esc', rc([]));
  s = reducer(s, 'down', rc([])); // packages
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, 'down', rc([])); // pkg-b
  s = reducer(s, 'enter', rc([]));
  assert.deepEqual(s.create!.packages, ['npm:pkg-b']);
  s = reducer(s, 'esc', rc([]));
  s = reducer(s, 'down', rc([])); // skills
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, 'space', rc([]));
  assert.deepEqual(s.create!.skills, ['own-skill']);
});

test('списки пустые — Enter/Space ничего не делают', () => {
  const s = { ...initialState({ ...catalog, tools: [] }), sub: 'create' as const, create: freshCreate() };
  let t = reducer(s, 'down', rc([]));
  t = reducer(t, 'down', rc([]));
  t = reducer(t, 'enter', rc([])); // tools (пусто)
  assert.equal(t.create!.view, 'tools');
  t = reducer(t, 'enter', rc([]));
  assert.deepEqual(t.create!.tools, []);
  t = reducer(t, 'esc', rc([]));
  assert.equal(t.create!.view, 'form');
});

test('списки: курсор зациклен', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([])); // packages (строка 3)
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, 'up', rc([]));
  assert.equal(s.create!.cursor, 2); // заходит на строку «Обновить все»
  s = reducer(s, 'down', rc([]));
  assert.equal(s.create!.cursor, 0);
});

test('отправка: валидное имя → submitting', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, rc([]));
  s = reducer(s, 'up', rc([])); // row 5 (зациклен)
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'submitting');
});

test('отправка: пустое имя → ошибка', () => {
  let s = withCreate();
  for (const ch of [6, 5, 4, 3, 2, 1]) s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'form');
  assert.match(s.create!.error!, /имя/i);
});

test('отправка: имя совпадает с существующим → ошибка', () => {
  let s = withCreate();
  for (const ch of 'env0') s = reducer(s, ch, rc([]));
  s = reducer(s, 'up', rc([])); // row 5
  s = reducer(s, 'enter', rc(['env0']));
  assert.match(s.create!.error!, /уже есть/i);
});

test('create-result: успех → done, ошибка → error', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, rc([]));
  s = reducer(s, 'up', rc([])); // row 5
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, { type: 'create-result', ok: false, message: 'Батя' }, rc([]));
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.error, 'Батя');
  s = reducer(s, 'enter', rc([])); // ещё раз
  s = reducer(s, { type: 'create-result', ok: true, message: '/root/prod' }, rc([]));
  assert.equal(s.create!.done, '/root/prod');
  assert.equal(s.create!.error, null);
  // «Готово» — Enter закрывает
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.sub, null);
  assert.equal(s.create, null);
});

test('ESC из формы создания закрывает суб-экран', () => {
  const s = withCreate();
  const next = reducer(s, 'esc', rc([]));
  assert.equal(next.sub, null);
  assert.equal(next.create, null);
});

test('ESC из submitting отменяет отправление', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, rc([]));
  s = reducer(s, 'up', rc([])); // row 5
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'submitting');
  s = reducer(s, 'esc', rc([]));
  assert.equal(s.create!.view, 'form');
});

test('ввод имени не влияет при курсоре вне строки имени', () => {
  let s = withCreate();
  s = reducer(s, 'down', rc([])); // row 1
  s = reducer(s, 'a', rc([]));
  assert.equal(s.create!.name, '');
});

function openPackages(s: AppState): AppState {
  let t = s;
  t = reducer(t, 'down', rc([]));
  t = reducer(t, 'down', rc([]));
  t = reducer(t, 'down', rc([]));
  t = reducer(t, 'enter', rc([]));
  assert.equal(t.create!.view, 'packages');
  return t;
}

test('packages: кнопка «Обновить все» в конце списка, Enter → updating, Esc назад', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', rc([])); // pkg-b
  s = reducer(s, 'down', rc([])); // кнопка
  assert.equal(s.create!.cursor, 2);
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'updating');
  s = reducer(s, 'esc', rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.cursor, 0);
});

test('packages: X → confirm-remove → removing; Esc отменяет', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'x', rc([]));
  assert.equal(s.create!.view, 'confirm-remove');
  assert.equal(s.create!.removing, 'pkg-a');
  s = reducer(s, 'esc', rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, null);
  s = reducer(s, 'X', rc([])); // верхний регистр тоже
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'removing');
  s = reducer(s, 'esc', rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, 'pkg-a'); // процесс идёт — имя храним до результата
});

test('packages: X на строке кнопки ничего не делает', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([])); // строка кнопки
  s = reducer(s, 'x', rc([]));
  assert.equal(s.create!.view, 'packages');
});

test('remove-result: ошибка → error, успех → пакет снят с отметок', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'enter', rc([])); // отметить pkg-a
  s = reducer(s, 'x', rc([]));
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, { type: 'remove-result', ok: false, message: 'нет сети' }, rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.removing, null);
  assert.deepEqual(s.create!.packages, ['npm:pkg-a']);
  assert.equal(s.create!.error, 'нет сети');
  s = reducer(s, 'x', rc([]));
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, { type: 'remove-result', ok: true, message: 'pkg-a' }, rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.cursor, 0);
  assert.equal(s.create!.removing, null);
  assert.deepEqual(s.create!.packages, []);
  assert.equal(s.create!.error, null);
});

test('поздний remove-result после Esc применяется безопасно', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'enter', rc([])); // pkg-a
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([])); // pkg-b
  s = reducer(s, 'up', rc([]));
  s = reducer(s, 'x', rc([]));
  s = reducer(s, 'enter', rc([]));
  s = reducer(s, 'esc', rc([])); // ушли, процесс ещё идёт
  s = reducer(s, { type: 'remove-result', ok: true, message: 'pkg-a' }, rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.deepEqual(s.create!.packages, ['npm:pkg-b']);
});

test('update-result: успех → к списку, ошибка → error', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'updating');
  s = reducer(s, { type: 'update-result', ok: false, message: 'нет сети' }, rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.equal(s.create!.error, 'нет сети');
});

test('updates-result scope=main: карта latest и статус проверки', () => {
  let s = withCreate();
  assert.equal(s.pkgCheck, 'idle');
  s = reducer(s, { type: 'updates-result', ok: true, latest: { 'pkg-a': '2.0.0' }, scope: 'main' }, rc([]));
  assert.equal(s.pkgCheck, 'done');
  assert.deepEqual(s.pkgLatest, { 'pkg-a': '2.0.0' });
  s = reducer(s, { type: 'updates-result', ok: false, latest: {}, scope: 'main' }, rc([]));
  assert.equal(s.pkgCheck, 'error');
  assert.deepEqual(s.pkgLatest, { 'pkg-a': '2.0.0' });
});

test('updates-result scope=create: карта latest и статус — в состояние формы', () => {
  let s = withCreate();
  s = reducer(s, { type: 'updates-result', ok: true, latest: { 'env-pkg': '2.0.0' }, scope: 'create' }, rc([]));
  assert.equal(s.create!.check, 'done');
  assert.deepEqual(s.create!.latest, { 'env-pkg': '2.0.0' });
  // верхний уровень не тронут
  assert.equal(s.pkgCheck, 'idle');
  assert.deepEqual(s.pkgLatest, {});
});

test('updates-result scope=create: без открытой формы — результат игнорируется', () => {
  const s = initialState(catalog);
  const next = reducer(s, { type: 'updates-result', ok: true, latest: { 'x': '1' }, scope: 'create' }, rc([]));
  assert.equal(next.create, null);
  assert.equal(next.pkgCheck, 'idle');
  assert.deepEqual(next.pkgLatest, {});
});

test('freshEdit: пакеты — источники, legacy-имя нормализуется, чужой остаётся', () => {
  const c = freshEdit('dev', { packages: ['npm:pkg-a', 'pkg-b', 'npm:env-only'] }, catalog);
  assert.deepEqual(c.packages, ['npm:pkg-a', 'npm:pkg-b', 'npm:env-only']);
  assert.equal(c.mode, 'edit');
  assert.equal(c.origName, 'dev');
});

test('freshEdit: коллизирующий скилл предмечается только по своему каталогу', () => {
  const skills = [{ name: 'dup', path: '/a/skills/dup' }, { name: 'pkg-b/dup', path: '/b/skills/dup' }];
  const both = freshEdit('dev', { skills: ['skills/dup', 'skills/pkg-b-dup'] }, { ...catalog, skills });
  assert.deepEqual(both.skills, ['dup', 'pkg-b/dup']);
  const off = freshEdit('dev', { skills: ['skills/dup'] }, { ...catalog, skills });
  assert.deepEqual(off.skills, ['dup']);
});

test('edit packages: строки env-only и кнопка «Установить» в конце', () => {
  let s = { ...initialState(catalog), sub: 'create' as const, create: freshEdit('dev', { packages: ['npm:env-only'] }, catalog) };
  s = openPackages(s);
  // строки: pkg-a(0), pkg-b(1), env-only(2), Обновить все(3), Установить(4)
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([]));
  s = reducer(s, 'down', rc([]));
  assert.equal(s.create!.cursor, 3);
  s = reducer(s, 'down', rc([]));
  assert.equal(s.create!.cursor, 4);
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'install');
  assert.equal(s.create!.installStatus, 'loading');
});

test('create packages: строки «Установить» нет', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', rc([])); // pkg-b
  s = reducer(s, 'down', rc([])); // «Обновить все»
  assert.equal(s.create!.cursor, 2);
  s = reducer(s, 'down', rc([])); // цикл — «Установить» нет
  assert.equal(s.create!.cursor, 0);
});

test('install: навигация, Enter → installing, результат ok → packages с sources', () => {
  const items: CatalogPkg[] = [
    { name: 'pi-a', types: ['extension'], downloads: 5, description: null, author: null },
    { name: 'pi-b', types: ['skill'], downloads: 9, description: null, author: null },
  ];
  let s = {
    ...initialState(catalog),
    sub: 'create' as const,
    create: { ...freshEdit('dev', {}, catalog), view: 'install' as const, installCatalog: items, installStatus: 'ready' as const },
  };
  s = reducer(s, 'down', rc([]));
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'installing');
  assert.equal(s.create!.installing, 'pi-b');
  s = reducer(s, { type: 'install-result', ok: true, message: 'npm:pi-b', sources: ['npm:env-only', 'npm:pi-b'] }, rc([]));
  assert.equal(s.create!.view, 'packages');
  assert.deepEqual(s.create!.packages, ['npm:env-only', 'npm:pi-b']);
  assert.equal(s.create!.cursor, 0);
  assert.equal(s.create!.installing, null);
});

test('install-result: ошибка → в install с сообщением', () => {
  const s = {
    ...initialState(catalog),
    sub: 'create' as const,
    create: { ...freshEdit('dev', {}, catalog), view: 'installing' as const, installing: 'pi-a' },
  };
  const t = reducer(s, { type: 'install-result', ok: false, message: 'нет сети' }, rc([]));
  assert.equal(t.create!.view, 'install');
  assert.equal(t.create!.error, 'нет сети');
  assert.equal(t.create!.installing, null);
});

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
  s = reducer(s, 'o', rc([]));
  assert.equal(s.create!.query, 'o');
  s = reducer(s, 'backspace', rc([]));
  assert.equal(s.create!.query, '');
  s = reducer(s, 'p', rc([])); // 'p' → [pi-a, pi-b]
  s = reducer(s, 'i', rc([]));
  s = reducer(s, 'down', rc([])); // курсор 1
  s = reducer(s, 'enter', rc([]));
  assert.equal(s.create!.view, 'installing');
  assert.equal(s.create!.installing, 'pi-b');
});
