import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { readMcpServers, readJsonFile, type McpServer } from './mcp.js';
import { npmNameOfSource, pkgIdentity } from './store.js';
import { basename, isAbsolute, join } from 'node:path';

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

  const custom = readJsonFile(join(agentDir, 'models.json'));
  if (custom && typeof custom === 'object') {
    const providers = (custom as { providers?: unknown }).providers;
    if (providers && typeof providers === 'object') {
      for (const [name, value] of Object.entries(providers as Record<string, unknown>)) {
        add(name, (value as { models?: unknown }).models);
      }
    }
  }

  const store = readJsonFile(join(agentDir, 'models-store.json'));
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
  version: string | null;
  description: string | null;
  extensions: string[];
  skills: string[];
  /**
   * Объявление реестра хранилища, у которого файлов пакета нет на диске. Строка с такой
   * пометкой существует только в списке вкладки «Расширения» (`listRegistryPackages`):
   * разобрать пакет нельзя, но скрыть его — значит оставить реестр мусореть невидимо.
   * У таких строк `path` — путь ОТНОСИТЕЛЬНО каталога хранилища (`npm/node_modules/<имя>`):
   * абсолютный путь не влезает в правую колонку кадра, а адрес хранилища один на все строки.
   */
  missing?: boolean;
}

export interface Catalog {
  providers: Provider[];
  tools: ToolItem[];
  packages: PkgItem[];
  skills: SkillItem[];
  mcp: McpServer[];
}

/**
 * Полная каталожная картина main-агента для формы создания окружения.
 */
