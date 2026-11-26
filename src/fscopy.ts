/**
 * Файловые примитивы копирования/перемещения каталогов. Общий слой для `create.ts`
 * (создание и правка окружений) и `store.ts` (копии из хранилища при выключении):
  * третьей копии этих алгоритмов в репозитории быть не должно.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Рекурсивно копирует файл или каталог `src` в `dest`. */
export function copyRecursive(src: string, dest: string): void {
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
