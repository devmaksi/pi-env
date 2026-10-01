import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, freshCreate, freshEdit, type AppState, type Catalog } from '../src/state.js';
import type { CatalogPkg } from '../src/catalog.js';

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
};

function withCreate() {
  return { ...initialState(catalog), sub: 'create' as const, create: freshCreate() };
}

test('ввод имени: печатные символы, backspace, caret', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, [], true);
  assert.equal(s.create!.name, 'prod');
  assert.equal(s.create!.caret, 4);
  s = reducer(s, 'backspace', [], true);
  assert.equal(s.create!.name, 'pro');
  s = reducer(s, 'left', [], true);
  s = reducer(s, 'left', [], true);
  s = reducer(s, 'X', [], true);
  assert.equal(s.create!.name, 'pXro');
  assert.equal(s.create!.caret, 2);
});

test('caret не выходит за границы имени', () => {
  let s = withCreate();
  s = reducer(s, 'a', [], true);
  s = reducer(s, 'left', [], true);
  s = reducer(s, 'left', [], true);
  assert.equal(s.create!.caret, 0);
  s = reducer(s, 'right', [], true);
  s = reducer(s, 'right', [], true);
  s = reducer(s, 'right', [], true);
  assert.equal(s.create!.caret, 1);
});

test('длина имени ограничена 40', () => {
  let s = withCreate();
  for (const ch of 'a'.repeat(45)) s = reducer(s, ch, [], true);
  assert.equal(s.create!.name.length, 40);
});

test('навигация по форме и переход в списки', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true);
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'providers');
  s = reducer(s, 'esc', [], true);
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'down', [], true); // tools
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'tools');
  s = reducer(s, 'esc', [], true);
  s = reducer(s, 'down', [], true); // packages
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'packages');
  s = reducer(s, 'esc', [], true);
  s = reducer(s, 'down', [], true); // skills
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'skills');
});

test('провайдер → модель в два шага', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true); // providers
  assert.equal(s.create!.view, 'providers');
  s = reducer(s, 'enter', [], true); // cpp
  assert.equal(s.create!.provider, 'cpp');
  assert.equal(s.create!.view, 'models');
  assert.equal(s.create!.cursor, 0);
  s = reducer(s, 'down', [], true); // Zed-1
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.model, 'Zed-1');
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.cursor, 1);
});

test('повторный выбор провайдера сбрасывает модель', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true);
  s = reducer(s, 'enter', [], true); // cpp
  s = reducer(s, 'esc', [], true); // providers
  s = reducer(s, 'esc', [], true); // form
  s = reducer(s, 'enter', [], true); // providers again
  s = reducer(s, 'enter', [], true); // cpp again
  assert.equal(s.create!.provider, null);
  assert.equal(s.create!.model, null);
  assert.equal(s.create!.view, 'form');
});

test('toggle инструментов/пакетов/скиллов по Space и Enter', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true); // tools
  s = reducer(s, 'space', [], true);
  assert.deepEqual(s.create!.tools, ['searxng-search.ts']);
  s = reducer(s, 'space', [], true);
  assert.deepEqual(s.create!.tools, []);
  s = reducer(s, 'enter', [], true);
  assert.deepEqual(s.create!.tools, ['searxng-search.ts']);
  s = reducer(s, 'esc', [], true);
  s = reducer(s, 'down', [], true); // packages
  s = reducer(s, 'enter', [], true);
  s = reducer(s, 'down', [], true); // pkg-b
  s = reducer(s, 'enter', [], true);
  assert.deepEqual(s.create!.packages, ['npm:pkg-b']);
  s = reducer(s, 'esc', [], true);
  s = reducer(s, 'down', [], true); // skills
  s = reducer(s, 'enter', [], true);
  s = reducer(s, 'space', [], true);
  assert.deepEqual(s.create!.skills, ['own-skill']);
});

test('списки пустые — Enter/Space ничего не делают', () => {
  const s = { ...initialState({ ...catalog, tools: [] }), sub: 'create' as const, create: freshCreate() };
  let t = reducer(s, 'down', [], true);
  t = reducer(t, 'down', [], true);
  t = reducer(t, 'enter', [], true); // tools (пусто)
  assert.equal(t.create!.view, 'tools');
  t = reducer(t, 'enter', [], true);
  assert.deepEqual(t.create!.tools, []);
  t = reducer(t, 'esc', [], true);
  assert.equal(t.create!.view, 'form');
});

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

