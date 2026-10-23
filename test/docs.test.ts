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
  assert.ok(!main.includes('docs/demo.ru.gif'), 'README.md: не должен показывать русский демо-GIF');
  assert.ok(repo('README.ru.md').includes('](docs/demo.ru.gif)'),
    'README.ru.md: нет русского демо-GIF');
  assert.ok(existsSync(pathOf('docs/demo.gif')), 'нет docs/demo.gif');
  assert.ok(existsSync(pathOf('docs/demo.ru.gif')), 'нет docs/demo.ru.gif');
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
