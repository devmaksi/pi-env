test('parseKeys: стрелки', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x41]), initialPrev).keys, ['up']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x42]), initialPrev).keys, ['down']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x43]), initialPrev).keys, ['right']);
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x44]), initialPrev).keys, ['left']);
});

test('parseKeys: esc, enter, tab, space, ctrlc', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b]), initialPrev).keys, ['esc']);
  assert.deepEqual(parseKeys(Buffer.from([0x0d]), initialPrev).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x0a]), initialPrev).keys, ['enter']);
  assert.deepEqual(parseKeys(Buffer.from([0x09]), initialPrev).keys, ['tab']);
  assert.deepEqual(parseKeys(Buffer.from([0x20]), initialPrev).keys, ['space']);
  assert.deepEqual(parseKeys(Buffer.from([0x03]), initialPrev).keys, ['ctrlc']);
});

test('parseKeys: последовательность разрезана по чанкам', () => {
  const first = parseKeys(Buffer.from([0x1b, 0x5b]), initialPrev);
  assert.deepEqual(first.keys, []);
  const second = parseKeys(Buffer.from([0x41]), first.prev);
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

import { test } from 'node:test';
import assert from 'node:assert';
import { parseKeys, createTerm, initialPrev } from '../src/terminal.js';

test('parseKeys: печатные ASCII-символы', () => {
  assert.deepEqual(parseKeys(Buffer.from('ab'), initialPrev).keys, ['a', 'b']);
});

test('parseKeys: backspace', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x7f]), initialPrev).keys, ['backspace']);
});

test('parseKeys: кириллица (2 и 3 байта)', () => {
  assert.deepEqual(parseKeys(Buffer.from('яж'), initialPrev).keys, ['я', 'ж']);
});

test('parseKeys: символ UTF-8 разрезан по чанкам', () => {
  const first = parseKeys(Buffer.from([0xd1]), initialPrev);
  assert.deepEqual(first.keys, []);
  const second = parseKeys(Buffer.from([0x8f]), first.prev);
  assert.deepEqual(second.keys, ['я']);
  assert.deepEqual(second.prev.utf8, []);
});

test('parseKeys: смешанная последовательность', () => {
  assert.deepEqual(parseKeys(Buffer.from('a\u044f\x7f\x1b[\x41'), initialPrev).keys, ['a', 'я', 'backspace', 'up']);
});

test('parseKeys: неизвестная CSI-последовательность игнорируется', () => {
  assert.deepEqual(parseKeys(Buffer.from([0x1b, 0x5b, 0x4f]), initialPrev).keys, []);
});
