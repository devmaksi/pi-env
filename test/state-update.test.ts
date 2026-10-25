import { test } from 'node:test';
import assert from 'node:assert';
import { freshUpdateUi, initialState, makeCtx, reducer, selectedCommand, tabsOf, updateListLength, type SelfUpdate, type Tab } from '../src/state.js';

const INFO: SelfUpdate = { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 };
const CTX = makeCtx(['Test'], true);

test('tabsOf: вкладки без обновления и с обновлением', () => {
  const base = { ...initialState(), selfUpdate: null };
  assert.deepEqual(tabsOf(base), ['envs', 'extensions', 'mcp', 'settings', 'about']);
  assert.deepEqual(tabsOf({ ...base, selfUpdate: INFO }),
    ['envs', 'extensions', 'mcp', 'settings', 'update', 'about']);
});

test('TAB: цикл идёт по tabsOf и «Обновление» участвует', () => {
  let s = { ...initialState(), tab: 'settings' as Tab, selfUpdate: INFO };
  s = reducer(s, 'tab', CTX);
  assert.equal(s.tab, 'update');
  s = reducer(s, 'tab', CTX);
  assert.equal(s.tab, 'about');
});

test('вкладка исчезла под курсором → соседняя того же индекса', () => {
  const s = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO };
  const next = reducer(s, { type: 'self-update-result', info: null }, CTX);
  assert.equal(next.tab, 'settings');
  assert.equal(next.selfUpdate, null);
});

test('↑/↓ двигают курсор в границах списка вкладки', () => {
  const s0 = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO, updateUi: freshUpdateUi() };
  const s1 = reducer(s0, 'down', CTX);
  assert.equal(s1.updateUi!.cursor, 1);
  assert.equal(s1.updateUi!.cursor >= updateListLength(s1), false);
});

test('Enter на строке команды → copyRequest с текстом команды', () => {
  const s = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO,
    updateUi: { ...freshUpdateUi(), cursor: 4 } };
  assert.equal(selectedCommand(s), 'npm i -g @devmaksi/pi-env@latest');
  assert.equal(reducer(s, 'enter', CTX).updateUi!.copyRequest, 'npm i -g @devmaksi/pi-env@latest');
});

test('Enter на не-командной строке → copyRequest null', () => {
  const s = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO,
    updateUi: { ...freshUpdateUi(), cursor: 0 } };
  assert.equal(reducer(s, 'enter', CTX).updateUi!.copyRequest, null);
});

test('R на вкладке → selfCheck loading; повторный R не меняет состояние', () => {
  const s = reducer(initialState(), { type: 'self-update-result', info: INFO }, CTX);
  const r1 = reducer({ ...s, tab: 'update' as Tab }, 'R', CTX);
  assert.equal(r1.selfCheck, 'loading');
  assert.equal(reducer(r1, 'R', CTX).selfCheck, 'loading');
});

test('E, X, Space на вкладке «Обновление» игнорируются', () => {
  const s = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO, updateUi: freshUpdateUi() };
  for (const k of ['E', 'x', ' ', 'space']) assert.deepEqual(reducer(s, k, CTX), s);
});
