import { test } from 'node:test';
import assert from 'node:assert';
import { createThrottle, type ThrottleDeps } from '../src/throttle.js';

/** Фейковые часы и таймеры: ни одной реальной паузы в тестах. */
function fakeClock(ms: number) {
  const timers: { ms: number; cb: () => void }[] = [];
  const state = { clock: 0 };
  const deps: ThrottleDeps = {
    ms,
    now: () => state.clock,
    setTimer: (t, cb) => {
      const drop = (): void => {
        const i = timers.indexOf(entry);
        if (i >= 0) timers.splice(i, 1);
      };
      const entry: { ms: number; cb: () => void } = { ms: t, cb: () => { drop(); cb(); } };
      timers.push(entry);
      return drop;
    },
  };
  return { deps, timers, state };
}

function counter() {
  const runs: number[] = [];
  return { runs, fn: () => { runs.push(1); } };
}

test('throttle: первый call выполняет fn сразу, таймеров нет', () => {
  const { deps, timers } = fakeClock(70);
  const c = counter();
  createThrottle(c.fn, deps).call();
  assert.equal(c.runs.length, 1);
  assert.equal(timers.length, 0);
});

test('throttle: call внутри окна ms не выполняет fn, ставит один таймер', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  state.clock += 5;
  th.call();
  assert.equal(c.runs.length, 1);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms <= 70, 'таймер не длиннее окна');
});

test('throttle: повторные calls в окне не добавляют таймеров', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  for (let i = 0; i < 5; i++) {
    state.clock += 5;
    th.call();
  }
  assert.equal(c.runs.length, 1);
  assert.equal(timers.length, 1);
  assert.equal(th.pending, true);
});

test('throttle: срабатывание таймера выполняет fn и сбрасывает pending', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  state.clock += 5;
  th.call();
  const waited = timers[0].ms;
  state.clock += waited;
  timers[0].cb();
  assert.equal(c.runs.length, 2);
  assert.equal(th.pending, false);
  th.call();
  assert.equal(c.runs.length, 2, 'сразу после срабатывания снова окно паузы');
  assert.equal(timers.length, 1, 'новый вызов поставил один таймер');
});

test('throttle: call после истечения ms выполняет fn сразу', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  state.clock += 70;
  th.call();
  assert.equal(c.runs.length, 2);
  assert.equal(timers.length, 0);
});

test('throttle: cancel снимает незапущенный таймер, fn не вызывается', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  state.clock += 5;
  th.call();
  th.cancel();
  assert.equal(timers.length, 0);
  assert.equal(c.runs.length, 1);
  assert.equal(th.pending, false);
});

test('throttle: после cancel следующий call в окне снова ставит ровно один таймер', () => {
  const { deps, timers, state } = fakeClock(70);
  const c = counter();
  const th = createThrottle(c.fn, deps);
  th.call();
  state.clock += 5;
  th.call();
  th.cancel();
  state.clock += 5;
  th.call();
  assert.equal(timers.length, 1);
  assert.equal(c.runs.length, 1);
});
