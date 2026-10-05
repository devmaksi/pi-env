#!/usr/bin/env node
import { homedir } from 'node:os';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { run, runPassthrough } from './run.js';
import { parsePiEnvArgs } from './cli.js';
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
      t(lang, 'help.passthrough'),
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
  const parsed = parsePiEnvArgs(argv);
  const root = parsed.root ?? process.env.PI_ENV_ROOT ?? join(homedir(), '.pi-env');
  const lang = appLang(root);
  if (parsed.help) {
    printHelp(lang);
    return;
  }
  if (parsed.badUsage !== undefined) {
    process.stderr.write(t(lang, 'cli.badUsage', { p: parsed.badUsage }) + '\n');
    process.exit(2);
  }
  if (parsed.envName !== undefined) {
    const envPath = join(root, parsed.envName);
    if (!statSync(envPath, { throwIfNoEntry: false })?.isDirectory()) {
      process.stderr.write(t(lang, 'run.env.not_found', { p: parsed.envName, r: root }) + '\n');
      process.exit(2);
    }
    runPassthrough(envPath, parsed.passthrough, lang);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(t(lang, 'tty.error') + '\n');
    process.exit(2);
  }
  void run(root);
}

main();
