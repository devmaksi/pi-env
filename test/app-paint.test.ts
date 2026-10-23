import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, makeProgressPainter } from '../src/run.js';
import type { Term } from '../src/terminal.js';
import type { FramePatch } from '../src/diff.js';

const dirs: string[] = [];
function tmpRoot(withEnvs: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  if (withEnvs) {
    mkdirSync(join(dir, 'e0'));
    mkdirSync(join(dir, 'e1'));
  }
  return dir;
}

/** Фейковый терминал: считает патчи кадра и байты, эмулирует очередь клавиш. */
function fakeTerm(keys: string[]) {
  const patches: FramePatch[] = [];
  const bytes: number[] = [];
  const calls = { start: 0, stop: 0 };
  let running = false;
  let screenUnknown = true;
  let next = 0;
  const term: Term = {
    noColor: true,
    start() {
      if (running) return;
      running = true;
      screenUnknown = true;
      calls.start++;
    },
    stop() {
      if (!running) return;
      running = false;
      calls.stop++;
    },
    width: () => 80,
    height: () => 24,
    key: async () => keys[next++] ?? 'ctrlc',
    onResize() {},
    paint(patch) {
      if (!running) return false;
      if (patch.kind === 'rows') {
        if (screenUnknown) return false;
        bytes.push(patch.rows.reduce((n, r) => n + r.text.length + `\x1b[${r.row};1H`.length + 3, 0));
      } else {
        bytes.push(patch.lines.join('\n').length + 6);
        screenUnknown = false;
      }
      patches.push(patch);
      return true;
    },
    screenKnown: () => !screenUnknown,
  };
  return { term, patches, bytes, calls };
}

/** Прогон приложения на фейковом терминале: корень с окружениями + пустой каталог main-агента. */
async function drive(keys: string[]): Promise<ReturnType<typeof fakeTerm>> {
  const root = tmpRoot(true);
  const agent = tmpRoot(false);
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  const f = fakeTerm(keys);
  try {
    await run(root, f.term);
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  }
  return f;
}

test('app: первый кадр пишется целиком (kind full)', async () => {
  const f = await drive(['ctrlc']);
  assert.equal(f.patches.length, 1);
  assert.equal(f.patches[0].kind, 'full');
});

test('app: сдвиг курсора → rows-патч, байт заметно меньше полного кадра', async () => {
  const f = await drive(['down', 'ctrlc']);
  assert.equal(f.patches.length, 2);
  assert.equal(f.patches[1].kind, 'rows');
  const rows = (f.patches[1] as { kind: 'rows'; rows: { row: number }[] }).rows;
  assert.equal(rows.length, 2, 'сдвиг курсора меняет две строки кадра');
  assert.ok(f.bytes[1] * 4 < f.bytes[0], `байт на репок ${f.bytes[1]} против полного кадра ${f.bytes[0]}`);
});

test('app: повторная клавиша без изменения кадра → paint не позван (0 байт)', async () => {
  const f = await drive(['down', 'up', 'up', 'ctrlc']);
  assert.equal(f.patches.length, 3, 'full + два rows-патча; третий up кадр не меняет');
  assert.deepEqual(f.patches.map((p) => p.kind), ['full', 'rows', 'rows']);
});

test('app: после выхода (ctrlc) term.stop() позван ровно один раз', async () => {
  const f = await drive(['ctrlc']);
  assert.equal(f.calls.stop, 1);
  assert.equal(f.calls.start, 1);
});

/** Часы и таймеры для seam-а: сработавший таймер убирает себя из списка. */
function progressHarness() {
  const state = { clock: 0 };
  const timers: { ms: number; cb: () => void }[] = [];
  const made: number[] = [];
  const th = makeProgressPainter(() => { made.push(state.clock); }, 70, () => state.clock, (ms, cb) => {
    const drop = (): void => {
      const i = timers.indexOf(entry);
      if (i >= 0) timers.splice(i, 1);
    };
    const entry: { ms: number; cb: () => void } = { ms, cb: () => { drop(); cb(); } };
    timers.push(entry);
    return drop;
  });
  return { th, timers, state, made };
}

test('makeProgressPainter: 20 call() подряд на фейковых часах → repaint позван 1 раз, таймер один', () => {
  const { th, timers, state, made } = progressHarness();
  for (let i = 0; i < 20; i++) {
    state.clock += 3; // 20 страниц укладываются в одно окно 70 мс
    th.call();
  }
  assert.equal(made.length, 1, '20 прогресс-вызовов в одном окне → один репок');
  assert.equal(timers.length, 1);
});

test('makeProgressPainter: срабатывание таймера добавляет второй репок, повторные call() его не множат', () => {
  const { th, timers, state, made } = progressHarness();
  for (let i = 0; i < 6; i++) {
    state.clock += 5;
    th.call();
  }
  assert.equal(made.length, 1, 'повторные call() в окне репок не множат');
  assert.equal(timers.length, 1);
  state.clock += timers[0].ms;
  timers[0].cb();
  assert.equal(made.length, 2, 'отложенный репок догоняет экран');
  assert.equal(timers.length, 0, 'сработавший таймер уходит из списка');
  for (let i = 0; i < 6; i++) {
    state.clock += 5;
    th.call();
  }
  assert.equal(made.length, 2, 'второе окно ещё не истекло — репоков не добавилось');
  assert.equal(timers.length, 1);
});

test('makeProgressPainter: cancel() снимает незапущенный таймер, fn не вызывается', () => {
  const { th, timers, state, made } = progressHarness();
  th.call();
  state.clock += 10;
  th.call();
  th.cancel();
  assert.equal(made.length, 1, 'cancel() — отложенный репок не выполняется');
  assert.equal(timers.length, 0);
});

test.after?.(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
