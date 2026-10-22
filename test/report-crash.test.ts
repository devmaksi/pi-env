import { test } from 'node:test';
import assert from 'node:assert';
import { reportCrash } from '../src/run.js';

test('reportCrash: локализованная строка и stack — двумя строками в сток записи', () => {
  const lines: string[] = [];
  const boom = new Error('boom');
  reportCrash(boom, 'ru', (s) => lines.push(s));
  assert.equal(lines.length, 1, 'один вызов записи');
  const out = lines[0];
  assert.ok(out.startsWith('pi-env: сбой программы — терминал восстановлен\n'), out.slice(0, 60));
  assert.ok(out.includes('Error: boom'), 'stack сообщён');
  assert.ok(out.endsWith('\n'), 'заканчивается переводом строки');
});

test('reportCrash: язык влияет на строку', () => {
  const lines: string[] = [];
  reportCrash(new Error('boom'), 'en', (s) => lines.push(s));
  assert.ok(lines[0].startsWith('pi-env: crash — terminal restored\n'), lines[0].slice(0, 60));
});

test('reportCrash: не-Error значение сообщается как текст', () => {
  const lines: string[] = [];
  reportCrash('plain-reason', 'en', (s) => lines.push(s));
  assert.ok(lines[0].includes('plain-reason'), lines[0]);
});

