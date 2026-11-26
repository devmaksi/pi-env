import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

/** Тот же цикл `run()`, но корень создаётся заранее (нужно для «включить, потом сломать»). */
async function driveAt(rt: string, keys: string[], agent: string, runFn?: RunFn): Promise<{ painted: string[]; launches: Launch[]; rt: string }> {
  const launches: Launch[] = [];
  const painted: string[] = [];
  let cursor = 0;
  const term: Term = {
    noColor: true, start() {}, stop() {}, width: () => 100, height: () => 24,
    key: async () => keys[(cursor = cursor + 1) - 1] ?? 'ctrlc',
    onResize() {},
    paint(patch) { if (patch.kind === 'full') painted.push(patch.lines.join('\n')); else painted.push(patch.rows.map((r) => r.text).join('\n')); return true; },
    screenKnown: () => true, copy() {},
  };
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try { await run(rt, term, { cmd: runFn ?? okCmd(launches), agentDir: agent }); }
  finally { if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved; }
  return { painted, launches, rt };
}

function driveWithRoot(rt: string, keys: string[], agent: string): Promise<{ painted: string[]; launches: Launch[]; rt: string }> {
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  mkdirSync(join(rt, 'e0'), { recursive: true });
  writeFileSync(join(rt, 'e0', 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  mkdirSync(join(rt, 'e0', 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  return driveAt(rt, keys, agent);
}

/** main-агент с пакетом в настройках — список вкладки «Расширения» непустой. */
function agentWithPackage(): string {
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { p: { models: { m: {} } } } }));
  mkdirSync(join(agent, 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  writeFileSync(join(agent, 'npm', 'package.json'), JSON.stringify({ dependencies: { 'pi-zentui': '1.0.0' } }));
  return agent;
}

const piLaunch = (l: Launch): boolean => l.cmd === 'pi';

// Требуемые планом e2e пакетного среза: включение из UI, починка по `R`, выключение.
test('сквозной: включение хранилища в форме — корни окружения становятся симлинками на хранилище', async () => {
  const agent = agentWithPackage();
  const rt0 = tmpDir();
  const { rt, painted } = await driveWithRoot(rt0, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  const env = join(rt, 'e0');
  assert.ok(lstatSync(join(env, 'npm')).isSymbolicLink(), painted.join('\n').slice(-1200));
  assert.ok(lstatSync(join(env, 'git')).isSymbolicLink());
  assert.equal(readlinkSync(join(env, 'npm')), join(rt, '.store', 'npm'));
  assert.ok(existsSync(join(rt, '.store', 'npm', 'node_modules', 'pi-zentui')), 'своё содержимое переехало в хранилище');
});

test('сквозной: «R» чинит битый симлинк пакетного корня и снимает ⚠ в списке', async () => {
  const agent = agentWithPackage();
  const rt0 = tmpDir();
  // включаем хранилище, затем ломаем симлинк вручную (pi-env видит «broken»)
  const { rt } = await driveWithRoot(rt0, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  const env = join(rt, 'e0');
  unlinkSync(join(env, 'npm'));
  symlinkSync(join(rt, '.store', 'gone'), join(env, 'npm'), 'dir');
  const { painted } = await driveAt(rt, ['down', 'r', 'ctrlc'], agent);
  assert.equal(lstatSync(join(env, 'npm')).isSymbolicLink(), true, painted.join('\n').slice(-1200));
  assert.equal(readlinkSync(join(env, 'npm')), join(rt, '.store', 'npm'));
  assert.ok(painted.some((f) => f.includes(t('ru', 'status.store-repaired'))), painted.join('\n').slice(-1200));
});

test('сквозной: выключение хранилища возвращает окружению обычные копии корней', async () => {
  const agent = agentWithPackage();
  const rt0 = tmpDir();
  await driveWithRoot(rt0, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  const { rt } = await driveAt(rt0, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'ctrlc'], agent);
  const env = join(rt, 'e0');
  assert.equal(lstatSync(join(env, 'npm')).isSymbolicLink(), false);
  assert.ok(existsSync(join(env, 'npm')), 'копия содержимого на месте');
});

// Пакет удалён из хранилища, а объявление окружения осталось: окружение обязано быть помечено,
// а не тихо потерять расширения.
test('сквозной: объявленного в хранилище пакета нет — окружение помечено ⚠', async () => {
  const agent = agentWithPackage();
  const rt = tmpDir();
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  mkdirSync(join(rt, 'e0'), { recursive: true });
  writeFileSync(join(rt, 'e0', 'settings.json'), JSON.stringify({ packages: ['npm:pkg-gone'] }));
  mkdirSync(join(rt, '.store', 'npm'), { recursive: true });
  symlinkSync(join(rt, '.store', 'npm'), join(rt, 'e0', 'npm'), 'dir');
  writeFileSync(join(rt, '.store', 'settings.json'), JSON.stringify({ packages: [] }));
  const { painted } = await driveAt(rt, ['down', 'ctrlc'], agent);
  assert.ok(painted.some((f) => f.includes(t('ru', 'envs.problem.missing', { v: 'npm:pkg-gone' }))), painted.join('\n').slice(-2500));
});

test('сквозной прогон: обновление пакета с вкладки идёт в каталог хранилища', async () => {
  const agent = agentWithPackage();
  // TAB — вкладка «Расширения», Enter по первой строке пакета → `pi update <source>`
  const { launches, painted, rt } = await drive(['tab', 'enter', 'ctrlc'], agent);
  const upd = launches.filter((l) => piLaunch(l) && l.args[0] === 'update');
  assert.ok(upd.length >= 1, painted.join('\n'));
  assert.ok(upd.every((l) => l.agentDir === join(rt, '.store')), JSON.stringify(upd));
});

// Реестр хранилища помнит пакет, а объявлений не осталось ни у кого (окружение уехало
// в корзину / снята отметка) — вкладка помечает его и предлагает убрать из реестра.
test('сквозной: осиротевший пакет помечен, X убирает его из реестра хранилища', async () => {
  const agent = agentWithPackage(); // main объявляет pi-zentui — осиротевший пакет не его
  const rt = tmpDir();
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  mkdirSync(join(rt, 'e0'), { recursive: true });
  writeFileSync(join(rt, 'e0', 'settings.json'), JSON.stringify({}));
  const store = join(rt, '.store');
  mkdirSync(join(store, 'npm', 'node_modules', 'pi-orphan-ext'), { recursive: true });
  writeFileSync(join(store, 'npm', 'node_modules', 'pi-orphan-ext', 'package.json'),
    JSON.stringify({ name: 'pi-orphan-ext', version: '1.0.0' }));
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-orphan-ext'] }));
  const { painted, launches } = await driveAt(rt, ['tab', 'x', 'enter', 'ctrlc'], agent);
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.orphan'))), painted.join('\n').slice(-2500));
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.orphans', { n: 1 }))), painted.join('\n').slice(-2500));
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.orphan-unused'))), painted.join('\n').slice(-2500));
  const rem = launches.filter((l) => piLaunch(l) && l.args[0] === 'remove');
  assert.equal(rem.length, 1, JSON.stringify(launches));
  assert.deepEqual(rem[0].args, ['remove', 'npm:pi-orphan-ext']);
  assert.equal(rem[0].agentDir, store, 'pi remove идёт в каталог хранилища, не в окружение');
});

// ─── разрешение конфликта источников пакета одним действием ──────────

interface ResolveFixture { rt: string; store: string; agent: string }

/**
 * Корень с включёнными пакетными корнями и конфликтом источников одного пакета:
 * `npm:pi-open-tui` (dev-supo и основной агент) против `npm:pi-open-tui@0.4.6` (dev-vtb).
 * Реестр хранилища стоит на проигравшем источнике — ровно тот случай, когда
 * «просто переписать объявления» оставило бы пакет неустановленным.
 */
function conflictRoot(): ResolveFixture {
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-open-tui'] }));
  const rt = tmpDir();
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  const store = join(rt, '.store');
  const pkgDir = join(store, 'npm', 'node_modules', 'pi-open-tui');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pi-open-tui', version: '0.4.6' }));
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-open-tui@0.4.6'] }));
  for (const [name, source] of [['dev-supo', 'npm:pi-open-tui'], ['dev-vtb', 'npm:pi-open-tui@0.4.6']]) {
    const dir = join(rt, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'),
      JSON.stringify({ theme: 'dark', defaultProvider: 'p', defaultModel: 'm', packages: [source, 'npm:pi-zentui'] }));
    symlinkSync(join(store, 'npm'), join(dir, 'npm'), 'dir');
  }
  return { rt, store, agent };
}

const settingsOf = (dir: string): { theme?: string; packages?: string[] } =>
  JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { theme?: string; packages?: string[] };

// ↑ по вариантам — уникальные источники, отсортированные по строке объявления:
// курсор 0 — актуальный `npm:pi-open-tui`, курсор 1 — закреплённый `npm:pi-open-tui@0.4.6`.
const KEYS_RESOLVE = ['tab', 'S', 'enter', 'ctrlc'];

test('сквозной: S разрешает конфликт — объявления всех окружений группы и основной агент', async () => {
  const fx = conflictRoot();
  const { painted, launches } = await driveAt(fx.rt, KEYS_RESOLVE, fx.agent);
  const all = painted.join('\n');
  assert.ok(all.includes(t('ru', 'ext.store.conflict', { name: 'npm:pi-open-tui' })), all.slice(0, 1200));
  assert.ok(all.includes(t('ru', 'ext.conflict.hint')), all.slice(0, 1200));
  assert.deepEqual(settingsOf(join(fx.rt, 'dev-vtb')).packages, ['npm:pi-open-tui', 'npm:pi-zentui']);
  assert.deepEqual(settingsOf(join(fx.rt, 'dev-supo')).packages, ['npm:pi-open-tui', 'npm:pi-zentui']);
  assert.deepEqual(settingsOf(fx.agent).packages, ['npm:pi-open-tui'], 'основной агент — тоже в группе');
  assert.equal(settingsOf(join(fx.rt, 'dev-supo')).theme, 'dark', 'прочие поля settings.json сохранены');
});

test('сквозной: хранилище приводится к победителю — pi remove и pi install в каталог хранилища', async () => {
  const fx = conflictRoot();
  const { launches, painted } = await driveAt(fx.rt, KEYS_RESOLVE, fx.agent);
  const ops = launches.filter((l) => l.cmd === 'pi' && (l.args[0] === 'remove' || l.args[0] === 'install'));
  assert.deepEqual(ops.map((l) => l.args), [
    ['remove', 'npm:pi-open-tui@0.4.6'],
    ['install', 'npm:pi-open-tui'],
  ], JSON.stringify(launches));
  assert.ok(ops.every((l) => l.agentDir === fx.store), JSON.stringify(ops));
  assert.ok(painted.join('\n').includes(t('ru', 'busy.resolving', { name: 'npm:pi-open-tui' })));
});

test('сквозной: после разрешения конфликт исчезает из перечитанного снимка, статус называет победителя', async () => {
  const fx = conflictRoot();
  // Строка пакета: счётчик «N окр.» + ` ⚠` — это маркер именно конфликта источников
  // (осиротевший пакет даёт `⚠` перед счётчиком, окружение — в другом месте кадра).
  const conflictRow = t('ru', 'ext.store.usage', { n: 3 }) + ' ⚠';
  const before = await driveAt(fx.rt, ['tab', 'ctrlc'], fx.agent);
  assert.ok(before.painted.join('\n').includes(conflictRow), before.painted.join('\n').slice(0, 1500));

  const { painted } = await driveAt(fx.rt, KEYS_RESOLVE, fx.agent);
  assert.ok(painted.join('\n').includes(t('ru', 'status.conflict-resolved', { name: 'npm:pi-open-tui', winner: 'npm:pi-open-tui', envs: 3 })), painted.join('\n').slice(-1200));

  const after = await driveAt(fx.rt, ['tab', 'ctrlc'], fx.agent);
  const frames = after.painted.join('\n');
  assert.ok(!frames.includes(t('ru', 'ext.store.conflict', { name: 'npm:pi-open-tui' })), frames.slice(0, 1500));
  assert.ok(!frames.includes(conflictRow), 'маркер конфликта уходит из строки пакета');
});

// Отмена: процесс в хранилище снимается Esc, и статус честно говорит, что хранилище
// к победителю не приведено (объявления уже переписаны — иначе UI врал бы).
test('сквозной: Esc на экране разрешения снимает pi remove, «⏳ N с» показан', async () => {
  const fx = conflictRoot();
  const launched: Array<{ cmd: string; args: string[]; agentDir: string; signal: AbortSignal }> = [];
  const hang: RunFn = (cmd, args, timeoutMs, opts = {}) => {
    const signal = opts.signal ?? new AbortController().signal;
    launched.push({ cmd, args, agentDir: opts.env?.PI_CODING_AGENT_DIR ?? '', signal });
    return new Promise((resolve) => signal.addEventListener('abort', () => {
      resolve({ ok: false, stdout: '', stderr: '', cancelled: true, timedOut: false, timeoutMs });
    }, { once: true }));
  };
  const { painted } = await driveAt(fx.rt, ['tab', 'S', 'enter', 'esc', 'ctrlc'], fx.agent, hang);
  const rem = launched.filter((l) => l.cmd === 'pi' && l.args[0] === 'remove');
  assert.equal(rem.length, 1, JSON.stringify(launched.map((l) => l.args)));
  assert.equal(rem[0].agentDir, fx.store);
  assert.equal(rem[0].signal.aborted, true);
  assert.equal(launched.filter((l) => l.args[0] === 'install').length, 0, 'отменённая операция не ставит победителя');
  const all = painted.join('\n');
  assert.ok(all.includes(t('ru', 'busy.elapsed', { sec: 0 })), all.slice(-1500));
  const cancelled = t('ru', 'status.cancelled', { name: 'npm:pi-open-tui@0.4.6' });
  assert.ok(all.includes(t('ru', 'status.conflict-error', { name: 'npm:pi-open-tui', v: cancelled })), all.slice(-1500));
});

// Победитель уже стоит в реестре хранилища — операций в хранилище не должно быть ни одной
// (иначе «повтор идемпотентен» означало бы переустановку того же пакета).
test('сквозной: победитель уже в реестре хранилища — разрешению не нужны операции в хранилище', async () => {
  const fx = conflictRoot();
  const { painted, launches } = await driveAt(fx.rt, ['tab', 'S', 'down', 'enter', 'ctrlc'], fx.agent);
  const ops = launches.filter((l) => l.cmd === 'pi' && (l.args[0] === 'remove' || l.args[0] === 'install'));
  assert.deepEqual(ops.map((l) => l.args), [], JSON.stringify(launches));
  assert.deepEqual(settingsOf(join(fx.rt, 'dev-supo')).packages, ['npm:pi-open-tui@0.4.6', 'npm:pi-zentui']);
  assert.ok(painted.join('\n').includes(t('ru', 'status.conflict-resolved', { name: 'npm:pi-open-tui', winner: 'npm:pi-open-tui@0.4.6', envs: 3 })), painted.join('\n').slice(-1200));
});

// Пакеты разных издателей — не конфликт: действие обязано молчать, иначе `S` переписал бы
// окружению объявления пакета, который оно никогда не просило.
test('сквозной: scoped- и unscoped-объявление одного имени — S ничего не делает', async () => {
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [] }));
  const rt = tmpDir();
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  const store = join(rt, '.store');
  mkdirSync(join(store, 'npm', 'node_modules', 'pi-open-tui'), { recursive: true });
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-open-tui'] }));
  const dir = join(rt, 'dev-vtb');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ packages: ['npm:@wangjq4214/pi-open-tui'] }));
  symlinkSync(join(store, 'npm'), join(dir, 'npm'), 'dir');

  const { painted, launches } = await driveAt(rt, ['tab', 'S', 'ctrlc'], agent);
  const all = painted.join('\n');
  assert.ok(all.includes(t('ru', 'ext.title.store')), 'вкладка хранилища открыта, пакет в списке');
  assert.ok(!all.includes(t('ru', 'ext.conflict.title')), 'суб-экран выбора победителя не открыт');
  assert.equal(launches.filter((l) => l.cmd === 'pi').length, 0, JSON.stringify(launches));
  assert.deepEqual(settingsOf(dir).packages, ['npm:@wangjq4214/pi-open-tui'], 'объявление другого пакета не тронуто');
});
