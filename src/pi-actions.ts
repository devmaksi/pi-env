import { runCmd, piEnv, PI_TIMEOUT_MS, NPM_TIMEOUT_MS, type CmdResult } from './cmd.js';
import { interpretOutdated, type Catalog, type ToolItem, type SkillItem } from './catalog.js';
import type { CreateRequest } from './create.js';
import type { CreateState, McpFormAdd } from './state.js';
import { mcpAddCliArgs, type McpServer } from './mcp.js';

/** pi update --extensions: обновление всех установленных пакетов в папке агента dir. */
export function piUpdateAll(dir: string): Promise<CmdResult> {
  return runCmd('pi', ['update', '--extensions'], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
}

/** pi update <source>: обновление одного пакета. */
export function piUpdateOne(dir: string, source: string): Promise<CmdResult> {
  return runCmd('pi', ['update', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
}

/** pi remove <source>: полное удаление пакета. */
export function piRemove(dir: string, source: string): Promise<CmdResult> {
  return runCmd('pi', ['remove', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
}

/** pi install <source>: установка пакета в указанный каталог агента (main или окружение). */
export function piMcpAdd(dir: string, form: McpFormAdd): Promise<CmdResult> {
  return runCmd('pi', mcpAddCliArgs(form), PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
}

export function piInstall(dir: string, source: string): Promise<CmdResult> {
  return runCmd('pi', ['install', source], PI_TIMEOUT_MS, { cwd: process.cwd(), env: piEnv(dir) });
}

/** npm outdated --json по npm-каталогу папки агента → карта имени → latest. */
export async function npmOutdated(npmDir: string): Promise<{ ok: boolean; latest: Record<string, string> }> {
  const r = await runCmd('npm', ['outdated', '--json', '--prefix', npmDir], NPM_TIMEOUT_MS);
  return interpretOutdated(r.stdout);
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
