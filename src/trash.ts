import { lstatSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { t } from './i18n.js';

/** Служебный каталог корзины в корне окружений (имя с `.` — его не даёт создать `validateName`). */
export const TRASH_DIR = '.trash';
/** Ветка корзины для одиночных файлов (имя без `.` — внутри `.trash`, окружением не считается). */
export const TRASH_FILES_DIR = 'files';
/** Разделитель «окружение — файл» в имени файловой записи. */
const FILE_SEP = '--';

/**
 * Запись корзины: каталог перенесённого окружения или одиночный файл.
 * `dirName` — имя записи (`<имя>@<unix-мс>` для каталога, `<окружение>--<файл>@<unix-мс>` для файла),
 * `name` — исходное имя окружения, `ts` — метка удаления; null — метки нет.
 */
export interface TrashEntry {
  dirName: string;
  name: string;
  ts: number | null;
  path: string;
  /** Каталог окружения или одиночный файл (ветка `.trash/files`). */
  kind: 'dir' | 'file';
  /** Для файловой записи: имя файла внутри окружения (`models.json`). */
  fileName?: string;
}

export type TrashResult = { ok: true; path: string } | { ok: false; error: string };

export function trashRoot(root: string): string {
  return join(root, TRASH_DIR);
}

/** Каталог файловых записей корзины. */
export function trashFilesRoot(root: string): string {
  return join(root, TRASH_DIR, TRASH_FILES_DIR);
}

/** Имя безопасно как один уровень внутри .trash: без `.`/`..` и без разделителей пути. */
function safeDirName(dirName: string): boolean {
  if (dirName === '' || dirName === '.' || dirName === '..') return false;
  return !dirName.includes('/') && !dirName.includes('\\');
}

/** Разбор имени записи: метка — только цифровой хвост после последнего `@` (его не допускает имя окружения). */
function parseDirName(dirName: string): { name: string; ts: number | null } {
  const i = dirName.lastIndexOf('@');
  if (i <= 0) return { name: dirName, ts: null };
  const tail = dirName.slice(i + 1);
  if (!/^\d+$/.test(tail)) return { name: dirName, ts: null };
  const ts = Number(tail);
  return Number.isFinite(ts) ? { name: dirName.slice(0, i), ts } : { name: dirName, ts: null };
}

/** Разбор имени файловой записи: `<окружение>--<файл>@<мс>`. */
function parseFileDirName(dirName: string): { envName: string; fileName: string; ts: number | null } {
  const { name, ts } = parseDirName(dirName);
  // Разделитель ищется с конца: имя окружения может содержать «--» (`validateName` это
  // разрешает), а имя файла — нет.
  const sep = name.lastIndexOf(FILE_SEP);
  if (sep <= 0 || sep + FILE_SEP.length >= name.length) return { envName: name, fileName: '', ts };
  return { envName: name.slice(0, sep), fileName: name.slice(sep + FILE_SEP.length), ts };
}

/** Имя файловой записи корзины. */
export function trashFileName(envName: string, fileName: string, now: number): string {
  return envName + FILE_SEP + fileName + '@' + now;
}

function sortEntries(entries: TrashEntry[]): TrashEntry[] {
  return entries.sort((a, b) => {
    if (a.ts === null && b.ts === null) return a.dirName.localeCompare(b.dirName);
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return b.ts - a.ts;
  });
}

/**
 * Записи корзины: сначала каталоги окружений, затем одиночные файлы; внутри —
 * датированные новые сверху, без метки — в конце списка по имени. [] — корзины нет.
 */
export function listTrash(root: string): TrashEntry[] {
  const dirs: TrashEntry[] = [];
  const dir = trashRoot(root);
  if (existsSync(dir)) {
    let names: string[];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== TRASH_FILES_DIR)
        .map((e) => e.name);
    } catch {
      names = [];
    }
    for (const dirName of names) {
      const { name, ts } = parseDirName(dirName);
      dirs.push({ dirName, name, ts, path: join(dir, dirName), kind: 'dir' });
    }
  }
  const files: TrashEntry[] = [];
  const filesDir = trashFilesRoot(root);
  if (existsSync(filesDir)) {
    let names: string[];
    try {
      names = readdirSync(filesDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      names = [];
    }
    for (const dirName of names) {
      const { envName, fileName, ts } = parseFileDirName(dirName);
      files.push({ dirName, name: envName, ts, path: join(filesDir, dirName), kind: 'file', fileName });
    }
  }
  return [...sortEntries(dirs), ...sortEntries(files)];
}

/** Переносит каталог окружения `<root>/<name>` в корзину (`<name>@<now>`). Один `rename`, без копирования. */
export function moveToTrash(root: string, name: string, now: number, lang: string = 'ru'): TrashResult {
  const from = join(root, name);
  if (!existsSync(from)) return { ok: false, error: t(lang, 'err.not-found') };
  const dir = trashRoot(root);
  const to = join(dir, `${name}@${now}`);
  try {
    mkdirSync(dir, { recursive: true });
    renameSync(from, to);
  } catch {
    return { ok: false, error: t(lang, 'err.trash-move', { name }) };
  }
  return { ok: true, path: to };
}

