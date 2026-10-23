import process from 'node:process';
import type { FramePatch } from './diff.js';

export interface PrevState {
  esc: number;
  utf8: number[];
}

export const initialPrev: PrevState = { esc: 0, utf8: [] };

export interface KeyParse {
  keys: string[];
  prev: PrevState;
}


/**
 * Распознаёт клавиши из сырых байтов. Чистая функция: конечный автомат
 * с состоянием esc (0 — нет, 1 — прочитан ESC, 2 — прочитан ESC [).
 */
export function parseKeys(chunk: Buffer, prev: PrevState): KeyParse {
  const keys: string[] = [];
  let esc = prev.esc;
  let utf8 = prev.utf8.slice(); // не мутируем входное состояние
  for (const b of chunk) {
    if (esc === 0) {
      if (b === 0x1b) { esc = 1; continue; }
      if (b === 0x03) { keys.push('ctrlc'); continue; }
      if (b === 0x09) { keys.push('tab'); continue; }
      if (b === 0x0d || b === 0x0a) { keys.push('enter'); continue; }
      if (b === 0x20) { keys.push('space'); continue; }
      if (b === 0x7f) { keys.push('backspace'); continue; }
      if (b < 0x20) continue;
      // ponytail: побайтовый UTF-8; битый побег (лишний continuation-байт) просто отбрасывается
      if (b >= 0x80) {
        if (utf8.length === 0 && b < 0xc0) continue;
        utf8.push(b);
        const need = utf8[0] >= 0xf0 ? 4 : utf8[0] >= 0xe0 ? 3 : 2;
        if (utf8.length === need) {
          keys.push(new TextDecoder().decode(new Uint8Array(utf8)));
          utf8 = [];
        }
        continue;
      }
      keys.push(String.fromCharCode(b));
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
  return { keys, prev: { esc, utf8 } };
}

export interface Term {
  start(): void;
  stop(): void;
  width(): number;
  height(): number;
  key(): Promise<string>;
  clear(): void;
  /** Записать кадр: весь (после clear) или только изменённые строки. true — если написали. */
  paint(patch: FramePatch): boolean;
  /** Известно ли, что сейчас на экране: false сразу и после каждого start(). */
  screenKnown(): boolean;
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
  let prev: PrevState = { esc: 0, utf8: [] };
  /** Терминал сейчас в raw/alt-screen: повторный start()/stop() не действуют. */
  let running = false;
  /** Экран неизвестен: сразу и после каждого start() (свежий alt-буфер) — дозапись строк запрещена. */
  let screenUnknown = true;
  const resizes: Array<() => void> = [];

  function emit(): void {
    if (waiter !== null && queue.length > 0) {
      const w = waiter;
      waiter = null;
      w(queue.shift()!);
    }
  }

  function onData(chunk: Buffer): void {
    const parsed = parseKeys(chunk, prev);
    prev = parsed.prev;
    for (const k of parsed.keys) queue.push(k);
    emit();
  }

  const onWinch = () => {
    for (const cb of resizes) cb();
  };

  return {
    noColor,
    start() {
      if (running) return;
      running = true;
      screenUnknown = true; // свежий alt-буфер: предыдущего нашего кадра на экране нет
      out.write('\x1b[?1049h\x1b[?25l'); // alternate screen, скрыть курсор
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      process.on('SIGWINCH', onWinch);
    },
    stop() {
      if (!running) return;
      running = false;
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      out.write('\x1b[?25h\x1b[0m\x1b[?1049l'); // показать курсор, сброс атрибутов, возврат в основной экран
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
    paint(patch) {
      if (!running) return false;
      if (patch.kind === 'rows') {
        if (screenUnknown) return false; // на свежий alt-экран частичные строки писать нельзя
        out.write(patch.rows.map((r) => `\x1b[${r.row};1H${r.text}\x1b[K`).join(''));
        return true;
      }
      out.write('\x1b[2J\x1b[H' + patch.lines.join('\n'));
      screenUnknown = false;
      return true;
    },
    screenKnown() {
      return !screenUnknown;
    },
    onResize(cb) {
      resizes.push(cb);
    },
  };
}
