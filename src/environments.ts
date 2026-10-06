import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMcpServers } from './mcp.js';

export interface EnvDetails {
  hasSettings: boolean;
  model: string | null;
  tools: string[];
  skills: string[];
  packages: string[];
  mcp: string[];
}

export interface Environment {
  name: string;
  path: string;
  details: EnvDetails;
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
      return { name: e.name, path: p, details: readDetails(p) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Детализация окружения: модель и пакеты из settings.json,
 * инструменты — файлы extensions/, скиллы — подкаталоги skills/.
 * Битый или отсутствующий settings.json — только hasSettings.
 */
function readDetails(dir: string): EnvDetails {
  const settingsPath = join(dir, 'settings.json');
  const hasSettings = existsSync(settingsPath);
  let model: string | null = null;
  let packages: string[] = [];
  if (hasSettings) {
    try {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
      const provider = typeof raw.defaultProvider === 'string' ? raw.defaultProvider : '';
      const m = typeof raw.defaultModel === 'string' ? raw.defaultModel : '';
      model = provider || m ? [provider, m].filter(Boolean).join('/') : null;
      if (Array.isArray(raw.packages)) {
        packages = raw.packages.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      /* битый settings.json — оставляем пустые значения */
    }
  }
  return { hasSettings, model, tools: listFiles(join(dir, 'extensions')), skills: listDirs(join(dir, 'skills')), packages, mcp: readMcpServers(dir).map((s) => s.name) };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
