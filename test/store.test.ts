import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORE_DIR, storeRoot, storeModelsFile, modelsLinkState, ensureStoreModels,
  snapshotStoreModels, linkModels, unlinkModels, archiveEnvModelsIntoStore, envModelsFile, storeSnapshotName,
  enableModelsStorage, restoreFromStoreSnapshot,
  STORE_ROOTS, storeSettingsFile, storePackagesRoot, envRootDir, rootLinkState,
  storeLinkSummary, snapshotStoreManifest, storeRegistrySources,
  enableStoreRoots, disableStoreRoots, repairStoreRootLinks, mergeStoreRegistry,
} from '../src/store.js';
import { t } from '../src/i18n.js';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pistore-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test('storeRoot: приоритет переменной среды, настройки приложения, затем <root>/.store', () => {
  assert.equal(storeRoot('/r', null, '/tmp/env-store'), '/tmp/env-store');
  assert.equal(storeRoot('/r', '/tmp/setting-store', null), '/tmp/setting-store');
  assert.equal(storeRoot('/r', null, undefined), join('/r', STORE_DIR));
  // относительный путь настройки — относительно корня окружений
  assert.equal(storeRoot('/r', 'shared', undefined), join('/r', 'shared'));
});

test('storeModelsFile: <store>/models/models.json', () => {
  assert.equal(storeModelsFile('/s'), join('/s', 'models', 'models.json'));
});

test('modelsLinkState: off / linked / broken', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const storeFile = join(root, '.store', 'models', 'models.json');
  writeJson(env + '/models.json', { providers: { a: {} } });
  writeJson(storeFile, { providers: { b: {} } });
  assert.equal(modelsLinkState(env, storeFile), 'off', 'обычный файл окружения');

  unlinkSync(join(env, 'models.json'));
  assert.equal(modelsLinkState(env, storeFile), 'off', 'нет файла — тоже off');

  symlinkSync(storeFile, join(env, 'models.json'));
  assert.equal(modelsLinkState(env, storeFile), 'linked');

  rmSync(storeFile);
  assert.equal(modelsLinkState(env, storeFile), 'broken', 'симлинк в никуда');

  writeJson(storeFile, { providers: { b: {} } });
  unlinkSync(join(env, 'models.json'));
  symlinkSync(join(root, 'other.json'), join(env, 'models.json'));
  assert.equal(modelsLinkState(env, storeFile), 'broken', 'симлинк не в хранилище');
});

test('ensureStoreModels: берёт каталог из main-агента; без источника — ошибка', () => {
  const root = tmpDir();
  const agent = join(root, 'agent');
  writeJson(join(agent, 'models.json'), { providers: { main: {} } });
  const storeFile = join(root, '.store', 'models', 'models.json');

  assert.deepEqual(ensureStoreModels(storeFile, agent, 1_700_000_000_000, 'ru'), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(storeFile, 'utf8')), { providers: { main: {} } });

  const empty = join(root, 'agent-empty');
  mkdirSync(empty, { recursive: true });
  const res = ensureStoreModels(join(root, '.store2', 'models', 'models.json'), empty, 1_700_000_000_000, 'ru');
  assert.equal(res.ok, false);
  assert.equal(res.ok ? null : res.error, t('ru', 'err.store-no-source'));
});

test('ensureStoreModels: битый файл хранилища уходит в снимок и пересоздаётся', () => {
  const root = tmpDir();
  const agent = join(root, 'agent');
  writeJson(join(agent, 'models.json'), { providers: { main: {} } });
  const storeFile = join(root, '.store', 'models', 'models.json');
  writeJson(storeFile, 'не объект');

  assert.deepEqual(ensureStoreModels(storeFile, agent, 1_700_000_001_000, 'ru'), { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(storeFile, 'utf8')), { providers: { main: {} } });
  const baks = readdirSync(join(storeFile, '..')).filter((n) => n.startsWith('models.json.bak-'));
  assert.deepEqual(baks, ['models.json.bak-1700000001000']);
});

