/**
 * Хранилище общих ресурсов окружений: путь, состояние каталога моделей окружения,
 * связывание/разрыв симлинка и снимки общего файла. Вся работа с файлами — здесь,
 * слой эффектов (`run-side.ts`) только вызывает и убирает копии в корзину.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { t } from './i18n.js';

/** Каталог хранилища по умолчанию — служебная папка внутри корня окружений. */
export const STORE_DIR = '.store';
/** Каталог общего каталога моделей внутри хранилища. */
export const STORE_MODELS_DIR = 'models';

/** Как окружение получает каталог моделей. Файлово различимые состояния. */
export type ModelsLink = 'off' | 'linked' | 'broken';

export type StoreResult = { ok: true } | { ok: false; error: string };

/**
 * Корень хранилища: переменная окружения важнее настройки приложения,
 * настройка важнее `<root>/.store`. Относительный путь — относительно корня окружений.
 */
export function storeRoot(root: string, storeSetting: string | null, envOverride: string | null | undefined): string {
  const raw = envOverride ?? storeSetting;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
  }
  return join(root, STORE_DIR);
}

/** Общий файл каталога моделей. */
export function storeModelsFile(storeRootDir: string): string {
  return join(storeRootDir, STORE_MODELS_DIR, 'models.json');
}

/** Файл каталога моделей внутри окружения. */
export function envModelsFile(envDir: string): string {
  return join(envDir, 'models.json');
}

/** Пакетные корни: общие `npm` и `git`, которые окружения получают симлинками. */
export type StoreRoot = 'npm' | 'git';
export const STORE_ROOTS: readonly StoreRoot[] = ['npm', 'git'];

/** Реестр пакетов хранилища: `settings.json` каталога агента, которым является хранилище. */
export function storeSettingsFile(storeDir: string): string {
  return join(storeDir, 'settings.json');
}

/** Общий пакетный корень хранилища (`<store>/npm` | `<store>/git`). */
export function storePackagesRoot(storeDir: string, root: StoreRoot): string {
  return join(storeDir, root);
}

/** Пакетный корень внутри окружения: обычный каталог либо симлинк на хранилище. */
export function envRootDir(envDir: string, root: StoreRoot): string {
  return join(envDir, root);
}

/** Состояние связи пакетного корня окружения с хранилищем. */
export function rootLinkState(envDir: string, storeDir: string, root: StoreRoot): ModelsLink {
  return linkStateTo(envRootDir(envDir, root), storePackagesRoot(storeDir, root));
}

/**
 * Агрегат связи окружения с хранилищем: `linked` — все пакетные корни на хранилище,
 * `off` — ни один, `broken` — есть битый, `partial` — смесь (обычно после ручных
 * правок на диске; лечится починкой).
 */
export function storeLinkSummary(envDir: string, storeDir: string): 'off' | 'linked' | 'partial' | 'broken' {
  const states = STORE_ROOTS.map((root) => rootLinkState(envDir, storeDir, root));
  if (states.some((s) => s === 'broken')) return 'broken';
  if (states.every((s) => s === 'linked')) return 'linked';
  if (states.every((s) => s === 'off')) return 'off';
  return 'partial';
}

/** Снимок манифеста пакетного корня хранилища перед разрушительной операцией. */
export function snapshotStoreManifest(storeDir: string, now: number, keep = 5): void {
  const npm = storePackagesRoot(storeDir, 'npm');
  for (const file of ['package.json', 'package-lock.json']) {
    snapshotStoreModels(join(npm, file), now, keep);
  }
}

/** Реестр хранилища: объявления пакетов из `settings.json` каталога хранилища. */
export function storeRegistrySources(storeDir: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(storeSettingsFile(storeDir), 'utf8'));
    const packages = (value as { packages?: unknown })?.packages;
    return Array.isArray(packages) ? packages.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** Снимок общего файла: `models.json.bak-<мс>`, рядом с оригиналом. */
export function storeSnapshotName(storeFile: string, now: number): string {
  return `${basename(storeFile)}.bak-${now}`;
}

/** Файл хранилища пригоден: читается как JSON-объект. */
export function storeFileUsable(storeFile: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(storeFile, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/**
 * Состояние каталога моделей окружения: `linked` — симлинк на файл хранилища,
 * `broken` — симлинк в никуда или не в хранилище, `off` — своего файла нет либо
 * это обычный файл (в том числе когда-то заменённый симлинок: отличить нельзя).
 */
export function modelsLinkState(envDir: string, storeFile: string): ModelsLink {
  return linkStateTo(envModelsFile(envDir), storeFile);
}

/**
 * Состояние связи одного пути окружения с общим путём хранилища:
 * `linked` — симлинк ровно на общий путь, `broken` — симлинк в никуда или не в
 * хранилище, `off` — своего файла/каталога нет либо это обычный объект (когда-то
 * заменённый симлинк отличить нельзя).
 */
function linkStateTo(path: string, target: string): ModelsLink {
  let link;
  try {
    link = lstatSync(path, { throwIfNoEntry: false });
  } catch {
    return 'off';
  }
  if (link === undefined || link === null || !link.isSymbolicLink()) return 'off';
  if (!existsSync(path)) return 'broken';
  const dest = readlinkSync(path);
  const abs = isAbsolute(dest) ? resolve(dest) : resolve(dirname(path), dest);
  return abs === resolve(target) ? 'linked' : 'broken';
}
/** Снимок общего файла перед разрушительной операцией; старше `keep` удаляются. */
export function snapshotStoreModels(storeFile: string, now: number, keep = 5): void {
  if (!existsSync(storeFile)) return;
  const dir = dirname(storeFile);
  try {
    copyFileSync(storeFile, join(dir, storeSnapshotName(storeFile, now)));
  } catch {
    return;
  }
  pruneSnapshots(dirname(storeFile), `${basename(storeFile)}.bak-`, keep);
}

/** Удаляет снимки старше `keep` (имена `…bak-<мс>` сортируются по времени). */
function pruneSnapshots(dir: string, prefix: string, keep: number): void {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.startsWith(prefix)).sort();
  } catch {
    return;
  }
  while (names.length > keep) {
    const oldest = names.shift();
    if (oldest === undefined) break;
    try {
      rmSync(join(dir, oldest));
    } catch {
      /* снимок остался — не критично */
    }
  }
}

