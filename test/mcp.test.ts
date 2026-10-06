import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMcpServers, writeMcpFile, mcpAddCliArgs, validateMcpForm, copyMcpEntry, removeMcpEntry, type McpFormFields, type McpServer } from '../src/mcp.js';
import { t } from '../src/i18n.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-test-'));
}

function writeMcp(d: string, raw: string): void {
  writeFileSync(join(d, 'mcp.json'), raw);
}

const stdioFixture: McpServer = { name: 'fs', type: 'stdio', command: 'npx', args: ['-y', 'server-fs', '.'], env: { A: '1' }, cwd: '/x', exposure: 'direct', description: 'd', headers: {} };
const httpFixture: McpServer = { name: 'docs', type: 'http', args: [], env: {}, url: 'https://e/mcp', headers: { Authorization: 'Bearer X' }, enabled: false };

test('readMcpServers: stdio+http парсятся, сортировка по имени', () => {
  const d = dir();
  writeMcp(d, JSON.stringify({
    mcpServers: {
      fs: { command: 'npx', args: ['-y', 'server-fs', '.'], env: { A: '1' }, cwd: '/x', exposure: 'direct', description: 'd' },
      docs: { url: 'https://e/mcp', headers: { Authorization: 'Bearer X' }, enabled: false },
    },
  }));
  const servers = readMcpServers(d);
  assert.deepEqual(servers.map((s) => s.name), ['docs', 'fs']);
  const fs = servers.find((s) => s.name === 'fs')!;
  assert.equal(fs.type, 'stdio');
  assert.equal(fs.command, 'npx');
  assert.deepEqual(fs.args, ['-y', 'server-fs', '.']);
  assert.deepEqual(fs.env, { A: '1' });
  assert.equal(fs.cwd, '/x');
  assert.equal(fs.exposure, 'direct');
  assert.equal(fs.description, 'd');
  const docs = servers.find((s) => s.name === 'docs')!;
  assert.equal(docs.type, 'http');
  assert.equal(docs.url, 'https://e/mcp');
  assert.deepEqual(docs.headers, { Authorization: 'Bearer X' });
  assert.equal(docs.enabled, false);
  rmSync(d, { recursive: true, force: true });
});

test('readMcpServers: битые записи пропускаются, нет файла/битый JSON — пусто', () => {
  const d = dir();
  assert.deepEqual(readMcpServers(d), []); // нет файла
  writeMcp(d, '{не json');
  assert.deepEqual(readMcpServers(d), []);
  writeMcp(d, JSON.stringify({
    mcpServers: {
      ok: { command: 'cmd' },
      noEntry: { description: 'нет ни command, ни url' },
      notObject: 'строка',
    },
  }));
  const servers = readMcpServers(d);
  assert.deepEqual(servers.map((s) => s.name), ['ok']);
  assert.deepEqual(servers[0].args, []);
  assert.deepEqual(servers[0].env, {});
  rmSync(d, { recursive: true, force: true });
});

test('readMcpServers: trailing commas допускаются', () => {
  const d = dir();
  writeMcp(d, '{\n  "mcpServers": {\n    "fs": {\n      "command": "npx",\n      "args": ["-y", "x"],\n    },\n  },\n}');
  const servers = readMcpServers(d);
  assert.deepEqual(servers.map((s) => s.name), ['fs']);
  rmSync(d, { recursive: true, force: true });
});

test('writeMcpFile: round-trip сохраняет поля', () => {
  const d = dir();
  writeMcpFile(d, [stdioFixture, httpFixture]);
  const servers = readMcpServers(d);
  assert.deepEqual(servers.map((s) => s.name), ['docs', 'fs']);
  const fs = servers.find((s) => s.name === 'fs')!;
  assert.equal(fs.command, 'npx');
  assert.deepEqual(fs.args, ['-y', 'server-fs', '.']);
  assert.deepEqual(fs.env, { A: '1' });
  assert.equal(fs.cwd, '/x');
  assert.equal(fs.exposure, 'direct');
  assert.equal(fs.description, 'd');
  const docs = servers.find((s) => s.name === 'docs')!;
  assert.equal(docs.url, 'https://e/mcp');
  assert.equal(docs.enabled, false);
  rmSync(d, { recursive: true, force: true });
});

