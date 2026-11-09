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

test('scan: только каталоги, сортировка, пустая детализация', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'b'));
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'a', 'skills'));
    mkdirSync(join(dir, 'a', 'extensions'));
    writeFileSync(join(dir, 'a', 'settings.json'), '{}');
    writeFileSync(join(dir, 'file.txt'), 'x');
    assert.deepEqual(scan(dir), [
      { name: 'a', path: join(dir, 'a'), details: { hasSettings: true, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [] } },
      { name: 'b', path: join(dir, 'b'), details: { hasSettings: false, model: null, tools: [], skills: [], packages: [], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [] } },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: детализация — модель, инструменты, скиллы, пакеты', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev', 'skills', 'sk-a'), { recursive: true });
    mkdirSync(join(dir, 'dev', 'skills', 'sk-b'), { recursive: true });
    mkdirSync(join(dir, 'dev', 'extensions'), { recursive: true });
    writeFileSync(join(dir, 'dev', 'extensions', 'tool1.ts'), 'x');
    writeFileSync(join(dir, 'dev', 'settings.json'),
      JSON.stringify({ defaultProvider: 'p1', defaultModel: 'm1', packages: ['npm:pkg-a'] }));
    assert.deepEqual(scan(dir), [
      {
        name: 'dev',
        path: join(dir, 'dev'),
        details: { hasSettings: true, model: 'p1/m1', tools: ['tool1.ts'], skills: ['sk-a', 'sk-b'], packages: ['npm:pkg-a'], mcp: [], settingsError: null, mcpError: null, mcpSkipped: [] },
      },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битый settings.json — hasSettings true, прочее пусто, settingsError с текстом', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'settings.json'), '{битый json');
    const [env] = scan(dir)!;
    assert.equal(env.details.hasSettings, true);
    assert.equal(env.details.model, null);
    assert.deepEqual(env.details.packages, []);
    assert.ok(typeof env.details.settingsError === 'string' && env.details.settingsError !== '');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: mcp.json окружения — имена в details.mcp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'),
      JSON.stringify({ mcpServers: { browsermcp: { command: 'npx' } } }));
    assert.deepEqual(scan(dir), [
      { name: 'dev', path: join(dir, 'dev'), details: { hasSettings: false, model: null, tools: [], skills: [], packages: [], mcp: ['browsermcp'], settingsError: null, mcpError: null, mcpSkipped: [] } },
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битый mcp.json — mcpError с текстом, список пуст', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'), '{не json');
    const [env] = scan(dir)!;
    assert.deepEqual(env.details.mcp, []);
    assert.deepEqual(env.details.mcpSkipped, []);
    assert.ok(typeof env.details.mcpError === 'string' && env.details.mcpError !== '');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: битая запись mcp.json — имя в mcpSkipped, остальные читаются', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, 'dev'));
    writeFileSync(join(dir, 'dev', 'mcp.json'),
      JSON.stringify({ mcpServers: { browsermcp: { command: 'npx' }, broken: 'строка' } }));
    const [env] = scan(dir)!;
    assert.deepEqual(env.details.mcp, ['browsermcp']);
    assert.deepEqual(env.details.mcpSkipped, ['broken']);
    assert.equal(env.details.mcpError, null);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: .trash не показывается как окружение', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, '.trash', 'e1@1000'), { recursive: true });
    assert.deepEqual(scan(dir), []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('scan: каталоги с точкой в начале пропускаются, обычные — нет', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pienv-'));
  try {
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, '.pi-env.json'), '{}');
    mkdirSync(join(dir, 'ok'));
    assert.deepEqual(scan(dir).map((e) => e.name), ['ok']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