/**
 * Общий файл каталога моделей: есть — используется как есть; нет — копируется из
 * каталога main-агента; битый — уходит в снимок и пересоздаётся.
 */
export function ensureStoreModels(storeFile: string, agentDir: string, now: number, lang: string): StoreResult {
  if (existsSync(storeFile) && !storeFileUsable(storeFile)) snapshotStoreModels(storeFile, now);
  if (storeFileUsable(storeFile)) return { ok: true };
  const source = envModelsFile(agentDir);
  if (!existsSync(source)) return { ok: false, error: t(lang, 'err.store-no-source') };
  try {
    mkdirSync(dirname(storeFile), { recursive: true });
    copyFileSync(source, storeFile);
  } catch {
    return { ok: false, error: t(lang, 'err.models-link') };
  }
  return { ok: true };
}

/**
 * Каталог моделей окружения становится симлинком на общий файл. Свой файл окружения
 * здесь только снимается — копию в корзину заранее кладёт слой эффектов.
 */
export function linkModels(envDir: string, storeFile: string, agentDir: string, lang: string, now = Date.now()): StoreResult {
  const ensure = ensureStoreModels(storeFile, agentDir, now, lang);
  if (!ensure.ok) return ensure;
  const link = placeLink(envDir, storeFile);
  return link.ok ? link : { ok: false, error: t(lang, 'err.models-link') };
}

/** Разрыв связи: вместо симлинка — обычная копия общего файла. Свой файл не трогается. */
export function unlinkModels(envDir: string, storeFile: string, lang: string): StoreResult {
  if (!storeFileUsable(storeFile)) return { ok: false, error: t(lang, 'err.store-no-source') };
  const path = envModelsFile(envDir);
  try {
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (st !== undefined && st !== null && !st.isDirectory() && !st.isSymbolicLink()) return { ok: true };
    if (st !== undefined && st !== null) unlinkSync(path);
    copyFileSync(storeFile, path);
  } catch {
    return { ok: false, error: t(lang, 'err.models-link') };
  }
  return { ok: true };
}

/**
 * Своя копия каталога моделей уходит в снимок хранилища — для окружений вне `<root>`
 * (каталог main-агента), где файловая корзина окружений недоступна.
 */
export function archiveEnvModelsIntoStore(envDir: string, storeFile: string, now: number): string | null {
  const src = envModelsFile(envDir);
  try {
    if (!existsSync(src) || lstatSync(src).isSymbolicLink()) return null;
    const snap = join(dirname(storeFile), storeSnapshotName(storeFile, now));
    mkdirSync(dirname(storeFile), { recursive: true });
    copyFileSync(src, snap);
    pruneSnapshots(dirname(storeFile), `${basename(storeFile)}.bak-`, 5);
    unlinkSync(src);
    return snap;
  } catch {
    return null;
  }
}

/** Возврат снятой копии из снимка хранилища (откат неудавшегося включения). */
export function restoreFromStoreSnapshot(snapshotPath: string, envDir: string): void {
  try {
    copyFileSync(snapshotPath, envModelsFile(envDir));
    rmSync(snapshotPath);
  } catch {
    /* копия останется в снимке — хуже, чем потерять её, но операцию это не отменяет */
  }
}

/**
 * Включение хранилища для одного окружения, в безопасном порядке:
 * 1) общий файл создан (иначе источник ещё здесь, и трогать нечего);
 * 2) своя копия убрана в корзину/снимок (провал — операция не начинается);
 * 3) симлинк; провал — своя копия возвращена (`undo`).
 * `own.move` кладёт копию в корзину файлов или в снимок хранилища, `own.undo` её возвращает.
 */
export function enableModelsStorage(
  envDir: string,
  storeFile: string,
  agentDir: string,
  lang: string,
  now: number,
  own: { move: () => StoreResult; undo: () => void },
): StoreResult {
  const ensure = ensureStoreModels(storeFile, agentDir, now, lang);
  if (!ensure.ok) return ensure;
  const moved = own.move();
  if (!moved.ok) return moved;
  const link = placeLink(envDir, storeFile);
  if (!link.ok) own.undo();
  return link;
}

/** Ставит симлинк на уже существующий общий файл. */
function placeLink(envDir: string, storeFile: string): StoreResult {
  const path = envModelsFile(envDir);
  try {
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (st !== undefined && st !== null && !st.isDirectory()) unlinkSync(path);
    mkdirSync(envDir, { recursive: true });
    symlinkSync(storeFile, path);
  } catch {
    return { ok: false, error: '' };
  }
  return { ok: true };
}

/** Починка битой связи: снимает битый симлинк и ставит новый. */
export function repairModelsLink(envDir: string, storeFile: string, agentDir: string, lang: string, now = Date.now()): StoreResult {
  if (modelsLinkState(envDir, storeFile) !== 'broken') return { ok: true };
  try {
    const st = lstatSync(envModelsFile(envDir), { throwIfNoEntry: false });
    if (st !== undefined && st !== null && st.isSymbolicLink()) unlinkSync(envModelsFile(envDir));
  } catch {
    return { ok: false, error: t(lang, 'err.models-link') };
  }
  return linkModels(envDir, storeFile, agentDir, lang, now);
}
