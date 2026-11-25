import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scan, withMain, type Environment } from './environments.js';
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
 * `settings.json`/`mcp.json`/`extensions/`/`skills/`, плюс mtime корня, корзины
 * и каталога main-агента (он вне `<root>`).
 * Общий файл хранилища (`storeFile`) входит в подпись, если хранилище задано.
 * Дешевле полного `scan()` и ловит как изменения снаружи, так и свои правки.
 * `null` — корень не читается (кэшировать такой результат нельзя).
 */
export function scanSignature(root: string, agentDir: string, storeFile: string | null = null): string | null {
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
  // Общий файл хранилища: его правка меняет каталог моделей всех связанных окружений.
  if (storeFile !== null) parts.push('store:' + statTag(storeFile));
  // Каталог main-агента живёт вне `<root>` — его правки иначе не видны совсем.
  parts.push(
    'main:' + statTag(agentDir),
    's=' + statTag(join(agentDir, 'settings.json')),
    'm=' + statTag(join(agentDir, 'mcp.json')),
    'e=' + statTag(join(agentDir, 'extensions')),
    'k=' + statTag(join(agentDir, 'skills')),
  );
  return parts.join('|');
}

export interface ScanCacheDeps {
  scan?: typeof scan;
  listTrash?: typeof listTrash;
  signature?: (root: string, agentDir: string, storeFile: string | null) => string | null;
}

/**
 * Кэш снимка окружений: `get()` перечитывает диск только когда изменилась подпись
 * или когда кто-то позвал `invalidate()` (наши мутации, выход из дочернего `pi`).
 */
export function createScanCache(
  root: string,
  agentDir: string,
  deps: ScanCacheDeps = {},
  storeFile: string | null = null,
): { get(): ScanSnapshot; invalidate(): void } {
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
      const sig = doSig(root, agentDir, storeFile);
      if (sig !== null && cachedSig === sig && snapshot !== null) return snapshot;
      const scanned = doScan(root, storeFile);
      const snap: ScanSnapshot = { envs: scanned === null ? null : withMain(scanned, agentDir, storeFile), trash: doTrash(root) };
      // Нечитаемый корень и пустой результат скана не кэшируются: следующий get() обязан проверить снова.
      if (sig !== null && scanned !== null) {
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
