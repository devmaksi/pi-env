import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/** Корень с закреплённым языком (урок CI 0.2.4/0.2.6) и одним окружением. */
function root(): string {
  const dir = tmpDir();
  mkdirSync(join(dir, 'e0'));
  saveAppSettings(dir, { ...DEFAULT_APP_SETTINGS, language: 'ru' });
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); } );

interface Launch { cmd: string; args: string[]; agentDir: string }

/** Процесс, который сразу «успешно» завершается; вызовы записываются в лог. */
function okCmd(log: Launch[]): RunFn {
  return (cmd, args, timeoutMs, opts = {}) => {
    log.push({ cmd, args, agentDir: opts.env?.PI_CODING_AGENT_DIR ?? '' });
    void opts.signal;
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false, timeoutMs } satisfies CmdResult);
  };
}

/**
 * Реальный цикл `run()` на фейковом терминале. `agent` — каталог main-агента,
 * в котором лежат пакеты (он же источник каталога формы).
 */
async function drive(keys: string[], agent: string, deps: RunDeps = {}): Promise<{ painted: string[]; launches: Launch[]; rt: string }> {
  const rt = root();
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const launches: Launch[] = [];
  const painted: string[] = [];
  let cursor = 0;
  const term: Term = {
    noColor: true,
    start() {},
    stop() {},
    width: () => 100,
    height: () => 24,
    key: async () => keys[(cursor = cursor + 1) - 1] ?? 'ctrlc',
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
    await run(rt, term, { cmd: okCmd(launches), agentDir: agent, ...deps });
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return { painted, launches, rt };
}

/** main-агент с пакетом в настройках — список вкладки «Расширения» непустой. */
function agentWithPackage(): string {
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  mkdirSync(join(agent, 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  writeFileSync(join(agent, 'npm', 'package.json'), JSON.stringify({ dependencies: { 'pi-zentui': '1.0.0' } }));
  return agent;
}

const piLaunch = (l: Launch): boolean => l.cmd === 'pi';

test('сквозной прогон: обновление пакета с вкладки идёт в каталог хранилища', async () => {
  const agent = agentWithPackage();
  // TAB — вкладка «Расширения», Enter по первой строке пакета → `pi update <source>`
  const { launches, painted, rt } = await drive(['tab', 'enter', 'ctrlc'], agent);
  const upd = launches.filter((l) => piLaunch(l) && l.args[0] === 'update');
  assert.ok(upd.length >= 1, painted.join('\n'));
  assert.ok(upd.every((l) => l.agentDir === join(rt, '.store')), JSON.stringify(upd));
});
