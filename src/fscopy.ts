/**
 * Файловые примитивы копирования/перемещения каталогов. Общий слой для `create.ts`
 * (создание и правка окружений) и `store.ts` (копии из хранилища при выключении):
  * третьей копии этих алгоритмов в репозитории быть не должно.
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readlinkSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Рекурсивно копирует файл или каталог `src` в `dest`. Симлинки сохраняются симлинками
 * (в том числе ведущие в никуда): клон включённого окружения обязан остаться включённым, а
 * разыменовать общий корень — значит скопировать сотни МБ и молча вывести окружение из
 * хранилища. Тип симлинка берётся из цели; для битого — `file`.
 */
export function copyRecursive(src: string, dest: string): void {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) {
    let type: 'dir' | 'file' = 'file';
    try { if (statSync(src).isDirectory()) type = 'dir'; } catch { /* битый симлинк — остаётся битым */ }
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(readlinkSync(src), dest, type);
    return;
  }
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
