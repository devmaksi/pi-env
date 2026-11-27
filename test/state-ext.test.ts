import { test } from 'node:test';
import assert from 'node:assert';
import {
  initialState, reducer, freshExt, busyProcessView, makeCtx,
  type AppState, type PackageConflict, type PkgItem, type ReducerCtx,
} from '../src/state.js';
import { conflictSourcesOf } from '../src/state-ext.js';
import { type RegistryGap } from '../src/environments.js';

/**
 * Вкладка «Расширения» как реестр хранилища: группа конфликта ищется по идентичности пакета
 * как у pi (`npm:pi-open-tui` и `npm:pi-open-tui@0.4.6` — один пакет, а `npm:@wangjq4214/pi-open-tui` —
 * уже другой), поэтому суб-экран открывается по объявлению из реестра хранилища.
 */
const pkg = (name: string): PkgItem => ({
  source: 'npm:' + name, name, path: '/store/npm/node_modules/' + name,
  version: '1.0.0', description: null, extensions: [], skills: [],
});

const conflict: PackageConflict = {
  name: 'npm:pi-open-tui',
  declarations: [
    { env: 'dev-java', source: 'npm:pi-open-tui' },
    { env: 'dev-supo', source: 'npm:pi-open-tui' },
    { env: 'search', source: 'npm:pi-open-tui' },
    { env: 'dev-vtb', source: 'npm:pi-open-tui@0.4.6' },
  ],
};

const tab = (): AppState => ({ ...initialState(undefined, [pkg('pi-open-tui')]), tab: 'extensions' });

const rc = (conflicts: PackageConflict[] = [conflict], gaps: RegistryGap[] = []): ReducerCtx =>
  makeCtx(['main', 'dev-java', 'dev-supo', 'dev-vtb'], true, [], ['dev-java', 'dev-supo', 'dev-vtb'], conflicts, gaps);

test('S на пакете с конфликтом — суб-экран выбора источника', () => {
  const s = reducer(tab(), 'S', rc());
  assert.equal(s.ext!.view, 'resolve');
  assert.equal(s.ext!.conflictName, 'npm:pi-open-tui');
  assert.equal(s.ext!.cursor, 0);
});

// Объявление реестра с версией — та же идентичность: суб-экран обязан открыться и на нём.
test('S на объявлении с версией — тот же конфликт открывается', () => {
  const at = { ...initialState(undefined, [{ ...pkg('pi-open-tui'), source: 'npm:pi-open-tui@0.4.6' }]), tab: 'extensions' as const };
  const s = reducer(at, 'S', rc());
  assert.equal(s.ext!.view, 'resolve');
  assert.equal(s.ext!.conflictName, 'npm:pi-open-tui');
});

// Пакет другого издателя — не группа конфликта одного имени (см. environments.test.ts),
// поэтому `S` не имеет права открывать разрешение и переписывать его объявления.
test('S на пакете другого издателя (группы конфликта нет) — ничего', () => {
  const state = { ...initialState(undefined, [pkg('@wangjq4214/pi-open-tui')]), tab: 'extensions' as const };
  const s = reducer(state, 'S', rc([]));
  assert.equal(s.ext, null);
});

test('S на пакете без конфликта — ничего', () => {
  const s = reducer(tab(), 'S', rc([]));
  assert.equal(s.ext, null);
});

test('S на строке «Обновить все» и «Установить» — ничего', () => {
  for (const selected of [1, 2]) {
    const s = reducer({ ...tab(), selected }, 'S', rc());
    assert.equal(s.ext, null, `selected=${selected}`);
  }
});

test('S на другой вкладке — ничего', () => {
  const s = reducer({ ...tab(), tab: 'mcp' as const }, 'S', rc());
  assert.equal(s.ext, null);
  assert.equal(s.tab, 'mcp');
});

// Вариантов — уникальные источники, а не объявления: ↑↓ не должна ходить по дублям.
test('суб-экран: ↑↓ ходят по уникальным источникам и циклуют', () => {
  let s = reducer(tab(), 'S', rc());
  assert.equal(conflictSourcesOf(rc(), s.ext!.conflictName).length, 2);
  s = reducer(s, 'down', rc());
  assert.equal(s.ext!.cursor, 1);
  s = reducer(s, 'down', rc());
  assert.equal(s.ext!.cursor, 0);
  s = reducer(s, 'up', rc());
  assert.equal(s.ext!.cursor, 1);
});

test('суб-экран: Enter — resolving с выбранным источником', () => {
  const open = reducer(tab(), 'S', rc());
  const s = reducer({ ...open, ext: { ...open.ext!, cursor: 1 } }, 'enter', rc());
  assert.equal(s.ext!.view, 'resolving');
  assert.equal(s.ext!.resolving, 'npm:pi-open-tui@0.4.6');
});

test('суб-экран: Esc до выбора — закрытие (экрана процесса это не касается)', () => {
  const open = reducer(tab(), 'S', rc());
  assert.equal(reducer(open, 'esc', rc()).ext, null);
});

