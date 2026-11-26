import { test } from 'node:test';
import assert from 'node:assert';
import { render, visibleWidth } from '../src/render.js';
import { freshExt, initialState } from '../src/state.js';
import { type Environment } from '../src/environments.js';
import { type CatalogPkg } from '../src/catalog.js';
import { t } from '../src/i18n.js';

const WIDE = ['↑', '↓', '←', '→', '—', '…', '✓', '⚠', '▌', '＋', '⏳'];
const wide = (ch: string): number => (WIDE.includes(ch) ? 2 : 1);
function lastCol(line: string, cells: (ch: string) => number, width: number): number {
  let col = 1;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
      if (m) { if (m[0].endsWith('H')) col = Number(m[0].slice(2, -1).split(';')[1] ?? 1); i += m[0].length; continue; }
    }
    if (col > width) col = 1;
    col += cells(line[i]);
    i++;
  }
  return col - 1;
}

const det = (over: Partial<Environment['details']> = {}): Environment['details'] => ({
  hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [],
  settingsError: null, mcpError: null, mcpSkipped: [],
  modelsLink: 'off', rootLinks: { npm: 'off', git: 'off' }, missingPackages: [], ...over,
});
const env = (name: string, packages: string[]): Environment => ({
  name, path: '/root/' + name, details: det({ packages, rootLinks: { npm: 'linked', git: 'linked' } }),
});
const pkg = (name: string): CatalogPkg => ({
  source: 'npm:' + name, name, path: '/store/npm/node_modules/' + name,
  version: '1.0.0', description: null, extensions: [], skills: [],
});

const base = { root: '/root', useColor: false, status: null };
const st = { ...initialState(), tab: 'extensions' as const, selected: 0 };

test('вкладка «Расширения»: заголовок хранилища и счётчик «N окр.»', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui']), env('admin', ['npm:pi-zentui']), env('test-ai', [])];
  const state = { ...st, storePackages: [pkg('pi-zentui')] };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'ext.title.store')), s);
  assert.ok(s.includes(t('ru', 'ext.store.usage', { n: 2 })), s);
});

test('вкладка «Расширения»: конфликт источников помечен в списке и в инфо-панели', () => {
  const envs = [env('dev-supo', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui'])];
  const state = { ...st, storePackages: [pkg('pi-open-tui')] };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'ext.store.conflict', { name: 'pi-open-tui' })), s);
  assert.ok(s.includes('npm:@wangjq4214/pi-open-tui'), s);
});

// package.json всегда отдаёт имя со scope — сравнение должен давать один и тот же ключ,
// иначе счётчик, конфликт и предупреждение при удалении молчат на scoped-пакетах.
test('вкладка «Расширения»: scoped-имя пакета из package.json считает окружения и конфликт', () => {
  const envs = [env('dev-supo', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui'])];
  const state = { ...st, storePackages: [pkg('@wangjq4214/pi-open-tui')] };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'ext.store.usage', { n: 2 })), s);
  assert.ok(s.includes(t('ru', 'ext.store.conflict', { name: 'pi-open-tui' })), s);
});

test('пустое хранилище: пустой список с подсказкой, операции недоступны', () => {
  const s = render({ state: st, envs: [env('test-ai', [])], width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'ext.store.empty')), s);
  assert.ok(s.includes(t('ru', 'ext.hint.store-off')), s);
});

test('кадр вкладки хранилища: ровно height строк фиксированной ширины', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui'])];
  const state = { ...st, storePackages: [pkg('pi-zentui'), pkg('pi-open-tui')] };
  for (const width of [40, 62, 90]) {
    const s = render({ state, envs, width, height: 20, ...base });
    const lines = s.split('\n');
    assert.equal(lines.length, 20, `width=${width}`);
    for (const line of lines) {
      assert.equal(lastCol(line, () => 1, width), width, `1-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(lastCol(line, wide, width), width, `2-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(visibleWidth(line) <= width, true, `ширина w=${width}: ${JSON.stringify(line)}`);
    }
  }
});