test('snapshotStoreModels: снимок рядом, старше keep удаляются', () => {
  const root = tmpDir();
  const storeFile = join(root, '.store', 'models', 'models.json');
  writeJson(storeFile, { providers: { a: {} } });
  for (let i = 0; i < 6; i++) {
    writeJson(storeFile, { providers: { [`v${i}`]: {} } });
    snapshotStoreModels(storeFile, 1_700_000_000_000 + i, 5);
  }
  const baks = readdirSync(join(storeFile, '..'))
    .filter((n) => n.startsWith('models.json.bak-'))
    .sort();
  assert.deepEqual(baks, [
    'models.json.bak-1700000000001', 'models.json.bak-1700000000002',
    'models.json.bak-1700000000003', 'models.json.bak-1700000000004',
    'models.json.bak-1700000000005',
  ]);
});

test('linkModels создаёт хранилище и симлинк; unlinkModels возвращает обычный файл', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const agent = join(root, 'agent');
  writeJson(join(agent, 'models.json'), { providers: { main: {} } });
  writeJson(join(env, 'settings.json'), {});
  const storeFile = join(root, '.store', 'models', 'models.json');

  assert.deepEqual(linkModels(env, storeFile, agent, 'ru'), { ok: true });
  assert.equal(modelsLinkState(env, storeFile), 'linked');
  assert.deepEqual(JSON.parse(readFileSync(storeFile, 'utf8')), { providers: { main: {} } });

  assert.deepEqual(unlinkModels(env, storeFile, 'ru'), { ok: true });
  assert.equal(modelsLinkState(env, storeFile), 'off');
  assert.deepEqual(JSON.parse(readFileSync(join(env, 'models.json'), 'utf8')), { providers: { main: {} } });
});

test('linkModels не трогает models-store.json и auth.json окружения', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const agent = join(root, 'agent');
  writeJson(join(agent, 'models.json'), { providers: { main: {} } });
  writeJson(join(env, 'models-store.json'), { personal: true });
  writeJson(join(env, 'auth.json'), { token: 'x' });
  const storeFile = join(root, '.store', 'models', 'models.json');

  linkModels(env, storeFile, agent, 'ru');
  assert.equal(existsSync(join(env, 'models-store.json')), true);
  assert.deepEqual(JSON.parse(readFileSync(join(env, 'models-store.json'), 'utf8')), { personal: true });
  assert.deepEqual(JSON.parse(readFileSync(join(env, 'auth.json'), 'utf8')), { token: 'x' });
  assert.equal(existsSync(join(root, '.store', 'models', 'models-store.json')), false);
});

test('снимок из своей копии вне root: старых снимков не больше пяти', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  const envDir = tmpDir();
  for (let i = 0; i < 7; i++) {
    writeFileSync(envModelsFile(envDir), JSON.stringify({ v: i }));
    assert.ok(archiveEnvModelsIntoStore(envDir, storeFile, 1000 + i) !== null);
  }
  const snaps = readdirSync(join(root, 'models')).filter((n) => n.includes('.bak-'));
  assert.equal(snaps.length, 5, JSON.stringify(snaps));
  assert.deepEqual(snaps.sort(), ['models.json.bak-1002', 'models.json.bak-1003', 'models.json.bak-1004', 'models.json.bak-1005', 'models.json.bak-1006']);
  assert.equal(storeSnapshotName(storeFile, 1006), 'models.json.bak-1006');
});

// ─── безопасный порядок включения хранилища ───────────────────────────

