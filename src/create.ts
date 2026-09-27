import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillItem, ToolItem } from './catalog.js';

export interface CreateRequest {
  name: string;
  defaultProvider?: string;
  defaultModel?: string;
  tools?: ToolItem[];
  skills?: SkillItem[];
  packages?: string[];
}

export type CreateResult = { ok: true; path: string } | { ok: false; error: string };

/** Проверка имени окружения. Возвращает текст ошибки (русский) или null. */
export function validateName(name: string, existing: string[]): string | null {
  if (name.trim() === '') return 'Введите имя окружения';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Имя: только латинские буквы, цифры, «_» и «-»';
  if (existing.includes(name)) return 'Окружение с таким именем уже есть';
  return null;
}

/**
 * Создаёт окружение <root>/<name>: settings.json + скопированные
 * инструменты (extensions/), скиллы (skills/) и список пакетов.
 */
export function createEnvironment(root: string, req: CreateRequest): CreateResult {
  const invalid = validateName(req.name, []);
  if (invalid !== null) {
    return { ok: false, error: invalid };
  }
  const envDir = join(root, req.name);
  if (existsSync(envDir)) {
    return { ok: false, error: 'Окружение с таким именем уже есть' };
  }
  try {
    mkdirSync(envDir, { recursive: true });
  } catch {
    return { ok: false, error: `Не удалось создать каталог ${envDir}` };
  }

  const settings: Record<string, unknown> = {};
  if (req.defaultProvider && req.defaultModel) {
    settings.defaultProvider = req.defaultProvider;
    settings.defaultModel = req.defaultModel;
  }

  const extNames: string[] = [];
  for (const tool of req.tools ?? []) {
    const base = baseName(tool.path);
    mkdirSync(join(envDir, 'extensions'), { recursive: true });
    copyFileSync(tool.path, join(envDir, 'extensions', base));
    extNames.push(`extensions/${base}`);
  }
  if (extNames.length > 0) settings.extensions = extNames;

  const usedSkillNames = new Set<string>();
  const skillNames: string[] = [];
  for (const skill of req.skills ?? []) {
    const dirName = uniqueName(baseName(skill.path), usedSkillNames);
    usedSkillNames.add(dirName);
    mkdirSync(join(envDir, 'skills'), { recursive: true });
    copyRecursive(skill.path, join(envDir, 'skills', dirName));
    skillNames.push(`skills/${dirName}`);
  }
  if (skillNames.length > 0) settings.skills = skillNames;

  const packages = uniqueStrings(req.packages ?? []);
  if (packages.length > 0) settings.packages = packages;

  writeFileSync(join(envDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, path: envDir };
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
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
    mkdirSync(parentDir(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '.';
}
