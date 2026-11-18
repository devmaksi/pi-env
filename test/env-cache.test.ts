import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScanCache, scanSignature } from '../src/env-cache.js';
import { scan } from '../src/environments.js';
import { listTrash } from '../src/trash.js';

const dirs: string[] = [];
function tmpRoot(withEnvs = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  dirs.push(dir);
  if (withEnvs) {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'settings.json'), JSON.stringify({ defaultModel: 'p/m1' }));
  }
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const names = (envs: { name: string }[] | null): string[] => (envs ?? []).map((e) => e.name);

test('подпись не изменилась → scan вызван один раз на много get()', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, {
    scan: (r) => { scanCalls++; return scan(r); },
    listTrash: (r) => listTrash(r),
  });
  const a = cache.get();
  const b = cache.get();
  assert.equal(scanCalls, 1);
  assert.deepEqual(names(a.envs), names(b.envs));
  assert.equal(a.envs, b.envs); // тот же объект — кэш, а не повторный скан
});

test('правка settings.json снаружи → перечитка, детали обновились', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, { scan: (r) => { scanCalls++; return scan(r); } });
  assert.equal(cache.get().envs?.[0].details.model, 'p/m1');
  writeFileSync(join(root, 'dev', 'settings.json'), JSON.stringify({ defaultModel: 'p/m2' }));
  const snap = cache.get();
  assert.equal(scanCalls, 2);
  assert.equal(snap.envs?.[0].details.model, 'p/m2');
});

test('новое окружение, созданное снаружи → перечитка', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, { scan: (r) => { scanCalls++; return scan(r); } });
  assert.deepEqual(names(cache.get().envs), ['dev']);
  mkdirSync(join(root, 'outer'));
  const snap = cache.get();
  assert.equal(scanCalls, 2);
  assert.deepEqual(names(snap.envs), ['dev', 'outer']);
});

test('подпись покрывает mcp.json и skills/', () => {
  const root = tmpRoot();
  mkdirSync(join(root, 'dev', 'skills', 'sk-a'), { recursive: true });
  let scanCalls = 0;
  const cache = createScanCache(root, { scan: (r) => { scanCalls++; return scan(r); } });
  cache.get();
  writeFileSync(join(root, 'dev', 'mcp.json'), JSON.stringify({ servers: { docs: { type: 'stdio', command: 'c' } } }));
  cache.get();
  assert.equal(scanCalls, 2);
  mkdirSync(join(root, 'dev', 'skills', 'sk-b'));
  cache.get();
  assert.equal(scanCalls, 3);
});

test('invalidate() → перечитка без смены подписи', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, { scan: (r) => { scanCalls++; return scan(r); } });
  cache.get();
  cache.get();
  assert.equal(scanCalls, 1);
  cache.invalidate();
  cache.get();
  assert.equal(scanCalls, 2);
});

test('недоступный корень не кэшируется', () => {
  const root = tmpRoot(false);
  rmSync(root, { recursive: true, force: true });
  let sigCalls = 0;
  const cache = createScanCache(root, {
    scan: (r) => scan(r),
    signature: (r) => { const s = scanSignature(r); sigCalls++; return s; },
  });
  assert.equal(cache.get().envs, null);
  assert.equal(cache.get().envs, null);
  assert.equal(sigCalls, 2);
  mkdirSync(root, { recursive: true });
  assert.deepEqual(names(cache.get().envs), []);
});

test('scanSignature детерминирована на одном дереве', () => {
  const root = tmpRoot();
  assert.equal(scanSignature(root), scanSignature(root));
  assert.notEqual(scanSignature(root), null);
});

test('корзина кэшируется вместе со снимком и перечитывается после invalidate', () => {
  const root = tmpRoot();
  let trashCalls = 0;
  const cache = createScanCache(root, {
    scan: (r) => scan(r),
    listTrash: (r) => { trashCalls++; return listTrash(r); },
  });
  cache.get();
  cache.get();
  assert.equal(trashCalls, 1);
  cache.invalidate();
  cache.get();
  assert.equal(trashCalls, 2);
});