test('enableModelsStorage: общий файл создаётся ДО перемещения своей копии', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  const agent = tmpDir();
  writeJson(envModelsFile(agent), { providers: { a: { models: { m: {} } } } });
  const envDir = tmpDir();
  writeJson(envModelsFile(envDir), { own: true });
  const seen: boolean[] = [];
  const res = enableModelsStorage(envDir, storeFile, agent, 'ru', 7, {
    move: () => { seen.push(existsSync(storeFile)); return { ok: true }; },
    undo: () => {},
  });
  assert.deepEqual(seen, [true], 'к моменту перемещения общий файл уже создан');
  assert.ok(res.ok);
  assert.equal(readFileSync(envModelsFile(envDir), 'utf8'), readFileSync(storeFile, 'utf8'));
});

test('enableModelsStorage: нет общего файла и нет источника — своя копия не тронута', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  const envDir = tmpDir();
  writeJson(envModelsFile(envDir), { own: true });
  const ownBytes = readFileSync(envModelsFile(envDir), 'utf8');
  let moved = false;
  const res = enableModelsStorage(envDir, storeFile, tmpDir(), 'ru', 8, {
    move: () => { moved = true; return { ok: true }; },
    undo: () => {},
  });
  assert.equal(res.ok, false);
  assert.match((res as { error: string }).error, new RegExp(t('ru', 'err.store-no-source').slice(0, 12)));
  assert.equal(moved, false, 'перемещение не начиналось');
  assert.equal(readFileSync(envModelsFile(envDir), 'utf8'), ownBytes);
});

test('enableModelsStorage: провал перемещения — симлинка нет, копия на месте', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  writeJson(storeFile, { shared: true });
  const envDir = tmpDir();
  writeJson(envModelsFile(envDir), { own: true });
  const ownBytes = readFileSync(envModelsFile(envDir), 'utf8');
  const res = enableModelsStorage(envDir, storeFile, tmpDir(), 'ru', 9, {
    move: () => ({ ok: false, error: 'корзина недоступна' }),
    undo: () => { throw new Error('undo не вызывается при провале перемещения'); },
  });
  assert.equal(res.ok, false);
  assert.equal(lstatSync(envModelsFile(envDir)).isSymbolicLink(), false);
  assert.equal(readFileSync(envModelsFile(envDir), 'utf8'), ownBytes);
});

test('enableModelsStorage: провал симлинка — копия возвращена (undo)', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  writeJson(storeFile, { shared: true });
  const envDir = tmpDir();
  // каталог на месте models.json: симлинк поставить нельзя (каталоги linkModels не снимает)
  mkdirSync(envModelsFile(envDir), { recursive: true });
  let undone = 0;
  const res = enableModelsStorage(envDir, storeFile, tmpDir(), 'ru', 10, {
    move: () => { undone = -1; return { ok: true }; },
    undo: () => { undone += 1; },
  });
  assert.equal(res.ok, false);
  assert.equal(undone, 0, 'undo вызван ровно один раз');
});

test('restoreFromStoreSnapshot: откат возвращает файл и убирает снимок', () => {
  const root = tmpDir();
  const storeFile = storeModelsFile(root);
  const envDir = tmpDir();
  writeJson(envModelsFile(envDir), { own: true });
  const snap = archiveEnvModelsIntoStore(envDir, storeFile, 11);
  assert.ok(snap !== null);
  assert.equal(existsSync(envModelsFile(envDir)), false);
  const ownBytes = '{\n  "own": true\n}';
  restoreFromStoreSnapshot(snap!, envDir);
  assert.equal(readFileSync(envModelsFile(envDir), 'utf8'), ownBytes);
  assert.equal(existsSync(snap!), false);
});

// --- Подрез 2a: пакетные корни хранилища (npm/git) ---

