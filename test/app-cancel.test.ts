import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, type RunDeps } from '../src/run.js';
import type { CmdResult, RunFn } from '../src/cmd.js';
import type { Term } from '../src/terminal.js';
import { saveAppSettings, DEFAULT_APP_SETTINGS } from '../src/appsettings.js';
import { t } from '../src/i18n.js';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  return dir;
}
/**
 * Корень с закреплённым языком интерфейса. Сквозной прогон `run()` без настроек
 * берёт язык из системной локали: у GitHub-раннера `LANG=C.UTF-8` → «en», и
 * русские строки статуса/кадра перестают находиться тестом.
 */
function root(): string {
  const dir = tmpDir();
  mkdirSync(join(dir, 'e0'));
  saveAppSettings(dir, { ...DEFAULT_APP_SETTINGS, language: 'ru' });
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

interface Launch {
  cmd: string;
  args: string[];
  signal: AbortSignal;
}

/** Процесс, который не завершается сам: ответ только по сигналу отмены. */
function hangingCmd(log: Launch[]): RunFn {
  return (cmd, args, timeoutMs, opts = {}) => {
    const signal = opts.signal ?? new AbortController().signal;
    log.push({ cmd, args, signal });
    return new Promise<CmdResult>((resolve) => {
      signal.addEventListener('abort', () => {
        resolve({ ok: false, stdout: '', stderr: '', cancelled: true, timedOut: false, timeoutMs });
      }, { once: true });
    });
  };
}

/**
 * Реальный цикл `run()` на фейковом терминале с фейковым слоем процессов:
 * возвращает кадр-тексты и то, какие процессы были запущены.
 */
async function drive(keys: string[], deps: RunDeps): Promise<{ painted: string[]; launches: Launch[] }> {
  const rt = root();
  const agent = tmpDir();
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const launches: Launch[] = [];
  const painted: string[] = [];
  let next = 0;
  const term: Term = {
    noColor: true,
    start() {},
    stop() {},
    width: () => 100,
    height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {},
    paint(patch) {
      if (patch.kind === 'full') painted.push(patch.lines.join('\n'));
      else painted.push(patch.rows.map((r) => r.text).join('\n'));
      return true;
    },
    screenKnown: () => true,
    copy() {},
  };
  try {
    await run(rt, term, { cmd: hangingCmd(launches), ...deps });
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return { painted, launches };
}

/** Вкладка «MCP» → «＋ Добавить» → имя+команда → Enter на строке действия → процесс. */
const MCP_ADD_KEYS = ['tab', 'tab', 'enter', 'd', 'o', 'c', 's', 'down', 'down', 'p', 'i', 'down', 'down', 'down', 'down', 'down', 'down', 'enter'];

/** Процесс `pi mcp add …` (в отличие от живой проверки `pi mcp list`). */
const addLaunch = (l: Launch): boolean => l.args[0] === 'mcp' && l.args[1] === 'add';

test('app: Esc на экране процесса снимает процесс и показывает «Прервано»', async () => {
  const { painted, launches } = await drive([...MCP_ADD_KEYS, 'esc', 'ctrlc'], {});
  const add = launches.filter(addLaunch);
  assert.equal(add.length, 1);
  assert.equal(add[0].signal.aborted, true);
  const all = painted.join('\n');
  assert.ok(all.includes(t('ru', 'busy.mcp-add', { name: 'docs' })), all);
  assert.ok(all.includes(t('ru', 'status.cancelled', { name: 'docs' })), all);
});

test('app: на экране процесса рисуется счётчик секунд', async () => {
  const { painted } = await drive([...MCP_ADD_KEYS, 'esc', 'ctrlc'], {});
  assert.ok(painted.join('\n').includes(t('ru', 'busy.elapsed', { sec: 0 })), painted.join('\n'));
});

test('app: Esc не запускает второй процесс — процесс ровно один', async () => {
  const { launches } = await drive([...MCP_ADD_KEYS, 'esc', 'esc', 'down', 'ctrlc'], {});
  assert.equal(launches.filter(addLaunch).length, 1);
});

test('app: Ctrl+C выходит и снимает незавершённый процесс', async () => {
  const { launches } = await drive([...MCP_ADD_KEYS, 'ctrlc'], {});
  const add = launches.filter(addLaunch);
  assert.equal(add.length, 1);
  assert.equal(add[0].signal.aborted, true);
});
