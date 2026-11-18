import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pathOf = (rel: string): string => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const repo = (rel: string): string => {
  const path = pathOf(rel);
  assert.ok(existsSync(path), `нет файла ${rel}`);
  return readFileSync(path, 'utf8');
};

import { parseChangelog } from '../src/selfupdate.js';
const DOCS = ['README.md', 'README.ru.md', 'docs/installation.md', 'docs/installation.ru.md',
  'docs/development.md', 'docs/development.ru.md'];

test('витрина: README.md — английский, русский текст — в README.ru.md', () => {
  const switchLine = '[English](README.md) | [Русский](README.ru.md)';
  assert.ok(repo('README.md').includes(switchLine), 'README.md: нет строки переключения языка');
  assert.ok(repo('README.ru.md').includes(switchLine), 'README.ru.md: нет строки переключения языка');
  assert.match(repo('README.md'), /^# pi-env$/m);
  assert.match(repo('README.md'), /\*\*Requirements:\*\*/);
  assert.match(repo('README.ru.md'), /\*\*Требования:\*\*/);
  assert.doesNotMatch(repo('README.md'), /Требования:/);
  assert.doesNotMatch(repo('README.ru.md'), /\*\*Requirements:\*\*/);
});

test('доки: суффикс .ru только у русских документов', () => {
  assert.match(repo('docs/installation.md'), /^# Installation$/m);
  assert.match(repo('docs/development.md'), /^# Development$/m);
  assert.match(repo('docs/installation.ru.md'), /^# Установка$/m);
  assert.match(repo('docs/development.ru.md'), /^# Разработка$/m);
});

test('демо-GIF: английский в README.md, русский в README.ru.md', () => {
  const main = repo('README.md');
  assert.ok(main.includes('](docs/demo.gif)'), 'README.md: нет английского демо-GIF');
  assert.ok(!main.includes('docs/screenshot.png'), 'README.md: витрина — демо-GIF, без скриншота');
  assert.ok(!repo('README.ru.md').includes('docs/screenshot.png'),
    'README.ru.md: витрина — демо-GIF, без скриншота');
  assert.ok(!main.includes('docs/demo.ru.gif'), 'README.md: не должен показывать русский демо-GIF');
  assert.ok(repo('README.ru.md').includes('](docs/demo.ru.gif)'),
    'README.ru.md: нет русского демо-GIF');
  assert.ok(existsSync(pathOf('docs/demo.gif')), 'нет docs/demo.gif');
  assert.ok(existsSync(pathOf('docs/demo.ru.gif')), 'нет docs/demo.ru.gif');
});

test('относительные ссылки README попадают в npm-тарбол (files)', () => {
  // Реестры (pi.dev, npm) переписывают относительные пути README в
  // cdn.jsdelivr.net/npm/<pkg>@<ver>/<path>, то есть читают тарбол, а не репозиторий:
  // файл, не попавший в `files`, даёт 404 на странице пакета при живом файле в репозитории.
  const pkg = JSON.parse(repo('package.json')) as { files?: string[] };
  const files = (pkg.files ?? []).map((entry) => entry.replace(/^\.\//, '').replace(/\/+$/, ''));
  // npm кладёт эти файлы в тарбол всегда, независимо от `files`
  const always = ['package.json', 'LICENSE', 'README.md', 'README.ru.md'];
  const shipped = (rel: string): boolean =>
    always.includes(rel) || files.some((entry) => rel === entry || rel.startsWith(`${entry}/`));

  for (const file of ['README.md', 'README.ru.md', ...DOCS]) {
    const text = repo(file);
    let i = 0;
    while ((i = text.indexOf('](', i)) >= 0) {
      const end = text.indexOf(')', i + 2);
      const target = text.slice(i + 2, end);
      i = end;
      if (!target || target.startsWith('#') || target.startsWith('mailto:') ||
          target.indexOf('://') > 0) continue;
      const target2 = target.startsWith('./') ? target.slice(2) : target;
      // относительная ссылка внутри docs/ живёт относительно каталога docs/
      const dir = file.indexOf('/') > 0 ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      assert.ok(shipped(dir + target2),
        `${file}: ${target} не попадает в npm-тарбол — добавьте каталог в "files" package.json`);
    }
  }
});

test('ссылки README и docs ведут в существующие файлы', () => {
  for (const file of DOCS) {
    const text = repo(file);
    let i = 0;
    while ((i = text.indexOf('](', i)) >= 0) {
      const end = text.indexOf(')', i + 2);
      const target = text.slice(i + 2, end);
      i = end;
      if (!target || target.startsWith('#') || target.startsWith('mailto:') ||
          target.indexOf('://') > 0) continue;
      const dir = file.indexOf('/') > 0 ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      const target2 = target.startsWith('./') ? target.slice(2) : target;
      assert.ok(existsSync(pathOf(dir + target2)), `${file}: битая ссылка ${target}`);
    }
  }
});

test('доки: корзина окружений — новые модули в перечне и спецификация названа, а не соссылана', () => {
  // `docs/superpowers/` — в `.gitignore` (рабочие артефакты разработки): их нет ни в
  // репозитории, ни в CI. Поэтому доки называют спецификацию текстом, а тест следит, чтобы в
  // доках не появилась ссылка в gitignored-каталог (для читателя репозитория она был бы битой).
  for (const file of ['docs/development.md', 'docs/development.ru.md']) {
    const text = repo(file);
    assert.ok(text.includes('src/trash.ts'), `${file}: нет src/trash.ts в перечне файлов`);
    assert.ok(text.includes('src/state-trash.ts'), `${file}: нет src/state-trash.ts в перечне файлов`);
    assert.ok(text.includes('docs/superpowers/specs/2026-10-24-env-trash-design.md'),
      `${file}: нет упоминания спецификации «Корзина окружений»`);
    assert.ok(!text.includes('](superpowers/'), `${file}: ссылка в gitignored-каталог docs/superpowers/`);
  }
  assert.ok(repo('.gitignore').includes('docs/superpowers/'),
    '`.gitignore` больше не исключает docs/superpowers/ — текст документа про это разошёлся с фактом');
});

test('доки: клонирование окружения — новый модуль в перечне файлов', () => {
  for (const file of ['docs/development.md', 'docs/development.ru.md']) {
    const text = repo(file);
    assert.ok(text.includes('src/state-clone.ts'), `${file}: нет src/state-clone.ts в перечне файлов`);
    assert.ok(text.includes('docs/superpowers/specs/2026-11-19-env-clone-design.md'),
      `${file}: нет упоминания спецификации «Клонирование окружения»`);
    assert.ok(!text.includes('](superpowers/'), `${file}: ссылка в gitignored-каталог docs/superpowers/`);
  }
});

test('чейнджлог: en и ru описывают один набор версий', () => {
  const en = parseChangelog(repo('CHANGELOG.md'));
  const ru = parseChangelog(repo('CHANGELOG.ru.md'));
  assert.ok(en.length > 0, 'CHANGELOG.md не разбирается парсером чейнджлога');
  assert.deepEqual(en.map((e) => e.version), ru.map((e) => e.version));
});

test('README: ru-читатель ведёт на CHANGELOG.ru.md, en — на CHANGELOG.md', () => {
  assert.match(repo('README.ru.md'), /blob\/master\/CHANGELOG\.ru\.md\)/);
  assert.match(repo('README.md'), /blob\/master\/CHANGELOG\.md\)/);
  assert.doesNotMatch(repo('README.md'), /CHANGELOG\.ru\.md/);
});
