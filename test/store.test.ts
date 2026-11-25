import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STORE_DIR, storeRoot, storeModelsFile, modelsLinkState, ensureStoreModels,
  snapshotStoreModels, linkModels, unlinkModels, archiveEnvModelsIntoStore, envModelsFile, storeSnapshotName,
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
    assert.equal(archiveEnvModelsIntoStore(envDir, storeFile, 1000 + i), true);
  }
  const snaps = readdirSync(join(root, 'models')).filter((n) => n.includes('.bak-'));
  assert.equal(snaps.length, 5, JSON.stringify(snaps));
  assert.deepEqual(snaps.sort(), ['models.json.bak-1002', 'models.json.bak-1003', 'models.json.bak-1004', 'models.json.bak-1005', 'models.json.bak-1006']);
  assert.equal(storeSnapshotName(storeFile, 1006), 'models.json.bak-1006');
});
