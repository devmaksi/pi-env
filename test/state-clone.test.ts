import { test } from 'node:test';
import assert from 'node:assert';
import { initialState, reducer, makeCtx, freshClone, applyCloneResult, MAX_NAME, type AppState } from '../src/state.js';

const ctx = makeCtx(['one', 'two'], true);

/** Состояние с открытым суб-экраном клонирования окружения «one». */
const open = (over: Partial<NonNullable<AppState['clone']>> = {}): AppState => ({
  ...initialState(),
  clone: { ...freshClone('one', '/root/one', 'ru'), ...over },
});

test('clone-start открывает суб-экран с именем по умолчанию', () => {
  const s = reducer(initialState(), { type: 'clone-start', name: 'one', path: '/root/one' }, ctx);
  assert.ok(s.clone !== null);
  assert.equal(s.clone!.srcName, 'one');
  assert.equal(s.clone!.srcPath, '/root/one');
  assert.equal(s.clone!.name, 'one-copy');
  assert.equal(s.clone!.caret, 'one-copy'.length);
  assert.equal(s.sub, null); // не форма создания
});

test('clone-start на другой вкладке или в другом суб-экране не открывает клонирование', () => {
  assert.equal(reducer({ ...initialState(), tab: 'mcp' }, { type: 'clone-start', name: 'one', path: '/root/one' }, ctx).clone, null);
  assert.equal(reducer({ ...initialState(), trash: { cursor: 0, confirm: null, pending: null } }, { type: 'clone-start', name: 'one', path: '/root/one' }, ctx).clone, null);
  assert.equal(reducer({ ...initialState(), sub: 'create' }, { type: 'clone-start', name: 'one', path: '/root/one' }, ctx).clone, null);
});

test('ввод имени, Backspace и каретка ←/→', () => {
  let s = open({ name: 'ab', caret: 2 });
  s = reducer(s, 'x', ctx);
  assert.equal(s.clone!.name, 'abx');
  assert.equal(s.clone!.caret, 3);
  s = reducer(s, 'backspace', ctx);
  assert.equal(s.clone!.name, 'ab');
  assert.equal(s.clone!.caret, 2);
  s = reducer(s, 'left', ctx);
  assert.equal(s.clone!.caret, 1);
  s = reducer(s, 'left', ctx);
  assert.equal(s.clone!.caret, 0);
  s = reducer(s, 'left', ctx);
  assert.equal(s.clone!.caret, 0);
  s = reducer(s, 'right', ctx);
  assert.equal(s.clone!.caret, 1);
  s = reducer(s, 'z', ctx);
  assert.equal(s.clone!.name, 'azb');
});

test('ошибка имени снимается при вводе, длинное имя не растёт', () => {
  let s = open({ name: 'пло хое', caret: 7, error: 'Имя: только латинские буквы, цифры, «_» и «-»' });
  s = reducer(s, 'x', ctx);
  assert.equal(s.clone!.error, null);
  const long = 'a'.repeat(MAX_NAME);
  let t = open({ name: long, caret: MAX_NAME });
  t = reducer(t, 'b', ctx);
  assert.equal(t.clone!.name, long);
  assert.equal(t.clone!.caret, MAX_NAME);
});

test('Enter с невалидным именем — ошибка в поле, суб-экран открыт, pending не выставлен', () => {
  const s = reducer(open({ name: 'пло хое', caret: 7 }), 'enter', ctx);
  assert.ok(s.clone !== null);
  assert.ok(s.clone!.error !== null);
  assert.equal(s.clone!.pending, false);
});

test('Enter с занятым именем — та же ошибка (ctx.envNames)', () => {
  const s = reducer(open({ name: 'two', caret: 3 }), 'enter', ctx);
  assert.ok(s.clone!.error !== null);
  assert.equal(s.clone!.pending, false);
});

