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
  // «установлен» без package.json — pi-env не разобрал бы пакет и считал бы его без файлов
  writeFileSync(join(rt, 'e0', 'npm', 'node_modules', 'pi-zentui', 'package.json'),
    JSON.stringify({ name: 'pi-zentui', version: '1.0.0' }));
  return driveAt(rt, keys, agent);
}

/** main-агент с пакетом в настройках — список вкладки «Расширения» непустой. */
function agentWithPackage(): string {
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { p: { models: { m: {} } } } }));
  mkdirSync(join(agent, 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  writeFileSync(join(agent, 'npm', 'node_modules', 'pi-zentui', 'package.json'),
    JSON.stringify({ name: 'pi-zentui', version: '1.0.0' }));
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
  // Маркер на строке остаётся, но это уже другой случай: победитель не установлен в
  // хранилище (разрыв реестра), и вкладка предлагает привести реестр к объявлениям.
  assert.ok(frames.includes(conflictRow), 'разрыв реестра остаётся помечен');
  assert.ok(frames.includes(t('ru', 'ext.store.gaps', { n: 2 })), frames.slice(0, 1500));
  assert.ok(!frames.includes(t('ru', 'ext.conflict.hint')), 'подсказки выбора победителя больше нет');
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
  writeFileSync(join(store, 'npm', 'node_modules', 'pi-open-tui', 'package.json'),
    JSON.stringify({ name: 'pi-open-tui', version: '1.0.0' }));
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

// Победитель не доехал до реестра (шаг в хранилище отменён или упал): конфликта в снимке
// больше нет — и без входа «привести реестр» повторить операцию было бы нечем.
test('сквозной: недоведённый шаг в хранилище — S повторяет приведение и доводит реестр', async () => {
  const fx = conflictRoot();
  const regOf = (): string[] => (JSON.parse(readFileSync(join(fx.store, 'settings.json'), 'utf8')).packages ?? []) as string[];

  // Первый заход: объявления переписаны, а шаг в хранилище не выполнен (реестр не меняется).
  const first = await driveAt(fx.rt, ['tab', 'S', 'enter', 'ctrlc'], fx.agent);
  const ff = first.painted.join('\n');
  assert.ok(ff.includes(t('ru', 'status.conflict-resolved', { name: 'npm:pi-open-tui', winner: 'npm:pi-open-tui', envs: 3 })), ff.slice(-1200));
  const gap = await driveAt(fx.rt, ['tab', 'ctrlc'], fx.agent);
  const gf = gap.painted.join('\n');
  // Два разрыва: победитель конфликта и пакет окружений, которого в реестре нет вовсе.
  assert.ok(gf.includes(t('ru', 'ext.store.gaps', { n: 2 })), gf.slice(0, 1500));
  assert.ok(gf.includes(t('ru', 'ext.store.hint.gap')), gf.slice(0, 1500));
  assert.deepEqual(regOf(), ['npm:pi-open-tui@0.4.6'], 'реестр всё ещё на проигравшем источнике');

  const log2: Launch[] = [];
  const log3: Launch[] = [];
  // Фейковый pi пишет реестр хранилища, как настоящий: remove убирает объявление, install добавляет.
  const writing = (log: Launch[]): RunFn => (cmd, args, timeoutMs, opts = {}) => {
    log.push({ cmd, args, agentDir: opts.env?.PI_CODING_AGENT_DIR ?? '' });
    if (cmd === 'pi' && (args[0] === 'remove' || args[0] === 'install')) {
      const file = join(opts.env?.PI_CODING_AGENT_DIR ?? '', 'settings.json');
      const cur = JSON.parse(readFileSync(file, 'utf8')) as { packages?: string[] };
      const set = new Set(cur.packages ?? []);
      if (args[0] === 'remove') set.delete(args[1]); else set.add(args[1]);
      writeFileSync(file, JSON.stringify({ ...cur, packages: [...set] }));
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false, timeoutMs } satisfies CmdResult);
  };
  const opsOf = (log: Launch[]): string[][] =>
    log.filter((l) => l.cmd === 'pi' && (l.args[0] === 'remove' || l.args[0] === 'install')).map((l) => l.args);

  // Один заход = одно разрыв: процесс прошлого захода должен закончиться до следующего `S`
  // (на экране процесса клавиши не обрабатываются), поэтому каждый заход — отдельный прогон.
  const second = await driveAt(fx.rt, ['tab', 'S', 'enter', 'ctrlc'], fx.agent, writing(log2));
  const sf = second.painted.join('\n');
  assert.ok(sf.includes(t('ru', 'ext.gap.title', { n: 2 })), 'S открыл суб-экран приведения, а не выбор победителя');
  assert.ok(sf.includes(t('ru', 'status.registry-repaired', { name: 'npm:pi-open-tui', winner: 'npm:pi-open-tui' })), sf.slice(-1500));
  assert.deepEqual(opsOf(log2), [['remove', 'npm:pi-open-tui@0.4.6'], ['install', 'npm:pi-open-tui']], JSON.stringify(log2));
  assert.ok(log2.filter((l) => l.cmd === 'pi').every((l) => l.agentDir === fx.store), 'операции идут в каталог хранилища');

  // Второй разрыв — пакет окружений, которого в реестре не было вовсе: только install.
  const third = await driveAt(fx.rt, ['tab', 'S', 'enter', 'ctrlc'], fx.agent, writing(log3));
  assert.ok(third.painted.join('\n').includes(t('ru', 'ext.gap.title', { n: 1 })), third.painted.join('\n').slice(0, 1500));
  assert.deepEqual(opsOf(log3), [['install', 'npm:pi-zentui']], JSON.stringify(log3));
  assert.deepEqual(regOf(), ['npm:pi-open-tui', 'npm:pi-zentui']);
  // Приведение реестра не трогает объявления окружений: они уже едины.
  assert.deepEqual(settingsOf(join(fx.rt, 'dev-supo')).packages, ['npm:pi-open-tui', 'npm:pi-zentui']);

  // Повтор идемпотентен: разрыва нет — экран приведения не открывается, операций ноль.
  const log4: Launch[] = [];
  const fourth = await driveAt(fx.rt, ['tab', 'S', 'ctrlc'], fx.agent, okCmd(log4));
  const tf = fourth.painted.join('\n');
  assert.ok(!tf.includes(t('ru', 'ext.gap.title')), tf.slice(0, 1500));
  assert.ok(!tf.includes(t('ru', 'ext.store.gaps')), tf.slice(0, 1500));
  assert.deepEqual(opsOf(log4), [], JSON.stringify(log4));
});

// Замок хранилища: пока в `<store>` идёт пакетная команда, вторая не получает право писать —
// иначе два npm-процесса разойдутся на общем `package.json`. Отказ обязан закрыть экран
// приведения и объяснить причину, а не сделать вид, что реестр приведён.
test('сквозной: замок хранилища занят — приведение реестра отклонено, причина в статусе', async () => {
  // Общий корень уже наполнен: включение не «первое», реестр сам не дозаполняется, и
  // объявление окружения уходит в фоновую очередь `pi install` — она и держит замок.
  const agent = tmpDir();
  writeFileSync(join(agent, 'settings.json'), JSON.stringify({ packages: [] }));
  writeFileSync(join(agent, 'models.json'), JSON.stringify({ providers: { p: { models: { m: {} } } } }));
  const rt = tmpDir();
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  const store = join(rt, '.store');
  const storePkg = join(store, 'npm', 'node_modules', 'pi-open-tui');
  mkdirSync(storePkg, { recursive: true });
  writeFileSync(join(storePkg, 'package.json'), JSON.stringify({ name: 'pi-open-tui', version: '0.4.6' }));
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-open-tui'] }));
  const dir = join(rt, 'e0');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ packages: ['npm:pi-zentui'] }));
  mkdirSync(join(dir, 'npm', 'node_modules', 'pi-zentui'), { recursive: true });
  writeFileSync(join(dir, 'npm', 'node_modules', 'pi-zentui', 'package.json'),
    JSON.stringify({ name: 'pi-zentui', version: '1.0.0' }));

  const installs: Array<{ args: string[]; agentDir: string; signal: AbortSignal }> = [];
  const hangInstall: RunFn = (cmd, args, timeoutMs, opts = {}) => {
    const signal = opts.signal ?? new AbortController().signal;
    if (cmd === 'pi' && args[0] === 'install') {
      installs.push({ args, agentDir: opts.env?.PI_CODING_AGENT_DIR ?? '', signal });
      return new Promise((resolve) => signal.addEventListener('abort', () => {
        resolve({ ok: false, stdout: '', stderr: '', cancelled: true, timedOut: false, timeoutMs });
      }, { once: true }));
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false, timeoutMs } satisfies CmdResult);
  };

  // down/e — форма e0; три down — строка «Хранилище»; enter+enter — включить; esc — из формы;
  // tab/S/enter — приведение реестра, пока очередь установки ещё не закончилась.
  const { painted } = await driveAt(
    rt, ['down', 'e', 'down', 'down', 'down', 'enter', 'enter', 'esc', 'tab', 'S', 'enter', 'ctrlc'], agent, hangInstall,
  );
  const all = painted.join('\n');
  assert.ok(all.includes(t('ru', 'ext.gap.title', { n: 1 })), all.slice(0, 2000));
  assert.ok(all.includes(t('ru', 'status.store-busy')), all.slice(-2000));
  assert.ok(!all.includes(t('ru', 'status.registry-repaired')), 'отказ не выдаётся за успех');
  assert.equal(installs.length, 1, 'вторая пакетная команда в хранилище не запустилась: ' + JSON.stringify(installs.map((i) => i.args)));
  assert.deepEqual(installs[0]!.args, ['install', 'npm:pi-zentui'], 'замок держит очередь доноса реестра');
  assert.equal(installs[0]!.agentDir, store);
  assert.deepEqual(settingsOf(dir).packages, ['npm:pi-zentui'], 'отказ не трогает объявления окружения');
  assert.deepEqual((JSON.parse(readFileSync(join(store, 'settings.json'), 'utf8')).packages ?? []) as string[], ['npm:pi-open-tui']);
});

