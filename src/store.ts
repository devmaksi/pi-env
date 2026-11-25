/**
 * Хранилище общих ресурсов окружений: путь, состояние каталога моделей окружения,
 * связывание/разрыв симлинка и снимки общего файла. Вся работа с файлами — здесь,
 * слой эффектов (`run-side.ts`) только вызывает и убирает копии в корзину.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
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
  const path = envModelsFile(envDir);
  let link;
  try {
    link = lstatSync(path, { throwIfNoEntry: false });
  } catch {
    return 'off';
  }
  if (link === undefined || link === null || !link.isSymbolicLink()) return 'off';
  if (!existsSync(path)) return 'broken';
  const target = readlinkSync(path);
  const abs = isAbsolute(target) ? resolve(target) : resolve(dirname(path), target);
  return abs === resolve(storeFile) ? 'linked' : 'broken';
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
  const prefix = `${basename(storeFile)}.bak-`;
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
  const path = envModelsFile(envDir);
  try {
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (st !== undefined && st !== null && !st.isDirectory()) unlinkSync(path);
    mkdirSync(envDir, { recursive: true });
    symlinkSync(storeFile, path);
  } catch {
    return { ok: false, error: t(lang, 'err.models-link') };
  }
  return { ok: true };
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
export function archiveEnvModelsIntoStore(envDir: string, storeFile: string, now: number): boolean {
  const src = envModelsFile(envDir);
  try {
    if (!existsSync(src) || lstatSync(src).isSymbolicLink()) return false;
    mkdirSync(dirname(storeFile), { recursive: true });
    copyFileSync(src, join(dirname(storeFile), storeSnapshotName(storeFile, now)));
    unlinkSync(src);
    return true;
  } catch {
    return false;
  }
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

/** Значимая часть подписи кэша: mtime общего файла (или его отсутствие). */
export function storeFileTag(storeFile: string): string {
  const st = statSync(storeFile, { throwIfNoEntry: false });
  if (st === undefined || st === null) return '-';
  return `${Math.trunc(st.mtimeMs)}:${st.size}`;
}
