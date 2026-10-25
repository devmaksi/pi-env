/** Сетевой слой само-обновления pi-env: только fetch, всё остальное — чистые функции из selfupdate.ts. */

import { changelogRange, changelogUrl, classifyInstall, isOutdated, mergeChangelog, parseChangelog, type ChangelogEntry, type InstallKind } from './selfupdate.js';

export const LATEST_URL = 'https://registry.npmjs.org/@devmaksi%2Fpi-env/latest';

export interface SelfUpdate {
  latest: string;
  installed: string;
  kind: InstallKind;
  checkedAt: number;
}

export interface FetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;

export interface SelfCheckDeps {
  fetchFn: FetchFn;
  installedVersion: string;
  moduleRealPath: string;
  agentNpmDir: string;
  noCheck: boolean;
  timeoutMs?: number;
  now?: () => number;
}

function timeoutSignal(deps: { timeoutMs?: number }): AbortSignal {
  return AbortSignal.timeout(deps.timeoutMs ?? 10_000);
}

/** Номер последней опубликованной версии; любой сбой — null. */
async function fetchLatest(deps: SelfCheckDeps): Promise<string | null> {
  try {
    const res = await deps.fetchFn(LATEST_URL, { signal: timeoutSignal(deps) });
    if (!res.ok) return null;
    const data = await res.json();
    const latest = (data as { 'dist-tags'?: { latest?: unknown } })?.['dist-tags']?.latest;
    return typeof latest === 'string' ? latest : null;
  } catch {
    return null;
  }
}

/**
 * Устарело ли приложение. Установка из исходников и отказ по переменной
 * обходятся без сетевого запроса вовсе.
 */
export async function runSelfCheck(deps: SelfCheckDeps): Promise<SelfUpdate | null> {
  const kind = classifyInstall(deps.moduleRealPath, deps.agentNpmDir);
  if (deps.noCheck || kind === 'source') return null;
  const latest = await fetchLatest(deps);
  if (latest === null) return null;
  if (!isOutdated(deps.installedVersion, latest)) return null;
  return { latest, installed: deps.installedVersion, kind, checkedAt: (deps.now ?? Date.now)() };
}

async function fetchText(deps: { fetchFn: FetchFn; timeoutMs?: number }, url: string): Promise<string | null> {
  try {
    const res = await deps.fetchFn(url, { signal: timeoutSignal(deps) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export interface VersionRange {
  installed: string;
  latest: string;
}

/**
 * Записи чейнджлога пропущенных релизов. Второй языковой файл догружается только
 * когда в основном языке не нашлось блока последней доступной версии; оба сбоя — null.
 */
export async function fetchChangelogEntries(
  deps: { fetchFn: FetchFn; timeoutMs?: number },
  lang: string,
  secondaryLang: string,
  range: VersionRange,
): Promise<ChangelogEntry[] | null> {
  const primaryText = await fetchText(deps, changelogUrl(lang));
  const primary = primaryText === null ? null : parseChangelog(primaryText);
  if (primary !== null && changelogRange(primary, range.installed, range.latest).some((e) => e.version === range.latest)) {
    return primary;
  }
  const secondaryText = await fetchText(deps, changelogUrl(secondaryLang));
  const secondary = secondaryText === null ? null : parseChangelog(secondaryText);
  if (primary === null && secondary === null) return null;
  return mergeChangelog(primary ?? [], secondary ?? []);
}
