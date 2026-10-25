import { test } from 'node:test';
import assert from 'node:assert';
import { changelogRange, changelogRows, classifyInstall, isOutdated, mergeChangelog, parseChangelog, parseVersion, PKG_NAME, updateCommands } from '../src/selfupdate.js';
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
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: PKG_NAME, version: '0.0.0' }));
  const pkgDir = join(repo, 'node_modules', '@devmaksi', 'pi-env', 'dist');
  mkdirSync(pkgDir, { recursive: true });
  const linkedPath = join(pkgDir, 'index.js');
  writeFileSync(linkedPath, '');
  assert.equal(classifyInstall(linkedPath, '/home/u/.pi/agent'), 'source');
  rmSync(repo, { recursive: true, force: true });
});

test('classifyInstall: .git в home (dotfiles-дом) не превращает npm-установку в исходники', () => {
  const home = mkdtempSync(join(tmpdir(), 'pienv-home-'));
  mkdirSync(join(home, '.git'));
  const npmGlobal = join(home, '.npm-global', 'lib', 'node_modules', '@devmaksi', 'pi-env', 'dist');
  const nvm = join(home, '.nvm', 'versions', 'node', 'v22.23.2', 'lib', 'node_modules', '@devmaksi', 'pi-env', 'dist');
  for (const dir of [npmGlobal, nvm]) {
    mkdirSync(dir, { recursive: true });
    const entry = join(dir, 'index.js');
    writeFileSync(entry, '');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PKG_NAME, version: '0.2.3' }));
    assert.equal(classifyInstall(entry, join(home, '.pi', 'agent')), 'npm-global');
  }
  rmSync(home, { recursive: true, force: true });
});

test('classifyInstall: монорепо — наш package.json в подсказке, .git выше → source', () => {
  const root = mkdtempSync(join(tmpdir(), 'pienv-mono-'));
  mkdirSync(join(root, '.git'));
  const checkout = join(root, 'apps', 'pi-env');
  mkdirSync(join(checkout, 'src'), { recursive: true });
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: PKG_NAME, version: '0.0.0' }));
  const entry = join(checkout, 'src', 'index.ts');
  writeFileSync(entry, '');
  assert.equal(classifyInstall(entry, '/home/u/.pi/agent'), 'source');
  rmSync(root, { recursive: true, force: true });
});

test('classifyInstall: npm-установка в чужом репозитории — не source', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pienv-other-'));
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'other-project', version: '1.0.0' }));
  const pkgDir = join(repo, 'node_modules', '@devmaksi', 'pi-env', 'dist');
  mkdirSync(pkgDir, { recursive: true });
  const entry = join(pkgDir, 'index.js');
  writeFileSync(entry, '');
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: PKG_NAME, version: '0.2.3' }));
  assert.equal(classifyInstall(entry, '/home/u/.pi/agent'), 'npm-global');
  rmSync(repo, { recursive: true, force: true });
});

test('updateCommands: своя команда на каждый способ', () => {
  assert.deepEqual(updateCommands('npm-global'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('npx-cache'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('pi-package'), ['pi update @devmaksi/pi-env']);
  assert.deepEqual(updateCommands('unknown'), ['npm i -g @devmaksi/pi-env@latest']);
  assert.deepEqual(updateCommands('source'), []);
});

const SAMPLE = [
  '# Changelog', '', '## [Unreleased]', '', '### Foo', '', '- **New tab**.', '  More text.', '',
  '## [0.2.3] — 2026-10-24', '', '### Витрина пакета (npm, pi.dev)', '',
  '- **Картинки и ссылки** больше не 404.', '  Тарбол вырос до ≈1.2 МБ.', '',
  '## [0.2.2] — 2026-10-24', '', '- `pi update` пункт.',
].join('\n');

test('parseChangelog: блоки по версиям, Unreleased выброшен, Markdown снят', () => {
  const e = parseChangelog(SAMPLE);
  assert.deepEqual(e.map((x) => x.version), ['0.2.3', '0.2.2']);
  assert.equal(e[0].date, '2026-10-24');
  assert.deepEqual(e[0].sections[0].items, ['Картинки и ссылки больше не 404. Тарбол вырос до ≈1.2 МБ.']);
  assert.deepEqual(e[1].sections[0].items, ['pi update пункт.']);
});

test('parseChangelog: управляющие символы и CR вырезаны', () => {
  const e = parseChangelog('## [0.3.0] — 2026-11-01\r\n- пункт\x1b[31m красный\x00\r\n');
  assert.deepEqual(e[0].sections[0].items, ['пункт[31m красный']);
});

test('parseChangelog: пустой текст → пустой список', () => assert.deepEqual(parseChangelog(''), []));

test('changelogRange: только installed < v <= latest, свежие выше', () => {
  const e = parseChangelog(SAMPLE);
  assert.deepEqual(changelogRange(e, '0.2.1', '0.2.3').map((x) => x.version), ['0.2.3', '0.2.2']);
  assert.deepEqual(changelogRange(e, '0.2.3', '0.2.3'), []);
  assert.deepEqual(changelogRange(e, '0.2.3', '0.9.0'), []);
});

test('mergeChangelog: недостающая версия берётся из другого языка', () => {
  const ru = parseChangelog('## [0.2.3] — 2026-10-24\n- пункт ru\n');
  const en = parseChangelog('## [0.2.3] — 2026-10-24\n- item en\n## [0.2.2] — 2026-10-24\n- item 0.2.2\n');
  const merged = mergeChangelog(ru, en);
  assert.deepEqual(merged.map((x) => x.version), ['0.2.3', '0.2.2']);
  assert.equal(merged[0].sections[0].items[0], 'пункт ru');
  assert.equal(merged[1].sections[0].items[0], 'item 0.2.2');
});

test('changelogRows: версия, заголовок секции, пункт', () => {
  assert.deepEqual(changelogRows(parseChangelog(SAMPLE)).slice(0, 3), [
    { kind: 'version', text: '0.2.3 — 2026-10-24' },
    { kind: 'section', text: 'Витрина пакета (npm, pi.dev)' },
    { kind: 'item', text: 'Картинки и ссылки больше не 404. Тарбол вырос до ≈1.2 МБ.' },
  ]);
});
