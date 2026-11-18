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
  /** Процесс убит по сигналу вызывающего (отмена пользователем). */
  cancelled: boolean;
  /** Процесс убит по таймауту — таймаут отличим и от отмены, и от ordinary провала. */
  timedOut: boolean;
  /** Таймаут, с которым запускался процесс — из него считают секунды в сообщении. */
  timeoutMs: number;
}

/** Слой запуска внешних процессов: тесты подставляют фейк вместо настоящего `runCmd`. */
export type RunFn = typeof runCmd;

/** Запускает команду, собирает stdout/stderr; таймаут и сигнал — убийство процесса. */
export function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<CmdResult> {
  return new Promise((resolve) => {
    let done = false;
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | undefined;
    let kill: (() => void) | undefined;
    const finish = (ok: boolean, why?: 'cancelled' | 'timedOut') => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      const signal = opts.signal;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ ok, stdout, stderr, cancelled: why === 'cancelled', timedOut: why === 'timedOut', timeoutMs });
    };
    function onAbort() {
      if (kill) kill();
      finish(false, 'cancelled');
    }
    // Сигнал уже снят до запуска — процесс не должен запуститься вовсе.
    if (opts.signal?.aborted) {
      resolve({ ok: false, stdout: '', stderr: '', cancelled: true, timedOut: false, timeoutMs });
      return;
    }
    // detached: процесс возглавляет группу — иначе kill() снимает только оболочку,
    // а её дети (npm внутри `pi install`) продолжают работать и держать пайпы.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: process.platform !== 'win32' });
    // Свой слушатель, а не opts.signal у spawn: AbortError в 'error' неотличим от сбоя запуска.
    opts.signal?.addEventListener('abort', onAbort);
    kill = () => {
      const pid = child.pid;
      try {
        if (pid !== undefined && process.platform !== 'win32') process.kill(-pid, 'SIGTERM');
        else child.kill();
      } catch { child.kill(); }
    };
    child.on('error', () => finish(false));
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('exit', (code) => finish(code === 0));
    timer = setTimeout(() => { if (kill) kill(); finish(false, 'timedOut'); }, timeoutMs);
  });
}
