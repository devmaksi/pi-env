/**
 * Замок команд, пишущих в общее хранилище пакетов.
 *
 * Пакетные корни окружений — симлинки на `<store>`, поэтому `pi install` из формы окружения,
 * `pi update --extensions` с вкладки и очередь доноса реестра бьют в один и тот же
 * `<store>/npm/package.json` и `<store>/npm/node_modules`. Два npm-процесса одновременно —
 * риск испорченного манифеста на каталог, общий для всех агентов.
 *
 * Правило: одновременно идёт не более одной команды, чья цель попадает в хранилище; вторая
 * отклоняется (`onRefuse` обязан объяснить пользователю почему). Команды вне хранилища
 * блокируются тем же замком — иначе установка в выключенное окружение и установка в хранилище
 * всё равно сошлись бы в один момент на общих корнях.
 */
export interface StoreLock {
  /** true — задача выполнена, false — отклонена (в хранилище уже идёт операция). */
  run<T>(dir: string, task: () => Promise<T>): Promise<boolean>;
  /** То же, что `run`, но с результатом задачи: `ran: false` — отклонена. */
  attempt<T>(dir: string, task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>;
  busy(): boolean;
}

export function createStoreLock(
  isShared: (dir: string) => boolean,
  onRefuse: (dir: string) => void,
): StoreLock {
  let locked = false;
  return {
    async run<T>(dir: string, task: () => Promise<T>): Promise<boolean> {
      if (!isShared(dir)) {
        await task();
        return true;
      }
      if (locked) {
        onRefuse(dir);
        return false;
      }
      locked = true;
      try {
        await task();
      } finally {
        locked = false;
      }
      return true;
    },
    async attempt<T>(dir: string, task: () => Promise<T>) {
      if (!isShared(dir)) return { ran: true as const, value: await task() };
      if (locked) {
        onRefuse(dir);
        return { ran: false as const };
      }
      locked = true;
      try {
        return { ran: true as const, value: await task() };
      } finally {
        locked = false;
      }
    },
    busy: () => locked,
  };
}

/** Попадает ли каталог команды в общее хранилище (сам каталог или его подкаталог). */
export function targetsStore(dir: string, storeDir: string): boolean {
  const d = dir.replace(/\/+$/, '');
  const s = storeDir.replace(/\/+$/, '');
  return d === s || d.startsWith(s + '/');
}
