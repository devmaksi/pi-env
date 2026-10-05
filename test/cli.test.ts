import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePiEnvArgs, type ParsedArgs } from '../src/cli.js';

function expectParsed(argv: string[], help: boolean, envName: string | undefined,
  passthrough: string[], root?: string, badUsage?: string): void {
  const r: ParsedArgs = parsePiEnvArgs(argv);
  assert.deepEqual(
    { help: r.help, root: r.root, envName: r.envName, badUsage: r.badUsage, passthrough: r.passthrough },
    { help, root, envName, badUsage, passthrough },
  );
}

test('без аргументов — TUI-режим', () => {
  expectParsed([], false, undefined, []);
});

test('только имя окружения', () => {
  expectParsed(['myenv'], false, 'myenv', []);
});

test('имя окружения + аргументы pi передаются дословно', () => {
  expectParsed(['myenv', '--mode', 'json', 'Review this repository'], false, 'myenv',
    ['--mode', 'json', 'Review this repository']);
});

test('--root перед именем окружения', () => {
  expectParsed(['--root', '/x', 'myenv'], false, 'myenv', [], '/x');
});

test('--root и флаги после имени окружения', () => {
  expectParsed(['--root', '/x', 'myenv', '--mode', 'json'], false, 'myenv', ['--mode', 'json'], '/x');
});

test('-h до имени окружения — справка pi-env', () => {
  expectParsed(['-h'], true, undefined, []);
});

test('--help после имени окружения уходит в pi', () => {
  expectParsed(['myenv', '--help'], false, 'myenv', ['--help']);
});

test('разделитель -- после имени окружения уходит в pi', () => {
  expectParsed(['myenv', '--', '--mode', 'json'], false, 'myenv', ['--', '--mode', 'json']);
});

test('неизвестный флаг до имени окружения — ошибка использования', () => {
  expectParsed(['--bogus', 'myenv'], false, undefined, [], undefined, '--bogus');
});

test('--root без значения — ошибка использования', () => {
  expectParsed(['--root'], false, undefined, [], undefined, '--root');
});

test('--root берёт следующее значение, даже похожее на флаг', () => {
  expectParsed(['--root', '-x', 'myenv'], false, 'myenv', [], '-x');
});
