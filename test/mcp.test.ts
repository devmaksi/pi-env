import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, readMcpServers, writeMcpFile, mcpAddCliArgs, validateMcpForm, copyMcpEntry, removeMcpEntry, parseMcpList, mergeLive, liveMarker, type McpFormFields, type McpLiveStatus, type McpServer } from '../src/mcp.js';
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

test('readJsonFile: запятая внутри строкового значения не вырезается', () => {
  const d = dir();
  writeFileSync(join(d, 'f.json'), '{"a":"hello, }world","b":["x, ]y"]}');
  assert.deepEqual(readJsonFile(join(d, 'f.json')), { a: 'hello, }world', b: ['x, ]y'] });
  rmSync(d, { recursive: true, force: true });
});

test('readJsonFile: экранированные кавычки не сбивают распознавание строк', () => {
  const d = dir();
  writeFileSync(join(d, 'f.json'), '{"a":"текст \\" кавычка, } хвост"}');
  assert.deepEqual(readJsonFile(join(d, 'f.json')), { a: 'текст " кавычка, } хвост' });
  rmSync(d, { recursive: true, force: true });
});

test('readJsonFile: trailing commas чинятся, не трогая строки', () => {
  const d = dir();
  writeFileSync(join(d, 'f.json'), '{\n  "mcpServers": {\n    "fs": {\n      "description": "сервер, } с запятой",\n      "args": ["-y", "x"],\n    },\n  },\n}');
  assert.deepEqual(readJsonFile(join(d, 'f.json')), { mcpServers: { fs: { description: 'сервер, } с запятой', args: ['-y', 'x'] } } });
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

// --- parseMcpList: вывод `pi mcp list --json` ---

test('parseMcpList: полный вывод — серверы и ошибки разбираются', () => {
  const raw = JSON.stringify({
    servers: [
      { name: 'fs', scope: 'global', source: '/a/mcp.json', enabled: true, exposure: 'direct', transport: 'npx -y fs .', state: 'connected', tools: ['read', 'write'], resources: true },
      { name: 'docs', scope: 'project', source: '/p/.pi/mcp.json', enabled: true, exposure: 'codemode', transport: 'https://e/mcp', state: 'needs-auth', tools: [], error: 'fetch failed', override: 'project override', toolExposure: { search: 'deferred' } },
    ],
    errors: ['bad entry: x'],
  });
  const parsed = parseMcpList(raw)!;
  assert.deepEqual(parsed.servers.map((s) => s.name), ['fs', 'docs']);
  const fs = parsed.servers[0];
  assert.equal(fs.scope, 'global');
  assert.equal(fs.source, '/a/mcp.json');
  assert.equal(fs.enabled, true);
  assert.equal(fs.exposure, 'direct');
  assert.equal(fs.transport, 'npx -y fs .');
  assert.equal(fs.state, 'connected');
  assert.deepEqual(fs.tools, ['read', 'write']);
  assert.equal(fs.resources, true);
  assert.equal(fs.error, undefined);
  const docs = parsed.servers[1];
  assert.equal(docs.state, 'needs-auth');
  assert.equal(docs.error, 'fetch failed');
  assert.equal(docs.override, 'project override');
  assert.deepEqual(docs.toolExposure, { search: 'deferred' });
  assert.deepEqual(parsed.errors, ['bad entry: x']);
});

test('parseMcpList: выключенный сервер — state disabled', () => {
  const parsed = parseMcpList(JSON.stringify({
    servers: [{ name: 'off', scope: 'global', source: '/a/mcp.json', enabled: false, exposure: 'codemode', transport: 'cmd', state: 'disabled', tools: [] }],
    errors: [],
  }))!;
  assert.equal(parsed.servers[0].state, 'disabled');
  assert.equal(parsed.servers[0].enabled, false);
});

test('parseMcpList: пустой список — пустые серверы и ошибки', () => {
  const parsed = parseMcpList(JSON.stringify({ servers: [], errors: [] }))!;
  assert.deepEqual(parsed.servers, []);
  assert.deepEqual(parsed.errors, []);
});

test('parseMcpList: битый JSON или отсутствие servers — null', () => {
  assert.equal(parseMcpList(''), null);
  assert.equal(parseMcpList('not a json'), null);
  assert.equal(parseMcpList(JSON.stringify({ errors: [] })), null);
  assert.equal(parseMcpList(JSON.stringify({ servers: 'x' })), null);
});

test('parseMcpList: запись без полей — дефолты, невалидные записи отбрасываются', () => {
  const parsed = parseMcpList(JSON.stringify({
    servers: [{ name: 'x' }, { name: 1, state: 'connected', tools: 'nope' }],
    errors: 'bad',
  }))!;
  assert.equal(parsed.servers.length, 1);
  const s = parsed.servers[0];
  assert.equal(s.name, 'x');
  assert.equal(s.enabled, true);
  assert.equal(s.state, 'unknown');
  assert.equal(s.transport, '');
  assert.equal(s.scope, 'global');
  assert.deepEqual(s.tools, []);
  assert.deepEqual(parsed.errors, []);
});

// --- mergeLive / liveMarker ---

const liveFs: McpLiveStatus = { name: 'fs', scope: 'global', source: '/a/mcp.json', enabled: true, exposure: 'direct', transport: 'npx', state: 'connected', tools: ['read'] };
const liveDocs: McpLiveStatus = { name: 'docs', scope: 'global', source: '/a/mcp.json', enabled: true, exposure: 'codemode', transport: 'https://e/mcp', state: 'failed', tools: [], error: 'fetch failed' };

test('mergeLive: живой статус по имени конфига, без проверки — null', () => {
  const merged = mergeLive([stdioFixture, httpFixture], { servers: [liveFs], errors: [] });
  assert.deepEqual(merged.map((m) => [m.name, m.live?.state ?? null]), [['docs', null], ['fs', 'connected']]);
});

test('mergeLive: живой сервер вне конфига — отдельная запись config: null', () => {
  const merged = mergeLive([stdioFixture], { servers: [liveFs, liveDocs], errors: [] });
  assert.deepEqual(merged.map((m) => m.name), ['docs', 'fs']);
  assert.equal(merged[0].config, null);
  assert.equal(merged[0].live!.state, 'failed');
});

test('mergeLive: union имён сортирован', () => {
  const merged = mergeLive([{ ...stdioFixture, name: 'zz' }], { servers: [{ ...liveFs, name: 'aa' }], errors: [] });
  assert.deepEqual(merged.map((m) => m.name), ['aa', 'zz']);
});

test('liveMarker: connected — галочка и число инструментов', () => {
  assert.match(liveMarker({ ...liveFs, tools: ['a', 'b'] }, 'ru'), /✓ 2/);
  assert.match(liveMarker({ ...liveFs, tools: [] }, 'en'), /✓ 0/);
});

test('liveMarker: needs-auth / failed / disabled', () => {
  assert.match(liveMarker({ ...liveFs, state: 'needs-auth' }, 'ru'), /⚠/);
  assert.match(liveMarker({ ...liveFs, state: 'failed' }, 'ru'), /✗/);
  assert.match(liveMarker({ ...liveFs, state: 'disabled' }, 'ru'), /—/);
});
