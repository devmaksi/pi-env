import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createScanCache, scanSignature } from '../src/env-cache.js';
import { scan } from '../src/environments.js';
import { listTrash } from '../src/trash.js';

const dirs: string[] = [];

/** Каталог main-агента вне корня — снимок обязан его учитывать. */
function tmpAgent(): string {
  const d = mkdtempSync(join(tmpdir(), 'pienv-agent-'));
  dirs.push(d);
  writeFileSync(join(d, 'settings.json'), JSON.stringify({ defaultModel: 'p/main' }));
  return d;
}
const AGENT = tmpAgent();
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

const real = (envs: { name: string; main?: boolean }[] | null) => (envs ?? []).filter((e) => e.main !== true);
const names = (envs: { name: string; main?: boolean }[] | null): string[] => real(envs).map((e) => e.name);
const dev = (envs: { name: string }[] | null) => (envs ?? []).find((e) => e.name === 'dev')!;

test('подпись не изменилась → scan вызван один раз на много get()', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, AGENT, {
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
  const cache = createScanCache(root, AGENT, { scan: (r) => { scanCalls++; return scan(r); } });
  assert.equal(dev(cache.get().envs).details.model, 'p/m1');
  writeFileSync(join(root, 'dev', 'settings.json'), JSON.stringify({ defaultModel: 'p/m2' }));
  const snap = cache.get();
  assert.equal(scanCalls, 2);
  assert.equal(dev(snap.envs).details.model, 'p/m2');
});

test('новое окружение, созданное снаружи → перечитка', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, AGENT, { scan: (r) => { scanCalls++; return scan(r); } });
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
  const cache = createScanCache(root, AGENT, { scan: (r) => { scanCalls++; return scan(r); } });
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
  const cache = createScanCache(root, AGENT, { scan: (r) => { scanCalls++; return scan(r); } });
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
  const cache = createScanCache(root, AGENT, {
    scan: (r) => scan(r),
    signature: (r, a) => { const s = scanSignature(r, a); sigCalls++; return s; },
  });
  assert.equal(cache.get().envs, null);
  assert.equal(cache.get().envs, null);
  assert.equal(sigCalls, 2);
  mkdirSync(root, { recursive: true });
  assert.deepEqual(names(cache.get().envs), []);
});

test('scanSignature детерминирована на одном дереве', () => {
  const root = tmpRoot();
  assert.equal(scanSignature(root, AGENT), scanSignature(root, AGENT));
  assert.notEqual(scanSignature(root, AGENT), null);
});

test('корзина кэшируется вместе со снимком и перечитывается после invalidate', () => {
  const root = tmpRoot();
  let trashCalls = 0;
  const cache = createScanCache(root, AGENT, {
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

test('подпись включает агентский каталог: правка его settings.json → перечитка', () => {
  const root = tmpRoot();
  let scanCalls = 0;
  const cache = createScanCache(root, AGENT, { scan: (r) => { scanCalls++; return scan(r); } });
  cache.get();
  writeFileSync(join(AGENT, 'settings.json'), JSON.stringify({ defaultModel: 'p/m2' }));
  const after = cache.get();
  assert.equal(scanCalls, 2);
  assert.equal(after.envs?.[0].main, true);
  assert.equal(after.envs?.[0].details.model, 'p/m2');
});

test('снимок: основная запись вне корня — первой, обычные окружения после неё', () => {
  const root = tmpRoot();
  const snap = createScanCache(root, AGENT, { scan: (r) => scan(r) }).get();
  assert.deepEqual(snap.envs?.map((e) => e.name), [basename(AGENT), 'dev']);
  assert.deepEqual(snap.envs?.map((e) => e.main === true), [true, false]);
});

test('снимок: агентский каталог внутри корня — одна строка с пометкой, без дубля', () => {
  const root = tmpRoot();
  const snap = createScanCache(root, join(root, 'dev'), { scan: (r) => scan(r) }).get();
  assert.deepEqual((snap.envs ?? []).map((e) => e.name), ['dev']);
  assert.equal(dev(snap.envs).main, true);
});

test('scanSignature: другой агентский каталог — другая подпись', () => {
  const root = tmpRoot();
  assert.notEqual(scanSignature(root, AGENT), scanSignature(root, join(root, 'dev')));
});

test('scanSignature: правка общего файла хранилища меняет подпись', () => {
  const root = tmpRoot();
  const storeFile = join(root, '.store', 'models', 'models.json');
  mkdirSync(join(storeFile, '..'), { recursive: true });
  writeFileSync(storeFile, '{"providers":{"a":{}}}');
  const before = scanSignature(root, AGENT, storeFile);
  assert.notEqual(before, null);
  writeFileSync(storeFile, '{"providers":{"a":{},"b":{}}}');
  assert.notEqual(scanSignature(root, AGENT, storeFile), before);
  assert.equal(scanSignature(root, AGENT, null), scanSignature(root, AGENT));
});

test('createScanCache с хранилищем: обрыв симлинка виден без invalidate', () => {
  const root = tmpRoot();
  const storeFile = join(root, '.store', 'models', 'models.json');
  mkdirSync(join(storeFile, '..'), { recursive: true });
  writeFileSync(storeFile, '{"providers":{}}');
  symlinkSync(storeFile, join(root, 'dev', 'models.json'));
  let scanCalls = 0;
  const cache = createScanCache(root, AGENT, { scan: (r, s) => { scanCalls++; return scan(r, s); } }, storeFile);
  assert.equal(dev(cache.get().envs).details.modelsLink, 'linked');
  rmSync(storeFile);
  const snap = cache.get();
  assert.equal(scanCalls, 2);
  assert.equal(dev(snap.envs).details.modelsLink, 'broken');
});
