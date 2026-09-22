import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Environment {
  name: string;
  path: string;
  hasSettings: boolean;
  hasSkills: boolean;
  hasExtensions: boolean;
}

/**
 * Сканирует корневой каталог окружений.
 * Каждая подпапка — окружение; файлы игнорируются.
 * Возвращает null, если корень не существует или нечитаем.
 */
export function scan(root: string): Environment[] | null {
  if (!existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const p = join(root, e.name);
      return {
        name: e.name,
        path: p,
        hasSettings: existsSync(join(p, 'settings.json')),
        hasSkills: existsSync(join(p, 'skills')),
        hasExtensions: existsSync(join(p, 'extensions')),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
