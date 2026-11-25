import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { ROW_DELETE } from '../src/state.js';
import { listTrash } from '../src/trash.js';
import type { Term } from '../src/terminal.js';

const dirs: string[] = [];
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'e0'));
  writeFileSync(join(dir, 'e0', 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/**
 * Реальный цикл `run()` на фейковом терминале: удаление → `.trash` → суб-экран корзины →
 * восстановить → удалить совсем. `.trash` в списке окружений не появляется.
 */
async function drive(root: string, keys: string[]): Promise<void> {
  const agent = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  dirs.push(agent);
  const savedAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  let next = 0;
  const term: Term = {
    noColor: true,
    start() {},
    stop() {},
    width: () => 80,
    height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {},
    paint: () => true,
    screenKnown: () => true,
    copy() {},
  };
  try {
    await run(root, term);
  } finally {
    if (savedAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgent;
  }
}

/**
 * ↓ на окружение (первой строкой списка стоит основной агент) → E → вниз до строки «Удалить» (7)
 * → Enter (вопрос) → Enter (в корзину).
 */
const KEYS_DELETE = ['down', 'e', ...Array(ROW_DELETE).fill('down'), 'enter', 'enter'];

test('app: удаление окружения переносит его в .trash, «Корзина (1)» без самой корзины в списке', async () => {
  const root = tmpRoot();
  await drive(root, [...KEYS_DELETE, 'ctrlc']);
  assert.equal(existsSync(join(root, 'e0')), false);
  assert.equal(listTrash(root).length, 1);
});

test('app: суб-экран корзины — Enter восстанавливает окружение, X + Enter удаляет совсем', async () => {
  const root = tmpRoot();
  // удалить → список (курсор 0) → ↓ на «Создать» → ↓ на «Корзина» → Enter → Enter (восстановить)
  await drive(root, [...KEYS_DELETE, 'down', 'down', 'enter', 'enter', 'ctrlc']);
  assert.equal(existsSync(join(root, 'e0', 'settings.json')), true);
  assert.deepEqual(listTrash(root), []);

  // то же удаление, но в корзине: X → Enter (удалить совсем)
  await drive(root, [...KEYS_DELETE, 'down', 'down', 'enter', 'x', 'enter', 'ctrlc']);
  assert.equal(existsSync(join(root, 'e0')), false);
  assert.deepEqual(listTrash(root), []);
});
