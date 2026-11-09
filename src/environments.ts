import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { readJsonFileDetailed, readMcpServersDetailed } from './mcp.js';

export interface EnvDetails {
  hasSettings: boolean;
  model: string | null;
  tools: string[];
  skills: string[];
  packages: string[];
  mcp: string[];
  /** Текст сбоя чтения settings.json (`null`, если файл читается или его нет). */
  settingsError: string | null;
  /** Текст сбоя чтения mcp.json (`null`, если файл читается или его нет). */
  mcpError: string | null;
  /** Имена записей mcp.json, которые не удалось разобрать. */
  mcpSkipped: string[];
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
    // Каталоги с `.` — служебные (корзина `.trash`, настройки `.pi-env.json`):
    // окружение так не назвать (`validateName` допускает только [a-zA-Z0-9_-]).
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => {
      const p = join(root, e.name);
      return { name: e.name, path: p, details: readDetails(p) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Детализация окружения: модель и пакеты из settings.json,
 * инструменты — файлы extensions/, скиллы — подкаталоги skills/.
 * Битые settings.json/mcp.json не молчат: их текст возвращается в settingsError,
 * mcpError и mcpSkipped — оттуда их берут и журнал (`PI_ENV_DEBUG=1`), и маркер `⚠`
 * в списке окружений.
 */
function readDetails(dir: string): EnvDetails {
  const settingsPath = join(dir, 'settings.json');
  const settings = readJsonFileDetailed(settingsPath);
  const hasSettings = existsSync(settingsPath);
  let model: string | null = null;
  let packages: string[] = [];
  if (settings.value !== null && typeof settings.value === 'object' && !Array.isArray(settings.value)) {
    const raw = settings.value as Record<string, unknown>;
    const provider = typeof raw.defaultProvider === 'string' ? raw.defaultProvider : '';
    const m = typeof raw.defaultModel === 'string' ? raw.defaultModel : '';
    model = provider || m ? [provider, m].filter(Boolean).join('/') : null;
    if (Array.isArray(raw.packages)) {
      packages = raw.packages.filter((x): x is string => typeof x === 'string');
    }
  }
  const mcp = readMcpServersDetailed(dir);
  return {
    hasSettings,
    model,
    tools: listEntries(join(dir, 'extensions'), (e) => e.isFile()),
    skills: listEntries(join(dir, 'skills'), (e) => e.isDirectory()),
    packages,
    mcp: mcp.servers.map((s) => s.name),
    settingsError: settings.error,
    mcpError: mcp.fileError,
    mcpSkipped: mcp.skipped,
  };
}

function listEntries(dir: string, is: (e: Dirent) => boolean): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(is).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
