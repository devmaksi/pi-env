import { test } from 'node:test';
import assert from 'node:assert';
import { render } from '../src/render.js';
import { initialState, freshMcpForm, freshCreate, freshEdit, type AppState, type Catalog } from '../src/state.js';
import { Environment } from '../src/environments.js';
import type { McpServer } from '../src/mcp.js';

// Колонка, где нарисован последний символ строки (все символы по 1 клетке).
function lastCol(line: string, cells: (ch: string) => number, width: number): number {
  let col = 1;
  let last = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*[a-zA-Z]/.exec(line.slice(i));
      if (m) {
        if (m[0].endsWith('H')) col = Number(m[0].slice(2, -1).split(';')[1] ?? 1);
        i += m[0].length;
        continue;
      }
    }
    if (col > width) col = 1;
    last = col;
    col += cells(line[i]);
    i++;
  }
  return last;
}

// Инвариант кадра: в конце каждой строки SGR-состояние чистое.
function assertBalancedRowEnds(frame: string): void {
  for (const line of frame.split('\n')) {
    let active: number[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] !== '\x1b') {
        i++;
        continue;
      }
      const m = /^\x1b\[([0-9;]*)m/.exec(line.slice(i));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      active = m[1] === '' || m[1] === '0' ? [] : m[1].split(';').map(Number);
    }
    assert.ok(active.length === 0, `строка заканчивается с активным стилем: ${JSON.stringify(line)}`);
  }
}

const mcpServers: McpServer[] = [
  { name: 'docs', type: 'http', args: [], env: {}, url: 'https://e/mcp', headers: {}, exposure: 'deferred' },
  { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: {} },
];
const envMcp: McpServer[] = [{ name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'other'], env: {} }];
const catalog: Catalog = { providers: [], tools: [], packages: [], skills: [], mcp: mcpServers };
const base = { root: '/root', useColor: false, status: null };
const envs: Environment[] = [];

function mcpState(over: Partial<AppState> = {}): AppState {
  return { ...initialState(catalog), tab: 'mcp', selected: 0, ...over };
}

test('Вкладка: список, кнопка, инфо-панель', () => {
  const s = render({ state: mcpState(), envs, width: 100, height: 14, ...base });
  const lines = s.split('\n');
  assert.equal(lines.length, 14);
  for (const line of lines) assert.equal(lastCol(line, () => 1, 100), 100);
  assert.ok(s.includes('MCP (основной агент)'));
  assert.ok(s.includes('> docs'));
  assert.ok(s.includes('Добавить'));
  assert.ok(s.includes('Тип: http'));
  assert.ok(s.includes('URL: https://e/mcp'));
});

test('Вкладка: пусто — пометка и кнопка', () => {
  const state = mcpState();
  state.catalog = { ...catalog, mcp: [] };
  const s = render({ state, envs, width: 100, height: 14, ...base });
  assert.ok(s.includes('— пусто —'));
  assert.ok(s.includes('Добавить'));
});

test('Вкладка: busy — submitting и confirm-remove', () => {
  const submitting = mcpState({ mcp: { view: 'submitting', form: freshMcpForm(), removing: null } });
  assert.ok(render({ state: submitting, envs, width: 100, height: 14, ...base }).includes('Добавление:'));
  const confirm = mcpState({ mcp: { view: 'confirm-remove', form: null, removing: 'docs' } });
  assert.ok(render({ state: confirm, envs, width: 100, height: 14, ...base }).includes('Удалить MCP «docs»?'));
});

test('Форма stdio: строки, caret', () => {
  const form = { ...freshMcpForm(), name: 'fs', caret: 2 };
  const s = render({ state: mcpState({ mcp: { view: 'add', form, removing: null } }), envs, width: 100, height: 16, ...base });
  assert.ok(s.includes('Добавление в основной агент'));
  assert.ok(s.includes('Имя: fs▌'));
  assert.ok(s.includes('Команда: '));
  assert.ok(s.includes('Аргументы: '));
  assert.ok(s.includes('Добавить'));
  const http = { ...freshMcpForm(), type: 'http' as const };
  const s2 = render({ state: mcpState({ mcp: { view: 'add', form: http, removing: null } }), envs, width: 100, height: 16, ...base });
  assert.ok(s2.includes('URL: '));
  assert.ok(!s2.includes('Аргументы: '));
});

test('Форма: выбор типа', () => {
  const form = { ...freshMcpForm(), select: 'type' as const, cursor: 1 };
  const s = render({ state: mcpState({ mcp: { view: 'add', form, removing: null } }), envs, width: 100, height: 16, ...base });
  assert.ok(s.includes('> http (url)'));
});

test('Список edit в форме: union, маркеры, кнопка', () => {
  const create = { ...freshEdit('dev', {}, catalog, envMcp), view: 'mcp' as const, cursor: 0 };
  const state = { ...initialState(catalog), sub: 'create' as const, create };
  const s = render({ state, envs, width: 100, height: 14, ...base });
  assert.ok(s.includes('✓ fs'));
  assert.ok(s.includes('main'));
  assert.ok(s.includes('＋ Добавить'));
  const createMode = { ...freshCreate(), view: 'mcp' as const, cursor: 0 };
  const state2 = { ...initialState(catalog), sub: 'create' as const, create: createMode };
  const s2 = render({ state: state2, envs, width: 100, height: 14, ...base });
  assert.ok(!s2.includes('＋ Добавить'));
});

test('Список edit в форме: инфо-панель и «В окружении»', () => {
  const create = { ...freshEdit('dev', {}, catalog, envMcp), view: 'mcp' as const, cursor: 0 };
  const state = { ...initialState(catalog), sub: 'create' as const, create };
  const s = render({ state, envs, width: 100, height: 14, ...base });
  assert.ok(s.includes('Тип: stdio'));
  assert.ok(s.includes('В окружении: ✓'));
});

test('Детализация окружения: MCP', () => {
  const envsMcp: Environment[] = [
    { name: 'dev', path: '/root/dev', details: { hasSettings: false, model: null, tools: [], skills: [], packages: [], mcp: ['browsermcp'] } },
  ];
  const s = render({ state: initialState(catalog), envs: envsMcp, width: 62, height: 16, ...base });
  assert.ok(s.includes('MCP: 1'));
  assert.ok(s.includes('browsermcp'));
});

test('ANSI не обрывается (useColor) — вкладка и форма', () => {
  const tab = render({ state: mcpState(), envs, width: 100, height: 14, useColor: true, status: null });
  assertBalancedRowEnds(tab);
  const form = mcpState({ mcp: { view: 'add', form: { ...freshMcpForm(), name: 'fs', caret: 2 }, removing: null } });
  assertBalancedRowEnds(render({ state: form, envs, width: 100, height: 16, useColor: true, status: null }));
});
