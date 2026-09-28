import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';

export interface ModelInfo {
  id: string;
}

export interface Provider {
  name: string;
  models: ModelInfo[];
}

/**
 * Список провайдеров и моделей main-агента.
 * Источники: models.json (кастомные провайдеры, поле "providers")
 * и models-store.json (каталог, ключи — имена провайдеров).
 * Отсутствующие и битые файлы просто пропускаются.
 */
export function listProviders(agentDir: string): Provider[] {
  const merged = new Map<string, Set<string>>();

  const add = (provider: unknown, models: unknown): void => {
    if (typeof provider !== 'string' || !Array.isArray(models)) return;
    const ids = new Set<string>();
    for (const m of models) {
      if (m && typeof m.id === 'string') ids.add(m.id);
    }
    const prev = merged.get(provider) ?? new Set<string>();
    for (const id of ids) prev.add(id);
    merged.set(provider, prev);
  };

  const custom = readJson(join(agentDir, 'models.json'));
  if (custom && typeof custom === 'object') {
    const providers = (custom as { providers?: unknown }).providers;
    if (providers && typeof providers === 'object') {
      for (const [name, value] of Object.entries(providers as Record<string, unknown>)) {
        add(name, (value as { models?: unknown }).models);
      }
    }
  }

  const store = readJson(join(agentDir, 'models-store.json'));
  if (store && typeof store === 'object') {
    for (const [name, value] of Object.entries(store as Record<string, unknown>)) {
      add(name, (value as { models?: unknown }).models);
    }
  }

  return [...merged.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ids]) => ({
      name,
      models: [...ids].sort().map((id) => ({ id })),
    }));
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    // ponytail: файлы каталогов пи допускают trailing commas — срезаем перед парсом
    return JSON.parse(readFileSync(path, 'utf8').replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

export interface ToolItem {
  name: string;
  path: string;
}

export interface SkillItem {
  name: string;
  path: string;
}

export interface PkgItem {
  source: string;
  name: string;
  path: string;
  extensions: string[];
  skills: string[];
}

export interface Catalog {
  providers: Provider[];
  tools: ToolItem[];
  packages: PkgItem[];
  skills: SkillItem[];
}

/**
 * Самодельные инструменты: файлы в extensions/ main-агента.
 * ponytail: только верхний уровень, директории-расширения не разворачиваются
 */
export function listCustomTools(agentDir: string): ToolItem[] {
  const dir = join(agentDir, 'extensions');
  return readDir(dir)
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, path: join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Установленные пакеты (settings.json → packages) с их pi-ресурсами.
 * Неразрешимые источники (git, отсутствующие) пропускаются.
 */
export function listPackages(agentDir: string): PkgItem[] {
  const settings = readJson(join(agentDir, 'settings.json'));
  const sources: string[] =
    settings && Array.isArray((settings as { packages?: unknown }).packages)
      ? ((settings as { packages: string[] }).packages).filter((s) => typeof s === 'string')
      : [];
  const out: PkgItem[] = [];
  for (const source of sources) {
    const path = resolvePkgPath(agentDir, source);
    if (path === null) continue;
    const pkg = readJson(join(path, 'package.json'));
    if (pkg === null || typeof pkg !== 'object') continue;
    const pi = (pkg as { pi?: unknown }).pi;
    const piObj = pi && typeof pi === 'object' ? (pi as Record<string, unknown>) : {};
    out.push({
      source,
      name: typeof (pkg as { name?: unknown }).name === 'string' ? (pkg as { name: string }).name : source,
      path,
      extensions: strArray(piObj.extensions),
      skills: strArray(piObj.skills),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Скиллы: свои (каталог skills/ main-агента) и пакетные (распаковка
 * pi.skills). Имя — каталог скилла; при коллизии — префикс короткого
 * имени пакета.
 */
export function listSkills(agentDir: string): SkillItem[] {
  const items: Array<{ name: string; path: string; pkgShort: string | null }> = [];
  const ownDir = join(agentDir, 'skills');
  for (const e of readDir(ownDir)) {
    items.push({ name: e.name, path: join(ownDir, e.name), pkgShort: null });
  }
  for (const pkg of listPackages(agentDir)) {
    const short = pkg.name.replace(/^@[^/]+\//, '');
    for (const entry of pkg.skills) {
      const base = resolveInPkg(pkg.path, entry);
      if (base === null) continue;
      // ponytail: каталог входов трактуем как папку скиллов, файл — как один скилл
      if (existsSync(base) && statIsDir(base)) {
        for (const e of readDir(base)) items.push({ name: e.name, path: join(base, e.name), pkgShort: short });
      } else if (existsSync(base)) {
        items.push({ name: baseName(base), path: base, pkgShort: short });
      }
    }
  }
  const seen = new Set<string>();
  return items
    .map((it) => {
      let name = it.name;
      if (seen.has(name)) {
        name = it.pkgShort !== null ? `${it.pkgShort}/${name}` : name;
      }
      seen.add(name);
      return { name, path: it.path };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolvePkgPath(agentDir: string, source: string): string | null {
  if (source.startsWith('npm:')) {
    const name = source.slice(4);
    if (name === '') return null;
    const path = join(agentDir, 'npm', 'node_modules', name);
    return existsSync(path) ? path : null;
  }
  // ponytail: git-источники и прочие схемы не поддерживаются — только локальные пути
  if (/^[a-z]+:/.test(source)) return null;
  const expanded = source.startsWith('~') ? join(homeDir(), source.slice(1)) : source;
  const path = isAbsolute(expanded) ? expanded : join(agentDir, expanded);
  return existsSync(path) ? path : null;
}

function resolveInPkg(pkgPath: string, entry: string): string | null {
  const expanded = entry.startsWith('~') ? join(homeDir(), entry.slice(1)) : entry;
  const path = isAbsolute(expanded) ? expanded : join(pkgPath, expanded);
  return existsSync(path) ? path : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function readDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function statIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function baseName(p: string): string {
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(i + 1) : p;
}

function homeDir(): string {
  return process.env.HOME ?? osHomedir();
}
