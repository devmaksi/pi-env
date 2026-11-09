import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { debugEnabled, formatLogLine, createDebugLog, dedupedLog, logFileFor, fileLogger } from '../src/debuglog.js';

test('debugEnabled: только PI_ENV_DEBUG=1', () => {
  assert.equal(debugEnabled({ PI_ENV_DEBUG: '1' }), true);
  assert.equal(debugEnabled({ PI_ENV_DEBUG: '0' }), false);
  assert.equal(debugEnabled({ PI_ENV_DEBUG: 'true' }), false);
  assert.equal(debugEnabled({}), false);
});

test('formatLogLine: дата-время, тег и текст — одной строкой', () => {
  const ts = new Date(2026, 10, 9, 19, 4, 1).getTime();
  assert.equal(
    formatLogLine(ts, 'env', 'demo: settings.json — битый JSON'),
    '2026-11-09 19:04:01 env: demo: settings.json — битый JSON',
  );
});

test('createDebugLog: одна запись на пару (tag, message)', () => {
  const lines: string[] = [];
  let t = 0;
  const log = createDebugLog({ enabled: true, append: (s) => lines.push(s), now: () => ++t });
  log('env', 'demo: settings.json — битый JSON');
  log('env', 'demo: settings.json — битый JSON');
  log('env', 'other: mcp.json — битый JSON');
  log('scan', 'demo: settings.json — битый JSON');
  assert.equal(lines.length, 3);
});

test('createDebugLog: выключенный debug ничего не пишет', () => {
  const lines: string[] = [];
  const log = createDebugLog({ enabled: false, append: (s) => lines.push(s), now: () => 0 });
  log('env', 'demo: что-то');
  assert.deepEqual(lines, []);
});

test('createDebugLog: сбой записи не роняет приложение', () => {
  const log = createDebugLog({
    enabled: true,
    append: () => {
      throw new Error('диск недоступен');
    },
    now: () => 0,
  });
  assert.doesNotThrow(() => log('env', 'demo: что-то'));
});

test('fileLogger: append строк в <root>/.pi-env.log', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-env-dbg-'));
  const log = fileLogger(root);
  log('env', 'demo: settings.json — битый JSON');
  log('env', 'demo: settings.json — битый JSON');
  log('scan', 'корень нечитаем');
  const text = readFileSync(logFileFor(root), 'utf8');
  const rows = text.split('\n').filter((r) => r !== '');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].includes('env: demo: settings.json'));
  assert.ok(rows[1].includes('scan: корень нечитаем'));
});

test('fileLogger: нет записей — нет файла; недоступный путь — молча', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-env-dbg-'));
  fileLogger(root);
  assert.equal(existsSync(logFileFor(root)), false);

  const missing = join(root, 'no-such-dir');
  const log = fileLogger(missing);
  assert.doesNotThrow(() => log('env', 'demo: что-то'));
  assert.equal(existsSync(join(missing, '.pi-env.log')), false);
});

test('logFileFor: имя журнала в корне', () => {
  assert.equal(logFileFor('/r'), '/r/.pi-env.log');
});

test('dedupedLog: одна запись на пару (tag, message) за жизнь обёртки', () => {
  const lines: string[] = [];
  const log = dedupedLog((tag, message) => lines.push(`${tag}|${message}`));
  log('env', 'demo: битый JSON');
  log('env', 'demo: битый JSON');
  log('env', 'other: битый JSON');
  log('scan', 'demo: битый JSON');
  assert.deepEqual(lines, ['env|demo: битый JSON', 'env|other: битый JSON', 'scan|demo: битый JSON']);
});
