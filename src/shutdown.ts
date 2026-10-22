/**
 * Гарантированный вывод терминала из raw/alt-screen при любом выходе из TUI.
 * Чистый модуль: всё взаимодействие с процессом — через `ShutdownDeps` (инъекция),
 * поэтому тестируется без TTY.
 */
export interface ShutdownDeps {
  /** Полный вывод терминала: raw-режим, alt-screen, курсор. Вызывается ровно один раз. */
  stop(): void;
  /** Сообщение об исключении (локализованное) — в stderr. */
  report(err: unknown): void;
  exit(code: number): void;
  on(event: string, handler: (arg?: unknown) => void): void;
  off(event: string, handler: (arg?: unknown) => void): void;
}

const ERROR_EVENTS = ['uncaughtException', 'unhandledRejection'];
const SIGNAL_EVENTS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Выполняет `body`, гарантируя `deps.stop()` ровно один раз — при нормальном
 * завершении, при исключении из самого тела, при rejection из необранной
 * async-команды («выстрелил и забыл») и при внешнем сигнале.
 * Функция никогда не reject'ит: сбой сообщается через `report` и завершается `exit(1)`.
 */
export async function withShutdown(deps: ShutdownDeps, body: () => Promise<void>): Promise<void> {
  let closed = false;
  const safeReport = (err: unknown): void => {
    try { deps.report(err); } catch { /* stderr недоступен — хуже уже не сделать */ }
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    try { deps.stop(); } catch (err) { safeReport(err); }
  };
  const fail = (err: unknown): void => {
    if (closed) return;
    safeReport(err);
    close();
    deps.exit(1);
  };
  const handlers = new Map<string, (arg?: unknown) => void>();
  for (const event of ERROR_EVENTS) handlers.set(event, (arg) => fail(arg));
  for (const event of SIGNAL_EVENTS) handlers.set(event, () => { close(); deps.exit(1); });
  for (const [event, handler] of handlers) deps.on(event, handler);
  try {
    await body();
  } catch (err) {
    fail(err);
  } finally {
    for (const [event, handler] of handlers) deps.off(event, handler);
    close();
  }
}
