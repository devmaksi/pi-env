/**
 * Leading-edge throttle: первый вызов выполняется сразу, дальнейшие в окне `ms`
 * схлопываются в один отложенный вызов. Чистый модуль: часы и таймеры инжектятся,
 * поэтому тестируется без реальных пауз.
 */

export interface ThrottleDeps {
  /** Окно паузы между запусками `fn`. */
  ms: number;
  now: () => number;
  /** Поставить таймер; возвращает функцию его отмены. */
  setTimer: (ms: number, cb: () => void) => () => void;
}

export interface Throttle {
  call(): void;
  cancel(): void;
  readonly pending: boolean;
}

export function createThrottle(fn: () => void, deps: ThrottleDeps): Throttle {
  let lastRun: number | null = null;
  let cancelPending: (() => void) | null = null;

  const run = (at: number): void => {
    lastRun = at;
    cancelPending = null;
    fn();
  };

  return {
    call() {
      const now = deps.now();
      const elapsed = lastRun === null ? deps.ms : now - lastRun;
      if (elapsed >= deps.ms) {
        if (cancelPending !== null) cancelPending();
        run(now);
        return;
      }
      if (cancelPending !== null) return; // не более одного таймера «в полёте»
      cancelPending = deps.setTimer(deps.ms - elapsed, () => {
        const at = deps.now();
        run(at);
      });
    },
    cancel() {
      if (cancelPending !== null) cancelPending();
      cancelPending = null;
    },
    get pending() {
      return cancelPending !== null;
    },
  };
}
