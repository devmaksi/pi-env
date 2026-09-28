import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, freshCreate, type Catalog } from '../src/state.js';

const catalog: Catalog = {
  providers: [
    { name: 'cpp', models: [{ id: 'Bonsai-2' }, { id: 'Zed-1' }] },
    { name: 'openai', models: [{ id: 'gpt-4o' }] },
  ],
  tools: [{ name: 'searxng-search.ts', path: '/x/searxng-search.ts' }],
  packages: [
    { source: 'npm:pkg-a', name: 'pkg-a', path: '/p/a', extensions: ['./index.ts'], skills: [] },
    { source: 'npm:pkg-b', name: 'pkg-b', path: '/p/b', extensions: ['./exts'], skills: [] },
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
  assert.deepEqual(s.create!.packages, ['pkg-b']);
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
  assert.equal(s.create!.cursor, 1); // заходит на pkg-b
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