// ─── объявление реестра без файлов пакета в <store>/npm ──────────────

/**
 * Реестр хранилища помнит пакет, файлов которого в `<store>/npm` нет: сбой `pi install`,
 * ручная чистка дерева, переезд корня. Раньше строки для него не было вовсе — реестр мусорел
 * невидимо.
 */
function noFilesRoot(): { rt: string; store: string } {
  const rt = tmpDir();
  const store = join(rt, '.store');
  writeFileSync(join(rt, '.pi-env.json'), JSON.stringify({ ...DEFAULT_APP_SETTINGS, language: 'ru' }));
  mkdirSync(join(rt, 'e0'), { recursive: true });
  writeFileSync(join(rt, 'e0', 'settings.json'), JSON.stringify({ packages: ['npm:pi-gone'] }));
  mkdirSync(join(store, 'npm'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(rt, 'e0', 'npm'), 'dir');
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ packages: ['npm:pi-gone'] }));
  return { rt, store };
}

test('сквозной: объявление реестра без файлов видно во вкладке с пометкой и подсказками', async () => {
  const { rt } = noFilesRoot();
  const { painted } = await driveAt(rt, ['tab', 'ctrlc'], agentWithPackage());
  const frame = painted.join('\n');
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.nofiles.row'))), frame.slice(-2500));
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.nofiles'))), frame.slice(-2500));
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.nofiles.summary', { n: 1 }))), frame.slice(-2500));
  // путь к ожидаемому каталогу обрезается шириной правой колонки — проверяем саму строку
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.nofiles.path').split('{v}')[0]!)), frame.slice(-2500));
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.nofiles.hint'))), frame.slice(-2500));
});

