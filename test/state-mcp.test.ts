import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, listLength, freshMcpForm, type AppState, type ReducerCtx, type Catalog } from '../src/state.js';
import type { McpServer } from '../src/mcp.js';
import { t } from '../src/i18n.js';

/** Контекст reducer: имена окружений + раскладка. */
const rc = (names: string[], two = true): ReducerCtx => ({ envNames: names, twoColumns: two });

const mcpServers: McpServer[] = [
  { name: 'docs', type: 'http', args: [], env: {}, url: 'https://e/mcp', headers: {}, exposure: 'deferred' },
  { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: {} },
];
const catalog: Catalog = { providers: [], tools: [], packages: [], skills: [], mcp: mcpServers };
const envs = (n: number) => Array.from({ length: n }, (_, i) => `env${i}`);

function tabState(over: Partial<AppState> = {}): AppState {
  return { ...initialState(catalog), tab: 'mcp', selected: 0, ...over };
}

test('listLength: mcp — серверы + «Добавить»', () => {
  assert.equal(listLength('mcp', 0, 0, 2), 3);
});

test('initialState: mcp null', () => {
  assert.equal(initialState().mcp, null);
  assert.equal(initialState(catalog).mcp, null);
});

test('Enter на «Добавить» (selected = n) — форма', () => {
  const s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'add');
  assert.equal(s.mcp?.form?.name, '');
});

test('Enter на сервере — только выбор (mcp остаётся null)', () => {
  const s = reducer(tabState({ selected: 0 }), 'enter', rc(envs(1)));
  assert.equal(s.mcp, null);
});

test('↑↓ в списке — кламп на границах', () => {
  let s = reducer(tabState({ selected: 0 }), 'up', rc(envs(1)));
  assert.equal(s.selected, 0);
  s = reducer(tabState({ selected: 2 }), 'down', rc(envs(1)));
  assert.equal(s.selected, 2);
  s = reducer(tabState({ selected: 0 }), 'down', rc(envs(1)));
  assert.equal(s.selected, 1);
});

test('Форма: ввод имени, caret, backspace', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'f', rc(envs(1)));
  s = reducer(s, 's', rc(envs(1)));
  assert.equal(s.mcp?.form?.name, 'fs');
  s = reducer(s, 'left', rc(envs(1)));
  assert.equal(s.mcp?.form?.caret, 1);
  s = reducer(s, 'backspace', rc(envs(1)));
  assert.equal(s.mcp?.form?.name, 'f');
  assert.equal(s.mcp?.form?.caret, 0);
});

test('Форма: Тип — выбор из списка', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1))); // строка «Тип»
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.form?.select, 'type');
  assert.equal(s.mcp?.form?.cursor, 0);
  s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.form?.type, 'http');
  assert.equal(s.mcp?.form?.select, null);
  assert.ok(s.mcp?.form?.cursor !== undefined && s.mcp.form.cursor <= 5);
});

test('Форма: exposure — 4 варианта, esc из выбора не меняет значение', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (let i = 0; i < 7; i++) s = reducer(s, 'down', rc(envs(1))); // строка «Exposure» (stdio: 8-я)
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.form?.select, 'exposure');
  s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.form?.exposure, 'deferred');
  s = reducer(s, 'enter', rc(envs(1))); // открыть выбор снова
  assert.equal(s.mcp?.form?.select, 'exposure');
  assert.equal(s.mcp?.form?.cursor, 1); // курсор на текущем
  s = reducer(s, 'esc', rc(envs(1)));
  assert.equal(s.mcp?.form?.select, null);
  assert.equal(s.mcp?.form?.exposure, 'deferred');
});

test('Форма: валидация на «Добавить» — ошибка пустого имени', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (let i = 0; i < 8; i++) s = reducer(s, 'down', rc(envs(1))); // строка «Добавить»
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'add');
  assert.equal(s.mcp?.form?.error, t('ru', 'err.mcp-name-empty'));
});

test('Форма: submit — view submitting', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (const ch of ['f', 's', '2']) s = reducer(s, ch, rc(envs(1))); // имя fs2
  s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1))); // строка «Команда»
  for (const ch of ['n', 'p', 'x']) s = reducer(s, ch, rc(envs(1)));
  for (let i = 0; i < 6; i++) s = reducer(s, 'down', rc(envs(1))); // строка «Добавить»
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'submitting');
  assert.equal(s.mcp?.form?.name, 'fs2');
});

test('mcp-result (main) — закрыть вкладку', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (const ch of ['f', 's', '2']) s = reducer(s, ch, rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));
  for (const ch of ['n', 'p', 'x']) s = reducer(s, ch, rc(envs(1)));
  for (let i = 0; i < 6; i++) s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'submitting');
  s = reducer(s, { type: 'mcp-result', ok: true, message: 'ok', scope: 'main' }, rc(envs(1)));
  assert.equal(s.mcp, null);
});

test('X на сервере — confirm-remove → removing → результат', () => {
  let s = reducer(tabState({ selected: 0 }), 'x', rc(envs(1)));
  assert.equal(s.mcp?.view, 'confirm-remove');
  assert.equal(s.mcp?.removing, 'docs');
  s = reducer(s, 'esc', rc(envs(1)));
  assert.equal(s.mcp, null);
  s = reducer(tabState({ selected: 0 }), 'x', rc(envs(1)));
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'removing');
  s = reducer(s, { type: 'mcp-result', ok: true, message: 'ok', scope: 'main' }, rc(envs(1)));
  assert.equal(s.mcp, null);
});

test('ESC из формы — закрыть вкладку', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'add');
  s = reducer(s, 'esc', rc(envs(1)));
  assert.equal(s.mcp, null);
});

test('TAB сбрасывает mcp', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  assert.ok(s.mcp !== null);
  s = reducer(s, 'tab', rc(envs(1)));
  assert.equal(s.tab, 'settings');
  assert.equal(s.mcp, null);
});

test('freshMcpForm: значения по умолчанию', () => {
  const f = freshMcpForm();
  assert.equal(f.name, '');
  assert.equal(f.type, 'stdio');
  assert.equal(f.cursor, 0);
  assert.equal(f.caret, 0);
  assert.equal(f.select, null);
  assert.equal(f.error, null);
});
