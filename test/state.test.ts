import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, listLength, emptyCatalog, freshCreate, type AppState } from '../src/state.js';

const envs = (n: number) => Array.from({ length: n }, (_, i) => `env${i}`);

test('initialState', () => {
  assert.deepEqual(initialState(), {
    tab: 'envs', focus: 'left', selected: 0, sub: null, colorToggle: true, quit: false,
    catalog: emptyCatalog(), create: null,
  });
});

test('listLength', () => {
  assert.equal(listLength('envs', 3), 4);
  assert.equal(listLength('settings', 0), 2);
  assert.equal(listLength('about', 5), 0);
});

test('TAB циклически переключает вкладки и сбрасывает состояние', () => {
  let s = { ...initialState(), selected: 2, sub: 'create' };
  s = reducer(s, 'tab', envs(3), true);
  assert.equal(s.tab, 'settings');
  assert.equal(s.selected, 0);
  assert.equal(s.sub, null);
  s = reducer(s, 'tab', envs(3), true);
  assert.equal(s.tab, 'about');
  s = reducer(s, 'tab', envs(3), true);
  assert.equal(s.tab, 'envs');
});

test('↑↓ клампируются на границах списка', () => {
  let s = initialState();
  s = reducer(s, 'up', envs(2), true);
  assert.equal(s.selected, 0);
  s = reducer(s, 'down', envs(2), true);
  assert.equal(s.selected, 1);
  s = reducer(s, 'down', envs(2), true);
  assert.equal(s.selected, 2);
  s = reducer(s, 'down', envs(2), true);
  assert.equal(s.selected, 2);
  s = reducer(s, 'up', envs(2), true);
  assert.equal(s.selected, 1);
});

test('Enter: окружение → run, последний пункт → create', () => {
  assert.equal(reducer(initialState(), 'enter', envs(2), true).sub, 'run');
  const s = reducer({ ...initialState(), selected: 2 }, 'enter', envs(2), true);
  assert.equal(s.sub, 'create');
  assert.ok(s.create !== null && s.create.view === 'form');
});

test('Enter внутри run-суб-экрана игнорируется', () => {
  const s = { ...initialState(), sub: 'run' as const };
  assert.deepEqual(reducer(s, 'enter', envs(2), true), s);
});

test('ESC: назад из суб-экрана, выход на верхнем уровне', () => {
  assert.equal(reducer({ ...initialState(), sub: 'run' }, 'esc', envs(2), true).sub, null);
  assert.equal(reducer(initialState(), 'esc', envs(2), true).quit, true);
});

test('Space: toggle только на пункте 1 вкладки settings', () => {
  let s = { ...initialState(), tab: 'settings' as const, selected: 1 };
  s = reducer(s, 'space', envs(0), true);
  assert.equal(s.colorToggle, false);
  s = reducer(s, 'space', envs(0), true);
  assert.equal(s.colorToggle, true);
  const s0 = { ...initialState(), tab: 'settings' as const, selected: 0 };
  assert.deepEqual(reducer(s0, 'space', envs(0), true), s0);
});

test('←→: смена фокуса только envs + широкий режим + без суб-экрана', () => {
  let s = reducer(initialState(), 'right', envs(2), true);
  assert.equal(s.focus, 'right');
  s = reducer(s, 'left', envs(2), true);
  assert.equal(s.focus, 'left');
  assert.deepEqual(reducer(initialState(), 'right', envs(2), false), initialState());
  const settings = { ...initialState(), tab: 'settings' as const };
  assert.deepEqual(reducer(settings, 'right', envs(2), true), settings);
});

test('Ctrl+C — выход', () => {
  assert.equal(reducer(initialState(), 'ctrlc', envs(2), true).quit, true);
});

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
      packages: ['pkg-a'],
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
