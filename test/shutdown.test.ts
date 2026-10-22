import { test } from 'node:test';
import assert from 'node:assert';
import { withShutdown, type ShutdownDeps } from '../src/shutdown.js';

/** Фейковый процесс: регистрация/снятие обработчиков и ручной emit. */
class FakeProcess {
  readonly handlers = new Map<string, Array<(arg?: unknown) => void>>();
  readonly events: string[] = [];
  on(event: string, handler: (arg?: unknown) => void): void {
    this.events.push(event);
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
  off(event: string, handler: (arg?: unknown) => void): void {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
  }
  emit(event: string, arg?: unknown): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(arg);
  }
  live(): number {
    let n = 0;
    for (const hs of this.handlers.values()) n += hs.length;
    return n;
  }
}

function fakeDeps(): {
  deps: ShutdownDeps;
  proc: FakeProcess;
  calls: string[];
  errors: unknown[];
} {
  const proc = new FakeProcess();
  const calls: string[] = [];
  const errors: unknown[] = [];
  const deps: ShutdownDeps = {
    stop: () => calls.push('stop'),
    report: (err) => { calls.push('report'); errors.push(err); },
    exit: (code) => calls.push('exit:' + code),
    on: (event, handler) => proc.on(event, handler),
    off: (event, handler) => proc.off(event, handler),
  };
  return { deps, proc, calls, errors };
}

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
};

test('withShutdown: успех — stop один раз, exit не вызван, обработчики сняты', async () => {
  const { deps, proc, calls } = fakeDeps();
  let bodyRan = false;
  await withShutdown(deps, async () => { bodyRan = true; });
  assert.equal(bodyRan, true);
  assert.deepEqual(calls, ['stop']);
  assert.equal(proc.live(), 0);
});

test('withShutdown: синхронный throw в теле — report+stop+exit(1)', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const boom = new Error('boom');
  await withShutdown(deps, async () => { throw boom; });
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.equal(errors[0], boom);
  assert.equal(proc.live(), 0);
});

test('withShutdown: async reject в теле — report+stop+exit(1) один раз', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const boom = new Error('async-boom');
  await withShutdown(deps, async () => {
    await new Promise<void>((_, rej) => setTimeout(() => rej(boom), 5));
  });
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.equal(errors[0], boom);
  assert.equal(proc.live(), 0);
});

test('withShutdown: unhandledRejection из fire-and-forget во время тела — report+stop+exit(1)', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const boom = new Error('side-effect-boom');
  const d = deferred();
  const finished = withShutdown(deps, async () => {
    // «выстрелил и забыл», как void checkUpdates(...) в run.ts
    proc.emit('unhandledRejection', boom);
    await d.promise;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.equal(errors[0], boom);
  d.resolve();
  await finished;
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.equal(proc.live(), 0);
});

test('withShutdown: uncaughtException в теле — report+stop+exit(1)', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const boom = new Error('sync-throw-outside-await');
  const d = deferred();
  const finished = withShutdown(deps, async () => {
    proc.emit('uncaughtException', boom);
    await d.promise;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.equal(errors[0], boom);
  d.resolve();
  await finished;
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
});

test('withShutdown: сигнал SIGTERM — stop+exit(1) без report', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const d = deferred();
  const finished = withShutdown(deps, async () => {
    proc.emit('SIGTERM');
    await d.promise;
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['stop', 'exit:1']);
  assert.equal(errors.length, 0);
  d.resolve();
  await finished;
  assert.deepEqual(calls, ['stop', 'exit:1']);
});

test('withShutdown: повторный сбой после cleanup — report/exit не дублируются', async () => {
  const { deps, proc, calls, errors } = fakeDeps();
  const first = new Error('first');
  const second = new Error('second');
  await withShutdown(deps, async () => {
    proc.emit('unhandledRejection', first);
    proc.emit('unhandledRejection', second);
    throw first;
  });
  assert.deepEqual(calls, ['report', 'stop', 'exit:1']);
  assert.deepEqual(errors, [first]);
});

test('withShutdown: stop() бросает — withShutdown не бросает, исходная ошибка сообщена', async () => {
  const { deps, proc, errors } = fakeDeps();
  const boom = new Error('boom');
  const stopBoom = new Error('stop-failed');
  deps.stop = () => { throw stopBoom; };
  await withShutdown(deps, async () => { throw boom; });
  assert.ok(errors.includes(boom), 'исходная ошибка сообщена');
  assert.equal(errors[0], boom);
  assert.equal(proc.live(), 0);
});
