import { test } from 'node:test';
import assert from 'node:assert';
import { tabBarPlan, tabBarRow, visibleWidth, wrapVisible } from '../src/render.js';
import { freshUpdateUi, initialState, type SelfUpdate, type Tab } from '../src/state.js';

const INFO: SelfUpdate = { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 };
const STATE_UP = { ...initialState(), tab: 'update' as Tab, selfUpdate: INFO, updateUi: freshUpdateUi() };

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