test('подтверждение удаления из хранилища: список окружений, которые лишатся пакета', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui']), env('admin', ['npm:pi-zentui'])];
  const state = {
    ...st,
    storePackages: [pkg('pi-zentui')],
    ext: freshExt({ view: 'confirm-remove', removing: 'pi-zentui' }),
  };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'busy.delete-ext', { name: 'pi-zentui' })), s);
  assert.ok(s.includes(t('ru', 'ext.store.used-by', { v: 'admin, dev-supo' })), s);
});

// Пакет остался в реестре хранилища, когда объявления всех окружений удалены
// (окружение в корзине или снята отметка) — вкладка обязана это показать.
test('осиротевший пакет: ⚠ у счётчика «0 окр.», текст и подсказка в инфо-панели', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui'])];
  const state = { ...st, storePackages: [pkg('pi-zentui'), pkg('pi-orphan-ext')], selected: 1 };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes('⚠ ' + t('ru', 'ext.store.usage', { n: 0 })), s);
  assert.ok(s.includes(t('ru', 'ext.store.usage', { n: 1 })), s);
  assert.ok(s.includes(t('ru', 'ext.store.orphan')), s);
  assert.ok(s.includes(t('ru', 'ext.store.hint.remove')), s);
  assert.ok(s.includes(t('ru', 'ext.store.orphans', { n: 1 })), s);
});

test('не осиротевший пакет: обычная подсказка удаления, пометки «0 окр.» нет', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui'])];
  const state = { ...st, storePackages: [pkg('pi-zentui')] };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'hint.delete')), s);
  assert.ok(!s.includes(t('ru', 'ext.store.hint.remove')), s);
  assert.ok(!s.includes(t('ru', 'ext.store.orphan')), s);
  assert.ok(!s.includes(t('ru', 'ext.store.orphans', { n: 1 })), s);
});

test('осиротевшие пакеты: сводка есть и когда выбран пакет, и когда выбрана кнопка', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui'])];
  for (const selected of [0, 1, 2]) {
    const state = { ...st, storePackages: [pkg('pi-zentui'), pkg('pi-orphan-ext')], selected };
    const s = render({ state, envs, width: 90, height: 20, ...base });
    assert.ok(s.includes(t('ru', 'ext.store.orphans', { n: 1 })), `selected=${selected}`);
  }
});

