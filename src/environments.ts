import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { readJsonFileDetailed, readMcpServersDetailed } from './mcp.js';
import {
  modelsLinkState, pkgIdentity, rootLinkState, storeModelsFile, storeRegistrySources,
  STORE_ROOTS, type ModelsLink, type StoreRoot,
} from './store.js';

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
  /** Как окружение получает каталог моделей (файл хранилища — симлинк, свой файл — `off`). */

  modelsLink: ModelsLink;
  /** Связь каждого пакетного корня окружения с хранилищем. */
  rootLinks: Record<StoreRoot, ModelsLink>;
  /** Объявления окружения, которых нет в реестре хранилища (только при связанном `npm`). */
  missingPackages: string[];
  mcpSkipped: string[];
}

export interface Environment {
  name: string;
  path: string;
  /** `true` — основной агент (вне `<root>` — синтетическая запись, внутри — помеченная папка). */
  main?: boolean;
  details: EnvDetails;
}

/**
 * Сканирует корневой каталог окружений.
 * Каждая подпапка — окружение; файлы игнорируются.
 * Возвращает null, если корень не существует или нечитаем.
 */
export function scan(root: string, storeDir: string | null = null): Environment[] | null {
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
      return { name: e.name, path: p, details: readDetails(p, storeDir) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Основная запись окружений: каталог main-агента (`PI_CODING_AGENT_DIR ?? ~/.pi/agent`).
 * Внутри `<root>` — помечаем существующую строку (дубля нет), вне — синтетическая первая
 * строка. `name` — имя каталога: данные локали не знают, ярлык даёт рендер.
 */
export function withMain(envs: Environment[], agentDir: string, storeDir: string | null = null): Environment[] {
  const dir = resolve(agentDir);
  const existing = envs.find((e) => e.path === dir);
  if (existing !== undefined) return envs.map((e) => (e === existing ? { ...e, main: true } : e));
  return [{ name: basename(dir), path: dir, main: true, details: readDetails(dir, storeDir) }, ...envs];
}

/** Имена обычных окружений: основная запись не участвует в проверке уникальности имён. */
export function realEnvNames(envs: Environment[]): string[] {
  return envs.filter((e) => e.main !== true).map((e) => e.name);
}

/**
 * Детализация окружения: модель и пакеты из settings.json,
 * инструменты — файлы extensions/, скиллы — подкаталоги skills/.
 * `storeFile` — общий файл каталога моделей: по нему считается `modelsLink`.
 * Битые settings.json/mcp.json не молчат: их текст возвращается в settingsError,
 * mcpError и mcpSkipped — оттуда их берут и журнал (`PI_ENV_DEBUG=1`), и маркер `⚠`
 * в списке окружений.
 */
export function readDetails(dir: string, storeDir: string | null = null): EnvDetails {
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
    modelsLink: storeDir === null ? 'off' : modelsLinkState(dir, storeModelsFile(storeDir)),
    rootLinks: readRootLinks(dir, storeDir),
    missingPackages: readMissingPackages(dir, storeDir, packages),
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
/** Связь пакетных корней окружения с хранилищем (без хранилища — все `off`). */
function readRootLinks(dir: string, storeDir: string | null): Record<StoreRoot, ModelsLink> {
  const out = {} as Record<StoreRoot, ModelsLink>;
  for (const root of STORE_ROOTS) out[root] = storeDir === null ? 'off' : rootLinkState(dir, storeDir, root);
  return out;
}

/** Объявления окружения, которых нет в реестре хранилища — по идентичности пакета, а не по строке объявления. */
function readMissingPackages(dir: string, storeDir: string | null, packages: string[]): string[] {
  if (storeDir === null || packages.length === 0) return [];
  if (rootLinkState(dir, storeDir, 'npm') !== 'linked') return [];
  const registered = new Set(storeRegistrySources(storeDir).map(pkgIdentity));
  return packages.map(pkgIdentity).filter((identity) => !registered.has(identity));
}

/**
 * Идентичность пакета из объявления (`npm:@scope/name@1.2.3` → `npm:@scope/name`,
 * `git:host/org/name@ref` → `git:host/org/name`, путь → `path:<запись>`). pi
 * различает установленные пакеты по ней же (`getPackageIdentity`), поэтому scope —
 * часть имени: `npm:pi-open-tui` и `npm:@wangjq4214/pi-open-tui` — разные пакеты.
 */
export { pkgIdentity };

/** Имена окружений, объявивших этот пакет (по всем окружениям). */
export function storePackageUsage(envs: Environment[], pkgSource: string): string[] {
  // Аргумент — строка объявления (запись реестра `PkgItem.source` или запись
  // `settings.packages`): сравнение по идентичности, а не по имени из package.json.
  const identity = pkgIdentity(pkgSource);
  return envs
    .filter((e) => e.details.packages.some((src) => pkgIdentity(src) === identity))
    .map((e) => e.name)
    .sort();
}

/**
 * Пакеты реестра хранилища, которые не объявил ни один агент (`<store>/settings.json`
 * помнит их, а `settings.packages` — нет): такие пакеты остаются в `<store>/npm`
 * и зря обновляются «Обновить все». Ключ сравнения — идентичность объявления, поэтому
 * запись реестра `npm:@scope/name@1.2` и объявление `npm:@scope/name` — один пакет.
 */
export function storeOrphanNames(envs: Environment[], pkgSources: string[]): string[] {
  return pkgSources.filter((s) => storePackageUsage(envs, s).length === 0).sort((a, b) => a.localeCompare(b));
}

/**
 * Разрыв реестра хранилища: пакет объявлен окружениями (все — одним и тем же объявлением),
 * но такого объявления нет в реестре `<store>/settings.json`: реестр стоит на другом
 * источнике той же идентичности или на этом пакете вообще. Это остаток пропавшего или
 * отменённого шага `pi install`/`pi remove` в хранилище, в том числе после разрешения
 * конфликта, когда объявления уже переписаны и `packageConflicts` пуст.
 */
export interface RegistryGap {
  /** Идентичность пакета (`pkgIdentity`). */
  identity: string;
  /** Объявление окружений — к нему и надо привести хранилище. */
  declared: string;
  /** Объявления реестра той же идентичности; пусто — в реестре этого пакета нет. */
  registered: string[];
}

/**
 * Разрывы реестра по всем окружениям. Разные объявления одного пакета пропускаются:
 * их описывает `packageConflicts`, и лечить их должен выбор победителя, а не этот вход.
 */
export function storeRegistryGaps(envs: Environment[], registry: string[]): RegistryGap[] {
  const byIdentity = new Map<string, Set<string>>();
  for (const env of envs) {
    // Только окружения, чьи пакетные корни смотрят в хранилище: объявление окружения,
    // живущего своими `npm/`/`git/`, в общий реестр не просится.
    if (env.details.rootLinks.npm !== 'linked' && env.details.rootLinks.git !== 'linked') continue;
    for (const src of env.details.packages) {
      const identity = pkgIdentity(src);
      const set = byIdentity.get(identity) ?? new Set<string>();
      set.add(src);
      byIdentity.set(identity, set);
    }
  }
  const out: RegistryGap[] = [];
  for (const [identity, sources] of byIdentity) {
    if (sources.size !== 1) continue;
    const declared = [...sources][0]!;
    if (registry.includes(declared)) continue;
    out.push({ identity, declared, registered: registry.filter((s) => pkgIdentity(s) === identity) });
  }
  return out.sort((a, b) => a.identity.localeCompare(b.identity));
}

/**
 * Один пакет (по идентичности pi), объявленный разными источниками. `name` — сама
 * идентичность (`npm:@scope/name`), она же ключ `ExtState.conflictName`.
 */
export interface PackageConflict {
  name: string;
  declarations: Array<{ env: string; source: string }>;
}

/**
 * Уникальный источник группы конфликта и окружения, которые его объявили.
 * Суб-экран выбора победителя показывает источники, а не окружения: все окружения,
 * объявившие один и тот же источник, получают его вместе.
 */
export interface ConflictSource {
  source: string;
  envs: string[];
}

/** Конфликты источников: один пакет (идентичность pi) объявлен по-разному в разных окружениях. */
export function packageConflicts(envs: Environment[]): PackageConflict[] {
  const byName = new Map<string, Array<{ env: string; source: string }>>();
  for (const env of envs) {
    for (const source of env.details.packages) {
      const identity = pkgIdentity(source);
      const list = byName.get(identity) ?? [];
      list.push({ env: env.name, source });
      byName.set(identity, list);
    }
  }
  const out: PackageConflict[] = [];
  for (const [name, declarations] of byName) {
    const distinct = new Set(declarations.map((d) => d.source));
    if (distinct.size > 1) out.push({ name, declarations });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Варианты выбора победителя: объявления группы, сжатые до уникальных источников
 * (4 объявления — 2 источника), с окружениями, которые каждый из них объявил.
 */
export function conflictSources(conflict: PackageConflict): ConflictSource[] {
  const bySource = new Map<string, string[]>();
  for (const d of conflict.declarations) {
    const envs = bySource.get(d.source) ?? [];
    if (!envs.includes(d.env)) envs.push(d.env);
    bySource.set(d.source, envs);
  }
  return [...bySource.entries()]
    .map(([source, envs]) => ({ source, envs: envs.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.source.localeCompare(b.source));
}
