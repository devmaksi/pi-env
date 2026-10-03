#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './run.js';
import { loadAppSettings } from './appsettings.js';
import { t, defaultLang, localeCodes } from './i18n.js';

/** Язык для до-TUI выводов: явное значение из .pi-env.json, иначе системный дефолт. */
function appLang(root: string): string {
  return loadAppSettings(root).language ?? defaultLang(localeCodes());
}

function printHelp(lang: string): void {
  process.stdout.write(
    [
      t(lang, 'help.title'),
      '',
      t(lang, 'help.usage'),
      '',
      t(lang, 'help.flags'),
      t(lang, 'help.root'),
      t(lang, 'help.help'),
      '',
    ].join('\n'),
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  let root: string | undefined;
  const i = argv.indexOf('--root');
  if (i !== -1 && argv[i + 1] !== undefined) root = argv[i + 1];
  if (root === undefined) root = process.env.PI_ENV_ROOT ?? join(homedir(), '.pi-env');
  const lang = appLang(root);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp(lang);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(t(lang, 'tty.error') + '\n');
    process.exit(2);
  }
  void run(root);
}

main();
