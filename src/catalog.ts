import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  const custom = readJson(join(agentDir, 'models.json'));
  if (custom && typeof custom === 'object') {
    const providers = (custom as { providers?: unknown }).providers;
    if (providers && typeof providers === 'object') {
      for (const [name, value] of Object.entries(providers as Record<string, unknown>)) {
        add(name, (value as { models?: unknown }).models);
      }
    }
  }

  const store = readJson(join(agentDir, 'models-store.json'));
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

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
