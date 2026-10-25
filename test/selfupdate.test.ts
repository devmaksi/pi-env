import { test } from 'node:test';
import assert from 'node:assert';
import { classifyInstall, isOutdated, parseVersion, updateCommands } from '../src/selfupdate.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parseVersion: читает X.Y.Z и pre-release, мусор → null', () => {
  assert.deepEqual(parseVersion('0.2.3'), { major: 0, minor: 2, patch: 3, pre: null });
  assert.deepEqual(parseVersion('0.3.0-beta.1'), { major: 0, minor: 3, patch: 0, pre: 'beta.1' });
  assert.equal(parseVersion('next'), null);
});

test('isOutdated: свежие версии, пред-релиз старше релиза', () => {
  assert.equal(isOutdated('0.2.3', '0.2.4'), true);
  assert.equal(isOutdated('0.2.3', '0.2.3'), false);
  assert.equal(isOutdated('0.2.3', '0.2.10'), true);
  assert.equal(isOutdated('0.3.0', '0.3.0-beta.1'), false);
  assert.equal(isOutdated('weird', '0.2.4'), false);
});

test('classifyInstall: глобальный npm, npx-кэш, pi-пакет, исходники', () => {
  const A = '/home/u/.pi/agent';
  assert.equal(classifyInstall('/opt/node/lib/node_modules/@devmaksi/pi-env/dist/index.js', A), 'npm-global');
  assert.equal(classifyInstall('/home/u/.npm/_npx/ab12/node_modules/@devmaksi/pi-env/dist/index.js', A), 'npx-cache');
  assert.equal(classifyInstall('/home/u/.pi/agent/npm/node_modules/@devmaksi/pi-env/dist/index.js', A), 'pi-package');
  assert.equal(classifyInstall('/home/u/Project/pi-env/dist/index.js', A), 'unknown');
});

test('classifyInstall: checkout с .git выше по пути — source (важнее npm-global)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pienv-repo-'));
  mkdirSync(join(repo, '.git'));
  const pkgDir = join(repo, 'node_modules', '@devmaksi', 'pi-env', 'dist');
  mkdirSync(pkgDir, { recursive: true });
  const linkedPath = join(pkgDir, 'index.js');
  writeFileSync(linkedPath, '');
  assert.equal(classifyInstall(linkedPath, '/home/u/.pi/agent'), 'source');
  rmSync(repo, { recursive: true, force: true });
});

test('updateCommands: своя команда на каждый способ', () => {
  assert.deepEqual(updateCommands('npm-global'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('npx-cache'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('pi-package'), ['pi update @devmaksi/pi-env']);
  assert.deepEqual(updateCommands('unknown'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('source'), []);
});
