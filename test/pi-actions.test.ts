import { test } from 'node:test';
import assert from 'node:assert';
import { runCmd, PI_TIMEOUT_MS, type CmdResult } from '../src/cmd.js';
import {
  piUpdateAll, piUpdateOne, piRemove, piInstall, piMcpAdd, piMcpList, npmOutdated, cmdFailureText,
} from '../src/pi-actions.js';
import type { RunFn } from '../src/pi-actions.js';
import { freshMcpForm } from '../src/state.js';
import { t } from '../src/i18n.js';

interface Call { cmd: string; args: string[]; timeoutMs: number; opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } }

function fakeRun(): { run: RunFn; calls: Call[] } {
  const calls: Call[] = [];
  const run: RunFn = (cmd, args, timeoutMs, opts = {}) => {
    calls.push({ cmd, args, timeoutMs, opts });
    return Promise.resolve({ ok: true, stdout: '{}', stderr: '', cancelled: false, timedOut: false, timeoutMs });
  };
  return { run, calls };
}

const ok = (over: Partial<CmdResult> = {}): CmdResult =>
  ({ ok: false, stdout: '', stderr: '', cancelled: false, timedOut: false, timeoutMs: PI_TIMEOUT_MS, ...over });

test('обёртки передают сигнал и каталог агента в запуск', async () => {
  const c = new AbortController();
  const form = freshMcpForm();
  const cases: Array<{ name: string; call: (run: RunFn) => Promise<unknown>; cmd: string; args: string[]; envDir: string | null }> = [
    { name: 'piUpdateAll', call: (run) => piUpdateAll('/env', c.signal, run), cmd: 'pi', args: ['update', '--extensions'], envDir: '/env' },
    { name: 'piUpdateOne', call: (run) => piUpdateOne('/env', 'src', c.signal, run), cmd: 'pi', args: ['update', 'src'], envDir: '/env' },
    { name: 'piRemove', call: (run) => piRemove('/env', 'src', c.signal, run), cmd: 'pi', args: ['remove', 'src'], envDir: '/env' },
    { name: 'piInstall', call: (run) => piInstall('/env', 'npm:x', c.signal, run), cmd: 'pi', args: ['install', 'npm:x'], envDir: '/env' },
    { name: 'piMcpAdd', call: (run) => piMcpAdd('/env', { ...form, name: 'fs' }, c.signal, run), cmd: 'pi', args: ['mcp', 'add', 'fs'], envDir: '/env' },
    { name: 'piMcpList', call: (run) => piMcpList('/env', c.signal, run), cmd: 'pi', args: ['mcp', 'list', '--json'], envDir: '/env' },
    { name: 'npmOutdated', call: (run) => npmOutdated('/env/npm', c.signal, run), cmd: 'npm', args: ['outdated', '--json', '--prefix', '/env/npm'], envDir: null },
  ];
  for (const kase of cases) {
    const { run, calls } = fakeRun();
    await kase.call(run);
    assert.equal(calls.length, 1, kase.name);
    assert.equal(calls[0].cmd, kase.cmd, kase.name);
    assert.deepEqual(calls[0].args.slice(0, kase.args.length), kase.args, kase.name);
    assert.equal(calls[0].opts.signal, c.signal, `${kase.name}: сигнал не дошёл до запуска`);
    if (kase.envDir !== null) {
      assert.equal(calls[0].opts.env?.PI_CODING_AGENT_DIR, kase.envDir, kase.name);
    }
  }
});

test('обёртки без сигнала работают как раньше', async () => {
  const { run, calls } = fakeRun();
  await piInstall('/env', 'npm:x', undefined, run);
  assert.equal(calls[0].opts.signal, undefined);
});

test('cmdFailureText: отмена с именем', () => {
  assert.equal(cmdFailureText(ok({ cancelled: true }), 'ru', 'status.install-error', 'pkg-a'), t('ru', 'status.cancelled', { name: 'pkg-a' }));
});

test('cmdFailureText: отмена без имени', () => {
  assert.equal(cmdFailureText(ok({ cancelled: true }), 'ru', 'status.update-error', null), t('ru', 'status.cancelled.nameless'));
});

test('cmdFailureText: таймаут с именем сообщает секунды', () => {
  const s = cmdFailureText(ok({ timedOut: true, timeoutMs: 300_000 }), 'ru', 'status.update-error', 'pkg-a');
  assert.equal(s, t('ru', 'status.timeout', { name: 'pkg-a', sec: 300 }));
  assert.match(s, /300/);
});

test('cmdFailureText: таймаут без имени сообщает секунды', () => {
  const s = cmdFailureText(ok({ timedOut: true, timeoutMs: 300_000 }), 'ru', 'status.update-error', null);
  assert.equal(s, t('ru', 'status.timeout.nameless', { sec: 300 }));
  assert.match(s, /300/);
});

test('cmdFailureText: ordinary провал — stderr, при пустом stderr — fallback', () => {
  assert.equal(cmdFailureText(ok({ stderr: ' boom\n' }), 'ru', 'status.update-error', 'pkg-a'), 'boom');
  assert.equal(cmdFailureText(ok({}), 'ru', 'status.update-error', 'pkg-a'), t('ru', 'status.update-error'));
});

test('runCmd: результат несёт timeoutMs, с которым запущен процесс', async () => {
  const r = await runCmd('sh', ['-c', 'exit 0'], 1_234);
  assert.equal(r.timeoutMs, 1_234);
});
