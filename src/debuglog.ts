import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** Имя журнала pi-env в корневом каталоге окружений. */
export const LOG_FILE_NAME = '.pi-env.log';

/** Функция записи проблемы: метка подсистемы + текст. */
export type DebugLogFn = (tag: string, message: string) => void;

/**
 * Журнал отладки включён только `PI_ENV_DEBUG=1` (та же схема, что `PI_ENV_NO_UPDATE_CHECK`).
 * Любое другое значение — выключено: «похожее на правду» («true», «yes») журнал не пишет.
 */
export function debugEnabled(env: { PI_ENV_DEBUG?: string }): boolean {
  return env.PI_ENV_DEBUG === '1';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Строка журнала: `YYYY-MM-DD HH:MM:SS <tag>: <message>` (время местное).
 * Формат не локализован — журнал читают grep'ом.
 */
export function formatLogLine(ts: number, tag: string, message: string): string {
  const d = new Date(ts);
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${stamp} ${tag}: ${message}`;
}

export interface DebugLogDeps {
  enabled: boolean;
  /** Запись одной строки (без перевода строки). */
  append: (line: string) => void;
  now: () => number;
}

/**
 * Дедуп записей: одна строка на пару `(tag, message)` за жизнь обёртки. Нужен,
 * потому что `scan()` вызывается дважды на каждое нажатие клавиши: без дедупа одно
 * битое окружение дало бы тысячи одинаковых строк за сессию.
 */
export function dedupedLog(inner: DebugLogFn): DebugLogFn {
  const seen = new Set<string>();
  return (tag, message) => {
    const key = `${tag}\u0000${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    inner(tag, message);
  };
}

/**
 * Журнал в заданный сток: дедуп + форматирование строки. Сбой самой записи наружу не
 * выходит — журнал только помогает, он не роняет приложение.
 */
export function createDebugLog(deps: DebugLogDeps): DebugLogFn {
  const append: DebugLogFn = (tag, message) => {
    try {
      deps.append(formatLogLine(deps.now(), tag, message));
    } catch {
      /* журнал недоступен — работать от этого не должно стать хуже */
    }
  };
  return deps.enabled ? dedupedLog(append) : () => {};
}

export function logFileFor(root: string): string {
  return join(root, LOG_FILE_NAME);
}

/**
 * append-журнал `<root>/.pi-env.log`: файл появляется первой записью, поэтому запуск
 * с включённым `PI_ENV_DEBUG` и без проблем не создаёт лишних файлов.
 */
export function fileLogger(root: string): DebugLogFn {
  return createDebugLog({
    enabled: true,
    append: (line) => appendFileSync(logFileFor(root), line + '\n'),
    now: Date.now,
  });
}
