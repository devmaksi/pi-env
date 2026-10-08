import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SkillItem, ToolItem } from './catalog.js';
import { t } from './i18n.js';
import { writeMcpFile, type McpServer } from './mcp.js';

export interface CreateRequest {
  name: string;
  defaultProvider?: string;
  defaultModel?: string;
  tools?: ToolItem[];
  skills?: SkillItem[];
  packages?: string[];
  mcp?: McpServer[];
}

export type CreateResult = { ok: true; path: string } | { ok: false; error: string };


export interface EnvSettings {
  defaultProvider?: string;
  defaultModel?: string;
  extensions?: string[];
  skills?: string[];
  packages?: string[];
}

/** Читает settings.json окружения. null — файла нет или он бит. */
export function readSettings(envDir: string): EnvSettings | null {
  const p = join(envDir, 'settings.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const arr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const out: EnvSettings = {};
    const dp = str(raw.defaultProvider); if (dp !== undefined) out.defaultProvider = dp;
    const dm = str(raw.defaultModel); if (dm !== undefined) out.defaultModel = dm;
    const ex = arr(raw.extensions); if (ex !== undefined) out.extensions = ex;
    const sk = arr(raw.skills); if (sk !== undefined) out.skills = sk;
    const pk = arr(raw.packages); if (pk !== undefined) out.packages = pk;
    return out;
  } catch {
    return null;
  }
}
/** Проверка имени окружения. Возвращает текст ошибки в языке lang или null. */
export function validateName(name: string, existing: string[], lang: string = 'ru'): string | null {
  if (name.trim() === '') return t(lang, 'err.name-empty');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return t(lang, 'err.name-invalid');
  if (existing.includes(name)) return t(lang, 'err.name-exists');
  return null;
}

/**
 * Создаёт окружение <root>/<name>: settings.json + скопированные
 * инструменты (extensions/), скиллы (skills/), список пакетов и
 * каталог моделей (models.json, models-store.json, auth.json) из main-агента.
 */