test('rootLinkState: off / linked / broken для каталога', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const store = join(root, STORE_DIR);
  mkdirSync(env);
  assert.equal(rootLinkState(env, store, 'npm'), 'off');          // папки нет
  mkdirSync(join(env, 'npm'));
  assert.equal(rootLinkState(env, store, 'npm'), 'off');          // обычный каталог — не связь
  rmSync(join(env, 'npm'), { recursive: true });
  mkdirSync(join(store, 'npm'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  assert.equal(rootLinkState(env, store, 'npm'), 'linked');
  rmSync(join(store, 'npm'), { recursive: true });
  assert.equal(rootLinkState(env, store, 'npm'), 'broken');       // симлинк в никуда
});

test('rootLinkState: симлинк не в хранилище — broken', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const store = join(root, STORE_DIR);
  const elsewhere = join(root, 'other', 'npm');
  mkdirSync(env);
  mkdirSync(elsewhere, { recursive: true });
  symlinkSync(elsewhere, join(env, 'npm'), 'dir');
  assert.equal(rootLinkState(env, store, 'npm'), 'broken');
});

test('storeLinkSummary: off / linked / partial / broken', () => {
  const root = tmpDir();
  const env = join(root, 'e1');
  const store = join(root, STORE_DIR);
  mkdirSync(env);
  assert.equal(storeLinkSummary(env, store), 'off');
  mkdirSync(join(store, 'npm'), { recursive: true });
  mkdirSync(join(store, 'git'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync(join(store, 'git'), join(env, 'git'), 'dir');
  assert.equal(storeLinkSummary(env, store), 'linked');
  rmSync(join(env, 'git'));
  mkdirSync(join(env, 'git'));                       // git снова своя копия
  assert.equal(storeLinkSummary(env, store), 'partial');
  rmSync(join(store, 'npm'), { recursive: true });                    // симлинк npm в никуда
  assert.equal(storeLinkSummary(env, store), 'broken');
});

test('snapshotStoreManifest: package.json и package-lock.json уходят в .bak-<мс>', () => {
  const store = tmpDir();
  writeJson(join(store, 'npm', 'package.json'), { dependencies: {} });
  writeJson(join(store, 'npm', 'package-lock.json'), { lockfileVersion: 3 });
  snapshotStoreManifest(store, 123);
  assert.ok(existsSync(join(store, 'npm', 'package.json.bak-123')));
  assert.ok(existsSync(join(store, 'npm', 'package-lock.json.bak-123')));
});

test('storeRegistrySources: packages из реестра, [] если файла или поля нет', () => {
  const store = tmpDir();
  assert.deepEqual(storeRegistrySources(store), []);
  writeFileSync(storeSettingsFile(store), JSON.stringify({ packages: ['npm:pi-zentui', 5, 'git:github.com/obra/superpowers'] }));
  assert.deepEqual(storeRegistrySources(store), ['npm:pi-zentui', 'git:github.com/obra/superpowers']);
});

// --- Подрез 2a: включение/выключение пакетных корней ---

function mkStoreEnv(roots: StoreRoot[] = [...STORE_ROOTS]): { root: string; store: string; env: string } {
  const root = tmpDir();
  const store = join(root, STORE_DIR);
  const env = join(root, 'e1');
  mkdirSync(env);
  for (const r of roots) {
    mkdirSync(join(env, r, 'node_modules'), { recursive: true });
    writeFileSync(join(env, r, 'package.json'), '{}');
  }
  return { root, store, env };
}

test('enableStoreRoots: первый переезжает, второй получает симлинк поверх move', () => {
  const { root, store, env: e1 } = mkStoreEnv();
  const moved: StoreRoot[] = [];
  const r1 = enableStoreRoots(e1, store, STORE_ROOTS, 'ru', {
    move: (r) => { moved.push(r); mkdirSync(store, { recursive: true }); renameSync(envRootDir(e1, r), storePackagesRoot(store, r)); return { ok: true }; },
    undo: () => {},
  });
  assert.equal(r1.ok, true);
  assert.equal(lstatSync(join(e1, 'npm')).isSymbolicLink(), true);
  assert.equal(rootLinkState(e1, store, 'npm'), 'linked');
  assert.ok(existsSync(join(store, 'npm', 'package.json')));   // переехал, не скопирован

  const e2 = join(root, 'e2');
  mkdirSync(join(e2, 'npm'), { recursive: true });
  mkdirSync(join(e2, 'git'), { recursive: true });
  const r2 = enableStoreRoots(e2, store, STORE_ROOTS, 'ru', {
    move: (r) => { moved.push(r); rmSync(envRootDir(e2, r), { recursive: true }); return { ok: true }; },
    undo: () => {},
  });
  assert.equal(r2.ok, true);
  assert.deepEqual(moved, ['npm', 'git', 'npm', 'git']);
  assert.equal(rootLinkState(e2, store, 'npm'), 'linked');
});

test('enableStoreRoots: уже linked — no-op без move', () => {
  const { store, env } = mkStoreEnv();
  mkdirSync(join(store, 'npm'), { recursive: true });
  mkdirSync(join(store, 'git'), { recursive: true });
  rmSync(join(env, 'npm'), { recursive: true });
  rmSync(join(env, 'git'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync(join(store, 'git'), join(env, 'git'), 'dir');
  let calls = 0;
  const r = enableStoreRoots(env, store, STORE_ROOTS, 'ru', {
    move: () => { calls++; return { ok: true }; }, undo: () => { calls++; },
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 0);
});

test('enableStoreRoots: путь окружения остался занят — ошибка и undo, симлинков нет', () => {
  const { store, env } = mkStoreEnv(['git']);
  const undone: StoreRoot[] = [];
  const r = enableStoreRoots(env, store, ['git'], 'ru', {
    move: () => ({ ok: true }),                       // move ничего не освободил
    undo: (root) => { undone.push(root); },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(undone, ['git']);
  assert.equal(lstatSync(join(env, 'git')).isSymbolicLink(), false);
  assert.ok(existsSync(join(env, 'git', 'package.json')));  // своё содержимое на месте
});

test('repairStoreRootLinks: чинит только broken, linked не трогает', () => {
  const { store, env } = mkStoreEnv();
  rmSync(join(env, 'npm'), { recursive: true });
  rmSync(join(env, 'git'), { recursive: true });
  mkdirSync(join(store, 'npm'), { recursive: true });
  mkdirSync(join(store, 'git'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync('/nonexistent-path', join(env, 'git'), 'dir');
  assert.equal(rootLinkState(env, store, 'git'), 'broken');
  const r = repairStoreRootLinks(env, store, STORE_ROOTS, 'ru');
  assert.equal(r.ok, true);
  assert.equal(rootLinkState(env, store, 'npm'), 'linked');
  assert.equal(rootLinkState(env, store, 'git'), 'linked');
});

test('repairStoreRootLinks: удалённый общий корень создаётся, а не остаётся битым симлинком', () => {
  const { store, env } = mkStoreEnv();
  rmSync(join(env, 'npm'), { recursive: true });
  rmSync(join(env, 'git'), { recursive: true });
  rmSync(join(store, 'npm'), { recursive: true, force: true });  // чистка или переезд PI_ENV_STORE
  rmSync(join(store, 'git'), { recursive: true, force: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync(join(store, 'git'), join(env, 'git'), 'dir');
  assert.equal(rootLinkState(env, store, 'npm'), 'broken');
  const r = repairStoreRootLinks(env, store, STORE_ROOTS, 'ru');
  assert.equal(r.ok, true, r.ok ? '' : r.error);
  assert.equal(rootLinkState(env, store, 'npm'), 'linked');
  assert.equal(rootLinkState(env, store, 'git'), 'linked');
});

test('disableStoreRoots: провал копирования оставляет окружение связанным, без полу-копии', () => {
  const { store, env } = mkStoreEnv();
  rmSync(join(env, 'npm'), { recursive: true });
  rmSync(join(env, 'git'), { recursive: true });
  mkdirSync(join(store, 'npm', 'node_modules'), { recursive: true });
  mkdirSync(join(store, 'git'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync(join(store, 'git'), join(env, 'git'), 'dir');
  const r = disableStoreRoots(env, store, STORE_ROOTS, 'ru', () => { throw new Error('ENOSPC'); });
  assert.equal(r.ok, false);
  assert.notEqual(r.error, t('ru', 'err.link-root'), 'ошибка копирования отличается от ошибки связывания');
  assert.equal(rootLinkState(env, store, 'npm'), 'linked', 'окружение остаётся связанным');
  assert.deepEqual(readdirSync(env).filter((n) => n.includes('tmp')), []);
});

test('disableStoreRoots: вместо симлинка — обычная копия содержимого хранилища', () => {
  const { store, env } = mkStoreEnv();
  rmSync(join(env, 'npm'), { recursive: true });
  rmSync(join(env, 'git'), { recursive: true });
  mkdirSync(join(store, 'npm', 'node_modules'), { recursive: true });
  writeFileSync(join(store, 'npm', 'package.json'), '{}');
  mkdirSync(join(store, 'git'), { recursive: true });
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  symlinkSync(join(store, 'git'), join(env, 'git'), 'dir');
  const r = disableStoreRoots(env, store, STORE_ROOTS, 'ru');
  assert.equal(r.ok, true);
  assert.equal(lstatSync(join(env, 'npm')).isSymbolicLink(), false);
  assert.ok(existsSync(join(env, 'npm', 'package.json')));
  assert.ok(existsSync(join(env, 'npm', 'node_modules')));
});

test('enableStoreRoots: общего корня нет — он создаётся, симлинк не битый', () => {
  const { store, env } = mkStoreEnv([]);
  const r = enableStoreRoots(env, store, ['npm'], 'ru', { move: () => ({ ok: true }), undo: () => {} });
  assert.equal(r.ok, true);
  assert.equal(rootLinkState(env, store, 'npm'), 'linked');
  assert.ok(existsSync(storePackagesRoot(store, 'npm')));
});

test('disableStoreRoots: у окружения нет симлинка — no-op без ошибки', () => {
  const { env } = mkStoreEnv();
  const r = disableStoreRoots(env, join(env, '..', '.store'), STORE_ROOTS, 'ru');
  assert.equal(r.ok, true, r.error);
});

test('disableStoreRoots: симлинк в несуществующий общий корень — ошибка, а не тихая потеря', () => {
  const { store, env } = mkStoreEnv([]);
  symlinkSync(join(store, 'npm'), join(env, 'npm'), 'dir');
  const r = disableStoreRoots(env, store, ['npm'], 'ru');
  assert.equal(r.ok, false);
});

test('mergeStoreRegistry: первый реестр собирается из объявлений подключённых каталогов', () => {
  const store = tmpDir();
  const r = mergeStoreRegistry(store, ['npm:pi-zentui', 'npm:@sfroment/pi-obsidian'], 'ru');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(storeRegistrySources(store), ['npm:pi-zentui', 'npm:@sfroment/pi-obsidian']);
});

test('mergeStoreRegistry: другие поля реестра сохраняются, дубликаты не плодятся', () => {
  const store = tmpDir();
  writeJson(storeSettingsFile(store), { theme: 'dark', packages: ['npm:pi-zentui'] });
  mergeStoreRegistry(store, ['npm:pi-zentui', 'npm:pi-ssh-remote'], 'ru');
  const value = JSON.parse(readFileSync(storeSettingsFile(store), 'utf8')) as { theme?: string; packages?: string[] };
  assert.equal(value.theme, 'dark');
  assert.deepEqual(value.packages, ['npm:pi-zentui', 'npm:pi-ssh-remote']);
});

test('mergeStoreRegistry: нечитаемый реестр — ошибка, файл не тронут', () => {
  const store = tmpDir();
  writeFileSync(storeSettingsFile(store), '{битый');
  const before = readFileSync(storeSettingsFile(store), 'utf8');
  const r = mergeStoreRegistry(store, ['npm:x'], 'ru');
  assert.equal(r.ok, false);
  assert.equal(readFileSync(storeSettingsFile(store), 'utf8'), before);
});
