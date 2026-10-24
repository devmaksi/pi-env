import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { t } from './i18n.js';

/** Служебный каталог корзины в корне окружений (имя с `.` — его не даёт создать `validateName`). */
export const TRASH_DIR = '.trash';

/**
 * Запись корзины: каталог перенесённого окружения.
 * `dirName` — имя каталога (`<имя окружения>@<unix-мс>`), `name` — исходное имя окружения,
 * `ts` — метка удаления; null — метки нет (каталог создали вручную или метку испортили).
 */
export interface TrashEntry {
  dirName: string;
  name: string;
  ts: number | null;
  path: string;
}

export type TrashResult = { ok: true; path: string } | { ok: false; error: string };

export function trashRoot(root: string): string {
  return join(root, TRASH_DIR);
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

/** Записи корзины: датированные — новые сверху, без метки — в конце списка по имени. [] — корзины нет. */
export function listTrash(root: string): TrashEntry[] {
  const dir = trashRoot(root);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const entries = names.map((dirName) => {
    const { name, ts } = parseDirName(dirName);
    return { dirName, name, ts, path: join(dir, dirName) };
  });
  return entries.sort((a, b) => {
    if (a.ts === null && b.ts === null) return a.dirName.localeCompare(b.dirName);
    if (a.ts === null) return 1;
    if (b.ts === null) return -1;
    return b.ts - a.ts;
  });
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

/** Метка времени в имени записи: `2026-10-24 12:03` (локальное время, не UTC). */
export function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Подпись записи в списке: `<имя> · <дата>`; без метки — только имя. */
export function trashLabel(e: TrashEntry): string {
  return e.ts === null ? e.name : `${e.name} · ${formatTs(e.ts)}`;
}
