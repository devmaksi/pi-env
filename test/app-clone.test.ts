import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { t } from '../src/i18n.js';
import { DEFAULT_APP_SETTINGS, saveAppSettings } from '../src/appsettings.js';
import type { Term } from '../src/terminal.js';

const dirs: string[] = [];
function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  return dir;
}

/** Корень с закреплённым русским языком (иначе кадры зависят от локали раннера). */
function tmpRootRu(): string {
  const dir = tmpRoot();
  saveAppSettings(dir, { ...DEFAULT_APP_SETTINGS, language: 'ru' });
  return dir;
}

/** Окружение с файлами, которых нет в каталоге main-агента. */
function makeEnv(root: string, name: string): void {
  const dir = join(root, name);
  mkdirSync(join(dir, 'skills', 'one'), { recursive: true });
  mkdirSync(join(dir, 'own'), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ servers: { a: { type: 'stdio', command: 'x' } } }));
  writeFileSync(join(dir, 'models.json'), '{}');
  writeFileSync(join(dir, 'skills', 'one', 'SKILL.md'), '# skill');
  writeFileSync(join(dir, 'own', 'notes.txt'), 'mine');
}

/** Относительный набор путей и содержимое дерева. */
function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel === '' ? e.name : rel + '/' + e.name;
    if (e.isDirectory()) Object.assign(out, tree(join(dir, e.name), r));
    else out[r] = readFileSync(join(dir, e.name), 'utf8');
  }
  return out;
}

const names = (root: string): string[] => readdirSync(root).filter((n) => !n.startsWith('.')).sort();

/** Фейковый терминал: собирает строки кадров, клавиши — из списка. */
function fakeTerm(keys: string[], painted: string[]): Term {
  let next = 0;
  return {
    noColor: true,
    start() {},
    stop() {},
    width: () => 90,
    height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {},
    paint: (p) => {
      painted.push(...(p.kind === 'full' ? p.lines : p.rows.map((r) => r.text)));
      return true;
    },
    screenKnown: () => true,
    copy() {},
  };
}

async function drive(root: string, keys: string[]): Promise<string[]> {
  const agent = tmpRoot();
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  // дочерний `pi` в тесте недопустим: если клавиша не обработана и Enter запустит
  // окружение, spawn обязан упасть сразу (ENOENT), а не перехватывать терминал
  const savedPath = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  const painted: string[] = [];
  try {
    await run(root, fakeTerm(keys, painted));
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
    process.env.PATH = savedPath;
  }
  return painted;
}

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('C → Enter: копия окружения на диске, имя копии в списке и статус', async () => {
  const root = tmpRootRu();
  makeEnv(root, 'src');
  const painted = await drive(root, ['c', 'enter', 'ctrlc']);
  assert.equal(existsSync(join(root, 'src-copy')), true);
  assert.deepEqual(tree(join(root, 'src-copy')), tree(join(root, 'src')));
  assert.deepEqual(names(root), ['src', 'src-copy']);
  assert.equal(existsSync(join(root, '.trash')), false); // клон — не корзина
  const frame = painted.join('\n');
  assert.ok(frame.includes(t('ru', 'status.env-cloned', { name: 'src-copy' })), frame);
  assert.ok(frame.includes(t('ru', 'clone.title')), frame); // суб-экран был показан
});

test('C на строке «Создать» — ничего не происходит, каталогов не прибавилось', async () => {
  const root = tmpRootRu();
  makeEnv(root, 'src');
  await drive(root, ['down', 'c', 'ctrlc']);
  assert.deepEqual(names(root), ['src']);
});

test('C на другой вкладке — клонирование не открывается', async () => {
  const root = tmpRootRu();
  makeEnv(root, 'src');
  const painted = await drive(root, ['tab', 'c', 'ctrlc']);
  assert.deepEqual(names(root), ['src']);
  assert.ok(!painted.join('\n').includes(t('ru', 'clone.title')), painted.join('\n'));
});

test('клонирование в занятое имя: текст ошибки в статусе, окружение не тронуто', async () => {
  const root = tmpRootRu();
  makeEnv(root, 'src');
  makeEnv(root, 'src-copy');
  writeFileSync(join(root, 'src-copy', 'marker.txt'), 'KEEP');
  const painted = await drive(root, ['c', 'enter', 'ctrlc']);
  assert.deepEqual(names(root), ['src', 'src-copy']);
  assert.equal(readFileSync(join(root, 'src-copy', 'marker.txt'), 'utf8'), 'KEEP');
  const frame = painted.join('\n');
  assert.ok(frame.includes(t('ru', 'err.name-exists')), frame);
});

test('имя копии набирается печатными клавишами, включая `c` и `e`', async () => {
  const root = tmpRootRu();
  makeEnv(root, 'src');
  const erase = Array<string>(8).fill('backspace'); // дефолтное имя «src-copy»
  await drive(root, ['c', ...erase, 'e', 'c', 'h', 'o', 'enter', 'ctrlc']);
  assert.deepEqual(names(root), ['echo', 'src']);
});