export function loadCatalog(agentDir: string): Catalog {
  return {
    providers: listProviders(agentDir),
    tools: listCustomTools(agentDir),
    packages: listPackages(agentDir),
    skills: listSkills(agentDir),
    mcp: readMcpServers(agentDir),
  };
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

/** Куда pi кладёт npm-пакеты: `<каталог агента>/npm/node_modules/<имя без версии>`. */
const NPM_ROOT = 'npm';

/** Объявления `settings.json → packages` каталога агента (строки, без разбора путей). */
function packageSourcesOf(agentDir: string): string[] {
  const settings = readJsonFile(join(agentDir, 'settings.json'));
  const pkgs = settings && typeof settings === 'object'
    ? (settings as { packages?: unknown }).packages
    : undefined;
  return Array.isArray(pkgs) ? pkgs.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * Строки вкладки «Расширения»: реестр хранилища ЦЕЛИКОМ.
 *
 * `listPackages` пропускает объявление, у которого нет каталога пакета или манифеста. Такое
 * объявление остаётся в `<store>/settings.json` (сбой `pi install`, ручная чистка дерева,
 * переезд `PI_ENV_STORE`, оборванный `pi remove`) — без строки реестр мусореет невидимо: ни `X`,
 * ни `⚠`, ни счётчика. Правило: у каждого СТРОКОВОГО объявления реестра есть строка, а если
 * файлов нет, строка это говорит (`missing`). Object-записи `settings.packages`, которые умеет
 * pi, pi-env не читает — это отдельная карточка.
 *
 * Границы, чтобы не плодить ложные пометки:
 * - `git:` строк не получает — `resolvePkgPath` для него всегда `null` (pi кладёт пакет в
 *   `<agent>/git/<host>/<путь>`), поэтому «нет файлов» для установленного git-пакета было бы
 *   неправдой;
 * - локальные `path:` тоже — переустановить их нечем (`pi install` требует существующего пути),
 *   строка без действенного предложения только пугает.
 */
export function listRegistryPackages(storeDir: string): PkgItem[] {
  const rows = listPackages(storeDir);
  const seen = new Set(rows.map((p) => pkgIdentity(p.source)));
  for (const source of packageSourcesOf(storeDir)) {
    if (!source.startsWith('npm:')) continue;
    // имя — из объявления: scope является частью имени пакета, версия — не часть пути;
    // вырожденное «npm:» (пустое имя) не разрешается и `resolvePkgPath` — строки не даёт
    const name = npmNameOfSource(source);
    if (name === '') continue;
    const identity = pkgIdentity(source);
    if (seen.has(identity)) continue;
    seen.add(identity);
    rows.push({
      source,
      name,
      // путь относительно хранилища: он и есть ответ на вопрос «куда класть файлы»
      path: join(NPM_ROOT, 'node_modules', name),
      version: null,
      description: null,
      extensions: [],
      skills: [],
      missing: true,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Установленные пакеты (settings.json → packages) с их pi-ресурсами.
 * Неразрешимые источники (git, отсутствующие) пропускаются.
 */
export function listPackages(agentDir: string): PkgItem[] {
  const sources = packageSourcesOf(agentDir);
  const out: PkgItem[] = [];
  for (const source of sources) {
    const path = resolvePkgPath(agentDir, source);
    if (path === null) continue;
    const pkg = readJsonFile(join(path, 'package.json'));
    if (pkg === null || typeof pkg !== 'object') continue;
    const pi = (pkg as { pi?: unknown }).pi;
    const piObj = pi && typeof pi === 'object' ? (pi as Record<string, unknown>) : {};
    out.push({
      source,
      name: typeof (pkg as { name?: unknown }).name === 'string' ? (pkg as { name: string }).name : source,
      path,
      version: typeof (pkg as { version?: unknown }).version === 'string' ? (pkg as { version: string }).version : null,
      description: typeof (pkg as { description?: unknown }).description === 'string' ? (pkg as { description: string }).description : null,
      extensions: strArray(piObj.extensions),
      skills: strArray(piObj.skills),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Разбор вывода `npm outdated --json`: имя пакета → latest-версия.
 * Только устаревшие пакеты попадают в вывод. Мусор/пусто → {}.
 */
export function parseOutdated(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const latest = (value as { latest?: unknown }).latest;
      if (typeof latest === 'string') out[name] = latest;
    }
  }
  return out;
}

/**
 * Интерпретация вывода `npm outdated --json`: успешна ли проверка и
 * карта имени → latest. npm заканчивается кодом 1, когда есть устаревшие
 * пакеты, — поэтому успех определяется по содержимому: JSON-объект без
 * поля `error` (свои ошибки npm пишет в stdout при --json).
 */
export function interpretOutdated(stdout: string): { ok: boolean; latest: Record<string, string> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, latest: {} };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || 'error' in (parsed as Record<string, unknown>)) {
    return { ok: false, latest: {} };
  }
  return { ok: true, latest: parseOutdated(stdout) };
}

/** Пакет из каталога pi.dev/packages. */
export interface CatalogPkg {
  name: string;
  types: string[];
  downloads: number;
  description: string | null;
  author: string | null;
}

/**
 * Поиск по имени пакета: регистронезависимая подстрока.
 * Пустой/только-пробельный запрос — исходный список.
 */
export function filterPackages(pkgs: CatalogPkg[], query: string): CatalogPkg[] {
  const q = query.trim().toLowerCase();
  if (q === '') return pkgs;
  return pkgs.filter((p) => p.name.toLowerCase().includes(q));
}

const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Строка из pi.dev-HTML: control-символы вырезаны, переносы/табы/повторные пробелы — один пробел. */
function cleanText(s: string): string {
  return s.replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
}

/** Пустое после санитизации описание/автор — null: инфо-панель не рисует пустую строку. */
function cleanOrNull(s: string): string | null {
  const clean = cleanText(s);
  return clean === '' ? null : clean;
}

/**
 * Разбор HTML страницы https://pi.dev/packages в список пакетов.
 * ponytail: регулярки под текущую разметку pi.dev; при смене разметки список будет пустым
 */
export function parsePackageCatalog(html: string): CatalogPkg[] {
  const out: CatalogPkg[] = [];
  const cardRe = /<article\b[^>]*data-package-name="([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const tagEnd = cardRe.lastIndex;
    const next = html.indexOf('<article', tagEnd);
    const slice = html.slice(tagEnd, next === -1 ? undefined : next);
    const types = /data-package-types="([^"]*)"/.exec(m[0]);
    const downloads = /data-package-downloads="(\d+)"/.exec(m[0]);
    const desc = /<p class="packages-desc">([^<]*)<\/p>/.exec(slice);
    const meta = /class="packages-meta"><span>([^<]*)<\/span>/.exec(slice);
    const name = cleanText(m[1]);
    if (name === '') continue;
    out.push({
      name,
      types: types ? cleanText(types[1]).split(' ').filter((t) => t !== '') : [],
      downloads: downloads ? Number(downloads[1]) : 0,
      description: desc ? cleanOrNull(decodeEntities(desc[1])) : null,
      author: meta ? cleanOrNull(decodeEntities(meta[1])) : null,
    });
  }
  return out.sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Адрес каталога пакетов pi. */
export const PACKAGE_CATALOG_URL = 'https://pi.dev/packages';

/** Число одновременных загрузок страниц каталога. */
const CATALOG_FETCH_CONCURRENCY = 8;

/**
 * Номер последней страницы из разметки пагинации (максимум /packages?page=N).
 * null — пагинации нет (одна страница) или разметка сменилась.
 */
export function lastCatalogPage(html: string): number | null {
  let max = 0;
  const re = /\/packages\?page=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max > 1 ? max : null;
}

/**
 * Скачивает каталог пакетов: первая страница + все страницы пагинации
 * (параллельно), дедупликация по имени, итоговая сортировка по загрузкам.
 * onProgress(loaded, total) — счётчики страниц; для одиночной страницы не вызывается.
 * Ошибка сети/HTTP — исключение (каталог считается незагруженным).
 */
export async function fetchPackageCatalog(
  url: string = PACKAGE_CATALOG_URL,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CatalogPkg[]> {
  const firstHtml = await fetchPageHtml(url, signal);
  const all = parsePackageCatalog(firstHtml);
  const total = lastCatalogPage(firstHtml);
  if (total === null) return all;

  const base = url.split('?page=')[0];
  const rest: string[] = [];
  for (let n = 2; n <= total; n++) rest.push(base + '?page=' + n);
  let next = 0;
  let loaded = 1;
  onProgress?.(1, total);
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= rest.length) return;
      all.push(...parsePackageCatalog(await fetchPageHtml(rest[i], signal)));
      loaded++;
      onProgress?.(loaded, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CATALOG_FETCH_CONCURRENCY, rest.length) }, worker));

  const seen = new Map<string, CatalogPkg>();
  for (const p of all) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()].sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name));
}

