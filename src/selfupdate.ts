import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Обновление самого pi-env: номер версии и способ установки (чистые функции). */

export const PKG_NAME = '@devmaksi/pi-env';

export type InstallKind = 'npm-global' | 'npx-cache' | 'pi-package' | 'source' | 'unknown';

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

/** X.Y.Z с необязательным pre-release; нечитаемая строка → null. */
export function parseVersion(v: string): Version | null {
  const m = VERSION_RE.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

/** -1 | 0 | 1; pre-release одного и того же номера считается старше релиза. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

const PKG_PATH_MARK = 'node_modules/@devmaksi/pi-env/';

/** Есть ли `.git` выше по пути (рабочий checkout — в том числе мишень `npm link`). */
function hasGitRoot(filePath: string): boolean {
  let dir = dirname(filePath);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Способ установки запущенного экземпляра — по реальному пути модуля.
 * Порядок: pi-пакет, кэш npx, исходники (важнее глобальной npm-установки: `npm link`
 * разрешается в рабочий checkout), затем глобальный npm, иначе неизвестно.
 */
export function classifyInstall(moduleRealPath: string, agentNpmDir: string): InstallKind {
  const path = withTrailingSep(moduleRealPath);
  const inPkg = path.includes(PKG_PATH_MARK);
  if (inPkg && path.startsWith(withTrailingSep(agentNpmDir))) return 'pi-package';
  if (path.includes('/_npx/')) return 'npx-cache';
  if (hasGitRoot(moduleRealPath)) return 'source';
  if (inPkg) return 'npm-global';
  return 'unknown';
}

/** Команды обновления под способ установки (буквальные строки, не переводятся). */
export function updateCommands(kind: InstallKind): string[] {
  if (kind === 'source') return [];
  if (kind === 'pi-package') return [`pi update ${PKG_NAME}`];
  return [`npm i -g ${PKG_NAME}@latest`];
}

function withTrailingSep(p: string): string {
  return p.endsWith('/') ? p : p + '/';
}

export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  sections: ChangelogSection[];
}

const CHANGELOG_BASE = 'https://raw.githubusercontent.com/devmaksi/pi-env/master/';
const CHANGELOG_HEADING_RE = /^## \[([^\]]+)\](?: — (.*))?$/;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** ru-читатель видит русский чейнджлог, остальные — английский канон. */
export function changelogUrl(lang: string): string {
  return CHANGELOG_BASE + (lang === 'ru' ? 'CHANGELOG.ru.md' : 'CHANGELOG.md');
}

function stripControl(s: string): string {
  return s.replace(CONTROL_RE, '');
}

/** Снять Markdown-украшение: **жирное** и `код` остаются тексту, пробелы схлопываются. */
function cleanMarkdown(s: string): string {
  return s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/\s+/g, ' ').trim();
}

/**
 * Блоки `## [X.Y.Z] — дата` с подсекциями `### …` и пунктами `- …`
 * (продолжение пункта — строка с отступом). `[Unreleased]` и нечитаемые версии пропускаются.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: ChangelogSection | null = null;
  for (const rawLine of stripControl(text).split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const heading = CHANGELOG_HEADING_RE.exec(line);
    if (heading) {
      const version = heading[1];
      entry = parseVersion(version) ? { version, date: heading[2] ?? null, sections: [] } : null;
      section = null;
      if (entry) entries.push(entry);
      continue;
    }
    if (entry === null) continue;
    if (line.startsWith('### ')) {
      section = { title: cleanMarkdown(line.slice(4)), items: [] };
      entry.sections.push(section);
      continue;
    }
    if (line.startsWith('- ')) {
      if (section === null) {
        section = { title: '', items: [] };
        entry.sections.push(section);
      }
      section.items.push(cleanMarkdown(line.slice(2)));
      continue;
    }
    if (/^\s{2,}\S/.test(line) && section !== null && section.items.length > 0) {
      section.items[section.items.length - 1] = cleanMarkdown(section.items[section.items.length - 1] + ' ' + line.trim());
      continue;
    }
    section = line.trim() === '' ? section : null;
  }
  return entries;
}

/** Только пропущенные релизы: `installed < v <= latest`, свежие выше. */
export function changelogRange(entries: ChangelogEntry[], installed: string, latest: string): ChangelogEntry[] {
  return entries
    .filter((e) => compareVersions(installed, e.version) < 0 && compareVersions(e.version, latest) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Дописать версии, отсутствующие в основном языке, не заменяя имеющиеся блоки. */
export function mergeChangelog(primary: ChangelogEntry[], secondary: ChangelogEntry[]): ChangelogEntry[] {
  const have = new Set(primary.map((e) => e.version));
  const extra = secondary.filter((e) => !have.has(e.version));
  return [...primary, ...extra].sort((a, b) => compareVersions(b.version, a.version));
}

export type ChangelogRow = { kind: 'version' | 'section' | 'item'; text: string };

/** Строки для рендера: заголовок релиза, заголовки подсекций (если названы), пункты. */
export function changelogRows(entries: ChangelogEntry[]): ChangelogRow[] {
  const rows: ChangelogRow[] = [];
  for (const e of entries) {
    rows.push({ kind: 'version', text: e.date ? `${e.version} — ${e.date}` : e.version });
    for (const s of e.sections) {
      if (s.title !== '') rows.push({ kind: 'section', text: s.title });
      for (const item of s.items) rows.push({ kind: 'item', text: item });
    }
  }
  return rows;
}

/** Устарело ли: установлена строже доступной (нечитаемое — не устарело). */
export function isOutdated(installed: string, latest: string): boolean {
  return compareVersions(installed, latest) < 0;
}
