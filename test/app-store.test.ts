import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import type { Term } from '../src/terminal.js';
import { t } from '../src/i18n.js';
import { listTrash } from '../src/trash.js';

/** Фейковый терминал: собирает строки кадров, клавиши — из списка. */
function fakeTerm(keys: string[], painted: string[]): Term {
  let next = 0;
  return {
    noColor: true,
    start() {},
    stop() {},
    width: () => 90,
    height: () => 32,
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

/** Язык закреплён, как в других сквозных тестах (на CI `LANG=C.UTF-8` → «en»). */
function tmpRoot(storeDir?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pi-env-app-store-'));
  writeFileSync(join(root, '.pi-env.json'), JSON.stringify(storeDir === undefined ? { language: 'ru' } : { language: 'ru', storeDir }));
  return root;
}

function envDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultProvider: 'p', defaultModel: 'm' }, null, 2));
  return dir;
}

function storeFile(root: string): string {
  const dir = join(root, '.store', 'models');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'models.json');
  writeFileSync(file, JSON.stringify({ providers: { p: { models: { m: {}, other: {} } } } }));
  return file;
}

async function drive(root: string, keys: string[], agent?: string): Promise<string> {
  const savedAgent = process.env.PI_CODING_AGENT_DIR;
  const painted: string[] = [];
  process.env.PI_CODING_AGENT_DIR = agent ?? join(root, 'no-such-agent');
  try {
    await run(root, fakeTerm(keys, painted), {});
  } finally {
    if (savedAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgent;
  }
  return painted.join('\n');
}

test('сквозной: «R» чинит битую связь с хранилищем и чинит ⚠ в списке', async () => {
  const root = tmpRoot('.store');
  const dir = envDir(root, 'e0');
  const file = storeFile(root);
  symlinkSync(join(root, 'нет-такого'), join(dir, 'models.json')); // битый симлинк
  const frame = await drive(root, ['down', 'r', 'ctrlc']); // курсор с основной строки на e0
  assert.ok(lstatSync(join(dir, 'models.json')).isSymbolicLink());
  assert.equal(readFileSync(join(dir, 'models.json'), 'utf8'), readFileSync(file, 'utf8'));
  assert.ok(frame.includes(t('ru', 'status.store-repaired')), frame.slice(-1500));
});

test('сквозной: «R» на окружении со своей копией каталога ничего не меняет', async () => {
  const root = tmpRoot('.store');
  const dir = envDir(root, 'e0');
  writeFileSync(join(dir, 'models.json'), '{"own":true}');
  storeFile(root);
  const frame = await drive(root, ['down', 'r', 'ctrlc']);
  assert.ok(!frame.includes(t('ru', 'status.store-repaired')), frame.slice(-1500));
  assert.ok(!lstatSync(join(dir, 'models.json')).isSymbolicLink());
  assert.equal(listTrash(root).length, 0);
});

test('сквозной: курсор на «Создать» — «R» не трогает окружения', async () => {
  const root = tmpRoot('.store');
  envDir(root, 'e0');
  const file = storeFile(root);
  await drive(root, ['down', 'down', 'down', 'r', 'ctrlc']); // до строки «Создать»
  assert.equal(readFileSync(file, 'utf8').includes('providers'), true);
  assert.equal(existsSync(join(root, '.trash')), false);
});

/** Каталог main-агента вне корня окружений: из него создаётся общий файл каталога. */
function tmpAgent(catalog: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pi-env-agent-'));
  writeFileSync(join(dir, 'models.json'), JSON.stringify(catalog));
  return dir;
}

test('сквозной: включение хранилища в форме — симлинк, своя копия в корзине файлов', async () => {
  const root = tmpRoot('.store');
  const dir = envDir(root, 'e0');
  writeFileSync(join(dir, 'models.json'), '{"own":true}');
  const agent = tmpAgent({ providers: { p: { models: { m: {} } } } });
  // курсор на e0 → E → три строки вниз («Хранилище») → Enter (вопрос) → Enter (подтверждение)
  const frame = await drive(root, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  const link = join(dir, 'models.json');
  assert.ok(lstatSync(link).isSymbolicLink(), 'models.json — симлинк');
  assert.equal(readFileSync(link, 'utf8'), readFileSync(storeFileOf(root), 'utf8'));
  const entries = listTrash(root);
  assert.equal(entries.length, 1, JSON.stringify(entries));
  assert.equal(entries[0]!.kind, 'file');
  assert.ok(frame.includes(t('ru', 'status.store-linked')), frame.slice(-1500));
});

test('сквозной: «Корзина» — X + Enter удаляет файловую запись совсем', async () => {
  const root = tmpRoot('.store');
  const dir = envDir(root, 'e0');
  writeFileSync(join(dir, 'models.json'), '{"own":true}');
  const agent = tmpAgent({ providers: { p: { models: { m: {} } } } });
  await drive(root, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  assert.equal(listTrash(root).length, 1);
  // список: основная строка, e0, «Создать», «Корзина» → три «вниз»; Enter — суб-экран; X, Enter — подтверждение
  await drive(root, ['down', 'down', 'down', 'enter', 'x', 'enter', 'ctrlc'], agent);
  assert.equal(listTrash(root).length, 0);
});

function storeFileOf(root: string): string {
  return join(root, '.store', 'models', 'models.json');
}