test('Enter с пустым именем — ошибка, pending не выставлен', () => {
  const s = reducer(open({ name: '', caret: 0 }), 'enter', ctx);
  assert.ok(s.clone!.error !== null);
  assert.equal(s.clone!.pending, false);
});

test('Enter с допустимым именем — pending: true; повторный Enter игнорируется', () => {
  let s = reducer(open({ name: 'three', caret: 5 }), 'enter', ctx);
  assert.equal(s.clone!.pending, true);
  s = reducer(s, 'enter', ctx);
  assert.equal(s.clone!.pending, true);
  s = reducer(s, 'x', ctx);
  assert.equal(s.clone!.name, 'three'); // поля уже не редактируются
});

test('Esc закрывает суб-экран и не выходит из приложения', () => {
  const s = reducer(open(), 'esc', ctx);
  assert.equal(s.clone, null);
  assert.equal(s.quit, false);
});

test('TAB в суб-экране не переключает вкладку', () => {
  const s = reducer(open(), 'tab', ctx);
  assert.equal(s.tab, 'envs');
  assert.ok(s.clone !== null);
});

test('↑/↓ в суб-экране не двигают список окружений', () => {
  const s = reducer({ ...open(), selected: 1 }, 'down', ctx);
  assert.equal(s.selected, 1);
});

test('clone-result (успех) закрывает суб-экран и ставит курсор на копию', () => {
  const s = applyCloneResult(
    { ...open({ pending: true }), selected: 0 },
    { type: 'clone-result', ok: true, message: '/root/two-copy', name: 'two-copy' },
    makeCtx(['one', 'two', 'two-copy'], true),
  );
  assert.equal(s.clone, null);
  assert.equal(s.selected, 2);
});

test('clone-result: курсор на копии — индекс по строкам экрана (основная запись — строка списка)', () => {
  const s = applyCloneResult(
    { ...open({ pending: true }), selected: 0 },
    { type: 'clone-result', ok: true, message: '/root/two-copy', name: 'two-copy' },
    makeCtx(['agent', 'one', 'two', 'two-copy'], true, [], ['one', 'two', 'two-copy']),
  );
  assert.equal(s.selected, 3);
});

test('клон: имя копии проверяется по realNames, а не по строкам списка', () => {
  // основная запись вне `<root>` — её имя не занято, имя обычного окружения — занято
  const c = makeCtx(['agent', 'one'], true, [], ['one']);
  const free = reducer({ ...open({ name: 'agent', caret: 5 }) }, 'enter', c);
  assert.equal(free.clone!.error, null);
  assert.equal(free.clone!.pending, true);
  const taken = reducer({ ...open({ name: 'one', caret: 3 }) }, 'enter', c);
  assert.ok(taken.clone!.error !== null);
  assert.equal(taken.clone!.pending, false);
});

test('clone-result (ошибка) оставляет суб-экран с текстом ошибки', () => {
  const err = 'Окружение с таким именем уже есть';
  const s = applyCloneResult(
    { ...open({ pending: true }), selected: 0 },
    { type: 'clone-result', ok: false, message: err, name: 'two' },
    makeCtx(['one', 'two'], true),
  );
  assert.ok(s.clone !== null);
  assert.equal(s.clone!.error, err);
  assert.equal(s.clone!.pending, false);
  assert.equal(s.selected, 0);
});

test('clone-result (успех) без копии в снимке — курсор в границах списка', () => {
  const s = applyCloneResult(
    { ...open({ pending: true }), selected: 0 },
    { type: 'clone-result', ok: true, message: '/root/gone', name: 'gone' },
    makeCtx([], true),
  );
  assert.equal(s.clone, null);
  assert.equal(s.selected, 0);
});

test('freshClone несёт путь источника — эффект-слой копирует по пути, а не по имени', () => {
  const cl = freshClone('agent', '/elsewhere/agent', 'ru');
  assert.equal(cl.srcName, 'agent');
  assert.equal(cl.srcPath, '/elsewhere/agent');
  assert.equal(cl.name, 'agent-copy');
});
