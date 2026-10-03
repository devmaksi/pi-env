import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Настройки приложения pi-env (вкладка «Настройки»). */
export interface AppSettings {
  color: boolean;
  recheckUpdates: boolean;
  language: string | null;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { color: true, recheckUpdates: false, language: null };

const FILE_NAME = '.pi-env.json';

/**
 * Читает настройки приложения из <root>/.pi-env.json.
 * Файла нет или JSON бит — дефолты; поле отсутствует — дефолт поля.
 */
export function loadAppSettings(root: string): AppSettings {
  const p = join(root, FILE_NAME);
  if (!existsSync(p)) return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    return {
      color: typeof raw.color === 'boolean' ? raw.color : DEFAULT_APP_SETTINGS.color,
      recheckUpdates: typeof raw.recheckUpdates === 'boolean' ? raw.recheckUpdates : DEFAULT_APP_SETTINGS.recheckUpdates,
      language: typeof raw.language === 'string' && raw.language !== '' ? raw.language : null,
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

/**
 * Записывает настройки приложения в <root>/.pi-env.json.
 * Ошибка записи (например, корень не на диске) не прерывает работу.
 */
export function saveAppSettings(root: string, s: AppSettings): void {
  try {
    writeFileSync(join(root, FILE_NAME), JSON.stringify(s, null, 2) + '\n');
  } catch {
    /* настройки останутся в памяти на сессию */
  }
}
