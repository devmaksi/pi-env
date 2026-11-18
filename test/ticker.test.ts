import { test } from 'node:test';
import assert from 'node:assert';
import { createTicker } from '../src/ticker.js';

/** Фейковый таймер: копит очередь, никаких реальных пауз. */
function fakeClock() {
  const queue: Array<{ ms: number; cb: () => void }> = [];
  return {
    queue,
    setTimer: (ms: number, cb: () => void) => { queue.push({ ms, cb }); },
    drain: () => {
      const pending = queue.splice(0, queue.length);
      for (const item of pending) item.cb();
      return pending.length;
    },
  };
}

test('тикер тикает, пока onTick возвращает true, и останавливается на false', () => {
  const clock = fakeClock();
  let ticks = 0;
  const t = createTicker(() => ++ticks < 3, { setTimer: clock.setTimer });
  t.start();
  assert.equal(clock.queue[0].ms, 1000);
  clock.drain(); // tick 1 → ставит следующий
  clock.drain(); // tick 2 → ставит следующий
  clock.drain(); // tick 3 → false, цепочка гаснет
  assert.equal(ticks, 3);
  assert.equal(clock.queue.length, 0);
});

test('start() повторный не добавляет вторую цепочку', () => {
  const clock = fakeClock();
  const t = createTicker(() => true, { setTimer: clock.setTimer });
  t.start();
  t.start();
  assert.equal(clock.queue.length, 1);
});

test('тикер с явным ms ставит таймер на эту паузу', () => {
  const clock = fakeClock();
  createTicker(() => false, { setTimer: clock.setTimer, ms: 250 }).start();
  assert.equal(clock.queue[0].ms, 250);
});

test('onTick не вызывается после остановки', () => {
  const clock = fakeClock();
  let ticks = 0;
  const t = createTicker(() => { ticks++; return false; }, { setTimer: clock.setTimer });
  t.start();
  clock.drain();
  clock.drain();
  clock.drain();
  assert.equal(ticks, 1);
});
