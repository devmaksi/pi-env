/** Зависимости тикера: таймеры инжектируются, тесты идут без реальных пауз. */
export interface TickerDeps {
  setTimer: (ms: number, cb: () => void) => void;
  /** Пауза между тиками, мс (по умолчанию 1000). */
  ms?: number;
}

/**
 * Однократно запущенная цепочка таймеров: `onTick()` делает дело и говорит, продолжать ли.
 * Повторный `start()` не заводит вторую цепочку.
 */
export function createTicker(onTick: () => boolean, deps: TickerDeps): { start(): void } {
  const ms = deps.ms ?? 1000;
  let running = false;
  const step = (): void => {
    if (!running) return;
    if (!onTick()) {
      running = false;
      return;
    }
    deps.setTimer(ms, step);
  };
  return {
    start(): void {
      if (running) return;
      running = true;
      deps.setTimer(ms, step);
    },
  };
}
