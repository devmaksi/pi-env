import {
  runCmd, piEnv, PI_TIMEOUT_MS, NPM_TIMEOUT_MS, MCP_TIMEOUT_MS, type CmdResult, type RunFn,
} from './cmd.js';
import { interpretOutdated, type Catalog, type ToolItem, type SkillItem } from './catalog.js';
import type { CreateRequest } from './create.js';
import type { CreateState, McpFormAdd } from './state.js';
import { mcpAddCliArgs, type McpServer } from './mcp.js';
import { t, type StrKey } from './i18n.js';

export type { RunFn };

/** pi update --extensions: обновление всех установленных пакетов в папке агента dir. */
export function piUpdateAll(dir: string, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', ['update', '--extensions'], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

/** pi update <source>: обновление одного пакета. */
export function piUpdateOne(dir: string, source: string, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', ['update', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

/** pi remove <source>: полное удаление пакета. */
export function piRemove(dir: string, source: string, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', ['remove', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

/** pi mcp add <server> ...: добавление сервера в mcp.json каталога dir. */
export function piMcpAdd(dir: string, form: McpFormAdd, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', mcpAddCliArgs(form), PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

/**
 * pi mcp list --json: живой статус серверов каталога dir.
 * Код выхода 1 при неподключённых серверах — норма, успех смотрим по stdout.
 */
export function piMcpList(dir: string, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', ['mcp', 'list', '--json'], MCP_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

export function piInstall(dir: string, source: string, signal?: AbortSignal, run: RunFn = runCmd): Promise<CmdResult> {
  return run('pi', ['install', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir), signal });
}

/** npm outdated --json по npm-каталогу папки агента → карта имени → latest. */
export async function npmOutdated(
  npmDir: string,
  signal?: AbortSignal,
  run: RunFn = runCmd,
): Promise<{ ok: boolean; latest: Record<string, string> }> {
  const r = await run('npm', ['outdated', '--json', '--prefix', npmDir], NPM_TIMEOUT_MS, { signal });
  return interpretOutdated(r.stdout);
}

/**
 * Текст сбоя pi-команды: отмена и таймаут различимы и не прячут stderr обычной
 * ошибки. `name === null` — у команды нет имени пакета (`pi update --extensions`).
 */
export function cmdFailureText(r: CmdResult, lang: string, fallbackKey: StrKey, name: string | null): string {
  const sec = Math.round(r.timeoutMs / 1000);
  if (r.cancelled) return name === null ? t(lang, 'status.cancelled.nameless') : t(lang, 'status.cancelled', { name });
  if (r.timedOut) {
    return name === null
      ? t(lang, 'status.timeout.nameless', { sec })
      : t(lang, 'status.timeout', { name, sec });
  }
  const err = r.stderr.trim();
  return err !== '' ? err : t(lang, fallbackKey);
}

/** Сборка CreateRequest из состояния формы: маппинг имён выбранных tools/skills/mcp к элементам каталога. */
export function buildCreateRequest(catalog: Catalog, cr: CreateState): CreateRequest {
  return {
    name: cr.name,
    defaultProvider: cr.provider ?? undefined,
    defaultModel: cr.model ?? undefined,
    tools: cr.tools
      .map((n) => catalog.tools.find((t) => t.name === n))
      .filter((t): t is ToolItem => t !== undefined),
    skills: cr.skills
      .map((n) => catalog.skills.find((s) => s.name === n))
      .filter((s): s is SkillItem => s !== undefined),
    packages: cr.packages,
    mcp: cr.mcp
      .map((n) => catalog.mcp.find((s) => s.name === n))
      .filter((s): s is McpServer => s !== undefined),
  };
}
