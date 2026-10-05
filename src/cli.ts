/**
 * Результат разбора argv pi-env.
 * `root`/`envName`/`badUsage` — undefined, когда неприменимы.
 */
export interface ParsedArgs {
  /** Запрошена справка pi-env (только до имени окружения). */
  help: boolean;
  /** Явный корень окружений (`--root` до имени окружения). */
  root?: string;
  /** Имя окружения (первый позиционный аргумент). */
  envName?: string;
  /** Флаг до имени окружения, не принадлежащий pi-env. */
  badUsage?: string;
  /** Всё после имени окружения — передаётся pi дословно. */
  passthrough: string[];
}

/**
 * Разбирает argv: `pi-env [--root <путь>] <окружение> [аргументы pi...]`.
 * Первый позиционный аргумент (не начинающийся с `-`) — имя окружения;
 * всё после него передаётся pi дословно. До имени признаются только
 * `--root <путь>` и `-h/--help`; прочие флаги — ошибка использования.
 * Без позиционных аргументов — TUI-режим (envName не задан).
 */
export function parsePiEnvArgs(argv: string[]): ParsedArgs {
  let root: string | undefined;
  let help = false;
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { help = true; i += 1; continue; }
    if (a === '--root') {
      if (i + 1 >= argv.length) return { help, root, envName: undefined, badUsage: a, passthrough: [] };
      root = argv[i + 1];
      i += 2;
      continue;
    }
    if (a.startsWith('-')) return { help, root, envName: undefined, badUsage: a, passthrough: [] };
    return { help, root, envName: a, badUsage: undefined, passthrough: argv.slice(i + 1) };
  }
  return { help, root, envName: undefined, badUsage: undefined, passthrough: [] };
}
