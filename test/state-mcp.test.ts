import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, listLength, freshMcpForm, enumValues, MCP_TYPES, MCP_EXPOSURES, TEXT_ROWS, type AppState, type ReducerCtx, type Catalog } from '../src/state.js';
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

test('Форма: «Тип» — ←/→ меняют значение со циклом, курсор на строке', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));                       // строка «Тип» (stdio: индекс 1)
  assert.equal(s.mcp?.form?.cursor, 1);
  s = reducer(s, 'right', rc(envs(1)));
  assert.equal(s.mcp?.form?.type, 'http');
  assert.equal(s.mcp?.form?.cursor, 1);                      // курсор не прыгнул
  s = reducer(s, 'right', rc(envs(1)));                      // цикл по концу списка
  assert.equal(s.mcp?.form?.type, 'stdio');
  s = reducer(s, 'left', rc(envs(1)));                       // цикл через начало
  assert.equal(s.mcp?.form?.type, 'http');
});

test('Форма: «Exposure» — 4 значения по ←/→ со циклом в обе стороны', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (let i = 0; i < 7; i++) s = reducer(s, 'down', rc(envs(1)));  // stdio: «Exposure» — индекс 7
  assert.equal(s.mcp?.form?.exposure, 'codemode');
  s = reducer(s, 'left', rc(envs(1)));
  assert.equal(s.mcp?.form?.exposure, 'hidden');
  for (let i = 0; i < 4; i++) s = reducer(s, 'right', rc(envs(1)));
  assert.equal(s.mcp?.form?.exposure, 'hidden');            // цикл: 4 шага → тот же цикл
  assert.equal(s.mcp?.form?.cursor, 7);                     // и курсор по-прежнему на строке
});

test('Форма: ↑/↓ на enum-строке значение не меняют — только переход по строкам', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));                       // «Тип»
  const before = s.mcp!.form!;
  s = reducer(s, 'down', rc(envs(1)));
  assert.equal(s.mcp?.form?.type, before.type);
  assert.equal(s.mcp?.form?.cursor, 2);                      // «Команда»
  s = reducer(s, 'up', rc(envs(1)));
  assert.equal(s.mcp?.form?.cursor, 1);
  assert.equal(s.mcp?.form?.type, before.type);
});

test('Форма: Enter на enum-строке — не список и не submit', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));                       // «Тип»
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'add');                           // submit (submitting) не случился
  assert.equal(s.mcp?.form?.type, 'stdio');
  assert.equal(s.mcp?.form?.cursor, 1);                            // курсор не ушёл в список значений
  for (let i = 0; i < 6; i++) s = reducer(s, 'down', rc(envs(1)));  // stdio: «Exposure» — индекс 7
  s = reducer(s, 'enter', rc(envs(1)));
  assert.equal(s.mcp?.view, 'add');
  assert.equal(s.mcp?.form?.exposure, 'codemode');
  assert.equal(s.mcp?.form?.cursor, 7);                             // и здесь курсор остался на строке
});

test('Форма: смена «Типа» перестраивает набор строк, курсор остаётся на «Тип»', () => {
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  for (const ch of ['f', 's']) s = reducer(s, ch, rc(envs(1)));    // имя «fs»
  s = reducer(s, 'down', rc(envs(1)));                       // «Тип» (индекс 1)
  s = reducer(s, 'right', rc(envs(1)));                      // → http: набор строк 6 вместо 9
  assert.equal(s.mcp?.form?.type, 'http');
  assert.equal(s.mcp?.form?.cursor, 1);                      // курсор не сдвинулся перестройкой
  s = reducer(s, 'down', rc(envs(1)));                       // следующая строка http-набора — «URL»
  s = reducer(s, 'u', rc(envs(1)));
  assert.equal(s.mcp?.form?.url, 'u');
  assert.equal(s.mcp?.form?.name, 'fs');
  for (let i = 0; i < 3; i++) s = reducer(s, 'down', rc(envs(1)));
  assert.equal(s.mcp?.form?.cursor, 5);                      // «Добавить» http: кламп, не выход за набор
});

test('Форма: UI-поля `select` больше нет; esc закрывает форму', () => {
  const f = freshMcpForm() as unknown as Record<string, unknown>;
  assert.equal('select' in f, false);
  let s = reducer(tabState({ selected: 2 }), 'enter', rc(envs(1)));
  s = reducer(s, 'down', rc(envs(1)));
  s = reducer(s, 'right', rc(envs(1)));                       // значение изменено
  s = reducer(s, 'esc', rc(envs(1)));
  assert.equal(s.mcp, null);                                  // Esc — выход из формы, не «назад из списка»
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
  assert.equal(f.error, null);
});

test('enumValues: «Тип» и «Exposure» — закрытые списки, текстовые строки и «Добавить» — null', () => {
  assert.deepEqual([...enumValues('type')!], [...MCP_TYPES]);
  assert.deepEqual([...enumValues('exposure')!], [...MCP_EXPOSURES]);
  for (const row of TEXT_ROWS) assert.equal(enumValues(row), null);
  assert.equal(enumValues('action'), null);
  assert.equal(enumValues('нет-такой-строки'), null);
});

// --- живой статус MCP на вкладке ---

test('initialState: mcpCheck idle, mcpLive null', () => {
  assert.equal(initialState(catalog).mcpCheck, 'idle');
  assert.equal(initialState(catalog).mcpLive, null);
});

test('R на вкладке «MCP» (список) — запуск проверки', () => {
  const next = reducer(tabState(), 'R', rc(envs(0)));
  assert.equal(next.mcpCheck, 'checking');
});

test('R во время проверки — состояние не меняется (второй запуск не запускается)', () => {
  const s = tabState({ mcpCheck: 'checking' });
  const next = reducer(s, 'R', rc(envs(0)));
  assert.equal(next.mcpCheck, 'checking');
});

test('R на другой вкладке — игнор', () => {
  const next = reducer({ ...initialState(catalog), tab: 'envs' }, 'R', rc(envs(1)));
  assert.equal(next.mcpCheck, 'idle');
});

test('mcp-live-result (main) — отчёт готов, статус done', () => {
  const report = { servers: [{ name: 'fs', scope: 'global', source: '/a', enabled: true, exposure: 'codemode', transport: 'npx', state: 'connected' as const, tools: ['read'] }], errors: [] };
  const next = reducer(tabState({ mcpCheck: 'checking' }), { type: 'mcp-live-result', ok: true, message: '', scope: 'main', report }, rc(envs(0)));
  assert.equal(next.mcpCheck, 'done');
  assert.deepEqual(next.mcpLive, report);
});

test('mcp-live-result (main) с null — статус error, прежний отчёт остаётся', () => {
  const prev = { servers: [], errors: [] };
  const next = reducer(tabState({ mcpCheck: 'checking', mcpLive: prev }), { type: 'mcp-live-result', ok: false, message: 'boom', scope: 'main', report: null }, rc(envs(0)));
  assert.equal(next.mcpCheck, 'error');
  assert.deepEqual(next.mcpLive, prev);
});
