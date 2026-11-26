import { test } from 'node:test';
import assert from 'node:assert';
import { createStoreLock, targetsStore } from '../src/oplock.js';

test('targetsStore: хранилище и его подкаталоги — общая цель, окружение вне хранилища — своя', () => {
  assert.equal(targetsStore('/root/.store', '/root/.store'), true);
  assert.equal(targetsStore('/root/.store/', '/root/.store'), true);
  assert.equal(targetsStore('/root/.store/npm', '/root/.store'), true);
  assert.equal(targetsStore('/root/e0', '/root/.store'), false);
  assert.equal(targetsStore('/root/.store-evil', '/root/.store'), false, 'префикс строки не равен пути');
});

test('замок: вторая команда в хранилище отклоняется, после окончания первой — проходит', async () => {
  const refused: string[] = [];
  const lock = createStoreLock((d) => d === '/store', (d) => { refused.push(d); });
  let release = () => {};
  const first = lock.run('/store', () => new Promise<void>((res) => { release = res; }));
  assert.equal(await lock.run('/store', async () => {}), false, 'вторая команда отклонена');
  assert.deepEqual(refused, ['/store']);
  release();
  await first;
  let done = false;
  assert.equal(await lock.run('/store', async () => { done = true; }), true);
  assert.equal(done, true);
});

test('замок: команды вне хранилища идут параллельно и не снимают блокировку хранилища', async () => {
  const lock = createStoreLock((d) => d === '/store', () => {});
  let release = () => {};
  const storeOp = lock.run('/store', () => new Promise<void>((res) => { release = res; }));
  let otherDone = false;
  assert.equal(await lock.run('/agent', async () => { otherDone = true; }), true);
  assert.equal(otherDone, true);
  assert.equal(lock.busy(), true);
  release();
  await storeOp;
  assert.equal(lock.busy(), false);
});

test('замок: провал задачи освобождает блокировку', async () => {
  const lock = createStoreLock(() => true, () => {});
  await assert.rejects(lock.run('/store', () => Promise.reject(new Error('EIO'))));
  assert.equal(lock.busy(), false);
  let done = false;
  assert.equal(await lock.run('/store', async () => { done = true; }), true);
  assert.equal(done, true);
});
