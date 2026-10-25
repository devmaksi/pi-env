import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PKG_NAME } from '../src/selfupdate.js';
import { fetchChangelogEntries, runSelfCheck, type SelfCheckDeps } from '../src/selfupdate-net.js';

type FakeRes = { ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };

const fakeText = (body: string): FakeRes => ({ ok: true, json: async () => ({}), text: async () => body });

const boom = () => Promise.reject(new Error('offline'));
const notFound = (): Promise<FakeRes> => Promise.resolve({ ok: false, json: async () => ({}), text: async () => '' });
const badJson = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => { throw new Error('bad'); }, text: async () => 'x' });
const noLatest = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ 'dist-tags': {} }), text: async () => '' });
const latest024 = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ 'dist-tags': { latest: '0.2.4' } }), text: async () => '' });
const latest023 = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ 'dist-tags': { latest: '0.2.3' } }), text: async () => '' });
// Реальный ответ `registry.npmjs.org/<pkg>/latest` — документ конкретной версии:
// в нём есть `version`, а `dist-tags` отсутствует вовсе (проверено на @devmaksi/pi-env 0.2.3).
const docVersion024 = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ name: '@devmaksi/pi-env', version: '0.2.4' }), text: async () => '' });
const docVersion023 = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ name: '@devmaksi/pi-env', version: '0.2.3' }), text: async () => '' });
const docNoVersion = (): Promise<FakeRes> => Promise.resolve({ ok: true, json: async () => ({ name: '@devmaksi/pi-env' }), text: async () => '' });

const baseDeps: SelfCheckDeps = {
  fetchFn: latest024,
  installedVersion: '0.2.3',
  moduleRealPath: '/opt/node/lib/node_modules/@devmaksi/pi-env/dist/index.js',
  agentNpmDir: '/home/u/.pi/agent/npm',
  noCheck: false,
};
const changelogDeps: Omit<SelfCheckDeps, 'installedVersion'> = {
  fetchFn: latest024,
  moduleRealPath: '/opt/node/lib/node_modules/@devmaksi/pi-env/dist/index.js',
  agentNpmDir: '/home/u/.pi/agent/npm',
  noCheck: false,
};

test('runSelfCheck: сеть/битый ответ → null на всех четырёх случаях', async () => {
  for (const f of [boom, notFound, badJson, noLatest]) {
    assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: f as SelfCheckDeps['fetchFn'] }), null);
  }
});

test('runSelfCheck: noCheck и установка из исходников — fetch не вызывается вовсе', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pienv-src-'));
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: PKG_NAME, version: '0.0.0' }));
  mkdirSync(join(repo, 'dist'));
  let calls = 0;
  const spy = () => { calls++; return boom(); };
  assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: spy, noCheck: true }), null);
  assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: spy, moduleRealPath: join(repo, 'dist', 'index.js') }), null);
  assert.equal(calls, 0);
  rmSync(repo, { recursive: true, force: true });
});

test('runSelfCheck: устарели → SelfUpdate с номером и способом', async () => {
  const r = await runSelfCheck({ ...baseDeps, fetchFn: latest024, now: () => 1_700_000_000_000 });
  assert.deepEqual(r, { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 });
});

test('runSelfCheck: /latest отдаёт документ версии без dist-tags — читаем version (реальный формат npm)', async () => {
  const r = await runSelfCheck({ ...baseDeps, fetchFn: docVersion024, now: () => 1_700_000_000_000 });
  assert.deepEqual(r, { latest: '0.2.4', installed: '0.2.3', kind: 'npm-global', checkedAt: 1_700_000_000_000 });
});

test('runSelfCheck: документ версии = установленная → null (вкладки нет)', async () => {
  assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: docVersion023 }), null);
});

test('runSelfCheck: в ответе нет ни dist-tags, ни version → null', async () => {
  assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: docNoVersion }), null);
});

test('runSelfCheck: установлена последняя версия → null (вкладки нет)', async () => {
  assert.equal(await runSelfCheck({ ...baseDeps, fetchFn: latest023 }), null);
});

test('fetchChangelogEntries: перевод есть — один запрос', async () => {
  const urls: string[] = [];
  const fetchFn = (url: string) => { urls.push(url); return Promise.resolve(fakeText('## [0.2.4] — 2026-11-01\n- пункт ru\n')); };
  const entries = await fetchChangelogEntries({ ...changelogDeps, fetchFn }, 'ru', 'en', { installed: '0.2.3', latest: '0.2.4' });
  assert.deepEqual(entries?.map((e) => e.version), ['0.2.4']);
  assert.equal(urls.length, 1);
});

test('fetchChangelogEntries: в ru нет версии — догружается второй язык', async () => {
  const fetchFn = (url: string) =>
    Promise.resolve(url.endsWith('CHANGELOG.ru.md')
      ? fakeText('## [0.2.3] — 2026-10-24\n- старый пункт\n')
      : fakeText('## [0.2.4] — 2026-11-01\n- item en\n'));
  const entries = await fetchChangelogEntries({ ...changelogDeps, fetchFn }, 'ru', 'en', { installed: '0.2.3', latest: '0.2.4' });
  assert.deepEqual(entries?.map((e) => e.version), ['0.2.4', '0.2.3']);
  assert.equal(entries?.[0].sections[0].items[0], 'item en');
});

test('fetchChangelogEntries: оба языка недоступны → null', async () => {
  const entries = await fetchChangelogEntries({ ...changelogDeps, fetchFn: boom }, 'ru', 'en', { installed: '0.2.3', latest: '0.2.4' });
  assert.equal(entries, null);
});
