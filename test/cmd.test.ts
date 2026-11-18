import { test, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCmd } from '../src/cmd.js';

const dirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'picmd-'));
  dirs.push(dir);
  return dir;
}

test('runCmd: abort по сигналу → cancelled, процесс остановлен', async () => {
  const c = new AbortController();
  const p = runCmd('sleep', ['30'], 60_000, { signal: c.signal });
  c.abort();
  const r = await p;
  assert.deepEqual(
    { ok: r.ok, cancelled: r.cancelled, timedOut: r.timedOut },
    { ok: false, cancelled: true, timedOut: false },
  );
});

test('runCmd: таймаут → timedOut, а не cancelled', async () => {
  const r = await runCmd('sleep', ['30'], 50);
  assert.deepEqual(
    { ok: r.ok, cancelled: r.cancelled, timedOut: r.timedOut },
    { ok: false, cancelled: false, timedOut: true },
  );
});

test('runCmd: уже снятый сигнал — процесс не запускается', async () => {
  const marker = join(tmpDir(), 'ran');
  const already = new AbortController();
  already.abort();
  const r = await runCmd('sh', ['-c', `touch ${marker}`], 5_000, { signal: already.signal });
  assert.equal(existsSync(marker), false);
  assert.deepEqual(
    { ok: r.ok, cancelled: r.cancelled, timedOut: r.timedOut },
    { ok: false, cancelled: true, timedOut: false },
  );
});

test('runCmd: обычный провал процесса — оба флага false', async () => {
  const r = await runCmd('sh', ['-c', 'exit 3'], 5_000);
  assert.deepEqual(
    { ok: r.ok, cancelled: r.cancelled, timedOut: r.timedOut },
    { ok: false, cancelled: false, timedOut: false },
  );
});

test('runCmd: spawn не удался — ok:false, флаги false', async () => {
  const r = await runCmd('pi-env-net-yet-unknown-xyz', [], 5_000);
  assert.deepEqual(
    { ok: r.ok, cancelled: r.cancelled, timedOut: r.timedOut },
    { ok: false, cancelled: false, timedOut: false },
  );
});

test('runCmd: stdout/stderr собираются и при отмене', async () => {
  const c = new AbortController();
  const p = runCmd('sh', ['-c', 'echo out; echo err >&2; sleep 30'], 60_000, { signal: c.signal });
  await new Promise((res) => setTimeout(res, 150));
  c.abort();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.match(r.stdout + r.stderr, /out|err/);
});

test('runCmd: отмена убивает всё дерево процесса, а не только оболочку', async () => {
  const dir = tmpDir();
  const pidfile = join(dir, 'grand.pid');
  const c = new AbortController();
  const p = runCmd('sh', ['-c', `sleep 40 & echo $! > ${pidfile}; wait`], 60_000, { signal: c.signal });
  await new Promise((res) => setTimeout(res, 200));
  c.abort();
  const r = await p;
  assert.equal(r.cancelled, true);
  const grand = Number(readFileSync(pidfile, 'utf8').trim());
  assert.ok(grand > 0);
  // Внучатний процесс обязан умереть: сигнал уходит группе, а не только оболочке.
  // Поллинг, а не одномоментная проверка: убитый внучок какое-то время висит зомби,
  // а process.kill(pid, 0) на зомби не бросает ESRCH.
  const dead = await waitForExit(grand, 2_000);
  assert.ok(dead, `внучатний процесс ${grand} пережил отмену`);
});

/** До timeoutMs ждёт, пока процесс перестанет существовать (ESRCH). */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { process.kill(pid, 0); } catch { return true; }
    if (Date.now() > until) return false;
    await new Promise((res) => setTimeout(res, 20));
  }
}


after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
