import { test } from 'node:test';
import assert from 'node:assert';
import {
  initialState, reducer, freshExt, busyProcessView, makeCtx,
  type AppState, type PackageConflict, type PkgItem, type ReducerCtx,
} from '../src/state.js';
import { conflictSourcesOf } from '../src/state-ext.js';

/**
 * Вкладка «Расширения» как реестр хранилища: имя пакета из package.json может отличаться
 * от объявления (`@wangjq4214/pi-open-tui` vs `npm:pi-open-tui`) — суб-экран обязан открыться
 * и по scoped-имени, и по обычному.
 */
const pkg = (name: string): PkgItem => ({
  source: 'npm:' + name, name, path: '/store/npm/node_modules/' + name,
  version: '1.0.0', description: null, extensions: [], skills: [],
});

const conflict: PackageConflict = {
  name: 'pi-open-tui',
  declarations: [
    { env: 'dev-java', source: 'npm:pi-open-tui' },
    { env: 'dev-supo', source: 'npm:pi-open-tui' },
    { env: 'search', source: 'npm:pi-open-tui' },
    { env: 'dev-vtb', source: 'npm:@wangjq4214/pi-open-tui' },
  ],
};

const tab = (): AppState => ({ ...initialState(undefined, [pkg('pi-open-tui')]), tab: 'extensions' });

const rc = (conflicts: PackageConflict[] = [conflict]): ReducerCtx =>
  makeCtx(['main', 'dev-java', 'dev-supo', 'dev-vtb'], true, [], ['dev-java', 'dev-supo', 'dev-vtb'], conflicts);

test('S на пакете с конфликтом — суб-экран выбора источника', () => {
  const s = reducer(tab(), 'S', rc());
  assert.equal(s.ext!.view, 'resolve');
  assert.equal(s.ext!.conflictName, 'pi-open-tui');
  assert.equal(s.ext!.cursor, 0);
});

// Имя из package.json всегда со scope — ключ сравнения обязан быть тем же, иначе
// суб-экран не откроется на scoped-пакетах (тот же класс дефектов, что со счётчиком «N окр.»).
test('S на scoped-имени пакета — тот же конфликт открывается', () => {
  const state = { ...initialState(undefined, [pkg('@wangjq4214/pi-open-tui')]), tab: 'extensions' as const };
  const s = reducer(state, 'S', rc());
  assert.equal(s.ext!.view, 'resolve');
  assert.equal(s.ext!.conflictName, 'pi-open-tui');
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
  assert.equal(s.ext!.resolving, 'npm:pi-open-tui');
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
  assert.deepEqual(conflictSourcesOf(rc(), 'pi-open-tui'), [
    { source: 'npm:@wangjq4214/pi-open-tui', envs: ['dev-vtb'] },
    { source: 'npm:pi-open-tui', envs: ['dev-java', 'dev-supo', 'search'] },
  ]);
  assert.deepEqual(conflictSourcesOf(rc(), 'pi-zentui'), []);
  assert.deepEqual(conflictSourcesOf(rc(), null), []);
});
