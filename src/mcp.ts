import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from './i18n.js';

export type McpType = 'stdio' | 'http';

/** Запись mcpServers из mcp.json (нормализованная). */
export interface McpServer {
  name: string;
  type: McpType;
  command?: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  headers: Record<string, string>;
  description?: string;
  exposure?: string;
  enabled?: boolean;
}

/** Поля формы добавления (данные, без UI-состояния). */
export interface McpFormFields {
  name: string;
  type: McpType;
  command: string;
  args: string;
  url: string;
  env: string;
  cwd: string;
  description: string;
  exposure: string | null;
}

/**
 * Читает mcpServers из <dir>/mcp.json.
 * Нет файла, битый JSON или битая запись — пропускаются без исключений.
 * ponytail: trailing commas допускаются (особенность файлов pi, как в catalog.ts).
 */
export function readMcpServers(dir: string): McpServer[] {
  const p = join(dir, 'mcp.json');
  if (!existsSync(p)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8').replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return [];
  }
  const obj = raw as { mcpServers?: unknown };
  if (obj.mcpServers === null || typeof obj.mcpServers !== 'object' || Array.isArray(obj.mcpServers)) return [];
  const out: McpServer[] = [];
  for (const [name, value] of Object.entries(obj.mcpServers as Record<string, unknown>)) {
    const server = parseMcpEntry(name, value);
    if (server !== null) out.push(server);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Запись как объект mcp.json, иначе null (битая запись). */
function parseMcpEntry(name: string, value: unknown): McpServer | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  const command = typeof e.command === 'string' ? e.command : undefined;
  const url = typeof e.url === 'string' ? e.url : undefined;
  if (command === undefined && url === undefined) return null;
  const strMap = (key: string): Record<string, string> => {
    const v = e[key];
    const out: Record<string, string> = {};
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === 'string') out[k] = val;
      }
    }
    return out;
  };
  return {
    name,
    type: url !== undefined ? 'http' : 'stdio',
    command,
    args: Array.isArray(e.args) ? (e.args as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    env: strMap('env'),
    cwd: typeof e.cwd === 'string' ? e.cwd : undefined,
    url,
    headers: strMap('headers'),
    description: typeof e.description === 'string' ? e.description : undefined,
    exposure: typeof e.exposure === 'string' ? e.exposure : undefined,
    enabled: typeof e.enabled === 'boolean' ? e.enabled : undefined,
  };
}

/** Пишет mcpServers из списка в <dir>/mcp.json (каталог создаётся при отсутствии). */
export function writeMcpFile(dir: string, servers: McpServer[]): void {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const s of [...servers].sort((a, b) => a.name.localeCompare(b.name))) {
    const e: Record<string, unknown> = {};
    if (s.type === 'stdio') {
      if (s.command !== undefined) e.command = s.command;
      if (s.args.length > 0) e.args = s.args;
    } else if (s.url !== undefined) {
      e.url = s.url;
    }
    if (Object.keys(s.env).length > 0) e.env = s.env;
    if (s.cwd !== undefined) e.cwd = s.cwd;
    if (Object.keys(s.headers).length > 0) e.headers = s.headers;
    if (s.description !== undefined) e.description = s.description;
    if (s.exposure !== undefined) e.exposure = s.exposure;
    if (s.enabled !== undefined) e.enabled = s.enabled;
    mcpServers[s.name] = e;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2) + '\n');
}

/** Токены строки формы: split по пробельным, без пустых. */
export function parseEnvTokens(s: string): string[] {
  return s.split(/\s+/).filter((x) => x !== '');
}

/**
 * Аргументы `pi mcp add` из полей формы.
 * stdio: опции env/cwd/exposure/description, затем `-- <command> [args]`;
 * http: exposure/description, затем `--url <url>`.
 */
export function mcpAddCliArgs(f: McpFormFields): string[] {
  const args: string[] = ['mcp', 'add', f.name];
  if (f.type === 'http') {
    if (f.exposure !== null) args.push('--exposure', f.exposure);
    if (f.description.trim() !== '') args.push('--description', f.description.trim());
    args.push('--url', f.url.trim());
    return args;
  }
  for (const token of parseEnvTokens(f.env)) args.push('--env', token);
  if (f.cwd.trim() !== '') args.push('--cwd', f.cwd.trim());
  if (f.exposure !== null) args.push('--exposure', f.exposure);
  if (f.description.trim() !== '') args.push('--description', f.description.trim());
  args.push('--', f.command.trim(), ...f.args.trim().split(/\s+/).filter((x) => x !== ''));
  return args;
}

/** Валидация формы. Возвращает текст ошибки (в языке lang) или null. */
export function validateMcpForm(f: McpFormFields, lang: string): string | null {
  if (f.name.trim() === '') return t(lang, 'err.mcp-name-empty');
  if (!/^[a-zA-Z0-9_-]+$/.test(f.name)) return t(lang, 'err.mcp-name-invalid');
  if (f.type === 'stdio' && f.command.trim() === '') return t(lang, 'err.mcp-command');
  if (f.type === 'http' && f.url.trim() === '') return t(lang, 'err.mcp-url');
  for (const token of parseEnvTokens(f.env)) {
    if (!token.includes('=')) return t(lang, 'err.mcp-env');
  }
  return null;
}

/**
 * Копирует запись из mcp.json main-агента в mcp.json окружения
 * (файл создаётся при отсутствии; существующая запись под замену).
 */
export function copyMcpEntry(mainDir: string, envDir: string, name: string): { ok: boolean; error?: string } {
  const entry = readMcpServers(mainDir).find((s) => s.name === name);
  if (entry === undefined) return { ok: false, error: 'not found: ' + name };
  const existing = readMcpServers(envDir).filter((s) => s.name !== name);
  writeMcpFile(envDir, [...existing, entry]);
  return { ok: true };
}

/**
 * Удаляет запись из mcp.json каталога dir.
 * Если запись была последней — файл mcp.json удаляется.
 */
export function removeMcpEntry(dir: string, name: string): { ok: boolean; error?: string } {
  const p = join(dir, 'mcp.json');
  if (!existsSync(p)) return { ok: false, error: 'no mcp.json in ' + dir };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, 'utf8').replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return { ok: false, error: 'bad json in ' + p };
  }
  const obj = raw as { mcpServers?: unknown };
  if (obj.mcpServers === null || typeof obj.mcpServers !== 'object' || Array.isArray(obj.mcpServers)) {
    return { ok: false, error: 'no mcpServers in ' + p };
  }
  const servers = obj.mcpServers as Record<string, unknown>;
  if (!(name in servers)) return { ok: false, error: 'not found: ' + name };
  delete servers[name];
  if (Object.keys(servers).length === 0) {
    unlinkSync(p);
  } else {
    writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  }
  return { ok: true };
}
