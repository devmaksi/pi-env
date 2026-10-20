import { spawn } from 'node:child_process';

/** Таймауты дочерних процессов, мс. */
export const PI_TIMEOUT_MS = 5 * 60_000;
export const NPM_TIMEOUT_MS = 10_000;
/** Проверка живого статуса MCP: `pi mcp list` подключается ко всем серверам, мс. */
export const MCP_TIMEOUT_MS = 30_000;

/** Окружение для pi-команд: каталог агента и вывод без цвета. */
export function piEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, PI_CODING_AGENT_DIR: dir, NO_COLOR: '1' };
}

/** Результат runCmd. */
export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Запускает команду, собирает stdout/stderr; таймаут — убийство процесса. */
export function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CmdResult> {
  return new Promise((resolve) => {
    let done = false;
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, stdout, stderr });
    };
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    child.on('error', () => finish(false));
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => finish(code === 0));
    timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
  });
}
