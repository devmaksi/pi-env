import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { uniqueName, type SkillItem, type ToolItem } from './catalog.js';
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
    const dirName = uniqueName(envSkillDirName(skill), usedSkillNames);
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

/** Что разрешено менять при правке каталога окружения. */
export interface EditOptions {
  /** Переименовывать каталог при смене имени (у основного агента — нет). */
  rename: boolean;
  /** Синхронизировать `extensions/` и `skills/` по каталогу main-агента. */
  syncResources: boolean;
  /** Откуда брать каталог моделей (`models.json`, `models-store.json`, `auth.json`). */
  modelSource?: string;
}

/**
 * Точечная правка `settings.json`: меняются только переданные ключи, остальные
 * (в том числе незнакомые приложению — `theme`, `enableSkillCommands`, свои пути
 * `skills`/`extensions`) сохраняются как есть.
 */
export function patchSettings(envDir: string, patch: Record<string, unknown>, unset: string[] = []): void {
  const p = join(envDir, 'settings.json');
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch { /* отсутствует или битый — правка начинает с чистого, не падая */ }
  for (const key of unset) delete raw[key];
  Object.assign(raw, patch);
  writeFileSync(p, JSON.stringify(raw, null, 2) + '\n');
}

/**
 * Обновляет каталог окружения по пути `sourceDir` (вне `<root>` — тоже, например
 * каталог main-агента): переименовывает при `rename`, синхронизирует при
 * `syncResources` extensions/ и skills/ по полному каталогу main-агента (выбранное
 * копируется, невыбранное среди пунктов каталога удаляется, чужие файлы не трогаются),
 * копирует каталог моделей из `modelSource`, точечно правит settings.json.
 */
export function updateEnvironmentAt(
  sourceDir: string,
  req: CreateRequest,
  ctx: UpdateContext,
  opts: EditOptions,
  lang: string = 'ru',
): CreateResult {
  if (opts.rename) {
    const invalid = validateName(req.name, [], lang);
    if (invalid !== null) return { ok: false, error: invalid };
  }
  if (!existsSync(sourceDir)) return { ok: false, error: t(lang, 'err.not-found') };
  let envDir = sourceDir;
  if (opts.rename && req.name !== basename(sourceDir)) {
    const newDir = join(dirname(sourceDir), req.name);
    if (existsSync(newDir)) return { ok: false, error: t(lang, 'err.name-exists') };
    try {
      renameSync(sourceDir, newDir);
    } catch {
      return { ok: false, error: t(lang, 'err.rename', { name: req.name }) };
    }
    envDir = newDir;
  }
  if (opts.modelSource !== undefined) copyModelFiles(opts.modelSource, envDir);

  if (opts.syncResources) {
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

    const selectedSkills = new Set((req.skills ?? []).map(envSkillDirName));
    for (const s of ctx.allSkills) {
      const dirName = envSkillDirName(s);
      const dir = join(envDir, 'skills', dirName);
      if (selectedSkills.has(dirName) && !existsSync(dir)) {
        copyRecursive(s.path, dir);
      } else if (!selectedSkills.has(dirName) && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  const patch: Record<string, unknown> = {};
  const unset: string[] = [];
  if (req.defaultProvider && req.defaultModel) {
    patch.defaultProvider = req.defaultProvider;
    patch.defaultModel = req.defaultModel;
  } else {
    unset.push('defaultProvider', 'defaultModel');
  }
  if (opts.syncResources) {
    const extDir = join(envDir, 'extensions');
    const extFiles = existsSync(extDir)
      ? readdirSync(extDir).filter((f) => statSync(join(extDir, f)).isFile())
      : [];
    if (extFiles.length > 0) patch.extensions = extFiles.sort().map((f) => `extensions/${f}`);
    else unset.push('extensions');
    const skillDir = join(envDir, 'skills');
    const skillDirs = existsSync(skillDir)
      ? readdirSync(skillDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [];
    if (skillDirs.length > 0) patch.skills = skillDirs.sort().map((d) => `skills/${d}`);
    else unset.push('skills');
  }
  const packages = uniqueStrings(req.packages ?? []);
  if (packages.length > 0) patch.packages = packages;
  else unset.push('packages');
  patchSettings(envDir, patch, unset);
  return { ok: true, path: envDir };
}

/**
 * Обновляет окружение `<root>/<oldName>` — обёртка над `updateEnvironmentAt`
 * с прежними разрешениями: переименование, синхронизация ресурсов, модели из main-агента.
 */
export function updateEnvironment(
  root: string,
  oldName: string,
  req: CreateRequest,
  ctx: UpdateContext,
  lang: string = 'ru',
): CreateResult {
  return updateEnvironmentAt(
    join(root, oldName),
    req,
    ctx,
    { rename: true, syncResources: true, modelSource: ctx.agentDir },
    lang,
  );
}

/**
 * Клонирует каталог окружения `srcPath` (вне `<root>` — тоже) в `<root>/<newName>`: дерево
 * как есть (settings.json, mcp.json, extensions/, skills/, каталог моделей и любые свои
 * файлы), ничего не пересобирая из каталога main-агента. Сбой копирования — неполная
 * копия удаляется, ошибка в тексте.
 */
export function cloneEnvironment(
  root: string,
  srcPath: string,
  newName: string,
  existing: string[],
  lang: string = 'ru',
): CreateResult {
  const invalid = validateName(newName, existing, lang);
  if (invalid !== null) return { ok: false, error: invalid };
  const src = srcPath;
  if (!existsSync(src)) return { ok: false, error: t(lang, 'err.not-found') };
  const dst = join(root, newName);
  if (existsSync(dst)) return { ok: false, error: t(lang, 'err.name-exists') };
  try {
    mkdirSync(dst);
    copyRecursive(src, dst);
  } catch {
    rmSync(dst, { recursive: true, force: true });
    return { ok: false, error: t(lang, 'err.clone', { name: newName }) };
  }
  return { ok: true, path: dst };
}

/** Имя каталога скилла в окружении: имя из каталога main-агента, слэш → дефис. */
// ponytail: не инъективно (own-скилл `pkg-x-dup` и пакетный `pkg-x/dup` дают один каталог) —
// кейс редкий; симптом хуже, чем кажется: create сдвигает имена через uniqueName, update маппит
// сыро — снятие одного скилла удаляет каталог с контентом другого отмеченного. Апгрейд:
// uniqueName по всему списку скиллов и в create, и в update.
export function envSkillDirName(skill: SkillItem): string {
  return skill.name.replace(/\//g, '-');
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
