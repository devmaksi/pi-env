import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type RunDeps } from '../src/run.js';
import { fileLogger, logFileFor, type DebugLogFn } from '../src/debuglog.js';
import type { Term } from '../src/terminal.js';

const dirs: string[] = [];

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  return dir;
}

/** Корень с одним окружением, у которого битый settings.json. */
function rootWithBrokenEnv(): string {
  const dir = tmpRoot();
  mkdirSync(join(dir, 'demo'));
  writeFileSync(join(dir, 'demo', 'settings.json'), '{битый json');
  return dir;
}

function fakeTerm(keys: string[]): Term {
  let next = 0;
  return {
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
}

/** Прогон `run()` на фейковом терминале; возвращает записанные в журнал `(tag, message)`. */
async function drive(root: string, keys: string[], deps: RunDeps = {}): Promise<string[]> {
  const agent = tmpRoot();
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const lines: string[] = [];
  const given = deps.debugLog;
  const debugLog: DebugLogFn = (tag, message) => {
    lines.push(`${tag}: ${message}`);
    given?.(tag, message);
  };
  try {
    await run(root, fakeTerm(keys), { ...deps, debugLog });
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return lines;
}

test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test('битый settings.json окружения → строка журнала env с именем и текстом ошибки', async () => {
  const lines = await drive(rootWithBrokenEnv(), ['ctrlc']);
  const envLines = lines.filter((l) => l.startsWith('env:'));
  assert.ok(envLines.some((l) => l.includes('demo') && l.includes('settings.json')), JSON.stringify(lines));
});

test('дедуп: несколько клавиш (по два scan на каждую) — одна строка об одной проблеме', async () => {
  const lines = await drive(rootWithBrokenEnv(), ['ArrowDown', 'ArrowUp', 'Tab', 'ctrlc']);
  const envLines = lines.filter((l) => l.startsWith('env:') && l.includes('demo'));
  assert.equal(envLines.length, 1, JSON.stringify(envLines));
});

test('нечитаемый корень → строка журнала scan', async () => {
  const lines = await drive(join(tmpRoot(), 'no-such-root'), ['ctrlc']);
  assert.ok(lines.some((l) => l.startsWith('scan:')), JSON.stringify(lines));
});

test('сбой self-check → строка журнала self-update с текстом ошибки', async () => {
  const lines = await drive(tmpRoot(), ['ctrlc'], {
    selfCheck: async () => {
      throw new Error('реестр недоступен');
    },
  });
  assert.ok(lines.some((l) => l.startsWith('self-update:') && l.includes('реестр недоступен')), JSON.stringify(lines));
});

test('debugLog — fileLogger: запись появляется в <root>/.pi-env.log', async () => {
  const root = rootWithBrokenEnv();
  await drive(root, ['ctrlc'], { debugLog: fileLogger(root) });
  const text = readFileSync(logFileFor(root), 'utf8');
  assert.ok(text.includes('env: demo:'), text);
});

test('без deps.debugLog run() не создаёт <root>/.pi-env.log', async () => {
  const root = rootWithBrokenEnv();
  const agent = tmpRoot();
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    await run(root, fakeTerm(['ArrowDown', 'ctrlc']));
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  assert.equal(existsSync(logFileFor(root)), false);
});