// Строка пакета с ⚠ остаётся ровно leftWidth: построчный дифф живёт на фиксированной ширине.
test('кадр с осиротевшим пакетом: ровно height строк фиксированной ширины', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui'])];
  const state = { ...st, storePackages: [pkg('pi-zentui'), pkg('pi-orphan-ext')], selected: 1 };
  for (const width of [40, 62, 90]) {
    const s = render({ state, envs, width, height: 20, ...base });
    const lines = s.split('\n');
    assert.equal(lines.length, 20, `width=${width}`);
    for (const line of lines) {
      assert.equal(lastCol(line, () => 1, width), width, `1-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(lastCol(line, wide, width), width, `2-клеточный w=${width}: ${JSON.stringify(line)}`);
      assert.equal(visibleWidth(line) <= width, true, `ширина w=${width}: ${JSON.stringify(line)}`);
    }
  }
});

test('подтверждение удаления осиротевшего пакета: не используется, список окружений не врал бы', () => {
  const envs = [env('dev-supo', ['npm:pi-zentui'])];
  const state = {
    ...st,
    storePackages: [pkg('pi-orphan-ext')],
    ext: freshExt({ view: 'confirm-remove', removing: 'pi-orphan-ext' }),
  };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'busy.delete-ext', { name: 'pi-orphan-ext' })), s);
  assert.ok(s.includes(t('ru', 'ext.store.orphan-unused')), s);
  // «Перестанут использовать: …» при пустом списке окружений было бы пустой строкой-обманкой
  const usedBy = t('ru', 'ext.store.used-by', { v: 'dev-supo' });
  assert.ok(!s.includes(usedBy.slice(0, usedBy.indexOf(':') + 1)), s);
});

// Действие «разрешить конфликт одним действием»: без подсказки в инфо-панели о нём
// нельзя догадаться, а на пакете без конфликта она была бы обманкой.
test('конфликт источников: подсказка «S — выбрать источник-победитель» только у конфликта', () => {
  const conf = [env('dev-supo', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui'])];
  const withConflict = render({
    state: { ...st, storePackages: [pkg('pi-open-tui')] }, envs: conf, width: 90, height: 20, ...base,
  });
  assert.ok(withConflict.includes(t('ru', 'ext.conflict.hint')), withConflict);
  const clean = render({
    state: { ...st, storePackages: [pkg('pi-open-tui')] },
    envs: [env('dev-supo', ['npm:pi-open-tui']), env('dev-vtb', ['npm:pi-open-tui'])],
    width: 90, height: 20, ...base,
  });
  assert.ok(!clean.includes(t('ru', 'ext.conflict.hint')), clean);
});

// 4 объявления — 2 источника: суб-экран выбирает источник, а не строку на окружение.
test('суб-экран выбора победителя: уникальные источники и окружения в инфо-панели', () => {
  const envs = [
    env('dev-java', ['npm:pi-open-tui']), env('dev-supo', ['npm:pi-open-tui']),
    env('search', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui']),
  ];
  const state = { ...st, ext: freshExt({ view: 'resolve', conflictName: 'pi-open-tui' }) };
  const s = render({ state, envs, width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'ext.conflict.title', { name: 'pi-open-tui' })), s);
  assert.equal((s.match(/npm:pi-open-tui/g) ?? []).length, 1, s);
  assert.ok(s.includes('npm:@wangjq4214/pi-open-tui'), s);
  assert.ok(s.includes(t('ru', 'ext.conflict.envs', { v: 'dev-vtb' })), s);
  assert.ok(s.includes(t('ru', 'ext.conflict.apply')), s);
  assert.ok(s.includes(t('ru', 'hint.confirm')), s);
});

test('суб-экран выбора победителя: курсор переводится по вариантам', () => {
  const envs = [env('dev-supo', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui'])];
  for (const cursor of [0, 1]) {
    const state = { ...st, ext: freshExt({ view: 'resolve', conflictName: 'pi-open-tui', cursor }) };
    const s = render({ state, envs, width: 90, height: 20, ...base });
    assert.ok(s.includes('> ' + ['npm:@wangjq4214/pi-open-tui', 'npm:pi-open-tui'][cursor]), `cursor=${cursor}: ${s}`);
  }
});

test('экран приведения хранилища: текст операции и подсказка отмены', () => {
  const state = { ...st, ext: freshExt({ view: 'resolving', conflictName: 'pi-open-tui', resolving: 'npm:pi-open-tui' }) };
  const s = render({ state, envs: [env('dev-supo', ['npm:pi-open-tui'])], width: 90, height: 20, ...base });
  assert.ok(s.includes(t('ru', 'busy.resolving', { name: 'npm:pi-open-tui' })), s);
  assert.ok(s.includes(t('ru', 'hint.kill')), s);
});

test('кадр суб-экрана выбора источника: ровно height строк фиксированной ширины', () => {
  const envs = [
    env('dev-java', ['npm:pi-open-tui']), env('dev-supo', ['npm:pi-open-tui']),
    env('search', ['npm:pi-open-tui']), env('dev-vtb', ['npm:@wangjq4214/pi-open-tui']),
  ];
  for (const view of ['resolve', 'resolving'] as const) {
    for (const width of [40, 62, 90]) {
      const state = {
        ...st,
        ext: freshExt({ view, conflictName: 'pi-open-tui', resolving: 'npm:@wangjq4214/pi-open-tui', cursor: 1 }),
      };
      const s = render({ state, envs, width, height: 20, ...base });
      const lines = s.split('\n');
      assert.equal(lines.length, 20, `${view} width=${width}`);
      for (const line of lines) {
        assert.equal(lastCol(line, () => 1, width), width, `1-клеточный ${view} w=${width}: ${JSON.stringify(line)}`);
        assert.equal(lastCol(line, wide, width), width, `2-клеточный ${view} w=${width}: ${JSON.stringify(line)}`);
        assert.equal(visibleWidth(line) <= width, true, `ширина ${view} w=${width}: ${JSON.stringify(line)}`);
      }
    }
  }
});