test('отправка: валидное имя → submitting', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, [], true);
  s = reducer(s, 'up', [], true); // row 5 (зациклен)
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'submitting');
});

test('отправка: пустое имя → ошибка', () => {
  let s = withCreate();
  for (const ch of [5, 4, 3, 2, 1]) s = reducer(s, 'down', [], true);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'form');
  assert.match(s.create!.error!, /имя/i);
});

test('отправка: имя совпадает с существующим → ошибка', () => {
  let s = withCreate();
  for (const ch of 'env0') s = reducer(s, ch, [], true);
  s = reducer(s, 'up', [], true); // row 5
  s = reducer(s, 'enter', ['env0'], true);
  assert.match(s.create!.error!, /уже есть/i);
});

test('create-result: успех → done, ошибка → error', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, [], true);
  s = reducer(s, 'up', [], true); // row 5
  s = reducer(s, 'enter', [], true);
  s = reducer(s, { type: 'create-result', ok: false, message: 'Батя' }, [], true);
  assert.equal(s.create!.view, 'form');
  assert.equal(s.create!.error, 'Батя');
  s = reducer(s, 'enter', [], true); // ещё раз
  s = reducer(s, { type: 'create-result', ok: true, message: '/root/prod' }, [], true);
  assert.equal(s.create!.done, '/root/prod');
  assert.equal(s.create!.error, null);
  // «Готово» — Enter закрывает
  s = reducer(s, 'enter', [], true);
  assert.equal(s.sub, null);
  assert.equal(s.create, null);
});

test('ESC из формы создания закрывает суб-экран', () => {
  const s = withCreate();
  const next = reducer(s, 'esc', [], true);
  assert.equal(next.sub, null);
  assert.equal(next.create, null);
});

test('ESC из submitting отменяет отправление', () => {
  let s = withCreate();
  for (const ch of 'prod') s = reducer(s, ch, [], true);
  s = reducer(s, 'up', [], true); // row 5
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'submitting');
  s = reducer(s, 'esc', [], true);
  assert.equal(s.create!.view, 'form');
});

test('ввод имени не влияет при курсоре вне строки имени', () => {
  let s = withCreate();
  s = reducer(s, 'down', [], true); // row 1
  s = reducer(s, 'a', [], true);
  assert.equal(s.create!.name, '');
});

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
  assert.deepEqual(s.create!.packages, ['npm:pkg-a']);
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
  assert.deepEqual(s.create!.packages, ['npm:pkg-b']);
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

test('freshEdit: пакеты — источники, legacy-имя нормализуется, чужой остаётся', () => {
  const c = freshEdit('dev', { packages: ['npm:pkg-a', 'pkg-b', 'npm:env-only'] }, catalog);
  assert.deepEqual(c.packages, ['npm:pkg-a', 'npm:pkg-b', 'npm:env-only']);
  assert.equal(c.mode, 'edit');
  assert.equal(c.origName, 'dev');
});

test('edit packages: строки env-only и кнопка «Установить» в конце', () => {
  let s = { ...initialState(catalog), sub: 'create' as const, create: freshEdit('dev', { packages: ['npm:env-only'] }, catalog) };
  s = openPackages(s);
  // строки: pkg-a(0), pkg-b(1), env-only(2), Обновить все(3), Установить(4)
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true);
  s = reducer(s, 'down', [], true);
  assert.equal(s.create!.cursor, 3);
  s = reducer(s, 'down', [], true);
  assert.equal(s.create!.cursor, 4);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'install');
  assert.equal(s.create!.installStatus, 'loading');
});

test('create packages: строки «Установить» нет', () => {
  let s = openPackages(withCreate());
  s = reducer(s, 'down', [], true); // pkg-b
  s = reducer(s, 'down', [], true); // «Обновить все»
  assert.equal(s.create!.cursor, 2);
  s = reducer(s, 'down', [], true); // цикл — «Установить» нет
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
  s = reducer(s, 'down', [], true);
  assert.equal(s.create!.cursor, 1);
  s = reducer(s, 'enter', [], true);
  assert.equal(s.create!.view, 'installing');
  assert.equal(s.create!.installing, 'pi-b');
  s = reducer(s, { type: 'install-result', ok: true, message: 'npm:pi-b', sources: ['npm:env-only', 'npm:pi-b'] }, [], true);
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
  const t = reducer(s, { type: 'install-result', ok: false, message: 'нет сети' }, [], true);
  assert.equal(t.create!.view, 'install');
  assert.equal(t.create!.error, 'нет сети');
  assert.equal(t.create!.installing, null);
});