test('суб-экран: Enter без конфликта в снимке — экран не уходит в resolving', () => {
  const open = reducer(tab(), 'S', rc());
  const s = reducer(open, 'enter', rc([]));
  assert.equal(s.ext!.view, 'resolve');
});

test('resolving снимается только результатом: Esc не закрывает экран процесса', () => {
  const open = reducer(tab(), 'S', rc());
  const busy = reducer({ ...open, ext: { ...open.ext!, view: 'resolving', resolving: 'npm:pi-open-tui' } }, 'esc', rc());
  assert.equal(busy.ext!.view, 'resolving');
  const done = reducer(busy, { type: 'resolve-result', ok: true, message: 'ok' }, rc());
  assert.equal(done.ext, null);
});

test('resolve-result с другим экраном не закрывает чужой суб-экран', () => {
  const state = { ...tab(), ext: freshExt({ view: 'confirm-remove', removing: 'pi-open-tui' }) };
  const s = reducer(state, { type: 'resolve-result', ok: true, message: 'ok' }, rc());
  assert.equal(s.ext!.view, 'confirm-remove');
});

test('busyProcessView: resolving — процесс (Esc и «⏳ N с» работают), resolve — нет', () => {
  assert.equal(busyProcessView({ ...tab(), ext: freshExt({ view: 'resolving', resolving: 'npm:x' }) }), true);
  assert.equal(busyProcessView({ ...tab(), ext: freshExt({ view: 'resolve', conflictName: 'x' }) }), false);
});

test('conflictSourcesOf: конфликта в снимке нет — пустой список вариантов', () => {
  assert.deepEqual(conflictSourcesOf(rc(), 'npm:pi-open-tui'), [
    { source: 'npm:pi-open-tui', envs: ['dev-java', 'dev-supo', 'search'] },
    { source: 'npm:pi-open-tui@0.4.6', envs: ['dev-vtb'] },
  ]);
  assert.deepEqual(conflictSourcesOf(rc(), 'npm:pi-zentui'), []);
  assert.deepEqual(conflictSourcesOf(rc(), 'pi-open-tui'), []);
  assert.deepEqual(conflictSourcesOf(rc(), null), []);
});


// ─── разрыв реестра хранилища: точка повтора после провала/отмены шага в <store> ───
// Разрешение конфликта сначала переписывает объявления, поэтому конфликта в снимке больше
// нет, а реестр может остаться на проигравшем источнике. Без этого входа привести хранилище
// к победителю было бы нечем — действие `S` должно пережить исчезновение конфликта.
const gaps: RegistryGap[] = [
  { identity: 'npm:pi-open-tui', declared: 'npm:pi-open-tui', registered: ['npm:pi-open-tui@0.4.6'] },
  { identity: 'npm:pi-zentui', declared: 'npm:pi-zentui', registered: [] },
];

test('S без конфликта на строке, но с разрывом реестра — суб-экран приведения', () => {
  const s = reducer(tab(), 'S', rc([], gaps));
  assert.equal(s.ext!.view, 'gap');
  assert.equal(s.ext!.cursor, 0);
});

test('S без конфликта и без разрыва реестра — ничего', () => {
  assert.equal(reducer(tab(), 'S', rc([], [])).ext, null);
});

test('суб-экран приведения: ↑↓ по разрывам, Enter — цикл операций, Esc — закрыть', () => {
  let s = reducer(tab(), 'S', rc([], gaps));
  s = reducer(s, 'down', rc([], gaps));
  assert.equal(s.ext!.cursor, 1);
  s = reducer(s, 'up', rc([], gaps));
  assert.equal(s.ext!.cursor, 0);
  s = reducer(s, 'enter', rc([], gaps));
  assert.equal(s.ext!.view, 'resolving');
  assert.equal(s.ext!.conflictName, 'npm:pi-open-tui');
  assert.equal(s.ext!.resolving, 'npm:pi-open-tui');
  let c = reducer(tab(), 'S', rc([], gaps));
  c = reducer(c, 'esc', rc([], gaps));
  assert.equal(c.ext, null);
});

test('суб-экран приведения пуст (разрывы исчезли) — ↑↓/Enter ничего не делают', () => {
  let s = reducer(tab(), 'S', rc([], gaps));
  s = { ...s, ext: { ...s.ext!, cursor: 0 } };
  const ctx = rc([], []);
  assert.deepEqual(reducer(s, 'down', ctx), s);
  assert.deepEqual(reducer(s, 'enter', ctx), s);
});

// Экран выбора разрыва — не процесс: Esc на нём закрывает экран, а не снимает pi-команду.
test('экран приведения — не процесс; процесс — только resolving', () => {
  assert.equal(busyProcessView({ ...tab(), ext: freshExt({ view: 'gap', cursor: 0 }) }), false);
  assert.equal(busyProcessView({ ...tab(), ext: freshExt({ view: 'resolving', resolving: 'npm:pi-open-tui' }) }), true);
});