export function createEnvironment(root: string, req: CreateRequest, agentDir?: string, lang: string = 'ru'): CreateResult {
  const invalid = validateName(req.name, [], lang);
  if (invalid !== null) {
    return { ok: false, error: invalid };
  }
  const envDir = join(root, req.name);
  if (existsSync(envDir)) {
    return { ok: false, error: t(lang, 'err.name-exists') };
  }
  try {
    mkdirSync(envDir, { recursive: true });
  } catch {
    return { ok: false, error: t(lang, 'err.dir-create', { dir: envDir }) };
  }
  if (agentDir !== undefined) copyModelFiles(agentDir, envDir);

  const settings: Record<string, unknown> = {};
  if (req.defaultProvider && req.defaultModel) {
    settings.defaultProvider = req.defaultProvider;
    settings.defaultModel = req.defaultModel;
  }

  const extNames: string[] = [];
  for (const tool of req.tools ?? []) {
    const base = basename(tool.path);
    mkdirSync(join(envDir, 'extensions'), { recursive: true });
    copyFileSync(tool.path, join(envDir, 'extensions', base));
    extNames.push(`extensions/${base}`);
  }
  if (extNames.length > 0) settings.extensions = extNames;

  const usedSkillNames = new Set<string>();
  const skillNames: string[] = [];
  for (const skill of req.skills ?? []) {
    const dirName = uniqueName(basename(skill.path), usedSkillNames);
    usedSkillNames.add(dirName);
    mkdirSync(join(envDir, 'skills'), { recursive: true });
    copyRecursive(skill.path, join(envDir, 'skills', dirName));
    skillNames.push(`skills/${dirName}`);
  }
  if (skillNames.length > 0) settings.skills = skillNames;

  const packages = uniqueStrings(req.packages ?? []);
  if (packages.length > 0) settings.packages = packages;

  const mcp = req.mcp ?? [];
  if (mcp.length > 0) writeMcpFile(envDir, mcp);
  writeFileSync(join(envDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, path: envDir };
}

/** Контекст обновления: полный каталог main-агента. */
export interface UpdateContext {
  allTools: ToolItem[];
  allSkills: SkillItem[];
  agentDir?: string;
}

/**
 * Обновляет окружение <root>/<oldName>: переименовывает при смене имени,
 * синхронизирует extensions/ и skills/ по полному каталогу main-агента
 * (выбранное копируется, невыбранное среди пунктов каталога удаляется,
 * чужие файлы и каталоги не трогаются), синхронизирует каталог моделей
 * (models.json, models-store.json, auth.json), переписывает settings.json.
 */
export function updateEnvironment(
  root: string,
  oldName: string,
  req: CreateRequest,
  ctx: UpdateContext,
  lang: string = 'ru',
): CreateResult {
  const invalid = validateName(req.name, [], lang);
  if (invalid !== null) return { ok: false, error: invalid };
  const oldDir = join(root, oldName);
  if (!existsSync(oldDir)) return { ok: false, error: t(lang, 'err.not-found') };
  let envDir = oldDir;
  if (req.name !== oldName) {
    const newDir = join(root, req.name);
    if (existsSync(newDir)) return { ok: false, error: t(lang, 'err.name-exists') };
    try {
      renameSync(oldDir, newDir);
    } catch {
      return { ok: false, error: t(lang, 'err.rename', { name: req.name }) };
    }
    envDir = newDir;
  }
  if (ctx.agentDir !== undefined) copyModelFiles(ctx.agentDir, envDir);

  const selectedTools = new Set((req.tools ?? []).map((t) => basename(t.path)));
  for (const t of ctx.allTools) {
    const file = join(envDir, 'extensions', t.name);
    if (selectedTools.has(t.name) && !existsSync(file)) {
      mkdirSync(join(envDir, 'extensions'), { recursive: true });
      copyFileSync(t.path, file);
    } else if (!selectedTools.has(t.name) && existsSync(file)) {
      unlinkSync(file);
    }
  }

  const selectedSkills = new Set((req.skills ?? []).map((s) => basename(s.path)));
  for (const s of ctx.allSkills) {
    const dir = join(envDir, 'skills', s.name);
    if (selectedSkills.has(s.name) && !existsSync(dir)) {
      copyRecursive(s.path, dir);
    } else if (!selectedSkills.has(s.name) && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const settings: Record<string, unknown> = {};
  if (req.defaultProvider && req.defaultModel) {
    settings.defaultProvider = req.defaultProvider;
    settings.defaultModel = req.defaultModel;
  }
  const extDir = join(envDir, 'extensions');
  const extFiles = existsSync(extDir)
    ? readdirSync(extDir).filter((f) => statSync(join(extDir, f)).isFile())
    : [];
  if (extFiles.length > 0) settings.extensions = extFiles.sort().map((f) => `extensions/${f}`);
  const skillDir = join(envDir, 'skills');
  const skillDirs = existsSync(skillDir)
    ? readdirSync(skillDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  if (skillDirs.length > 0) settings.skills = skillDirs.sort().map((d) => `skills/${d}`);
  const packages = uniqueStrings(req.packages ?? []);
  if (packages.length > 0) settings.packages = packages;
  writeFileSync(join(envDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, path: envDir };
}

/** Удаляет каталог окружения <root>/<name> вместе с содержимым. */
export function deleteEnvironment(root: string, name: string, lang: string = 'ru'): CreateResult {
  const envDir = join(root, name);
  if (!existsSync(envDir)) return { ok: false, error: t(lang, 'err.not-found') };
  try {
    rmSync(envDir, { recursive: true, force: true });
  } catch {
    return { ok: false, error: t(lang, 'err.delete', { name }) };
  }
  return { ok: true, path: envDir };
}

function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}-${n++}`;
  return name;
}

function uniqueStrings(list: string[]): string[] {
  return [...new Set(list)];
}

function copyRecursive(src: string, dest: string): void {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

/** Копирует каталог моделей (models.json, models-store.json, auth.json) main-агента в окружение. */
function copyModelFiles(agentDir: string, envDir: string): void {
  for (const name of ['models.json', 'models-store.json', 'auth.json']) {
    const src = join(agentDir, name);
    if (existsSync(src)) copyFileSync(src, join(envDir, name));
  }
}
