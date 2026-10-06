import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, reducer, freshCreate, freshEdit, mcpListNames,
  ROW_MCP, ROW_ACTION, ROW_DELETE, formRows,
  type AppState, type Catalog, type CreateState,
} from '../src/state.js';
import type { McpServer } from '../src/mcp.js';

const mcpServers: McpServer[] = [
  { name: 'docs', type: 'http', args: [], env: {}, url: 'https://e/mcp', headers: {}, exposure: 'deferred' },
  { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: {} },
];
const envMcp: McpServer[] = [
  { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'other'], env: {} }, // есть и в main, и в окружении
];
const catalog: Catalog = { providers: [], tools: [], packages: [], skills: [], mcp: mcpServers };
const envs = (n: number) => Array.from({ length: n }, (_, i) => `env${i}`);

function createState(over: Partial<CreateState> = {}): AppState {
  return { ...initialState(catalog), sub: 'create', create: { ...freshCreate(), ...over } };
}
function editState(over: Partial<CreateState> = {}): AppState {
  return { ...initialState(catalog), sub: 'create', create: { ...freshEdit('dev', {}, catalog, envMcp), view: 'mcp', ...over } };
}

test('freshCreate/freshEdit: mcp-поля', () => {
  const c = freshCreate();
  assert.deepEqual(c.mcp, []);
  assert.deepEqual(c.envMcp, []);
  assert.equal(c.mcpAdd, null);
  assert.equal(c.mcpOp, null);
  assert.equal(c.removingMcp, null);
  const e = freshEdit('dev', {}, catalog, envMcp);
  assert.deepEqual(e.envMcp, envMcp);
  assert.deepEqual(e.mcp, []);
  assert.equal(e.mcpAdd, null);
});

test('FORM_ROWS: create 7, edit 8; константы строк', () => {
  assert.equal(formRows('create'), 7);
  assert.equal(formRows('edit'), 8);
  assert.equal(ROW_MCP, 5);
  assert.equal(ROW_ACTION, 6);
  assert.equal(ROW_DELETE, 7);
});