async function fetchPageHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(20_000);
  const res = await fetch(url, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

/**
 * Приводит запись settings.packages к каноническому источнику пакета
 * каталога: сначала совпадение по источнику, затем по имени (legacy),
 * иначе запись остаётся как есть.
 */
export function normalizePkgSource(source: string, packages: PkgItem[]): string {
  const p = packages.find((x) => x.source === source || x.name === source);
  return p !== undefined ? p.source : source;
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
        items.push({ name: basename(base), path: base, pkgShort: short });
      }
    }
  }
  const used = new Set<string>();
  return items
    .map((it) => {
      const base = used.has(it.name) && it.pkgShort !== null ? `${it.pkgShort}/${it.name}` : it.name;
      const name = uniqueName(base, used);
      used.add(name);
      return { name, path: it.path };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Свободное имя среди занятых: base, иначе base-2, base-3… */
export function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}-${n++}`;
  return name;
}

/** Куда pi кладёт npm-пакет: `npm/node_modules/<имя без версии>` (версия объявления — не часть пути). */
function expectedNpmPath(agentDir: string, source: string): string {
  return join(agentDir, NPM_ROOT, 'node_modules', npmNameOfSource(source));
}

function resolvePkgPath(agentDir: string, source: string): string | null {
  if (source.startsWith('npm:')) {
    // имя без версии: pi кладёт пакет в npm/node_modules/<имя>, версия объявления — не часть пути
    const name = npmNameOfSource(source);
    if (name === '') return null;
    const path = expectedNpmPath(agentDir, source);
    return existsSync(path) ? path : null;
  }
  // ponytail: git-источники и прочие схемы не поддерживаются — только локальные пути
  if (/^[a-z]+:/.test(source)) return null;
  const expanded = source.startsWith('~') ? join(osHomedir(), source.slice(1)) : source;
  const path = isAbsolute(expanded) ? expanded : join(agentDir, expanded);
  return existsSync(path) ? path : null;
}

function resolveInPkg(pkgPath: string, entry: string): string | null {
  const expanded = entry.startsWith('~') ? join(osHomedir(), entry.slice(1)) : entry;
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
