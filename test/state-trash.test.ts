import { test } from 'node:test';
import assert from 'node:assert';
import {
  initialState, emptyCatalog, reducer, listLength, freshTrash, makeCtx,
  type AppState, type Catalog, type ReducerCtx,
} from '../src/state.js';

const CATALOG: Catalog = emptyCatalog();
const NAMES = ['e0', 'e1', 'e2'];
const TRASH = ['e9@3000', 'e8@2000', 'e7@1000'];

const ctx = (names: string[] = NAMES, trashNames: string[] = TRASH): ReducerCtx =>
  makeCtx(names, true, trashNames);

/** Суб-экран корзины открыт (список окружений позади него). */
const open = (over: Record<string, unknown> = {}): AppState =>
  ({ ...initialState(CATALOG), selected: NAMES.length + 1, trash: freshTrash(), ...over });

test('Enter по строке «Корзина» открывает суб-экран (selected = envNames.length + 1)', () => {
  const list = { ...initialState(CATALOG), selected: NAMES.length + 1 };
  const s = reducer(list, 'enter', ctx());
  assert.notEqual(s.trash, null);
  assert.equal(s.sub, null);
  assert.equal(s.create, null);
  assert.equal(s.trash!.cursor, 0);
});

test('trashMachine: ↑/↓ по записям, границы — [0, len-1], цикл нет', () => {
  const one = reducer(open(), 'down', ctx(NAMES, ['a@1']));
  assert.equal(one.trash!.cursor, 0);
  let s = open();
  s = reducer(s, 'down', ctx());
  assert.equal(s.trash!.cursor, 1);
  s = reducer(s, 'down', ctx());
  s = reducer(s, 'down', ctx());
  assert.equal(s.trash!.cursor, 2);
  s = reducer(s, 'down', ctx());
  assert.equal(s.trash!.cursor, 2);
  s = reducer(s, 'up', ctx());
  assert.equal(s.trash!.cursor, 1);
  s = reducer({ ...s, trash: { ...s.trash!, cursor: 0 } }, 'up', ctx());
  assert.equal(s.trash!.cursor, 0);
});

test('trashMachine: Enter по записи — pending { kind: "restore", dirName }', () => {
  const s = reducer({ ...open(), trash: freshTrash({ cursor: 1 }) }, 'enter', ctx());
  assert.deepEqual(s.trash!.pending, { kind: 'restore', dirName: 'e8@2000' });
});

test('trashMachine: Enter по пустой корзине — без изменений', () => {
  const s = reducer(open(), 'enter', ctx(NAMES, []));
  assert.equal(s.trash!.pending, null);
});

test('trashMachine: X — confirm: dirName; Enter в confirm — pending { kind: "delete" } и confirm: null; Esc — снимает confirm', () => {
  const asked = reducer(open(), 'x', ctx());
  assert.equal(asked.trash!.confirm, 'e9@3000');
  assert.equal(asked.trash!.pending, null);
  const gone = reducer(asked, 'enter', ctx());
  assert.deepEqual(gone.trash!.pending, { kind: 'delete', dirName: 'e9@3000' });
  assert.equal(gone.trash!.confirm, null);
  const cancel = reducer(asked, 'esc', ctx());
  assert.equal(cancel.trash!.confirm, null);
  assert.notEqual(cancel.trash, null);
  assert.equal(cancel.quit, false);
});

test('trashMachine: Esc без confirm — закрывает суб-экран (trash: null), не выход из приложения', () => {
  const s = reducer(open(), 'esc', ctx());
  assert.equal(s.trash, null);
  assert.equal(s.quit, false);
});

test('trashMachine: печатные символы, space, left/right в суб-экране корзины — без изменений', () => {
  const base = open();
  for (const key of ['a', '5', 'space', 'left', 'right', 'R', 'e']) {
    assert.deepEqual(reducer(base, key, ctx()).trash, base.trash, key);
  }
});

test('trashMachine: TAB уходит в общую машину и закрывает суб-экран', () => {
  const s = reducer(open(), 'tab', ctx());
  assert.equal(s.tab, 'extensions');
  assert.equal(s.trash, null);
});

test('applyTrashResult: pending снят, cursor в границах, trash остаётся открытым', () => {
  const busy = { ...open(), trash: freshTrash({ cursor: 2, pending: { kind: 'delete', dirName: 'e7@1000' } }) };
  const after = reducer(busy, { type: 'trash-result', ok: true, message: 'ok' }, ctx(NAMES, ['e9@3000']));
  assert.notEqual(after.trash, null);
  assert.equal(after.trash!.pending, null);
  assert.equal(after.trash!.cursor, 0);
});

test('applyTrashResult: отказ — то же самое, суб-экран открыт, позиция в границах', () => {
  const busy = { ...open(), trash: freshTrash({ cursor: 4, pending: { kind: 'restore', dirName: 'e9@3000' } }) };
  const after = reducer(busy, { type: 'trash-result', ok: false, message: 'занято' }, ctx(NAMES, TRASH));
  assert.equal(after.trash!.pending, null);
  assert.equal(after.trash!.cursor, 2);
});

test('onTab: смена вкладки закрывает суб-экран корзины', () => {
  const s = reducer(open(), 'tab', ctx());
  assert.equal(s.trash, null);
});

test('listLength("envs", 3) === 5 // окружения + «Создать» + «Корзина»', () => {
  assert.equal(listLength('envs', 3), 5);
});

test('Enter по строке «Создать» — форма создания, суб-экран корзины не открывается', () => {
  const s = reducer({ ...initialState(CATALOG), selected: NAMES.length }, 'enter', ctx());
  assert.equal(s.sub, 'create');
  assert.notEqual(s.create, null);
  assert.equal(s.trash, null);
});

test('↑/↓ на вкладке «Окружения» доходят до строки «Корзина» (selected = 4)', () => {
  let s = { ...initialState(CATALOG), selected: 0 };
  for (let i = 0; i < 6; i++) s = reducer(s, 'down', ctx());
  assert.equal(s.selected, 4);
});
