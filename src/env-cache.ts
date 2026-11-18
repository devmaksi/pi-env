import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scan, type Environment } from './environments.js';
import { listTrash, type TrashEntry } from './trash.js';

/** Снимок окружений и корзины: `envs === null` — корень недоступен. */
export interface ScanSnapshot {
  envs: Environment[] | null;
  trash: TrashEntry[];
}

/** mtime+размер объекта; `none` — объекта нет. Ошибка stat не роняет подпись. */
function statTag(path: string): string {
  try {
    const st = statSync(path);
    return `${st.mtimeMs}@${st.size}`;
  } catch {
    return 'none';
  }
}

/**
 * Подпись дерева окружений: имена окружений + для каждого mtime самого каталога и
 * `settings.json`/`mcp.json`/`extensions/`/`skills/`, плюс mtime корня и корзины.
 * Дешевле полного `scan()` и ловит как изменения снаружи, так и свои правки.
 * `null` — корень не читается (кэшировать такой результат нельзя).
 */
export function scanSignature(root: string): string | null {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const parts = ['root:' + statTag(root)];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(root, e.name);
    parts.push(
      `${e.name}@${statTag(dir)}`,
      's=' + statTag(join(dir, 'settings.json')),
      'm=' + statTag(join(dir, 'mcp.json')),
      'e=' + statTag(join(dir, 'extensions')),
      'k=' + statTag(join(dir, 'skills')),
    );
  }
  parts.push('trash:' + statTag(join(root, '.trash')));
  return parts.join('|');
}

export interface ScanCacheDeps {
  scan?: typeof scan;
  listTrash?: typeof listTrash;
  signature?: typeof scanSignature;
}

/**
 * Кэш снимка окружений: `get()` перечитывает диск только когда изменилась подпись
 * или когда кто-то позвал `invalidate()` (наши мутации, выход из дочернего `pi`).
 */
export function createScanCache(root: string, deps: ScanCacheDeps = {}): { get(): ScanSnapshot; invalidate(): void } {
  const doScan = deps.scan ?? scan;
  const doTrash = deps.listTrash ?? listTrash;
  const doSig = deps.signature ?? scanSignature;
  let cachedSig: string | undefined;
  let snapshot: ScanSnapshot | null = null;

  function forget(): void {
    cachedSig = undefined;
    snapshot = null;
  }

  return {
    get(): ScanSnapshot {
      const sig = doSig(root);
      if (sig !== null && cachedSig === sig && snapshot !== null) return snapshot;
      const envs = doScan(root);
      const snap: ScanSnapshot = { envs, trash: doTrash(root) };
      // Нечитаемый корень и пустой результат скана не кэшируются: следующий get() обязан проверить снова.
      if (sig !== null && envs !== null) {
        cachedSig = sig;
        snapshot = snap;
      } else {
        forget();
      }
      return snap;
    },
    invalidate(): void {
      forget();
    },
  };
}
