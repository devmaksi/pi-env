import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, resolve, loadLocales, localeCodes, nativeName, pickDefault, defaultLang } from '../src/i18n.js';

test('t: строки ru и en', () => {
  assert.equal(t('ru', 'tab.envs'), 'Окружения');
  assert.equal(t('en', 'tab.envs'), 'Environments');
});

test('t: подстановка {param}', () => {
  assert.equal(t('ru', 'status.installed', { name: 'npm:pi-x' }), 'Установлено: npm:pi-x');
  assert.equal(t('en', 'status.installed', { name: 'npm:pi-x' }), 'Installed: npm:pi-x');
});

test('t: неизвестный язык — fallback на ru', () => {
  assert.equal(t('de', 'tab.envs'), 'Окружения');
});

test('resolve: частичный перевод — отсутствующий ключ берётся из ru', () => {
  const known = { ru: { a: 'А', b: 'Б' }, fr: { a: 'A' } };
  assert.equal(resolve(known, 'fr', 'a'), 'A');
  assert.equal(resolve(known, 'fr', 'b'), 'Б');
  assert.equal(resolve(known, 'fr', 'c'), undefined);
});

test('localeCodes: ru и en из репозитория, отсортированы', () => {
  const codes = localeCodes();
  assert.ok(codes.includes('ru') && codes.includes('en'));
  assert.deepEqual(codes, [...codes].sort());
});

test('nativeName: имя на собственном языке, неизвестный код — сам код', () => {
  assert.equal(nativeName('ru'), 'Русский');
  assert.equal(nativeName('en'), 'English');
  assert.equal(nativeName('xx'), 'xx');
});

test('loadLocales: битый JSON и не-JSON пропускаются', () => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-'));
  writeFileSync(join(dir, 'ok.json'), '{"a":"b"}');
  writeFileSync(join(dir, 'bad.json'), '{не json');
  writeFileSync(join(dir, 'readme.txt'), 'nope');
  const loc = loadLocales(dir);
  assert.deepEqual(Object.keys(loc), ['ok']);
  assert.equal(loc.ok.a, 'b');
});

test('loadLocales: нет каталога — пустая карта, без исключений', () => {
  assert.deepEqual(loadLocales('/nonexistent-dir-i18n'), {});
});

test('parity: en.json содержит все ключи ru.json', () => {
  const read = (p: string): Record<string, string> =>
    JSON.parse(readFileSync(new URL(`../src/locales/${p}`, import.meta.url), 'utf8'));
  const ru = read('ru.json');
  const en = read('en.json');
  const missing = Object.keys(ru).filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});

test('pickDefault: первый известный кандидат, иначе ru', () => {
  assert.equal(pickDefault(['de', 'en', 'ru'], ['en', 'ru']), 'en');
  assert.equal(pickDefault(['de'], ['en', 'ru']), 'ru');
  assert.equal(pickDefault([], []), 'ru');
});

test('defaultLang: системный код среди известных или ru', () => {
  const lang = defaultLang(['ru', 'en']);
  assert.ok(lang === 'ru' || lang === 'en');
});
