#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';

function printHelp(): void {
  process.stdout.write(
    [
      'pi-env — CLI для управления окружениями pi',
      '',
      'Использование: pi-env [--root <путь>]',
      '',
      'Флаги:',
      '  --root <путь>   корневой каталог окружений (по умолчанию ~/.pi-env)',
      '  -h, --help      эта справка',
      '',
    ].join('\n'),
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    return;
  }
  let root: string | undefined;
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1] !== undefined) root = argv[i + 1];
  if (root === undefined) root = process.env.PI_ENV_ROOT ?? join(homedir(), '.pi-env');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('pi-env требует интерактивный терминал (TTY)\n');
    process.exit(2);
  }
  void run(root);
}

main();
