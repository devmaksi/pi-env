import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../src/environments.js';

test('scan: отсутствующий корень → null', () => {
  assert.equal(scan('/nonexistent/pi-env-path'), null);
});

test('scan: пустой корень → []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: только каталоги, сортировка, флаги', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'b'));
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'skills'));
    mkdirSync(join(dir, 'a', 'extensions'));
    writeFileSync(join(dir, 'a', 'settings.json'), '{}');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.deepEqual(scan(dir), [
      { name: 'a', path: join(dir, 'a'), hasSettings: true, hasSkills: true, hasExtensions: true },
      { name: 'b', path: join(dir, 'b'), hasSettings: false, hasSkills: false, hasExtensions: false },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
