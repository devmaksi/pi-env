import { test } from 'node:test';
import assert from 'node:assert';
import { parseKeys, createTerm } from '../src/terminal.js';

test('parseKeys: стрелки', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x41]), 0).keys, ['up']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x42]), 0).keys, ['down']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x43]), 0).keys, ['right']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x44]), 0).keys, ['left']);
});

test('parseKeys: esc, enter, tab, space, ctrlc', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b]), 0).keys, ['esc']);
  assert.deepEqual(parseKeys(Buffer.from([0x0d]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x0a]), 0).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x09]), 0).keys, ['tab']);
  assert.deepEqual(parseKeys(Buffer.from([0x20]), 0).keys, ['space']);
  assert.deepEqual(parseKeys(Buffer.from([0x03]), 0).keys, ['ctrlc']);
});

test('parseKeys: последовательность разрезана по чанкам', () => {
  const first = parseKeys(Buffer.from([0x1b, 0x5b]), 0);
  assert.deepEqual(first.keys, []);
  const second = parseKeys(Buffer.from([0x41]), first.esc);
  assert.deepEqual(second.keys, ['up']);
});

test('term: приложение работает в alternate screen', () => {
  const realOut = process.stdout;
  const realIn = process.stdin;
  const writes: string[] = [];
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
      setRawMode: () => {},
      resume: () => {},
      pause: () => {},
      on: () => {},
      removeListener: () => {},
      isTTY: true,
    },
    configurable: true,
  });
  try {
    const term = createTerm();
    term.start();
    const afterStart = writes.join('');
    assert.ok(afterStart.includes('\x1b[?1049h'), 'start() переключает на alternate screen');
    assert.ok(afterStart.includes('\x1b[?25l'), 'start() скрывает курсор');
    term.stop();
    const afterStop = writes.join('');
    assert.ok(afterStop.includes('\x1b[?25h'), 'stop() показывает курсор');
    assert.ok(afterStop.includes('\x1b[?1049l'), 'stop() выходит из alternate screen');
    assert.ok(
      afterStop.indexOf('\x1b[?25h') < afterStop.indexOf('\x1b[?1049l'),
      'курсор показывается до возврата в основной экран',
    );
  } finally {
    Object.defineProperty(process, 'stdout', { value: realOut, configurable: true });
    Object.defineProperty(process, 'stdin', { value: realIn, configurable: true });
  }
});

test('parseKeys: неизвестная CSI-последовательность игнорируется', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x4f]), 0).keys, []);
});