test('Форма: Enter на ROW_MCP — список «mcp»', () => {
  const s = reducer(createState({ cursor: 5 }), 'enter', envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.equal(s.create?.cursor, 0);
});

test('mcpListNames: объединение env + main-only', () => {
  assert.deepEqual(mcpListNames(envMcp, mcpServers), ['fs', 'docs']);
  assert.deepEqual(mcpListNames([], mcpServers), ['docs', 'fs']);
  assert.deepEqual(mcpListNames([], []), []);
});

test('Список edit: Space на main-only (docs) — copy', () => {
  const s = reducer(editState({ cursor: 1 }), 'space', envs(1), true);
  assert.equal(s.create?.view, 'mcp-op');
  assert.deepEqual(s.create?.mcpOp, { name: 'docs', kind: 'copy' });
});

test('mcp-result (create) — envMcp обновлён, назад в «mcp»', () => {
  const docs: McpServer = { ...mcpServers[0] };
  let s = reducer(editState({ cursor: 1 }), 'space', envs(1), true);
  assert.equal(s.create?.view, 'mcp-op');
  s = reducer(s, { type: 'mcp-result', ok: true, message: '', scope: 'create', list: [...envMcp, docs] }, envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.deepEqual(s.create?.envMcp, [...envMcp, docs]);
  assert.equal(s.create?.mcpOp, null);
  assert.equal(s.create?.cursor, 0);
  assert.equal(s.create?.error, null);
});

test('Список edit: Space на запись с обоих (fs) — remove', () => {
  const s = reducer(editState({ cursor: 0 }), 'space', envs(1), true);
  assert.equal(s.create?.view, 'mcp-op');
  assert.deepEqual(s.create?.mcpOp, { name: 'fs', kind: 'remove' });
});

test('Список edit: Space на «＋ Добавить» — форма', () => {
  const s = reducer(editState({ cursor: 2 }), 'space', envs(1), true);
  assert.notEqual(s.create?.mcpAdd, null);
  assert.equal(s.create?.view, 'mcp');
});

test('Список edit: X на запись окружения — confirm-remove', () => {
  let s = reducer(editState({ cursor: 0 }), 'x', envs(1), true);
  assert.equal(s.create?.view, 'mcp-confirm-remove');
  assert.equal(s.create?.removingMcp, 'fs');
  s = reducer(s, 'esc', envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.equal(s.create?.removingMcp, null);
  s = reducer(editState({ cursor: 0 }), 'x', envs(1), true);
  s = reducer(s, 'enter', envs(1), true);
  assert.equal(s.create?.view, 'mcp-op');
  assert.deepEqual(s.create?.mcpOp, { name: 'fs', kind: 'remove' });
});

test('Список edit: X на main-only — бездействие', () => {
  const s0 = editState({ cursor: 1 });
  const s = reducer(s0, 'x', envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.equal(s.create?.removingMcp, null);
});

test('Список edit: клавиши в mcp-op игнорируются', () => {
  const s0 = editState({ cursor: 1 });
  const s1 = reducer(s0, 'space', envs(1), true);
  assert.equal(s1.create?.view, 'mcp-op');
  assert.deepEqual(reducer(s1, 'up', envs(1), true), s1);
  assert.deepEqual(reducer(s1, 'esc', envs(1), true), s1);
});

test('mcpAdd: ввод, submit, результат', () => {
  let s = reducer(editState({ cursor: 2 }), 'space', envs(1), true);
  assert.notEqual(s.create?.mcpAdd, null);
  for (const ch of ['d', 'o', 'c', 's', '2']) s = reducer(s, ch, envs(1), true);
  s = reducer(s, 'down', envs(1), true);
  s = reducer(s, 'down', envs(1), true); // «Команда»
  for (const ch of ['n', 'p', 'x']) s = reducer(s, ch, envs(1), true);
  for (let i = 0; i < 6; i++) s = reducer(s, 'down', envs(1), true); // «Добавить»
  s = reducer(s, 'enter', envs(1), true);
  assert.equal(s.create?.view, 'mcp-submitting');
  assert.equal(s.create?.mcpAdd?.name, 'docs2');
  const docs2: McpServer = { name: 'docs2', type: 'stdio', command: 'npx', args: [], env: {} };
  s = reducer(s, { type: 'mcp-result', ok: true, message: '', scope: 'create', list: [...envMcp, docs2] }, envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.equal(s.create?.mcpAdd, null);
  assert.deepEqual(s.create?.envMcp, [...envMcp, docs2]);
});

test('mcpAdd: esc — закрыть форму, назад в список', () => {
  let s = reducer(editState({ cursor: 2 }), 'space', envs(1), true);
  s = reducer(s, 'esc', envs(1), true);
  assert.equal(s.create?.mcpAdd, null);
  assert.equal(s.create?.view, 'mcp');
});

test('Список create: Space — toggle в c.mcp', () => {
  let s = createState({ view: 'mcp', cursor: 0 });
  s = reducer(s, 'space', envs(1), true);
  assert.deepEqual(s.create?.mcp, ['docs']);
  s = reducer(s, 'space', envs(1), true);
  assert.deepEqual(s.create?.mcp, []);
});

test('Список create: X — бездействие', () => {
  const s0 = createState({ view: 'mcp', cursor: 0 });
  const s = reducer(s0, 'x', envs(1), true);
  assert.equal(s.create?.view, 'mcp');
  assert.equal(s.create?.removingMcp, null);
});

test('edit-start: envMcp из action', () => {
  const s = reducer(initialState(catalog), { type: 'edit-start', name: 'dev', settings: {}, mcp: envMcp }, envs(1), true);
  assert.deepEqual(s.create?.envMcp, envMcp);
});
