/** Фейковые stdout/stdin вместо терминала; внутри fn можно вызывать createTerm() без TTY. */
export function withFakeTermStreams<T>(fn: (writes: string[], raw: boolean[]) => T): T {
  const realOut = process.stdout;
  const realIn = process.stdin;
  const writes: string[] = [];
  const raw: boolean[] = [];
  Object.defineProperty(process, 'stdout', {
    value: {
      write: (s: string) => { writes.push(s); return true; },
      columns: 80,
      rows: 24,
      isTTY: true,
    },
    configurable: true,
  });
  Object.defineProperty(process, 'stdin', {
    value: {
      setRawMode: (mode: boolean) => { raw.push(mode); },
      resume: () => {},
      pause: () => {},
      on: () => {},
      removeListener: () => {},
      isTTY: true,
    },
    configurable: true,
  });
  try {
    return fn(writes, raw);
  } finally {
    Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
    Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  }
}
