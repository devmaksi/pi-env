import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { t } from '../src/i18n.js';
import { DEFAULT_APP_SETTINGS, saveAppSettings } from '../src/appsettings.js';
import type { Term } from '../src/terminal.js';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Корень с одним окружением и закреплённым русским (иначе кадры зависят от локали раннера). */
function tmpRootRu(): string {
  const dir = tmpDir();
  mkdirSync(join(dir, 'e0'));
  writeFileSync(join(dir, 'e0', 'settings.json'), JSON.stringify({ defaultModel: 'm' }));
  saveAppSettings(dir, { ...DEFAULT_APP_SETTINGS, language: 'ru' });
  return dir;
}

/** Каталог main-агента: settings.json с полями, которых pi-env не знает. */
function tmpAgent(): string {
  const dir = tmpDir();
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({
    defaultProvider: 'cpp', defaultModel: 'm1', theme: 'solarized', enableSkillCommands: false,
  }, null, 2));
  mkdirSync(join(dir, 'extensions'), { recursive: true });
  writeFileSync(join(dir, 'extensions', 'tool.ts'), 'TOOL');
  return dir;
}

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

async function drive(root: string, agent: string, keys: string[]): Promise<string[]> {
  const savedAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  // дочерний `pi`/`npm` в тесте недопустимы: сорванный клавишами запуск обязан упасть сразу
  const savedPath = process.env.PATH;
  process.env.PATH = '/usr/bin:/bin';
  const painted: string[] = [];
  try {
    await run(root, fakeTerm(keys, painted));
  } finally {
    if (savedAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgent;
    process.env.PATH = savedPath;
  }
  return painted;
}

/** E на основной строке (курсор на ней) → шесть ↓ до «Сохранить» → Enter. */
const KEYS_SAVE = ['e', 'down', 'down', 'down', 'down', 'down', 'down', 'enter'];

test('app: сохранение формы основного агента не теряет незнакомые поля settings.json', async () => {
  const root = tmpRootRu();
  const agent = tmpAgent();
  const painted = await drive(root, agent, [...KEYS_SAVE, 'ctrlc']);
  const settings = JSON.parse(readFileSync(join(agent, 'settings.json'), 'utf8'));
  assert.equal(settings.theme, 'solarized');
  assert.equal(settings.enableSkillCommands, false);
  assert.equal(settings.defaultProvider, 'cpp');
  assert.equal(settings.defaultModel, 'm1');
  // каталог агента не переименован и не переехал в корзину
  assert.ok(existsSync(join(agent, 'extensions', 'tool.ts')));
  assert.equal(existsSync(join(root, '.trash')), false);
  assert.ok(painted.join('\n').includes(t('ru', 'form.updated', { v: 'm1' })) ||
    painted.join('\n').includes(t('ru', 'form.save')));
});

test('app: в форме основного агента нет строки «Удалить», удаление недоступно', async () => {
  const root = tmpRootRu();
  const agent = tmpAgent();
  const painted = await drive(root, agent, ['e', ...Array(9).fill('down'), 'enter', 'enter', 'ctrlc']);
  const frame = painted.join('\n');
  assert.ok(frame.includes(t('ru', 'form.save')), frame);
  assert.ok(!frame.includes(t('ru', 'form.delete')), frame);
  assert.ok(existsSync(agent));
  assert.equal(existsSync(join(root, '.trash')), false);
});
