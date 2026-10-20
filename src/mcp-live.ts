import { t, type StrKey } from './i18n.js';
import type { McpServer } from './mcp.js';

/** Состояние подключения из `pi mcp list` ('unknown' — если pi вернул неожиданное значение). */
export type McpLiveState = 'connected' | 'needs-auth' | 'connecting' | 'disabled' | 'failed' | 'unknown';
export const MCP_LIVE_STATES: readonly McpLiveState[] = ['connected', 'needs-auth', 'connecting', 'disabled', 'failed', 'unknown'];

/** Живой статус одного сервера (запись вывода `pi mcp list --json`). */
export interface McpLiveStatus {
  name: string;
  scope: string;
  source: string;
  enabled: boolean;
  exposure: string;
  transport: string;
  state: McpLiveState;
  tools: string[];
  error?: string;
  override?: string;
  toolExposure?: Record<string, string>;
  resources?: boolean;
}

/** Живая проверка: серверы + ошибки конфигурации. */
export interface McpLiveReport {
  servers: McpLiveStatus[];
  errors: string[];
}

function liveState(v: unknown): McpLiveState {
  return MCP_LIVE_STATES.includes(v as McpLiveState) ? (v as McpLiveState) : 'unknown';
}

/** Разбор вывода `pi mcp list --json`; битый вывод (не объект со списком servers) — null. */
export function parseMcpList(stdout: string): McpLiveReport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const list = (raw as { servers?: unknown }).servers;
  if (!Array.isArray(list)) return null;
  const servers: McpLiveStatus[] = [];
  for (const value of list) {
    const s = parseLiveEntry(value);
    if (s !== null) servers.push(s);
  }
  const errors = Array.isArray((raw as { errors?: unknown }).errors)
    ? (raw as { errors: unknown[] }).errors.filter((e): e is string => typeof e === 'string')
    : [];
  return { servers, errors };
}

/** Строка или undefined; массив/число/отсутствие — undefined. */
function strOr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseLiveEntry(value: unknown): McpLiveStatus | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.name !== 'string') return null;
  const toolExposure = e.toolExposure;
  const live: McpLiveStatus = {
    name: e.name,
    scope: strOr(e.scope) ?? 'global',
    source: strOr(e.source) ?? '',
    enabled: typeof e.enabled === 'boolean' ? e.enabled : true,
    exposure: strOr(e.exposure) ?? '',
    transport: strOr(e.transport) ?? '',
    state: liveState(e.state),
    tools: Array.isArray(e.tools) ? (e.tools as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  };
  const error = strOr(e.error);
  if (error !== undefined) live.error = error;
  const override = strOr(e.override);
  if (override !== undefined) live.override = override;
  if (toolExposure !== null && typeof toolExposure === 'object' && !Array.isArray(toolExposure)) {
    live.toolExposure = Object.fromEntries(
      Object.entries(toolExposure as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  }
  if (typeof e.resources === 'boolean') live.resources = e.resources;
  return live;
}

/** Строка списка MCP: конфиг (mcp.json) + живой статус (pi mcp list), по имени. */
export interface McpListEntry {
  name: string;
  config: McpServer | null;
  live: McpLiveStatus | null;
}

/**
 * Сводка конфига с живой проверкой: union имён (сортировка по имени);
 * живой сервер вне конфига — запись с config: null (например, project-override).
 */
export function mergeLive(config: McpServer[], report: McpLiveReport | null): McpListEntry[] {
  const byConfig = new Map(config.map((s) => [s.name, s]));
  const byLive = new Map((report?.servers ?? []).map((s) => [s.name, s]));
  const names = [...new Set([...byConfig.keys(), ...byLive.keys()])].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, config: byConfig.get(name) ?? null, live: byLive.get(name) ?? null }));
}

/** Короткий маркер живого статуса для списка. */
export function liveMarker(live: McpLiveStatus, lang: string): string {
  return t(lang, ('mcp.live.' + live.state) as StrKey, { n: live.tools.length });
}