/** Переносит файл окружения `<root>/<env>/<file>` в ветку `.trash/files`. */
export function moveFileToTrash(root: string, envName: string, fileName: string, now: number, lang: string = 'ru'): TrashResult {
  const from = join(root, envName, fileName);
  if (!existsSync(from)) return { ok: false, error: t(lang, 'err.not-found') };
  // Файловая ветка корзины хранит только файлы: каталог, перенесённый сюда, в суб-экране
  // «Корзина» не виден (список читает файлы) и через UI не восстанавливается.
  try {
    if (!lstatSync(from).isFile()) return { ok: false, error: t(lang, 'err.trash-not-file', { name: `${envName}/${fileName}` }) };
  } catch {
    return { ok: false, error: t(lang, 'err.trash-move', { name: `${envName}/${fileName}` }) };
  }
  const dir = trashFilesRoot(root);
  const to = join(dir, trashFileName(envName, fileName, now));
  try {
    mkdirSync(dir, { recursive: true });
    renameSync(from, to);
  } catch {
    return { ok: false, error: t(lang, 'err.trash-move', { name: `${envName}/${fileName}` }) };
  }
  return { ok: true, path: to };
}

/** Человекочитаемое имя записи для статус-строки: каталог — имя окружения, файл — «окружение · файл». */
export function trashEntryDisplayName(dirName: string): string {
  const { name } = parseDirName(dirName);
  const sep = name.lastIndexOf(FILE_SEP);
  if (sep <= 0 || sep + FILE_SEP.length >= name.length) return name;
  return `${name.slice(0, sep)} · ${name.slice(sep + FILE_SEP.length)}`;
}

/** Возвращает запись корзины на место: `<root>/<имя>`. Занятое имя — ошибка, запись остаётся в корзине. */
export function restoreTrash(root: string, dirName: string, lang: string = 'ru'): TrashResult {
  if (!safeDirName(dirName)) return { ok: false, error: t(lang, 'err.trash-bad-name', { name: dirName }) };
  const from = join(trashRoot(root), dirName);
  if (!existsSync(from)) return { ok: false, error: t(lang, 'err.not-found') };
  const { name } = parseDirName(dirName);
  const to = join(root, name);
  if (existsSync(to)) return { ok: false, error: t(lang, 'err.trash-taken', { name }) };
  try {
    renameSync(from, to);
  } catch {
    return { ok: false, error: t(lang, 'err.trash-restore', { name }) };
  }
  return { ok: true, path: to };
}

/** Возвращает файл из `.trash/files` в своё окружение. Занятый путь — ошибка, файл остаётся в корзине. */
export function restoreTrashFile(root: string, entryName: string, lang: string = 'ru'): TrashResult {
  if (!safeDirName(entryName)) return { ok: false, error: t(lang, 'err.trash-bad-name', { name: entryName }) };
  const from = join(trashFilesRoot(root), entryName);
  if (!existsSync(from)) return { ok: false, error: t(lang, 'err.not-found') };
  const { envName, fileName } = parseFileDirName(entryName);
  if (envName === '' || fileName === '') return { ok: false, error: t(lang, 'err.trash-bad-name', { name: entryName }) };
  const to = join(root, envName, fileName);
  if (existsSync(to)) return { ok: false, error: t(lang, 'err.trash-taken', { name: `${envName}/${fileName}` }) };
  try {
    renameSync(from, to);
  } catch {
    return { ok: false, error: t(lang, 'err.trash-restore', { name: `${envName}/${fileName}` }) };
  }
  return { ok: true, path: to };
}

/** `rm -rf` только записи корзины — единственное безвозвратное удаление в корзине. */
export function deleteTrashForever(root: string, dirName: string, lang: string = 'ru'): TrashResult {
  if (!safeDirName(dirName)) return { ok: false, error: t(lang, 'err.trash-bad-name', { name: dirName }) };
  const path = join(trashRoot(root), dirName);
  if (!existsSync(path)) return { ok: false, error: t(lang, 'err.not-found') };
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    return { ok: false, error: t(lang, 'err.trash-delete', { name: parseDirName(dirName).name }) };
  }
  return { ok: true, path };
}

/** Безвозвратное удаление файловой записи корзины. */
export function deleteTrashFileForever(root: string, entryName: string, lang: string = 'ru'): TrashResult {
  if (!safeDirName(entryName)) return { ok: false, error: t(lang, 'err.trash-bad-name', { name: entryName }) };
  const path = join(trashFilesRoot(root), entryName);
  if (!existsSync(path)) return { ok: false, error: t(lang, 'err.not-found') };
  const { envName, fileName } = parseFileDirName(entryName);
  try {
    rmSync(path);
  } catch {
    return { ok: false, error: t(lang, 'err.trash-delete', { name: `${envName}/${fileName}` }) };
  }
  return { ok: true, path };
}

/** Метка времени в имени записи: `2026-10-24 12:03` (локальное время, не UTC). */
export function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Подпись записи в списке: `<имя> · <дата>`; файл — `<окружение> · <файл> · <дата>`; без метки — только имя. */
export function trashLabel(e: TrashEntry): string {
  const base = e.kind === 'file' && e.fileName ? `${e.name} · ${e.fileName}` : e.name;
  return e.ts === null ? base : `${base} · ${formatTs(e.ts)}`;
}
