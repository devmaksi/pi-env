import { spawn } from 'node:child_process';
import { t } from './i18n.js';
import type { Environment } from './environments.js';
import type { Term } from './terminal.js';

/**
 * Запускает pi в окружении, передав ему терминал.
 * ponytail: кодов выхода не различаем — любой exit означает возврат в TUI.
 */
export function launchPi(term: Term, env: Environment): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    term.stop();
    let done = false;
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true;
      term.start();
      resolve({ ok, message });
    };
    const child = spawn('pi', [], {
      cwd: process.cwd(),
      env: { ...process.env, PI_CODING_AGENT_DIR: env.path },
      stdio: 'inherit',
    });
    child.on('error', (e: Error) => finish(false, e.message));
    child.on('exit', () => finish(true, ''));
  });
}

/**
 * Неинтерактивный проброс: запускает pi в окружении,
 * передаёт терминал и пробрасывает код выхода.
 * ponytail: ENOENT → 127, прочие ошибки spawn — сообщение в stderr.
 */
export function runPassthrough(envPath: string, args: string[], lang: string): void {
  const child = spawn('pi', args, {
    cwd: process.cwd(),
    env: { ...process.env, PI_CODING_AGENT_DIR: envPath },
    stdio: 'inherit',
  });
  child.on('error', (e: NodeJS.ErrnoException) => {
    process.stderr.write((e.code === 'ENOENT' ? t(lang, 'run.pi.not_found') : e.message) + '\n');
    process.exit(127);
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}
