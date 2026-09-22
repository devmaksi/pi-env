import process from 'node:process';

export interface KeyParse {
  keys: string[];
  esc: number;
}

/**
 * Распознаёт клавиши из сырых байтов. Чистая функция: конечный автомат
 * с состоянием esc (0 — нет, 1 — прочитан ESC, 2 — прочитан ESC [).
 */
export function parseKeys(chunk: Buffer, prevEsc: number): KeyParse {
  const keys: string[] = [];
  let esc = prevEsc;
  for (const b of chunk) {
    if (esc === 0) {
      if (b === 0x1b) { esc = 1; continue; }
      if (b === 0x03) { keys.push('ctrlc'); continue; }
      if (b === 0x09) { keys.push('tab'); continue; }
      if (b === 0x0d || b === 0x0a) { keys.push('enter'); continue; }
      if (b === 0x20) { keys.push('space'); continue; }
      continue;
    }
    if (esc === 1) {
      if (b === 0x1b) { keys.push('esc'); esc = 0; continue; }
      if (b === 0x5b) { esc = 2; continue; }
      keys.push('esc');
      esc = 0;
      continue;
    }
    if (esc === 2) {
      if (b === 0x41) keys.push('up');
      else if (b === 0x42) keys.push('down');
      else if (b === 0x43) keys.push('right');
      else if (b === 0x44) keys.push('left');
      esc = 0;
    }
  }
  if (esc === 1) {
    keys.push('esc');
    esc = 0;
  }
  return { keys, esc };
}

export interface Term {
  start(): void;
  stop(): void;
  width(): number;
  height(): number;
  key(): Promise<string>;
  clear(): void;
  onResize(cb: () => void): void;
  noColor: boolean;
}

/** Тонкий слой raw-режима терминала. UI-логики здесь нет. */
export function createTerm(): Term {
  const out = process.stdout;
  const input = process.stdin;
  const noColor = Boolean(process.env.NO_COLOR);
  const queue: string[] = [];
  let waiter: ((k: string) => void) | null = null;
  let esc = 0;
  const resizes: Array<() => void> = [];

  function emit(): void {
    if (waiter !== null && queue.length > 0) {
      const w = waiter;
      waiter = null;
      w(queue.shift()!);
    }
  }

  function onData(chunk: Buffer): void {
    const parsed = parseKeys(chunk, esc);
    esc = parsed.esc;
    for (const k of parsed.keys) queue.push(k);
    emit();
  }

  const onWinch = () => {
    for (const cb of resizes) cb();
  };

  return {
    noColor,
    start() {
      out.write('\x1b[?25l'); // скрыть курсор
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      process.on('SIGWINCH', onWinch);
    },
    stop() {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      out.write('\x1b[2J\x1b[0m\x1b[?25h'); // очистить, показать курсор
      process.removeListener('SIGWINCH', onWinch);
    },
    width() {
      return out.columns || 80;
    },
    height() {
      return out.rows || 24;
    },
    key() {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise<string>((res) => { waiter = res; });
    },
    clear() {
      out.write('\x1b[2J\x1b[H');
    },
    onResize(cb) {
      resizes.push(cb);
    },
  };
}