test('сквозной: Enter по строке без файлов переустанавливает объявление в каталог хранилища', async () => {
  const { store } = noFilesRoot();
  const agent = agentWithPackage();
  const { launches, painted } = await driveAt(join(store, '..'), ['tab', 'enter', 'ctrlc'], agent);
  const inst = launches.filter((l) => piLaunch(l) && l.args[0] === 'install');
  assert.deepEqual(inst.map((l) => l.args), [['install', 'npm:pi-gone']], JSON.stringify(launches));
  assert.equal(inst[0]!.agentDir, store, 'pi install идёт в каталог хранилища');
  assert.ok(painted.some((f) => f.includes(t('ru', 'busy.installing', { name: 'npm:pi-gone' }))), painted.join('\n').slice(-2500));
});

test('сквозной: X по строке без файлов убирает объявление из реестра хранилища', async () => {
  const { rt, store } = noFilesRoot();
  const { launches, painted } = await driveAt(rt, ['tab', 'x', 'enter', 'ctrlc'], agentWithPackage());
  const rem = launches.filter((l) => piLaunch(l) && l.args[0] === 'remove');
  assert.deepEqual(rem.map((l) => l.args), [['remove', 'npm:pi-gone']], JSON.stringify(launches));
  assert.equal(rem[0]!.agentDir, store, 'pi remove идёт в каталог хранилища');
  assert.ok(painted.some((f) => f.includes(t('ru', 'ext.store.hint.remove'))), painted.join('\n').slice(-2500));
});

// Переустановка чинит строку: файлы появились — и вкладка перестаёт врать про «нет файлов»
// (список перечитывается после pi-команды, а не берётся снимком запуска).
test('сквозной: после переустановки строка становится обычной', async () => {
  const { rt, store } = noFilesRoot();
  const agent = agentWithPackage();
  const runFn: RunFn = (cmd, args, timeoutMs, opts = {}) => {
    if (args[0] === 'install') {
      const dir = join(store, 'npm', 'node_modules', 'pi-gone');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pi-gone', version: '1.2.3' }));
    }
    void opts.signal;
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false, timeoutMs } satisfies CmdResult);
  };
  const { painted } = await driveAt(rt, ['tab', 'enter', 'ctrlc'], agent, runFn);
  const last = painted[painted.length - 1] ?? '';
  // строка пакета в последнем репаке есть, а пометки «нет файлов» на ней больше нет
  assert.ok(last.includes('pi-gone') && last.includes(t('ru', 'ext.store.usage', { n: 1 })), last);
  assert.ok(!last.includes(t('ru', 'ext.store.nofiles.row')), last);
  assert.ok(!last.includes(t('ru', 'ext.store.nofiles.summary', { n: 1 })), last);
});