const baseForm: McpFormFields = { name: 'fs', type: 'stdio', command: 'npx', args: '-y pkg .', url: '', env: '', cwd: '', description: '', exposure: null };

test('mcpAddCliArgs: stdio с опциями', () => {
  const f: McpFormFields = { ...baseForm, env: 'A=1 B=2', cwd: '/x', exposure: 'direct', description: 'd' };
  assert.deepEqual(mcpAddCliArgs(f), ['mcp', 'add', 'fs', '--env', 'A=1', '--env', 'B=2', '--cwd', '/x', '--exposure', 'direct', '--description', 'd', '--', 'npx', '-y', 'pkg', '.']);
});

test('mcpAddCliArgs: stdio без опций', () => {
  assert.deepEqual(mcpAddCliArgs(baseForm), ['mcp', 'add', 'fs', '--', 'npx', '-y', 'pkg', '.']);
});

test('mcpAddCliArgs: http', () => {
  const f: McpFormFields = { ...baseForm, type: 'http', url: 'https://e/mcp', exposure: 'deferred' };
  assert.deepEqual(mcpAddCliArgs(f), ['mcp', 'add', 'fs', '--exposure', 'deferred', '--url', 'https://e/mcp']);
});

test('validateMcpForm: все ошибки и валидная форма', () => {
  assert.equal(validateMcpForm({ ...baseForm, name: '' }, 'ru'), t('ru', 'err.mcp-name-empty'));
  assert.equal(validateMcpForm({ ...baseForm, name: 'a b' }, 'ru'), t('ru', 'err.mcp-name-invalid'));
  assert.equal(validateMcpForm({ ...baseForm, command: '  ' }, 'ru'), t('ru', 'err.mcp-command'));
  assert.equal(validateMcpForm({ ...baseForm, type: 'http', url: '' }, 'ru'), t('ru', 'err.mcp-url'));
  assert.equal(validateMcpForm({ ...baseForm, env: 'A 1=B' }, 'ru'), t('ru', 'err.mcp-env'));
  assert.equal(validateMcpForm(baseForm, 'ru'), null);
  assert.equal(validateMcpForm({ ...baseForm, type: 'http', url: 'https://e/mcp', env: '' }, 'ru'), null);
});

test('copyMcpEntry: создание файла, замена при совпадении, нет имени — ошибка', () => {
  const main = dir();
  const env = dir();
  writeMcpFile(main, [stdioFixture]);
  // создание
  assert.equal(copyMcpEntry(main, env, 'fs').ok, true);
  assert.deepEqual(readMcpServers(env).map((s) => s.name), ['fs']);
  // замена при совпадении
  writeMcpFile(env, [{ ...stdioFixture, command: 'other' }]);
  assert.equal(copyMcpEntry(main, env, 'fs').ok, true);
  const copied = readMcpServers(env)[0];
  assert.equal(copied.command, 'npx');
  // нет имени в main
  assert.equal(copyMcpEntry(main, env, 'нет').ok, false);
  rmSync(main, { recursive: true, force: true });
  rmSync(env, { recursive: true, force: true });
});

test('removeMcpEntry: удаление, последняя запись — файл удаляется, ошибки', () => {
  const d = dir();
  assert.equal(removeMcpEntry(d, 'fs').ok, false); // нет файла
  writeMcpFile(d, [stdioFixture]);
  assert.equal(removeMcpEntry(d, 'нет').ok, false);
  assert.equal(removeMcpEntry(d, 'fs').ok, true);
  assert.equal(existsSync(join(d, 'mcp.json')), false); // последняя запись — файл удалён
  rmSync(d, { recursive: true, force: true });
});

test('removeMcpEntry: не последняя запись — файл остаётся с остальными', () => {
  const d = dir();
  writeMcpFile(d, [stdioFixture, httpFixture]);
  assert.equal(removeMcpEntry(d, 'fs').ok, true);
  const raw = JSON.parse(readFileSync(join(d, 'mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(raw.mcpServers), ['docs']);
  rmSync(d, { recursive: true, force: true });
});
