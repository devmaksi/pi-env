import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, listLength, emptyCatalog } from '../src/state.js';

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
