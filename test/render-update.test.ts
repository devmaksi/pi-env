import { test } from 'node:test';
import assert from 'node:assert';
import { render, tabBarPlan, tabBarRow, visibleWidth, wrapVisible } from '../src/render.js';
import { changelogRows, parseChangelog } from '../src/selfupdate.js';
import { t } from '../src/i18n.js';
import { freshUpdateUi, initialState, type AppState, type SelfUpdate, type Tab } from '../src/state.js';

const INFO: SelfUpdate = { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 };
const SAMPLE = [
  '# Changelog', '', '## [Unreleased]', '', '### Foo', '', '- **New tab**.', '  More text.', '',
  '## [0.2.3] — 2026-10-24', '', '### Витрина пакета (npm, pi.dev)', '',
  '- **Картинки и ссылки** больше не 404.', '  Тарбол вырос до ≈1.2 МБ.', '',
  '## [0.2.2] — 2026-10-24', '', '- `pi update` пункт.',
].join('\n');

const STATE_UP: AppState = {
  ...initialState(), tab: 'update', selfUpdate: INFO,
  updateUi: { ...freshUpdateUi(), check: 'ready', rows: changelogRows(parseChangelog(SAMPLE)) },
};

test('wrapVisible: перенос по пробелам с учётом широких символов', () => {
  assert.deepEqual(wrapVisible('aaa bbb ccc', 7), ['aaa bbb', 'ccc']);
  assert.deepEqual(wrapVisible('— тире', 3), ['—', 'тир', 'е']); // «—» из WIDE_CHARS считается за 2 клетки, слово шире лимита режется
  assert.deepEqual(wrapVisible('', 5), ['']);
  assert.deepEqual(wrapVisible('длинноеслово', 5), ['длинн', 'оесло', 'во']);
});

const FULL5_RU = ['Окружения', 'Расширения', 'MCP', 'Настройки', 'О программе'];
const FULL6_RU = ['Окружения', 'Расширения', 'MCP', 'Настройки', 'Обновление', 'О программе'];
const SHORT6_RU = ['Окр', 'Расш', 'MCP', 'Настр', 'Обнов', 'Справка'];

test('tabBarPlan: полные имена влезают → full, sep 4', () => {
  assert.deepEqual(tabBarPlan(FULL5_RU, SHORT6_RU, 60), { mode: 'full', sep: 4 });
});

test('tabBarPlan: шесть вкладок по-русски в 44 клетки → short, sep 2', () => {
  assert.deepEqual(tabBarPlan(FULL6_RU, SHORT6_RU, 44), { mode: 'short', sep: 2 });
});

test('tabBarPlan: и короткие не влезают → minimal', () => {
  assert.equal(tabBarPlan(FULL6_RU, SHORT6_RU, 20).mode, 'minimal');
});

test('tabBarPlan: английские имена меряются по своей ширине', () => {
  const full = ['Environments', 'Extensions', 'MCP', 'Settings', 'Update', 'About'];
  const short = ['Env', 'Ext', 'MCP', 'Set', 'Update', 'About'];
  assert.equal(tabBarPlan(full, short, 62).mode, 'short');
});

test('таб-бар: содержимое строки не шире inner при любой ширине', () => {
  for (const inner of [32, 44, 60, 88]) {
    assert.equal(visibleWidth(tabBarRow(STATE_UP, 'ru', inner, false)) <= inner, true);
  }
});

test('таб-бар: на широком терминале видно все шесть вкладок полными именами', () => {
  const row = tabBarRow(STATE_UP, 'ru', 88, false);
  for (const name of ['Окружения', 'Расширения', 'MCP', 'Настройки', 'Обновление', 'О программе']) {
    assert.ok(row.includes(name), name);
  }
});

test('таб-бар: в 44 клетки — короткие имена, все шесть вкладок на месте', () => {
  const row = tabBarRow(STATE_UP, 'ru', 44, false);
  for (const name of ['Окр', 'Расш', 'MCP', 'Настр', 'Обнов', 'Справка']) assert.ok(row.includes(name), name);
});


test('вкладка: версия, способ, команда, подзаголовок и блоки чейнджлога', () => {
  const frame = render({ state: STATE_UP, envs: [], root: '/r', width: 80, height: 20, useColor: false, status: null });
  const body = frame.split('\n').slice(2, -2).map((r) => r.slice(1, -1));
  assert.ok(body.some((l) => l.includes('0.2.3') && l.includes('0.2.4')));
  assert.ok(body.some((l) => l.includes('npm i -g @devmaksi/pi-env@latest')));
  assert.ok(body.some((l) => l.includes('0.2.3 — 2026-10-24')));
  assert.ok(body.some((l) => l.includes('Витрина пакета (npm, pi.dev)')));
});

test('вкладка не делится на две колонки на широком терминале', () => {
  const frame = render({ state: STATE_UP, envs: [], root: '/r', width: 100, height: 20, useColor: false, status: null });
  assert.equal(frame.split('\n')[1].includes('┬'), false);
});

test('кадр вкладки: ровно height строк и не шире width на любой ширине', () => {
  const ui = {
    ...freshUpdateUi(), check: 'ready' as const,
    rows: changelogRows(parseChangelog([
      '## [0.3.0] — 2026-11-01', '', '- стрелки ←/→, тире —, плюс ＋ и · в тексте.',
      '', '## [0.2.9] — 2026-10-30', '', '- второй пункт с — тире.',
    ].join('\n'))),
  };
  for (const width of [46, 62, 80]) {
    const frame = render({ state: { ...STATE_UP, updateUi: ui }, envs: [], root: '/r', width, height: 18, useColor: false, status: null });
    const lines = frame.split('\n');
    assert.equal(lines.length, 18);
    for (const l of lines) assert.equal(visibleWidth(l) <= width, true);
  }
});

test('пустой чейнджлог — строка-заглушка, версии и команда остаются', () => {
  const ui = { ...freshUpdateUi(), check: 'ready' as const, rows: [] };
  const frame = render({ state: { ...STATE_UP, updateUi: ui }, envs: [], root: '/r', width: 80, height: 20, useColor: false, status: null });
  assert.ok(frame.includes('0.2.4'));
  assert.ok(frame.includes('npm i -g @devmaksi/pi-env@latest'));
  assert.ok(frame.includes(t('ru', 'update.changelog.empty', { latest: '0.2.4' })));
});

test('кадр с вкладкой: таб-бар не шире кадра, на широком — полные имена вкладок', () => {
  for (const width of [46, 62, 90]) {
    const frame = render({ state: STATE_UP, envs: [], root: '/r', width, height: 20, useColor: false, status: null });
    assert.equal(visibleWidth(frame.split('\n')[0]) <= width, true);
  }
  const wide = render({ state: STATE_UP, envs: [], root: '/r', width: 90, height: 20, useColor: false, status: null }).split('\n')[0];
  assert.ok(wide.includes('Обновление') && !wide.includes('Обнов '));
});
